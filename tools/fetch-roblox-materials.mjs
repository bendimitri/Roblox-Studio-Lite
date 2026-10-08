/**
 * Downloads Modern PBR maps from MaximumADHD/Roblox-Materials and resizes to 512².
 * Usage: node tools/fetch-roblox-materials.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../app/assets/materials");
const SIZE = 512;
const BASE = "https://cdn.jsdelivr.net/gh/MaximumADHD/Roblox-Materials@main/Modern";
const MAPS = ["color.png", "normal.png", "roughness.png", "metalness.png"];

const MATERIALS = [
	"Asphalt", "Basalt", "Brick", "CeramicTiles", "ClayRoofTiles", "Cobblestone",
	"Concrete", "CorrodedMetal", "CrackedLava", "DiamondPlate", "Fabric", "Foil",
	"Glacier", "Glass", "Granite", "Grass", "Ground", "Ice", "LeafyGrass", "Limestone",
	"Marble", "Metal", "Mud", "Pavement", "Pebble", "Plastic", "Rock", "RoofShingles",
	"Rubber", "Salt", "Sand", "Sandstone", "Slate", "Snow", "Wood", "WoodPlanks"
];

async function fetchMap(mat, file) {
	const url = `${BASE}/${mat}/${file}`;
	const res = await fetch(url);
	if (!res.ok) return null;
	const buf = Buffer.from(await res.arrayBuffer());
	const outDir = path.join(OUT, mat);
	await fs.mkdir(outDir, { recursive: true });
	const outFile = path.join(outDir, file);
	await sharp(buf).resize(SIZE, SIZE, { fit: "fill" }).png().toFile(outFile);
	return outFile;
}

async function main() {
	await fs.mkdir(OUT, { recursive: true });
	let ok = 0, miss = 0;
	for (const mat of MATERIALS) {
		process.stdout.write(`${mat}… `);
		for (const file of MAPS) {
			try {
				const p = await fetchMap(mat, file);
				if (p) { ok++; process.stdout.write(file[0]); }
				else { miss++; process.stdout.write("-"); }
			} catch (e) {
				miss++;
				process.stdout.write("!");
			}
		}
		process.stdout.write("\n");
	}
	console.log(`Done. saved≈${ok} missing≈${miss} → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
