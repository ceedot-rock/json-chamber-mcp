#!/usr/bin/env node
/**
 * json-chamber-mcp — Chamber MCP Server
 * Cloak needs a live license (24h try, then $9/mo · $99/yr).
 * Open is both keys, no extra payment. Ciphertext does not expire.
 */

import { createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { LicenseManager, PRICE_USD, PURCHASE_URL } from "./license.js";
import {
  chamberSeal,
  chamberOpen,
  benefitCheck,
  type SealedBlob,
} from "./chamber.js";
import {
  evaluateHopGate,
  listRejectLog,
  type HopGateOptions,
} from "./hop-gate.js";

const licenseMgr = new LicenseManager();

function getMaster(): Buffer {
  const raw =
    process.env.CHAMBER_MASTER_SECRET ||
    process.env.JSON_CHAMBER_MASTER ||
    process.env.TRU8_MASTER_SECRET ||
    "chamber-demo-master-secret-32b!!";
  const b = Buffer.from(raw, "utf8");
  return b.length >= 32 ? b : createHash("sha256").update(b).digest();
}

const server = new Server(
  { name: "json-chamber-mcp", version: "1.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "chamber_status",
      description: "License status: eval remaining hours, purchased, or dead.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "chamber_info",
      description: "Package info, cloak license ($9/mo · $99/yr), open is keys-only.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "chamber_cloak",
      description: "Seal JSON/text with φ-split + AES-256-GCM. Requires live license.",
      inputSchema: {
        type: "object",
        properties: {
          data: { type: "string", description: "JSON string or plain text" },
          is_json: { type: "boolean", description: "Validate as JSON (default true)" },
        },
        required: ["data"],
      },
    },
    {
      name: "chamber_open",
      description: "Open a sealed chamber blob. Keys only — no license, no clock.",
      inputSchema: {
        type: "object",
        properties: {
          sealed: { type: "object", description: "Sealed blob from chamber_cloak" },
        },
        required: ["sealed"],
      },
    },
    {
      name: "chamber_hop_gate",
      description:
        "Evaluate Chamber hop-gate (exact-text codes). Gate only — does not seal/open/SettleHop. " +
        "Wire: CUNI ChamberHop + key=value lines. PCC ≠ payment. Extras fail-closed.",
      inputSchema: {
        type: "object",
        properties: {
          hop: {
            type: "string",
            description:
              "Exact-text CUNI ChamberHop wire (not JSON). Extra keys → reject.extra (do not bind).",
          },
          allowed_agents: {
            type: "array",
            items: { type: "string" },
            description: "Optional agent allowlist",
          },
        },
        required: ["hop"],
      },
    },
    {
      name: "chamber_hop_reject_log",
      description:
        "Live hop-gate reject log (sanitized). Extra-key values never rehydrate as next input.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max recent entries (optional)" },
        },
      },
    },
    {
      name: "benefit_check",
      description: "Entropy + bias gate for $1900 tier. Always available. No TRU8.",
      inputSchema: {
        type: "object",
        properties: {
          data: { type: "string", description: "UTF-8 text or base64 binary" },
          encoding: { type: "string", enum: ["utf8", "base64"] },
        },
        required: ["data"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    if (name === "chamber_status") {
      return {
        content: [{ type: "text", text: JSON.stringify(licenseMgr.check(), null, 2) }],
      };
    }
    if (name === "chamber_info") {
      const st = licenseMgr.check();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            package: "json-chamber-mcp",
            version: "1.2.0",
            product: "json-chamber",
            lab: "Slid Phi Labs",
            pricing: {
              cloak_month: "$9 / month",
              cloak_year: "$99 / year",
              open: "keys only — no extra payment",
            },
            trial: "24 hours of cloak from first run. Open stays keys-only after that.",
            unlock: `Pay a cloak license at ${PURCHASE_URL}, then set VERIFIEDDR_API_KEY=vdr_purchased_...`,
            purchase_url: PURCHASE_URL,
            python_sdk: "https://github.com/ceedot-rock/json-chamber-sdk",
            license_status: st,
          }, null, 2),
        }],
      };
    }
    if (name === "benefit_check") {
      const dataStr = String(a.data ?? "");
      const enc = a.encoding === "base64" ? "base64" : "utf8";
      const buf = enc === "base64" ? Buffer.from(dataStr, "base64") : Buffer.from(dataStr, "utf8");
      return {
        content: [{ type: "text", text: JSON.stringify(benefitCheck(buf), null, 2) }],
      };
    }
    if (name === "chamber_cloak") {
      licenseMgr.requireAlive();
      const dataStr = String(a.data ?? "");
      if (a.is_json !== false) {
        try { JSON.parse(dataStr); } catch {
          throw new Error("data is not valid JSON (set is_json=false for plain text)");
        }
      }
      const sealed = chamberSeal(Buffer.from(dataStr, "utf8"), getMaster());
      return {
        content: [{ type: "text", text: JSON.stringify(sealed, null, 2) }],
      };
    }
    if (name === "chamber_open") {
      const sealed = a.sealed as SealedBlob;
      if (!sealed || typeof sealed !== "object") throw new Error("sealed object required");
      const opened = chamberOpen(sealed, getMaster());
      const text = opened.toString("utf8");
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* plain */ }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, data: parsed }, null, 2) }],
      };
    }
    if (name === "chamber_hop_gate") {
      const hop = a.hop;
      const allowed = Array.isArray(a.allowed_agents)
        ? (a.allowed_agents as string[])
        : undefined;
      const gateOpts: HopGateOptions = allowed ? { allowedAgents: allowed } : {};
      const result = evaluateHopGate(hop, gateOpts);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        ...(result.ok ? {} : { isError: true }),
      };
    }
    if (name === "chamber_hop_reject_log") {
      const limit =
        typeof a.limit === "number" ? a.limit : undefined;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(listRejectLog(limit), null, 2),
        }],
      };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
