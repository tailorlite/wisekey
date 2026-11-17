# ADR 0005: Protect the Master Key with a per-Service Wrap Key

Date: 2026-10-27
Status: Accepted
Supersedes: part of 0004 (Service layout: the Master Key is no longer held outside the store's own files)

## Context

The previous design stored each Service's Master Key in the OS keystore. On RHEL it was unusable: the native backend (D-Bus Secret Service) finds the login keystore locked, raises an unlock prompt that nobody can answer in an SSH/non-graphical session, and reports `unlock prompt was dismissed`. Because `initialize()` treated any keystore failure as fatal, WiseKey did not merely lose security on that platform — it did not start. The design also had no recovery path at all: a lost keystore entry (OS reinstall, wiped keystore, new machine) left the LMDB data permanently undecryptable, and `rotate()` could not get in to re-key it.

WiseKey is pre-production (ADR 0004), so no on-disk compatibility with keystore-era Services is required.

## Decision

Manage key material ourselves, with two distinct secrets per Service:

- **Master Key (MK)** — 32 random bytes, AES-256-GCM under it for every Key of the Service. Stored _inside_ the Service's LMDB under the internal entry `.master`, wrapped (AES-256-GCM) rather than in the clear.
- **Wrap Key (WK)** — 32 random bytes per Service, stored outside the database as `wrap/<kid>.key` (`kid` = first 4 bytes of its SHA-256, so records can name the key they need), mode `0600`. `WISEKEY_WRAP_KEY` (64 hex) supplies it from the environment instead, for headless/CI use, and is never written to disk.

The record carries `{v, alg, kdf, kid, iv, content, tag}`; `kdf: 'wrap-key'` leaves room for a future passphrase-derived Wrap Key without changing the format. Per-Service Wrap Keys mean one leaked key opens nothing else, and kid-named files make re-wrapping crash-safe: the new file exists before the record points at it, the old one is pruned only afterwards.

Any Key name starting with `.` is an internal entry: rejected by `set`/`get`/`delete`, skipped by `getAll`, `export` and `rotate`. Permissions are now load-bearing, so on POSIX `chmod` failures are fatal (`InsecureEnvironmentError`) instead of silently ignored; on Windows the attempt stays best-effort because POSIX bits are not enforced there.

## Alternatives

- **Keep the OS keystore and force its file backend** — rejected: same security posture as our own file scheme, while keeping a transitive native module and a second secret store (`secrets.json`) duplicating LMDB.
- **Store the Master Key as plain hex in LMDB** — rejected: a copied `data.mdb` would then be a total disclosure, which is precisely how an env-style store leaks in practice.
- **Store the Master Key in a sibling `master.key` file** — rejected: no security gain over the Wrap Key scheme (same parent directory) and it splits Service state across two unmanaged files.
- **Passphrase-derived Wrap Key now** — deferred: it is the only option that resists a full-directory copy, but it makes every unlock interactive. The record format reserves a `kdf` for it.
- **Best-effort import of existing keystore entries** — rejected: pre-production, and the platforms whose keystores are broken are the ones with nothing to import.

## Consequences

- WiseKey works identically on every platform Node runs on; no OS keystore, no first-run prompts, no dependency beyond `lmdb`.
- **Security posture changes and must be stated honestly**: the boundary is now the filesystem. `data.mdb` alone reveals nothing; `data.mdb` _plus_ `wrap/` is a full disclosure. This is weaker than an unlocked OS keystore against a same-user process or an offline disk without full-disk encryption.
- Recovery becomes a supported operation: `master-key export` takes the MK off-box; `master-key import` unlocks a Service whose Wrap Key was lost (initialization no longer fails on a locked Service — it reports the lock and lets the import in).
- Two operations that were previously confusable are now separate: `rotate` re-keys the Secrets, `master-key rotate-wrap` re-keys only the protection of the MK.
- The public error surface is `MasterKeyAccessError`, `WrapKeyMismatchError`, `WrapKeyUnavailableError`, `ReservedKeyError`, `InsecureEnvironmentError`.
- Backing up only `data.mdb` silently loses a Service; the README must say to back up the Service directory or the exported Master Key.