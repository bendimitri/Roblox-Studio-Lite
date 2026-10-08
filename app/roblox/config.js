/*
 * Frontend configuration for the Roblox integration. The browser NEVER calls Roblox directly; it
 * calls our own proxy (see server/). This resolves the proxy base URL and lets it be overridden.
 */

const STORAGE_KEY = "studiolite.roblox.apiBase";
const DEFAULT_PROXY_PORT = 8787;

/** Resolve the internal proxy base URL (no trailing slash). */
function resolveApiBase() {
	try {
		const override = localStorage.getItem(STORAGE_KEY);
		if (override) return override.replace(/\/$/, "");
	} catch { /* localStorage may be unavailable */ }
	if (typeof window !== "undefined" && window.STUDIOLITE_ROBLOX_API) {
		return String(window.STUDIOLITE_ROBLOX_API).replace(/\/$/, "");
	}
	// When the app is served by the proxy itself, use the same origin; otherwise assume the
	// proxy runs on its default port on the same host as the static site.
	if (typeof location !== "undefined") {
		if (location.port === String(DEFAULT_PROXY_PORT)) return location.origin;
		const host = location.hostname || "localhost";
		return `${location.protocol || "http:"}//${host}:${DEFAULT_PROXY_PORT}`;
	}
	return `http://localhost:${DEFAULT_PROXY_PORT}`;
}

export const robloxConfig = {
	get apiBase() { return resolveApiBase(); },
	/** Persist an override (e.g. a remote proxy URL) for this browser. */
	setApiBase(url) { try { localStorage.setItem(STORAGE_KEY, url); } catch { /* ignore */ } },
	endpoint(path) { return `${resolveApiBase()}/api/roblox${path}`; }
};
