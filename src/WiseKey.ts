import { DatabaseSync } from 'node:sqlite';
import * as keychain from 'cross-keychain';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  WiseKeyConfig,
  KeychainAccessError,
  RotationFailedError,
} from './types.js';
import { encrypt, decrypt, generateMasterKey } from './crypto-utils.js';

class Logger {
  info(message: string) {
    console.log(`[WiseKey INFO] ${new Date().toISOString()} - ${message}`);
  }
  error(message: string) {
    console.error(`[WiseKey ERROR] ${new Date().toISOString()} - ${message}`);
  }
}

export class WiseKey {
  private static instance: WiseKey;
  private config!: WiseKeyConfig & { path: string };
  private logger: Logger;
  private db!: DatabaseSync;
  private initialized = false;

  private constructor() {
    this.logger = new Logger();
  }

  public static async init(name: string): Promise<WiseKey> {
    if (!WiseKey.instance) {
      WiseKey.instance = new WiseKey();
      await WiseKey.instance.initialize(name);
    }
    if (!WiseKey.instance.initialized) {
      throw new Error('WiseKey initialization failed.');
    }
    return WiseKey.instance;
  }

  private async initialize(name: string) {
    const dbPath = path.join(os.homedir(), '.wisekey', '.keys', `__${name}_`);

    this.config = { name, path: dbPath };
    this.initialized = true;

    // Ensure parent directory exists and is adequately protected
    try {
      const parent = path.dirname(this.config.path!);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      else {
        try { fs.chmodSync(parent, 0o700); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // continue and let DB operations report errors
    }

    this.db = new DatabaseSync(this.config.path!);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        keyName TEXT PRIMARY KEY,
        iv TEXT NOT NULL,
        content TEXT NOT NULL,
        tag TEXT NOT NULL
      )
    `);

    // Tighten DB file permissions where possible
    try {
      fs.chmodSync(this.config.path!, 0o600);
    } catch (e) {
      // ignore on platforms that don't support POSIX modes
    }

    try {
      const existingKey = await this.getMasterKey();
      if (!existingKey) {
        const newKey = generateMasterKey().toString('hex');
        await this.setMasterKey(newKey);
        this.logger.info('Generated and stored new Master Key in keychain.');
      }
    } catch (error) {
      throw new KeychainAccessError(`Failed to access keychain during initialization: ${error}`);
    }

  }

  private async getMasterKey(): Promise<Buffer | null> {
    try {
      const keyHex = await keychain.getPassword(this.config.name, this.config.name);
      return keyHex ? Buffer.from(keyHex, 'hex') : null;
    } catch (error) {
      throw new KeychainAccessError(`Failed to retrieve key from keychain: ${error}`);
    }
  }

  private async setMasterKey(keyHex: string): Promise<void> {
    try {
      await keychain.setPassword(this.config.name, this.config.name, keyHex);
    } catch (error) {
      throw new KeychainAccessError(`Failed to store key in keychain: ${error}`);
    }
  }

  public async get(keyName: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT iv, content, tag FROM secrets WHERE keyName = ?');
    const row = stmt.get(keyName) as { iv: string, content: string, tag: string } | undefined;
    if (!row) return null;

    const masterKey = await this.getMasterKey();
    if (!masterKey) throw new KeychainAccessError('Master key not found in keychain.');

    return decrypt(row, masterKey);
  }

  public async set(keyName: string, value: string): Promise<void> {
    const masterKey = await this.getMasterKey();
    if (!masterKey) throw new KeychainAccessError('Master key not found in keychain.');

    const encrypted = encrypt(value, masterKey);
    const stmt = this.db.prepare(`
      INSERT INTO secrets (keyName, iv, content, tag)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(keyName) DO UPDATE SET
        iv = excluded.iv,
        content = excluded.content,
        tag = excluded.tag
    `);
    stmt.run(keyName, encrypted.iv, encrypted.content, encrypted.tag);
  }

  public async delete(keyName: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM secrets WHERE keyName = ?');
    stmt.run(keyName);
  }

  public async rotate(newKeyHex?: string): Promise<void> {
    if (!newKeyHex) {
      newKeyHex = generateMasterKey().toString('hex');
    }
    // Validate hex string
    if (!/^[0-9a-fA-F]{64}$/.test(newKeyHex)) {
      throw new Error('New master key must be a 64-character hex string (32 bytes).');
    }
    this.logger.info('Starting key rotation process...');
    try {
      const oldMasterKey = await this.getMasterKey();
      if (!oldMasterKey) throw new KeychainAccessError('Old master key not found.');

      const newMasterKey = Buffer.from(newKeyHex, 'hex');
      if (newMasterKey.length !== 32) {
        throw new Error('New master key must be 32 bytes (64 hex characters).');
      }

      const stmt = this.db.prepare('SELECT keyName, iv, content, tag FROM secrets');
      const rows = stmt.all() as { keyName: string, iv: string, content: string, tag: string }[];

      const updates = rows.map(row => {
        const decryptedValue = decrypt({ iv: row.iv, content: row.content, tag: row.tag }, oldMasterKey);
        const newEncrypted = encrypt(decryptedValue, newMasterKey);
        return { keyName: row.keyName, ...newEncrypted };
      });

      const updateStmt = this.db.prepare('UPDATE secrets SET iv = ?, content = ?, tag = ? WHERE keyName = ?');
      this.db.exec('BEGIN TRANSACTION');
      try {
        for (const update of updates) {
          updateStmt.run(update.iv, update.content, update.tag, update.keyName);
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }

      await this.setMasterKey(newKeyHex);

      this.logger.info('Key rotation completed successfully.');
    } catch (error) {
      this.logger.error('Key rotation failed');
      throw new RotationFailedError(`Rotation failed: ${error}`);
    }
  }

  public close(): void {
    this.db.close();
    WiseKey.instance = undefined as unknown as WiseKey;
    this.initialized = false;
    this.logger.info('WiseKey instance closed and resources released.');
  }
}
