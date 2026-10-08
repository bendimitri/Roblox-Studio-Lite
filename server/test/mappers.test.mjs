import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAssetDetails, mapSearchItem, mapSearchResponse } from "../mappers.mjs";
import { assetTypeName, importCategory } from "../assetTypes.mjs";

test("assetTypeName / importCategory", () => {
	assert.equal(assetTypeName(10), "Model");
	assert.equal(assetTypeName(13), "Decal");
	assert.equal(assetTypeName(40), "MeshPart");
	assert.equal(assetTypeName(99999), undefined);
	assert.equal(importCategory("Model"), "model");
	assert.equal(importCategory("Decal"), "image");
	assert.equal(importCategory("Mesh"), "mesh");
	assert.equal(importCategory("Audio"), "audio");
	assert.equal(importCategory("Plugin"), "unsupported");
	assert.equal(importCategory(undefined), "unsupported");
});

test("mapAssetDetails: merges delivery + legacy", () => {
	const asset = mapAssetDetails(123, { locations: [{ location: "https://x" }], assetTypeId: 10 }, { Name: "Tree", AssetTypeId: 10, Creator: { Id: 7, Name: "me", CreatorType: "User" } });
	assert.equal(asset.id, 123);
	assert.equal(asset.name, "Tree");
	assert.equal(asset.assetType, "Model");
	assert.equal(asset.importCategory, "model");
	assert.equal(asset.contentAvailable, true);
	assert.deepEqual(asset.creator, { id: 7, name: "me", type: "User" });
});

test("mapAssetDetails: no content when delivery lacks a location", () => {
	const asset = mapAssetDetails(1, null, { AssetTypeId: 13 });
	assert.equal(asset.contentAvailable, false);
	assert.equal(asset.importCategory, "image");
});

test("mapSearchItem: numeric assetTypeId nested under asset", () => {
	const item = mapSearchItem({ asset: { id: 5, name: "Sword", assetTypeId: 10 }, creator: { name: "dev" } });
	assert.equal(item.id, 5);
	assert.equal(item.name, "Sword");
	assert.equal(item.assetType, "Model");
	assert.equal(item.importCategory, "model");
	assert.equal(item.creator.name, "dev");
});

test("mapSearchItem: string assetType enum still resolves category", () => {
	const item = mapSearchItem({ asset: { id: 9, name: "Pic", assetType: "Decal" } });
	assert.equal(item.assetType, "Decal");
	assert.equal(item.importCategory, "image");
});

test("mapSearchResponse: reads creatorStoreAssets + pagination", () => {
	const res = mapSearchResponse({
		creatorStoreAssets: [{ asset: { id: 1, assetTypeId: 10 } }, { asset: { id: 2, assetTypeId: 13 } }],
		nextPageToken: "abc",
		totalResults: 57,
		filteredKeyword: "sword"
	});
	assert.equal(res.items.length, 2);
	assert.equal(res.nextCursor, "abc");
	assert.equal(res.totalResults, 57);
	assert.equal(res.filteredKeyword, "sword");
});

test("mapSearchResponse: drops items without an id", () => {
	const res = mapSearchResponse({ creatorStoreAssets: [{ asset: { name: "no id" } }, { asset: { id: 3, assetTypeId: 10 } }] });
	assert.equal(res.items.length, 1);
	assert.equal(res.items[0].id, 3);
});

test("mapSearchResponse: tolerates empty / unknown shapes", () => {
	assert.deepEqual(mapSearchResponse(null).items, []);
	assert.deepEqual(mapSearchResponse({}).items, []);
});
