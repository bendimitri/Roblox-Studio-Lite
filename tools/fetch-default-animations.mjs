/*
 * Downloads the default Animate-script animations through the local Roblox proxy
 * (npm start / node server/index.mjs) and converts them to app/assets/animations/<id>.json.
 *
 *   node tools/fetch-default-animations.mjs [proxyBase]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "../app/thirdparty/rbxBinaryParser.js";
import { convertKeyframeSequence } from "../app/animation/KeyframeSequenceConverter.js";
import { ANIM_NAMES } from "../app/play/DefaultAnimate.js";
import { R15_BONES } from "../app/animation/R15Rig.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "app", "assets", "animations");
const base = process.argv[2] || "http://localhost:8787";
mkdirSync(outDir, { recursive: true });

const joints = R15_BONES.filter((b) => b !== "HumanoidRootPart");
const ids = [...new Set(Object.values(ANIM_NAMES).flat().map((v) => v.id))];
const quiet = console.log;
let failed = 0;

for (const id of ids) {
	try {
		const res = await fetch(`${base}/api/roblox/assets/${id}/content`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const buffer = await res.arrayBuffer();
		console.log = () => {};
		let roots;
		try {
			roots = decode(buffer);
		} finally {
			console.log = quiet;
		}
		const find = (list) => {
			for (const inst of list || []) {
				if (inst.ClassName === "KeyframeSequence") return inst;
				const hit = find(inst.Children);
				if (hit) return hit;
			}
			return null;
		};
		const sequence = find(roots);
		if (!sequence) throw new Error("sem KeyframeSequence");
		const data = convertKeyframeSequence(sequence, joints);
		data.id = id;
		const json = JSON.stringify(data);
		writeFileSync(join(outDir, `${id}.json`), json);
		console.log(`${id} ${data.name} ${data.length.toFixed(2)}s loop=${data.loop} ${Object.keys(data.tracks).length} bones ${(json.length / 1024).toFixed(0)} KB`);
	} catch (err) {
		failed++;
		console.log(`${id} FALHOU: ${err.message}`);
	}
}
process.exit(failed ? 1 : 0);
