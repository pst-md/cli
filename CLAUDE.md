# pst-md CLI — working notes

The npm package `pst-md`: a zero-dependency client + CLI for [pst.md](https://pst.md).
Published to npm as [`pst-md`](https://www.npmjs.com/package/pst-md); source at
`github.com/pst-md/cli`.

## Layout

- `src/index.ts` — the `PstClient` library (browser/edge/Node-safe, **zero deps**).
- `src/envelope.ts` — E2E encryption, **byte-compatible** with the web app's
  `src/features/crypto/envelope.ts` (PBKDF2-SHA-256 310k + AES-256-GCM, base64
  `{v,salt,iter,iv,ct}`). A note encrypted here opens in the browser and vice versa.
- `src/cli.ts` — the `pst-md` bin (arg parsing, stdin/file input, human/JSON output).
- `src/*.test.ts` — vitest. `dist/` — build output (git-ignored, published).

## Develop

```bash
npm install
npm run build          # tsc -> dist/  (also runs on prepublishOnly)
npm test               # vitest run
node dist/cli.js help  # exercise the built CLI
```

Smoke-test against production (creates a real note — delete it after):

```bash
printf '# test' | node dist/cli.js publish --gen-password --json   # note id/editKey/password
node dist/cli.js raw <id> --password <password>                    # decrypts
node dist/cli.js delete <id> --key <editKey>
```

## Release (maintainer)

Releases publish from GitHub Actions via npm **OIDC trusted publishing** —
no npm tokens, no local `npm publish`, no 2FA prompt. The trusted publisher
is registered on npmjs.com (org `pst-md`, repo `cli`, workflow `release.yml`):

```bash
npm version patch      # or minor / major — commits the bump + tags vX.Y.Z
git push origin main --follow-tags
```

The tag triggers `.github/workflows/release.yml`: `npm ci` + tests, a
tag-matches-package.json check, then `npm publish` with provenance.

Verify after: `npm view pst-md version` and `npx pst-md@latest help`.

## Constraints (do not break)

- **Zero runtime dependencies.** `src/index.ts` must run anywhere `fetch` +
  WebCrypto exist. Never add a dependency; use the WebCrypto global
  (`crypto.subtle`) — that's why `engines.node` is `>=20`.
- **Keep the envelope in lockstep with the web app.** If the app changes its
  encryption format, mirror it here (and bump the envelope `v`), or cross-app
  decryption breaks.
- **Public-repo git identity.** Commits here are authored by
  `pst.md <dev@pst.md>` — the repo-local git config pins this (verify with
  `git config user.email`; re-run `git config user.name "pst.md" &&
  git config user.email dev@pst.md` after a fresh clone). Do **not** commit
  with personal names/emails, and do **not** add any AI/assistant co-author
  or session trailers. This is a public open-source repo.
- The CLI/library speaks only the public notes API (`/api/notes`, `/n/<id>/raw`,
  `/api/appearance`). The browser-only sync-vault / folders / sharing features
  are **not** part of this package.
