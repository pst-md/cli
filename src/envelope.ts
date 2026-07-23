/**
 * End-to-end encryption envelope — byte-compatible with the pst.md web app so
 * a note encrypted here opens in the browser (and vice versa).
 *
 * Format: base64(JSON of { v: 1, salt, iter, iv, ct }) where salt/iv/ct are
 * base64. Key derivation is PBKDF2-SHA-256 with a fresh random 16-byte salt
 * and 310,000 iterations; encryption is AES-256-GCM with a fresh random 96-bit
 * IV. Zero dependencies — uses the WebCrypto global (`crypto.subtle`), so it
 * works in Node >= 20, browsers, and edge runtimes. The server only ever sees
 * the opaque envelope.
 */

export const ENVELOPE_VERSION = 1 as const;
/** OWASP floor; envelopes below it are rejected. */
export const MIN_PBKDF2_ITERATIONS = 310_000;
export const PBKDF2_ITERATIONS = 310_000;
/** Ceiling so a hostile envelope can't pin a reader's CPU. */
export const MAX_PBKDF2_ITERATIONS = 10_000_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedEnvelope = {
  v: typeof ENVELOPE_VERSION;
  salt: string;
  iter: number;
  iv: string;
  ct: string;
};

export type DecryptFailureReason = "invalid_envelope" | "wrong_password";

/** Typed failure so callers can tell a bad envelope from a bad password. */
export class DecryptError extends Error {
  readonly reason: DecryptFailureReason;
  constructor(reason: DecryptFailureReason, message: string) {
    super(message);
    this.name = "DecryptError";
    this.reason = reason;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "WebCrypto is unavailable — pst.md encryption needs Node >= 20, a browser, or an edge runtime.",
    );
  }
  return c.subtle;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await subtle().importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt plaintext with a password into a portable base64 envelope. */
export async function encryptEnvelope(
  password: string,
  plaintext: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      encoder.encode(plaintext) as BufferSource,
    ),
  );
  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    salt: bytesToBase64(salt),
    iter: PBKDF2_ITERATIONS,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ciphertext),
  };
  return btoa(JSON.stringify(envelope));
}

/** Parse + validate a base64 envelope. Throws DecryptError on a bad shape. */
export function parseEnvelope(encoded: string): EncryptedEnvelope {
  const invalid = () =>
    new DecryptError("invalid_envelope", "Not a valid encrypted-note envelope.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(encoded.trim()));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== "object" || parsed === null) throw invalid();
  const c = parsed as Record<string, unknown>;
  if (
    c.v !== ENVELOPE_VERSION ||
    typeof c.salt !== "string" ||
    typeof c.iv !== "string" ||
    typeof c.ct !== "string" ||
    typeof c.iter !== "number" ||
    !Number.isInteger(c.iter) ||
    c.iter < MIN_PBKDF2_ITERATIONS ||
    c.iter > MAX_PBKDF2_ITERATIONS
  ) {
    throw invalid();
  }
  return { v: c.v, salt: c.salt, iter: c.iter, iv: c.iv, ct: c.ct };
}

/** True when `text` is a well-formed encrypted-note envelope. */
export function isEnvelope(text: string): boolean {
  try {
    parseEnvelope(text);
    return true;
  } catch {
    return false;
  }
}

/** Decrypt an envelope with a password. Throws DecryptError on failure. */
export async function decryptEnvelope(
  password: string,
  encoded: string,
): Promise<string> {
  const envelope = parseEnvelope(encoded);
  const key = await deriveKey(password, base64ToBytes(envelope.salt), envelope.iter);
  try {
    const plaintext = await subtle().decrypt(
      { name: "AES-GCM", iv: base64ToBytes(envelope.iv) as BufferSource },
      key,
      base64ToBytes(envelope.ct) as BufferSource,
    );
    return decoder.decode(plaintext);
  } catch {
    throw new DecryptError("wrong_password", "Wrong password for this note.");
  }
}
