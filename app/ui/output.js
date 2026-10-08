const MAX_LINES = 2000;

const stringify = (value) => {
	if (value instanceof Error) return value.stack || value.message;
	if (typeof value === "object" && value !== null) {
		try {
			return JSON.stringify(value);
		} catch (ignored) {
			return String(value);
		}
	}
	return String(value);
};

/**
 * Output window: timestamped log lines with levels (info/warn/error), an "Errors" filter tab
 * and console.* redirection.
 */
export class Output {
	constructor({ log, panel, errorBadge }) {
		this.log = log;
		this.panel = panel;
		this.errorBadge = errorBadge;
		this.errorCount = 0;

		for (const tab of panel.querySelectorAll("[data-output-tab]")) {
			tab.addEventListener("click", () => this.setTab(tab.dataset.outputTab));
		}
		panel.querySelector("[data-output-clear]").addEventListener("click", () => this.clear());
	}

	setTab(tab) {
		for (const t of this.panel.querySelectorAll("[data-output-tab]")) t.classList.toggle("active", t.dataset.outputTab === tab);
		this.log.classList.toggle("only-errors", tab === "errors");
		this.log.scrollTop = this.log.scrollHeight;
	}

	clear() {
		this.log.innerHTML = "";
		this.errorCount = 0;
		this.errorBadge.hidden = true;
	}

	/**
	 * @param {*} message
	 * @param {"log" | "info" | "warn" | "error"} [level]
	 */
	print(message, level = "log") {
		const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
		const date = new Date();
		const ts = `${date.toLocaleTimeString("en-GB")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
		for (const text of stringify(message).split("\n")) {
			const line = document.createElement("div");
			line.className = `log-line log-${level}`;
			const tsEl = document.createElement("span");
			tsEl.className = "log-ts";
			tsEl.textContent = ts;
			const body = document.createElement("span");
			body.textContent = text;
			line.append(tsEl, body);
			this.log.appendChild(line);
		}
		while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild.remove();
		if (level === "error" || level === "warn") {
			this.errorCount++;
			this.errorBadge.hidden = false;
			this.errorBadge.textContent = String(this.errorCount);
		}
		if (stick) this.log.scrollTop = this.log.scrollHeight;
	}

	/** Mirrors console.* and uncaught errors into the Output window. */
	captureConsole() {
		const join = (args) => args.map(stringify).join(" ");
		const native = { log: console.log, warn: console.warn, error: console.error, info: console.info };
		console.log = (...args) => { native.log(...args); this.print(join(args)); };
		console.info = (...args) => { native.info(...args); this.print(join(args), "info"); };
		console.warn = (...args) => { native.warn(...args); this.print(join(args), "warn"); };
		console.error = (...args) => { native.error(...args); this.print(join(args), "error"); };
		window.addEventListener("error", (e) => this.print(e.message || String(e.error), "error"));
		window.addEventListener("unhandledrejection", (e) => this.print(`Unhandled rejection: ${stringify(e.reason)}`, "error"));
	}

	/**
	 * Command bar: runs JavaScript with `renderer` and `print` in scope (Studio's Lua command bar equivalent).
	 */
	attachCommandBar(input, scope) {
		const history = [];
		let index = 0;
		input.addEventListener("keydown", (e) => {
			if (e.key === "ArrowUp" && history.length) {
				index = Math.max(0, index - 1);
				input.value = history[index];
				e.preventDefault();
			} else if (e.key === "ArrowDown" && history.length) {
				index = Math.min(history.length, index + 1);
				input.value = history[index] || "";
				e.preventDefault();
			} else if (e.key === "Enter" && input.value.trim()) {
				const code = input.value;
				history.push(code);
				index = history.length;
				input.value = "";
				this.print(`> ${code}`, "info");
				const names = Object.keys(scope);
				try {
					let fn;
					try {
						fn = new Function(...names, `return (${code});`);
					} catch (notAnExpression) {
						fn = new Function(...names, code);
					}
					const result = fn(...names.map((n) => scope[n]));
					if (result !== undefined) this.print(result);
				} catch (err) {
					this.print(err && err.message ? err.message : String(err), "error");
				}
			} else if (e.key === "Escape") {
				input.blur();
			}
		});
	}
}
