/**
 * Roblox-style materials: PBR maps (albedo/normal/roughness/metalness) from
 * MaximumADHD/Roblox-Materials, tiled by physical studs (never stretched on resize).
 *
 * Local:  ./assets/materials/{Name}/{color|normal|roughness|metalness}.png
 * CDN:    jsDelivr mirror of github.com/MaximumADHD/Roblox-Materials (Modern/)
 * Fallback: procedural seamless canvas (materials without a pack).
 */
import {
	CanvasTexture,
	RepeatWrapping,
	SRGBColorSpace,
	LinearSRGBColorSpace,
	TextureLoader
} from "../thirdparty/three/three.core.js";

export const MATERIALS = [
	"Plastic", "SmoothPlastic", "Neon", "Wood", "WoodPlanks", "Marble", "Slate",
	"Concrete", "Granite", "Brick", "Pebble", "Cobblestone", "Metal", "CorrodedMetal",
	"DiamondPlate", "Foil", "Grass", "LeafyGrass", "Ice", "Glacier", "Sand", "Sandstone",
	"Rock", "Salt", "Snow", "Mud", "Ground", "Limestone", "Basalt", "Asphalt", "CrackedLava",
	"Pavement", "Fabric", "Glass", "ForceField",
	"Cardboard", "Carpet", "CeramicTiles", "ClayRoofTiles", "Leather", "Plaster", "RoofShingles", "Rubber"
];

/**
 * Studs covered by ONE texture tile — Roblox Part MaterialService stud tiling.
 * tilesU = faceWidth / TILE_STUDS, tilesV = faceHeight / TILE_STUDS.
 * Change this to adjust global material density (e.g. 2 = denser, 8 = coarser).
 */
export const TILE_STUDS = 4;

/** Materials with flat color only (no albedo tiling). */
const SMOOTH = new Set(["SmoothPlastic", "Neon", "ForceField"]);

/** Modern pack folders present in MaximumADHD/Roblox-Materials. */
const PBR_PACKS = new Set([
	"Asphalt", "Basalt", "Brick", "CeramicTiles", "ClayRoofTiles", "Cobblestone",
	"Concrete", "CorrodedMetal", "CrackedLava", "DiamondPlate", "Fabric", "Foil",
	"Glacier", "Glass", "Granite", "Grass", "Ground", "Ice", "LeafyGrass", "Limestone",
	"Marble", "Metal", "Mud", "Pavement", "Pebble", "Plastic", "Rock", "RoofShingles",
	"Rubber", "Salt", "Sand", "Sandstone", "Slate", "Snow", "Wood", "WoodPlanks"
]);

const LOCAL_BASE = new URL("../assets/materials/", import.meta.url).href;
const CDN_BASE = "https://cdn.jsdelivr.net/gh/MaximumADHD/Roblox-Materials@main/Modern/";

const MATTE = { roughness: 0.85, metalness: 0.0 };
const LOOKS = {
	Plastic: { roughness: 0.55, metalness: 0.0 },
	SmoothPlastic: { roughness: 0.25, metalness: 0.0 },
	Neon: { roughness: 0.4, metalness: 0.0, emissive: true },
	Metal: { roughness: 0.35, metalness: 0.85 },
	CorrodedMetal: { roughness: 0.75, metalness: 0.55 },
	DiamondPlate: { roughness: 0.4, metalness: 0.8 },
	Foil: { roughness: 0.15, metalness: 0.9 },
	Marble: { roughness: 0.3, metalness: 0.05 },
	Ice: { roughness: 0.15, metalness: 0.05, opacity: 0.85 },
	Glass: { roughness: 0.05, metalness: 0.0, opacity: 0.45 },
	ForceField: { roughness: 0.5, metalness: 0.0, opacity: 0.2, emissive: true, wireframe: true }
};

const _loader = new TextureLoader();
_loader.crossOrigin = "anonymous";

/** @type {Map<string, Promise<{map?:*, normalMap?:*, roughnessMap?:*, metalnessMap?:*}|null>>} */
const _pbrCache = new Map();
/** Resolved packs for sync apply (avoids procedural flash before PBR). */
const _pbrReady = new Map();
const _procCache = new Map();

/** True when this name has a Modern PBR pack (local/CDN), not only procedural. */
export function materialHasPBRPack(name) {
	return !!name && !SMOOTH.has(name) && PBR_PACKS.has(name);
}

/** Sync peek: `undefined` = still loading / never requested; else maps or null. */
export function peekMaterialPBR(name) {
	if (!materialHasPBRPack(name)) return null;
	return _pbrReady.has(name) ? _pbrReady.get(name) : undefined;
}

export function hexToColor3(hex) {
	const n = parseInt(hex.replace("#", ""), 16);
	return { R: ((n >> 16) & 255) / 255, G: ((n >> 8) & 255) / 255, B: (n & 255) / 255 };
}

export function color3ToHex(c) {
	const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
	return `#${to(c.R)}${to(c.G)}${to(c.B)}`;
}

function eachMat(material, cb) {
	for (const m of Array.isArray(material) ? material : [material]) {
		if (m && (m.isMeshStandardMaterial || m.isMeshPhongMaterial)) cb(m);
	}
}

/**
 * Applies Roblox Material look (roughness/metalness/opacity) on Standard or Phong.
 */
export function applyMaterialLook(material, name, transparency = 0) {
	const look = LOOKS[name] || (name === "Plastic" ? LOOKS.Plastic : MATTE);
	const base = 1 - (Number.isFinite(transparency) ? transparency : 0);
	eachMat(material, (m) => {
		if (m.isMeshStandardMaterial) {
			m.roughness = look.roughness ?? 0.8;
			m.metalness = look.metalness ?? 0;
			if (look.emissive && !m.map) m.emissive.copy(m.color).multiplyScalar(0.9);
			else m.emissive.setHex(0x000000);
		} else if (m.isMeshPhongMaterial) {
			m.shininess = look.emissive ? 0 : Math.round((1 - (look.roughness ?? 0.8)) * 100);
			m.specular.setHex(look.metalness > 0.5 ? 0x888888 : 0x222222);
			if (look.emissive && !m.map) m.emissive.copy(m.color).multiplyScalar(0.9);
			else m.emissive.setHex(0x000000);
		}
		const opacity = look.opacity !== undefined ? Math.min(base, look.opacity) : base;
		m.opacity = opacity;
		m.transparent = opacity < 1;
		m.wireframe = !!look.wireframe;
		m.needsUpdate = true;
	});
}

/** Tints faces; material-map faces keep albedo and multiply by color (Roblox tint). */
export function applyColor(material, color, materialName) {
	eachMat(material, (m) => {
		if (m.map && !m.userData.materialMap) return;
		m.color.copy(color);
	});
	if (materialName === "Neon" || materialName === "ForceField") {
		eachMat(material, (m) => {
			if (!m.map) m.emissive.copy(m.color).multiplyScalar(0.9);
		});
	}
}

function configureMap(tex, srgb) {
	if (!tex) return null;
	tex.wrapS = tex.wrapT = RepeatWrapping;
	tex.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
	return tex;
}

function loadTex(url, srgb) {
	return new Promise((resolve) => {
		_loader.load(
			url,
			(t) => resolve(configureMap(t, srgb)),
			undefined,
			() => resolve(null)
		);
	});
}

async function loadMapPair(name, file, srgb) {
	const local = `${LOCAL_BASE}${name}/${file}`;
	const a = await loadTex(local, srgb);
	if (a) return a;
	return loadTex(`${CDN_BASE}${name}/${file}`, srgb);
}

/**
 * Async PBR pack for a Roblox material name.
 * Returns null for smooth materials or when no maps exist (caller may use procedural).
 */
export function getMaterialPBR(name) {
	if (!name || SMOOTH.has(name) || !PBR_PACKS.has(name)) {
		_pbrReady.set(name, null);
		return Promise.resolve(null);
	}
	if (_pbrCache.has(name)) return _pbrCache.get(name);
	const p = (async () => {
		const [map, normalMap, roughnessMap, metalnessMap] = await Promise.all([
			loadMapPair(name, "color.png", true),
			loadMapPair(name, "normal.png", false),
			loadMapPair(name, "roughness.png", false),
			loadMapPair(name, "metalness.png", false)
		]);
		const pack = (!map && !normalMap && !roughnessMap)
			? null
			: { map, normalMap, roughnessMap, metalnessMap };
		_pbrReady.set(name, pack);
		return pack;
	})();
	_pbrCache.set(name, p);
	return p;
}

export function materialHasTexture(name) {
	return !!name && !SMOOTH.has(name) && (PBR_PACKS.has(name) || !!SPECS[name]);
}

/** Sync albedo only (procedural fallback). Prefer getMaterialPBR for full PBR. */
export function getMaterialTexture(name) {
	if (!materialHasTexture(name)) return null;
	if (_procCache.has(name)) return _procCache.get(name);
	if (!SPECS[name]) return null;
	const tex = buildTexture(name);
	_procCache.set(name, tex);
	return tex;
}

export const BASEPLATE_TILE_STUDS = 32;
let _baseplateTex = null;

export function getBaseplateTexture() {
	if (_baseplateTex) return _baseplateTex;
	const S = 128;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = S;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#3b4250";
	ctx.fillRect(0, 0, S, S);
	ctx.fillStyle = "#333a46";
	ctx.fillRect(0, 0, S / 2, S / 2);
	ctx.fillRect(S / 2, S / 2, S / 2, S / 2);
	const cells = 8, step = S / cells;
	ctx.strokeStyle = "rgba(255,255,255,0.05)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let i = 0; i <= cells; i++) {
		const p = Math.round(i * step) + 0.5;
		ctx.moveTo(p, 0); ctx.lineTo(p, S);
		ctx.moveTo(0, p); ctx.lineTo(S, p);
	}
	ctx.stroke();
	ctx.strokeStyle = "rgba(255,255,255,0.1)";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	const m = S / 2 + 0.5;
	ctx.moveTo(m, 0); ctx.lineTo(m, S);
	ctx.moveTo(0, m); ctx.lineTo(S, m);
	ctx.stroke();
	const tex = new CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = RepeatWrapping;
	tex.colorSpace = SRGBColorSpace;
	tex.anisotropy = 4;
	tex.needsUpdate = true;
	_baseplateTex = tex;
	return tex;
}

/* ------------------------------------------------------------------ *
 * Procedural fallback (Cardboard / missing packs) — cell grid, seamless.
 * ------------------------------------------------------------------ */

const TEX_SIZE = 256;

const SPECS = {
	Wood: { type: "planks", c1: "#8a5a2b", var: 12, groove: "rgba(40,22,8,0.5)", planks: 8 },
	WoodPlanks: { type: "planks", c1: "#b07a3c", var: 14, groove: "rgba(60,35,12,0.55)", planks: 8 },
	Brick: { type: "bricks", brick: "#a2503c", mortar: "#cbc3b4", rows: 6, cols: 3, var: 16 },
	Cobblestone: { type: "cobbles", stone: "#7d756a", grout: "#50493f", count: 6, var: 18 },
	Pebble: { type: "cobbles", stone: "#9a948a", grout: "#6d665c", count: 9, var: 14 },
	Pavement: { type: "cobbles", stone: "#9d9c97", grout: "#6f6e68", count: 5, var: 10 },
	Rock: { type: "cobbles", stone: "#8c8a86", grout: "#605d58", count: 5, var: 20 },
	Grass: { type: "grain", c1: "#5d8138", c2: "#3b5623", cells: 10, contrast: 1.5 },
	LeafyGrass: { type: "grain", c1: "#4f7a2c", c2: "#2f4d1b", cells: 11, contrast: 1.7 },
	Sand: { type: "grain", c1: "#dcc794", c2: "#c3ab73", cells: 12, contrast: 1.15 },
	Sandstone: { type: "grain", c1: "#caa06a", c2: "#ad8349", cells: 9, contrast: 1.25 },
	Snow: { type: "grain", c1: "#f3f7fc", c2: "#dde8f3", cells: 10, contrast: 0.95 },
	Salt: { type: "grain", c1: "#eef0f3", c2: "#d6dade", cells: 12, contrast: 1.05 },
	Ground: { type: "grain", c1: "#6b5235", c2: "#48381f", cells: 9, contrast: 1.4 },
	Mud: { type: "grain", c1: "#4a3826", c2: "#2f2218", cells: 8, contrast: 1.35 },
	Limestone: { type: "grain", c1: "#cccbb6", c2: "#b1ae97", cells: 8, contrast: 1.05 },
	Concrete: { type: "grain", c1: "#bab9b2", c2: "#a0a099", cells: 10, contrast: 1.0 },
	Asphalt: { type: "grain", c1: "#3c4046", c2: "#2b2f34", cells: 11, contrast: 1.2 },
	Basalt: { type: "grain", c1: "#3b3e43", c2: "#26282c", cells: 8, contrast: 1.35 },
	Slate: { type: "grain", c1: "#4f575d", c2: "#373d43", cells: 7, contrast: 1.25 },
	Granite: { type: "grain", c1: "#9a8f88", c2: "#6c645e", cells: 10, contrast: 1.7 },
	Marble: { type: "grain", c1: "#edebe7", c2: "#cfcac1", cells: 6, contrast: 1.5, veins: true },
	Ice: { type: "grain", c1: "#c3e8ff", c2: "#9fd0f2", cells: 7, contrast: 1.05 },
	Glacier: { type: "grain", c1: "#d0eeff", c2: "#a9d8f2", cells: 6, contrast: 0.95 },
	CrackedLava: { type: "grain", c1: "#2a2320", c2: "#e2591f", cells: 7, contrast: 2.2 },
	Metal: { type: "grain", c1: "#babdc2", c2: "#9aa0a6", cells: 10, contrast: 0.85 },
	CorrodedMetal: { type: "grain", c1: "#86613f", c2: "#5e4a3a", cells: 8, contrast: 1.55 },
	DiamondPlate: { type: "grain", c1: "#a3a7ac", c2: "#83878c", cells: 6, contrast: 1.0, hatch: true },
	Foil: { type: "grain", c1: "#d2d6db", c2: "#b4b9bf", cells: 10, contrast: 0.7 },
	Fabric: { type: "grain", c1: "#8a8f99", c2: "#6f747e", cells: 12, contrast: 0.85 },
	Cardboard: { type: "planks", c1: "#c4a574", var: 10, groove: "rgba(90,60,30,0.4)", planks: 8 },
	Carpet: { type: "grain", c1: "#6a4a3a", c2: "#4e3428", cells: 12, contrast: 1.0 },
	CeramicTiles: { type: "bricks", brick: "#e8e4dc", mortar: "#b8b4ac", rows: 4, cols: 4, var: 8 },
	ClayRoofTiles: { type: "bricks", brick: "#b85a3a", mortar: "#8a4030", rows: 8, cols: 3, var: 14 },
	Leather: { type: "grain", c1: "#8b5a3c", c2: "#6b4228", cells: 8, contrast: 1.25 },
	Plaster: { type: "grain", c1: "#e6e2d8", c2: "#d0cbc0", cells: 9, contrast: 0.8 },
	RoofShingles: { type: "bricks", brick: "#4a4e54", mortar: "#2e3238", rows: 8, cols: 4, var: 12 },
	Rubber: { type: "grain", c1: "#2a2a2c", c2: "#1a1a1c", cells: 10, contrast: 0.9 }
};

function rnd(seed) {
	let s = (seed >>> 0) || 1;
	s = (s * 1664525 + 1013904223) >>> 0;
	return s / 4294967296;
}
function hexRgb(hex) {
	const n = parseInt(hex.replace("#", ""), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, delta) {
	const [r, g, b] = hexRgb(hex);
	const c = (v) => Math.max(0, Math.min(255, Math.round(v + delta)));
	return `rgb(${c(r)},${c(g)},${c(b)})`;
}
function vary(hex, amount, seed) {
	return shade(hex, (rnd(seed) - 0.5) * 2 * amount);
}
function fillRectWrap(ctx, x, y, w, h) {
	for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
		for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) ctx.fillRect(x + ox, y + oy, w, h);
	}
}
function drawGrain(ctx, c1, c2, cells, contrast, seed) {
	const grid = Math.max(6, Math.min(16, (cells | 0) || 10));
	const step = TEX_SIZE / grid;
	const gap = Math.max(1.5, step * 0.1);
	const ctr = Number.isFinite(contrast) ? contrast : 1;
	ctx.fillStyle = shade(c2, -36);
	ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
	for (let gy = 0; gy < grid; gy++) {
		for (let gx = 0; gx < grid; gx++) {
			const t = Math.min(1, Math.max(0, (rnd(seed + gx * 31 + gy * 17) - 0.5) * ctr + 0.5));
			const [r1, g1, b1] = hexRgb(c1), [r2, g2, b2] = hexRgb(c2);
			ctx.fillStyle = `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
			fillRectWrap(ctx, gx * step + gap / 2, gy * step + gap / 2, step - gap, step - gap);
		}
	}
}
function drawBricks(ctx, spec, seed) {
	const rows = spec.rows || 5, cols = spec.cols || 3;
	const bh = TEX_SIZE / rows, bw = TEX_SIZE / cols;
	const gap = Math.max(2, TEX_SIZE * 0.02);
	ctx.fillStyle = spec.mortar;
	ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
	for (let r = 0; r < rows; r++) {
		const off = (r % 2) ? bw / 2 : 0;
		for (let c = -1; c <= cols; c++) {
			ctx.fillStyle = vary(spec.brick, spec.var || 14, seed + r * 31 + c * 7);
			fillRectWrap(ctx, c * bw + off + gap / 2, r * bh + gap / 2, bw - gap, bh - gap);
		}
	}
}
function drawPlanks(ctx, spec, seed) {
	const planks = spec.planks || 8;
	const pw = TEX_SIZE / planks;
	ctx.fillStyle = shade(spec.c1, -40);
	ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
	for (let p = 0; p < planks; p++) {
		const base = vary(spec.c1, spec.var || 10, seed + p * 13);
		const gap = Math.max(2, TEX_SIZE * 0.015);
		ctx.fillStyle = base;
		ctx.fillRect(p * pw + gap / 2, 0, pw - gap, TEX_SIZE);
	}
	ctx.fillStyle = spec.groove || "rgba(0,0,0,0.45)";
	const gw = Math.max(2, TEX_SIZE * 0.018);
	for (let p = 0; p <= planks; p++) ctx.fillRect(p * pw - gw / 2, 0, gw, TEX_SIZE);
}
function drawCobbles(ctx, spec, seed) {
	const n = spec.count || 5;
	const cell = TEX_SIZE / n;
	ctx.fillStyle = spec.grout;
	ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
	for (let gy = 0; gy < n; gy++) {
		for (let gx = 0; gx < n; gx++) {
			const jx = (rnd(seed + gx * 7 + gy * 131) - 0.5) * cell * 0.35;
			const jy = (rnd(seed + gx * 17 + gy * 53) - 0.5) * cell * 0.35;
			const cx = (gx + 0.5) * cell + jx, cy = (gy + 0.5) * cell + jy;
			const rad = cell * 0.47 * (0.78 + 0.44 * rnd(seed + gx * 19 + gy * 7));
			const col = vary(spec.stone, spec.var || 16, seed + gx * 31 + gy * 17);
			for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
				for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
					ctx.fillStyle = col;
					ctx.beginPath();
					ctx.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		}
	}
}
function drawVeins(ctx, seed) {
	ctx.globalAlpha = 0.18;
	ctx.strokeStyle = "rgba(120,120,130,1)";
	for (let i = 0; i < 3; i++) {
		ctx.lineWidth = 1 + rnd(seed + i) * 2;
		const y0 = rnd(seed + i * 11) * TEX_SIZE;
		ctx.beginPath();
		ctx.moveTo(0, y0);
		ctx.bezierCurveTo(TEX_SIZE * 0.33, y0 + 30, TEX_SIZE * 0.66, y0 - 30, TEX_SIZE, y0);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}
function drawHatch(ctx) {
	ctx.globalAlpha = 0.22;
	ctx.strokeStyle = "rgba(255,255,255,0.8)";
	ctx.lineWidth = 2;
	const step = TEX_SIZE / 6;
	for (let i = -TEX_SIZE; i < TEX_SIZE; i += step) {
		ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + TEX_SIZE, TEX_SIZE); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(i + TEX_SIZE, 0); ctx.lineTo(i, TEX_SIZE); ctx.stroke();
	}
	ctx.globalAlpha = 1;
}
function buildTexture(name) {
	const spec = SPECS[name];
	if (!spec) return null;
	const seed = [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = TEX_SIZE;
	const ctx = canvas.getContext("2d");
	if (spec.type === "grain") {
		drawGrain(ctx, spec.c1, spec.c2, spec.cells, spec.contrast, seed);
		if (spec.veins) drawVeins(ctx, seed);
		if (spec.hatch) drawHatch(ctx);
	} else if (spec.type === "bricks") drawBricks(ctx, spec, seed);
	else if (spec.type === "planks") drawPlanks(ctx, spec, seed);
	else if (spec.type === "cobbles") drawCobbles(ctx, spec, seed);
	const tex = new CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = RepeatWrapping;
	tex.colorSpace = SRGBColorSpace;
	tex.anisotropy = 4;
	tex.needsUpdate = true;
	return tex;
}
