# CodeArts Bar Query Protocol v1

The CLI query protocol is the stable integration boundary shared by the desktop app, VS Code extension, JetBrains plugin, and external automation.

## Invocation

```text
codearts-bar query <resource> [options]
```

Resources: `dashboard`, `summary`, `trend`, `analytics`, `models`, `sources`, `sessions`, `requests`, and `diagnostics`.

Pagination options use one-based pages:

```text
--page 1 --page-size 50
```

`requests` additionally accepts `--session-id <id>`.

`sessions` accepts `--search <text>` and applies the search before pagination across session id, title, and directory. Both paged resources accept `--source <id>` when a consumer must keep desktop and CLI records separate.

`analytics` accepts `--start <milliseconds>`, `--end <milliseconds>`, and `--bucket-ms <milliseconds>`. Clients may pass `--bucket-offset-ms <milliseconds>` to align daily buckets with the user's local midnight. When omitted, the CLI derives the offset from the runtime time zone at the range midpoint.

## Envelope

Every command writes one JSON object to stdout:

```json
{
  "protocolVersion": 1,
  "ok": true,
  "requestId": null,
  "generatedAt": 0,
  "data": {},
  "diagnostics": {
    "adapter": "node:sqlite",
    "cache": "hit"
  }
}
```

Failures retain the same envelope, set `ok` to `false`, include a machine-readable error message, and exit with a non-zero status. Consumers must ignore unknown fields and must check `protocolVersion` before interpreting `data`.

## Pagination contract

Paged resources return `page`, `pageSize`, `total`, `hasMore`, and `items`. Page size is bounded by the provider to protect IDE processes from unexpectedly large payloads. An empty page is successful and returns an empty `items` array.

## Compatibility

Additive fields may be introduced without changing the protocol version. Removing or renaming fields, changing field meaning, or changing pagination semantics requires a new protocol version. The legacy `codearts-bar jetbrains` command remains a compatibility alias for `query dashboard`.

## Diagnostics and privacy

Diagnostics are intended for support and health displays. Paths and environment-sensitive values must be redacted or summarized before crossing the client boundary. Clients should display protocol errors without exposing raw command lines or local database paths.
