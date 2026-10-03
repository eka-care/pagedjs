// Eka regression suite: `npm test` (in eka/, after `npm run build` at the repo root).
//   node run.mjs [--only <case-name>] [--verbose]
// Exit code 1 if any case fails in any page setup.
import fs from "fs";
import { chromium } from "playwright";
import cases from "./cases/index.mjs";
import { render, POLYFILL } from "./support/render.mjs";

// Default sweep: each top margin moves every page break, so a boundary bug can't hide.
const SWEEP = ["10mm", "16mm", "22mm", "28mm", "34mm", "40mm"].map((marginTop) => ({
	size: "A4", marginTop, marginSide: "15mm", marginBottom: "15mm",
}));

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const verbose = args.includes("--verbose");

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
		const cut = r.rowsClipped.filter((id) => visible.has(id));
		if (cut.length) f.push(`${cut.length} rows partly cut off (e.g. ${cut.slice(0, 5).join(",")})`);
	}
	if (e.lines) {
		const missing = e.lines - new Set(r.linesVisible).size;
		if (missing) f.push(`${missing}/${e.lines} lines of the tall row not printed`);
	}
	if (e.thead && r.missingThead.length) f.push(`no header on ${r.missingThead.length} page(s) (${r.missingThead.slice(0, 3).join(", ")})`);
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
	(verbose ? bad : bad.slice(0, 2)).forEach((x) => console.log(`        top ${x.page.marginTop} (${x.r.pages || "?"} pages): ${x.f.join("; ")}`));
}
await browser.close();
console.log(`\n${selected.length - failed}/${selected.length} cases pass`);
process.exit(failed ? 1 : 0);
