# WiseKey

A lightweight key management library and CLI for Node.js. Secrets are encrypted with AES-256-GCM and kept in an embedded LMDB store; the encryption key is itself wrapped by a per-service key held separately on disk. No OS keychain, no daemons, no prompts — the same behaviour on Linux, macOS, Windows, containers and CI.

## Features

- **Encrypted at rest**: every value is sealed with AES-256-GCM before it reaches LMDB.
- **Wrapped Master Key**: the key that encrypts your secrets is stored wrapped, and the key that wraps it lives outside the database file — copying the database alone discloses nothing.
- **No platform keyring**: no D-Bus, no Credential Manager, no GNOME Keyring unlock prompts, nothing to install per distribution.
- **Recoverable**: export a service's Master Key for backup, and import it to unlock a service whose wrap key was lost.
- **Key rotation**: rotate the Master Key (re-encrypts everything) or re-wrap it (cheap, touches nothing else).
- **Singleton design**: initialize once and reuse the same instance across your app.
- **TypeScript support**: fully typed API surface.

## Installation

```bash
npm install wisekey
```

Requires Node.js >= 22 (the `lmdb` native dependency is pinned to an exact, prebuilt version).

## Usage

### Initialization

Initialize WiseKey once at application startup. It uses its default storage location automatically.

```typescript
import { WiseKey } from 'wisekey';

const wiseKey = await WiseKey.init('my-app-secrets');
```

The `name` selects the service directory (`~/.wisekey/.keys/<name>`), which owns its own key material: two services never share a key.

### Storing and Retrieving Secrets

```typescript
import { WiseKey } from 'wisekey';

// Note: you must call WiseKey.init() before using the instance elsewhere
const wiseKey = await WiseKey.init('my-app-secrets');

await wiseKey.set('api_key', '<API_KEY_PLACEHOLDER>');
const apiKey = await wiseKey.get('api_key');
await wiseKey.delete('api_key');
const all = await wiseKey.getAll(); // every key, sorted; internals excluded
```

Key names beginning with `.` are reserved for WiseKey's own records and are rejected by `set`, `get` and `delete`; they never appear in `getAll()` or in an export.

### Rotating Keys

Two different operations, deliberately named differently:

```typescript
// Master Key rotation: re-encrypts every secret under a new key (atomic)
await wiseKey.rotate(); // or wiseKey.rotate('<64 hex chars>')

// Wrap Key rotation: re-wraps the Master Key under a fresh wrap key.
// Secrets are not touched, so this is fast and changes no ciphertexts.
await wiseKey.rotateWrapKey();
```

Automatic (scheduled) rotation is not supported; call `rotate()` when you want it.

## Security model

Read this before relying on WiseKey for a high-value secret.

Two secrets protect a service:

| Secret          | Protects                   | Stored in                                             |
| --------------- | -------------------------- | ----------------------------------------------------- |
| Master Key (MK) | every value of the service | inside the service's LMDB database, **wrapped**       |
| Wrap Key (WK)   | the Master Key at rest     | `~/.wisekey/.keys/<name>/wrap/<kid>.key`, mode `0600` |

So the boundary is the **filesystem**, not an OS keystore:

- A copy of `data.mdb` alone is useless — the Master Key inside it is encrypted.
- Anyone who can read both `data.mdb` and `wrap/` can decrypt everything. That includes any process running as you, and anyone with the disk unencrypted and unlocked.
- On POSIX, WiseKey treats a failure to set `700`/`600` on these files as a fatal error (`InsecureEnvironmentError`). On Windows the POSIX bits are not enforced, so protection comes from your user-profile NTFS ACLs.
- Against a same-user attacker or an offline disk, an OS keyring plus full-disk encryption is stronger than this scheme; WiseKey trades that for working everywhere and never trapping your data behind an unlock prompt you cannot answer (which is what `cross-keychain` did on headless RHEL — see `docs/adr/0005-*`).

**Backups.** A service is only recoverable from its whole directory (`data.mdb` + `wrap/`), or from its exported Master Key. Backing up `data.mdb` alone silently loses the service. Export the Master Key to offline storage you trust, and treat it as the root secret it is.

**CI and containers.** Set `WISEKEY_WRAP_KEY` to 64 hex characters to supply the wrap key from the environment instead of a file; WiseKey never writes it to disk. Unsetting it locks the service — that is intended, not corruption.

## CLI Usage

```bash
wisekey <serviceName> load -env [path]   # upsert every pair from a .env file
wisekey <serviceName> load <file.json>   # replace the service with the file's contents
wisekey <serviceName> set <key> <value>  # upsert one key
wisekey <serviceName> set <key> --file <path>  # store a file's utf-8 content (max 1MB)
wisekey <serviceName> get <key>          # print the decrypted value
wisekey <serviceName> export <file>      # all keys to a .env or .json file (owner-only)
wisekey <serviceName> rotate [newKey]    # re-encrypt everything under a new Master Key
```

Service and key names allow `A-Za-z0-9_.-` up to 64 characters; key names may not start with `.`.

### Master Key commands

```bash
wisekey <serviceName> master-key export                  # print the Master Key (hex) to stdout
wisekey <serviceName> master-key export --file <path>    # write it to a new owner-only file
wisekey <serviceName> master-key import <hex> [--force]  # restore it
wisekey <serviceName> master-key import --file <path>
wisekey <serviceName> master-key rotate-wrap             # re-wrap under a fresh Wrap Key
```

Import is the recovery path when the wrap key is lost: the service reports itself locked, initialization still succeeds, and importing the exported Master Key makes the existing secrets readable again. Importing a _different_ key than the one currently in use requires `--force`, because it orphans the secrets encrypted under the old key.

The CLI does not expose secret deletion or service destruction; use the library API for those.

## API Reference

### `WiseKey.init(name: string, options?: { mapSize?: number }): Promise<WiseKey>`

Initializes the singleton instance. Must be called before use. `name` is the service identifier, used as its storage directory name; `mapSize` overrides the 100MB LMDB map size.

### `wiseKey.set(keyName: string, value: string): Promise<void>`

Encrypts and stores a secret. Rejects reserved key names.

### `wiseKey.get(keyName: string): Promise<string | null>`

Retrieves and decrypts a secret. Returns `null` if it does not exist.

### `wiseKey.delete(keyName: string): Promise<void>`

Deletes a secret from the database.

### `wiseKey.getAll(): Promise<Record<string, string>>`

Decrypts every Key of the service, in sorted order. WiseKey's internal records are never included.

### `wiseKey.rotate(newKeyHex?: string): Promise<void>`

Rotates the Master Key and re-encrypts all secrets in a single LMDB transaction. If `newKeyHex` is omitted, a new 32-byte key is generated.

### `wiseKey.rotateWrapKey(): Promise<void>`

Re-wraps the Master Key under a newly generated Wrap Key. Fails if `WISEKEY_WRAP_KEY` supplies the wrap key.

### `wiseKey.getMasterKey(): Promise<Buffer | null>` / `wiseKey.setMasterKey(keyHex: string): Promise<void>`

Read and write the Master Key. `getMasterKey()` returns `null` for a brand-new service and throws if the service is locked.

### `wiseKey.exportMasterKey(): Promise<string | null>` / `wiseKey.importMasterKey(keyHex: string): Promise<void>`

Backup and recovery of the Master Key as 64 hex characters.

### `wiseKey.close(): void`

Closes the database and releases the singleton instance.

### `wiseKey.destroy(): Promise<void>`

Closes and deletes the entire service directory, including its wrap keys. There is no recovery afterwards unless you exported the Master Key.

## Storage layout

```text
~/.wisekey/.keys/<serviceName>/
├── data.mdb        # every Key, AES-256-GCM under the Master Key;
│                   # plus the internal .master record holding the wrapped Master Key
├── lock.mdb        # LMDB lock file
└── wrap/<kid>.key  # 32-byte Wrap Keys, named by their own fingerprint; mode 0600
```

## License

ISC
