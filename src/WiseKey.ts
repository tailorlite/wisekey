import { open } from 'lmdb';
import * as keychain from 'cross-keychain';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    KeychainAccessError,
    RotationFailedError,
    MapFullError,
} from './types.js';
import { encrypt, decrypt, generateMasterKey } from './crypto-utils.js';

interface WiseKeyConfig {
    name: string;
    path: string;
}

interface SecretValue {
    iv: string;
    content: string;
    tag: string;
}

interface LMDBStore {
    get(key: string): SecretValue | undefined;
    putSync(key: string, value: SecretValue): void;
    removeSync(key: string): boolean;
    getRange(
        options?: Record<string, unknown>,
    ): IterableIterator<{ key: string; value: SecretValue }>;
    transactionSync<T>(callback: () => T): T;
    close(): void;
}

const DEFAULT_MAP_SIZE = 100 * 1024 * 1024; // 100MB

class Logger {
    info(message: string): void {
        console.log(`[WiseKey INFO] ${new Date().toISOString()} - ${message}`);
    }
    error(message: string): void {
        console.error(
            `[WiseKey ERROR] ${new Date().toISOString()} - ${message}`,
        );
    }
}

export class WiseKey {
    static instance: WiseKey | undefined;
    config: WiseKeyConfig | undefined;
    logger: Logger;
    db: LMDBStore | undefined;
    envPath: string | undefined;
    initialized = false;

    constructor() {
        this.logger = new Logger();
    }

    static async init(
        name: string,
        options?: { mapSize?: number },
    ): Promise<WiseKey> {
        if (!WiseKey.instance) {
            WiseKey.instance = new WiseKey();
            await WiseKey.instance.initialize(name, options);
        }
        if (!WiseKey.instance.initialized) {
            throw new Error('WiseKey initialization failed.');
        }
        return WiseKey.instance;
    }

    async initialize(
        name: string,
        options?: { mapSize?: number },
    ): Promise<void> {
        const mapSize = options?.mapSize ?? DEFAULT_MAP_SIZE;
        const envDir = path.join(os.homedir(), '.wisekey', '.keys', name);
        this.config = { name, path: envDir };
        this.envPath = envDir;
        this.initialized = true;

        // Ensure parent directory exists and is adequately protected
        try {
            const parent = path.dirname(this.config.path);
            if (!fs.existsSync(parent))
                fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
            else {
                try {
                    fs.chmodSync(parent, 0o700);
                } catch {
                    /* ignore */
                }
            }
        } catch {
            // continue and let DB operations report errors
        }

        this.db = open<SecretValue>({
            path: envDir,
            compression: false,
            mapSize,
            maxDbs: 1,
            noMemInit: true,
            name: undefined,
            encoding: 'json',
        }) as unknown as LMDBStore;

        // Tighten DB directory permissions where possible
        try {
            fs.chmodSync(envDir, 0o700);
            const dataFile = path.join(envDir, 'data.mdb');
            if (fs.existsSync(dataFile)) {
                fs.chmodSync(dataFile, 0o600);
            }
            const lockFile = path.join(envDir, 'lock.mdb');
            if (fs.existsSync(lockFile)) {
                fs.chmodSync(lockFile, 0o600);
            }
        } catch {
            // ignore on platforms that don't support POSIX modes
        }

        try {
            const existingKey = await this.getMasterKey();
            if (!existingKey) {
                const newKey = generateMasterKey().toString('hex');
                await this.setMasterKey(newKey);
                this.logger.info(
                    'Generated and stored new Master Key in keychain.',
                );
            }
        } catch (error) {
            throw new KeychainAccessError(
                `Failed to access keychain during initialization: ${error}`,
            );
        }
    }

    async getMasterKey(): Promise<Buffer | null> {
        try {
            const keyHex = await keychain.getPassword(
                this.config!.name,
                this.config!.name,
            );
            return keyHex ? Buffer.from(keyHex, 'hex') : null;
        } catch (error) {
            throw new KeychainAccessError(
                `Failed to retrieve key from keychain: ${error}`,
            );
        }
    }

    async setMasterKey(keyHex: string): Promise<void> {
        try {
            await keychain.setPassword(
                this.config!.name,
                this.config!.name,
                keyHex,
            );
        } catch (error) {
            throw new KeychainAccessError(
                `Failed to store key in keychain: ${error}`,
            );
        }
    }

    async get(keyName: string): Promise<string | null> {
        if (!this.db) throw new Error('Database not initialized');
        const row = this.db.get(keyName);
        if (!row) return null;
        const masterKey = await this.getMasterKey();
        if (!masterKey)
            throw new KeychainAccessError('Master key not found in keychain.');
        return decrypt(row, masterKey);
    }

    async set(keyName: string, value: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        const masterKey = await this.getMasterKey();
        if (!masterKey)
            throw new KeychainAccessError('Master key not found in keychain.');
        const encrypted = encrypt(value, masterKey);
        this.db.putSync(keyName, encrypted);
    }

    async delete(keyName: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        this.db.removeSync(keyName);
    }

    async getAll(): Promise<Record<string, string>> {
        if (!this.db) throw new Error('Database not initialized');
        const masterKey = await this.getMasterKey();
        if (!masterKey)
            throw new KeychainAccessError('Master key not found in keychain.');

        const result: Record<string, string> = {};
        // LMDB cursor iterates in key order (sorted)
        for (const { key, value } of this.db.getRange({})) {
            result[key] = decrypt(value, masterKey);
        }
        return result;
    }

    async rotate(newKeyHex?: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (!newKeyHex) {
            newKeyHex = generateMasterKey().toString('hex');
        }
        // Validate hex string
        if (!/^[0-9a-fA-F]{64}$/.test(newKeyHex)) {
            throw new Error(
                'New master key must be a 64-character hex string (32 bytes).',
            );
        }
        this.logger.info('Starting key rotation process...');
        try {
            const oldMasterKey = await this.getMasterKey();
            if (!oldMasterKey)
                throw new KeychainAccessError('Old master key not found.');
            const newMasterKey = Buffer.from(newKeyHex, 'hex');
            if (newMasterKey.length !== 32) {
                throw new Error(
                    'New master key must be 32 bytes (64 hex characters).',
                );
            }

            // Read all entries first (outside transaction)
            const entries: Array<{ keyName: string; value: SecretValue }> = [];
            for (const { key, value } of this.db.getRange({})) {
                entries.push({ keyName: key, value });
            }

            // Re-encrypt all entries in a single transaction
            this.db.transactionSync(() => {
                for (const entry of entries) {
                    const decryptedValue = decrypt(entry.value, oldMasterKey);
                    const newEncrypted = encrypt(decryptedValue, newMasterKey);
                    this.db!.putSync(entry.keyName, newEncrypted);
                }
            });

            await this.setMasterKey(newKeyHex);
            this.logger.info('Key rotation completed successfully.');
        } catch (error) {
            this.logger.error('Key rotation failed');
            if (
                error instanceof Error &&
                error.message.includes('MDB_MAP_FULL')
            ) {
                throw new MapFullError(
                    `Rotation failed: database map size exceeded. Try increasing mapSize.`,
                );
            }
            throw new RotationFailedError(`Rotation failed: ${error}`);
        }
    }

    close(): void {
        if (this.db) {
            this.db.close();
            this.db = undefined;
        }
        WiseKey.instance = undefined;
        this.initialized = false;
        this.logger.info('WiseKey instance closed and resources released.');
    }

    async destroy(): Promise<void> {
        this.close();
        if (this.envPath && fs.existsSync(this.envPath)) {
            fs.rmSync(this.envPath, { recursive: true, force: true });
            this.logger.info(`WiseKey environment destroyed: ${this.envPath}`);
        }
    }
}
