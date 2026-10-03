# Working on Eka's Paged.js fork

This repository is Eka's fork of Paged.js **0.4.3**, with fixes for paginating tables. Pagify ships
its `dist/paged.polyfill.js`, in the browser and on the server, to print prescriptions, bills and
charts, so a regression here prints wrong documents in production, usually **silently**.
Paged.js pushes content that doesn't fit into a hidden overflow column, so it stays in the DOM and
never reaches paper.

[`eka/README.md`](eka/README.md) covers the fixes, the behaviour to know about, and the suite.
These are the rules for changing anything.

## Branches

- Work from **`eka/main`** and open pull requests against it.
- `upstream-v0.4.3` is the untouched upstream tag, kept for diffing. Never commit to it.
- Upstream `main` (0.5 beta) is a different, worse engine for tables. Don't merge from it.

## Build

Use Node **18**: the 0.4.3 build config uses JSON import assertions, which Node 22 rejects.

```bash
npm ci && npm run build      # → dist/paged.polyfill.js
```

## Before you open or merge a pull request: all four gates

```bash
cd eka && npm ci && npm run test:all
```

| Gate | What it proves |
|---|---|
| `npm test` | every committed page in `eka/pages/` × 6 page setups, plus the unit checks |
| `npm run test:with-integrations` | the same, with integrations' after-layout table handlers loaded |
| `npm run test:fine` / `test:fine:with-integrations` | every page × 84 setups (4 page sizes × top margins 0–40mm) |
| `npm run test:upstream` | every upstream `specs/**` document shows the same pages and visible words as stock 0.4.3 |

CI runs all four on every push and pull request. Don't merge on red, and don't merge with a gate
skipped.

## Rules

1. **Reproduce first, as a committed page.** Every bug gets a page in `eka/pages/` and an entry in
   `eka/cases.mjs`, and that entry must **fail** on the build before your fix. See *Adding a page*
   in `eka/README.md`.
2. **Never weaken an expectation to get green.** Don't lower `rows`, add `allowOrphanHeader`, pin
   `setups` or drop a page to make a failure go away. If an expectation is wrong, say why in the
   commit message.
3. **Check geometry, not the DOM.** A row "prints" only if it is visible inside a page's
   `.pagedjs_area`. DOM counts pass while rows are lost.
4. **Run the fine sweep.** Most of these bugs show at only a few page geometries: a fix that passes 6
   setups can fail 1 of 84.
5. **Stay inside the page.** Layout changes act on the page's rendered copy only, never on the source
   content, and must not change documents without tables (gate 4 checks this).
6. **Keep timings honest.** Run `npm run perf`. If this build is slower than stock, give the reason.
7. **No personal data.** This repository is public: strip patient and customer details from any page
   before committing it.
8. **One fix per commit**, with the problem and the fix in its message.

## Releasing

Releases are tags `v0.4.3-eka.N` on `eka/main`, built with Node 18. Each GitHub release attaches the
built `paged.polyfill.js` and its sha256. Pagify vendors that file.
