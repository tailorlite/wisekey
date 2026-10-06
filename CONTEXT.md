# CONTEXT

## Glossary

- Service: named secret store (SQLite DB + keychain master key).
- Key: variable name stored within a Service.
- Load: parse a dotenv file into a Service (upsert).
- Export: decrypt all Keys of a Service to a dotenv file, sorted, quote-when-needed.
- Rotate: re-encrypt a Service under a new master key.
- Set: upsert a single Key in a Service (literal Value, or file content via --file).
- Get: retrieve a single Key value from a Service.
