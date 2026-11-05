export class DecryptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DecryptionError';
    }
}
export class MasterKeyAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MasterKeyAccessError';
    }
}
export class WrapKeyMismatchError extends MasterKeyAccessError {
    constructor(message: string) {
        super(message);
        this.name = 'WrapKeyMismatchError';
    }
}
export class WrapKeyUnavailableError extends MasterKeyAccessError {
    constructor(message: string) {
        super(message);
        this.name = 'WrapKeyUnavailableError';
    }
}
export class ReservedKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReservedKeyError';
    }
}
export class InsecureEnvironmentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InsecureEnvironmentError';
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
