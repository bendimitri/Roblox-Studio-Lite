import { AnimationClip, QuaternionKeyframeTrack, Quaternion, Vector3, VectorKeyframeTrack } from "../thirdparty/three/three.module.js";

/*
 * Roblox default R15 "Animate" LocalScript: same animNames table (ids + weights) as the script
 * every character spawns with. The KeyframeSequences are converted ahead of time by
 * tools/fetch-default-animations.mjs into app/assets/animations/<id>.json.
 */
export const ANIM_NAMES = {
	idle: [
		{ id: 507766666, weight: 1 },
		{ id: 507766951, weight: 1 },
		{ id: 507766388, weight: 9 }
	],
	walk: [{ id: 507777826, weight: 10 }],
	run: [{ id: 507767714, weight: 10 }],
	swim: [{ id: 507784897, weight: 10 }],
	swimidle: [{ id: 507785072, weight: 10 }],
	jump: [{ id: 507765000, weight: 10 }],
	fall: [{ id: 507767968, weight: 10 }],
	climb: [{ id: 507765644, weight: 10 }],
	sit: [{ id: 507768133, weight: 10 }],
	toolnone: [{ id: 507768375, weight: 10 }],
	toolslash: [{ id: 522635514, weight: 10 }],
	toollunge: [{ id: 522638767, weight: 10 }],
	wave: [{ id: 507770239, weight: 10 }],
	point: [{ id: 507770453, weight: 10 }],
	dance: [
		{ id: 507771019, weight: 10 },
		{ id: 507771955, weight: 10 },
		{ id: 507772104, weight: 10 }
	],
	dance2: [
		{ id: 507776043, weight: 10 },
		{ id: 507776720, weight: 10 },
		{ id: 507776879, weight: 10 }
	],
	dance3: [
		{ id: 507777268, weight: 10 },
		{ id: 507777451, weight: 10 },
		{ id: 507777623, weight: 10 }
	],
	laugh: [{ id: 507770818, weight: 10 }],
	cheer: [{ id: 507770677, weight: 10 }]
};

/** Emotes the Animate script loops; the others play once. */
export const LOOPED_EMOTES = new Set(["dance", "dance2", "dance3"]);

const cache = new Map();

function fetchData(id) {
	if (!cache.has(id)) {
		const url = new URL(`../assets/animations/${id}.json`, import.meta.url);
		cache.set(
			id,
			fetch(url).then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
		);
	}
	return cache.get(id);
}

/** Bone tracks for a rig whose bones are named after the R15 parts; Pose transforms sit on top of the rest pose. */
export function buildClip(data, rest, name) {
	const tracks = [];
	const q = new Quaternion();
	const v = new Vector3();
	for (const [bone, track] of Object.entries(data.tracks)) {
		const base = rest[bone];
		if (!base || !track.times.length) continue;
		const quats = [];
		for (let i = 0; i < track.quaternions.length; i += 4) {
			q.fromArray(track.quaternions, i).premultiply(base.quaternion);
			quats.push(q.x, q.y, q.z, q.w);
		}
		tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, track.times, quats));
		if (track.positions) {
			const positions = [];
			for (let i = 0; i < track.positions.length; i += 3) {
				v.fromArray(track.positions, i).applyQuaternion(base.quaternion).add(base.position);
				positions.push(v.x, v.y, v.z);
			}
			tracks.push(new VectorKeyframeTrack(`${bone}.position`, track.times, positions));
		}
	}
	const clip = new AnimationClip(name, data.length > 0 ? data.length : -1, tracks);
	clip.userData = { loop: data.loop, priority: data.priority, sourceName: data.name };
	return clip;
}

/**
 * Loads the given animNames entries for a rig. Variants that fail to load are skipped.
 * @returns {Promise<Record<string, { clip: AnimationClip, weight: number, id: number }[]>>}
 */
export async function loadAnimateClips(rest, names = Object.keys(ANIM_NAMES)) {
	const out = {};
	await Promise.all(
		names.map(async (name) => {
			const variants = await Promise.all(
				ANIM_NAMES[name].map(async ({ id, weight }, i) => {
					try {
						const data = await fetchData(id);
						return { clip: buildClip(data, rest, `${name}${i + 1}`), weight, id };
					} catch {
						return null;
					}
				})
			);
			const ok = variants.filter(Boolean);
			if (ok.length) out[name] = ok;
		})
	);
	return out;
}

/** Weighted pick, like the Animate script's rollAnimation. */
export function rollVariant(variants) {
	const total = variants.reduce((s, v) => s + v.weight, 0);
	let roll = Math.random() * total;
	for (const v of variants) {
		roll -= v.weight;
		if (roll <= 0) return v;
	}
	return variants[variants.length - 1];
}
