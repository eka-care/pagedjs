// Pagination time, this build vs stock 0.4.3: median of 7 renders per page (A4, 16mm top margin).
//   node perf.mjs [--only <page-name>]
// A slower result where stock is faster only because it gives up ("Layout repeated", content
// dropped) is expected; anything else slower needs a reason.
import { chromium } from "playwright";
import { render, POLYFILL } from "./support/render.mjs";
import { ensureStock } from "./support/stock.mjs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const PAGES = ["long-table", "long-table-rows-avoid", "diet-chart", "diet-chart-product", "tall-row-two-pages", "nested-tables", "long-paragraphs"]
	.filter((n) => !only || n === only);
const SETUP = { size: "A4", marginTop: "16mm", marginSide: "15mm", marginBottom: "15mm" };

async function time(polyfill) {
	const browser = await chromium.launch();
	const out = {};
	for (const name of PAGES) {
		const times = [];
		for (let i = 0; i < 7; i++) {
			const t0 = performance.now();
			await render(browser, { name, page: SETUP, polyfill });
			times.push(performance.now() - t0);
		}
		times.sort((a, b) => a - b);
		out[name] = Math.round(times[3]);
	}
	await browser.close();
	return out;
}

const fork = await time(POLYFILL);
const stock = await time(await ensureStock());
console.log("page".padEnd(24), "this build", "  stock 0.4.3");
for (const name of PAGES) {
	console.log(name.padEnd(24), `${fork[name]} ms`.padStart(10), `${stock[name]} ms`.padStart(14));
}
