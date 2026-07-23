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
npx pst-md appearance                          # valid palette/font ids
```

- `--json` on any command for structured output; parse `editKey` from
  `publish` and persist it.
- `--key` can come from env `PST_MD_EDIT_KEY`; `--base-url` / `PST_MD_BASE_URL`
  targets another deployment.

## Library

```ts
import { createClient } from "pst-md";
const pst = createClient();
const note = await pst.create("---\ntitle: Hi\npalette: nord\n---\n# hello");
// note.url, note.id, note.editKey (STORE IT)
await pst.content(note.id);                  // raw markdown
await pst.update(note.id, "# v2", note.editKey);
await pst.delete(note.id, note.editKey);
await pst.appearance();                      // valid palette/font ids
```

Errors throw `PstError` with `.status`: `403` wrong key, `404` unknown,
`410` deleted, `413` >100KB, `429` rate-limited (20 publishes/hr/IP).

## Theming = YAML front matter (no API parameters)

Start the note content with:

```markdown
---
title: Release notes
palette: dracula
font: lora
---
# Body
```

Keys: `title`, `palette` (alias `theme`, 72 options, auto light/dark),
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
