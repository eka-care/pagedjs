# Eka's Paged.js fork

This is a fork of [Paged.js](https://github.com/pagedjs/pagedjs) **0.4.3** (its last stable release)
with fixes for paginating tables: rows silently lost, headers missing on continued pages, documents
truncated after a tall row. Eka renders prescriptions, bills and charts with it through
[Pagify](https://github.com/eka-care/Pagify-sdk), in the browser and on the server.

Work happens on the **`eka/v0.4`** branch, based on tag `v0.4.3`. Upstream `main` (0.5 beta) rewrote
the layout engine and is worse for tables (upstream issue #351: 8 of 30 rows printed), so we don't
build on it.

## The fixes

| Fix | Problem in 0.4.3 |
|---|---|
| Repeat `<thead>` and `<colgroup>` on every continued page (`rebuildAncestors`) | No header after page 1, and fixed-layout column widths collapse to equal columns. Every integration added the header back after layout, which made pages taller than measured and pushed their last row out of print. |
| Treat `break-inside: avoid` as a preference when nothing else fits | A row taller than a page under `tr { break-inside: avoid }` is pushed to every following page; the chunker stops with "Layout repeated" and drops the rest of the document. |
| Break a row whose cells' padding overhangs the page by a sub-pixel (`box-decoration-break: clone` on that page's copy) | Chrome moves the whole row to the hidden overflow column; same truncation. |
| Re-check the page after removing its overflow (`settleOverflow`) | The new last row can stop fitting by a fraction of a pixel and silently drop out of print (the #351 class). |
| Always make progress: cut by measurement as a last resort (`forceBreakInside`) | Remaining knife-edge geometries where Chrome still moves a row out whole. |

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

```bash
npm run build
cd eka && npm install && npm test        # default sweep (6 page setups per case) + unit checks
node run.mjs --sweep fine                # 84 setups per case (A4/A5/Letter/A4 landscape × 0–40mm)
node run.mjs --only diet-chart --verbose
node run.mjs --setup A5:40mm,A4_landscape:0mm
PAGEDJS_POLYFILL=/path/to/other/paged.polyfill.js node run.mjs --ignore-header   # compare a build
```

Each case (`cases/*.mjs`) is rendered in Chromium and checked by **geometry, not DOM presence**:
every row and line must be visible inside a page area and printed once, the header must repeat,
columns must stay aligned and keep their widths. Paged.js lays pages out in CSS columns, so a row can
be in the DOM yet sit in a hidden overflow column and never print. A test that only counts DOM nodes
misses exactly these bugs.

`unit/layout-units.mjs` checks the layout helpers directly on a real Paged.js page, for situations
Chrome only produces at knife-edge geometries.

When you fix something, add the case that reproduced it first, and run the fine sweep: most of these
bugs only appear at particular page geometries.

## Behaviour to know about

- A `<thead>` (and any `<colgroup>`) **always** repeats on every page a table continues onto, as
  browsers do when printing. To keep a heading row from repeating, put it in the `<tbody>`.
- The repeated copy is marked `data-repeated-header` and has no `data-ref`. CSS counters incremented
  inside the header count again on each page it repeats on.
- When a page would otherwise make no progress, `break-inside: avoid` is relaxed (and table cells get
  `box-decoration-break: clone`) on **that page's copy** of the element only.

## Known, not yet fixed

- `rebuildAncestors` mutates the **source** row when carrying a rowspan cell onto a new page (it
  rebuilds the source row's children). Output is correct for a single render; re-paginating the same
  source would see the mutation.
- `createBreakToken` can map "before the table body" to "start of the table body", restarting the
  table on the next page. The fixes above stop pages reaching that state; the mapping itself is
  unchanged.
