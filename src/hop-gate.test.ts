/**
 * Hop-gate tests: each reject code + admit happy path.
 * Wire is exact text (Agent-Rider #17). PCC ≠ payment.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHopGate,
  listRejectLog,
  resetHopGateState,
  payloadHash,
  sanitizeHopInput,
  nextMachineInput,
  formatChamberHopText,
  formatHopGateCode,
  HOP_GATE_CODES,
  CHAMBER_HOP_HEADER,
  type HopGateOptions,
} from "./hop-gate.js";

const fixedNow = () => new Date("2026-09-17T04:00:00.000Z");

function opts(over: HopGateOptions = {}): HopGateOptions {
  return { now: fixedNow, seenNonces: new Set(), ...over };
}

function hop(fields: Record<string, string>, extraLines: string[] = []): string {
  const base = formatChamberHopText(fields);
  if (!extraLines.length) return base;
  return base.replace(/\n$/, "\n") + extraLines.join("\n") + "\n";
}

beforeEach(() => {
  resetHopGateState();
});

describe("hop-gate codes", () => {
  it("exposes exact text string set (Rider #17 + Chamber-local schema)", () => {
    assert.deepEqual([...HOP_GATE_CODES], [
      "admit",
      "reject.schema",
      "reject.extra",
      "reject.hash",
      "reject.replay",
      "reject.agent",
      "reject.empty",
    ]);
    for (const c of HOP_GATE_CODES) {
      assert.equal(formatHopGateCode(c), c);
    }
  });
});

describe("admit happy path", () => {
  it("admits well-formed exact-text ChamberHop", () => {
    const payload = "hello-chamber";
    const text = hop({
      agent_id: "agent-a",
      hop_id: "hop-1",
      nonce: "n-1",
      hash: payloadHash(payload),
      payload,
      schema_id: "hop-v1",
    });
    assert.ok(text.startsWith(CHAMBER_HOP_HEADER));
    const r = evaluateHopGate(text, opts({ allowedAgents: ["agent-a"] }));
    assert.equal(r.code, "admit");
    assert.equal(r.ok, true);
    assert.equal(r.at, "2026-09-17T04:00:00.000Z");
    assert.equal(listRejectLog().length, 0);
  });
});

describe("reject.empty", () => {
  it("rejects null", () => {
    assert.equal(evaluateHopGate(null, opts()).code, "reject.empty");
  });

  it("rejects blank text", () => {
    assert.equal(evaluateHopGate("   \n", opts()).code, "reject.empty");
  });

  it("rejects header-only / missing payload", () => {
    const text = `${CHAMBER_HOP_HEADER}\nagent_id=a\nhop_id=h\n`;
    assert.equal(evaluateHopGate(text, opts()).code, "reject.empty");
  });
});

describe("reject.schema", () => {
  it("rejects wrong kind header (Chamber-local)", () => {
    const text = "CUNI SettleHop\nhop_id=x\njob_id=y\nkey_id=z\n";
    const r = evaluateHopGate(text, opts());
    assert.equal(r.code, "reject.schema");
  });

  it("rejects JSON object that is not exact text when passed as array", () => {
    assert.equal(evaluateHopGate(["nope"], opts()).code, "reject.schema");
  });

  it("rejects malformed kv line", () => {
    const text = `${CHAMBER_HOP_HEADER}\npayload=ok\nnot-a-kv\n`;
    assert.equal(evaluateHopGate(text, opts()).code, "reject.schema");
  });
});

describe("reject.extra", () => {
  it("fail-closed on extra keys; values never rehydrate", () => {
    const text = hop(
      { payload: "ok", hop_id: "h1" },
      ["cuni_extra=evil-blob-should-not-rehydrate", "another=1"]
    );
    const r = evaluateHopGate(text, opts());
    assert.equal(r.code, "reject.extra");
    assert.equal(r.ok, false);

    const log = listRejectLog();
    assert.equal(log.length, 1);
    const preview = log[0].sanitized_preview ?? "";
    assert.ok(preview.includes("cuni_extra"));
    assert.ok(preview.includes("dropped_extra_keys"));
    assert.equal(preview.includes("evil-blob-should-not-rehydrate"), false);

    const next = nextMachineInput(text);
    assert.deepEqual(next, { payload: "ok", hop_id: "h1" });
    assert.equal(
      Object.prototype.hasOwnProperty.call(next, "cuni_extra"),
      false
    );
  });

  it("sanitizeHopInput drops extras from object path", () => {
    const s = sanitizeHopInput({
      payload: "1",
      hop_id: "h",
      CuNiMeta: "x",
    });
    assert.deepEqual(s, { payload: "1", hop_id: "h" });
  });
});

describe("reject.hash", () => {
  it("rejects mismatched hash", () => {
    const text = hop({
      payload: "body",
      hash: "0".repeat(64),
    });
    assert.equal(evaluateHopGate(text, opts()).code, "reject.hash");
  });
});

describe("reject.replay", () => {
  it("rejects reused nonce", () => {
    const seen = new Set<string>();
    const payload = "a";
    const text = hop({
      payload,
      nonce: "same-nonce",
      hash: payloadHash(payload),
    });
    assert.equal(evaluateHopGate(text, opts({ seenNonces: seen })).code, "admit");
    assert.equal(
      evaluateHopGate(text, opts({ seenNonces: seen })).code,
      "reject.replay"
    );
  });

  it("rejects reused hop_id when nonce absent", () => {
    const seen = new Set<string>();
    const payload = "a";
    const text = hop({
      payload,
      hop_id: "hop-dup",
      hash: payloadHash(payload),
    });
    assert.equal(evaluateHopGate(text, opts({ seenNonces: seen })).code, "admit");
    assert.equal(
      evaluateHopGate(text, opts({ seenNonces: seen })).code,
      "reject.replay"
    );
  });
});

describe("reject.agent", () => {
  it("rejects agent not on allowlist", () => {
    const payload = "a";
    const text = hop({
      agent_id: "intruder",
      payload,
      hash: payloadHash(payload),
    });
    assert.equal(
      evaluateHopGate(text, opts({ allowedAgents: ["trusted"] })).code,
      "reject.agent"
    );
  });
});

describe("live reject log", () => {
  it("records rejects; listRejectLog respects limit", () => {
    evaluateHopGate(null, opts());
    evaluateHopGate(`${CHAMBER_HOP_HEADER}\nagent_id=a\n`, opts());
    evaluateHopGate("CUNI Other\nx=1\n", opts());
    const all = listRejectLog();
    assert.equal(all.length, 3);
    assert.ok(all.every((e) => e.code.startsWith("reject.")));
    assert.equal(listRejectLog(1).length, 1);
    assert.equal(listRejectLog(1)[0].code, "reject.schema");
  });
});
