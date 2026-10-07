# Contributing to json-chamber-mcp

Thanks for helping make JSON sealing boring and correct.

## Quick checks

```sh
npm ci
npm run build
npm test
```

`npm test` runs the hop-gate suite (`tsx --test src/hop-gate.test.ts`).
CI runs the same plus a TypeScript build and a license-metadata check
(`package.json` license must match `LICENSE`) on every pull request.

## Ground rules

- Seal/open behavior is unchanged by this pass; the hop-gate is admission
  control only — no billing, no x402, no rehydration of rejected input.
- Wire formats are exact text (Agent-Rider ScanChunk SoT), not JSON. Do not
  "fix" them by inventing a JSON body.
- The reject log is TSV and sanitized (truncate ~120 chars, flatten
  newlines); secret values never appear in it.

## Pull requests

Open a PR using the template. CI must be green. Describe what changed in
one or two sentences and list the tools touched.

## Licensing

json-chamber-mcp is Business Source License 1.1 (see LICENSE). By
contributing you agree your contribution may be distributed under it.
