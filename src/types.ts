export class DecryptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DecryptionError';
    }
}
export class KeychainAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KeychainAccessError';
    }
}
export class RotationFailedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RotationFailedError';
    }
}

export class LMDBError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LMDBError';
    }
}

export class MapFullError extends LMDBError {
    constructor(message: string) {
        super(message);
        this.name = 'MapFullError';
    }
}

export class CorruptedDatabaseError extends LMDBError {
    constructor(message: string) {
        super(message);
        this.name = 'CorruptedDatabaseError';
    }
}
