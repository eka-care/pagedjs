// Builders for test documents. Every body row gets data-row, every cell data-col, every long-content
// line data-line, so the checks in render.mjs can tell exactly what printed and where.

/** A block of `count` numbered lines, used to make a cell (and so its row) tall. */
export function lines(count, start = 0) {
	return Array.from({ length: count }, (_, i) => `<div data-line="${start + i}">Line ${start + i + 1} of the long cell — enough text to wrap.</div>`).join("");
}

/**
 * A table of `rows` body rows.
 * - groups: [{ label, size }] → a first column whose cells span `size` rows (rowspan)
 * - tall: { at, lines } → row `at` gets that many lines in its main cell (taller than a page if large)
 * - colgroup: ["12%", "68%", "20%"] → <colgroup> widths (use with table-layout: fixed)
 */
export function table({ id = "t1", rows, groups = null, tall = null, colgroup = null, thead = true, style = "" }) {
	const cols = groups ? ["Group", "Item", "Value"] : ["#", "Item", "Value"];
	const head = thead ? `<thead><tr>${cols.map((c, k) => `<th data-col="${k}">${c}</th>`).join("")}</tr></thead>` : "";
	const cg = colgroup ? `<colgroup>${colgroup.map((w) => `<col style="width:${w}">`).join("")}</colgroup>` : "";
	const groupStart = new Map();
	if (groups) {
		let r = 0;
		groups.forEach((g) => { groupStart.set(r, g); r += g.size; });
	}
	let body = "";
	for (let r = 0; r < rows; r++) {
		const g = groupStart.get(r);
		const first = groups
			? (g ? `<td data-col="0" rowspan="${g.size}">${g.label}</td>` : "")
			: `<td data-col="0">${r + 1}</td>`;
		const main = tall && tall.at === r ? `<div>Long row</div>${lines(tall.lines)}` : `Item ${r + 1}`;
		body += `<tr data-row="${r}">${first}<td data-col="1">${main}</td><td data-col="2">${(r * 37) % 900}</td></tr>`;
	}
	return `<table data-table="${id}" style="${style}">${cg}${head}<tbody>${body}</tbody></table>`;
}
