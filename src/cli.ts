#!/usr/bin/env node
/**
 * pst-md CLI — publish/read/update/delete pst.md notes from the terminal.
 *
 *   npx pst-md publish note.md        # or:  cat note.md | npx pst-md publish
 *   npx pst-md raw <id>
 *   npx pst-md get <id>
 *   npx pst-md update <id> note.md --key <editKey>
 *   npx pst-md delete <id> --key <editKey>
 *   npx pst-md appearance
 *   npx pst-md skill                  # print the bundled agent SKILL.md
 *
 * Options: --base-url <origin> (or PST_MD_BASE_URL), --key (or
 * PST_MD_EDIT_KEY), --json for machine-readable output.
 */

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient, PstError } from "./index.js";

const HELP = `pst-md — public markdown notes on pst.md

Usage:
  pst-md publish [file]              Publish markdown (file or stdin) -> url + editKey
  pst-md get <id>                    Note metadata (title, timestamps)
  pst-md raw <id>                    Print the verbatim markdown source
  pst-md update <id> [file] --key K  Replace content (file or stdin)
  pst-md delete <id> --key K         Delete permanently (URL becomes 410)
  pst-md appearance                  List valid front-matter palette/font ids
  pst-md skill                       Print the bundled agent SKILL.md
  pst-md help                        This help

Options:
  --key <editKey>      Edit key (env: PST_MD_EDIT_KEY)
  --base-url <origin>  Target deployment (env: PST_MD_BASE_URL, default https://pst.md)
  --json               Machine-readable JSON output

The editKey is printed once at publish — store it; it is the only way to
edit or delete a note. Notes are public: never publish secrets.`;

async function readInput(file: string | undefined): Promise<string> {
  if (file && file !== "-") return readFile(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new Error("no content: pass a file or pipe markdown on stdin");
  return text;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      key: { type: "string" },
      "base-url": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const [command, ...args] = positionals;
  if (values.help || !command || command === "help") {
    console.log(HELP);
    return;
  }

  const pst = createClient({
    baseUrl: values["base-url"] ?? process.env.PST_MD_BASE_URL,
  });
  const key = () => {
    const k = values.key ?? process.env.PST_MD_EDIT_KEY;
    if (!k) throw new Error("missing --key (or PST_MD_EDIT_KEY)");
    return k;
  };
  const out = (data: unknown, human: () => void) =>
    values.json ? console.log(JSON.stringify(data, null, 2)) : human();

  switch (command) {
    case "publish": {
      const note = await pst.create(await readInput(args[0]));
      out(note, () => {
        console.log(`url:     ${note.url}`);
        console.log(`id:      ${note.id}`);
        console.log(`editKey: ${note.editKey}   <- shown ONCE, store it`);
      });
      break;
    }
    case "get": {
      if (!args[0]) throw new Error("usage: pst-md get <id>");
      const meta = await pst.get(args[0]);
      out(meta, () => {
        console.log(`title:   ${meta.title ?? "(untitled)"}`);
        console.log(`url:     ${pst.pageUrl(meta.id)}`);
        console.log(`updated: ${new Date(meta.updatedAt).toISOString()}`);
      });
      break;
    }
    case "raw": {
      if (!args[0]) throw new Error("usage: pst-md raw <id>");
      process.stdout.write(await pst.content(args[0]));
      break;
    }
    case "update": {
      if (!args[0]) throw new Error("usage: pst-md update <id> [file] --key K");
      const note = await pst.update(args[0], await readInput(args[1]), key());
      out(note, () => console.log(`updated: ${pst.pageUrl(note.id)}`));
      break;
    }
    case "delete": {
      if (!args[0]) throw new Error("usage: pst-md delete <id> --key K");
      await pst.delete(args[0], key());
      out({ ok: true, id: args[0] }, () => console.log(`deleted: ${args[0]} (URL is now 410 Gone)`));
      break;
    }
    case "appearance": {
      const catalog = await pst.appearance();
      out(catalog, () => {
        console.log(`palettes (${catalog.palettes.length}):`);
        for (const p of catalog.palettes) console.log(`  ${p.id}  (${p.label}${p.isDark ? ", dark" : ", light"})`);
        console.log(`fonts (${catalog.fonts.length}):`);
        for (const f of catalog.fonts) console.log(`  ${f.id}  (${f.label}, ${f.category})`);
      });
      break;
    }
    case "skill": {
      const here = path.dirname(fileURLToPath(import.meta.url));
      // dist/cli.js -> package root SKILL.md (bundled via package.json files)
      console.log(await readFile(path.join(here, "..", "SKILL.md"), "utf8"));
      break;
    }
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  if (error instanceof PstError) {
    console.error(`pst-md: ${error.message} (HTTP ${error.status})`);
  } else {
    console.error(`pst-md: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});
