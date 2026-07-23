/**
 * Tiny client for pst.md — public markdown notes with instant shareable
 * links. Zero dependencies; works anywhere `fetch` exists (Node >= 18,
 * browsers, edge runtimes).
 *
 * The secret `editKey` returned by {@link PstClient.create} is shown exactly
 * once and is the only way to update or delete a note — store it.
 */

import {
  decryptEnvelope,
  encryptEnvelope,
  isEnvelope,
} from "./envelope.js";

export {
  DecryptError,
  decryptEnvelope,
  encryptEnvelope,
  isEnvelope,
  parseEnvelope,
  type EncryptedEnvelope,
} from "./envelope.js";

/** Note lifetimes accepted at publish. Omit for a note that never expires. */
export type ExpiresIn = "1h" | "1d" | "1w" | "30d";

/** Options for {@link PstClient.create}. */
export interface CreateOptions {
  /** Named lifetime after which the note is gone. */
  expiresIn?: ExpiresIn;
  /** One-time note: self-destructs after the first content read. */
  burnAfterRead?: boolean;
  /**
   * Encrypt the content end-to-end with this password before publishing. The
   * server stores only the opaque envelope; readers need the password (or the
   * returned {@link CreatedNote.unlockUrl}).
   */
  password?: string;
}

/** Options for reads that may need to decrypt an encrypted note. */
export interface ReadOptions {
  /** Password to decrypt an encrypted note's content in place. */
  password?: string;
}

/** Result of publishing a note. */
export interface CreatedNote {
  id: string;
  /** Secret key required to update/delete. Returned only here — store it. */
  editKey: string;
  encrypted: boolean;
  /** Epoch ms when the note expires, or null. */
  expiresAt: number | null;
  /** The note self-destructs after its first content read. */
  burnAfterRead: boolean;
  /** Shareable page URL, derived from the client's baseUrl. */
  url: string;
  /**
   * Self-unlocking link (`<url>#p=<password>`) for an encrypted note — the
   * password rides in the URL fragment, which never reaches the server. Null
   * for a plaintext note.
   */
  unlockUrl: string | null;
}

/** Note metadata (content lives at {@link PstClient.content}). */
export interface NoteMeta {
  id: string;
  /** Null for encrypted and for one-time (burn-after-read) notes. */
  title: string | null;
  encrypted: boolean;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms when the note expires, or null. */
  expiresAt: number | null;
  burnAfterRead: boolean;
}

/** One-time read result from {@link PstClient.consume}. */
export interface ConsumedNote {
  id: string;
  title: string | null;
  content: string;
  encrypted: boolean;
  createdAt: number;
  updatedAt: number;
  burnAfterRead: boolean;
}

/** Note returned by {@link PstClient.update} (includes stored content). */
export interface UpdatedNote extends NoteMeta {
  content: string;
}

/** Valid front-matter appearance ids (see {@link PstClient.appearance}). */
export interface AppearanceCatalog {
  frontMatter: {
    description: string;
    keys: Record<string, string>;
    resolution: string;
    example: string;
  };
  /** Theme families — every palette has a real light AND dark flavor. */
  palettes: Array<{ id: string; label: string }>;
  fonts: Array<{ id: string; label: string; category: string }>;
  /** Shiki themes valid for the front-matter code-theme key. */
  codeThemes: Array<{ id: string; label: string }>;
}

/** Error carrying the HTTP status and server message for failed calls. */
export class PstError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PstError";
  }
}

export interface PstClientOptions {
  /** Origin of the pst.md deployment. Default: https://pst.md */
  baseUrl?: string;
  /** Custom fetch (testing, instrumentation). Default: globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

async function fail(response: Response): Promise<never> {
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? message;
  } catch {
    // non-JSON error body — keep the status message
  }
  throw new PstError(response.status, message);
}

export class PstClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: PstClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://pst.md").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!response.ok) await fail(response);
    return (await response.json()) as T;
  }

  /**
   * Publish a markdown note. Title/theme come from YAML front matter in the
   * content (keys: title, palette, font, code-theme) — see
   * https://pst.md/skill.md. Options add a lifetime or make it one-time.
   */
  async create(content: string, options: CreateOptions = {}): Promise<CreatedNote> {
    const body = options.password
      ? await encryptEnvelope(options.password, content)
      : content;
    const created = await this.json<Omit<CreatedNote, "url" | "unlockUrl">>(
      "/api/notes",
      {
        method: "POST",
        body: JSON.stringify({
          content: body,
          ...(options.password ? { encrypted: true } : {}),
          ...(options.expiresIn ? { expiresIn: options.expiresIn } : {}),
          ...(options.burnAfterRead ? { burnAfterRead: true } : {}),
        }),
      },
    );
    return {
      ...created,
      url: this.pageUrl(created.id),
      unlockUrl: options.password
        ? this.unlockUrl(created.id, options.password)
        : null,
    };
  }

  /** Fetch note metadata (title, timestamps). 404 unknown / 410 deleted. */
  get(id: string): Promise<NoteMeta> {
    return this.json<NoteMeta>(`/api/notes/${encodeURIComponent(id)}`);
  }

  /**
   * Fetch the verbatim markdown source (front matter included). For an
   * encrypted note this returns the opaque envelope; pass `{ password }` to
   * decrypt it to plaintext in place.
   */
  async content(id: string, options: ReadOptions = {}): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/n/${encodeURIComponent(id)}/raw`,
    );
    if (!response.ok) await fail(response);
    const text = await response.text();
    if (options.password && isEnvelope(text)) {
      return decryptEnvelope(options.password, text);
    }
    return text;
  }

  /**
   * Read a note's content exactly once, CONSUMING it if it is a one-time
   * (burn-after-read) note — the note is erased for everyone afterwards.
   * The only way to read a plaintext burn note programmatically
   * ({@link content} answers 403 for those). Pass `{ password }` to decrypt an
   * encrypted note's content.
   */
  async consume(id: string, options: ReadOptions = {}): Promise<ConsumedNote> {
    const note = await this.json<ConsumedNote>(
      `/api/notes/${encodeURIComponent(id)}/consume`,
      { method: "POST" },
    );
    if (options.password && isEnvelope(note.content)) {
      return { ...note, content: await decryptEnvelope(options.password, note.content) };
    }
    return note;
  }

  /** Replace a note's content. Requires the editKey from {@link create}. */
  update(id: string, content: string, editKey: string): Promise<UpdatedNote> {
    return this.json<UpdatedNote>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ content, editKey }),
    });
  }

  /** Permanently delete a note (the URL becomes 410 Gone). */
  async delete(id: string, editKey: string): Promise<void> {
    await this.json<{ ok: true }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ editKey }),
    });
  }

  /**
   * Catalog of valid front-matter `palette`/`font` ids plus the front-matter
   * contract itself. Use it to validate appearance values before publishing.
   */
  appearance(): Promise<AppearanceCatalog> {
    return this.json<AppearanceCatalog>("/api/appearance");
  }

  /** Human-readable page URL for a note id. */
  pageUrl(id: string): string {
    return `${this.baseUrl}/n/${encodeURIComponent(id)}`;
  }

  /**
   * Self-unlocking link for an encrypted note: the password rides in the URL
   * fragment (`#p=…`), which the browser never sends to the server. Anyone with
   * the link can read the note, so treat it as the secret it is.
   */
  unlockUrl(id: string, password: string): string {
    return `${this.pageUrl(id)}#${new URLSearchParams({ p: password }).toString()}`;
  }
}

/** Convenience factory: `const pst = createClient();` */
export function createClient(options?: PstClientOptions): PstClient {
  return new PstClient(options);
}

// Unambiguous alphabet (no 0/O/1/l/I) — matches the web app's generator.
const PASSWORD_ALPHABET =
  "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A strong random password from a CSPRNG, suitable for encrypting a note.
 * Default 20 chars (~117 bits over the 55-symbol alphabet).
 */
export function generatePassword(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  return out;
}
