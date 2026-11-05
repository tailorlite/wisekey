import fs from 'fs';
import { InsecureEnvironmentError } from './types.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/** Windows has no POSIX permission bits; NTFS ACLs are the real boundary there. */
const POSIX = process.platform !== 'win32';

function describe(error: unknown, target: string, want: string): never {
    throw new InsecureEnvironmentError(
        `Cannot secure ${target} as ${want} on this platform: ${error}. ` +
            'WiseKey keeps key material in this location, so unprotected ' +
            'permissions are treated as a fatal error.',
    );
}

/**
 * Ensure a directory exists and is private to the owning user.
 * On POSIX a failure to reach mode 700 is fatal; on Windows the attempt is
 * best-effort because permission bits are not enforced there.
 */
export function hardenDirectory(dir: string): void {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
        }
        if (POSIX) {
            fs.chmodSync(dir, DIR_MODE);
            const mode = fs.statSync(dir).mode & 0o777;
            if (mode !== DIR_MODE) {
                throw new Error(`mode is ${mode.toString(8)}, want 700`);
            }
        } else {
            try {
                fs.chmodSync(dir, DIR_MODE);
            } catch {
                /* best effort */
            }
        }
    } catch (error) {
        if (error instanceof InsecureEnvironmentError) throw error;
        describe(error, `directory ${dir}`, 'mode 700');
    }
}

/** Ensure a file holding secret material is readable/writable by its owner only. */
export function hardenFile(file: string): void {
    if (!fs.existsSync(file)) return;
    try {
        if (POSIX) {
            fs.chmodSync(file, FILE_MODE);
            const mode = fs.statSync(file).mode & 0o777;
            if (mode !== FILE_MODE) {
                throw new Error(`mode is ${mode.toString(8)}, want 600`);
            }
        } else {
            try {
                fs.chmodSync(file, FILE_MODE);
            } catch {
                /* best effort */
            }
        }
    } catch (error) {
        if (error instanceof InsecureEnvironmentError) throw error;
        describe(error, `file ${file}`, 'mode 600');
    }
}

/** Write secret material to a new file that is private from the moment it exists. */
export function writePrivateFile(file: string, data: Buffer): void {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
        fs.writeFileSync(tmp, data, { mode: FILE_MODE });
        hardenFile(tmp);
        fs.renameSync(tmp, file);
        hardenFile(file);
    } catch (error) {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            /* ignore cleanup failure */
        }
        if (error instanceof InsecureEnvironmentError) throw error;
        describe(error, `file ${file}`, 'mode 600');
    }
}

export function isPosixPlatform(): boolean {
    return POSIX;
}
