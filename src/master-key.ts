import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    encrypt,
    decrypt,
    keyFingerprint,
    isValidMasterKeyHex,
} from './crypto-utils.js';
import { hardenDirectory, writePrivateFile } from './fs-utils.js';
import {
    MasterKeyAccessError,
    ReservedKeyError,
    WrapKeyMismatchError,
    WrapKeyUnavailableError,
} from './types.js';

/**
 * Key material at rest.
 *
 * The Master Key (MK) encrypts every Key of a Service and is stored inside the
 * Service's LMDB, under a reserved entry, wrapped by a Wrap Key (WK). The WK is
 * the only secret kept outside the database: one small file per Service, named
 * by its fingerprint, so copying `data.mdb` alone discloses nothing.
 */

/** LMDB entry holding the wrapped Master Key. Reserved: never a user Key. */
export const MASTER_KEY_ENTRY = '.master';
/** Any Key name starting with this prefix belongs to WiseKey internals. */
export const RESERVED_PREFIX = '.';
/** Directory (inside a Service environment) holding Wrap Key files. */
export const WRAP_KEY_DIR = 'wrap';
/** Overrides the on-disk Wrap Key for headless/CI use: 64 hex characters. */
export const WRAP_KEY_ENV = 'WISEKEY_WRAP_KEY';

const RECORD_VERSION = 1;
const WRAP_ALG = 'aes-256-gcm';
const WRAP_KDF = 'wrap-key';
const WRAP_KEY_BYTES = 32;

export interface WrappedMasterKeyRecord {
    v: number;
    alg: string;
    kdf: string;
    kid: string;
    iv: string;
    content: string;
    tag: string;
}

export function isReservedKey(name: string): boolean {
    return name.startsWith(RESERVED_PREFIX);
}

/** Reject names WiseKey needs for its own bookkeeping. */
export function assertStorableKey(name: string): void {
    if (!name) {
        throw new ReservedKeyError('Key name must not be empty.');
    }
    if (isReservedKey(name)) {
        throw new ReservedKeyError(
            `Key name "${name}" is reserved: names starting with "${RESERVED_PREFIX}" address WiseKey internals and are never returned by getAll().`,
        );
    }
}

export function isWrappedMasterKeyRecord(
    value: unknown,
): value is WrappedMasterKeyRecord {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Partial<WrappedMasterKeyRecord>;
    return (
        record.kid !== undefined &&
        record.iv !== undefined &&
        record.content !== undefined &&
        record.tag !== undefined
    );
}

function wrapKeyPath(envDir: string, kid: string): string {
    return path.join(envDir, WRAP_KEY_DIR, `${kid}.key`);
}

/** Wrap Key supplied through the environment, or null when unset. */
export function envWrapKey(): Buffer | null {
    const raw = process.env[WRAP_KEY_ENV];
    if (raw === undefined || raw === '') return null;
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
        throw new MasterKeyAccessError(
            `${WRAP_KEY_ENV} must be 64 hex characters (32 bytes).`,
        );
    }
    return Buffer.from(raw, 'hex');
}

export function readWrapKey(envDir: string, kid: string): Buffer | null {
    const file = wrapKeyPath(envDir, kid);
    if (!fs.existsSync(file)) return null;
    const key = fs.readFileSync(file);
    if (key.length !== WRAP_KEY_BYTES) {
        throw new WrapKeyUnavailableError(
            `Wrap Key ${file} must contain exactly ${WRAP_KEY_BYTES} bytes.`,
        );
    }
    if (keyFingerprint(key) !== kid) {
        throw new WrapKeyUnavailableError(
            `Wrap Key ${file} does not match its own name. The file was replaced or truncated.`,
        );
    }
    return key;
}

/** Create and persist a new Wrap Key for a Service; returns it. */
export function createWrapKey(envDir: string): Buffer {
    const key = crypto.randomBytes(WRAP_KEY_BYTES);
    const dir = path.join(envDir, WRAP_KEY_DIR);
    hardenDirectory(dir);
    writePrivateFile(wrapKeyPath(envDir, keyFingerprint(key)), key);
    return key;
}

/** Remove Wrap Keys no longer referenced by the stored record. */
export function pruneWrapKeys(envDir: string, keepKid: string): void {
    const dir = path.join(envDir, WRAP_KEY_DIR);
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.key') || entry === `${keepKid}.key`) continue;
        try {
            fs.rmSync(path.join(dir, entry), { force: true });
        } catch {
            /* leftover Wrap Keys are harmless: only the referenced one is read */
        }
    }
}

/**
 * Wrap Key for the given record: from the environment if set, otherwise the
 * file named by the record's kid. A missing record means a fresh Service, so a
 * new Wrap Key is created (unless the environment supplies one).
 */
export function resolveWrapKey(
    envDir: string,
    record: WrappedMasterKeyRecord | null,
): Buffer {
    const fromEnv = envWrapKey();
    if (fromEnv) {
        if (!record) {
            // Env-supplied key material is deliberately never written to disk.
            return fromEnv;
        }
        if (keyFingerprint(fromEnv) === record.kid) return fromEnv;
        if (readWrapKey(envDir, record.kid)) {
            throw new WrapKeyMismatchError(
                `${WRAP_KEY_ENV} does not match Wrap Key ${record.kid}, which is present on disk for this Service.`,
            );
        }
        throw new WrapKeyMismatchError(
            `${WRAP_KEY_ENV} does not match Wrap Key ${record.kid}, and wrap/${record.kid}.key is missing.`,
        );
    }
    if (!record) return createWrapKey(envDir);
    const key = readWrapKey(envDir, record.kid);
    if (!key) {
        throw new WrapKeyUnavailableError(
            `Wrap Key "${record.kid}.key" is missing from ${path.join(envDir, WRAP_KEY_DIR)}. Restore the file, or recover the Service with \`wisekey <service> master-key import\`.`,
        );
    }
    return key;
}

export function wrapMasterKey(
    masterKeyHex: string,
    wrapKey: Buffer,
): WrappedMasterKeyRecord {
    if (!isValidMasterKeyHex(masterKeyHex)) {
        throw new MasterKeyAccessError(
            'Master key must be a 64-character hex string (32 bytes).',
        );
    }
    const payload = encrypt(masterKeyHex, wrapKey);
    return {
        v: RECORD_VERSION,
        alg: WRAP_ALG,
        kdf: WRAP_KDF,
        kid: keyFingerprint(wrapKey),
        ...payload,
    };
}

export function unwrapMasterKey(
    record: WrappedMasterKeyRecord,
    wrapKey: Buffer,
): Buffer {
    if (record.v !== RECORD_VERSION || record.alg !== WRAP_ALG) {
        throw new MasterKeyAccessError(
            `Unsupported Master Key record (v=${record.v}, alg=${record.alg}); this build of WiseKey cannot read it.`,
        );
    }
    if (record.kdf !== WRAP_KDF) {
        throw new MasterKeyAccessError(
            `This Master Key record is protected by "${record.kdf}" and needs a passphrase to unlock.`,
        );
    }
    const kid = keyFingerprint(wrapKey);
    if (kid !== record.kid) {
        throw new WrapKeyMismatchError(
            `Wrap Key fingerprint ${kid} does not match the ${record.kid} this Service was created with. Restore wrap/${record.kid}.key, or check ${WRAP_KEY_ENV}.`,
        );
    }
    try {
        return Buffer.from(decrypt(record, wrapKey), 'hex');
    } catch {
        throw new MasterKeyAccessError(
            `Wrapped Master Key record is corrupt or was not wrapped by ${kid}.`,
        );
    }
}
