// Regression cases. Each renders across a sweep of page setups (top margins shift every page
// break), and passes only if every setup passes. `expect` lists what must hold.
import { table } from "../support/fixtures.mjs";

const AVOID = "tr { break-inside: avoid; }";

export default [
	{
		name: "long-table",
		about: "120 plain rows with a <thead>: every row prints, header on every page.",
		body: table({ rows: 120 }),
		expect: { rows: 120, thead: true, aligned: true },
	},
	{
		name: "long-table-rows-avoid",
		about: "Same, with tr { break-inside: avoid } (what Pagify ships).",
		css: AVOID,
		body: table({ rows: 120 }),
		expect: { rows: 120, thead: true, aligned: true },
	},
	{
		name: "colgroup-widths",
		about: "Fixed layout whose column widths come from <colgroup>: widths identical on every page.",
		body: table({ rows: 120, colgroup: ["12%", "68%", "20%"], style: "table-layout: fixed" }),
		expect: { rows: 120, thead: true, stableWidths: true },
	},
	{
		name: "rowspan-groups",
		about: "Three rowspan groups (30/25/35 rows) crossing page breaks: nothing lost, every column aligned.",
		body: table({ rows: 90, groups: [{ label: "Morning", size: 30 }, { label: "Lunch", size: 25 }, { label: "Dinner", size: 35 }] }),
		expect: { rows: 90, thead: true, aligned: true },
	},
	{
		name: "rowspan-groups-rows-avoid",
		about: "Rowspan groups with tr { break-inside: avoid }.",
		css: AVOID,
		body: table({ rows: 90, groups: [{ label: "Morning", size: 30 }, { label: "Lunch", size: 25 }, { label: "Dinner", size: 35 }] }),
		expect: { rows: 90, thead: true, aligned: true },
	},
	{
		name: "tall-row",
		about: "One row taller than a page (70 lines): it continues on the next page, every line prints.",
		body: table({ rows: 40, tall: { at: 11, lines: 70 } }),
		expect: { rows: 40, lines: 70, thead: true },
	},
	{
		name: "tall-row-rows-avoid",
		about: "Same tall row under tr { break-inside: avoid }: must not loop ('Layout repeated') or drop rows.",
		css: AVOID,
		body: table({ rows: 40, tall: { at: 11, lines: 70 } }),
		expect: { rows: 40, lines: 70, thead: true },
	},
	{
		name: "tall-row-two-pages",
		about: "A row spanning about two pages (140 lines).",
		body: table({ rows: 40, tall: { at: 11, lines: 140 } }),
		expect: { rows: 40, lines: 140, thead: true },
	},
	{
		name: "diet-chart",
		about: "The real-world shape: one rowspan group over 80 rows, a tall row inside it, rows kept whole.",
		css: AVOID,
		body: table({ rows: 80, groups: [{ label: "Breakfast", size: 80 }], tall: { at: 28, lines: 70 } }),
		expect: { rows: 80, lines: 70, thead: true, aligned: true },
	},
	{
		name: "paragraph-cells-351",
		about: "Upstream issue #351's document (cells with paragraphs, A4 landscape). Control: 0.4.3 passes this.",
		pages: [{ size: "297mm 210mm", marginTop: "2cm", marginSide: "1.5cm", marginBottom: "2cm" }],
		body: (() => {
			const P = "<p>The quality management system shall be established, implemented, maintained and continually improved, including the processes needed and their interactions, in accordance with the requirements of this International Standard.</p>";
			let rows = "";
			for (let i = 0; i < 30; i++) rows += `<tr data-row="${i}"><td data-col="0">${i + 1}</td><td data-col="1">Short ${i + 1}</td><td data-col="2">${P.repeat(3)}</td></tr>`;
			return `<table data-table="t1"><thead><tr><th data-col="0">#</th><th data-col="1">Left cell</th><th data-col="2">Right cell</th></tr></thead><tbody>${rows}</tbody></table>`;
		})(),
		expect: { rows: 30, thead: true, aligned: true },
	},
];
