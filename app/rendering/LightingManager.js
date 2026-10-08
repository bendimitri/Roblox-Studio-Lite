/**
 * Roblox Lighting ≈ "Future" technology for Three.js (forward + PBR).
 *
 * Global: sun/moon DirectionalLight from ClockTime + GeographicLatitude,
 *         HemisphereLight (OutdoorAmbient sky / Ambient ground),
 *         AmbientLight + ColorShift multiply, IBL via scene.environment intensity,
 *         fog, exposure, GlobalShadows / ShadowSoftness.
 *
 * Local:  Point / Spot / Surface with decay=0 (flat until Range),
 *         soft cutoff only as d → Range — hologram volume = lit volume.
 *
 * Falloff (decay=0 + Range distance):
 *   atten ≈ Brightness  until near Range, then fades to 0
 * so the wireframe shows exactly where the light still hits.
 */
import {
	ACESFilmicToneMapping,
	AmbientLight,
	BasicShadowMap,
	Color,
	DirectionalLight,
	Fog,
	HemisphereLight,
	MathUtils,
	PCFSoftShadowMap,
	PointLight,
	SpotLight,
	Vector3
} from "../thirdparty/three/three.core.js";

const DEG = MathUtils.DEG2RAD;
const TMP = new Vector3();
const TMP2 = new Vector3();

/** Technology → shadow/culling budget (Future = highest fidelity). */
export const TECHNOLOGY_TIER = {
	Legacy: "off",
	Compatibility: "low",
	Voxel: "medium",
	ShadowMap: "high",
	Future: "ultra"
};

export const SHADOW_TIERS = {
	off:   { local: false, point: false, budget: 0, localMap: 256,  sunMap: 1024, soft: false },
	low:   { local: true,  point: false, budget: 2, localMap: 256,  sunMap: 1024, soft: false },
	medium:{ local: true,  point: false, budget: 4, localMap: 512,  sunMap: 2048, soft: true },
	high:  { local: true,  point: true,  budget: 6, localMap: 512,  sunMap: 2048, soft: true },
	ultra: { local: true,  point: true,  budget: 8, localMap: 1024, sunMap: 4096, soft: true }
};

const DECAL_FACES = {
	Front:  { n: [0, 0, -1] },
	Back:   { n: [0, 0, 1] },
	Right:  { n: [1, 0, 0] },
	Left:   { n: [-1, 0, 0] },
	Top:    { n: [0, 1, 0] },
	Bottom: { n: [0, -1, 0] }
};

const MAX_LOCAL_LIGHTS = 24;
/** Cull local lights farther than this (studs) from the camera. */
export const LIGHT_CULL_DISTANCE = 220;

/** Shadow layer split: parent parts skip LAYER_LOCAL so child lights never self-shadow. */
export const LAYER_VIEW = 0;
export const LAYER_SUN_SHADOW = 1;
export const LAYER_LOCAL_SHADOW = 2;

/** Mark a mesh as a normal sun+local shadow caster (call when creating part meshes). */
export function enablePartShadowLayers(mesh) {
	if (!mesh || !mesh.layers) return;
	mesh.layers.enable(LAYER_VIEW);
	mesh.layers.enable(LAYER_SUN_SHADOW);
	mesh.layers.enable(LAYER_LOCAL_SHADOW);
}

/** Parent of a local light: still casts sun shadows, ignored by child local lights. */
export function excludeFromLocalShadows(mesh) {
	if (!mesh || !mesh.layers) return;
	mesh.layers.disable(LAYER_LOCAL_SHADOW);
	mesh.userData.localLightHost = (mesh.userData.localLightHost || 0) + 1;
}

export function releaseLocalShadowExclude(mesh) {
	if (!mesh || !mesh.layers) return;
	const n = Math.max(0, (mesh.userData.localLightHost || 1) - 1);
	mesh.userData.localLightHost = n;
	if (n === 0) mesh.layers.enable(LAYER_LOCAL_SHADOW);
}

function color3(c, fallback = 0.27) {
	if (!c) return new Color(fallback, fallback, fallback);
	const r = c.R > 1 ? c.R / 255 : c.R;
	const g = c.G > 1 ? c.G / 255 : c.G;
	const b = c.B > 1 ? c.B / 255 : c.B;
	return new Color(r, g, b);
}

/**
 * Subtle ColorShift multiply. Roblox default shift is black = "no tint".
 * Non-black shifts lean ambient toward that hue without clipping whites.
 */
function multiplyShift(base, shift, amount = 0.35) {
	const out = base.clone();
	if (!shift) return out;
	const s = color3(shift, 0);
	if (s.r + s.g + s.b < 0.02) return out; // black → identity
	out.r = Math.min(1, out.r * (1 - amount) + out.r * s.r * amount + s.r * amount * 0.25);
	out.g = Math.min(1, out.g * (1 - amount) + out.g * s.g * amount + s.g * amount * 0.25);
	out.b = Math.min(1, out.b * (1 - amount) + out.b * s.b * amount + s.b * amount * 0.25);
	return out;
}

export function clockTimeToTimeOfDay(clock) {
	const t = ((Number(clock) % 24) + 24) % 24;
	const total = Math.floor(t * 3600 + 1e-6);
	const hh = Math.floor(total / 3600);
	const mm = Math.floor((total % 3600) / 60);
	const ss = total % 60;
	const p = (n) => String(n).padStart(2, "0");
	return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

export function timeOfDayToClockTime(str) {
	if (typeof str !== "string") return 0;
	const m = str.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
	if (!m) return 0;
	return (+m[1]) + (+m[2]) / 60 + (+m[3]) / 3600;
}

/**
 * Sun/moon direction in world space (unit vector FROM light toward origin).
 * Elevation from spherical astronomy (equinox declination ≈ 0); latitude tilts the arc.
 */
export function celestialDirection(clockTime, latitudeDeg, isMoon = false) {
	let t = ((Number(clockTime) % 24) + 24) % 24;
	if (isMoon) t = (t + 12) % 24;
	const hourAngle = (t - 12) * 15 * DEG;
	const lat = (Number(latitudeDeg) || 0) * DEG;
	const decl = 0;
	const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
	const elev = Math.asin(Math.max(-1, Math.min(1, sinElev)));
	const cosElev = Math.cos(elev);
	let cosAz = 0;
	if (Math.abs(cosElev) > 1e-4 && Math.abs(Math.cos(lat)) > 1e-4) {
		cosAz = (Math.sin(decl) - Math.sin(lat) * sinElev) / (Math.cos(lat) * cosElev);
	}
	cosAz = Math.max(-1, Math.min(1, cosAz));
	const az = Math.acos(cosAz) * (hourAngle >= 0 ? 1 : -1);
	// Y-up: +Y elevation, azimuth around Y
	return {
		dir: new Vector3(Math.sin(az) * cosElev, Math.sin(elev), Math.cos(az) * cosElev).normalize(),
		elevation: elev,
		azimuth: az
	};
}

/** Warm→cool sun color from elevation (cheap Rayleigh-ish curve). */
function sunColorFromElevation(elev) {
	const h = Math.max(0, Math.sin(elev));
	const sunset = Math.exp(-h * 8);
	const c = new Color();
	c.r = Math.min(1, 1.0 + sunset * 0.35);
	c.g = Math.min(1, 0.92 - sunset * 0.35);
	c.b = Math.min(1, 0.78 - sunset * 0.55 + h * 0.15);
	return c;
}

function moonColor() {
	return new Color(0.55, 0.62, 0.85);
}

export class LightingManager {
	/**
	 * @param {{ scene: import('../thirdparty/three/three.core.js').Scene, renderer: *, camera?: * }} ctx
	 */
	constructor(ctx) {
		this.scene = ctx.scene;
		this.renderer = ctx.renderer;
		this.camera = ctx.camera || null;
		this.lightRef = null;
		this.shadowTier = "high";
		this.shadowLightCount = 0;
		this.localLightCount = 0;
		this.cullDistance = LIGHT_CULL_DISTANCE;
		this._envIntensity = 0.4;
		/** Optional Graphics Quality override (null = use place Technology as-is). */
		this.graphicsOverride = null;

		this.sun = new DirectionalLight(0xfff2dc, 1.2);
		this.sun.name = "Lighting.Sun";
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(2048, 2048);
		this.sun.shadow.bias = -0.00035;
		this.sun.shadow.normalBias = 0.55;
		this.sun.shadow.radius = 2;
		this.sun.shadow.camera.near = 1;
		this.sun.shadow.camera.far = 500;
		for (const k of ["left", "right", "top", "bottom"]) this.sun.shadow.camera[k] = k === "left" || k === "bottom" ? -140 : 140;
		// Sun shadow pass only sees LAYER_SUN_SHADOW (includes light-host parts)
		this.sun.shadow.camera.layers.disable(LAYER_VIEW);
		this.sun.shadow.camera.layers.enable(LAYER_SUN_SHADOW);
		this._mutedHost = null;
		this._hookShadowPass(this.sun);
		this.sunTarget = this.sun.target;
		this.sunTarget.position.set(0, 0, 0);
		this.scene.add(this.sunTarget);
		this.scene.add(this.sun);

		this.moon = new DirectionalLight(0x8899cc, 0);
		this.moon.name = "Lighting.Moon";
		this.moon.castShadow = false;
		this.scene.add(this.moon);

		this.hemi = new HemisphereLight(0x6e7a8a, 0x2a2a2a, 0.55);
		this.hemi.name = "Lighting.Hemi";
		this.scene.add(this.hemi);

		this.ambient = new AmbientLight(0x464646, 0.35);
		this.ambient.name = "Lighting.Ambient";
		this.scene.add(this.ambient);

		if (this.renderer) {
			this.renderer.shadowMap.enabled = true;
			this.renderer.shadowMap.type = PCFSoftShadowMap;
			this.renderer.toneMapping = ACESFilmicToneMapping;
			this.renderer.toneMappingExposure = 1;
		}
	}

	tier() {
		if (this.graphicsOverride) return this.graphicsOverride;
		return SHADOW_TIERS[this.shadowTier] || SHADOW_TIERS.high;
	}

	/**
	 * Runtime graphics preset from Escape Menu (does not mutate place Lighting.Technology).
	 * @param {null|{ local:boolean, point:boolean, budget:number, localMap:number, sunMap:number, soft:boolean, iblScale?:number, tech?:string }} preset
	 */
	setGraphicsOverride(preset) {
		this.graphicsOverride = preset;
		if (preset && preset.tech) this.shadowTier = TECHNOLOGY_TIER[preset.tech] || this.shadowTier;
		const lighting = this.lightRef || {
			GlobalShadows: true,
			ShadowSoftness: 0.2,
			Brightness: 2,
			ClockTime: 14,
			GeographicLatitude: 41.73
		};
		this._applySunShadow(lighting, this.tier());
		this.refreshAllLocalShadows();
		if (preset && this.scene.environmentIntensity !== undefined) {
			this.scene.environmentIntensity = (this._envIntensity || 0.4) * (preset.iblScale ?? 1);
		}
	}

	/** Full sync from DataModel Lighting service. */
	apply(lighting) {
		this.lightRef = lighting || null;
		if (!lighting) return;
		const tech = lighting.Technology || "Future";
		this.shadowTier = TECHNOLOGY_TIER[tech] || "high";
		const tier = this.tier();

		if (this.renderer) {
			this.renderer.shadowMap.enabled = lighting.GlobalShadows !== false;
			this.renderer.shadowMap.type = tier.soft ? PCFSoftShadowMap : BasicShadowMap;
			const exposure = Number(lighting.ExposureCompensation);
			this.renderer.toneMappingExposure = Math.pow(2, Number.isFinite(exposure) ? exposure : 0);
		}

		this._applyCelestial(lighting);
		this._applyAmbient(lighting);
		this._applyFog(lighting);
		this._applySunShadow(lighting, tier);
		this.refreshAllLocalShadows();
	}

	_applyCelestial(lighting) {
		const clock = Number(lighting.ClockTime);
		const lat = Number(lighting.GeographicLatitude) || 0;
		const brightness = Math.max(0, Number(lighting.Brightness) || 0);
		const sun = celestialDirection(clock, lat, false);
		const moon = celestialDirection(clock, lat, true);

		const sunH = Math.max(0, Math.sin(sun.elevation));
		const moonH = Math.max(0, Math.sin(moon.elevation));

		// Position lights far along -direction so they shine toward origin
		const dist = 180;
		TMP.copy(sun.dir).multiplyScalar(dist);
		this.sun.position.copy(TMP);
		this.sun.target.position.set(0, 0, 0);
		this.sun.color.copy(sunColorFromElevation(sun.elevation));
		// Day intensity from Brightness × elevation curve
		this.sun.intensity = brightness * (0.15 + sunH * 1.1);

		TMP2.copy(moon.dir).multiplyScalar(dist);
		this.moon.position.copy(TMP2);
		this.moon.color.copy(moonColor());
		this.moon.intensity = brightness * 0.22 * moonH * (1 - sunH);

		if (lighting.TimeOfDay == null || lighting.TimeOfDay === "") {
			lighting.TimeOfDay = clockTimeToTimeOfDay(clock);
		}
	}

	_applyAmbient(lighting) {
		const ambient = color3(lighting.Ambient, 0.27);
		const outdoor = color3(lighting.OutdoorAmbient, 0.27);
		const shiftTop = lighting.ColorShift_Top;
		const shiftBot = lighting.ColorShift_Bottom;
		const envDiff = Math.max(0, Number(lighting.EnvironmentDiffuseScale) || 0);
		const envSpec = Math.max(0, Number(lighting.EnvironmentSpecularScale) || 0);

		// OutdoorAmbient → sky lobe; Ambient → ground / fully shadowed areas
		this.hemi.color.copy(multiplyShift(outdoor, shiftTop, 0.3));
		this.hemi.groundColor.copy(multiplyShift(ambient, shiftBot, 0.3));
		this.hemi.intensity = 0.35 + envDiff * 0.65;

		this.ambient.color.copy(multiplyShift(ambient, shiftBot, 0.2));
		this.ambient.intensity = 0.12 + ambient.r * 0.15 + envDiff * 0.25;

		// IBL proxy: scene.environmentIntensity (r163+) or material.envMapIntensity
		this._envIntensity = 0.15 + envSpec * 0.85 + envDiff * 0.25;
		if (this.scene.environmentIntensity !== undefined) {
			this.scene.environmentIntensity = this._envIntensity;
		}
		this._tintEnvironment(envDiff, outdoor);
	}

	/** Soft sky tint as scene background influence when no cubemap env is set. */
	_tintEnvironment(envDiff, outdoor) {
		if (this.scene.background && this.scene.background.isColor) {
			this.scene.background.copy(outdoor).multiplyScalar(0.15 + envDiff * 0.2);
		}
	}

	_applyFog(lighting) {
		const fogEnd = Number(lighting.FogEnd);
		const fogStart = Number(lighting.FogStart);
		if (!Number.isFinite(fogEnd) || fogEnd >= 1e5) {
			this.scene.fog = null;
			return;
		}
		const fc = color3(lighting.FogColor, 0.75);
		if (!this.scene.fog || !this.scene.fog.isFog) {
			this.scene.fog = new Fog(fc.getHex(), fogStart || 0, fogEnd);
		} else {
			this.scene.fog.color.copy(fc);
			this.scene.fog.near = fogStart || 0;
			this.scene.fog.far = fogEnd;
		}
	}

	_applySunShadow(lighting, tier) {
		const soft = Math.max(0, Math.min(1, Number(lighting.ShadowSoftness)));
		const softVal = Number.isFinite(soft) ? soft : 0.5;
		const global = lighting.GlobalShadows !== false && this.shadowTier !== "off";
		this.sun.castShadow = global;
		this.sun.shadow.mapSize.set(tier.sunMap, tier.sunMap);
		this.sun.shadow.radius = 0.5 + softVal * 4.5;
		this.sun.shadow.bias = -0.00035 - softVal * 0.00015;
		this.sun.shadow.normalBias = 0.45 + softVal * 0.25;
		if (this.sun.shadow.map) {
			this.sun.shadow.map.dispose();
			this.sun.shadow.map = null;
		}
	}

	/** Per-frame: celestial if ClockTime animated + cull local lights by camera distance. */
	update(camera = this.camera) {
		if (this.lightRef) {
			this._applyCelestial(this.lightRef);
			this._cullLocalLights(camera);
		}
	}

	_cullLocalLights(camera) {
		if (!camera) return;
		const maxD = this.cullDistance;
		const maxD2 = maxD * maxD;
		this.scene.traverse((o) => {
			if (!o.isLight || !o.userData || !o.userData.lightRef) return;
			o.getWorldPosition(TMP);
			const d2 = TMP.distanceToSquared(camera.position);
			const rec = o.userData.lightRef;
			const want = rec.Enabled !== false && d2 <= maxD2;
			if (o.visible !== want) o.visible = want;
		});
	}

	refreshAllLocalShadows() {
		this.shadowLightCount = 0;
		this.scene.traverse((o) => {
			if (!o.isLight || !o.userData || !o.userData.lightRef) return;
			const rec = o.userData.lightRef;
			this.applyLocalShadow(o, rec.ClassName, o.distance || LightingManager.clampRange(rec.Range), rec);
		});
	}

	/**
	 * Three's shadow pass filters by the MAIN camera layers, so layer tricks can't hide a host.
	 * updateMatrices() runs right before each light's pass: mute that light's parent part there.
	 */
	_hookShadowPass(light) {
		const shadow = light.shadow;
		if (!shadow || shadow._hostHooked) return;
		shadow._hostHooked = true;
		const original = shadow.updateMatrices.bind(shadow);
		shadow.updateMatrices = (l, viewportIndex) => {
			this._muteHost(l.isDirectionalLight ? null : l.parent);
			return original(l, viewportIndex);
		};
	}

	_muteHost(host) {
		if (this._mutedHost === host) return;
		this.endShadowPass();
		if (host && host.isMesh) {
			host.userData._castShadowSaved = host.castShadow;
			host.castShadow = false;
			this._mutedHost = host;
		}
	}

	/** Restore the muted host's castShadow (call after each frame render). */
	endShadowPass() {
		const host = this._mutedHost;
		if (!host) return;
		host.castShadow = host.userData._castShadowSaved !== false;
		this._mutedHost = null;
	}

	applyLocalShadow(light, cls, range, rec) {
		this._hookShadowPass(light);
		light.castShadow = false;
		if (rec && rec.Shadows === false) return;
		if (this.lightRef && this.lightRef.GlobalShadows === false) return;
		const tier = this.tier();
		let allow = tier.local && this.shadowLightCount < tier.budget;
		if (cls === "PointLight" && !tier.point) allow = false;
		if (!allow) return;
		light.castShadow = true;
		light.shadow.mapSize.set(tier.localMap, tier.localMap);
		const soft = Math.max(0, Math.min(1, Number(this.lightRef?.ShadowSoftness) || 0.5));
		light.shadow.radius = 0.5 + soft * 3.5;
		// Bias + near plane: reduce acne / light bleeding without eating small gaps
		light.shadow.bias = -0.0004;
		light.shadow.normalBias = 0.55 + soft * 0.2;
		if (light.shadow.camera) {
			light.shadow.camera.near = Math.max(0.35, range * 0.02);
			light.shadow.camera.far = Math.max(range * 1.05, 1);
			// Local shadow pass ignores LAYER_VIEW hosts — only LAYER_LOCAL_SHADOW casters
			light.shadow.camera.layers.disable(LAYER_VIEW);
			light.shadow.camera.layers.disable(LAYER_SUN_SHADOW);
			light.shadow.camera.layers.enable(LAYER_LOCAL_SHADOW);
			light.shadow.camera.updateProjectionMatrix?.();
		}
		this.shadowLightCount++;
	}

	/**
	 * Intensity for decay=0 lights (flat until Range soft-cut).
	 * No 1/d blowout near floors; still readable at the hologram edge.
	 */
	static lightIntensity(brightness, _range) {
		const b = Math.max(0, Math.min(40, Number(brightness) || 0));
		if (b === 0) return 0;
		// Brightness 1 ≈ clear lamp; Brightness 20 capped soft under ACES
		return Math.min(7, 0.55 + b * 0.85);
	}

	/** Clamp Roblox Range (studs) — max 60 like Studio. */
	static clampRange(range) {
		const r = Number(range);
		return Math.max(0.1, Math.min(60, Number.isFinite(r) ? r : 8));
	}

	/**
	 * Real reach in studs: Range scaled by Brightness (1 → ×1, 3 → ×1.5, 7 → ×2, cap ×2.5).
	 * The hologram reads light.distance, so it always matches this.
	 */
	static reach(brightness, range) {
		const b = Math.max(0, Number(brightness) || 0);
		const factor = Math.min(2.5, 0.5 + 0.5 * Math.log2(1 + b));
		return Math.max(0.1, LightingManager.clampRange(range) * Math.max(0.25, factor));
	}

	/**
	 * Face size axes (width, height) for Surface/Spot emission plane.
	 * @returns {[number, number]}
	 */
	static faceSize(faceName, size) {
		const s = size ? [size.X || 4, size.Y || 1, size.Z || 4] : [4, 1, 4];
		const face = DECAL_FACES[faceName] || DECAL_FACES.Bottom;
		if (Math.abs(face.n[1]) > 0.5) return [s[0], s[2]]; // Top/Bottom → XZ
		if (Math.abs(face.n[0]) > 0.5) return [s[2], s[1]]; // Left/Right → ZY
		return [s[0], s[1]]; // Front/Back → XY
	}

	/**
	 * Build a local Roblox light. decay=0 → lit volume fills the hologram to Range.
	 *
	 * PointLight   → omnidirectional sphere (lâmpada)
	 * SpotLight    → directional cone from Face (holofote)
	 * SurfaceLight → square frustum from whole Face (painel)
	 */
	buildLocalLight(rec, size) {
		const cls = rec.ClassName;
		if (cls !== "PointLight" && cls !== "SpotLight" && cls !== "SurfaceLight") return null;
		if (rec.Enabled === false || this.localLightCount >= MAX_LOCAL_LIGHTS) return null;
		this.localLightCount++;

		const color = color3(rec.Color || rec.Color3, 1);
		const rawB = Number(rec.Brightness);
		const brightness = Math.max(0, Number.isFinite(rawB) ? rawB : 1);
		const range = LightingManager.reach(brightness, rec.Range);
		const intensity = LightingManager.lightIntensity(brightness, range);
		const decay = 0; // flat until Range — hologram edge = where light stops

		let light;
		if (cls === "PointLight") {
			// Lamp: 1/√d falloff — bright at the bulb, soft fade to the Range sphere
			const r = Math.max(1, range);
			const lampIntensity = Math.min(24, intensity * Math.sqrt(r) * 0.6);
			light = new PointLight(color, lampIntensity, range, 0.5);
			light.position.set(0, 0, 0);
		} else if (cls === "SpotLight") {
			// Holofote: cone a partir da Face
			const faceName = rec.Face || "Bottom";
			const face = DECAL_FACES[faceName] || DECAL_FACES.Bottom;
			const halfRad = Math.min(Math.PI / 2, ((Number(rec.Angle) || 90) * Math.PI) / 360);
			light = new SpotLight(color, intensity, range, halfRad, 0.22, decay);
			const s = size ? [size.X || 4, size.Y || 1, size.Z || 4] : [4, 1, 4];
			const pad = 0.12;
			light.position.set(
				face.n[0] * (s[0] / 2 + pad),
				face.n[1] * (s[1] / 2 + pad),
				face.n[2] * (s[2] / 2 + pad)
			);
			light.target.position.set(
				light.position.x + face.n[0],
				light.position.y + face.n[1],
				light.position.z + face.n[2]
			);
			light.add(light.target);
			light.target.position.sub(light.position);
		} else {
			// SurfaceLight: mesma ideia de volume da PointLight, mas formato quadrado
			// a partir da face inteira (frustum retangular até Range)
			const faceName = rec.Face || "Bottom";
			const face = DECAL_FACES[faceName] || DECAL_FACES.Bottom;
			const s = size ? [size.X || 4, size.Y || 1, size.Z || 4] : [4, 1, 4];
			const [fw, fh] = LightingManager.faceSize(faceName, size);
			const angleDeg = Math.max(0, Math.min(180, Number(rec.Angle) || 90));
			// Roblox SurfaceLight.Angle: 0 = só para fora, 180 = abre até perpendicular
			const spread = Math.tan((angleDeg * 0.5 * Math.PI) / 180) * range;
			const farW = fw + spread * 2;
			const farH = fh + spread * 2;
			// Spot half-angle cobre o canto do retângulo longe (aproxima o volume quadrado)
			const halfRad = Math.min(
				Math.PI / 2,
				Math.atan2(Math.hypot(farW, farH) * 0.5, Math.max(range, 0.01))
			);
			light = new SpotLight(color, intensity * 1.05, range, halfRad, 0.35, decay);
			const pad = 0.08;
			light.position.set(
				face.n[0] * (s[0] / 2 + pad),
				face.n[1] * (s[1] / 2 + pad),
				face.n[2] * (s[2] / 2 + pad)
			);
			light.target.position.set(
				light.position.x + face.n[0],
				light.position.y + face.n[1],
				light.position.z + face.n[2]
			);
			light.add(light.target);
			light.target.position.sub(light.position);
		}
		light.userData.lightRef = rec;
		light.userData.lightInstance = rec.Name;
		this.applyLocalShadow(light, cls, range, rec);
		return light;
	}

	disposeLocalLight(light) {
		if (!light) return;
		if (light.castShadow) this.shadowLightCount = Math.max(0, this.shadowLightCount - 1);
		const parent = light.parent;
		if (parent) {
			parent.remove(light);
			releaseLocalShadowExclude(parent);
		}
		if (light.shadow?.map) {
			light.shadow.map.dispose();
			light.shadow.map = null;
		}
		this.localLightCount = Math.max(0, this.localLightCount - 1);
	}
}
