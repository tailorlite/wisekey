# ADR 0004: Pinned lmdb 3.0.13 as storage engine

Date: 2026-10-20
Status: Accepted
Supersedes: 0001, 0002, 0003

## Context

The storage engine moved from SQLite (ADRs 0001–0003) to LMDB in the 1.0.22 development builds, on `lmdb: ^3.5.7`. lmdb 3.5.x can fail its native build/install on some platforms (node-gyp errors, missing prebuilds for the target Node ABI/OS) — the same class of failure that killed `better-sqlite3` in ADR 0003. lmdb 3.0.13 ships prebuilt binaries covering more platforms and is a known-good version. WiseKey has not launched to production, so no on-disk compatibility with earlier dev builds is required.

## Decision

Pin the dependency to exactly `"lmdb": "3.0.13"` (no range) and release as 1.1.0, signaling "the lmdb release". The LMDB environment lives at `~/.wisekey/.keys/<name>`; each Key maps to an encrypted `{iv, content, tag}` payload stored as JSON.

The sync API surface is `get`/`putSync`/`removeSync`/`getRange`/`transactionSync` (3.0.13 has no `getSync`; reads use plain `get`).

## Alternatives

- Stay on `lmdb ^3.5.7` — rejected (native build/prebuild failures on target platforms).
- `~3.0.13` or `^3.0.13` ranges — rejected (a secret store should use an audited, exact version; ranges permit drift back into broken builds).
- Keep SQLite (`node:sqlite`) — rejected (LMDB's sorted cursor iteration and single-writer transactional rotate are a better fit, and the switch was already made in code).

## Consequences

- Governance of SQLite-based ADRs 0001–0003 ends here; the export/load command semantics of 0001 remain valid practice, but its SQLite storage context is superseded.
- Exact pin requires a deliberate dependency bump to receive any lmdb fixes.
- No migration needed: nothing shipped to production; dev-era `~/.wisekey` environments are disposable.
- package.json keyword `sqlite` → `lmdb`; glossary Service definition updated to "LMDB store".
