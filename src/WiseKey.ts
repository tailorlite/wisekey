import { open } from 'lmdb';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    MasterKeyAccessError,
    RotationFailedError,
    WrapKeyUnavailableError,
    MapFullError,
} from './types.js';
import {
    encrypt,
    decrypt,
    generateMasterKey,
    isValidMasterKeyHex,
    keyFingerprint,
} from './crypto-utils.js';
import { hardenDirectory, hardenFile } from './fs-utils.js';
import {
    MASTER_KEY_ENTRY,
    WRAP_KEY_ENV,
    assertStorableKey,
    createWrapKey,
    envWrapKey,
    isReservedKey,
    isWrappedMasterKeyRecord,
    pruneWrapKeys,
    resolveWrapKey,
    unwrapMasterKey,
    wrapMasterKey,
    type WrappedMasterKeyRecord,
} from './master-key.js';

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
    get(key: string): unknown;
    putSync(key: string, value: unknown): void;
    removeSync(key: string): boolean;
    getRange(
        options?: Record<string, unknown>,
    ): IterableIterator<{ key: string; value: unknown }>;
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

        // Key material lives under here, so privacy of the tree is load-bearing.
        hardenDirectory(path.dirname(envDir));
        hardenDirectory(envDir);

        this.db = open<SecretValue>({
            path: envDir,
            compression: false,
            mapSize,
            maxDbs: 1,
            noMemInit: true,
            name: undefined,
            encoding: 'json',
        }) as unknown as LMDBStore;

        hardenFile(path.join(envDir, 'data.mdb'));
        hardenFile(path.join(envDir, 'lock.mdb'));

        try {
            this.ensureMasterKeyRecord();
        } catch (error) {
            if (error instanceof MasterKeyAccessError) throw error;
            throw new MasterKeyAccessError(
                `Failed to establish key material for service "${name}" during initialization: ${error}`,
            );
        }
    }

    /**
     * Create the wrapped Master Key entry on first use. An existing entry that
     * cannot be unlocked (lost or replaced Wrap Key) does not fail
     * initialization: the Service reports itself locked and operations that need
     * the key fail, which leaves `master-key import` a way back in.
     */
    private ensureMasterKeyRecord(): void {
        const record = this.readMasterKeyRecord();
        if (!record) {
            const wrapKey = resolveWrapKey(this.config!.path, null);
            const masterKeyHex = generateMasterKey().toString('hex');
            this.db!.putSync(
                MASTER_KEY_ENTRY,
                wrapMasterKey(masterKeyHex, wrapKey),
            );
            this.logger.info(
                `Generated new Master Key for service "${this.config!.name}", wrapped by Wrap Key ${keyFingerprint(wrapKey)}.`,
            );
            return;
        }
        try {
            unwrapMasterKey(record, resolveWrapKey(this.config!.path, record));
        } catch (error) {
            if (error instanceof MasterKeyAccessError) {
                this.logger.error(
                    `Service "${this.config!.name}" is locked: ${error.message}` +
                        ' Existing Keys are unreadable until the Wrap Key is restored or the Master Key is imported.',
                );
                return;
            }
            throw error;
        }
    }

    private readMasterKeyRecord(): WrappedMasterKeyRecord | null {
        if (!this.db) throw new Error('Database not initialized');
        const value = this.db.get(MASTER_KEY_ENTRY);
        return isWrappedMasterKeyRecord(value) ? value : null;
    }

    /** Wrap Key plus stored record give the Master Key; null for a fresh Service. */
    private unlockMasterKey(): Buffer | null {
        const record = this.readMasterKeyRecord();
        if (!record) return null;
        return unwrapMasterKey(
            record,
            resolveWrapKey(this.config!.path, record),
        );
    }

    /**
     * Wrap Key to store the Master Key under. When the Service's Wrap Key is
     * gone from disk, a fresh one is established: the Master Key (not the Wrap
     * Key) is what encrypts the Keys, so an imported Master Key must still be
     * wrappable. An environment-supplied Wrap Key is never substituted.
     */
    private storageWrapKey(): Buffer {
        const record = this.readMasterKeyRecord();
        try {
            return resolveWrapKey(this.config!.path, record);
        } catch (error) {
            if (error instanceof WrapKeyUnavailableError && !envWrapKey()) {
                const wrapKey = createWrapKey(this.config!.path);
                this.logger.info(
                    `Established new Wrap Key ${keyFingerprint(wrapKey)} for service "${this.config!.name}".`,
                );
                return wrapKey;
            }
            throw error;
        }
    }

    async getMasterKey(): Promise<Buffer | null> {
        return this.unlockMasterKey();
    }

    async setMasterKey(keyHex: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        this.db.putSync(
            MASTER_KEY_ENTRY,
            wrapMasterKey(keyHex, this.storageWrapKey()),
        );
    }

    async get(keyName: string): Promise<string | null> {
        if (!this.db) throw new Error('Database not initialized');
        assertStorableKey(keyName);
        const row = this.db.get(keyName) as SecretValue | undefined;
        if (!row) return null;
        const masterKey = this.unlockMasterKey();
        if (!masterKey)
            throw new MasterKeyAccessError(
                `No Master Key record for service "${this.config!.name}".`,
            );
        return decrypt(row, masterKey);
    }

    async set(keyName: string, value: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        assertStorableKey(keyName);
        const masterKey = this.unlockMasterKey();
        if (!masterKey)
            throw new MasterKeyAccessError(
                `No Master Key record for service "${this.config!.name}".`,
            );
        this.db.putSync(keyName, encrypt(value, masterKey));
    }

    async delete(keyName: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        assertStorableKey(keyName);
        this.db.removeSync(keyName);
    }

    async getAll(): Promise<Record<string, string>> {
        if (!this.db) throw new Error('Database not initialized');
        const masterKey = this.unlockMasterKey();
        if (!masterKey)
            throw new MasterKeyAccessError(
                `No Master Key record for service "${this.config!.name}".`,
            );

        const result: Record<string, string> = {};
        // LMDB cursor iterates in key order (sorted); internals are never exposed
        for (const { key, value } of this.db.getRange({})) {
            if (isReservedKey(key)) continue;
            result[key] = decrypt(value as SecretValue, masterKey);
        }
        return result;
    }

    /** The Master Key of this Service as 64 hex characters, for off-box backup. */
    async exportMasterKey(): Promise<string | null> {
        const masterKey = this.unlockMasterKey();
        return masterKey ? masterKey.toString('hex') : null;
    }

    /**
     * Restore a previously exported Master Key. Use when the Wrap Key is gone but
     * the Secrets in the database were encrypted with that key: after importing,
     * rotate() to re-key and re-wrap everything.
     */
    async importMasterKey(keyHex: string): Promise<void> {
        if (!isValidMasterKeyHex(keyHex)) {
            throw new MasterKeyAccessError(
                'Master key must be a 64-character hex string (32 bytes).',
            );
        }
        await this.setMasterKey(keyHex);
        this.logger.info(
            `Imported Master Key for service "${this.config!.name}".`,
        );
    }

    /**
     * Re-encrypt the Master Key under a fresh Wrap Key. Keys in the database are
     * untouched: the Master Key itself does not change, so this is not rotate().
     */
    async rotateWrapKey(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (envWrapKey()) {
            throw new MasterKeyAccessError(
                `Cannot rotate the Wrap Key while ${WRAP_KEY_ENV} supplies it. Unset the variable first.`,
            );
        }
        const record = this.readMasterKeyRecord();
        if (!record)
            throw new MasterKeyAccessError(
                `No Master Key record for service "${this.config!.name}".`,
            );
        const previousKid = record.kid;
        const masterKeyHex = unwrapMasterKey(
            record,
            resolveWrapKey(this.config!.path, record),
        ).toString('hex');
        // Write the new Wrap Key before pointing the record at it, so a crash
        // leaves the previous (still present) Wrap Key valid.
        const wrapKey = createWrapKey(this.config!.path);
        this.db.putSync(MASTER_KEY_ENTRY, wrapMasterKey(masterKeyHex, wrapKey));
        pruneWrapKeys(this.config!.path, keyFingerprint(wrapKey));
        this.logger.info(
            `Re-wrapped Master Key: Wrap Key ${previousKid} -> ${keyFingerprint(wrapKey)}.`,
        );
    }

    async rotate(newKeyHex?: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (!newKeyHex) {
            newKeyHex = generateMasterKey().toString('hex');
        } else if (!isValidMasterKeyHex(newKeyHex)) {
            throw new Error(
                'New master key must be a 64-character hex string (32 bytes).',
            );
        }
        const newMasterKey = Buffer.from(newKeyHex, 'hex');
        this.logger.info('Starting key rotation process...');
        try {
            const oldMasterKey = this.unlockMasterKey();
            if (!oldMasterKey)
                throw new MasterKeyAccessError(
                    `No Master Key record for service "${this.config!.name}".`,
                );

            // Read all user Keys first (outside transaction); internals stay put.
            const entries: Array<{ keyName: string; value: SecretValue }> = [];
            for (const { key, value } of this.db.getRange({})) {
                if (isReservedKey(key)) continue;
                entries.push({ keyName: key, value: value as SecretValue });
            }

            // Re-encrypt every Key and rewrite the Master Key record atomically:
            // a crash or a full map leaves the Service on the old key.
            const record = this.readMasterKeyRecord();
            const wrapKey = resolveWrapKey(this.config!.path, record);
            const wrappedNewMasterKey = wrapMasterKey(newKeyHex, wrapKey);
            this.db.transactionSync(() => {
                for (const entry of entries) {
                    const decryptedValue = decrypt(entry.value, oldMasterKey);
                    this.db!.putSync(
                        entry.keyName,
                        encrypt(decryptedValue, newMasterKey),
                    );
                }
                this.db!.putSync(MASTER_KEY_ENTRY, wrappedNewMasterKey);
            });

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
