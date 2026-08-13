/**
 * Chamber seal/open — AES-256-GCM + φ-split keyword shares (Format Spec v1).
 * No TRU8 residual engine.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const WORDLIST = [
  "ward", "veil", "spire", "lock", "oath", "cloak", "shard", "mark",
  "rune", "gate", "seal", "vault", "cipher", "glyph", "prism", "echo",
  "aegis", "sigil", "forge", "anchor", "tide", "ember", "frost", "bloom",
  "thorn", "quill", "mirror", "hollow", "crown", "blade", "root", "star",
  "mist", "iron", "glass", "stone", "flame", "shade", "pulse", "nexus",
  "orbit", "vector", "lattice", "helix", "core", "rim", "axis", "node",
  "flux", "phase", "drift", "spark", "void", "bound", "link", "key",
  "guard", "watch", "keep", "hold", "bind", "cast", "form", "rise",
] as const;

const PHI_ROT = 21;
const AAD = Buffer.from("chamber-v1");

function deriveSessionKey(master: Buffer): Buffer {
  return createHash("sha256").update(master).update("chamber-phi-v1").digest();
}

function phiSplit(key32: Buffer): [Buffer, Buffer] {
  const a = Buffer.alloc(16);
  const b = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    a[i] = key32[i];
    b[i] = key32[i + 16] ^ key32[i];
  }
  const rot = PHI_ROT % 8;
  const rotated = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    const prev = b[(i + 15) % 16];
    rotated[i] = ((b[i] << rot) | (prev >> (8 - rot))) & 0xff;
  }
  return [a, rotated];
}

function bytesToWords(data: Buffer): string {
  const pad = (3 - (data.length % 3)) % 3;
  const buf = Buffer.concat([data, Buffer.alloc(pad)]);
  const words: string[] = [];
  for (let i = 0; i < buf.length; i += 3) {
    const n = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
    for (const shift of [18, 12, 6, 0]) {
      words.push(WORDLIST[(n >> shift) & 0x3f]);
    }
  }
  return words.join(" ");
}

function wordsToBytes(text: string, expectedLen: number): Buffer {
  const idx = new Map(WORDLIST.map((w, i) => [w, i]));
  const parts = text.trim().split(/\s+/);
  const out: number[] = [];
  for (let i = 0; i + 3 < parts.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      n = (n << 6) | (idx.get(parts[i + j]) ?? 0);
    }
    out.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }
  return Buffer.from(out).subarray(0, expectedLen);
}

export type SealedBlob = {
  v: number;
  algo: string;
  k_words: string;
  r_words: string;
  nonce: string;
  tag: string;
  ct: string;
  orig_len: number;
};

export function chamberSeal(plaintext: Buffer, master: Buffer): SealedBlob {
  const session = deriveSessionKey(master);
  const [k, r] = phiSplit(session);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", session, nonce);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    algo: "chamber-aes256gcm-phi",
    k_words: bytesToWords(k),
    r_words: bytesToWords(r),
    nonce: nonce.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("base64"),
    orig_len: plaintext.length,
  };
}

export function chamberOpen(sealed: SealedBlob, master: Buffer): Buffer {
  if (sealed.algo !== "chamber-aes256gcm-phi" || sealed.v !== 1) {
    throw new Error("unsupported chamber format");
  }
  const key = deriveSessionKey(master);
  const nonce = Buffer.from(sealed.nonce, "hex");
  const tag = Buffer.from(sealed.tag, "hex");
  const ct = Buffer.from(sealed.ct, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Public-safe benefit_check — no TRU8 engine. */
export function benefitCheck(data: Buffer): Record<string, unknown> {
  const n = data.length;
  if (n < 1024) {
    return {
      compress: false,
      reason: `tiny <1KB – use json-chamber only ($99)`,
      action: "json-chamber",
      recommend: "group-first",
      size: n,
      price_hint: 99,
    };
  }
  const counts = new Map<number, number>();
  for (const b of data) counts.set(b, (counts.get(b) ?? 0) + 1);
  let entropy = 0;
  for (const v of counts.values()) {
    const p = v / n;
    entropy -= p * Math.log2(p);
  }
  const sample = data.subarray(0, Math.min(8192, n));
  let zeros = 0;
  let bits = 0;
  for (const b of sample) {
    for (let i = 7; i >= 0; i--) {
      if (((b >> i) & 1) === 0) zeros++;
      bits++;
    }
  }
  const bias = bits ? zeros / bits : 0.5;
  if (entropy > 7.8) {
    return {
      compress: false,
      reason: `high entropy ${entropy.toFixed(2)}/8.0 – already compressed/encrypted`,
      action: "json-chamber only",
      recommend: "json-chamber",
      entropy: +entropy.toFixed(4),
      bias: +bias.toFixed(4),
      size: n,
      est_saving: 0,
      price_hint: 99,
    };
  }
  let est = Math.max(0, (8 - entropy) / 8);
  est = Math.min(0.95, est + Math.abs(bias - 0.5) * 0.4);
  return {
    compress: true,
    reason: `good candidate – entropy ${entropy.toFixed(2)}, bias ${bias.toFixed(3)}, est ${(est * 100).toFixed(1)}%`,
    action: "tru8-chamber $1900 tier",
    recommend: "tru8-chamber",
    entropy: +entropy.toFixed(4),
    bias: +bias.toFixed(4),
    size: n,
    est_saving: +est.toFixed(4),
    price_hint: 1900,
    note: "TRU8 engine is proprietary — contact license@slidphilabs.com",
  };
}
