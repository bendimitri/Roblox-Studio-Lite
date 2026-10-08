import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAssetId, isValidId, classifyQuery } from "../../app/roblox/AssetId.js";

test("normalizeAssetId: bare numbers", () => {
	assert.equal(normalizeAssetId("123456789"), 123456789);
	assert.equal(normalizeAssetId(123456789), 123456789);
	assert.equal(normalizeAssetId("  42  "), 42);
});

test("normalizeAssetId: rbxassetid and rbxthumb", () => {
	assert.equal(normalizeAssetId("rbxassetid://987654"), 987654);
	assert.equal(normalizeAssetId("rbxthumb://type=Asset&id=555&w=150&h=150"), 555);
});

test("normalizeAssetId: roblox.com / create.roblox.com URLs", () => {
	assert.equal(normalizeAssetId("https://www.roblox.com/library/1818/Classic"), 1818);
	assert.equal(normalizeAssetId("https://www.roblox.com/catalog/771"), 771);
	assert.equal(normalizeAssetId("https://create.roblox.com/store/asset/13990/Drooling-Zombie"), 13990);
	assert.equal(normalizeAssetId("https://create.roblox.com/marketplace/asset/999"), 999);
});

test("normalizeAssetId: rejects invalid input", () => {
	assert.equal(normalizeAssetId(""), null);
	assert.equal(normalizeAssetId("abc"), null);
	assert.equal(normalizeAssetId(0), null);
	assert.equal(normalizeAssetId(-5), null);
	assert.equal(normalizeAssetId(1.5), null);
	assert.equal(normalizeAssetId(null), null);
	assert.equal(normalizeAssetId(undefined), null);
});

test("isValidId bounds", () => {
	assert.equal(isValidId(1), true);
	assert.equal(isValidId(0), false);
	assert.equal(isValidId(1e15), false);
	assert.equal(isValidId(1.2), false);
});

test("classifyQuery: id vs text", () => {
	assert.deepEqual(classifyQuery("123"), { kind: "id", assetId: 123 });
	assert.deepEqual(classifyQuery("rbxassetid://123"), { kind: "id", assetId: 123 });
	assert.deepEqual(classifyQuery("zombie"), { kind: "query", query: "zombie" });
	assert.deepEqual(classifyQuery("  sword pack "), { kind: "query", query: "sword pack" });
});
