/**
 * Tiny client for pst.md — public markdown notes with instant shareable
 * links. Zero dependencies; works anywhere `fetch` exists (Node >= 18,
 * browsers, edge runtimes).
 *
 * The secret `editKey` returned by {@link PstClient.create} is shown exactly
 * once and is the only way to update or delete a note — store it.
 */

/** Result of publishing a note. */
export interface CreatedNote {
  id: string;
  /** Secret key required to update/delete. Returned only here — store it. */
  editKey: string;
  encrypted: boolean;
  /** Shareable page URL, derived from the client's baseUrl. */
  url: string;
}

/** Note metadata (content lives at {@link PstClient.content}). */
export interface NoteMeta {
  id: string;
  title: string | null;
  encrypted: boolean;
  createdAt: number;
  updatedAt: number;
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
  palettes: Array<{ id: string; label: string; isDark: boolean }>;
  fonts: Array<{ id: string; label: string; category: string }>;
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
   * content (keys: title, palette, font) — see https://pst.md/skill.md.
   */
  async create(content: string): Promise<CreatedNote> {
    const created = await this.json<Omit<CreatedNote, "url">>("/api/notes", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    return { ...created, url: this.pageUrl(created.id) };
  }

  /** Fetch note metadata (title, timestamps). 404 unknown / 410 deleted. */
  get(id: string): Promise<NoteMeta> {
    return this.json<NoteMeta>(`/api/notes/${encodeURIComponent(id)}`);
  }

  /** Fetch the verbatim markdown source (front matter included). */
  async content(id: string): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/n/${encodeURIComponent(id)}/raw`,
    );
    if (!response.ok) await fail(response);
    return response.text();
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
}

/** Convenience factory: `const pst = createClient();` */
export function createClient(options?: PstClientOptions): PstClient {
  return new PstClient(options);
}
