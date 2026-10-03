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
					this.hooks && this.hooks.beforeRenderResult.trigger(undefined, wrapper, this);
					return new RenderResult(undefined, new OverflowContentError("Unable to layout item", [prevNode]));
				}

				this.rebuildTableFromBreakToken(newBreakToken, wrapper);

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
						this.hooks && this.hooks.beforeRenderResult.trigger(undefined, wrapper, this);
						return new RenderResult(undefined, new OverflowContentError("Unable to layout item", [node]));
					}
				}
			}

		}

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
		let overflow = this.findOverflow(rendered, bounds);
		let breakToken, breakLetter;

		// When the page made no progress (nothing but the overflowing element on it), that element
		// must break inside instead of moving on — otherwise it is pushed to every following page,
		// the chunker stops with "Layout repeated", and the rest of the document is silently
		// dropped. See relaxBreakAvoid for the two things that keep Chrome from breaking it.
		while (overflow && !this.hasContentBefore(overflow, rendered)) {
			if (this.relaxBreakAvoid(overflow, rendered)) {
				overflow = this.findOverflow(rendered, bounds);
				continue;
			}
			overflow = this.forceBreakInside(overflow, rendered, bounds) || overflow;
			break;
		}

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
				breakToken = this.settleOverflow(rendered, source, bounds, breakToken);
			}

		}
		return breakToken;
	}

	/**
	 * Removing the overflow can change the layout of what stays on the page: e.g. the new last table
	 * row takes the table's bottom border and no longer fits by a fraction of a pixel, so Chrome moves
	 * it into the hidden overflow column — in the DOM, never printed, and the break token already
	 * points past it. So measure again, and while content still overflows, move the break earlier
	 * and remove that too. If everything left was pushed out whole, make it breakable first
	 * (relaxBreakAvoid), so the page never ends up empty.
	 * @param {element} rendered the page's rendered content
	 * @param {element} source the source content
	 * @param {object} bounds the page area
	 * @param {BreakToken} breakToken the break token after the first removal
	 * @returns {BreakToken} the (possibly earlier) break token
	 */
	settleOverflow(rendered, source, bounds, breakToken) {
		for (let guard = 0; guard < 50; guard++) {
			let overflow = this.findOverflow(rendered, bounds);
			if (!overflow) {
				break;
			}
			if (!this.hasContentBefore(overflow, rendered)) {
				// Everything left was pushed out whole — e.g. a split row whose cells' trailing
				// padding now overhangs the page. Make it breakable and measure again; failing
				// that, cut it by measurement.
				if (this.relaxBreakAvoid(overflow, rendered)) {
					continue;
				}
				overflow = this.forceBreakInside(overflow, rendered, bounds);
				if (!overflow) {
					break;
				}
			}
			let earlier = this.createBreakToken(overflow, rendered, source);
			if (!earlier || !earlier.node) {
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
	 * Does the page hold any real content before the overflow? A repeated table header and empty
	 * ancestor shells don't count: breaking there would make no progress.
	 * @param {Range} overflow the overflow range found on this page
	 * @param {element} rendered the page's rendered content
	 * @returns {boolean} true if some content precedes the overflow
	 */
	hasContentBefore(overflow, rendered) {
		let walker = document.createTreeWalker(rendered, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			if (isElement(node) && node.hasAttribute("data-repeated-header")) {
				// Skip the repeated <thead>/<colgroup> and everything inside it
				let next = nodeAfter(node, rendered);
				if (!next) {
					return false;
				}
				walker.currentNode = next;
				node = next;
			}
			let isContent = isText(node)
				? node.textContent.trim().length > 0
				: ["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "HR", "INPUT"].includes(node.nodeName.toUpperCase());
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
		let firstFlowChild = (el) => Array.from(el.children).find((c) => !c.hasAttribute("data-repeated-header"));
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
			!el.closest("[data-repeated-header]") && isBlock(el) && !Array.from(el.children).some(isBlock));
		if (pieces.length < 2) {
			return;
		}
		let saved = pieces.map((el) => [el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]);
		let hideFrom = (k) => pieces.forEach((el, i) => {
			if (i >= k) {
				el.style.setProperty("display", "none", "important");
			} else {
				el.style.setProperty("display", saved[i][0], saved[i][1]);
			}
		});
		let fits = () => {
			let rect = start.getBoundingClientRect();
			return rect.left < bounds.right && Math.floor(rect.bottom) <= Math.round(bounds.bottom);
		};
		let lo = 1, hi = pieces.length - 1, best = 0;
		while (lo <= hi) {
			let mid = (lo + hi) >> 1;
			hideFrom(mid);
			if (fits()) {
				best = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		pieces.forEach((el, i) => el.style.setProperty("display", saved[i][0], saved[i][1]));
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
