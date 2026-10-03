// More document shapes: table variants that real prescriptions/bills/charts use, and plain
// flowing content (paragraphs, lists) so the table fixes can't regress ordinary text.
import { table, lines } from "../support/fixtures.mjs";

const AVOID = "tr { break-inside: avoid; }";
const head3 = (labels = ["#", "Item", "Value"]) => `<thead><tr>${labels.map((l, k) => `<th data-col="${k}">${l}</th>`).join("")}</tr></thead>`;
const row = (r, a, b, c) => `<tr data-row="${r}"><td data-col="0">${a}</td><td data-col="1">${b}</td><td data-col="2">${c}</td></tr>`;

function colspanSections() {
	// Section header rows spanning all columns (e.g. "Morning medicines") between data rows.
	let body = "", r = 0;
	for (let s = 0; s < 6; s++) {
		body += `<tr><td colspan="3"><b>Section ${s + 1}</b></td></tr>`;
		for (let i = 0; i < 18; i++, r++) body += row(r, r + 1, `Item ${r + 1}`, (r * 13) % 500);
	}
	return { html: `<table data-table="t1">${head3()}<tbody>${body}</tbody></table>`, rows: r };
}

function multiTbody() {
	let body = "", r = 0;
	for (let g = 0; g < 3; g++) {
		body += "<tbody>";
		for (let i = 0; i < 40; i++, r++) body += row(r, r + 1, `Group ${g + 1} item ${i + 1}`, (r * 7) % 300);
		body += "</tbody>";
	}
	return { html: `<table data-table="t1">${head3()}${body}</table>`, rows: r };
}

function captionAndTfoot() {
	let body = "";
	for (let r = 0; r < 110; r++) body += row(r, r + 1, `Charge ${r + 1}`, (r * 19) % 700);
	return {
		html: `<table data-table="t1"><caption>Invoice lines</caption>${head3(["#", "Charge", "Amount"])}<tbody>${body}</tbody><tfoot><tr><td colspan="2">Total</td><td>99,999</td></tr></tfoot></table>`,
		rows: 110,
	};
}

function nestedTable() {
	// Each outer row carries a small inner table (e.g. a dosage schedule).
	let body = "";
	for (let r = 0; r < 45; r++) {
		const inner = `<table><tbody><tr><td>Morning</td><td>1</td></tr><tr><td>Night</td><td>1</td></tr></tbody></table>`;
		body += `<tr data-row="${r}"><td data-col="0">${r + 1}</td><td data-col="1">Medicine ${r + 1}${inner}</td><td data-col="2">${r % 9} days</td></tr>`;
	}
	return { html: `<table data-table="t1">${head3(["#", "Medicine", "Duration"])}<tbody>${body}</tbody></table>`, rows: 45 };
}

function tableNearBottom() {
	// Enough paragraphs to fill most of the first page, then a long table.
	const paras = Array.from({ length: 34 }, (_, i) => `<p data-line="${i}">Paragraph ${i + 1}: notes before the table that push it towards the bottom of the first page.</p>`).join("");
	return { html: paras + table({ rows: 60 }), rows: 60, lines: 34 };
}

function twoTables() {
	const a = table({ id: "t1", rows: 50 });
	// Second table numbers its rows after the first so ids stay unique.
	let body = "";
	for (let r = 50; r < 110; r++) body += row(r, r + 1, `Second table item ${r - 49}`, (r * 3) % 200);
	return { html: a + `<p>Between the tables</p><table data-table="t2">${head3()}<tbody>${body}</tbody></table>`, rows: 110 };
}

function imageCells() {
	// Fixed-height blocks stand in for images (no network): rows of uneven, unbreakable heights.
	let body = "";
	for (let r = 0; r < 40; r++) {
		const h = 40 + ((r * 37) % 110);
		body += `<tr data-row="${r}"><td data-col="0">${r + 1}</td><td data-col="1"><div style="height:${h}px;background:#ddd">image ${r + 1} (${h}px)</div></td><td data-col="2">${h}</td></tr>`;
	}
	return { html: `<table data-table="t1">${head3(["#", "Scan", "Height"])}<tbody>${body}</tbody></table>`, rows: 40 };
}

const c1 = colspanSections(), c2 = multiTbody(), c3 = captionAndTfoot(), c4 = nestedTable(), c5 = tableNearBottom(), c6 = twoTables(), c7 = imageCells();

export default [
	{ name: "colspan-section-rows", about: "Full-width section rows between data rows.", body: c1.html, expect: { rows: c1.rows, thead: true, aligned: true } },
	{ name: "colspan-section-rows-avoid", about: "Same with rows kept whole.", css: AVOID, body: c1.html, expect: { rows: c1.rows, thead: true, aligned: true } },
	{ name: "multiple-tbodies", about: "Three <tbody> groups in one table.", body: c2.html, expect: { rows: c2.rows, thead: true, aligned: true } },
	{ name: "caption-and-tfoot", about: "A captioned table with a totals <tfoot>.", body: c3.html, expect: { rows: c3.rows, thead: true, aligned: true } },
	{ name: "nested-tables", about: "Each row holds a small inner table.", css: AVOID, body: c4.html, expect: { rows: c4.rows, thead: true } },
	{ name: "table-near-bottom", about: "Paragraphs fill the first page, the table starts near its bottom.", body: c5.html, expect: { rows: c5.rows, lines: c5.lines, thead: true, aligned: true } },
	{ name: "two-tables", about: "Two long tables back to back.", css: AVOID, body: c6.html, expect: { rows: c6.rows, thead: true, aligned: true } },
	{ name: "image-height-cells", about: "Rows of uneven unbreakable heights (image stand-ins).", css: AVOID, body: c7.html, expect: { rows: c7.rows, thead: true, aligned: true } },
	{ name: "long-paragraphs", about: "Plain flowing text across several pages.", body: Array.from({ length: 120 }, (_, i) => `<p data-line="${i}">Paragraph ${i + 1}. ${"Clinical notes continue across the page with ordinary sentences. ".repeat(3)}</p>`).join(""), expect: { lines: 120 } },
	{ name: "long-list", about: "A bulleted list across pages.", body: `<ul>${Array.from({ length: 160 }, (_, i) => `<li data-line="${i}">Instruction ${i + 1}: take with water after food.</li>`).join("")}</ul>`, expect: { lines: 160 } },
	{ name: "colgroup-tall-row-avoid", about: "A <colgroup> table with a row taller than a page, rows kept whole: the repeated colgroup and thead must not count as page content.", css: AVOID, body: table({ rows: 40, tall: { at: 11, lines: 70 }, colgroup: ["12%", "68%", "20%"], style: "table-layout: fixed" }), expect: { rows: 40, lines: 70, thead: true, stableWidths: true } },
	{ name: "tall-row-in-long-table-avoid", about: "A 2-page row in the middle of a 100-row table, rows kept whole.", css: AVOID, body: table({ rows: 100, tall: { at: 47, lines: 140 } }), expect: { rows: 100, lines: 140, thead: true, aligned: true } },
];

export { lines };
