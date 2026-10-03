// Pagify-sdk's table handler (pagify.js on main, verbatim): adds <thead> back after layout, hides
// empty tables, sets page content to max-content. Used to check the fork stays correct with it loaded.
(() => {
const { Handler, registerHandlers } = window.Paged;
class RepeatingTableHeaders extends Handler {
    constructor(chunker, polisher, caller) {
        super(chunker, polisher, caller);
    }

    beforePageLayout(page) {
        // console.log("page", page);
        // page.height = 200;
    }

    afterPageLayout(pageElement, page, breakToken, chunker) {
        // Find all split table elements
        let tables = pageElement.querySelectorAll("table[data-split-from]");

        tables.forEach((table) => {
            // There is an edge case where the previous page table
            // has zero height (isn't visible).
            // To avoid double header we will only add header if there is none.
            let tableHeader = table.querySelector("thead");
            if (tableHeader) {
                return;
            }

            // Get the reference UUID of the node
            let ref = table.dataset.ref;
            // Find the node in the original source
            let sourceTable = chunker.source.querySelector("[data-ref='" + ref + "']");

            // Find if there is a header
            let sourceHeader = sourceTable.querySelector("thead");
            if (sourceHeader) {
                console.log("Table header was cloned, because it is splitted.");
                // Clone the header element
                let clonedHeader = sourceHeader.cloneNode(true);
                // Insert the header at the start of the split table
                table.insertBefore(clonedHeader, table.firstChild);
            }
        });

        // Find all tables
        tables = pageElement.querySelectorAll("table");

        // special case which might not fit for everyone
        tables.forEach((table) => {
            // if the table has no rows in body, hide it.
            // This happens because my render engine creates empty tables.
            let sourceBody = table.querySelector("tbody > tr");
            if (!sourceBody) {
                console.log("Table was hidden, because it has no rows in tbody.");
                table.style.visibility = "hidden";
                table.style.position = "absolute";

                var lineSpacer = table.nextSibling;
                if (lineSpacer) {
                    lineSpacer.style.visibility = "hidden";
                    lineSpacer.style.position = "absolute";
                }
            }
        });
        try {
            // setting the page to show overflowing content
            let contents = pageElement.querySelectorAll(".pagedjs_page_content");
            contents.forEach((content) => {
                content.style.height = 'max-content';
            });
        } catch (e) {
            console.warn("Failed to set page content height to max-content", e);
        }
    }
}
registerHandlers(RepeatingTableHeaders);
})();
