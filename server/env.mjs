/*
 * Minimal .env loader (no dependency). Reads server/.env (if present) into a config object,
 * letting real environment variables take precedence. Secrets stay server-side only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Parses a .env file body into key/value pairs (ignores comments and blank lines). */
export function parseEnv(text) {
	const out = {};
	for (const rawLine of String(text).split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

const fileEnv = existsSync(join(HERE, ".env")) ? parseEnv(readFileSync(join(HERE, ".env"), "utf8")) : {};
const read = (key, fallback = "") => (process.env[key] ?? fileEnv[key] ?? fallback);

export const config = {
	apiKey: read("ROBLOX_API_KEY"),
	cookie: read("ROBLOX_COOKIE"),
	port: Number(read("PORT", "8787")) || 8787,
	allowedOrigins: read("ALLOWED_ORIGINS", "*").split(",").map((s) => s.trim()).filter(Boolean),
	timeoutMs: Number(read("ROBLOX_TIMEOUT_MS", "15000")) || 15000
};

/** True when any Roblox credential is configured (affects what the proxy can fetch). */
export const hasCredential = () => Boolean(config.apiKey || config.cookie);
