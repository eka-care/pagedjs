// Stock Paged.js 0.4.3 — the baseline the fork is compared against (upstream-specs.mjs, perf.mjs, and
// `PAGEDJS_POLYFILL=$(node support/stock.mjs) node run.mjs --ignore-header`).
// Downloaded once into .tmp/ and checked against the hash of the published npm package.
// Run directly, it prints the file's path.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STOCK = path.resolve(here, "../.tmp/stock-0.4.3.js");
// sha256 of dist/paged.polyfill.js in pagedjs-0.4.3.tgz (npm registry)
const SHA256 = "f59f361802416c770d549a647958649af2cf6601999924bc00e4f507dad5269f";
const MIRRORS = [
	"https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js",
	"https://cdn.jsdelivr.net/npm/pagedjs@0.4.3/dist/paged.polyfill.js",
];

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export async function ensureStock() {
	if (fs.existsSync(STOCK) && sha(fs.readFileSync(STOCK)) === SHA256) {
		return STOCK;
	}
	for (const url of MIRRORS) {
		try {
			const res = await fetch(url);
			const buf = Buffer.from(await res.arrayBuffer());
			if (res.ok && sha(buf) === SHA256) {
				fs.mkdirSync(path.dirname(STOCK), { recursive: true });
				fs.writeFileSync(STOCK, buf);
				return STOCK;
			}
		} catch {
			// try the next mirror
		}
	}
	throw new Error("Could not download stock Paged.js 0.4.3 with the expected hash");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	console.log(await ensureStock());
}
