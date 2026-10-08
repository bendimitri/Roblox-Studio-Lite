import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, fromStatus, timeoutError, noImporterError, noContentError, badIdError } from "../errors.mjs";

test("fromStatus maps known HTTP statuses to stable codes", () => {
	assert.equal(fromStatus(404).code, "not_found");
	assert.equal(fromStatus(404).status, 404);
	assert.equal(fromStatus(403).code, "forbidden");
	assert.equal(fromStatus(401).code, "unauthorized");
	assert.equal(fromStatus(429).code, "rate_limited");
	assert.equal(fromStatus(500).code, "upstream_error");
	assert.equal(fromStatus(503).code, "upstream_error");
});

test("fromStatus: unexpected status falls back to 502 upstream_error", () => {
	const err = fromStatus(418);
	assert.equal(err.code, "upstream_error");
	assert.equal(err.status, 418);
	const weird = fromStatus(99);
	assert.equal(weird.status, 502);
});

test("helper errors carry the right status + code", () => {
	assert.equal(timeoutError().status, 504);
	assert.equal(timeoutError().code, "timeout");
	assert.equal(noImporterError("Audio").status, 422);
	assert.equal(noImporterError("Audio").code, "no_importer");
	assert.match(noImporterError("Audio").message, /Audio/);
	assert.equal(noContentError().code, "no_content");
	assert.equal(badIdError().status, 400);
	assert.equal(badIdError().code, "invalid_id");
});

test("ApiError is an Error with a user-facing message", () => {
	const e = new ApiError(404, "not_found", "Asset não encontrado.", { upstream: 404 });
	assert.ok(e instanceof Error);
	assert.equal(e.message, "Asset não encontrado.");
	assert.deepEqual(e.detail, { upstream: 404 });
});
