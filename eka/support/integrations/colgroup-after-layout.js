// The same after-layout pattern for <colgroup> (as some integrations use): adds the
// source table's <colgroup> back to a split table when it has none. Used to check the fork stays
// correct with such a handler loaded.
(() => {
	class RepeatingColgroups extends Paged.Handler {
		afterPageLayout(pageElement, page, breakToken, chunker) {
			pageElement.querySelectorAll("table[data-split-from]").forEach((table) => {
				if (table.querySelector("colgroup")) {
					return;
				}
				const source = chunker.source.querySelector("[data-ref='" + table.dataset.ref + "']");
				const colgroup = source && source.querySelector("colgroup");
				if (colgroup) {
					table.insertBefore(colgroup.cloneNode(true), table.firstChild);
				}
			});
			pageElement.querySelectorAll(".pagedjs_page_content").forEach((content) => {
				content.style.height = "max-content";
			});
		}
	}
	Paged.registerHandlers(RepeatingColgroups);
})();
