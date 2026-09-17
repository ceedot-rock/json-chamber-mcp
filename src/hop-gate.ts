/**
 * Chamber hop-gate — admit/reject codes + live reject log.
 *
 * Gate layer only. Seal/open APIs are untouched (see chamber.ts).
 * No SettleHop / x402 / second payment protocol.
 *
 * PCC ≠ payment: PCC is the compression/storefront face (lbr1 guts), not a
 * billing or hop-settlement channel. Hop-gate codes are admission control, not
 * payment receipts.
 *
 * Wire (Agent-Rider #17 / charggri SoT): **exact text, not JSON**.
 *   CUNI ChamberHop
 *   key=value
 *   ...
 * Extra keys fail-closed and do not bind (never rehydrate as next machine input).
 * Codes are exact text strings matching Rider chamber set + Chamber-local
 * `reject.schema` until the C tree lands that code.
 */

import { createHash } from "node:crypto";

/** Exact text codes — Agent-Rider #17 chamber set + Chamber-local reject.schema. */
export type HopGateCode =
  | "admit"
  | "reject.schema"
  | "reject.extra"
  | "reject.hash"
  | "reject.replay"
  | "reject.agent"
  | "reject.empty";

export const HOP_GATE_CODES: readonly HopGateCode[] = [
  "admit",
  "reject.schema",
  "reject.extra",
  "reject.hash",
  "reject.replay",
  "reject.agent",
  "reject.empty",
] as const;

/** Kind line for Chamber hop exact-text wire. */
export const CHAMBER_HOP_KIND = "ChamberHop";
export const CHAMBER_HOP_HEADER = `CUNI ${CHAMBER_HOP_KIND}`;

/**
 * Allowlisted keys on CUNI ChamberHop (extras → reject.extra, do not bind).
 */
export const HOP_ALLOWED_KEYS = [
  "agent_id",
  "hop_id",
  "nonce",
  "hash",
  "payload",
  "schema_id",
] as const;

export type HopAllowedKey = (typeof HOP_ALLOWED_KEYS)[number];

export type HopGateInput = {
  agent_id?: string;
  hop_id?: string;
  nonce?: string;
  /** Hex SHA-256 of payload text; if present must match. */
  hash?: string;
  payload?: string;
  schema_id?: string;
};

export type HopGateResult = {
  code: HopGateCode;
  ok: boolean;
  reason?: string;
  at: string;
  agent_id?: string;
  hop_id?: string;
  hash?: string;
  schema_id?: string;
};

export type RejectLogEntry = HopGateResult & {
  /** Safe preview only — never full CuNi extra-key values as next machine input. */
  sanitized_preview?: string;
};

export type HopGateOptions = {
  allowedAgents?: ReadonlySet<string> | readonly string[];
  now?: () => Date;
  seenNonces?: Set<string>;
  logAdmits?: boolean;
};

const DEFAULT_SEEN = new Set<string>();
const REJECT_LOG: RejectLogEntry[] = [];
const ALLOWED_SET = new Set<string>(HOP_ALLOWED_KEYS);

function isoNow(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString();
}

function asAgentSet(
  allowed?: ReadonlySet<string> | readonly string[]
): Set<string> | null {
  if (!allowed) return null;
  const set = new Set<string>(allowed as Iterable<string>);
  return set.size > 0 ? set : null;
}

function result(
  code: HopGateCode,
  reason: string | undefined,
  at: string,
  meta: Partial<HopGateResult> = {}
): HopGateResult {
  return {
    code,
    ok: code === "admit",
    ...(reason ? { reason } : {}),
    at,
    ...meta,
  };
}

/** SHA-256 hex of payload exact text (utf8). */
export function payloadHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export type ExactParseOk = {
  ok: true;
  fields: HopGateInput;
  extras: string[];
};

export type ExactParseFail = {
  ok: false;
  code: HopGateCode;
  reason: string;
  fields: HopGateInput;
  extras: string[];
};

export type ExactParseResult = ExactParseOk | ExactParseFail;

/**
 * Parse CUNI ChamberHop exact-text wire.
 * Unknown keys are listed in `extras` and must not bind.
 */
export function parseChamberHopText(text: unknown): ExactParseResult {
  const emptyFields: HopGateInput = {};
  if (text === null || text === undefined) {
    return {
      ok: false,
      code: "reject.empty",
      reason: "missing hop input",
      fields: emptyFields,
      extras: [],
    };
  }
  if (typeof text !== "string") {
    return {
      ok: false,
      code: "reject.schema",
      reason: "hop wire must be exact text (not JSON object)",
      fields: emptyFields,
      extras: [],
    };
  }
  const raw = text.replace(/^\uFEFF/, "");
  if (!raw.trim()) {
    return {
      ok: false,
      code: "reject.empty",
      reason: "empty hop text",
      fields: emptyFields,
      extras: [],
    };
  }

  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) {
    return {
      ok: false,
      code: "reject.empty",
      reason: "empty hop text",
      fields: emptyFields,
      extras: [],
    };
  }

  const header = lines[i].trim();
  i++;
  if (header !== CHAMBER_HOP_HEADER) {
    // Chamber-local until C tree names kind rejects; map wrong kind → reject.schema
    return {
      ok: false,
      code: "reject.schema",
      reason: `expected header "${CHAMBER_HOP_HEADER}", got ${JSON.stringify(header)}`,
      fields: emptyFields,
      extras: [],
    };
  }

  const fields: HopGateInput = {};
  const extras: string[] = [];
  let saw = 0;

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      return {
        ok: false,
        code: "reject.schema",
        reason: `malformed kv line: ${JSON.stringify(line)}`,
        fields,
        extras,
      };
    }
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    saw++;
    if (!ALLOWED_SET.has(k)) {
      extras.push(k);
      continue; // do not bind
    }
    (fields as Record<string, string>)[k] = v;
  }

  if (extras.length > 0) {
    return {
      ok: false,
      code: "reject.extra",
      reason: `unknown keys (do not bind): ${extras.join(", ")}`,
      fields,
      extras,
    };
  }

  if (!saw) {
    return {
      ok: false,
      code: "reject.empty",
      reason: "no key=value lines",
      fields,
      extras: [],
    };
  }

  return { ok: true, fields, extras: [] };
}

/** Bound fields only — extras never appear. */
export function sanitizeHopInput(input: unknown): HopGateInput | null {
  if (typeof input === "string") {
    const p = parseChamberHopText(input);
    return { ...p.fields }; // bound only; extras already unbound
  }
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const out: HopGateInput = {};
  for (const key of HOP_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && typeof raw[key] === "string") {
      out[key] = raw[key] as string;
    }
  }
  return out;
}

/** Next-machine input: allowlisted keys only; extras dropped. */
export function nextMachineInput(input: unknown): HopGateInput | null {
  return sanitizeHopInput(input);
}

/**
 * Format a ChamberHop exact-text message from bound fields only.
 * Extra keys on `fields` are ignored (do not bind).
 */
export function formatChamberHopText(fields: HopGateInput): string {
  const lines = [CHAMBER_HOP_HEADER];
  for (const key of HOP_ALLOWED_KEYS) {
    const v = fields[key];
    if (v !== undefined && v !== "") {
      lines.push(`${key}=${v}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Exact-text result line: just the code (wire-facing). */
export function formatHopGateCode(code: HopGateCode): string {
  return code;
}

function previewSanitized(
  code: HopGateCode,
  fields: HopGateInput,
  extras?: string[]
): string {
  if (code === "reject.extra") {
    return [
      "dropped_extra_keys=" + (extras ?? []).join(","),
      "note=extra keys do not bind; values omitted from reject log",
      ...HOP_ALLOWED_KEYS.filter((k) => fields[k] !== undefined).map(
        (k) => `${k}=${String(fields[k]).slice(0, 80)}`
      ),
    ].join("\n");
  }
  const parts: string[] = [];
  for (const k of HOP_ALLOWED_KEYS) {
    if (fields[k] !== undefined) {
      const v = String(fields[k]);
      parts.push(`${k}=${v.length > 80 ? v.slice(0, 80) + "…" : v}`);
    }
  }
  return parts.join("\n");
}

/**
 * Evaluate hop admission from exact-text wire (primary) or bound object
 * (Chamber-local / MCP). Extra keys fail-closed and do not bind.
 * Does not call seal/open. Does not settle payment / SettleHop.
 */
export function evaluateHopGate(
  input: unknown,
  options: HopGateOptions = {}
): HopGateResult {
  const at = isoNow(options.now);
  const seen = options.seenNonces ?? DEFAULT_SEEN;

  let fields: HopGateInput;
  let extras: string[] = [];

  if (typeof input === "string" || input === null || input === undefined) {
    const parsed = parseChamberHopText(input);
    fields = parsed.fields;
    extras = parsed.extras;
    if (!parsed.ok) {
      const r = result(parsed.code, parsed.reason, at, {
        agent_id: fields.agent_id,
        hop_id: fields.hop_id,
        schema_id: fields.schema_id,
        hash: fields.hash,
      });
      appendRejectLog(
        {
          ...r,
          sanitized_preview: previewSanitized(parsed.code, fields, extras),
        },
        options
      );
      return r;
    }
  } else if (typeof input === "object" && !Array.isArray(input)) {
    // Chamber-local object path: still fail-closed on extras; values are strings.
    const raw = input as Record<string, unknown>;
    extras = Object.keys(raw).filter((k) => !ALLOWED_SET.has(k));
    fields = {};
    for (const key of HOP_ALLOWED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      const v = raw[key];
      if (typeof v !== "string") {
        const r = result(
          "reject.schema",
          `field ${key} must be exact text string`,
          at
        );
        appendRejectLog(
          { ...r, sanitized_preview: previewSanitized("reject.schema", fields) },
          options
        );
        return r;
      }
      fields[key] = v;
    }
    if (extras.length > 0) {
      const r = result(
        "reject.extra",
        `unknown keys (do not bind): ${extras.join(", ")}`,
        at,
        {
          agent_id: fields.agent_id,
          hop_id: fields.hop_id,
          schema_id: fields.schema_id,
        }
      );
      appendRejectLog(
        {
          ...r,
          sanitized_preview: previewSanitized("reject.extra", fields, extras),
        },
        options
      );
      return r;
    }
  } else {
    const r = result(
      "reject.schema",
      "hop wire must be exact text (CUNI ChamberHop)",
      at
    );
    appendRejectLog({ ...r, sanitized_preview: "" }, options);
    return r;
  }

  // Empty / missing required payload
  if (fields.payload === undefined || fields.payload === "") {
    const r = result("reject.empty", "empty or missing payload", at, {
      agent_id: fields.agent_id,
      hop_id: fields.hop_id,
      schema_id: fields.schema_id,
    });
    appendRejectLog(
      { ...r, sanitized_preview: previewSanitized("reject.empty", fields) },
      options
    );
    return r;
  }

  // Hash mismatch (exact-text payload bytes)
  const computed = payloadHash(fields.payload);
  if (fields.hash !== undefined && fields.hash !== computed) {
    const r = result("reject.hash", "payload hash mismatch", at, {
      agent_id: fields.agent_id,
      hop_id: fields.hop_id,
      hash: fields.hash,
      schema_id: fields.schema_id,
    });
    appendRejectLog(
      { ...r, sanitized_preview: previewSanitized("reject.hash", fields) },
      options
    );
    return r;
  }

  // Replay
  const replayKey =
    fields.nonce !== undefined
      ? `nonce:${fields.nonce}`
      : fields.hop_id !== undefined
        ? `hop:${fields.hop_id}`
        : null;
  if (replayKey && seen.has(replayKey)) {
    const r = result("reject.replay", "nonce/hop_id already seen", at, {
      agent_id: fields.agent_id,
      hop_id: fields.hop_id,
      hash: fields.hash ?? computed,
      schema_id: fields.schema_id,
    });
    appendRejectLog(
      { ...r, sanitized_preview: previewSanitized("reject.replay", fields) },
      options
    );
    return r;
  }

  // Agent allowlist
  const agents = asAgentSet(options.allowedAgents);
  if (agents) {
    if (!fields.agent_id || !agents.has(fields.agent_id)) {
      const r = result("reject.agent", "agent identity / allowlist fail", at, {
        agent_id: fields.agent_id,
        hop_id: fields.hop_id,
        hash: fields.hash ?? computed,
        schema_id: fields.schema_id,
      });
      appendRejectLog(
        { ...r, sanitized_preview: previewSanitized("reject.agent", fields) },
        options
      );
      return r;
    }
  }

  if (replayKey) seen.add(replayKey);

  const admitted = result("admit", undefined, at, {
    agent_id: fields.agent_id,
    hop_id: fields.hop_id,
    hash: fields.hash ?? computed,
    schema_id: fields.schema_id,
  });
  if (options.logAdmits) {
    appendRejectLog(
      {
        ...admitted,
        sanitized_preview: previewSanitized("admit", fields),
      },
      options
    );
  }
  return admitted;
}

/**
 * Append-only live reject log.
 * Extra-key rejects store key names + bound fields only — never CuNi extra values.
 */
export function appendRejectLog(
  entry: RejectLogEntry,
  _options?: HopGateOptions
): void {
  REJECT_LOG.push({ ...entry });
}

export function listRejectLog(limit?: number): RejectLogEntry[] {
  if (limit === undefined || limit < 0) return REJECT_LOG.slice();
  if (limit === 0) return [];
  return REJECT_LOG.slice(-limit);
}

export function resetHopGateState(): void {
  REJECT_LOG.length = 0;
  DEFAULT_SEEN.clear();
}
