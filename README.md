# pst-md

Tiny zero-dependency client for [pst.md](https://pst.md) — publish public or
**end-to-end-encrypted** markdown notes with instant shareable links. No
accounts; a secret `editKey` (returned once at creation) is the only way to
update or delete a note.

Works anywhere `fetch` exists: Node ≥ 20, browsers, edge runtimes.

```bash
npm install pst-md
```

```ts
import { createClient } from "pst-md";

const pst = createClient();

// Publish — title/theme via YAML front matter (see https://pst.md/skill.md)
const note = await pst.create(`---
title: Release notes
palette: dracula
---
# v1.0 is out 🎉
`);
console.log(note.url);      // https://pst.md/n/<id>
console.log(note.editKey);  // shown ONCE — store it to edit/delete later

// Read
await pst.get(note.id);       // metadata: { id, title, encrypted, createdAt, updatedAt }
await pst.content(note.id);   // verbatim markdown source

// Update / delete (need the editKey)
await pst.update(note.id, "# edited", note.editKey);
await pst.delete(note.id, note.editKey);
```

Errors throw `PstError` with `.status` (`403` wrong key, `404` unknown,
`410` deleted, `413` too large, `429` rate-limited) and the server message.

## End-to-end encryption

Pass a `password` and the content is encrypted **client-side** (PBKDF2-SHA-256
+ AES-256-GCM) before it leaves your machine — the server only ever stores an
opaque envelope, byte-compatible with the pst.md web reader.

```ts
import { createClient, generatePassword } from "pst-md";
const pst = createClient();

const password = generatePassword();               // or bring your own
const note = await pst.create("# secret", { password });
note.unlockUrl;   // https://pst.md/n/<id>#p=<password>  (opens decrypted in-browser)

// Read it back — the password never reaches the server (it's in the # fragment)
await pst.content(note.id, { password });           // -> "# secret"
await pst.content(note.id);                          // -> the opaque envelope
```

Lose the password (and the unlock link) and the note is **unrecoverable** —
there is no reset. The `#p=` link is a secret: anyone with it can read the note.

## Notes are public by default

A plaintext note is readable by anyone with the link — never publish secrets
(use encryption above for private content). Limits: 100 KB per note,
20 publishes/hour/IP.

## MCP

pst.md is also a native [MCP](https://modelcontextprotocol.io) server — point
any MCP client at `https://pst.md/api/mcp`. Agent guide: https://pst.md/skill.md

## License

MIT
