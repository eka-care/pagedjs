# Eka's Paged.js fork

This is a fork of [Paged.js](https://github.com/pagedjs/pagedjs) **0.4.3** (its last stable release)
with fixes for paginating tables: rows silently lost, headers missing on continued pages, documents
truncated after a tall row. Eka renders prescriptions, bills and charts with it through
[Pagify](https://github.com/eka-care/Pagify-sdk), in the browser and on the server.

Upstream `main` (0.5 beta) rewrote the layout engine and is worse for tables (upstream issue #351:
8 of 30 rows printed), so we build on 0.4.3.

| Branch / tag | What it is |
|---|---|
| **`eka/main`** | The fork's release line: 0.4.3 + Eka's fixes. Branch from it; open pull requests against it. |
| `upstream-v0.4.3` | Untouched upstream tag `v0.4.3`, for diffing (`git diff upstream-v0.4.3 eka/main -- src`). Never commit to it. |
| `v0.4.3-eka.N` | Releases. Each GitHub release attaches the built `paged.polyfill.js` that Pagify vendors. |

Before changing anything, read [`AGENTS.md`](../AGENTS.md): every change must pass all the gates
below.

## The fixes

| Fix | Problem in 0.4.3 |
|---|---|
| Repeat `<thead>` and `<colgroup>` on every continued page (`rebuildAncestors`) | No header after page 1, and fixed-layout column widths collapse to equal columns. Every integration added the header back after layout, which made pages taller than measured and pushed their last row out of print. |
| Treat `break-inside: avoid` as a preference when nothing else fits | A row taller than a page under `tr { break-inside: avoid }` is pushed to every following page; the chunker stops with "Layout repeated" and drops the rest of the document. |
| Break a row whose cells' padding overhangs the page by a sub-pixel (`box-decoration-break: clone` on that page's copy) | Chrome moves the whole row to the hidden overflow column; same truncation. |
| Re-check the page after removing its overflow (`settleOverflow`) | The new last row can stop fitting by a fraction of a pixel and silently drop out of print (the #351 class). |
| Always make progress: cut by measurement as a last resort (`forceBreakInside`) | Remaining knife-edge geometries where Chrome still moves a row out whole. |
| Move a row whose box spills past the page whole (`findBoxOverflow`) | A row whose text fits but whose fixed-height box or bottom border doesn't prints cut off: nothing *content* overflowed, so Paged.js didn't break. |
| Don't leave a header alone at the end of a page (`findOrphanedHeader`) | A table starting near the bottom prints only its header there, its rows on the next page. |
| Drop the repeated header on a page where header + row can't fit (`dropRepeatedHeaders`) | A header too tall to repeat with a row under it loops ("Layout repeated"); browsers drop the repeat in that case too. |
| Close rowspan cells at the page edge (`clampRowspans`) | A rowspan cell spanning past the page's last row is drawn without its bottom border. |

Every fix is in `src/chunker/layout.js` or `src/utils/dom.js`, with a commit explaining it.

## Build

```bash
nvm use 18          # the 0.4.3 build config uses JSON import assertions (Node ≤ 20)
npm ci
npm run build       # → dist/paged.polyfill.js (what Pagify ships)
```

The build reproduces the published 0.4.3 byte for byte, apart from npm metadata that a dependency
embeds, so any behavior change comes from our commits.

## Test: the regression suite

Everything we test against is committed:

- **`eka/pages/*.html`**: one standalone page per case: long tables, rowspans, rows taller than a
  page, header edge cases, flowing text, and **`diet-chart-product.html`**, the real product page that
  surfaced the lost-rows bug (placeholder header/footer, no patient data). Open any of them in a
  browser after `npm run build` to see it paginate.
- **`eka/cases.mjs`**: what must hold for each page (rows, lines, header repeat, alignment, …).
  Every page has exactly one entry; the runner fails on a page without one.
- **`specs/**`**: upstream's own spec documents, compared against stock 0.4.3.

The four gates (CI runs all of them, in parallel, on every push and pull request):

```bash
npm run build                      # at the repo root, Node 18
cd eka && npm ci
npm test                           # 1. every page × 6 page setups + unit checks
npm run test:with-integrations     # 2. the same with integrations' after-layout table handlers loaded
npm run test:fine                  # 3. every page × 84 setups (A4/A5/Letter/A4 landscape × top margin 0–40mm)
npm run test:fine:with-integrations     # … and again with the handlers loaded
npm run test:upstream              # 4. every specs/** document vs stock 0.4.3: same pages, same visible words
npm run test:all                   # all of the above (~15 min)
```

Useful while working:

```bash
node run.mjs --only diet-chart-product --verbose
node run.mjs --setup A5:40mm,A4_landscape:0mm        # rerun exact setups from a failure
PAGEDJS_POLYFILL=$(node support/stock.mjs) node run.mjs --ignore-header   # the same pages on stock 0.4.3
npm run perf                                          # pagination time, this build vs stock
```

Each page is rendered in Chromium and checked by **geometry, not DOM presence**: every row and line
must be visible inside a page area and printed once, the header must repeat, columns must stay aligned
and keep their widths. Paged.js lays pages out in CSS columns, so a row can be in the DOM yet sit in a
hidden overflow column and never print. A test that only counts DOM nodes misses exactly these bugs.
The runner swaps each page's marked `<style data-eka-page-setup>` block for the setup it sweeps, and
its `../../dist/paged.polyfill.js` script for the build under test.

`unit/layout-units.mjs` checks the layout helpers directly on a real Paged.js page, for situations
Chrome only produces at knife-edge geometries.

### Adding a page

1. Save the document that shows the problem as `eka/pages/<name>.html`. Copy the `<head>` of an
   existing page: it needs the `<style data-eka-page-setup>` block and the
   `<script src="../../dist/paged.polyfill.js">` line. Strip patient or customer data first: this repo
   is public.
   Relative URLs resolve against `eka/pages/`: put images or fonts a page needs in `eka/pages/assets/`.
2. Mark what the checks should read: `data-table="t1"` on the table, `data-row="0…N-1"` on body rows,
   `data-col` on header and body cells, `data-line` on lines of long content.
3. Add its expectations to `eka/cases.mjs` and run it on the current build: it should **fail** for the
   bug you are fixing. Then fix, and run `npm run test:all`.

## Behaviour to know about

- A `<thead>` (and any `<colgroup>`) **always** repeats on every page a table continues onto, as
  browsers do when printing. To keep a heading row from repeating, put it in the `<tbody>`. Only the
  **first** `<thead>` repeats (a later one renders as body rows, as in browsers). `<caption>` and
  `<tfoot>` don't repeat ([#2](https://github.com/eka-care/pagedjs/issues/2)).
- The repeated copy is marked `data-repeated-header` and has no `data-ref`; ids in it become `data-id`
  (no duplicate ids), and forced-break / named-page markers are dropped from it. CSS counters
  incremented inside the header count again on each page it repeats on.
- On a page where the repeated header plus the next row can't fit, that page's copy is hidden
  (`data-repeated-header-dropped`), not removed.
- A table's header or caption alone is not "progress" on a page: a row that doesn't fit under it is
  made to fit (or the table moves to the next page) rather than leaving the header alone.
- When a page would otherwise make no progress, `break-inside: avoid` is relaxed (and table cells get
  `box-decoration-break: clone`) on **that page's copy** of the element only.
- Every break these fixes move goes through the `onOverflow` / `onBreakToken` hooks, as the first one
  does, so handlers that move or veto breaks still apply.

## Integrations: no table handlers needed

With this fork, an integration needs **no** custom handler to repeat `<thead>` or `<colgroup>`, or to
fix rowspan borders at page edges. Handlers that add a header or colgroup **after layout** (the
pattern integrations ship today) are no-ops here, since the copy is already present, and the
suite passes with them loaded (`npm run test:with-integrations`). Still remove them: the after-layout
insert and the `height: max-content` override they carry are what hid lost rows in the first place.

## Known, not yet fixed

Tracked as issues: [#2](https://github.com/eka-care/pagedjs/issues/2) `<tfoot>` / `<caption>` don't
repeat, [#3](https://github.com/eka-care/pagedjs/issues/3) an item taller than a page is clipped,
[#4](https://github.com/eka-care/pagedjs/issues/4) a fixed-height box spilling past the page prints cut
off (outside tables). Also:

- `rebuildAncestors` mutates the **source** row when carrying a rowspan cell onto a new page (it
  rebuilds the source row's children). Output is correct for a single render; re-paginating the same
  source would see the mutation.
- `createBreakToken` can map "before the table body" to "start of the table body", restarting the
  table on the next page. The fixes above stop pages reaching that state; the mapping itself is
  unchanged.
