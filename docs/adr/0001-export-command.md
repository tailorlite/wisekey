# ADR 0001: export command

Date: 2026-09-08
Status: Accepted

## Context

Need `wisekey <service> export <file>` to dump secrets to dotenv.

## Decision

- Filename required; fail if target exists (no silent overwrite).
- Sorted `KEY=value`, quote-when-needed with `\`, `"`, newline escaping; empty values bare; empty service writes empty file.
- New `WiseKey.getAll()`; `export` reserved as service name; output file chmod 600.

## Alternatives

- Optional filename defaulting to `.env` — rejected per grill (explicit beats symmetry).
- Silent overwrite / merge — rejected (leak/overwrite risk).
- Error on empty service — rejected (user chose empty file).

## Consequences

- Round-trips with `load`; safe, deterministic output.
