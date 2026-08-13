# json-chamber-mcp

**Chamber MCP server** — seal / open JSON with φ-split keyword shares + `benefit_check`.

24-hour free evaluation · **$99** permanent unlock · Slid Phi Labs

No TRU8 residual engine in this package. That is the separate **$1,900 / project / year** tier.

## Install / run

```bash
npx -y json-chamber-mcp
npm install && npm run build && node dist/index.js
```

Claude Desktop / Cursor:

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

Unlock: `VERIFIEDDR_API_KEY=vdr_purchased_live_...`

## Pricing

| SKU | What | Price |
|-----|------|-------|
| **json-chamber** (this MCP) | Seal / open + benefit_check | **$99** one-time / domain |
| **tru8-chamber** | TRU8 engine + chamber | **$1,900** / project / year |

## Tools

| Tool | License? | Purpose |
|------|----------|--------|
| `chamber_status` | No | Eval remaining / dead / purchased |
| `chamber_info` | No | Pricing + unlock instructions |
| `benefit_check` | No | Entropy + bias → advertise $1900? |
| `chamber_cloak` | Yes | Seal JSON / text |
| `chamber_open` | Yes | Open sealed blob |

## Related

- Python SDK: https://github.com/ceedot-rock/json-chamber-sdk
- Format Spec: https://github.com/ceedot-rock/json-chamber-sdk/blob/main/CHAMBER-FORMAT-v1.md
- Product: https://www.slidphilabs.com/chamber
- Contact: corey@slidphilabs.com
