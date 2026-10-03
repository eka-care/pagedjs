// "Nothing should break": render every upstream spec document (specs/**/*.html — footnotes, named
// pages, counters, margin boxes, columns, tables, …) with stock 0.4.3 and with this build, and
// compare what is VISIBLE inside the page areas. This build must never show fewer words than stock,
// and must not add page errors or "Layout repeated".
//   node upstream-specs.mjs --stock <path/to/stock/paged.polyfill.js> [--only <substring>]
// (after `npm run build` at the repo root)
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const stockPath = args.includes("--stock") ? path.resolve(args[args.indexOf("--stock") + 1]) : null;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (!stockPath || !fs.existsSync(stockPath)) {
	console.error("Pass --stock <path to stock 0.4.3 paged.polyfill.js>");
	process.exit(2);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json" };
let build = "fork"; // which polyfill /dist/paged.polyfill.js serves
const server = http.createServer((req, res) => {
	let url = decodeURIComponent(req.url.split("?")[0]);
	let file = url === "/dist/paged.polyfill.js" && build === "stock" ? stockPath : path.join(root, url);
	if (!file.startsWith(root) && file !== stockPath) { res.writeHead(403); return res.end(); }
	fs.readFile(file, (err, data) => {
		if (err) { res.writeHead(404); return res.end(); }
		res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
		res.end(data);
	});
});
await new Promise((r) => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;

const specs = [];
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory() && !e.name.startsWith("__")) walk(p);
		else if (e.name.endsWith(".html") && e.name !== "index.html") specs.push(path.relative(root, p));
	}
})(path.join(root, "specs"));

async function renderSpec(browser, spec) {
	const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
	page.on("console", (m) => { if (/Layout repeated/.test(m.text())) errors.push("Layout repeated"); });
	try {
		await page.goto(`${origin}/${spec}`, { waitUntil: "load", timeout: 30000 });
		// Wait until the page count stops changing (auto-run polyfill), up to 20s.
		let last = -1, stable = 0;
		for (let i = 0; i < 80 && stable < 4; i++) {
			await page.waitForTimeout(250);
			const n = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
			stable = n === last && n > 0 ? stable + 1 : 0;
			last = n;
		}
		const words = await page.evaluate(() => {
			const out = [];
			document.querySelectorAll(".pagedjs_page").forEach((pg) => {
				const areaEl = pg.querySelector(".pagedjs_area");
				const content = pg.querySelector(".pagedjs_page_content");
				if (!areaEl || !content) return;
				const a = areaEl.getBoundingClientRect();
				const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
					acceptNode: (n) => n.parentElement && n.parentElement.closest("[data-repeated-header]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
				});
				let n;
				while ((n = walker.nextNode())) {
					if (!n.textContent.trim()) continue;
					const range = document.createRange();
					range.selectNodeContents(n);
					const visible = Array.from(range.getClientRects()).some((r) => r.width > 0 && r.left >= a.left - 1 && r.right <= a.right + 1 && r.top >= a.top - 1 && r.bottom <= a.bottom + 1);
					if (visible) out.push(...n.textContent.trim().split(/\s+/));
				}
			});
			return out;
		});
		return { pages: last, words, errors };
	} catch (e) {
		return { pages: 0, words: [], errors: [String(e).slice(0, 120)] };
	} finally {
		await page.close();
	}
}

const count = (ws) => ws.reduce((m, w) => (m[w] = (m[w] || 0) + 1, m), {});
const browser = await chromium.launch();
let worse = 0, compared = 0;
for (const spec of specs.filter((s) => !only || s.includes(only))) {
	build = "stock"; const a = await renderSpec(browser, spec);
	build = "fork"; const b = await renderSpec(browser, spec);
	compared++;
	const ca = count(a.words), cb = count(b.words);
	const lost = Object.keys(ca).reduce((n, w) => n + Math.max(0, ca[w] - (cb[w] || 0)), 0);
	const newErrors = b.errors.filter((e) => !a.errors.includes(e));
	const flag = lost > 0 || newErrors.length;
	if (flag) worse++;
	if (flag || args.includes("--verbose")) {
		console.log(`${flag ? "WORSE" : "ok   "}  ${spec}  pages ${a.pages}→${b.pages}  words ${a.words.length}→${b.words.length}${lost ? `  LOST ${lost}` : ""}${newErrors.length ? `  NEW ERRORS ${newErrors.join("; ")}` : ""}`);
	}
}
await browser.close();
server.close();
console.log(`\n${compared - worse}/${compared} upstream spec documents: this build shows everything stock shows, with no new errors`);
process.exit(worse ? 1 : 0);
