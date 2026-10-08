import { icon } from './icons.js';

const STORAGE_KEY = "studiolite.ribbonTab";

/**
 * Config-driven ribbon. Item shapes:
 * - { type: "large" | "small", action, label, icon, title?, menu?, toggle? }
 * - { type: "stack", items: [small items] }
 * - { type: "empty", icon, text }
 * Buttons sharing an `action` across tabs are kept in sync by setState().
 */
export class Ribbon {
	/**
	 * @param {{ tabsEl: HTMLElement, bodyEl: HTMLElement, tabs: any[], onAction: (action: string, el: HTMLElement) => void }} options
	 */
	constructor({ tabsEl, bodyEl, tabs, onAction }) {
		this.tabsEl = tabsEl;
		this.bodyEl = bodyEl;
		this.onAction = onAction;
		this.tabButtons = new Map();
		this.panels = new Map();
		this.state = new Map();

		const spacer = tabsEl.querySelector(".ribbon-spacer");
		for (const tab of tabs) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ribbon-tab";
			btn.setAttribute("role", "tab");
			btn.textContent = tab.label;
			btn.addEventListener("click", () => this.selectTab(tab.id));
			tabsEl.insertBefore(btn, spacer);
			this.tabButtons.set(tab.id, btn);

			const panel = document.createElement("div");
			panel.className = "ribbon-panel";
			panel.setAttribute("role", "tabpanel");
			for (const group of tab.groups) panel.appendChild(this._buildGroup(group));
			bodyEl.appendChild(panel);
			this.panels.set(tab.id, panel);
		}

		const saved = localStorage.getItem(STORAGE_KEY);
		this.selectTab(saved && this.panels.has(saved) ? saved : tabs[0].id);
	}

	selectTab(id) {
		for (const [tabId, btn] of this.tabButtons) {
			const active = tabId === id;
			btn.setAttribute("aria-selected", String(active));
			this.panels.get(tabId).hidden = !active;
		}
		localStorage.setItem(STORAGE_KEY, id);
	}

	/**
	 * @param {string} action
	 * @param {{ active?: boolean, disabled?: boolean, label?: string }} patch
	 */
	setState(action, patch) {
		const next = { ...(this.state.get(action) || {}), ...patch };
		this.state.set(action, next);
		for (const el of this.bodyEl.querySelectorAll(`[data-action="${action}"]`)) {
			if (next.active !== undefined) {
				el.classList.toggle("active", next.active);
				el.setAttribute("aria-pressed", String(next.active));
			}
			if (next.disabled !== undefined) el.disabled = next.disabled;
			if (next.label !== undefined) {
				const label = el.querySelector(".rb-label");
				if (label) label.textContent = next.label;
			}
		}
	}

	_buildGroup(group) {
		const el = document.createElement("div");
		el.className = "ribbon-group";
		const items = document.createElement("div");
		items.className = "ribbon-group-items";
		for (const item of group.items) items.appendChild(this._buildItem(item));
		el.appendChild(items);
		if (group.label) {
			const label = document.createElement("div");
			label.className = "ribbon-group-label";
			label.textContent = group.label;
			el.appendChild(label);
		}
		return el;
	}

	_buildItem(item) {
		if (item.type === "stack") {
			const stack = document.createElement("div");
			stack.className = "rb-stack";
			for (const child of item.items) stack.appendChild(this._buildItem({ ...child, type: "small" }));
			return stack;
		}
		if (item.type === "empty") {
			const empty = document.createElement("div");
			empty.className = "ribbon-empty";
			empty.innerHTML = `${icon(item.icon)}<span></span>`;
			empty.querySelector("span").textContent = item.text;
			return empty;
		}

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = item.type === "small" ? "rb-small" : "rb-large";
		if (item.toggle) btn.classList.add("rb-toggle");
		btn.dataset.action = item.action;
		btn.title = item.title || item.label;
		if (item.menu) btn.setAttribute("aria-haspopup", "menu");
		if (item.toggle) btn.setAttribute("aria-pressed", "false");

		const leading = item.toggle && item.type === "small" ? `<span class="rb-check"></span>` : icon(item.icon);
		const caret = item.menu ? `<span class="rb-caret"></span>` : "";
		btn.innerHTML = item.type === "small"
			? `${leading}${item.toggle && item.icon ? icon(item.icon) : ""}<span class="rb-label"></span>${caret}`
			: `${leading}<span><span class="rb-label"></span>${caret}</span>`;
		btn.querySelector(".rb-label").textContent = item.label;
		if (item.disabled) btn.disabled = true;
		btn.addEventListener("click", () => this.onAction(item.action, btn));
		return btn;
	}
}
