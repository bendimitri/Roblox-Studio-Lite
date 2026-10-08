/*
 * JSDoc typedefs shared across the Roblox frontend layer. Kept as documentation-only (the project
 * is plain ES modules, not TypeScript), so these describe the shapes the proxy returns.
 *
 * @typedef {object} RobloxAsset
 * @property {number} id
 * @property {string} [name]
 * @property {string} [description]
 * @property {number} [assetTypeId]
 * @property {string} [assetType]       Roblox type name, e.g. "Model"
 * @property {("image"|"mesh"|"model"|"audio"|"animation"|"unsupported")} [importCategory]
 * @property {{ id?: number, name?: string, type?: string }} [creator]
 * @property {string} [thumbnailUrl]
 * @property {boolean} [contentAvailable]
 * @property {unknown} [raw]
 *
 * @typedef {object} RobloxSearchResult
 * @property {RobloxAsset[]} items
 * @property {string} [nextCursor]
 * @property {number} [totalResults]
 * @property {string} [filteredKeyword]
 *
 * @typedef {object} RobloxContent
 * @property {boolean} success
 * @property {number} assetId
 * @property {string} [contentType]
 * @property {ArrayBuffer} [data]
 * @property {string} [blobUrl]   object URL usable by the engine (texture/mesh/model)
 * @property {string} [error]
 *
 * @typedef {object} RobloxApiErrorShape
 * @property {string} code
 * @property {string} message
 */
export {};
