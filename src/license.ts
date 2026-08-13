/**
 * 24-hour hard-cut license for json-chamber-mcp.
 * $99 unlock via VERIFIEDDR_API_KEY containing purchased/pro/live_
 */

import {
  createHmac,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LICENSE_DIR = join(homedir(), ".chamber");
const LICENSE_FILE = join(LICENSE_DIR, "license.json");
const KILL_FILE = join(LICENSE_DIR, "KILLED");

export const EVAL_SECONDS = 86400;
export const PRICE_USD = 99;
export const PURCHASE_URL =
  process.env.CHAMBER_PURCHASE_URL ?? "https://www.slidphilabs.com/chamber";

function masterBytes(): Buffer {
  const raw =
    process.env.CHAMBER_MASTER_SECRET ||
    process.env.JSON_CHAMBER_MASTER ||
    process.env.TRU8_MASTER_SECRET ||
    "chamber-demo-master-secret-32b!!";
  const b = Buffer.from(raw, "utf8");
  return b.length >= 32 ? b : createHash("sha256").update(b).digest();
}

function sign(payload: object): string {
  const msg = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHmac("sha256", masterBytes()).update(msg).digest("hex");
}

function ensureDir(): void {
  if (!existsSync(LICENSE_DIR)) mkdirSync(LICENSE_DIR, { recursive: true });
}

function verifieddrGate(): {
  verified: boolean;
  purchased: boolean;
  reason: string;
} {
  const key = process.env.VERIFIEDDR_API_KEY ?? "";
  if (!key) {
    return {
      verified: true,
      purchased: false,
      reason: "open-source eval (no VERIFIEDDR_API_KEY)",
    };
  }
  const purchased = /purchased|pro|live_/i.test(key);
  return { verified: true, purchased, reason: "ok" };
}

export type LicenseStatus = {
  alive: boolean;
  status: "eval" | "purchased" | "dead";
  reason?: string;
  remaining_sec?: number;
  remaining_hours?: number;
  price?: number;
  purchase_url?: string;
  expires_at?: string;
};

export class LicenseManager {
  private loadOrCreate(): Record<string, unknown> {
    ensureDir();
    if (existsSync(KILL_FILE)) {
      throw new Error("Chamber hard-killed (KILLED marker present)");
    }
    if (existsSync(LICENSE_FILE)) {
      const raw = JSON.parse(readFileSync(LICENSE_FILE, "utf8"));
      const { sig, ...data } = raw;
      const expected = sign(data);
      if (
        !sig ||
        !timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected))
      ) {
        writeFileSync(KILL_FILE, "tamper-sig");
        throw new Error("license signature mismatch – killed");
      }
      return data;
    }
    const now = Math.floor(Date.now() / 1000);
    const lic = {
      type: "eval",
      product: "json-chamber",
      first_run: now,
      eval_expires: now + EVAL_SECONDS,
      purchased: false,
      device_hash: createHash("sha256")
        .update(homedir())
        .digest("hex")
        .slice(0, 16),
    };
    const signed = { ...lic, sig: sign(lic) };
    writeFileSync(LICENSE_FILE, JSON.stringify(signed, null, 2));
    return lic;
  }

  check(): LicenseStatus {
    if (existsSync(KILL_FILE)) {
      return {
        alive: false,
        status: "dead",
        reason: "Chamber hard-killed",
        price: PRICE_USD,
        purchase_url: PURCHASE_URL,
      };
    }
    let lic: Record<string, unknown>;
    try {
      lic = this.loadOrCreate();
    } catch (e) {
      return {
        alive: false,
        status: "dead",
        reason: e instanceof Error ? e.message : String(e),
        price: PRICE_USD,
        purchase_url: PURCHASE_URL,
      };
    }
    const gate = verifieddrGate();
    if (gate.purchased || lic.purchased) {
      return {
        alive: true,
        status: "purchased",
        price: PRICE_USD,
        purchase_url: PURCHASE_URL,
      };
    }
    const now = Math.floor(Date.now() / 1000);
    const expires = Number(lic.eval_expires ?? 0);
    if (now > expires) {
      writeFileSync(KILL_FILE, "expired");
      return {
        alive: false,
        status: "dead",
        reason: `json-chamber 24h eval ended. Price $${PRICE_USD} → ${PURCHASE_URL}`,
        price: PRICE_USD,
        purchase_url: PURCHASE_URL,
      };
    }
    const remaining = Math.max(0, expires - now);
    return {
      alive: true,
      status: "eval",
      remaining_sec: remaining,
      remaining_hours: Math.round((remaining / 3600) * 10) / 10,
      expires_at: new Date(expires * 1000).toISOString(),
      price: PRICE_USD,
      purchase_url: PURCHASE_URL,
    };
  }

  requireAlive(): void {
    const s = this.check();
    if (!s.alive) {
      throw new Error(
        [
          "╔══════════════════════════════════════════════════════╗",
          "║  JSON-CHAMBER BOX SHUT OFF                           ║",
          `║  ${s.reason ?? "License expired"}`,
          `║  Price $${PRICE_USD} one-time → ${PURCHASE_URL}`,
          "║  Set VERIFIEDDR_API_KEY=vdr_purchased_...            ║",
          "╚══════════════════════════════════════════════════════╝",
        ].join("\n")
      );
    }
  }
}
