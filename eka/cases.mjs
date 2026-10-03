// What must hold for each committed page in pages/<name>.html. Every page has exactly one entry here
// and every entry has a page (run.mjs fails otherwise), so nothing committed is silently skipped.
//
// Each page is rendered across a sweep of page setups (every top margin moves every page break, so a
// boundary bug can't hide) and passes only if every setup passes. Checks are geometric: "prints"
// means visible inside a page's .pagedjs_area, not merely present in the DOM.
//
// Page markers the checks read: <table data-table="t1">, body rows <tr data-row="N">, header and body
// cells data-col="K", lines of long content <div data-line="N">.
//
// expect:
//   rows: N             rows data-row 0..N-1 each print exactly once, whole (not cut at a page edge)
//   lines: N            lines data-line 0..N-1 all print
//   thead               the header repeats on every page the table continues onto
//   aligned             every cell sits under its header's column
//   stableWidths        column widths are identical on every page
//   allowOrphanHeader   a header alone at a page end is unavoidable for this page (by authoring)
//   maxPages: N         no more than N pages (no wasted page)
// Always checked: pagination completes, no "Layout repeated", never two header copies on a page,
// no header left alone at a page end, no rowspan overrunning its page, no duplicate ids.
//
// setups: pins the page setups instead of the sweep, for a page about one exact geometry.

const A4_16 = { size: "A4", marginTop: "16mm", marginSide: "15mm", marginBottom: "15mm" }; // ~1005px tall area

export default [
	// Long tables
	{ name: "long-table", expect: { rows: 120, thead: true, aligned: true } },
	{ name: "long-table-rows-avoid", expect: { rows: 120, thead: true, aligned: true } },
	{ name: "colgroup-widths", expect: { rows: 120, thead: true, stableWidths: true } },
	{ name: "multiple-tbodies", expect: { rows: 120, thead: true, aligned: true } },
	{ name: "caption-and-tfoot", expect: { rows: 110, thead: true, aligned: true } },
	{ name: "two-tables", expect: { rows: 110, thead: true, aligned: true } },
	{ name: "table-near-bottom", expect: { rows: 60, lines: 34, thead: true, aligned: true } },
	{ name: "nested-tables", expect: { rows: 45, thead: true } },
	{ name: "image-height-cells", expect: { rows: 40, thead: true, aligned: true } },

	// Rowspans and colspans
	{ name: "rowspan-groups", expect: { rows: 90, thead: true, aligned: true } },
	{ name: "rowspan-groups-rows-avoid", expect: { rows: 90, thead: true, aligned: true } },
	{ name: "colspan-section-rows", expect: { rows: 108, thead: true, aligned: true } },
	{ name: "colspan-section-rows-avoid", expect: { rows: 108, thead: true, aligned: true } },

	// Rows taller than a page
	{ name: "tall-row", expect: { rows: 40, lines: 70, thead: true } },
	{ name: "tall-row-rows-avoid", expect: { rows: 40, lines: 70, thead: true } },
	{ name: "tall-row-two-pages", expect: { rows: 40, lines: 140, thead: true } },
	{ name: "tall-row-in-long-table-avoid", expect: { rows: 100, lines: 140, thead: true, aligned: true } },
	{ name: "colgroup-tall-row-avoid", expect: { rows: 40, lines: 70, thead: true, stableWidths: true } },

	// Real-world shapes
	{ name: "diet-chart", expect: { rows: 80, lines: 70, thead: true, aligned: true } },
	{ name: "diet-chart-product", expect: { rows: 80, thead: true, aligned: true } },
	{ name: "paragraph-cells-351", expect: { rows: 30, thead: true, aligned: true },
		setups: [{ size: "297mm 210mm", marginTop: "2cm", marginSide: "1.5cm", marginBottom: "2cm" }] },

	// Not tables: must behave as before
	{ name: "long-paragraphs", expect: { lines: 120 } },
	{ name: "long-list", expect: { lines: 160 } },

	// Header and page-edge edge cases
	{ name: "two-theads", expect: { rows: 120, thead: true } },
	{ name: "header-with-ids", expect: { rows: 120, thead: true, aligned: true } },
	{ name: "header-with-break-before", expect: { rows: 120, thead: true } },
	{ name: "tall-header", expect: { rows: 6, allowOrphanHeader: true }, setups: [A4_16] },
	{ name: "box-spill-rows", expect: { rows: 40, thead: true, aligned: true } },
	{ name: "orphan-header", expect: { rows: 30, thead: true }, setups: [A4_16] },
	{ name: "all-thead-rows", expect: { rows: 120, allowOrphanHeader: true } },
	{ name: "caption-tall-first-row", expect: { rows: 31, thead: true } },
	{ name: "image-taller-than-page", expect: { rows: 5, maxPages: 3, allowOrphanHeader: true } },
];
