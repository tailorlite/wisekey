# WiseKey

A lightweight key management library and CLI for Node.js using keychain, and supports manual key rotation.

## Features

- **Secure storage**: Secrets are encrypted with AES-256-GCM before being written to SQLite.
- **Native keychain integration**: The master encryption key is stored with `cross-keychain`.
- **Key rotation**: Supports both manual and scheduled automatic rotation via cron expressions.
- **Singleton design**: Initialize once and reuse the same instance across your app.
- **TypeScript support**: Fully typed API surface.

## Installation

```bash
npm install wisekey
```

## Usage

### Initialization

Initialize WiseKey once in your application startup. It uses WiseKey's default storage location automatically.

```typescript
import { WiseKey } from 'wisekey';

async function bootstrap() {
  const wiseKey = await WiseKey.init('my-app-secrets');

  console.log('WiseKey initialized successfully!');
}

bootstrap();
```

### Storing and Retrieving Secrets

Once initialized, you can store, retrieve, and delete secrets.

```typescript
import { WiseKey } from 'wisekey';

async function manageSecrets() {
  // Get the initialized instance
  // Note: You must call WiseKey.init() before using it elsewhere
  const wiseKey = await WiseKey.init('my-app-secrets');

  // Store a secret
  await wiseKey.set('api_key', '<API_KEY_PLACEHOLDER>');
  console.log('Secret stored.');

  // Retrieve a secret
  const apiKey = await wiseKey.get('api_key');
  console.log('Retrieved API Key:', apiKey);

  // Delete a secret
  await wiseKey.delete('api_key');
  console.log('Secret deleted.');
}
```

### Key Rotation

WiseKey allows you to rotate the master encryption key. When rotated, all stored secrets are decrypted with the old key and re-encrypted with the new key, and the new master key is saved to the OS keychain.

#### Manual Rotation

You can trigger a rotation manually at any time. You can optionally provide a new 32-byte hex string, or let WiseKey generate a secure one automatically.

```typescript
import { WiseKey } from 'wisekey';

async function rotateManually() {
  const wiseKey = await WiseKey.init('my-app-secrets');

  console.log('Starting manual rotation...');
  await wiseKey.rotate(); // Automatically generates a new master key
  console.log('Rotation complete!');
}
```

#### Automatic Rotation
WiseKey no longer supports automatic rotation. Use `wiseKey.rotate()` when you want to rotate the master key manually.

## CLI Usage

WiseKey also provides a command-line interface for loading secrets from a `.env` file and rotating the master key for a service.

### Load a .env file

Import key-value pairs from a `.env` file into a service:

```bash
wisekey <serviceName> load -env [path]
```

If `path` is omitted, WiseKey uses `.env` in the current working directory.

### Rotate the master key

Rotate the master key for a service from the CLI:

```bash
wisekey <serviceName> rotate [newKey]
```

If `newKey` is omitted, WiseKey generates a new secure master key automatically.

The CLI does not expose secret read, write, delete, or service deletion commands. Use the library API for those operations.

## API Reference

### `WiseKey.init(name: string, options?: WiseKeyInitOptions): Promise<WiseKey>`
Initializes the WiseKey instance. Must be called at least once before using the instance.
- `name`: `string` - The identifier used to store the master key in the OS keychain.

### `wiseKey.set(keyName: string, value: string): Promise<void>`
Encrypts and stores a secret.

### `wiseKey.get(keyName: string): Promise<string | null>`
Retrieves and decrypts a secret. Returns `null` if the secret does not exist.

### `wiseKey.delete(keyName: string): Promise<void>`
Deletes a secret from the database.

### `wiseKey.rotate(newKeyHex?: string): Promise<void>`
Rotates the master encryption key. Re-encrypts all stored secrets. If `newKeyHex` is not provided, a new secure key is generated automatically.

### `wiseKey.close(): void`
Closes the database and releases the singleton instance.

## License

ISC
