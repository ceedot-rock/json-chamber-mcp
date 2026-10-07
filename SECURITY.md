# Security Policy

json-chamber-mcp seals and opens JSON. A bug that lets the wrong key open a
sealed blob, lets an unlicensed caller cloak, or lets a rejected hop admit
itself is a security issue, not a normal bug.

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Use GitHub's private vulnerability reporting on this repository
  (Security tab, "Report a vulnerability")
- Or email: corey@slidphilabs.com with the subject line `json-chamber-mcp security`

Include the affected tool or file (e.g. `chamber_cloak`, `chamber_hop_gate`,
`src/license.ts`), steps or inputs to reproduce, and what you expected
versus what happened.

You can expect an acknowledgement within 3 business days. We will keep you
updated while we investigate and credit you in the changelog unless you
prefer to stay anonymous.

## In scope

- Seal/open correctness: any key that opens a blob it should not, or a key
  that fails to open a blob it should
- License bypass: cloak working on a machine past its 24-hour evaluation or
  without a paid unlock
- Hop-gate bypass: a malformed or replayed ScanChunk that gets `admit`
- Secret leakage: anything that exposes `CHAMBER_MASTER_SECRET` or key
  material in logs, errors, or the reject log
- The `json-chamber-mcp` npm package and this MCP server

## Out of scope

- Operator deployments we do not run
- Social engineering, spam, or denial-of-service against hosted demos
