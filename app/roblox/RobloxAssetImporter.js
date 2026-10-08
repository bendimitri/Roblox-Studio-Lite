/*
 * RobloxAssetImporter — turns a Roblox asset into the engine's native scene instances.
 *
 * The engine's internal scene format is the DataModel plain-object tree (ClassName/Name/Children/…),
 * the same shape produced by the binary parser. So, per the project's conventions, we do NOT invent a
 * separate "intermediate" format: binary models are decoded straight into engine instances, and
 * image/mesh assets are expressed as the corresponding instances (Decal on a Part, or a MeshPart)
 * whose MeshId/Texture resolve through the Roblox proxy (see AssetManager.setRemoteResolver).
 *
 * Importers return instances only; actually inserting them into the scene (addInstance, selection,
 * camera focus) stays in app.js, which owns the renderer and tools.
 */
import { robloxAssetService } from "./RobloxAssetService.js";
import { decode } from "../thirdparty/rbxBinaryParser.js";

const DEV = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
const log = (...a) => { if (DEV) console.log("[RobloxImporter]", ...a); };

/** Identity-rotation CFrame at a world position, in the engine's { Position, Orientation, Components } shape. */
function cframeAt(x = 0, y = 0, z = 0) {
	return { Position: { X: x, Y: y, Z: z }, Orientation: { X: 0, Y: 0, Z: 0 }, Components: [x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

/**
 * @typedef {object} ImportResult
 * @property {boolean} success
 * @property {string} category  image|mesh|model|audio|animation|unsupported
 * @property {string} [name]
 * @property {object[]} [instances]  engine DataModel instances to insert (roots)
 * @property {boolean} [single]      true when it's a single part (place at the insert point directly)
 * @property {string} [message]      user-facing note (e.g. "no importer")
 * @property {string} [detail]       extra note (e.g. mesh version unsupported) — non-fatal
 */

export class RobloxAssetImporter {
	constructor(service = robloxAssetService) {
		this.service = service;
	}

	/** The engine import category for an asset (image|mesh|model|audio|animation|unsupported). */
	detectAssetType(asset) {
		if (asset && asset.importCategory) return asset.importCategory;
		return "unsupported";
	}

	/**
	 * Import an asset by its RobloxAsset metadata (or by id). Downloads content only when needed
	 * (models); image/mesh assets stream through the proxy at render time via rbxassetid URIs.
	 * @param {import('./types.js').RobloxAsset | number | string} assetOrId
	 * @param {{ origin?: {x:number,y:number,z:number}, onProgress?: (msg:string)=>void, signal?: AbortSignal }} [opts]
	 * @returns {Promise<ImportResult>}
	 */
	async importAsset(assetOrId, { origin = { x: 0, y: 0, z: 0 }, onProgress = () => {}, signal } = {}) {
		let asset = assetOrId;
		if (typeof asset === "number" || typeof asset === "string") {
			onProgress("Carregando asset…");
			asset = await this.service.getAssetDetails(asset, { signal });
		}
		const id = asset && asset.id;
		const category = this.detectAssetType(asset);
		const name = (asset && asset.name) || (id ? `Asset ${id}` : "Asset");
		log("type:", category, "id:", id);

		switch (category) {
			case "image": return this.importImage(asset, { origin, onProgress });
			case "mesh": return this.importMesh(asset, { origin, onProgress });
			case "model": return this.importModel(asset, { origin, onProgress, signal });
			case "audio": return this.importAudio(asset);
			default:
				return { success: false, category, name, message: `Encontramos "${name}", mas o tipo "${asset && asset.assetType || category}" ainda não possui suporte de importação na engine.` };
		}
	}

	/**
	 * Image / Decal -> a flat Part carrying a Decal. The image is fetched lazily through the proxy
	 * (rbxassetid URI resolved by AssetManager's remote resolver).
	 * @returns {ImportResult}
	 */
	importImage(asset, { origin, onProgress } = {}) {
		onProgress && onProgress("Processando imagem…");
		const id = asset.id;
		const name = asset.name || `Decal ${id}`;
		const part = {
			ClassName: "Part", Name: name, Children: [
				{ ClassName: "Decal", Name: "Decal", Face: "Front", Texture: `rbxassetid://${id}`, Transparency: 0, Children: [] }
			],
			Anchored: true, CanCollide: true, CastShadow: true, Locked: false, Massless: false,
			CFrame: cframeAt(origin.x, origin.y + 2, origin.z),
			Color3: { R: 1, G: 1, B: 1 }, Material: "SmoothPlastic", Reflectance: 0, Transparency: 0,
			Shape: "Block", Size: { X: 4, Y: 4, Z: 0.4 },
			TopSurface: "Smooth", BottomSurface: "Smooth"
		};
		return { success: true, category: "image", name, instances: [part], single: true };
	}

	/**
	 * Mesh / MeshPart -> a MeshPart whose MeshId resolves through the proxy. Modern mesh formats
	 * (v4/v5) aren't parseable by the engine yet; the renderer falls back to a box in that case, so
	 * we flag that possibility in `detail` instead of failing.
	 * @returns {ImportResult}
	 */
	importMesh(asset, { origin, onProgress } = {}) {
		onProgress && onProgress("Processando mesh…");
		const id = asset.id;
		const name = asset.name || `Mesh ${id}`;
		const part = {
			ClassName: "MeshPart", Name: name, Children: [],
			Anchored: true, CanCollide: true, CastShadow: true, Locked: false, Massless: false,
			CFrame: cframeAt(origin.x, origin.y + 2, origin.z),
			Color3: { R: 0.64, G: 0.64, B: 0.64 }, Material: "Plastic", Reflectance: 0, Transparency: 0,
			Size: { X: 4, Y: 4, Z: 4 },
			MeshId: `rbxassetid://${id}`, TextureID: ""
		};
		return {
			success: true, category: "mesh", name, instances: [part], single: true,
			detail: "Se o mesh usar um formato recente (v4/v5), a engine ainda não o decodifica e mostrará uma caixa."
		};
	}

	/**
	 * Model / rbxm -> decode the binary content into native engine instances (one or more roots).
	 * @returns {Promise<ImportResult>}
	 */
	async importModel(asset, { onProgress, signal } = {}) {
		const id = asset.id;
		const name = asset.name || `Model ${id}`;
		onProgress && onProgress("Baixando conteúdo…");
		const content = await this.service.getAssetContent(id, { signal });
		onProgress && onProgress("Processando modelo…");
		// The engine's model parser only reads the BINARY rbxm format (magic "<roblox!"). Many classic
		// assets are stored as XML ("<roblox xml…>"), which isn't supported — detect that up front.
		const head = new Uint8Array(content.data.slice(0, 8));
		const magic = String.fromCharCode(...head);
		if (magic.startsWith("<roblox") && magic[7] !== "!") {
			return { success: false, category: "model", name, message: `"${name}" está no formato de modelo XML, que a engine ainda não lê (apenas o formato binário rbxm é suportado).` };
		}
		let roots;
		try {
			roots = decode(content.data);
		} catch (err) {
			log("decode failed", err && err.message);
			return { success: false, category: "model", name, message: "Encontramos o modelo, mas o conteúdo não pôde ser lido (formato não suportado ou XML)." };
		}
		const instances = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
		if (!instances.length) return { success: false, category: "model", name, message: "O modelo não contém instâncias importáveis." };
		log("decoded", instances.length, "root(s)");
		return { success: true, category: "model", name, instances, single: false };
	}

	/** Audio has no scene importer yet (would need a Sound instance + playback). Metadata/preview only. */
	importAudio(asset) {
		const name = (asset && asset.name) || `Audio ${asset && asset.id}`;
		return { success: false, category: "audio", name, message: `"${name}" é um áudio. A pré-visualização e os metadados estão disponíveis, mas a importação de áudio para a cena ainda não é suportada.` };
	}
}

export const robloxAssetImporter = new RobloxAssetImporter();
