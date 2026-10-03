import { getBoundingClientRect, getClientRects } from "../utils/utils.js";
import {
	breakInsideAvoidParentNode,
	child,
	cloneNode,
	findElement,
	hasContent,
	indexOf,
	indexOfTextNode,
	isContainer,
	isElement,
	isText,
	letters,
	needsBreakBefore,
	needsPageBreak,
	needsPreviousBreakAfter,
	nodeAfter,
	nodeBefore,
	parentOf,
	prevValidNode,
	rebuildAncestors,
	validNode,
	walk,
	words
} from "../utils/dom.js";
import BreakToken from "./breaktoken.js";
import RenderResult, { OverflowContentError } from "./renderresult.js";
import EventEmitter from "event-emitter";
import Hook from "../utils/hook.js";

const MAX_CHARS_PER_BREAK = 1500;

/**
 * Layout
 * @class
 */
class Layout {

	constructor(element, hooks, options) {
		this.element = element;

		this.bounds = this.element.getBoundingClientRect();
		this.parentBounds = this.element.offsetParent.getBoundingClientRect();
		let gap = parseFloat(window.getComputedStyle(this.element).columnGap);
	
		if (gap) {
			let leftMargin = this.bounds.left - this.parentBounds.left;
			this.gap =  gap - leftMargin;	
		} else {
			this.gap = 0;
		}

		if (hooks) {
			this.hooks = hooks;
		} else {
			this.hooks = {};
			this.hooks.onPageLayout = new Hook();
			this.hooks.layout = new Hook();
			this.hooks.renderNode = new Hook();
			this.hooks.layoutNode = new Hook();
			this.hooks.beforeOverflow = new Hook();
			this.hooks.onOverflow = new Hook();
			this.hooks.afterOverflowRemoved = new Hook();
			this.hooks.onBreakToken = new Hook();
			this.hooks.beforeRenderResult = new Hook();
		}

		this.settings = options || {};

		this.maxChars = this.settings.maxChars || MAX_CHARS_PER_BREAK;
		this.forceRenderBreak = false;
	}

	async renderTo(wrapper, source, breakToken, bounds = this.bounds) {
		let start = this.getStart(source, breakToken);
		let walker = walk(start, source);

		let node;
		let prevNode;
		let done;
		let next;

		let hasRenderedContent = false;
		let newBreakToken;

		let length = 0;

		let prevBreakToken = breakToken || new BreakToken(start);

		this.hooks && this.hooks.onPageLayout.trigger(wrapper, prevBreakToken, this);

		while (!done && !newBreakToken) {
			next = walker.next();
			prevNode = node;
			node = next.value;
			done = next.done;

			if (!node) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakToken = this.findBreakToken(wrapper, source, bounds, prevBreakToken);

				if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
					console.warn("Unable to layout item: ", prevNode);
					this.clampRowspans(wrapper);
					this.hooks && this.hooks.beforeRenderResult.trigger(undefined, wrapper, this);
					return new RenderResult(undefined, new OverflowContentError("Unable to layout item", [prevNode]));
				}

				this.rebuildTableFromBreakToken(newBreakToken, wrapper);

				this.clampRowspans(wrapper);
				this.hooks && this.hooks.beforeRenderResult.trigger(newBreakToken, wrapper, this);
				return new RenderResult(newBreakToken);
			}

			this.hooks && this.hooks.layoutNode.trigger(node);

			// Check if the rendered element has a break set
			if (hasRenderedContent && this.shouldBreak(node, start)) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakToken = this.findBreakToken(wrapper, source, bounds, prevBreakToken);

				if (!newBreakToken) {
					newBreakToken = this.breakAt(node);
				} else {
					this.rebuildTableFromBreakToken(newBreakToken, wrapper);
				}

				if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
					console.warn("Unable to layout item: ", node);
					let after = newBreakToken.node && nodeAfter(newBreakToken.node);
					if (after) {
						newBreakToken = new BreakToken(after);
					} else {
						return new RenderResult(undefined, new OverflowContentError("Unable to layout item", [node]));
					}
				}

				length = 0;

				break;
			}

			if (node.dataset && node.dataset.page) {
				let named = node.dataset.page;
				let page = this.element.closest(".pagedjs_page");
				page.classList.add("pagedjs_named_page");
				page.classList.add("pagedjs_" + named + "_page");

				if (!node.dataset.splitFrom) {
					page.classList.add("pagedjs_" + named + "_first_page");
				}
			}

			// Should the Node be a shallow or deep clone
			let shallow = isContainer(node);

			let rendered = this.append(node, wrapper, breakToken, shallow);

			length += rendered.textContent.length;

			// Check if layout has content yet
			if (!hasRenderedContent) {
				hasRenderedContent = hasContent(node);
			}

			// Skip to the next node if a deep clone was rendered
			if (!shallow) {
				walker = walk(nodeAfter(node, source), source);
			}

			if (this.forceRenderBreak) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				newBreakToken = this.findBreakToken(wrapper, source, bounds, prevBreakToken);

				if (!newBreakToken) {
					newBreakToken = this.breakAt(node);
				} else {
					this.rebuildTableFromBreakToken(newBreakToken, wrapper);
				}

				length = 0;
				this.forceRenderBreak = false;

				break;
			}

			// Only check x characters
			if (length >= this.maxChars) {

				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				newBreakToken = this.findBreakToken(wrapper, source, bounds, prevBreakToken);

				if (newBreakToken) {
					length = 0;
					this.rebuildTableFromBreakToken(newBreakToken, wrapper);
				}

				if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
					console.warn("Unable to layout item: ", node);
					let after = newBreakToken.node && nodeAfter(newBreakToken.node);
					if (after) {
						newBreakToken = new BreakToken(after);
					} else {
						this.clampRowspans(wrapper);
						this.hooks && this.hooks.beforeRenderResult.trigger(undefined, wrapper, this);
						return new RenderResult(undefined, new OverflowContentError("Unable to layout item", [node]));
					}
				}
			}

		}

		this.clampRowspans(wrapper);
		this.hooks && this.hooks.beforeRenderResult.trigger(newBreakToken, wrapper, this);
		return new RenderResult(newBreakToken);
	}

	breakAt(node, offset = 0) {
		let newBreakToken = new BreakToken(
			node,
			offset
		);
		let breakHooks = this.hooks.onBreakToken.triggerSync(newBreakToken, undefined, node, this);
		breakHooks.forEach((newToken) => {
			if (typeof newToken != "undefined") {
				newBreakToken = newToken;
			}
		});

		return newBreakToken;
	}

	shouldBreak(node, limiter) {
		let previousNode = nodeBefore(node, limiter);
		let parentNode = node.parentNode;
		let parentBreakBefore = needsBreakBefore(node) && parentNode && !previousNode && needsBreakBefore(parentNode);
		let doubleBreakBefore;

		if (parentBreakBefore) {
			doubleBreakBefore = node.dataset.breakBefore === parentNode.dataset.breakBefore;
		}

		return !doubleBreakBefore && needsBreakBefore(node) || needsPreviousBreakAfter(node) || needsPageBreak(node, previousNode);
	}

	forceBreak() {
		this.forceRenderBreak = true;
	}

	getStart(source, breakToken) {
		let start;
		let node = breakToken && breakToken.node;

		if (node) {
			start = node;
		} else {
			start = source.firstChild;
		}

		return start;
	}

	append(node, dest, breakToken, shallow = true, rebuild = true) {

		let clone = cloneNode(node, !shallow);

		if (node.parentNode && isElement(node.parentNode)) {
			let parent = findElement(node.parentNode, dest);
			// Rebuild chain
			if (parent) {
				parent.appendChild(clone);
			} else if (rebuild) {
				let fragment = rebuildAncestors(node);
				parent = findElement(node.parentNode, fragment);
				if (!parent) {
					dest.appendChild(clone);
				} else if (breakToken && isText(breakToken.node) && breakToken.offset > 0) {
					clone.textContent = clone.textContent.substring(breakToken.offset);
					parent.appendChild(clone);
				} else {
					parent.appendChild(clone);
				}

				dest.appendChild(fragment);
			} else {
				dest.appendChild(clone);
			}


		} else {
			dest.appendChild(clone);
		}

		if (clone.dataset && clone.dataset.ref) {
			if (!dest.indexOfRefs) {
				dest.indexOfRefs = {};
			}
			dest.indexOfRefs[clone.dataset.ref] = clone;
		}

		let nodeHooks = this.hooks.renderNode.triggerSync(clone, node, this);
		nodeHooks.forEach((newNode) => {
			if (typeof newNode != "undefined") {
				clone = newNode;
			}
		});

		return clone;
	}

	rebuildTableFromBreakToken(breakToken, dest) {
		if (!breakToken || !breakToken.node) {
			return;
		}
		let node = breakToken.node;
		let td = isElement(node) ? node.closest("td") : node.parentElement.closest("td");
		if (td) {
			let rendered = findElement(td, dest, true);
			if (!rendered) {
				return;
			}
			while ((td = td.nextElementSibling)) {
				this.append(td, dest, null, true);
			}
		}
	}

	async waitForImages(imgs) {
		let results = Array.from(imgs).map(async (img) => {
			return this.awaitImageLoaded(img);
		});
		await Promise.all(results);
	}

	async awaitImageLoaded(image) {
		return new Promise(resolve => {
			if (image.complete !== true) {
				image.onload = function () {
					let {width, height} = window.getComputedStyle(image);
					resolve(width, height);
				};
				image.onerror = function (e) {
					let {width, height} = window.getComputedStyle(image);
					resolve(width, height, e);
				};
			} else {
				let {width, height} = window.getComputedStyle(image);
				resolve(width, height);
			}
		});
	}

	avoidBreakInside(node, limiter) {
		let breakNode;

		if (node === limiter) {
			return;
		}

		while (node.parentNode) {
			node = node.parentNode;

			if (node === limiter) {
				break;
			}

			if (window.getComputedStyle(node)["break-inside"] === "avoid") {
				breakNode = node;
				break;
			}

		}
		return breakNode;
	}

	createBreakToken(overflow, rendered, source) {
		let container = overflow.startContainer;
		let offset = overflow.startOffset;
		let node, renderedNode, parent, index, temp;

		if (isElement(container)) {
			temp = child(container, offset);

			if (isElement(temp)) {
				renderedNode = findElement(temp, rendered);

				if (!renderedNode) {
					// Find closest element with data-ref
					let prevNode = prevValidNode(temp);
					if (!isElement(prevNode)) {
						prevNode = prevNode.parentElement;
					}
					renderedNode = findElement(prevNode, rendered);
					// Check if temp is the last rendered node at its level.
					if (!temp.nextSibling) {
						// We need to ensure that the previous sibling of temp is fully rendered.
						const renderedNodeFromSource = findElement(renderedNode, source);
						const walker = document.createTreeWalker(renderedNodeFromSource, NodeFilter.SHOW_ELEMENT);
						const lastChildOfRenderedNodeFromSource = walker.lastChild();
						const lastChildOfRenderedNodeMatchingFromRendered = findElement(lastChildOfRenderedNodeFromSource, rendered);
						// Check if we found that the last child in source
						if (!lastChildOfRenderedNodeMatchingFromRendered) {
							// Pending content to be rendered before virtual break token
							return;
						}
						// Otherwise we will return a break token as per below
					}
					// renderedNode is actually the last unbroken box that does not overflow.
					// Break Token is therefore the next sibling of renderedNode within source node.
					node = findElement(renderedNode, source).nextSibling;
					offset = 0;
				} else {
					node = findElement(renderedNode, source);
					offset = 0;
				}
			} else {
				renderedNode = findElement(container, rendered);

				if (!renderedNode) {
					renderedNode = findElement(prevValidNode(container), rendered);
				}

				parent = findElement(renderedNode, source);
				index = indexOfTextNode(temp, parent);
				// No seperatation for the first textNode of an element
				if(index === 0) {
					node = parent;
					offset = 0;
				} else {
					node = child(parent, index);
					offset = 0;
				}
			}
		} else {
			renderedNode = findElement(container.parentNode, rendered);

			if (!renderedNode) {
				renderedNode = findElement(prevValidNode(container.parentNode), rendered);
			}

			parent = findElement(renderedNode, source);
			index = indexOfTextNode(container, parent);

			if (index === -1) {
				return;
			}

			node = child(parent, index);

			offset += node.textContent.indexOf(container.textContent);
		}

		if (!node) {
			return;
		}

		return new BreakToken(
			node,
			offset
		);

	}

	findBreakToken(rendered, source, bounds = this.bounds, prevBreakToken, extract = true) {
		let overflow = this.resolveNoProgress(this.findOverflow(rendered, bounds), rendered, bounds) ||
			this.progressOnly(this.findBoxOverflow(rendered, bounds), rendered);
		let breakToken, breakLetter;

		let overflowHooks = this.hooks.onOverflow.triggerSync(overflow, rendered, bounds, this);
		overflowHooks.forEach((newOverflow) => {
			if (typeof newOverflow != "undefined") {
				overflow = newOverflow;
			}
		});

		if (overflow) {
			breakToken = this.createBreakToken(overflow, rendered, source);
			// breakToken is nullable
			let breakHooks = this.hooks.onBreakToken.triggerSync(breakToken, overflow, rendered, this);
			breakHooks.forEach((newToken) => {
				if (typeof newToken != "undefined") {
					breakToken = newToken;
				}
			});

			// Stop removal if we are in a loop
			if (breakToken && breakToken.equals(prevBreakToken)) {
				return breakToken;
			}

			if (breakToken && breakToken["node"] && breakToken["offset"] && breakToken["node"].textContent) {
				breakLetter = breakToken["node"].textContent.charAt(breakToken["offset"]);
			} else {
				breakLetter = undefined;
			}

			if (breakToken && breakToken.node && extract) {
				let removed = this.removeOverflow(overflow, breakLetter);
				this.hooks && this.hooks.afterOverflowRemoved.trigger(removed, rendered, this);
				breakToken = this.settleOverflow(rendered, source, bounds, breakToken, prevBreakToken);
			}

		}
		return breakToken;
	}

	/**
	 * Removing the overflow can change the layout of what stays on the page: e.g. the new last table
	 * row takes the table's bottom border and no longer fits by a fraction of a pixel, so Chrome moves
	 * it into the hidden overflow column — in the DOM, never printed, and the break token already
	 * points past it. So measure again, and while something still overflows — content, a table row's
	 * box, or a table left showing only its header — move the break earlier and remove that too. The
	 * page never ends up empty: see resolveNoProgress. Each move goes through the same onOverflow /
	 * onBreakToken hooks as the first one, so a handler that moves or vetoes breaks still applies.
	 * @param {element} rendered the page's rendered content
	 * @param {element} source the source content
	 * @param {object} bounds the page area
	 * @param {BreakToken} breakToken the break token after the first removal
	 * @param {BreakToken} prevBreakToken the token this page started from
	 * @returns {BreakToken} the (possibly earlier) break token
	 */
	settleOverflow(rendered, source, bounds, breakToken, prevBreakToken) {
		for (let guard = 0; guard < 50; guard++) {
			let overflow = this.resolveNoProgress(this.findOverflow(rendered, bounds), rendered, bounds) ||
				this.progressOnly(this.findBoxOverflow(rendered, bounds), rendered) ||
				this.progressOnly(this.findOrphanedHeader(rendered, source), rendered);
			if (!overflow || !this.hasContentBefore(overflow, rendered)) {
				break;
			}
			this.hooks.onOverflow.triggerSync(overflow, rendered, bounds, this).forEach((newOverflow) => {
				if (typeof newOverflow != "undefined") {
					overflow = newOverflow;
				}
			});
			if (!overflow) {
				break;
			}
			let earlier = this.createBreakToken(overflow, rendered, source);
			this.hooks.onBreakToken.triggerSync(earlier, overflow, rendered, this).forEach((newToken) => {
				if (typeof newToken != "undefined") {
					earlier = newToken;
				}
			});
			// Never back onto the token the page started from: the chunker would skip the item
			if (!earlier || !earlier.node || earlier.equals(breakToken) || earlier.equals(prevBreakToken)) {
				break;
			}
			let letter = earlier.offset && earlier.node.textContent ? earlier.node.textContent.charAt(earlier.offset) : undefined;
			let removed = this.removeOverflow(overflow, letter);
			this.hooks && this.hooks.afterOverflowRemoved.trigger(removed, rendered, this);
			breakToken = earlier;
		}
		return breakToken;
	}

	/**
	 * Keep a "soft" overflow (a row whose box spills, a table left showing only its header) only when
	 * breaking there makes progress. Otherwise the page stays as stock Paged.js leaves it: a soft
	 * overflow at the very top of a page can't be moved anywhere better, and treating it as overflow
	 * there would make Paged.js skip the item ("Unable to layout item").
	 * @param {Range|undefined} overflow a soft overflow range
	 * @param {element} rendered the page's rendered content
	 * @returns {Range|undefined} the range, or undefined
	 */
	progressOnly(overflow, rendered) {
		return overflow && this.hasContentBefore(overflow, rendered) ? overflow : undefined;
	}

	/**
	 * When the overflow leaves the page with no progress (nothing but the overflowing element on it),
	 * that element must break here instead of moving on — otherwise it is pushed to every following
	 * page, the chunker stops with "Layout repeated", and the rest of the document is silently
	 * dropped. In order: make it breakable (relaxBreakAvoid), cut it by measurement
	 * (forceBreakInside), and finally drop this page's repeated table header, as browsers do with a
	 * header too tall to repeat.
	 * @param {Range} overflow the overflow found on this page (or undefined)
	 * @param {element} rendered the page's rendered content
	 * @param {object} bounds the page area
	 * @returns {Range|undefined} the overflow to break at; one that still makes no progress if
	 * nothing helped, or undefined if the content now fits
	 */
	resolveNoProgress(overflow, rendered, bounds) {
		for (let guard = 0; overflow && guard < 20 && !this.hasContentBefore(overflow, rendered); guard++) {
			if (this.relaxBreakAvoid(overflow, rendered)) {
				overflow = this.findOverflow(rendered, bounds);
				continue;
			}
			let forced = this.forceBreakInside(overflow, rendered, bounds);
			if (forced) {
				return forced;
			}
			if (this.dropRepeatedHeaders(overflow, rendered)) {
				overflow = this.findOverflow(rendered, bounds);
				continue;
			}
			break;
		}
		return overflow;
	}

	/**
	 * A table row whose content fits but whose box doesn't: Chrome split it across the page edge and
	 * only empty space, padding or its bottom border spilled into the hidden column, so findOverflow
	 * (which looks for content) sees nothing and the row prints cut off. Treat the row as overflow so
	 * it moves to the next page whole. Rows of a header are left to the header logic.
	 * @param {element} rendered the page's rendered content
	 * @param {object} bounds the page area
	 * @returns {Range|undefined} an overflow range starting at that row
	 */
	findBoxOverflow(rendered, bounds) {
		if (!this.hasOverflow(rendered, bounds)) {
			return;
		}
		for (let row of rendered.querySelectorAll("tr")) {
			if (row.closest("thead, [data-repeated-header]")) {
				continue;
			}
			let spills = Array.from(row.getClientRects()).some((rect) =>
				rect.height > 0 && (rect.left >= bounds.right || rect.bottom > bounds.bottom + 1));
			if (spills) {
				let range = document.createRange();
				range.setStartBefore(row);
				range.setEndAfter(rendered.lastChild);
				return range;
			}
		}
	}

	/**
	 * A table that starts on this page but shows only its header (or caption) here, all its rows
	 * having moved on: move the whole table to the next page so the header goes with its rows.
	 * @param {element} rendered the page's rendered content
	 * @param {element} source the source content
	 * @returns {Range|undefined} an overflow range starting at that table
	 */
	findOrphanedHeader(rendered, source) {
		for (let table of rendered.querySelectorAll("table")) {
			if (table.hasAttribute("data-split-from") || table.closest("[data-repeated-header]")) {
				continue;
			}
			let hasHeader = table.querySelector(":scope > thead, :scope > caption");
			let hasRows = table.querySelector(":scope > tbody > tr, :scope > tfoot > tr");
			let sourceTable = table.dataset.ref && source.querySelector("[data-ref='" + table.dataset.ref + "']");
			let continues = sourceTable && sourceTable.querySelector(":scope > tbody > tr");
			if (!hasHeader || hasRows || !continues) {
				continue;
			}
			let after = document.createRange();
			after.setStartAfter(table);
			after.setEndAfter(rendered.lastChild);
			if (after.toString().trim().length) {
				continue;
			}
			let range = document.createRange();
			range.setStartBefore(table);
			range.setEndAfter(rendered.lastChild);
			return range;
		}
	}

	/**
	 * Hide the repeated <thead> copy of the table(s) where the overflow starts, on this page only —
	 * the last resort when header plus content can't fit on a page. Hidden, not removed: an
	 * integration's after-layout handler that adds a <thead> to any split table lacking one would
	 * otherwise put it back after the page was measured and push content out of print.
	 * (The <colgroup> copy stays: it has no height, and it keeps the column widths.)
	 * @param {Range} overflow the overflow range found on this page
	 * @param {element} rendered the page's rendered content
	 * @returns {boolean} whether any copy was hidden
	 */
	dropRepeatedHeaders(overflow, rendered) {
		let node = overflow.startContainer;
		if (isElement(node) && overflow.startOffset < node.childNodes.length) {
			node = node.childNodes[overflow.startOffset];
		}
		let dropped = false;
		for (let el = isElement(node) ? node : node.parentElement; el && el !== rendered; el = el.parentElement) {
			if (el.nodeName !== "TABLE") {
				continue;
			}
			el.querySelectorAll(":scope > thead[data-repeated-header]").forEach((copy) => {
				if (copy.style.getPropertyValue("display") !== "none") {
					copy.style.setProperty("display", "none", "important");
					copy.setAttribute("data-repeated-header-dropped", "");
					dropped = true;
				}
			});
		}
		return dropped;
	}

	/**
	 * A rowspan cell that spans past the rows on its page (the rest moved to the next page) is drawn
	 * without its bottom edge. Once the page is final, clamp each span to the rows actually here.
	 * Only the rendered page changes; the next page carries the cell from source as before.
	 * @param {element} rendered the page's rendered content
	 * @returns {void}
	 */
	clampRowspans(rendered) {
		rendered.querySelectorAll("thead, tbody, tfoot").forEach((group) => {
			let rows = Array.from(group.rows);
			rows.forEach((row, r) => Array.from(row.cells).forEach((cell) => {
				if (cell.rowSpan > rows.length - r) {
					cell.rowSpan = rows.length - r;
				}
			}));
		});
	}

	/**
	 * Does the page hold any real content before the overflow? A table header (repeated or not) and
	 * empty ancestor shells don't count: breaking there would make no progress.
	 * @param {Range} overflow the overflow range found on this page
	 * @param {element} rendered the page's rendered content
	 * @returns {boolean} true if some content precedes the overflow
	 */
	hasContentBefore(overflow, rendered) {
		// Skip, with their whole subtree, what is not progress on its own: the repeated header copies,
		// column groups, and a table's own <thead> or <caption> — a header with no rows under it is
		// not progress, so a row that doesn't fit under it is made to fit instead of leaving the
		// header alone on the page. Unless the break is inside that <thead>/<caption>: then its
		// earlier rows are content (a table authored as all-<thead> rows still breaks normally).
		let breakNode = overflow.startContainer;
		let walker = document.createTreeWalker(rendered, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
			acceptNode: (n) => {
				if (!isElement(n)) {
					return NodeFilter.FILTER_ACCEPT;
				}
				let skip = n.hasAttribute("data-repeated-header") ||
					n.nodeName === "COLGROUP" || n.nodeName === "COL" ||
					((n.nodeName === "THEAD" || n.nodeName === "CAPTION") && !n.contains(breakNode));
				return skip ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
			}
		});
		let node;
		let isVisibleLeafBox = (el) => {
			// An empty box with a size (a spacer, a signature box) is content too — but not an
			// element that contains the break itself.
			if (el.firstElementChild || el.contains(overflow.startContainer)) {
				return false;
			}
			let rect = el.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		};
		while ((node = walker.nextNode())) {
			let isContent = isText(node)
				? node.textContent.trim().length > 0
				: ["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "HR", "INPUT"].includes(node.nodeName.toUpperCase()) || isVisibleLeafBox(node);
			if (isContent) {
				// The first content decides: before the break means the page made progress
				return overflow.comparePoint(node, 0) < 0;
			}
		}
		return false;
	}

	/**
	 * Make the element where the overflow starts breakable — that element, its first descendants
	 * (a <tbody> is pushed out by its first row; a row by its cells) and its ancestors:
	 * - break-inside: avoid is relaxed. It is a preference, not a rule (CSS Fragmentation 3,
	 *   §4.4): when the element doesn't fit even on a page of its own, the UA breaks inside it.
	 * - Table cells get box-decoration-break: clone. When a row's content fits but its cells'
	 *   trailing padding/border overhang the page by a fraction of a pixel, Chrome moves the whole
	 *   row to the next column instead of breaking between its lines; with clone it fragments.
	 *   (Cloning also closes the cell's border at the page edge.)
	 * Only this page's rendered copy changes; the next page re-renders from source.
	 * @param {Range} overflow the overflow range found on this page
	 * @param {element} rendered the page's rendered content
	 * @returns {boolean} whether anything changed (so the caller can stop looping)
	 */
	relaxBreakAvoid(overflow, rendered) {
		let node = overflow.startContainer;
		if (isElement(node) && overflow.startOffset < node.childNodes.length) {
			node = node.childNodes[overflow.startOffset];
		}
		let start = isElement(node) ? node : node.parentElement;
		if (!start || start === rendered || !rendered.contains(start)) {
			return false;
		}
		// Descend into the first flowing child: past a table's header, caption and column groups.
		let firstFlowChild = (el) => Array.from(el.children).find((c) =>
			!c.hasAttribute("data-repeated-header") && !["THEAD", "CAPTION", "COLGROUP", "COL"].includes(c.nodeName));
		let candidates = new Set();
		for (let el = start; el; el = firstFlowChild(el)) {
			candidates.add(el);
			if (el.nodeName === "TR") {
				Array.from(el.cells).forEach((cell) => candidates.add(cell));
			}
		}
		for (let el = start && start.parentElement; el && el !== rendered; el = el.parentElement) {
			candidates.add(el);
		}
		let relaxed = false;
		for (let candidate of candidates) {
			if ((candidate.nodeName === "TD" || candidate.nodeName === "TH") && !candidate.hasAttribute("data-break-decoration-cloned")) {
				candidate.style.setProperty("box-decoration-break", "clone", "important");
				candidate.style.setProperty("-webkit-box-decoration-break", "clone", "important");
				candidate.setAttribute("data-break-decoration-cloned", "");
				relaxed = true;
			}
			if (candidate.hasAttribute("data-break-inside-relaxed")) {
				continue;
			}
			let value = window.getComputedStyle(candidate).breakInside;
			let avoid = ["avoid", "avoid-page", "avoid-column"].includes(value) || candidate.dataset.breakInside === "avoid";
			if (avoid) {
				candidate.style.setProperty("break-inside", "auto", "important");
				candidate.setAttribute("data-break-inside-relaxed", "");
				if (candidate.dataset.breakInside === "avoid") {
					candidate.dataset.breakInside = "auto";
				}
				relaxed = true;
			}
		}
		return relaxed;
	}

	/**
	 * Last resort when the page made no progress and nothing could be relaxed: Chrome moved the
	 * element out whole although part of it would fit (seen with table rows at sub-pixel page
	 * edges). Find, by measuring, the longest leading run of its block-level pieces that stays on
	 * the page, and break right after it. Text is never cut mid-line.
	 * @param {Range} overflow the overflow range found on this page
	 * @param {element} rendered the page's rendered content
	 * @param {object} bounds the page area
	 * @returns {Range|undefined} an overflow range starting at the first piece that doesn't fit,
	 * or undefined when the element has fewer than two pieces or not even one fits
	 */
	forceBreakInside(overflow, rendered, bounds) {
		let node = overflow.startContainer;
		if (isElement(node) && overflow.startOffset < node.childNodes.length) {
			node = node.childNodes[overflow.startOffset];
		}
		let start = isElement(node) ? node : node.parentElement;
		if (!start || start === rendered) {
			return;
		}
		const BLOCK = ["block", "list-item", "flex", "grid", "table", "flow-root"];
		let isBlock = (el) => BLOCK.includes(window.getComputedStyle(el).display);
		// Leaf block-level pieces, in document order: the places the element can be cut.
		let pieces = Array.from(start.querySelectorAll("*")).filter((el) =>
			!el.closest("thead, caption, [data-repeated-header]") && isBlock(el) && !Array.from(el.children).some(isBlock));
		if (pieces.length < 2) {
			return;
		}
		// To measure a cut, hide what it would remove: everything after the last kept piece, up to
		// `start`. Table cells stay (hiding one would change the columns); their contents are hidden.
		let hidden = [];
		let hide = (el) => {
			hidden.push([el, el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]);
			el.style.setProperty("display", "none", "important");
		};
		let restore = () => {
			hidden.reverse().forEach(([el, value, priority]) => el.style.setProperty("display", value, priority));
			hidden = [];
		};
		let hideAfter = (el) => {
			for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
				if (sib.nodeName === "TD" || sib.nodeName === "TH") {
					Array.from(sib.children).forEach(hide);
				} else {
					hide(sib);
				}
			}
		};
		let cutBefore = (k) => {
			for (let el = pieces[k - 1]; el && el !== start; el = el.parentElement) {
				hideAfter(el);
			}
		};
		// Kept content fits when all of it is in the page's own column: in Paged.js's multi-column
		// page, overflow goes sideways into the next (hidden) column, not below the page.
		let fits = () => {
			let rect = start.getBoundingClientRect();
			return rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
		};
		let lo = 1, hi = pieces.length - 1, best = 0;
		while (lo <= hi) {
			let mid = (lo + hi) >> 1;
			cutBefore(mid);
			let ok = fits();
			restore();
			if (ok) {
				best = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (!best) {
			return;
		}
		let range = document.createRange();
		range.setStartBefore(pieces[best]);
		range.setEndAfter(rendered.lastChild);
		return range;
	}

	hasOverflow(element, bounds = this.bounds) {
		let constrainingElement = element && element.parentNode; // this gets the element, instead of the wrapper for the width workaround
		let {width, height} = element.getBoundingClientRect();
		let scrollWidth = constrainingElement ? constrainingElement.scrollWidth : 0;
		let scrollHeight = constrainingElement ? constrainingElement.scrollHeight : 0;
		return Math.max(Math.floor(width), scrollWidth) > Math.round(bounds.width) ||
			Math.max(Math.floor(height), scrollHeight) > Math.round(bounds.height);
	}

	findOverflow(rendered, bounds = this.bounds, gap = this.gap) {
		if (!this.hasOverflow(rendered, bounds)) return;

		let start = Math.floor(bounds.left);
		let end = Math.round(bounds.right + gap);
		let vStart = Math.round(bounds.top);
		let vEnd = Math.round(bounds.bottom);
		let range;

		let walker = walk(rendered.firstChild, rendered);

		// Find Start
		let next, done, node, offset, skip, breakAvoid, prev, br;
		while (!done) {
			next = walker.next();
			done = next.done;
			node = next.value;
			skip = false;
			breakAvoid = false;
			prev = undefined;
			br = undefined;

			if (node) {
				let pos = getBoundingClientRect(node);
				let left = Math.round(pos.left);
				let right = Math.floor(pos.right);
				let top = Math.round(pos.top);
				let bottom = Math.floor(pos.bottom);

				if (!range && (left >= end || top >= vEnd)) {
					// Check if it is a float
					let isFloat = false;

					// Check if the node is inside a break-inside: avoid table cell
					const insideTableCell = parentOf(node, "TD", rendered);
					if (insideTableCell && window.getComputedStyle(insideTableCell)["break-inside"] === "avoid") {
						// breaking inside a table cell produces unexpected result, as a workaround, we forcibly avoid break inside in a cell.
						// But we take the whole row, not just the cell that is causing the break.
						prev = insideTableCell.parentElement;
					} else if (isElement(node)) {
						let styles = window.getComputedStyle(node);
						isFloat = styles.getPropertyValue("float") !== "none";
						skip = styles.getPropertyValue("break-inside") === "avoid";
						breakAvoid = node.dataset.breakBefore === "avoid" || node.dataset.previousBreakAfter === "avoid";
						prev = breakAvoid && nodeBefore(node, rendered);
						br = node.tagName === "BR" || node.tagName === "WBR";
					}

					let tableRow;
					if (node.nodeName === "TR") {
						tableRow = node;
					} else {
						tableRow = parentOf(node, "TR", rendered);
					}
					if (tableRow) {
						// honor break-inside="avoid" in parent tbody/thead
						let container = tableRow.parentElement;
						if (["TBODY", "THEAD"].includes(container.nodeName)) {
							let styles = window.getComputedStyle(container);
							if (styles.getPropertyValue("break-inside") === "avoid") prev = container;
						}

						// Check if the node is inside a row with a rowspan
						const table = parentOf(tableRow, "TABLE", rendered);
						const rowspan = table.querySelector("[colspan]");
						if (table && rowspan) {
							let columnCount = 0;
							for (const cell of Array.from(table.rows[0].cells)) {
								columnCount += parseInt(cell.getAttribute("colspan") || "1");
							}
							if (tableRow.cells.length !== columnCount) {
								let previousRow = tableRow.previousElementSibling;
								let previousRowColumnCount;
								while (previousRow !== null) {
									previousRowColumnCount = 0;
									for (const cell of Array.from(previousRow.cells)) {
										previousRowColumnCount += parseInt(cell.getAttribute("colspan") || "1");
									}
									if (previousRowColumnCount === columnCount) {
										break;
									}
									previousRow = previousRow.previousElementSibling;
								}
								if (previousRowColumnCount === columnCount) {
									prev = previousRow;
								}
							}
						}
					}

					if (prev) {
						range = document.createRange();
						range.selectNode(prev);
						break;
					}

					if (!br && !isFloat && isElement(node)) {
						range = document.createRange();
						range.selectNode(node);
						break;
					}

					if (isText(node) && node.textContent.trim().length) {
						range = document.createRange();
						range.selectNode(node);
						break;
					}

				}

				if (!range && isText(node) &&
					node.textContent.trim().length &&
					!breakInsideAvoidParentNode(node.parentNode)) {

					let rects = getClientRects(node);
					let rect;
					left = 0;
					top = 0;
					for (var i = 0; i != rects.length; i++) {
						rect = rects[i];
						if (rect.width > 0 && (!left || rect.left > left)) {
							left = rect.left;
						}
						if (rect.height > 0 && (!top || rect.top > top)) {
							top = rect.top;
						}
					}

					if (left >= end || top >= vEnd) {
						range = document.createRange();
						offset = this.textBreak(node, start, end, vStart, vEnd);
						if (!offset) {
							range = undefined;
						} else {
							range.setStart(node, offset);
						}
						break;
					}
				}

				// Skip children
				if (skip || (right <= end && bottom <= vEnd)) {
					next = nodeAfter(node, rendered);
					if (next) {
						walker = walk(next, rendered);
					}

				}

			}
		}

		// Find End
		if (range) {
			range.setEndAfter(rendered.lastChild);
			return range;
		}

	}

	findEndToken(rendered, source) {
		if (rendered.childNodes.length === 0) {
			return;
		}

		let lastChild = rendered.lastChild;

		let lastNodeIndex;
		while (lastChild && lastChild.lastChild) {
			if (!validNode(lastChild)) {
				// Only get elements with refs
				lastChild = lastChild.previousSibling;
			} else if (!validNode(lastChild.lastChild)) {
				// Deal with invalid dom items
				lastChild = prevValidNode(lastChild.lastChild);
				break;
			} else {
				lastChild = lastChild.lastChild;
			}
		}

		if (isText(lastChild)) {

			if (lastChild.parentNode.dataset.ref) {
				lastNodeIndex = indexOf(lastChild);
				lastChild = lastChild.parentNode;
			} else {
				lastChild = lastChild.previousSibling;
			}
		}

		let original = findElement(lastChild, source);

		if (lastNodeIndex) {
			original = original.childNodes[lastNodeIndex];
		}

		let after = nodeAfter(original);

		return this.breakAt(after);
	}

	textBreak(node, start, end, vStart, vEnd) {
		let wordwalker = words(node);
		let left = 0;
		let right = 0;
		let top = 0;
		let bottom = 0;
		let word, next, done, pos;
		let offset;
		while (!done) {
			next = wordwalker.next();
			word = next.value;
			done = next.done;

			if (!word) {
				break;
			}

			pos = getBoundingClientRect(word);

			left = Math.floor(pos.left);
			right = Math.floor(pos.right);
			top = Math.floor(pos.top);
			bottom = Math.floor(pos.bottom);

			if (left >= end || top >= vEnd) {
				offset = word.startOffset;
				break;
			}

			if (right > end || bottom > vEnd) {
				let letterwalker = letters(word);
				let letter, nextLetter, doneLetter;

				while (!doneLetter) {
					nextLetter = letterwalker.next();
					letter = nextLetter.value;
					doneLetter = nextLetter.done;

					if (!letter) {
						break;
					}

					pos = getBoundingClientRect(letter);
					left = Math.floor(pos.left);
					top = Math.floor(pos.top);

					if (left >= end || top >= vEnd) {
						offset = letter.startOffset;
						done = true;

						break;
					}
				}
			}

		}

		return offset;
	}

	removeOverflow(overflow, breakLetter) {
		let {startContainer} = overflow;
		let extracted = overflow.extractContents();

		this.hyphenateAtBreak(startContainer, breakLetter);

		return extracted;
	}

	hyphenateAtBreak(startContainer, breakLetter) {
		if (isText(startContainer)) {
			let startText = startContainer.textContent;
			let prevLetter = startText[startText.length - 1];

			// Add a hyphen if previous character is a letter or soft hyphen
			if (
				(breakLetter && /^\w|\u00AD$/.test(prevLetter) && /^\w|\u00AD$/.test(breakLetter)) ||
				(!breakLetter && /^\w|\u00AD$/.test(prevLetter))
			) {
				startContainer.parentNode.classList.add("pagedjs_hyphen");
				startContainer.textContent += this.settings.hyphenGlyph || "\u2011";
			}
		}
	}

	equalTokens(a, b) {
		if (!a || !b) {
			return false;
		}
		if (a["node"] && b["node"] && a["node"] !== b["node"]) {
			return false;
		}
		if (a["offset"] && b["offset"] && a["offset"] !== b["offset"]) {
			return false;
		}
		return true;
	}
}

EventEmitter(Layout.prototype);

export default Layout;
