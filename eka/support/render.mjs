// Render one document with the fork's built polyfill and measure what actually prints.
//
// "Prints" means: inside a page's .pagedjs_area. Paged.js lays pages out in CSS columns, so content
// that doesn't fit can sit in a hidden overflow column — still in the DOM, never on paper. Counting
// DOM nodes would miss exactly the bugs this suite exists for, so every check here is geometric.
//
// Fixture conventions (see cases/*.mjs):
//   <table data-table="t1">, body rows <tr data-row="N">, cells/headers data-col="K",
//   long content lines <div data-line="N">.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const POLYFILL = path.resolve(here, "../../dist/paged.polyfill.js");
const TMP = path.resolve(here, "../.tmp");

export function documentHTML({ css, body, page }) {
	return `<!doctype html>
<html><head><meta charset="utf-8">
<script>window.PagedConfig = { auto: false };</script>
<script src="file://${POLYFILL}"></script>
<style>
@page { size: ${page.size}; margin: ${page.marginTop} ${page.marginSide} ${page.marginBottom} ${page.marginSide}; }
body { font: 12px/1.4 Arial, sans-serif; margin: 0; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #333; padding: 4px 6px; vertical-align: top; text-align: left; }
${css || ""}
</style></head>
<body>${body}</body></html>`;
}

export async function render(browser, doc, { timeoutMs = 25000 } = {}) {
	fs.mkdirSync(TMP, { recursive: true });
	const file = path.join(TMP, `doc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
	fs.writeFileSync(file, documentHTML(doc));
	const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
	const consoleErrors = [];
	page.on("console", (m) => { if (m.type() === "error" || /Layout repeated/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
	page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
	try {
		await page.goto("file://" + file);
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
	const unstableWidths = Object.entries(headerWidths)
		.filter(([, ws]) => new Set(ws).size > 1)
		.map(([id, ws]) => `${id}: ${ws.join("  ")}`);
	return {
		rowsVisible: Array.from(rowsVisible),
		rowsClipped: Array.from(rowsClipped),
		linesVisible: Array.from(linesVisible),
		missingThead,
		misalignedCells,
		unstableWidths,
	};
}
