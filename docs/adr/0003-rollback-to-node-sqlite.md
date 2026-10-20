# ADR 0003: Rollback to node:sqlite from better-sqlite3

Date: 2026-09-08
Status: Superseded by ADR 0004
Supersedes: 0002

## Context

ADR 0002 adopted `better-sqlite3` for Node >=18 compatibility. However, `better-sqlite3` had build failures on Linux (missing prebuilds for current Node versions), causing CI/install failures.

## Decision

Revert to `node:sqlite` (DatabaseSync) with `engines: node >=22`. This is the current implementation.

- No code changes needed — the rollback was already done in code.
- Drop `better-sqlite3` and `@types/better-sqlite3` dependencies.
- Require Node >=22 (already in package.json).

## Alternatives

- Stay on `better-sqlite3` — rejected (Linux build failures).
- Use `node:sqlite` with fallback — rejected (complexity, no longer needed with Node >=22).

## Consequences

- Requires Node >=22 (experimental SQLite support).
- Zero native dependencies.
- File format unchanged, no migration needed.
