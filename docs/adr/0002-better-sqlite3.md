# ADR 0002: better-sqlite3 over node:sqlite

Date: 2026-09-08
Status: Superseded by ADR 0003

## Context

`node:sqlite` (DatabaseSync) requires new Node, experimental status. Need compat/stability on Node >=18.

## Decision

Use `better-sqlite3` (sync, prebuilds). Drop-in swap: same file path/schema (`~/.wisekey/.keys/__<name>_`), same `prepare/get/all/run/exec` calls, manual BEGIN/COMMIT/ROLLBACK kept. Keep engines `>=18`.

## Alternatives

- Stay on `node:sqlite` — rejected (compat).
- `node:sqlite` + fallback — rejected (dual-driver complexity).
- better-sqlite3 `transaction()` helper — deferred (keep diff minimal).

## Consequences

- Native dep via prebuilds; file format unchanged, no migration.
- `dependencies: better-sqlite3`, `devDependencies: @types/better-sqlite3`.

## Note

This decision was superseded by ADR 0003 due to Linux build failures with better-sqlite3. The codebase reverted to `node:sqlite` with Node >=22 requirement.
