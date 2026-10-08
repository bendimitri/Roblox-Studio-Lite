import {
	Scene,
	PerspectiveCamera,
	AmbientLight,
	DirectionalLight,
	Group,
	Mesh,
	MeshStandardMaterial,
	BoxGeometry,
	SphereGeometry,
	CylinderGeometry,
	Color,
	Box3,
	Vector3,
	MathUtils
} from '../thirdparty/three/three.core.js';
import { WebGLRenderer } from '../thirdparty/three/three.module.js';
import { icon } from './icons.js';
import { applyMaterialLook, hexToColor3 } from '../rendering/Materials.js';
import { robloxAssetService } from '../roblox/RobloxAssetService.js';
import { classifyQuery } from '../roblox/AssetId.js';

const RECENT_KEY = "studiolite.toolbox.recent";
const BG_KEY = "studiolite.toolbox.bg";
const GREY = "#a3a2a5";

/**
 * Part spec: { name, cls?, shape?, size: [x,y,z], pos: [x,y,z] (center, relative to the model's ground point),
 *              color, material?, transparency?, rotY? (degrees) }
 */
export const RECIPES = [
	{ id: "block", name: "Block", category: "parts", icon: "part", parts: [{ name: "Part", size: [4, 1, 2], pos: [0, .5, 0], color: GREY }] },
	{ id: "sphere", name: "Sphere", category: "parts", icon: "sphere", parts: [{ name: "Part", shape: "Ball", size: [4, 4, 4], pos: [0, 2, 0], color: GREY }] },
	{ id: "wedge", name: "Wedge", category: "parts", icon: "wedge", parts: [{ name: "Wedge", cls: "WedgePart", size: [4, 2, 4], pos: [0, 1, 0], color: GREY }] },
	{ id: "cylinder", name: "Cylinder", category: "parts", icon: "cylinder", parts: [{ name: "Part", shape: "Cylinder", size: [4, 2, 2], pos: [0, 1, 0], color: GREY }] },
	{ id: "spawn", name: "Spawn Location", category: "parts", icon: "assetSpawn", parts: [{ name: "SpawnLocation", cls: "SpawnLocation", size: [6, 1, 6], pos: [0, .5, 0], color: GREY }] },
	{
		id: "pine", name: "Pine Tree", category: "nature", icon: "assetTree", parts: [
			{ name: "Trunk", size: [1, 4, 1], pos: [0, 2, 0], color: "#6a4b31", material: "Wood" },
			{ name: "Leaves", size: [6, 2, 6], pos: [0, 5, 0], color: "#2f6b3a", material: "Grass" },
			{ name: "Leaves", size: [4.5, 2, 4.5], pos: [0, 7, 0], color: "#347a41", material: "Grass" },
			{ name: "Leaves", size: [3, 2, 3], pos: [0, 9, 0], color: "#3a8848", material: "Grass" },
			{ name: "Leaves", size: [1.4, 1.6, 1.4], pos: [0, 10.8, 0], color: "#43974f", material: "Grass" }
		]
	},
	{
		id: "oak", name: "Oak Tree", category: "nature", icon: "assetOak", parts: [
			{ name: "Trunk", size: [1.4, 6, 1.4], pos: [0, 3, 0], color: "#6a4b31", material: "Wood" },
			{ name: "Leaves", shape: "Ball", size: [7, 7, 7], pos: [0, 8.5, 0], color: "#4b974b", material: "Grass" },
			{ name: "Leaves", shape: "Ball", size: [4.6, 4.6, 4.6], pos: [2.6, 7.6, .4], color: "#58a858", material: "Grass" },
			{ name: "Leaves", shape: "Ball", size: [4.2, 4.2, 4.2], pos: [-2.2, 7.4, 1.4], color: "#3f8a44", material: "Grass" }
		]
	},
	{
		id: "bush", name: "Bush", category: "nature", icon: "assetOak", parts: [
			{ name: "Leaves", shape: "Ball", size: [3, 3, 3], pos: [0, 1.3, 0], color: "#4b974b", material: "Grass" },
			{ name: "Leaves", shape: "Ball", size: [2.4, 2.4, 2.4], pos: [1.5, 1, .5], color: "#58a858", material: "Grass" },
			{ name: "Leaves", shape: "Ball", size: [2.2, 2.2, 2.2], pos: [-1.3, .9, -.4], color: "#3f8a44", material: "Grass" }
		]
	},
	{
		id: "lamp", name: "Lamp Post", category: "props", icon: "assetLamp", parts: [
			{ name: "Base", size: [1.4, .6, 1.4], pos: [0, .3, 0], color: "#3d3d3d", material: "Metal" },
			{ name: "Pole", size: [.5, 10, .5], pos: [0, 5.6, 0], color: "#3d3d3d", material: "Metal" },
			{ name: "Arm", size: [2.4, .35, .35], pos: [1, 10.4, 0], color: "#3d3d3d", material: "Metal" },
			{ name: "Light", size: [1.2, .7, 1.2], pos: [2, 10, 0], color: "#fff3b0", material: "Neon" }
		]
	},
	{
		id: "bench", name: "Park Bench", category: "props", icon: "assetBench", parts: [
			{ name: "Seat", size: [6, .35, 1.8], pos: [0, 1.6, 0], color: "#8a5a3b", material: "Wood" },
			{ name: "Back", size: [6, 1.6, .3], pos: [0, 2.6, -.85], color: "#8a5a3b", material: "Wood" },
			{ name: "Leg", size: [.35, 1.5, .35], pos: [2.6, .75, .7], color: "#3d3d3d", material: "Metal" },
			{ name: "Leg", size: [.35, 1.5, .35], pos: [-2.6, .75, .7], color: "#3d3d3d", material: "Metal" },
			{ name: "Leg", size: [.35, 2.5, .35], pos: [2.6, 1.25, -.7], color: "#3d3d3d", material: "Metal" },
			{ name: "Leg", size: [.35, 2.5, .35], pos: [-2.6, 1.25, -.7], color: "#3d3d3d", material: "Metal" }
		]
	},
	{ id: "crate", name: "Wooden Crate", category: "props", icon: "assetCrate", parts: [{ name: "Crate", size: [3, 3, 3], pos: [0, 1.5, 0], color: "#a77b4f", material: "WoodPlanks" }] },
	{
		id: "car", name: "Classic Car", category: "props", icon: "assetCar", parts: [
			{ name: "Body", size: [5, 1.6, 10], pos: [0, 1.7, 0], color: "#c4281c", material: "SmoothPlastic" },
			{ name: "Cabin", size: [4.4, 1.6, 5], pos: [0, 3.3, -.6], color: "#9fd3ff", material: "Glass", transparency: .3 },
			{ name: "Wheel", shape: "Cylinder", size: [1, 2.4, 2.4], pos: [2.7, 1.2, 3.2], color: "#1b1b1b" },
			{ name: "Wheel", shape: "Cylinder", size: [1, 2.4, 2.4], pos: [-2.7, 1.2, 3.2], color: "#1b1b1b" },
			{ name: "Wheel", shape: "Cylinder", size: [1, 2.4, 2.4], pos: [2.7, 1.2, -3.2], color: "#1b1b1b" },
			{ name: "Wheel", shape: "Cylinder", size: [1, 2.4, 2.4], pos: [-2.7, 1.2, -3.2], color: "#1b1b1b" },
			{ name: "Headlight", size: [1, .5, .2], pos: [1.6, 1.9, 5.05], color: "#fff3b0", material: "Neon" },
			{ name: "Headlight", size: [1, .5, .2], pos: [-1.6, 1.9, 5.05], color: "#fff3b0", material: "Neon" }
		]
	},
	{ id: "wall", name: "Brick Wall", category: "buildings", icon: "assetWall", parts: [{ name: "Wall", size: [12, 6, 1], pos: [0, 3, 0], color: "#a34b3a", material: "Brick" }] },
	{
		id: "stairs", name: "Stairs", category: "buildings", icon: "assetStairs",
		parts: [0, 1, 2, 3, 4].map((i) => ({ name: "Step", size: [4, i + 1, 1.2], pos: [0, (i + 1) / 2, i * 1.2], color: "#c8c8c8", material: "Concrete" }))
	},
	{
		id: "house", name: "Small House", category: "buildings", icon: "assetHouse", parts: [
			{ name: "Walls", size: [10, 7, 10], pos: [0, 3.5, 0], color: "#d7c59a", material: "SmoothPlastic" },
			{ name: "Roof", cls: "WedgePart", size: [11, 3, 5.5], pos: [0, 8.5, -2.75], color: "#8a3b2a", material: "Slate" },
			{ name: "Roof", cls: "WedgePart", size: [11, 3, 5.5], pos: [0, 8.5, 2.75], color: "#8a3b2a", material: "Slate", rotY: 180 },
			{ name: "Door", size: [2, 4, .3], pos: [0, 2, 5.1], color: "#5b3a29", material: "Wood" },
			{ name: "Window", size: [2, 2, .2], pos: [3, 4.5, 5.05], color: "#9fd3ff", material: "Glass", transparency: .2 },
			{ name: "Window", size: [2, 2, .2], pos: [-3, 4.5, 5.05], color: "#9fd3ff", material: "Glass", transparency: .2 }
		]
	}
];

const TABS = [
	{ id: "marketplace", icon: "tabMarketplace", title: "Marketplace" },
	{ id: "inventory", icon: "tabInventory", title: "Inventory (basic parts)" },
	{ id: "recent", icon: "tabRecent", title: "Recently inserted" },
	{ id: "creations", icon: "tabCreations", title: "Creations" }
];

export function buildPartGeometry(spec) {
	const [x, y, z] = spec.size;
	if (spec.shape === "Ball") return new SphereGeometry(x / 2, 28, 18);
	if (spec.shape === "Cylinder") {
		const r = Math.min(y, z) / 2;
		const g = new CylinderGeometry(r, r, x, 28);
		g.rotateZ(Math.PI / 2);
		return g;
	}
	const g = new BoxGeometry(x, y, z);
	if (spec.cls === "WedgePart") {
		const pos = g.attributes.position;
		for (let i = 0; i < pos.count; i++) {
			if (pos.getZ(i) < 0 && pos.getY(i) > 0) pos.setY(i, -y / 2);
		}
		g.computeVertexNormals();
	}
	return g;
}

function buildPreview(recipe) {
	const group = new Group();
	for (const spec of recipe.parts) {
		const c = hexToColor3(spec.color);
		const material = new MeshStandardMaterial({ color: new Color(c.R, c.G, c.B), roughness: 0.7, metalness: 0 });
		applyMaterialLook(material, spec.material || "Plastic", spec.transparency || 0);
		const mesh = new Mesh(buildPartGeometry(spec), material);
		mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
		if (spec.rotY) mesh.rotation.y = MathUtils.degToRad(spec.rotY);
		group.add(mesh);
	}
	return group;
}

async function renderThumbnails(recipes, onThumb) {
	let gl;
	try {
		gl = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
	} catch (ignored) {
		return;
	}
	gl.setPixelRatio(1);
	gl.setSize(160, 160, false);
	const scene = new Scene();
	scene.add(new AmbientLight(0xffffff, 1.4));
	const sun = new DirectionalLight(0xffffff, 2.2);
	sun.position.set(6, 10, 8);
	scene.add(sun);
	const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
	const offset = new Vector3(1, .78, 1.3).normalize();

	for (const recipe of recipes) {
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const group = buildPreview(recipe);
		scene.add(group);
		const box = new Box3().setFromObject(group);
		const center = box.getCenter(new Vector3());
		const radius = box.getSize(new Vector3()).length() / 2;
		const dist = radius / Math.sin(MathUtils.degToRad(camera.fov / 2)) * 0.92;
		camera.position.copy(center).addScaledVector(offset, dist);
		camera.lookAt(center);
		gl.render(scene, camera);
		onThumb(recipe.id, gl.domElement.toDataURL("image/png"));
		scene.remove(group);
		group.traverse((o) => {
			if (o.geometry) o.geometry.dispose();
			if (o.material) o.material.dispose();
		});
	}
	gl.dispose();
	gl.forceContextLoss();
}

/**
 * Toolbox panel: tabbed asset grid with search, rendered thumbnails, click or drag to insert.
 */
export class Toolbox {
	/**
	 * @param {{ onInsert: (recipe: any) => void, onInsertAsset?: (asset: any) => void, onPreviewAsset?: (asset: any) => void }} options
	 */
	constructor({ onInsert, onInsertAsset, onPreviewAsset }) {
		this.onInsert = onInsert;
		this.onInsertAsset = onInsertAsset || (() => {});
		this.onPreviewAsset = onPreviewAsset || null;
		this.grid = document.getElementById("toolbox-grid");
		this.tabsEl = document.getElementById("toolbox-tabs");
		this.search = document.getElementById("toolbox-search");
		this.category = document.getElementById("toolbox-category");
		this.footer = document.getElementById("toolbox-footer");
		this.tab = "marketplace";
		this.thumbs = new Map();
		this.recent = this._loadRecent();
		/** Monotonic token so stale async search/lookup results are ignored. */
		this._reqToken = 0;

		// Roblox asset-type filter (Creator Store search). Only used when the Marketplace tab has a query.
		this.robloxType = document.createElement("select");
		this.robloxType.className = "toolbox-rbx-type";
		this.robloxType.title = "Tipo de asset na Creator Store";
		for (const [value, label] of [["Model", "Modelos"], ["Decal", "Imagens/Decals"], ["Mesh", "Meshes"], ["Audio", "Áudio"], ["Plugin", "Plugins"]]) {
			const opt = document.createElement("option");
			opt.value = value; opt.textContent = label;
			this.robloxType.appendChild(opt);
		}
		this.robloxType.addEventListener("change", () => { if (this.search.value.trim()) this.render(); });
		if (this.category && this.category.parentElement) this.category.parentElement.appendChild(this.robloxType);

		for (const tab of TABS) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "toolbox-tab";
			btn.title = tab.title;
			btn.setAttribute("role", "tab");
			btn.dataset.tab = tab.id;
			btn.innerHTML = icon(tab.icon);
			btn.addEventListener("click", () => {
				this.tab = tab.id;
				this.render();
			});
			this.tabsEl.appendChild(btn);
		}

		let searchTimer = null;
		this.search.addEventListener("input", () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(() => this.render(), 120);
		});
		this.category.addEventListener("change", () => this.render());

		const savedBg = localStorage.getItem(BG_KEY) || "white";
		for (const btn of this.footer.querySelectorAll("button[data-bg]")) {
			btn.addEventListener("click", () => this.setBackground(btn.dataset.bg));
		}
		this.setBackground(savedBg);

		this.render();
		renderThumbnails(RECIPES, (id, url) => {
			this.thumbs.set(id, url);
			const thumb = this.grid.querySelector(`[data-asset="${id}"] .asset-thumb`);
			if (thumb) this._fillThumb(thumb, id);
		});
	}

	setBackground(bg) {
		this.grid.classList.remove("bg-white", "bg-black", "bg-none");
		this.grid.classList.add(`bg-${bg}`);
		for (const btn of this.footer.querySelectorAll("button[data-bg]")) btn.classList.toggle("active", btn.dataset.bg === bg);
		localStorage.setItem(BG_KEY, bg);
	}

	markRecent(id) {
		this.recent = [id, ...this.recent.filter((r) => r !== id)].slice(0, 12);
		localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
		if (this.tab === "recent") this.render();
	}

	_loadRecent() {
		try {
			const list = JSON.parse(localStorage.getItem(RECENT_KEY));
			return Array.isArray(list) ? list : [];
		} catch (ignored) {
			return [];
		}
	}

	_visibleRecipes() {
		const query = this.search.value.trim().toLowerCase();
		const category = this.category.value;
		let list;
		switch (this.tab) {
			case "inventory": list = RECIPES.filter((r) => r.category === "parts"); break;
			case "recent": list = this.recent.map((id) => RECIPES.find((r) => r.id === id)).filter(Boolean); break;
			case "creations": list = []; break;
			default: list = RECIPES;
		}
		if (category !== "all") list = list.filter((r) => r.category === category);
		if (query) list = list.filter((r) => r.name.toLowerCase().includes(query));
		return list;
	}

	render() {
		for (const btn of this.tabsEl.children) btn.setAttribute("aria-selected", String(btn.dataset.tab === this.tab));
		const query = this.search.value.trim();
		const isRoblox = this.tab === "marketplace" && query.length > 0;
		this.robloxType.style.display = isRoblox ? "" : "none";
		if (isRoblox) { this._renderMarketplaceSearch(query); return; }
		const list = this._visibleRecipes();
		this.grid.innerHTML = "";
		if (list.length === 0) {
			const empty = document.createElement("p");
			empty.className = "empty-state";
			empty.textContent = this.tab === "creations"
				? "You haven't created any assets yet."
				: this.tab === "recent" && !this.search.value ? "Assets you insert will show up here." : "No assets match your search.";
			this.grid.appendChild(empty);
			return;
		}
		for (const recipe of list) {
			const card = document.createElement("button");
			card.type = "button";
			card.className = "asset-card";
			card.dataset.asset = recipe.id;
			card.draggable = true;
			card.title = `Insert ${recipe.name} (click, or drag into the viewport)`;
			card.innerHTML = `<div class="asset-thumb placeholder">${icon(recipe.icon)}</div><span class="asset-name"></span>`;
			card.querySelector(".asset-name").textContent = recipe.name;
			this._fillThumb(card.querySelector(".asset-thumb"), recipe.id);
			card.addEventListener("click", () => this.onInsert(recipe));
			card.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData("application/x-studiolite-asset", recipe.id);
				e.dataTransfer.effectAllowed = "copy";
			});
			this.grid.appendChild(card);
		}
	}

	/** Marketplace with a query: resolve an Asset ID/URL directly, or search the Creator Store by text. */
	_renderMarketplaceSearch(query) {
		const token = ++this._reqToken;
		const cls = classifyQuery(query);
		if (cls.kind === "id") {
			this._showStatus(`Carregando asset ${cls.assetId}…`, true);
			this._lookupById(cls.assetId, token);
		} else {
			this._showStatus("Buscando na Creator Store…", true);
			this._search(cls.query, token);
		}
	}

	async _lookupById(id, token) {
		try {
			const asset = await robloxAssetService.getAssetDetails(id);
			if (token !== this._reqToken) return;
			this._renderAssets([asset]);
		} catch (err) {
			if (token !== this._reqToken) return;
			this._showError(err, `Não foi possível carregar o asset ${id}.`);
		}
	}

	async _search(query, token) {
		try {
			const result = await robloxAssetService.searchCreatorStore(query, { assetType: this.robloxType.value });
			if (token !== this._reqToken) return;
			if (!result.items || result.items.length === 0) {
				this._showStatus(`Nenhum resultado para "${query}".`, false);
				return;
			}
			this._renderAssets(result.items, result.totalResults);
		} catch (err) {
			if (token !== this._reqToken) return;
			this._showSearchError(err, query);
		}
	}

	/** Loading / status placeholder. */
	_showStatus(text, spinning) {
		this.grid.innerHTML = "";
		const p = document.createElement("p");
		p.className = "toolbox-status" + (spinning ? " loading" : "");
		p.textContent = text;
		this.grid.appendChild(p);
	}

	_showError(err, fallback) {
		this.grid.innerHTML = "";
		const p = document.createElement("p");
		p.className = "toolbox-status error";
		p.textContent = (err && err.message) || fallback;
		this.grid.appendChild(p);
	}

	/** Search failed (often: no API key configured, or proxy offline). Explain + offer local parts. */
	_showSearchError(err, query) {
		this.grid.innerHTML = "";
		const wrap = document.createElement("div");
		wrap.className = "toolbox-search-error";
		const msg = document.createElement("p");
		msg.className = "toolbox-status error";
		const noKey = err && (err.code === "no_api_key" || /API key/i.test(err.message || ""));
		msg.textContent = noKey
			? "Busca por texto na Creator Store precisa de uma API key no servidor. Você ainda pode colar um Asset ID ou URL para importar diretamente."
			: ((err && err.message) || "Falha ao buscar na Creator Store.");
		wrap.appendChild(msg);
		const local = RECIPES.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
		if (local.length) {
			const hint = document.createElement("p");
			hint.className = "toolbox-status";
			hint.textContent = "Peças locais que correspondem:";
			wrap.appendChild(hint);
		}
		this.grid.appendChild(wrap);
		for (const recipe of local) this.grid.appendChild(this._recipeCard(recipe));
	}

	_recipeCard(recipe) {
		const card = document.createElement("button");
		card.type = "button";
		card.className = "asset-card";
		card.dataset.asset = recipe.id;
		card.draggable = true;
		card.innerHTML = `<div class="asset-thumb placeholder">${icon(recipe.icon)}</div><span class="asset-name"></span>`;
		card.querySelector(".asset-name").textContent = recipe.name;
		this._fillThumb(card.querySelector(".asset-thumb"), recipe.id);
		card.addEventListener("click", () => this.onInsert(recipe));
		card.addEventListener("dragstart", (e) => {
			e.dataTransfer.setData("application/x-studiolite-asset", recipe.id);
			e.dataTransfer.effectAllowed = "copy";
		});
		return card;
	}

	/** Render Roblox asset cards (from an ID lookup or a search). */
	_renderAssets(assets, totalResults) {
		this.grid.innerHTML = "";
		if (typeof totalResults === "number" && totalResults > assets.length) {
			const info = document.createElement("p");
			info.className = "toolbox-status";
			info.textContent = `Mostrando ${assets.length} de ${totalResults} resultados.`;
			this.grid.appendChild(info);
		}
		for (const asset of assets) this.grid.appendChild(this._assetCard(asset));
	}

	_assetCard(asset) {
		const id = asset.id;
		const name = asset.name || `Asset ${id}`;
		const type = asset.assetType || "";
		const creator = (asset.creator && asset.creator.name) || "";
		const importable = asset.importCategory && asset.importCategory !== "unsupported";

		const card = document.createElement("div");
		card.className = "asset-card roblox-card" + (importable ? "" : " unsupported");
		card.dataset.rbxAsset = String(id);
		card.draggable = !!importable;
		card.title = `${name}${type ? ` · ${type}` : ""}${creator ? ` · por ${creator}` : ""}`;

		const thumb = document.createElement("div");
		thumb.className = "asset-thumb placeholder";
		thumb.innerHTML = icon("tabMarketplace");
		card.appendChild(thumb);
		if (asset.thumbnailUrl) this._setThumbImg(thumb, asset.thumbnailUrl);
		else this._fillRemoteThumb(thumb, id);

		const label = document.createElement("span");
		label.className = "asset-name";
		label.textContent = name;
		card.appendChild(label);

		const meta = document.createElement("span");
		meta.className = "asset-meta";
		meta.textContent = `${type || "?"} · ${id}`;
		card.appendChild(meta);

		const actions = document.createElement("div");
		actions.className = "asset-actions";
		if (this.onPreviewAsset) {
			const prev = document.createElement("button");
			prev.type = "button"; prev.className = "asset-btn"; prev.textContent = "Preview";
			prev.addEventListener("click", (e) => { e.stopPropagation(); this.onPreviewAsset(asset); });
			actions.appendChild(prev);
		} else if (asset.thumbnailUrl) {
			const prev = document.createElement("a");
			prev.className = "asset-btn"; prev.textContent = "Preview";
			prev.href = asset.thumbnailUrl; prev.target = "_blank"; prev.rel = "noreferrer";
			prev.addEventListener("click", (e) => e.stopPropagation());
			actions.appendChild(prev);
		}
		const add = document.createElement("button");
		add.type = "button"; add.className = "asset-btn primary";
		add.textContent = importable ? "Add to Scene" : "Sem importer";
		add.disabled = !importable;
		add.addEventListener("click", (e) => { e.stopPropagation(); this.onInsertAsset(asset); });
		actions.appendChild(add);
		card.appendChild(actions);

		if (importable) {
			card.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData("application/x-studiolite-roblox", String(id));
				e.dataTransfer.effectAllowed = "copy";
			});
		}
		return card;
	}

	async _fillRemoteThumb(thumb, id) {
		try {
			const url = await robloxAssetService.getAssetThumbnail(id);
			if (url && thumb.isConnected) this._setThumbImg(thumb, url);
		} catch (ignored) { /* keep placeholder */ }
	}

	_setThumbImg(thumb, url) {
		thumb.classList.remove("placeholder");
		thumb.innerHTML = `<img alt="" draggable="false" src="${url}">`;
	}

	_fillThumb(thumb, id) {
		const url = this.thumbs.get(id);
		if (!url) return;
		thumb.classList.remove("placeholder");
		thumb.innerHTML = `<img alt="" draggable="false" src="${url}">`;
	}
}
