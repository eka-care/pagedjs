// Render one committed page (pages/<name>.html) with the build under test and measure what actually
// prints.
//
// "Prints" means: inside a page's .pagedjs_area. Paged.js lays pages out in CSS columns, so content
// that doesn't fit can sit in a hidden overflow column — still in the DOM, never on paper. Counting
// DOM nodes would miss exactly the bugs this suite exists for, so every check here is geometric.
//
// Page markers (see cases.mjs): <table data-table="t1">, body rows <tr data-row="N">, cells/headers
// data-col="K", long content lines <div data-line="N">.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
// PAGEDJS_POLYFILL=<path> runs the suite against another build (e.g. stock 0.4.3) for comparison.
export const POLYFILL = process.env.PAGEDJS_POLYFILL
	? path.resolve(process.env.PAGEDJS_POLYFILL)
	: path.resolve(here, "../../dist/paged.polyfill.js");
const TMP = path.resolve(here, "../.tmp");
export const PAGES = path.resolve(here, "../pages");

// EKA_HANDLERS=pagify-legacy,colgroup-after-layout loads integration handlers (support/integrations/)
// next to the polyfill, to check the fork stays correct while integrations still ship them.
const HANDLERS = (process.env.EKA_HANDLERS || "").split(",").filter(Boolean)
	.map((name) => `<script src="${pathToFileURL(path.resolve(here, "integrations", name + ".js")).href}"></script>`).join("\n");

/**
 * A committed page, set up for one run: its marked page-setup block becomes this run's page size and
 * margins, and its polyfill <script> becomes the build under test (plus any integration handlers),
 * with auto-run off so the runner starts and awaits pagination itself. The run's copy is written to
 * .tmp/, so a <base> keeps the page's relative URLs (images, fonts) resolving against pages/.
 */
export function documentHTML(source, page, polyfill = POLYFILL) {
	const SETUP = /<style data-eka-page-setup>[\s\S]*?<\/style>/;
	const SCRIPT = /<script src="\.\.\/\.\.\/dist\/paged\.polyfill\.js"><\/script>/;
	const HEAD = /<head(\s[^>]*)?>/i;
	if (!SETUP.test(source) || !SCRIPT.test(source) || !HEAD.test(source)) {
		throw new Error('a page needs a <head>, a <style data-eka-page-setup> block and <script src="../../dist/paged.polyfill.js"> (see pages/long-table.html)');
	}
	const base = `<base href="${pathToFileURL(PAGES).href}/">`;
	const setup = `<style data-eka-page-setup>@page { size: ${page.size}; margin: ${page.marginTop} ${page.marginSide} ${page.marginBottom} ${page.marginSide}; }</style>`;
	const build = `<script>window.PagedConfig = { auto: false };</script>\n<script src="${pathToFileURL(polyfill).href}"></script>\n${HANDLERS}`;
	return source.replace(HEAD, (head) => `${head}\n${base}`).replace(SETUP, () => setup).replace(SCRIPT, () => build);
}

export async function render(browser, { name, page: setup, polyfill }, { timeoutMs = 25000 } = {}) {
	fs.mkdirSync(TMP, { recursive: true });
	const source = fs.readFileSync(path.join(PAGES, name + ".html"), "utf8");
	const file = path.join(TMP, `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
	fs.writeFileSync(file, documentHTML(source, setup, polyfill));
	const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
	const consoleErrors = [];
	page.on("console", (m) => { if (m.type() === "error" || /Layout repeated/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
	page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
	try {
		await page.goto(pathToFileURL(file).href);
		const outcome = await page.evaluate(async (ms) => {
			const timeout = new Promise((r) => setTimeout(() => r("TIMEOUT"), ms));
			const flow = await Promise.race([window.PagedPolyfill.preview(), timeout]);
			return flow === "TIMEOUT" ? { completed: false } : { completed: true, pages: flow.total };
		}, timeoutMs);
		const measured = await page.evaluate(measureInPage);
		return { ...outcome, ...measured, consoleErrors };
	} finally {
		await page.close();
		fs.rmSync(file, { force: true });
	}
}

// Runs in the page after pagination.
function measureInPage() {
	const near = (a, b) => Math.abs(a - b) <= 2;
	const inside = (r, a) => r.height > 0 && r.top >= a.top - 1 && r.bottom <= a.bottom + 1 && r.left >= a.left - 1 && r.right <= a.right + 1;
	const rowsVisible = new Set();
	const rowStarts = {}; // row id -> times it starts a fragment (a continued, split row doesn't count)
	const rowsClipped = new Set();
	const linesVisible = new Set();
	const missingThead = [];
	const misalignedCells = [];
	const headerWidths = {}; // table id -> [ "w1/w2/..." per page ]
	const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
	pages.forEach((pg, p) => {
		const areaEl = pg.querySelector(".pagedjs_area");
		if (!areaEl) return;
		const area = areaEl.getBoundingClientRect();
		pg.querySelectorAll(".pagedjs_page_content tr[data-row]").forEach((tr) => {
			const r = tr.getBoundingClientRect();
			if (r.height <= 0) return;
			(inside(r, area) ? rowsVisible : rowsClipped).add(tr.getAttribute("data-row"));
			if (!tr.hasAttribute("data-split-from")) rowStarts[tr.getAttribute("data-row")] = (rowStarts[tr.getAttribute("data-row")] || 0) + 1;
		});
		pg.querySelectorAll(".pagedjs_page_content [data-line]").forEach((el) => {
			if (inside(el.getBoundingClientRect(), area)) linesVisible.add(el.getAttribute("data-line"));
		});
		pg.querySelectorAll(".pagedjs_page_content table[data-table]").forEach((t) => {
			const id = t.getAttribute("data-table");
			const bodyRows = Array.from(t.querySelectorAll(":scope > tbody > tr")).filter((tr) => tr.getBoundingClientRect().height > 0);
			if (!bodyRows.length) return;
			const ths = Array.from(t.querySelectorAll(":scope > thead th[data-col]"));
			if (!ths.length) { missingThead.push(`${id}@p${p + 1}`); return; }
			(headerWidths[id] = headerWidths[id] || []).push(ths.map((th) => Math.round(th.getBoundingClientRect().width)).join("/"));
			const colRect = {};
			ths.forEach((th) => { colRect[th.getAttribute("data-col")] = th.getBoundingClientRect(); });
			bodyRows.forEach((tr) => {
				tr.querySelectorAll(":scope > td[data-col]").forEach((td) => {
					const h = colRect[td.getAttribute("data-col")];
					const r = td.getBoundingClientRect();
					if (h && (td.colSpan || 1) === 1 && !(near(r.left, h.left) && near(r.right, h.right))) {
						misalignedCells.push(`${id}@p${p + 1} row ${tr.getAttribute("data-row")} col ${td.getAttribute("data-col")}`);
					}
				});
			});
		});
	});
	// Structural checks on every table fragment.
	const extraHeaders = [];   // more than one repeated <thead> copy on a continued page
	const orphanHeaders = [];  // a table fragment showing its header but no body row
	const rowspanOverruns = []; // a cell spanning more rows than its page holds (its bottom edge is lost)
	pages.forEach((pg, p) => {
		pg.querySelectorAll(".pagedjs_page_content table").forEach((t) => {
			const id = t.getAttribute("data-table") || "table";
			if (t.querySelectorAll(":scope > thead[data-repeated-header]").length > 1) extraHeaders.push(`${id}@p${p + 1}`);
			const rows = Array.from(t.querySelectorAll(":scope > tbody > tr, :scope > tfoot > tr")).filter((tr) => tr.getBoundingClientRect().height > 0);
			if (t.querySelector(":scope > thead") && !rows.length) orphanHeaders.push(`${id}@p${p + 1}`);
			t.querySelectorAll(":scope > tbody").forEach((tb) => {
				const trs = Array.from(tb.rows);
				trs.forEach((tr, r) => Array.from(tr.cells).forEach((cell) => {
					if (cell.rowSpan > trs.length - r) rowspanOverruns.push(`${id}@p${p + 1} row ${tr.getAttribute("data-row")}`);
				}));
			});
		});
	});
	const ids = {};
	// Page content only: Paged.js itself clones running elements (position: running()) into every
	// page's margin boxes, ids and all.
	document.querySelectorAll(".pagedjs_page_content [id]").forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
	const duplicateIds = Object.keys(ids).filter((k) => ids[k] > 1);
	const unstableWidths = Object.entries(headerWidths)
		.filter(([, ws]) => new Set(ws).size > 1)
		.map(([id, ws]) => `${id}: ${ws.join("  ")}`);
	return {
		rowsVisible: Array.from(rowsVisible),
		rowsClipped: Array.from(rowsClipped),
		rowsDuplicated: Object.keys(rowStarts).filter((id) => rowStarts[id] > 1),
		extraHeaders,
		orphanHeaders,
		rowspanOverruns,
		duplicateIds,
		linesVisible: Array.from(linesVisible),
		missingThead,
		misalignedCells,
		unstableWidths,
	};
}
