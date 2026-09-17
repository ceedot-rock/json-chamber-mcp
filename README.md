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

## Discovery

| Surface | URL |
|---------|-----|
| Official registry id | `io.github.ceedot-rock/json-chamber-mcp` |
| Lab well-known | https://www.slidphilabs.com/.well-known/mcp.json |
| Lab llms.txt | https://www.slidphilabs.com/llms.txt |
| npm | `json-chamber-mcp` 1.2.0 |
| Server schema | [`server.json`](server.json) |
| Product | https://www.slidphilabs.com/chamber |

Hosted lab MCP (PCC + catalog): `POST https://www.slidphilabs.com/mcp` · Smithery: https://smithery.ai/servers/slidphi/lab

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
| `chamber_hop_gate` | admit/reject hop (gate only) |
| `chamber_hop_reject_log` | live sanitized reject log |


## Hop-gate (ScanChunk / Rider SoT)

Admission layer in front of seal/open. **Seal/open APIs are unchanged.** No SettleHop / x402.

Wire is **exact text** (Agent-Rider `agent-rider-c` / PR #22), not JSON:

```
CUNI ScanChunk
url=https://example.com/
etag="abc"
hash=sha256:…
agent_id=agt_1
```

Fields (allowlist): `url` · `etag` · `hash` · `agent_id`. Gate **result wire** is a single exact-text code string (not a JSON body).

| Code | Meaning |
|------|---------|
| `admit` | hop allowed |
| `reject.schema` | Chamber-local only (Rider does not emit) |
| `reject.extra` | unknown keys or wrong kind — fail-closed; do not bind; never rehydrate |
| `reject.hash` | empty / invalid hash |
| `reject.replay` | **hash** already seen |
| `reject.agent` | agent allowlist fail |
| `reject.empty` | empty / missing required fields (`url`, `hash`, `agent_id`) |

Live `reject.log` is TSV `ISO\tcode\tpreview` (mirrors `agent-rider-c/reject.log`); preview truncates ~120 and flattens newlines. Extra-key **values** never rehydrate as next machine input.

**PCC ≠ payment** — PCC is the compression/storefront face; hop-gate codes are admission control, not billing.

MCP tools: `chamber_hop_gate`, `chamber_hop_reject_log`.

## Related

- Python SDK: https://github.com/ceedot-rock/json-chamber-sdk
- Product: https://www.slidphilabs.com/chamber
- Contact: corey@slidphilabs.com
