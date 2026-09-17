/**
 * Chamber hop-gate — admit/reject codes + live reject log.
 *
 * Aligned to Agent-Rider main agent-rider-c (PR #22) SoT:
 *   Header: CUNI ScanChunk
 *   Fields: url, etag, hash, agent_id
 *   Gate result wire: single exact-text code string (not JSON)
 *   reject.replay = hash already seen
 *   reject.log = TSV ISO\tcode\tpreview (mirrors agent-rider-c/reject.log)
 *   reject.schema = Chamber-local only (Rider does not emit)
 *   Wrong kind / extras → reject.extra; values never rehydrate as next input
 *
 * Gate layer only. Seal/open APIs are untouched (see chamber.ts).
 * No SettleHop / x402 / second payment protocol.
 *
 * PCC ≠ payment: PCC is the compression/storefront face (lbr1 guts), not a
 * billing or hop-settlement channel. Hop-gate codes are admission control, not
 * payment receipts.
 */

import { createHash } from "node:crypto";

/** Exact text codes — Rider chamber set + Chamber-local reject.schema. */
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

/** Kind line for Rider ScanChunk exact-text wire (agent-rider-c/cuni.c). */
export const SCAN_CHUNK_KIND = "ScanChunk";
export const SCAN_CHUNK_HEADER = `CUNI ${SCAN_CHUNK_KIND}`;

/** @deprecated Use SCAN_CHUNK_HEADER — kept as alias during align. */
export const CHAMBER_HOP_KIND = SCAN_CHUNK_KIND;
/** @deprecated Use SCAN_CHUNK_HEADER */
export const CHAMBER_HOP_HEADER = SCAN_CHUNK_HEADER;

/**
 * Allowlisted keys on CUNI ScanChunk (agent-rider-c/cuni.h scan_chunk).
 * Extras → reject.extra, do not bind.
 */
export const HOP_ALLOWED_KEYS = ["url", "etag", "hash", "agent_id"] as const;

export type HopAllowedKey = (typeof HOP_ALLOWED_KEYS)[number];

export type HopGateInput = {
  url?: string;
  etag?: string;
  hash?: string;
  agent_id?: string;
};

export type HopGateResult = {
  code: HopGateCode;
  ok: boolean;
  reason?: string;
  at: string;
  agent_id?: string;
  hash?: string;
  url?: string;
  etag?: string;
};

export type RejectLogEntry = {
  at: string;
  code: HopGateCode;
  /** Safe preview — newlines→spaces, truncated ~120; never full extra-key values as next input. */
  preview: string;
};

export type HopGateOptions = {
  allowedAgents?: ReadonlySet<string> | readonly string[];
  now?: () => Date;
  /** Replay set: hashes already seen (Rider chamber_policy.seen_hashes). */
  seenHashes?: Set<string>;
  /** @deprecated alias for seenHashes */
  seenNonces?: Set<string>;
  logAdmits?: boolean;
};

const DEFAULT_SEEN = new Set<string>();
const REJECT_LOG: RejectLogEntry[] = [];
const ALLOWED_SET = new Set<string>(HOP_ALLOWED_KEYS);
const PREVIEW_MAX = 120;

function isoNow(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
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

/** SHA-256 hex helper (not used by Rider ScanChunk admit — hash is opaque SoT). */
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
 * Parse CUNI ScanChunk exact-text wire (mirrors cuni_parse_scan_chunk).
 * Unknown keys are listed in `extras` and must not bind.
 * Wrong kind → reject.extra (Rider chamber_admit_scan maps KIND→extra).
 */
export function parseScanChunkText(text: unknown): ExactParseResult {
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
  if (header !== SCAN_CHUNK_HEADER) {
    // Rider: CUNI_ERR_KIND → reject.extra in chamber_admit_scan
    return {
      ok: false,
      code: "reject.extra",
      reason: `expected header "${SCAN_CHUNK_HEADER}", got ${JSON.stringify(header)}`,
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
      // Rider parse_kv: no '=' → CUNI_ERR_EXTRA
      return {
        ok: false,
        code: "reject.extra",
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

/** @deprecated Use parseScanChunkText */
export const parseChamberHopText = parseScanChunkText;

/** Bound fields only — extras never appear. */
export function sanitizeHopInput(input: unknown): HopGateInput | null {
  if (typeof input === "string") {
    const p = parseScanChunkText(input);
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
 * Format a ScanChunk exact-text message from bound fields only.
 * Extra keys on `fields` are ignored (do not bind).
 */
export function formatScanChunkText(fields: HopGateInput): string {
  const lines = [SCAN_CHUNK_HEADER];
  for (const key of HOP_ALLOWED_KEYS) {
    const v = fields[key];
    if (v !== undefined && v !== "") {
      lines.push(`${key}=${v}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** @deprecated Use formatScanChunkText */
export const formatChamberHopText = formatScanChunkText;

/** Exact-text result wire: single code string (no JSON body). */
export function formatHopGateCode(code: HopGateCode): string {
  return code;
}

/**
 * Sanitize preview like chamber_log_reject: newlines→spaces, truncate ~120.
 * Prefer bound wire text; never store unbound extra VALUES as next machine input.
 */
export function sanitizePreview(
  source: string | HopGateInput,
  extras?: string[]
): string {
  let text: string;
  if (typeof source === "string") {
    text = source;
  } else {
    const parts = [SCAN_CHUNK_HEADER];
    for (const k of HOP_ALLOWED_KEYS) {
      if (source[k] !== undefined) parts.push(`${k}=${source[k]}`);
    }
    if (extras && extras.length) {
      // key names only — values omitted
      for (const k of extras) parts.push(`${k}=`);
    }
    text = parts.join(" ");
  }
  let safe = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (safe.length > PREVIEW_MAX) safe = safe.slice(0, PREVIEW_MAX);
  return safe;
}

function seenSet(options: HopGateOptions): Set<string> {
  return options.seenHashes ?? options.seenNonces ?? DEFAULT_SEEN;
}

/**
 * Evaluate ScanChunk admission (mirrors chamber_admit_scan).
 * Extra keys fail-closed and do not bind.
 * Does not call seal/open. Does not settle payment / SettleHop.
 */
export function evaluateHopGate(
  input: unknown,
  options: HopGateOptions = {}
): HopGateResult {
  const at = isoNow(options.now);
  const seen = seenSet(options);

  let fields: HopGateInput;
  let extras: string[] = [];
  let rawPreview = "";

  if (typeof input === "string" || input === null || input === undefined) {
    if (typeof input === "string") rawPreview = input;
    const parsed = parseScanChunkText(input);
    fields = parsed.fields;
    extras = parsed.extras;
    if (!parsed.ok) {
      const r = result(parsed.code, parsed.reason, at, {
        agent_id: fields.agent_id,
        hash: fields.hash,
        url: fields.url,
        etag: fields.etag,
      });
      // Extras: bound fields + key names only (values never rehydrate / never logged).
      // Other rejects: flattened wire preview (Rider reject.log style).
      const preview =
        parsed.code === "reject.extra" && extras.length
          ? sanitizePreview(fields, extras)
          : sanitizePreview(rawPreview || fields);
      appendRejectLog({ at, code: parsed.code, preview }, options);
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
          { at, code: "reject.schema", preview: sanitizePreview(fields) },
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
          hash: fields.hash,
          url: fields.url,
          etag: fields.etag,
        }
      );
      appendRejectLog(
        {
          at,
          code: "reject.extra",
          preview: sanitizePreview(fields, extras),
        },
        options
      );
      return r;
    }
  } else {
    const r = result(
      "reject.schema",
      "hop wire must be exact text (CUNI ScanChunk)",
      at
    );
    appendRejectLog({ at, code: "reject.schema", preview: "" }, options);
    return r;
  }

  // Rider: missing url / hash / agent_id → reject.empty (CUNI_ERR_MISSING)
  if (!fields.url || !fields.hash || !fields.agent_id) {
    const r = result(
      "reject.empty",
      "missing required ScanChunk fields (url, hash, agent_id)",
      at,
      {
        agent_id: fields.agent_id,
        hash: fields.hash,
        url: fields.url,
        etag: fields.etag,
      }
    );
    appendRejectLog(
      {
        at,
        code: "reject.empty",
        preview: sanitizePreview(rawPreview || fields),
      },
      options
    );
    return r;
  }

  // Agent allowlist
  const agents = asAgentSet(options.allowedAgents);
  if (agents) {
    if (!agents.has(fields.agent_id)) {
      const r = result("reject.agent", "agent identity / allowlist fail", at, {
        agent_id: fields.agent_id,
        hash: fields.hash,
        url: fields.url,
        etag: fields.etag,
      });
      appendRejectLog(
        {
          at,
          code: "reject.agent",
          preview: sanitizePreview(rawPreview || fields),
        },
        options
      );
      return r;
    }
  }

  // Replay = hash already seen (Rider chamber_policy.seen_hashes)
  if (seen.has(fields.hash)) {
    const r = result("reject.replay", "hash already seen", at, {
      agent_id: fields.agent_id,
      hash: fields.hash,
      url: fields.url,
      etag: fields.etag,
    });
    appendRejectLog(
      {
        at,
        code: "reject.replay",
        preview: sanitizePreview(rawPreview || fields),
      },
      options
    );
    return r;
  }

  seen.add(fields.hash);

  const admitted = result("admit", undefined, at, {
    agent_id: fields.agent_id,
    hash: fields.hash,
    url: fields.url,
    etag: fields.etag,
  });
  if (options.logAdmits) {
    appendRejectLog(
      {
        at,
        code: "admit",
        preview: sanitizePreview(rawPreview || fields),
      },
      options
    );
  }
  return admitted;
}

/**
 * Append-only live reject log (mirrors chamber_log_reject / reject.log).
 * Line format: ISO\tcode\tpreview
 */
export function appendRejectLog(
  entry: RejectLogEntry,
  _options?: HopGateOptions
): void {
  REJECT_LOG.push({
    at: entry.at,
    code: entry.code,
    preview: entry.preview ?? "",
  });
}

/** Format one reject.log TSV line: ISO\tcode\tpreview */
export function formatRejectLogLine(entry: RejectLogEntry): string {
  const preview = (entry.preview ?? "").replace(/[\r\n\t]/g, " ");
  return `${entry.at}\t${entry.code}\t${preview}`;
}

export function listRejectLog(limit?: number): RejectLogEntry[] {
  if (limit === undefined || limit < 0) return REJECT_LOG.slice();
  if (limit === 0) return [];
  return REJECT_LOG.slice(-limit);
}

/** Full reject.log body as TSV text (mirrors agent-rider-c/reject.log). */
export function listRejectLogTsv(limit?: number): string {
  const rows = listRejectLog(limit);
  if (!rows.length) return "";
  return rows.map(formatRejectLogLine).join("\n") + "\n";
}

export function resetHopGateState(): void {
  REJECT_LOG.length = 0;
  DEFAULT_SEEN.clear();
}
