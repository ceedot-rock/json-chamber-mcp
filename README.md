# json-chamber-mcp

**Chamber MCP** — seal / open JSON. Slid Phi Labs.

Cloak (seal new JSON) needs a live license. Open of an already-sealed blob is both keys, no extra payment. Ciphertext does not expire.

## Install / run

```bash
npx -y json-chamber-mcp
```

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

## Pricing

| SKU | What | Price |
|-----|------|-------|
| Chamber try | cloak new JSON | 24 hours free |
| Chamber month | cloak license | $9 |
| Chamber year | cloak license | $99 |
| Open | already-sealed blob | keys only |

Prices live on https://www.slidphilabs.com/chamber

## Tools

| Tool | Purpose |
|------|--------|
| `chamber_status` | cloak try remaining / dead / purchased |
| `chamber_info` | pointer to live prices |
| `chamber_cloak` | seal JSON / text (licensed) |
| `chamber_open` | open sealed blob (keys only) |

## Related

- Python SDK: https://github.com/ceedot-rock/json-chamber-sdk
- Product: https://www.slidphilabs.com/chamber
- Contact: corey@slidphilabs.com
