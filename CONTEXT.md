# WiseKey

A context for holding an application's Secrets: named stores, each with its own key material, plus the commands that move Secrets and key material in and out.

## Language

**Service**:
A named store of Secrets belonging to one application, together with the key material that protects it. Each Service is independent: knowing one Service's keys discloses nothing about another.
_Avoid_: profile, namespace, database

**Key**:
A named Secret held inside a Service. Its name is user-visible and must not begin with the reserved prefix.
_Avoid_: variable, entry, secret name

**Secret**:
The value held under a Key. Sensitive by definition; never logged.
_Avoid_: credential, token, config value

**Master Key (MK)**:
The key that encrypts every Key of a Service. Rotating it re-encrypts the Service.
_Avoid_: data key, root key, OS keystore key

**Wrap Key (WK)**:
The per-Service secret that protects the Master Key at rest. It is deliberately kept apart from the encrypted Secrets so that the Secrets alone are worthless.
_Avoid_: KEK, password, salt, secondary key

**Re-wrap**:
Replace the Wrap Key while leaving the Master Key and every Secret untouched. Cheap and routine; not a rotation.
_Avoid_: rotate, re-key

**Rotate**:
Re-encrypt every Key of a Service under a new Master Key, then replace the Master Key.
_Avoid_: re-wrap, refresh

**Lock**:
A Service is locked when its Master Key cannot be unwrapped — the Wrap Key is gone, replaced, or supplied by the wrong source. Its Secrets remain intact but unreadable until unlocked.
_Avoid_: corrupt, broken, expired

**Internal Entry**:
A record WiseKey keeps in a Service for its own bookkeeping, addressed by a name with the reserved prefix. Never a Key: it is never listed, exported, or settable as a Secret.

**Backup / Restore (Master Key)**:
Taking the Master Key off-box as text, and putting it back to unlock a locked Service. Moves key material, unlike Export, which moves Secrets.
_Avoid_: export/import (unqualified), dump

**Load**:
Parse a dotenv or JSON file into a Service (upsert).
_Avoid_: import (reserved for key material), ingest

**Export**:
Decrypt all Keys of a Service to a dotenv or JSON file, sorted, quote-when-needed. Internal Entries are never included.
_Avoid_: dump, save

**Set**:
Upsert a single Key in a Service (literal value, or file content via --file).
_Avoid_: put, write

**Get**:
Retrieve a single Key value from a Service.
_Avoid_: read, fetch
