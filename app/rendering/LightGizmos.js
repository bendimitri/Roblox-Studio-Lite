/**
 * Roblox-style light holograms (edit mode).
 * Wireframe volume = exact Three.js light reach (light.distance / Range in studs):
 *   PointLight  → sphere of radius Range
 *   SpotLight   → cone of length Range (Angle = full cone)
 *   SurfaceLight → frustum of depth Range from the face
 */
import {
	BufferGeometry,
	Color,
	Float32BufferAttribute,
	Group,
	LineBasicMaterial,
	LineLoop,
	LineSegments,
	Quaternion,
	Vector3
} from "../thirdparty/three/three.core.js";

/** Roblox light guides: Point=sphere lamp, Spot=cone, Surface=square frustum. */
const COL = {
	PointLight: 0xffe14a,   // amarelo — lâmpada (todos os lados)
	SpotLight: 0xff4ad2,    // magenta — holofote (cone)
	SurfaceLight: 0x4aff6a  // verde — painel (quadrado a partir da face)
};

const FACES = {
	Front:  [0, 0, -1],
	Back:   [0, 0, 1],
	Right:  [1, 0, 0],
	Left:   [-1, 0, 0],
	Top:    [0, 1, 0],
	Bottom: [0, -1, 0]
};

const _wp = new Vector3();
const _wq = new Quaternion();
const _faceQ = new Quaternion();
const _z = new Vector3(0, 0, 1);
const _n = new Vector3();

function ringGeometry(radius, axis, segments = 48) {
	const pos = [];
	for (let i = 0; i <= segments; i++) {
		const a = (i / segments) * Math.PI * 2;
		const c = Math.cos(a) * radius, s = Math.sin(a) * radius;
		if (axis === "x") pos.push(0, c, s);
		else if (axis === "y") pos.push(c, 0, s);
		else pos.push(c, s, 0);
	}
	const g = new BufferGeometry();
	g.setAttribute("position", new Float32BufferAttribute(pos, 3));
	return g;
}

function lineMat(hex) {
	return new LineBasicMaterial({
		color: new Color(hex),
		depthTest: false,
		depthWrite: false,
		transparent: true,
		opacity: 0.95,
		toneMapped: false
	});
}

/**
 * Spot volume = cone with a SPHERICAL base (Roblox guide): every point is ≤ reach from the tip,
 * which is exactly where Three's distance cutoff stops the light.
 */
function spotConeGeometry(reach, halfAngle, segments = 40) {
	const pos = [];
	const rimR = Math.sin(halfAngle) * reach;
	const rimZ = Math.cos(halfAngle) * reach;
	const spokes = 8;
	const arcSteps = 12;
	// Rim circle (edge of the beam at full reach)
	for (let i = 0; i < segments; i++) {
		const a0 = (i / segments) * Math.PI * 2;
		const a1 = ((i + 1) / segments) * Math.PI * 2;
		pos.push(Math.cos(a0) * rimR, Math.sin(a0) * rimR, rimZ, Math.cos(a1) * rimR, Math.sin(a1) * rimR, rimZ);
	}
	for (let s = 0; s < spokes; s++) {
		const a = (s / spokes) * Math.PI * 2;
		const cx = Math.cos(a), cy = Math.sin(a);
		// Side line tip → rim (length = reach)
		pos.push(0, 0, 0, cx * rimR, cy * rimR, rimZ);
		// Spherical cap arc rim → axis tip
		for (let k = 0; k < arcSteps; k++) {
			const t0 = halfAngle * (1 - k / arcSteps);
			const t1 = halfAngle * (1 - (k + 1) / arcSteps);
			pos.push(
				cx * Math.sin(t0) * reach, cy * Math.sin(t0) * reach, Math.cos(t0) * reach,
				cx * Math.sin(t1) * reach, cy * Math.sin(t1) * reach, Math.cos(t1) * reach
			);
		}
	}
	pos.push(0, 0, 0, 0, 0, reach);
	const g = new BufferGeometry();
	g.setAttribute("position", new Float32BufferAttribute(pos, 3));
	return g;
}

function frustumGeometry(nw, nh, fw, fh, depth) {
	const n = [
		[-nw / 2, -nh / 2, 0], [nw / 2, -nh / 2, 0], [nw / 2, nh / 2, 0], [-nw / 2, nh / 2, 0]
	];
	const f = [
		[-fw / 2, -fh / 2, depth], [fw / 2, -fh / 2, depth], [fw / 2, fh / 2, depth], [-fw / 2, fh / 2, depth]
	];
	const pos = [];
	const edge = (a, b) => { pos.push(...a, ...b); };
	for (let i = 0; i < 4; i++) {
		edge(n[i], n[(i + 1) % 4]);
		edge(f[i], f[(i + 1) % 4]);
		edge(n[i], f[i]);
	}
	const mw = (nw + fw) * 0.5, mh = (nh + fh) * 0.5, mz = depth * 0.5;
	const m = [
		[-mw / 2, -mh / 2, mz], [mw / 2, -mh / 2, mz], [mw / 2, mh / 2, mz], [-mw / 2, mh / 2, mz]
	];
	for (let i = 0; i < 4; i++) edge(m[i], m[(i + 1) % 4]);
	const g = new BufferGeometry();
	g.setAttribute("position", new Float32BufferAttribute(pos, 3));
	return g;
}

/**
 * SurfaceLight frustum whose far corners sit on the guide sphere (70% of light.distance).
 * A plane at z = range with Angle-spread is too big: those corners stick out past the cutoff.
 */
function surfaceGuideSize(nw, nh, angleDeg, guideReach) {
	const theta = Math.max(0, Math.min(170, angleDeg)) * 0.5 * Math.PI / 180;
	const t = Math.tan(theta);
	const a = nw * 0.5, c = nh * 0.5, G = Math.max(0.1, guideReach);
	// hypot(a + t*d, c + t*d, d) = G  →  (2t²+1)d² + 2t(a+c)d + a²+c² − G² = 0
	const A = 2 * t * t + 1;
	const B = 2 * t * (a + c);
	const C = a * a + c * c - G * G;
	let d = G;
	const disc = B * B - 4 * A * C;
	if (disc >= 0 && A > 0) {
		const root = (-B + Math.sqrt(disc)) / (2 * A);
		if (root > 0.05) d = Math.min(G, root);
	}
	return { depth: d, farW: nw + 2 * t * d, farH: nh + 2 * t * d };
}

/** Guide covers 70% of the lit volume, not the faint tail of the cutoff. */
const GUIDE_REACH_SCALE = 0.7;

/** Resolve reach (studs) from the live THREE light first, scaled to the guide size. */
function resolveRange(rec, light) {
	const reach = light && Number(light.distance) > 0
		? light.distance
		: Math.max(0.25, Math.min(60, Number(rec.Range) || 8));
	return reach * GUIDE_REACH_SCALE;
}

function resolveHalfAngle(rec, light) {
	if (light && light.isSpotLight && Number.isFinite(light.angle)) return light.angle;
	return Math.min(Math.PI / 2, ((Number(rec.Angle) || 90) * Math.PI) / 360);
}

export class LightGizmos {
	constructor(scene) {
		this.scene = scene;
		this.root = new Group();
		this.root.name = "LightGizmos";
		this.root.userData.hideInExplorer = true;
		this.root.renderOrder = 999;
		this.scene.add(this.root);
		this.visible = true;
		this._entries = [];
	}

	setVisible(v) {
		this.visible = !!v;
		this.root.visible = this.visible && this._entries.length > 0;
	}

	clear() {
		for (const e of this._entries) {
			this.root.remove(e.group);
			e.group.traverse((o) => {
				if (o.geometry) o.geometry.dispose();
				if (o.material) o.material.dispose();
			});
		}
		this._entries = [];
		this.root.visible = false;
	}

	/** Show the hologram for one light instance (selected in the Explorer). */
	sync(lightInstance, renderer) {
		this.clear();
		if (!this.visible || !lightInstance) return;
		renderer?.scene?.traverse((o) => {
			if (!o.isLight || o.userData?.lightRef !== lightInstance) return;
			const parentMesh = o.parent?.isMesh ? o.parent : null;
			const g = this._buildOne(lightInstance, o, parentMesh);
			if (!g) return;
			this.root.add(g);
			this._entries.push({ group: g, rec: lightInstance, light: o, parentMesh, rangeKey: "" });
		});
		this.root.visible = this._entries.length > 0;
		this.update();
	}

	/** Pin hologram to light origin; rebuild if Range/Angle changed on the live light. */
	update() {
		if (!this.visible || !this._entries.length) return;
		for (const e of this._entries) {
			const light = e.light;
			if (!light || !light.parent) continue;

			const range = resolveRange(e.rec, light);
			const half = e.rec.ClassName === "PointLight" ? 0 : resolveHalfAngle(e.rec, light);
			const key = `${range.toFixed(3)}:${half.toFixed(4)}:${e.rec.Face || ""}`;
			if (e.rangeKey && e.rangeKey !== key) {
				// Live Range/Angle edit — rebuild this wireframe to match new reach
				this.root.remove(e.group);
				e.group.traverse((o) => {
					if (o.geometry) o.geometry.dispose();
					if (o.material) o.material.dispose();
				});
				const g = this._buildOne(e.rec, light, e.parentMesh);
				if (g) {
					this.root.add(g);
					e.group = g;
				}
			}
			e.rangeKey = key;

			light.getWorldPosition(_wp);
			e.group.position.copy(_wp);
			e.group.scale.set(1, 1, 1);
			if (e.rec.ClassName === "PointLight") {
				e.group.quaternion.identity();
			} else {
				const face = e.rec.Face || "Bottom";
				const n = FACES[face] || FACES.Bottom;
				_n.set(n[0], n[1], n[2]);
				if (e.parentMesh) {
					e.parentMesh.getWorldQuaternion(_wq);
					_n.applyQuaternion(_wq);
				}
				_faceQ.setFromUnitVectors(_z, _n.normalize());
				e.group.quaternion.copy(_faceQ);
			}
		}
	}

	_buildOne(rec, light, parentMesh) {
		const cls = rec.ClassName;
		const range = resolveRange(rec, light);
		const group = new Group();
		group.name = `Gizmo:${cls}`;
		group.userData.hideInExplorer = true;
		group.userData.lightGizmo = true;
		group.frustumCulled = false;
		group.raycast = () => {};

		const mat = lineMat(COL[cls] || 0xffffff);

		if (cls === "PointLight") {
			// Esfera = lâmpada omnidirecional (Range em studs)
			for (const axis of ["x", "y", "z"]) {
				group.add(new LineLoop(ringGeometry(range, axis), mat));
			}
			for (const t of [-0.5, 0.5]) {
				const ry = Math.sqrt(Math.max(0, 1 - t * t)) * range;
				const y = t * range;
				const pos = [];
				const segs = 40;
				for (let i = 0; i <= segs; i++) {
					const a = (i / segs) * Math.PI * 2;
					pos.push(Math.cos(a) * ry, y, Math.sin(a) * ry);
				}
				const g = new BufferGeometry();
				g.setAttribute("position", new Float32BufferAttribute(pos, 3));
				group.add(new LineLoop(g, mat));
			}
			const tick = new BufferGeometry();
			tick.setAttribute("position", new Float32BufferAttribute([-0.35, 0, 0, 0.35, 0, 0], 3));
			group.add(new LineSegments(tick, mat));
		} else if (cls === "SpotLight") {
			// Cone = holofote (comprimento = Range, abertura = Angle)
			const half = resolveHalfAngle(rec, light);
			group.add(new LineSegments(spotConeGeometry(range, half), mat));
		} else if (cls === "SurfaceLight") {
			// Frustum quadrado = painel (mesma lógica de alcance da PointLight, formato quadrado)
			const face = rec.Face || "Bottom";
			const size = parentMesh?.userData?.instance?.Size || parentMesh?.userData?.baseSize;
			const sx = size?.X || 4, sy = size?.Y || 1, sz = size?.Z || 4;
			const n = FACES[face] || FACES.Bottom;
			let nw, nh;
			if (Math.abs(n[1]) > 0.5) { nw = sx; nh = sz; }
			else if (Math.abs(n[0]) > 0.5) { nw = sz; nh = sy; }
			else { nw = sx; nh = sy; }
			const angleDeg = Math.max(0, Math.min(180, Number(rec.Angle) || 90));
			const { depth, farW, farH } = surfaceGuideSize(nw * 0.98, nh * 0.98, angleDeg, range);
			group.add(new LineSegments(frustumGeometry(nw * 0.98, nh * 0.98, farW, farH, depth), mat));
		} else {
			mat.dispose();
			return null;
		}
		return group;
	}
}
