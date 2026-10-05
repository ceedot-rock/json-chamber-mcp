---
name: chamber
description: Seal and open JSON with an MCP server. Use when an agent needs to store sensitive JSON sealed, open a sealed blob, or gate a hop. Cloak needs a license; open is keys-only.
version: 1.0.0
metadata:
  author: Slid Phi Labs
  repo: https://github.com/ceedot-rock/json-chamber-mcp
---

# Chamber

JSON seal/open as an MCP server. Seal (cloak) new JSON with a license; open an
already-sealed blob with both keys, no extra payment. Ciphertext does not
expire.

## Install (MCP config)

```json
{
  "mcpServers": {
    "json-chamber": {
      "command": "npx",
      "args": ["-y", "json-chamber-mcp"],
      "env": {
        "CHAMBER_MASTER_SECRET": "your-high-entropy-secret"
      }
    }
  }
}
```

Set `CHAMBER_MASTER_SECRET` yourself — never commit it, never share it.

## Tools

| Tool | Purpose |
|------|---------|
| `chamber_status` | cloak trial remaining / dead / purchased |
| `chamber_info` | pointer to live prices |
| `chamber_cloak` | seal JSON or text (needs license) |
| `chamber_open` | open a sealed blob (keys only) |
| `chamber_hop_gate` | admit/reject a hop (gate only) |
| `chamber_hop_reject_log` | live sanitized reject log |

## Pricing

| SKU | What | Price |
|-----|------|-------|
| Chamber try | cloak new JSON | 24 hours free |
| chamber-month | cloak license | $9/mo |
| chamber-year | cloak license | $99/yr |
| Open | already-sealed blob | keys only, no payment |

Live prices: https://www.slidphilabs.com/chamber

## Links

- Repo: https://github.com/ceedot-rock/json-chamber-mcp
- npm: `json-chamber-mcp` (1.2.0)
- Registry id: `io.github.ceedot-rock/json-chamber-mcp`
- Product: https://www.slidphilabs.com/chamber
