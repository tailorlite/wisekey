import crypto from 'crypto';
import { DecryptionError } from './types.js';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
export function generateMasterKey(): Buffer {
    return crypto.randomBytes(32);
}
export function encrypt(text: string, key: Buffer): { iv: string; content: string; tag: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
        iv: iv.toString('hex'),
        content: encrypted,
        tag: tag.toString('hex'),
    };
}
export function decrypt(
    payload: { iv: string; content: string; tag: string },
    key: Buffer
): string {
    try {
        const iv = Buffer.from(payload.iv, 'hex');
        const tag = Buffer.from(payload.tag, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(payload.content, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        throw new DecryptionError('Failed to decrypt payload. Invalid key or corrupted data.');
    }
}
