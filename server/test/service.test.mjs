import { test } from "node:test";
import assert from "node:assert/strict";
import { RobloxAssetService, RobloxServiceError } from "../../app/roblox/RobloxAssetService.js";

/** Minimal Response-like object for the mocked fetch. */
function jsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => body,
		arrayBuffer: async () => new ArrayBuffer(0)
	};
}

/** fetch stub that counts calls and returns a queued/handler response. */
function stubFetch(handler) {
	const calls = [];
	const fn = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts); };
	fn.calls = calls;
	return fn;
}

function withFetch(fn, body) {
	const prev = globalThis.fetch;
	globalThis.fetch = fn;
	return body().finally(() => { globalThis.fetch = prev; });
}

test("getAssetDetails returns json.asset", async () => {
	const fetchFn = stubFetch(() => jsonResponse(200, { success: true, asset: { id: 55, name: "Tree", importCategory: "model" } }));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		const asset = await svc.getAssetDetails(55);
		assert.equal(asset.id, 55);
		assert.equal(asset.importCategory, "model");
	});
});

test("getAssetDetails caches per id (one fetch for repeated calls)", async () => {
	const fetchFn = stubFetch(() => jsonResponse(200, { success: true, asset: { id: 7 } }));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await svc.getAssetDetails(7);
		await svc.getAssetDetails(7);
		assert.equal(fetchFn.calls.length, 1);
	});
});

test("getAssetDetails de-dupes concurrent in-flight requests", async () => {
	let resolve;
	const gate = new Promise((r) => { resolve = r; });
	const fetchFn = stubFetch(async () => { await gate; return jsonResponse(200, { success: true, asset: { id: 8 } }); });
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		const p1 = svc.getAssetDetails(8);
		const p2 = svc.getAssetDetails(8);
		resolve();
		await Promise.all([p1, p2]);
		assert.equal(fetchFn.calls.length, 1);
	});
});

test("invalid id throws before hitting the network", async () => {
	const fetchFn = stubFetch(() => jsonResponse(200, {}));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await assert.rejects(() => svc.getAssetDetails("not-an-id"), (e) => e instanceof RobloxServiceError && e.code === "invalid_id");
		assert.equal(fetchFn.calls.length, 0);
	});
});

test("404 surfaces a friendly not_found error", async () => {
	const fetchFn = stubFetch(() => jsonResponse(404, { success: false, error: { code: "not_found", message: "Asset não encontrado." } }));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await assert.rejects(() => svc.getAssetDetails(404404), (e) => e.code === "not_found" && /não encontrado/i.test(e.message));
	});
});

test("403 surfaces a forbidden error", async () => {
	const fetchFn = stubFetch(() => jsonResponse(403, { success: false, error: { code: "forbidden", message: "Este asset não pode ser acessado por esta integração." } }));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await assert.rejects(() => svc.getAssetDetails(403403), (e) => e.code === "forbidden");
	});
});

test("429 surfaces a rate_limited error", async () => {
	const fetchFn = stubFetch(() => jsonResponse(429, { success: false, error: { code: "rate_limited", message: "Limite da API Roblox atingido." } }));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await assert.rejects(() => svc.getAssetDetails(429429), (e) => e.code === "rate_limited");
	});
});

test("network failure maps to an offline error", async () => {
	const fetchFn = stubFetch(() => { throw new TypeError("Failed to fetch"); });
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await assert.rejects(() => svc.getAssetDetails(1), (e) => e.code === "offline");
	});
});

test("external AbortSignal maps to an aborted error", async () => {
	const fetchFn = stubFetch((url, opts) => new Promise((_, rej) => {
		const s = opts.signal;
		const fail = () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
		if (s.aborted) fail(); else s.addEventListener("abort", fail);
	}));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		const ac = new AbortController();
		const p = svc.getAssetDetails(2, { signal: ac.signal });
		ac.abort();
		await assert.rejects(() => p, (e) => e.code === "aborted");
	});
});

test("internal timeout maps to a timeout error", async () => {
	const fetchFn = stubFetch((url, opts) => new Promise((_, rej) => {
		const s = opts.signal;
		s.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
	}));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		await assert.rejects(() => svc._getJson("/slow", { timeoutMs: 10 }), (e) => e.code === "timeout");
	});
});

test("searchCreatorStore POSTs and normalizes the response", async () => {
	const fetchFn = stubFetch(() => jsonResponse(200, { success: true, items: [{ id: 1 }, { id: 2 }], nextCursor: "n", totalResults: 2, filteredKeyword: "k" }));
	await withFetch(fetchFn, async () => {
		const svc = new RobloxAssetService();
		const res = await svc.searchCreatorStore("zombie", { assetType: "Model" });
		assert.equal(fetchFn.calls[0].opts.method, "POST");
		const body = JSON.parse(fetchFn.calls[0].opts.body);
		assert.equal(body.query, "zombie");
		assert.equal(body.searchCategoryType, "Model");
		assert.equal(res.items.length, 2);
		assert.equal(res.totalResults, 2);
	});
});
