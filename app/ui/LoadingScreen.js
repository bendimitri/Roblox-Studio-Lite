/*
 * Full-viewport loading overlay used while a place loads (studio theme) and while entering Play
 * (game theme). The displayed percentage eases toward the last target set with setProgress, so
 * even coarse milestones animate smoothly. Pass fraction null for an indeterminate (marquee) bar.
 */
export default class LoadingScreen {
	/** @param {HTMLElement} host element the overlay is appended to (the viewport) */
	constructor(host) {
		this.el = document.createElement("div");
		this.el.className = "loading-screen";
		this.el.hidden = true;
		this.el.innerHTML = `
			<div class="loading-card">
				<div class="loading-brand"><span class="loading-logo"></span><span class="loading-brand-name">Studio Lite</span></div>
				<div class="loading-title"></div>
				<div class="loading-bar"><div class="loading-fill"></div><div class="loading-marquee"></div></div>
				<div class="loading-foot"><span class="loading-status"></span><span class="loading-pct"></span></div>
			</div>`;
		host.appendChild(this.el);
		this.titleEl = this.el.querySelector(".loading-title");
		this.fillEl = this.el.querySelector(".loading-fill");
		this.statusEl = this.el.querySelector(".loading-status");
		this.pctEl = this.el.querySelector(".loading-pct");
		this.current = 0;
		this.target = 0;
		this.indeterminate = false;
		this._raf = 0;
		this._visible = false;
	}

	/** @param {{ title?: string, theme?: "studio"|"game" }} [opts] */
	show({ title = "Carregando…", theme = "studio" } = {}) {
		this.el.classList.toggle("is-game", theme === "game");
		this.titleEl.textContent = title;
		this.current = 0;
		this.target = 0;
		this.setProgress(0, "Iniciando…");
		this.el.hidden = false;
		this._visible = true;
		// Force reflow so the fade-in transition runs from opacity 0.
		void this.el.offsetWidth;
		this.el.classList.add("is-shown");
		this._tick();
	}

	setTitle(text) {
		this.titleEl.textContent = text;
	}

	/**
	 * @param {number|null} fraction 0..1 target progress, or null for an indeterminate bar
	 * @param {string} [status] text shown under the bar
	 */
	setProgress(fraction, status) {
		if (fraction === null) {
			this.indeterminate = true;
			this.el.classList.add("is-indeterminate");
		} else {
			this.indeterminate = false;
			this.el.classList.remove("is-indeterminate");
			// Progress never moves backwards within a session.
			this.target = Math.max(this.target, Math.min(1, Math.max(0, fraction)));
		}
		if (status !== undefined) this.statusEl.textContent = status;
		if (this._visible && !this._raf) this._tick();
	}

	_tick() {
		this._raf = requestAnimationFrame(() => {
			this._raf = 0;
			if (!this._visible) return;
			if (!this.indeterminate) {
				this.current += (this.target - this.current) * 0.12;
				if (Math.abs(this.target - this.current) < 0.002) this.current = this.target;
				this.fillEl.style.width = `${(this.current * 100).toFixed(1)}%`;
				this.pctEl.textContent = `${Math.round(this.current * 100)}%`;
			} else {
				this.pctEl.textContent = "";
			}
			if (this.indeterminate || this.current !== this.target) this._tick();
		});
	}

	/** Snaps to 100%, then fades out and hides. Resolves once hidden. */
	async hide() {
		if (!this._visible) return;
		this.indeterminate = false;
		this.el.classList.remove("is-indeterminate");
		this.target = 1;
		this.current = 1;
		this.fillEl.style.width = "100%";
		this.pctEl.textContent = "100%";
		this.statusEl.textContent = "Pronto";
		await new Promise((r) => setTimeout(r, 260));
		this._visible = false;
		this.el.classList.remove("is-shown");
		await new Promise((r) => setTimeout(r, 320));
		if (!this._visible) {
			this.el.hidden = true;
			if (this._raf) cancelAnimationFrame(this._raf);
			this._raf = 0;
		}
	}
}
