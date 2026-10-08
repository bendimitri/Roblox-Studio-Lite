import { icon } from './icons.js';

const layer = document.getElementById("popup-layer");
const toastLayer = document.getElementById("toast-layer");
let current = null;

export function isPopupOpen() {
	return current !== null;
}

export function closePopup() {
	if (!current) return;
	const { el, anchor } = current;
	current = null;
	el.remove();
	if (anchor) anchor.setAttribute("aria-expanded", "false");
}

/**
 * Opens a positioned popup under `anchor`. Clicking the same anchor again toggles it closed.
 * @param {HTMLElement} anchor
 * @param {(el: HTMLElement) => void} build
 * @param {{ align?: "start" | "end" }} [options]
 */
export function openPopup(anchor, build, options = {}) {
	if (current && current.anchor === anchor) {
		closePopup();
		return null;
	}
	closePopup();
	const el = document.createElement("div");
	el.className = "popup";
	el.setAttribute("role", "menu");
	build(el);
	layer.appendChild(el);

	const rect = anchor.getBoundingClientRect();
	const width = el.offsetWidth;
	const height = el.offsetHeight;
	let left = options.align === "end" ? rect.right - width : rect.left;
	let top = rect.bottom + 2;
	left = Math.max(4, Math.min(left, window.innerWidth - width - 4));
	if (top + height > window.innerHeight - 4) top = Math.max(4, rect.top - height - 2);
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;

	anchor.setAttribute("aria-expanded", "true");
	current = { el, anchor };
	return el;
}

/**
 * @typedef {{ label: string, icon?: string, hint?: string, checked?: boolean, disabled?: boolean, onClick?: () => void }} MenuItem
 * @param {HTMLElement} anchor
 * @param {(MenuItem | "sep" | { title: string })[]} items
 */
export function openMenu(anchor, items, options = {}) {
	return openPopup(anchor, (el) => {
		for (const item of items) {
			if (item === "sep") {
				el.insertAdjacentHTML("beforeend", `<div class="popup-sep" role="separator"></div>`);
				continue;
			}
			if (item.title) {
				const title = document.createElement("div");
				title.className = "popup-title";
				title.textContent = item.title;
				el.appendChild(title);
				continue;
			}
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "popup-item" + (item.checked ? " checked" : "");
			btn.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemcheckbox");
			if (item.checked !== undefined) btn.setAttribute("aria-checked", String(item.checked));
			btn.disabled = !!item.disabled;
			const leading = item.icon
				? icon(item.icon)
				: item.checked ? `<span class="popup-icon-slot">✓</span>` : `<span class="popup-icon-slot"></span>`;
			btn.innerHTML = `${leading}<span></span>${item.hint ? `<span class="popup-hint"></span>` : ""}`;
			btn.children[1].textContent = item.label;
			if (item.hint) btn.querySelector(".popup-hint").textContent = item.hint;
			btn.addEventListener("click", () => {
				closePopup();
				if (item.onClick) item.onClick();
			});
			el.appendChild(btn);
		}
	}, options);
}

export function toast(message, duration = 2400) {
	const el = document.createElement("div");
	el.className = "toast";
	el.textContent = message;
	toastLayer.appendChild(el);
	setTimeout(() => {
		el.classList.add("leaving");
		setTimeout(() => el.remove(), 220);
	}, duration);
}

document.addEventListener("pointerdown", (e) => {
	if (!current) return;
	if (current.el.contains(e.target) || (current.anchor && current.anchor.contains(e.target))) return;
	closePopup();
}, true);

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && current) {
		e.stopImmediatePropagation();
		closePopup();
	}
}, true);

window.addEventListener("blur", closePopup);
window.addEventListener("resize", closePopup);
