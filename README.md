# json-chamber-mcp

**Chamber MCP** — seal / open JSON. Slid Phi Labs.

24-hour try, then a **Chamber seat** ($49/mo · $490/yr) on https://www.slidphilabs.com/chamber

No TRU8 engine in this package.

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
| Chamber try | cloak / open | 24 hours free |
| Chamber month | seat | $49 |
| Chamber year | seat | $490 |

Prices live on the site. This README does not invent a $99 or $1,900 SKU.

## Tools

| Tool | Purpose |
|------|--------|
| `chamber_status` | try remaining / dead / purchased |
| `chamber_info` | pointer to live prices |
| `chamber_cloak` | seal JSON / text |
| `chamber_open` | open sealed blob |

## Related

- Python SDK: https://github.com/ceedot-rock/json-chamber-sdk
- Product: https://www.slidphilabs.com/chamber
- Contact: corey@slidphilabs.com
