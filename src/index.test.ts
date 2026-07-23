import { describe, expect, it, vi } from "vitest";
import {
  createClient,
  decryptEnvelope,
  encryptEnvelope,
  generatePassword,
  isEnvelope,
  PstError,
} from "./index";

function mockFetch(status: number, body: unknown, text = false) {
  return vi.fn(async () =>
    new Response(text ? String(body) : JSON.stringify(body), {
      status,
      headers: { "content-type": text ? "text/plain" : "application/json" },
    }),
  ) as unknown as typeof globalThis.fetch;
}

describe("PstClient", () => {
  it("create passes lifecycle options through", async () => {
    const fetch = mockFetch(201, {
      id: "abc", editKey: "k", encrypted: false, expiresAt: 123, burnAfterRead: true,
    });
    const pst = createClient({ fetch });
    const note = await pst.create("# hi", { expiresIn: "1d", burnAfterRead: true });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      content: "# hi", expiresIn: "1d", burnAfterRead: true,
    });
    expect(note.burnAfterRead).toBe(true);
    expect(note.expiresAt).toBe(123);
  });

  it("consume POSTs the one-time read endpoint", async () => {
    const fetch = mockFetch(200, {
      id: "abc", title: null, content: "# once", encrypted: false,
      createdAt: 1, updatedAt: 1, burnAfterRead: true,
    });
    const pst = createClient({ fetch });
    const note = await pst.consume("abc");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/api/notes/abc/consume");
    expect((init as RequestInit).method).toBe("POST");
    expect(note.content).toBe("# once");
  });

  it("create posts content and derives the page url", async () => {
    const fetch = mockFetch(201, { id: "abc", editKey: "k", encrypted: false });
    const pst = createClient({ fetch });
    const note = await pst.create("# hi");
    expect(note).toEqual({
      id: "abc",
      editKey: "k",
      encrypted: false,
      url: "https://pst.md/n/abc",
      unlockUrl: null,
    });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://pst.md/api/notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ content: "# hi" });
  });

  it("content fetches the raw endpoint as text", async () => {
    const fetch = mockFetch(200, "# raw source", true);
    const pst = createClient({ fetch });
    await expect(pst.content("abc")).resolves.toBe("# raw source");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://pst.md/n/abc/raw",
    );
  });

  it("update PATCHes with the edit key", async () => {
    const fetch = mockFetch(200, { id: "abc", title: null, content: "x", encrypted: false, createdAt: 1, updatedAt: 2 });
    const pst = createClient({ fetch });
    const note = await pst.update("abc", "x", "key");
    expect(note.content).toBe("x");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ content: "x", editKey: "key" });
  });

  it("throws PstError with server message and status", async () => {
    const fetch = mockFetch(403, { error: "That edit key is not valid for this note." });
    const pst = createClient({ fetch });
    const err = await pst.update("abc", "x", "bad").catch((e) => e);
    expect(err).toBeInstanceOf(PstError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("edit key");
  });

  it("appearance fetches the catalog", async () => {
    const catalog = {
      frontMatter: { description: "d", keys: {}, resolution: "r", example: "e" },
      palettes: [{ id: "dracula", label: "Dracula", isDark: true }],
      fonts: [{ id: "lora", label: "Lora", category: "Serif" }],
    };
    const fetch = mockFetch(200, catalog);
    const pst = createClient({ fetch });
    await expect(pst.appearance()).resolves.toEqual(catalog);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://pst.md/api/appearance",
    );
  });

  it("create with a password encrypts, flags encrypted, and returns an unlock link", async () => {
    const fetch = mockFetch(201, {
      id: "abc", editKey: "k", encrypted: true, expiresAt: null, burnAfterRead: false,
    });
    const pst = createClient({ fetch });
    const note = await pst.create("# secret", { password: "hunter2" });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.encrypted).toBe(true);
    expect(body.content).not.toContain("secret"); // ciphertext, not plaintext
    expect(isEnvelope(body.content)).toBe(true);
    // The posted envelope decrypts back to the original with the password.
    await expect(decryptEnvelope("hunter2", body.content)).resolves.toBe("# secret");
    expect(note.unlockUrl).toBe("https://pst.md/n/abc#p=hunter2");
  });

  it("content decrypts an encrypted note when given the password", async () => {
    const envelope = await encryptEnvelope("pw", "# hidden");
    const fetch = mockFetch(200, envelope, true);
    const pst = createClient({ fetch });
    await expect(pst.content("abc", { password: "pw" })).resolves.toBe("# hidden");
    // Without the password, the raw envelope is returned unchanged.
    const fetch2 = mockFetch(200, envelope, true);
    const pst2 = createClient({ fetch: fetch2 });
    await expect(pst2.content("abc")).resolves.toBe(envelope);
  });

  it("respects a custom baseUrl (trailing slash trimmed)", async () => {
    const fetch = mockFetch(200, { id: "a", title: null, encrypted: false, createdAt: 1, updatedAt: 1 });
    const pst = createClient({ baseUrl: "http://localhost:8799/", fetch });
    await pst.get("a");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "http://localhost:8799/api/notes/a",
    );
  });
});
