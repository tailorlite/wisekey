export interface WiseKeyConfig {
  name: string;
}

export interface EncryptedPayload {
  iv: string;
  content: string;
  tag: string;
}

export interface VaultData {
  [keyName: string]: EncryptedPayload;
}

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
