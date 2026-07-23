---
name: pst-md
description: Publish, read, update, and delete public markdown notes on pst.md from the terminal (npx pst-md) or JavaScript (import "pst-md"). Use when asked to share markdown/text as a link, publish a note or paste, or manage pst.md notes. Notes are themed via YAML front matter; a secret editKey (shown once) controls edit/delete.
---

# pst-md — CLI + client for pst.md

pst.md hosts public markdown notes: publish → get a shareable link
instantly. No accounts. The `editKey` returned at publish is shown **once**
and is the only way to edit/delete — always store it.

## CLI (no install needed)

```bash
echo "# hello" | npx pst-md publish            # -> url + id + editKey
npx pst-md publish notes.md --json             # machine-readable
npx pst-md raw <id>                            # verbatim markdown source
npx pst-md get <id>                            # metadata (title, timestamps)
npx pst-md update <id> notes.md --key <editKey>
npx pst-md delete <id> --key <editKey>         # URL becomes 410 Gone
npx pst-md publish note.md --expires 1d --burn # lifetime + one-time note
npx pst-md consume <id>                        # one-time read (ERASES burn notes)
npx pst-md publish note.md --gen-password      # encrypt E2E, print unlock link
npx pst-md raw <id> --password P               # decrypt an encrypted note
npx pst-md appearance                          # valid palette/font/code-theme ids
```

- `--json` on any command for structured output; parse `editKey` from
  `publish` and persist it (encrypted publishes also return `password` and
  `unlockUrl`).
- `--key` can come from env `PST_MD_EDIT_KEY`; `--base-url` / `PST_MD_BASE_URL`
  targets another deployment.
- Encryption is end-to-end: `--password P` (or `--gen-password`) encrypts on
  publish; the same `--password` decrypts on `raw`/`consume`. The server never
  sees the password or plaintext — lose it and the note is unrecoverable.

## Library

```ts
import { createClient } from "pst-md";
const pst = createClient();
const note = await pst.create("---\ntitle: Hi\npalette: nord\n---\n# hello");
// options: await pst.create(md, { expiresIn: "1d", burnAfterRead: true })
// encrypt E2E: await pst.create(md, { password }) -> note.unlockUrl (#p=…)
//   import { generatePassword } from "pst-md" for a strong one
//   read back: await pst.content(id, { password }) / pst.consume(id, { password })
// one-time read (erases burn notes): await pst.consume(id)
// note.url, note.id, note.editKey (STORE IT)
await pst.content(note.id);                  // raw markdown
await pst.update(note.id, "# v2", note.editKey);
await pst.delete(note.id, note.editKey);
await pst.appearance();                      // palettes, fonts, codeThemes
```

Errors throw `PstError` with `.status`: `403` wrong key, `404` unknown,
`410` deleted, `413` >100KB, `429` rate-limited (20 publishes/hr/IP).

## Theming = YAML front matter (no API parameters)

Start the note content with:

```markdown
---
title: Release notes
palette: catppuccin
font: lora
---
# Body
```

Keys: `title`, `palette` (alias `theme` — 20 theme families, each with a real light AND dark flavor), `code-theme` (alias `code` — pins the code-block syntax theme, e.g. dracula),
`font` (19 options). Values resolve case-insensitively by id or label;
unknown values are ignored. Authoritative ids: `npx pst-md appearance`,
`GET https://pst.md/api/appearance`, or the MCP `list_appearance` tool.
Omit the block to let readers use their own theme.

## Rules

1. Notes are **public** — never publish secrets or private data.
2. Store the `editKey` at publish time; it is never shown again.
3. Content round-trips verbatim (front matter included); it's only hidden
   when rendered.

## MCP alternative

pst.md is a native MCP server: `{"mcpServers": {"pst-md": {"url":
"https://pst.md/api/mcp"}}}` — tools `create_note`, `get_note`,
`update_note`, `delete_note`, `list_appearance`. Full agent guide:
https://pst.md/skill.md
