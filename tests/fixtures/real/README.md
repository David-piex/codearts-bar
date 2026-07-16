# Sanitized real-shape fixtures

These databases are deterministic reconstructions of schema and field shapes observed in local CodeArts databases on 2026-07-16:

- Desktop `1.3.17`
- CLI `26.5.4`
- CLI `26.5.6`

They do not contain copied user data. Original IDs, titles, directories, prompts, tool input/output, credentials, and error text are not retained. Synthetic values exercise the observed schema plus compatibility aliases, placeholder handling, zero-token errors, completed zero-token responses, interrupted responses, and `step-finish` precedence.

Regenerate or verify them with:

```powershell
node tests/make-real-fixtures.js
node tests/make-real-fixtures.js --check
```

Expected totals and provenance are recorded in `manifest.json`. `tests/real-fixture-cross-client-smoke.js` verifies Desktop, VS Code, JetBrains, and CLI output for both `node:sqlite` and `sql.js`.
