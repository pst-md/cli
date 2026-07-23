import { describe, expect, it } from "vitest";
import {
  DecryptError,
  decryptEnvelope,
  encryptEnvelope,
  isEnvelope,
  parseEnvelope,
} from "./envelope";
import { generatePassword } from "./index";

describe("envelope", () => {
  it("round-trips plaintext through a password", async () => {
    const envelope = await encryptEnvelope("correct horse", "# Secret\n\nbody");
    expect(isEnvelope(envelope)).toBe(true);
    await expect(decryptEnvelope("correct horse", envelope)).resolves.toBe(
      "# Secret\n\nbody",
    );
  });

  it("produces a fresh envelope every time (random salt + IV)", async () => {
    const a = await encryptEnvelope("pw", "same");
    const b = await encryptEnvelope("pw", "same");
    expect(a).not.toBe(b);
  });

  it("uses the app's format: v1, 16-byte salt, 310k iters, 12-byte IV", async () => {
    const env = parseEnvelope(await encryptEnvelope("pw", "hi"));
    expect(env.v).toBe(1);
    expect(env.iter).toBe(310_000);
    expect(atob(env.salt).length).toBe(16);
    expect(atob(env.iv).length).toBe(12);
  });

  it("rejects a wrong password with a typed error", async () => {
    const envelope = await encryptEnvelope("right", "secret");
    const err = await decryptEnvelope("wrong", envelope).catch((e) => e);
    expect(err).toBeInstanceOf(DecryptError);
    expect(err.reason).toBe("wrong_password");
  });

  it("rejects a malformed envelope", () => {
    expect(isEnvelope("not-an-envelope")).toBe(false);
    expect(() => parseEnvelope("not-an-envelope")).toThrow(DecryptError);
    // An envelope with too-low iterations is rejected.
    const weak = btoa(
      JSON.stringify({ v: 1, salt: "AAAA", iter: 1000, iv: "AAAA", ct: "AAAA" }),
    );
    expect(isEnvelope(weak)).toBe(false);
  });

  it("generatePassword returns strong unambiguous passwords", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/^[2-9a-km-np-zA-HJ-NP-Z]+$/); // no 0/1/O/I/l
    expect(generatePassword()).not.toBe(pw);
  });
});
