// Unit checks for the fork's layout helpers, run on a real Paged.js page (a real Layout instance
// and page area) with a hand-built DOM — for situations Chrome only produces at knife-edge
// geometries, which the document cases can't trigger on demand.
//   node unit/layout-units.mjs     (after `npm run build` at the repo root)
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "playwright";
import { POLYFILL } from "../support/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.resolve(here, "../.tmp");
fs.mkdirSync(TMP, { recursive: true });
const file = path.join(TMP, `units-${process.pid}.html`);
fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8">
<script>window.PagedConfig = { auto: false };</script>
<script src="${pathToFileURL(POLYFILL).href}"></script>
<style>@page { size: A4; margin: 20mm 15mm; } body { font: 12px/1.4 Arial; margin: 0; }
table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #333; padding: 4px 6px; }</style>
</head><body><p>placeholder</p></body></html>`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => window.PagedPolyfill.preview());

const results = await page.evaluate(() => {
	const out = [];
	const pg = window.PagedPolyfill.chunker.pages[0];
	const layout = pg.layoutMethod;
	const wrapper = pg.wrapper;
	const lines = (n, from = 0) => Array.from({ length: n }, (_, i) => `<div data-line="${from + i}">Line ${from + i + 1}</div>`).join("");
	const head = "<thead data-repeated-header><tr><th>Item</th><th>Value</th></tr></thead>";
	const check = (name, ok, detail) => out.push({ name, ok, detail });

	// forceBreakInside: the overflow starts at a <tbody> whose first row is taller than the page and
	// is followed by more rows. The cut must be measured on what stays (the row's leading lines),
	// not on the whole tbody — the rows after it don't stay on this page.
	wrapper.innerHTML = `<table>${head}<tbody><tr><td>${lines(80)}</td><td>x</td></tr><tr style="height:2000px"><td>tall next row</td><td>y</td></tr></tbody></table>`;
	const tbody = wrapper.querySelector("tbody");
	let overflow = document.createRange();
	overflow.setStartBefore(tbody);
	overflow.setEndAfter(wrapper.lastChild);
	const displayBefore = Array.from(wrapper.querySelectorAll("*")).map((el) => el.style.display).join("|");
	const cut = layout.forceBreakInside(overflow, wrapper, layout.bounds);
	const displayAfter = Array.from(wrapper.querySelectorAll("*")).map((el) => el.style.display).join("|");
	const cutAt = cut && cut.startContainer.childNodes[cut.startOffset];
	const cutLine = cutAt && cutAt.dataset ? Number(cutAt.dataset.line) : null;
	check("forceBreakInside cuts a tall first row even when more rows follow it", cutLine !== null && cutLine > 0 && cutLine < 80, `cut before line ${cutLine}`);
	check("forceBreakInside restores every display it changed", displayBefore === displayAfter, "");
	if (cutLine !== null) {
		// What stays must actually fit: remove from the cut onwards and measure the last kept line.
		cut.extractContents();
		const kept = wrapper.querySelectorAll("[data-line]");
		const last = kept[kept.length - 1].getBoundingClientRect();
		check("the lines kept on the page are inside the page area", last.left < layout.bounds.right && last.bottom <= layout.bounds.bottom + 1, `${kept.length} lines kept`);
	}

	// hasContentBefore: a repeated <colgroup> + <thead> are not content.
	wrapper.innerHTML = `<table><colgroup data-repeated-header><col></colgroup>${head}<tbody><tr><td>${lines(3)}</td><td>z</td></tr></tbody></table>`;
	overflow = document.createRange();
	overflow.setStartBefore(wrapper.querySelector("tbody"));
	overflow.setEndAfter(wrapper.lastChild);
	check("hasContentBefore ignores a repeated colgroup + thead", layout.hasContentBefore(overflow, wrapper) === false, "");
	return out;
});
await browser.close();
fs.rmSync(file, { force: true });

let failed = 0;
for (const r of results) {
	if (!r.ok) failed++;
	console.log(`${r.ok ? "pass" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} unit checks pass`);
process.exit(failed ? 1 : 0);
