#!/usr/bin/env node
/**
 * json-chamber-mcp — Chamber MCP Server
 * 24h free eval → $99 unlock. Tools: status, info, cloak, open, benefit_check.
 * No TRU8 residual engine.
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
  { name: "json-chamber-mcp", version: "1.1.0" },
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
      description: "Package info, pricing ($99 / $1900), unlock instructions.",
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
      description: "Open a sealed chamber blob. Requires live license.",
      inputSchema: {
        type: "object",
        properties: {
          sealed: { type: "object", description: "Sealed blob from chamber_cloak" },
        },
        required: ["sealed"],
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
            version: "1.1.0",
            product: "json-chamber",
            lab: "Slid Phi Labs",
            pricing: {
              "json-chamber": `$${PRICE_USD} one-time / domain`,
              "tru8-chamber": "$1,900 / project / year (proprietary, not in this package)",
            },
            trial: "24 hours from first run, hard cut, no grace",
            unlock: `Set VERIFIEDDR_API_KEY=vdr_purchased_... after paying $${PRICE_USD}`,
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
      licenseMgr.requireAlive();
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
