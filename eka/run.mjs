// Eka regression suite: `npm test` (in eka/, after `npm run build` at the repo root).
//   node run.mjs [--only <case-name>] [--sweep fine] [--setup <size>:<top>,...] [--ignore-header] [--verbose]
// --setup reruns exact page setups, e.g. --setup A4:2mm,A5:40mm,A4_landscape:0mm
// --ignore-header skips the header check, to measure only lost/cut/misaligned content (e.g. when
// comparing against stock Paged.js, which never repeats headers).
// Exit code 1 if any case fails in any page setup.
import fs from "fs";
import { chromium } from "playwright";
import tableCases from "./cases/index.mjs";
import moreCases, { edgeCases } from "./cases/more.mjs";
import { render, POLYFILL } from "./support/render.mjs";

const cases = [...tableCases, ...moreCases, ...edgeCases];
const args = process.argv.slice(2);

// Each top margin moves every page break, so a boundary bug can't hide. The default sweep is quick;
// `--sweep fine` steps the margin by 2mm across four page sizes (84 setups per case).
const fine = args.includes("--sweep") && args[args.indexOf("--sweep") + 1] === "fine";
const setupArg = args.includes("--setup") ? args[args.indexOf("--setup") + 1] : null;
const SWEEP = setupArg
	? setupArg.split(",").map((s) => { const [size, marginTop] = s.split(":"); return { size: size.replace(/_/g, " "), marginTop, marginSide: "15mm", marginBottom: "15mm" }; })
	: fine
	? ["A4", "A5", "letter", "A4 landscape"].flatMap((size) =>
		Array.from({ length: 21 }, (_, i) => ({ size, marginTop: `${i * 2}mm`, marginSide: "15mm", marginBottom: "15mm" })))
	: ["10mm", "16mm", "22mm", "28mm", "34mm", "40mm"].map((marginTop) => ({
		size: "A4", marginTop, marginSide: "15mm", marginBottom: "15mm",
	}));
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const verbose = args.includes("--verbose");
const ignoreHeader = args.includes("--ignore-header");

if (!fs.existsSync(POLYFILL)) {
	console.error(`Missing ${POLYFILL} — run \`npm run build\` at the repo root first.`);
	process.exit(2);
}

function failures(c, r) {
	const f = [];
	const e = c.expect;
	if (!r.completed) f.push("did not finish (timeout)");
	if (r.consoleErrors.some((m) => /Layout repeated/.test(m))) f.push("'Layout repeated'");
	if (e.rows) {
		const visible = new Set(r.rowsVisible);
		const lost = [];
		for (let i = 0; i < e.rows; i++) if (!visible.has(String(i))) lost.push(i);
		if (lost.length) f.push(`${lost.length}/${e.rows} rows not printed (e.g. ${lost.slice(0, 5).join(",")})`);
		if (r.rowsDuplicated.length) f.push(`${r.rowsDuplicated.length} rows printed twice (e.g. ${r.rowsDuplicated.slice(0, 5).join(",")})`);
		const cut = r.rowsClipped.filter((id) => visible.has(id));
		if (cut.length) f.push(`${cut.length} rows partly cut off (e.g. ${cut.slice(0, 5).join(",")})`);
	}
	if (e.lines) {
		const missing = e.lines - new Set(r.linesVisible).size;
		if (missing) f.push(`${missing}/${e.lines} lines of the tall row not printed`);
	}
	// Structural checks, on every case.
	if (r.extraHeaders.length) f.push(`more than one repeated header on ${r.extraHeaders.length} page(s) (${r.extraHeaders[0]})`);
	if (r.orphanHeaders.length && !e.allowOrphanHeader) f.push(`header left alone at a page end (${r.orphanHeaders[0]})`);
	if (r.rowspanOverruns.length) f.push(`${r.rowspanOverruns.length} rowspan cells overrun their page (e.g. ${r.rowspanOverruns[0]})`);
	if (r.duplicateIds.length) f.push(`duplicate ids: ${r.duplicateIds.slice(0, 3).join(", ")}`);
	if (e.thead && !ignoreHeader && r.missingThead.length) f.push(`no header on ${r.missingThead.length} page(s) (${r.missingThead.slice(0, 3).join(", ")})`);
	if (e.aligned && r.misalignedCells.length) f.push(`${r.misalignedCells.length} cells out of their column (e.g. ${r.misalignedCells[0]})`);
	if (e.stableWidths && r.unstableWidths.length) f.push(`column widths change across pages (${r.unstableWidths[0]})`);
	return f;
}

const browser = await chromium.launch();
let failed = 0;
const selected = cases.filter((c) => !only || c.name === only);
for (const c of selected) {
	const setups = c.pages || SWEEP;
	const results = [];
	for (const page of setups) {
		const r = await render(browser, { css: c.css, body: c.body, page });
		results.push({ page, f: failures(c, r), r });
	}
	const bad = results.filter((x) => x.f.length);
	if (bad.length) failed++;
	console.log(`${bad.length ? "FAIL" : "pass"}  ${c.name.padEnd(28)} ${setups.length - bad.length}/${setups.length} setups`);
	(verbose ? bad : bad.slice(0, 2)).forEach((x) => console.log(`        ${x.page.size} top ${x.page.marginTop} (${x.r.pages || "?"} pages): ${x.f.join("; ")}`));
}
await browser.close();
console.log(`\n${selected.length - failed}/${selected.length} cases pass`);
process.exit(failed ? 1 : 0);
