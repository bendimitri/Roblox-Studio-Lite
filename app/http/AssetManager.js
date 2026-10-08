import { tryToFetch_status } from "./TryToFetch.js";
import { assetIndexReady, localAsset } from "./AssetIndex.js";

export default class AssetManager {
	constructor(conf) {
		this.conf = conf;
		this.parseCache = {};
		this.failedAssets = [];
		this.texturesOfFailedMeshes = {};
		this.missingAssets = `You haven't opened a Place yet. Open a Place to get insights on missing assets.`;
		this.hasRbxGameAsset = false;
		/** Optional (assetId, type) => absolute URL, used to fetch assets through the Roblox proxy. */
		this.remoteResolver = null;
	}

	/**
	 * Lets the app resolve assets that aren't stored locally through the Roblox proxy
	 * (e.g. Creator Store imports). `fn(assetId, "mesh"|"decal") => url | null`.
	 */
	setRemoteResolver(fn) {
		this.remoteResolver = typeof fn === "function" ? fn : null;
	}

	getAssetId(path) {
		path = String(path || "");
		if (path.split("://")[0] === "rbxassetid") return path.split("://").pop().trim();
		if (path.split("://")[0] === "http") return path.split("=").pop().trim();
		if (!this.hasRbxGameAsset && path.split("://")[0] === "rbxgameasset") this.hasRbxGameAsset = true;
		return false;
	}

	pushFailedMesh(assetId, meshTexture) {
		if (this.texturesOfFailedMeshes[assetId]) {} else this.texturesOfFailedMeshes[assetId] = [];
		if (this.texturesOfFailedMeshes[assetId].indexOf(meshTexture) === -1) this.texturesOfFailedMeshes[assetId].push(meshTexture);
	}

	async parseAssetPath(path, type = "decal", meshTexture = "N/A") {
		path = String(path || "");
		if (meshTexture === false) meshTexture = "N/A";
		// Absolute/object URLs (e.g. a blob: or data: URL set directly on MeshId/Texture) are used as-is.
		if (/^(blob:|data:)/i.test(path)) return path;
		const assetId = this.getAssetId(path);
		if (type === "mesh" && this.parseCache[path] && this.parseCache[path].length === 0) this.pushFailedMesh(assetId, meshTexture);
		if (this.parseCache[path]) return this.parseCache[path];
		await assetIndexReady;
		const local = localAsset(path, type === "mesh" ? "mesh" : "image");
		if (local) {
			this.parseCache[path] = local.url;
			return local.url;
		}
		//status.innerText = "Loading assets...";
		let href = "";
		if (path.split("://")[0] === "rbxasset") href = "content/" + path.split("://").pop();
		if (assetId) href =  "asset/" + assetId.trim() + (type === "decal" ? ".png" : ".mesh");
		// A previously-failed local asset can still be resolved through the Roblox proxy, if configured.
		if (this.failedAssets.indexOf(assetId) !== -1) {
			const remote = this._remote(assetId, type);
			this.parseCache[path] = remote || "";
			return this.parseCache[path];
		}
		if (href.trim().length === 0) {
			if (path.trim().length === 0)
				//print("parseAssetPath was called with an empty string!");
				;
			else
				if (path.split("://")[0] !== "rbxgameasset") this.conf.sharedFunctions.print(`Asset path ${path} could not be resolved! This might be a deficiency in Studio Lite, please open an issue!`);
				href = "";
		} else {
			if (path.trim().length === 0) { this.parseCache[path] = ""; return this.parseCache[path]; }
			const fetchResult = await tryToFetch_status(href);
			if (fetchResult === 200) { this.parseCache[path] = href; return href; } else {
				// Not stored locally: fall back to the Roblox proxy (Creator Store / asset delivery).
				const remote = this._remote(assetId, type);
				if (remote) { this.parseCache[path] = remote; return remote; }
				if (fetchResult === 404 && assetId !== false && this.failedAssets.indexOf(assetId) === -1) {
					this.failedAssets.push(assetId);
				}
				if (type === "mesh" && fetchResult === 404 && assetId !== false && meshTexture !== false) this.pushFailedMesh(assetId, meshTexture);
				this.parseCache[path] = "";
				return this.parseCache[path];
			}
		}
		this.parseCache[path] = href;
		//status.innerText = statusLastText;
		return href;
	}

	/** Proxy URL for an asset id (or "" when no resolver / no id). */
	_remote(assetId, type) {
		if (!this.remoteResolver || !assetId) return "";
		try { return this.remoteResolver(assetId, type) || ""; } catch { return ""; }
	}

	computeMissingAssetsList() {
		if (this.failedAssets.length > 0) {
			this.missingAssets = `Below are listed all the assets in this Place that have failed to load, likely because they aren't saved on the server.
To fix this, download the missing assets using the AssetDelivery API and place them in the asset/ directory.
The name must be given as [assetid].[extension], where the extension is:
.png for image assets
.mesh for meshes

AssetID listing starts here:`;
			for (const i in this.failedAssets) {
				const asset = this.failedAssets[i];
				const textures = this.texturesOfFailedMeshes[asset];
				this.missingAssets += `\n${textures ? "Mesh" : "Decal"} ${asset.trim()}${textures ? `, texture ${textures.join(", ")}` : ""}`;
			}
			return true;
		} else {
			this.missingAssets = "All assets in this Place have loaded successfully.";
			return false;
		}
	}
}