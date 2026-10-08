/**
 * Maps Roblox-style Graphics Quality (1–10) onto the Three.js / LightingManager pipeline.
 *
 *  1–3  low:    no local shadows, Compatibility-like sun, weak IBL, short far, 10–30% VFX
 *  4–7  medium: sun shadows mid-res, local lights on, mid far, 40–70% VFX
 *  8–10 high:   Future ultra (incl. point shadows), full IBL, long far, 80–100% VFX
 *
 * Automatic mode nudges quality from a lightweight FPS probe.
 */

const QUALITY_PRESETS = {
	1:  { tech: "Compatibility", sunMap: 512,  local: false, point: false, budget: 0, localMap: 256,  iblScale: 0,    far: 400,   particles: 0.1, soft: false },
	2:  { tech: "Compatibility", sunMap: 512,  local: false, point: false, budget: 0, localMap: 256,  iblScale: 0,    far: 600,   particles: 0.2, soft: false },
	3:  { tech: "Voxel",         sunMap: 1024, local: false, point: false, budget: 0, localMap: 256,  iblScale: 0.15, far: 900,   particles: 0.3, soft: false },
	4:  { tech: "Voxel",         sunMap: 1024, local: true,  point: false, budget: 2, localMap: 512,  iblScale: 0.35, far: 1500,  particles: 0.4, soft: false },
	5:  { tech: "ShadowMap",     sunMap: 2048, local: true,  point: false, budget: 3, localMap: 512,  iblScale: 0.5,  far: 2500,  particles: 0.5, soft: true },
	6:  { tech: "ShadowMap",     sunMap: 2048, local: true,  point: false, budget: 4, localMap: 512,  iblScale: 0.65, far: 4000,  particles: 0.6, soft: true },
	7:  { tech: "ShadowMap",     sunMap: 2048, local: true,  point: true,  budget: 4, localMap: 512,  iblScale: 0.75, far: 6000,  particles: 0.7, soft: true },
	8:  { tech: "Future",        sunMap: 2048, local: true,  point: true,  budget: 6, localMap: 1024, iblScale: 0.9,  far: 9000,  particles: 0.85,soft: true },
	9:  { tech: "Future",        sunMap: 4096, local: true,  point: true,  budget: 7, localMap: 1024, iblScale: 1,    far: 12000, particles: 0.95,soft: true },
	10: { tech: "Future",        sunMap: 4096, local: true,  point: true,  budget: 8, localMap: 1024, iblScale: 1,    far: 15000, particles: 1,   soft: true }
};

export class GraphicsManager {
	/**
	 * @param {{ renderer: import('../rendering/StudioLiteRenderer.js').StudioLiteRenderer }} opts
	 */
	constructor({ renderer }) {
		this.renderer = renderer;
		this.mode = "Manual";
		this.quality = 6;
		this.particleRateScale = 1;
		this._fpsSamples = [];
		this._autoTimer = 0;
		this._lastKey = "";
	}

	/** @param {"Automatic"|"Manual"} mode */
	setMode(mode) {
		this.mode = mode === "Automatic" ? "Automatic" : "Manual";
		this.apply(this.quality);
	}

	/** @param {number} level 1..10 */
	setQuality(level) {
		this.quality = Math.max(1, Math.min(10, Math.round(level)));
		if (this.mode === "Manual") this.apply(this.quality);
	}

	/** Per-frame FPS probe when Graphics Mode = Automatic. */
	update(dt) {
		if (this.mode !== "Automatic") return;
		const fps = dt > 0 ? 1 / dt : 60;
		this._fpsSamples.push(fps);
		if (this._fpsSamples.length > 30) this._fpsSamples.shift();
		this._autoTimer += dt;
		if (this._autoTimer < 1.5) return;
		this._autoTimer = 0;
		const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
		let q = this.quality;
		if (avg < 28) q = Math.max(1, q - 1);
		else if (avg > 55) q = Math.min(10, q + 1);
		if (q !== this.quality) {
			this.quality = q;
			this.apply(q);
		}
	}

	apply(level = this.quality) {
		const q = Math.max(1, Math.min(10, Math.round(level)));
		const p = QUALITY_PRESETS[q] || QUALITY_PRESETS[6];
		const key = `${this.mode}:${q}`;
		if (key === this._lastKey) return;
		this._lastKey = key;
		this.quality = q;
		this.particleRateScale = p.particles;

		const r = this.renderer;
		if (r.lighting) {
			r.lighting.setGraphicsOverride({
				tech: p.tech,
				local: p.local,
				point: p.point,
				budget: p.budget,
				localMap: p.localMap,
				sunMap: p.sunMap,
				soft: p.soft,
				iblScale: p.iblScale
			});
			r.lighting.cullDistance = 80 + q * 28;
		}
		if (r.camera) {
			r.camera.far = p.far;
			r.camera.updateProjectionMatrix();
		}
		if (r.effects) r.effects.particleRateScale = p.particles;
	}

	/** Restore place Lighting.Technology when leaving Play. */
	clear() {
		this._lastKey = "";
		if (this.renderer.lighting) {
			this.renderer.lighting.setGraphicsOverride(null);
			this.renderer.lighting.cullDistance = 220;
			if (this.renderer.lighting.lightRef) this.renderer.lighting.apply(this.renderer.lighting.lightRef);
		}
		if (this.renderer.effects) this.renderer.effects.particleRateScale = 1;
		if (this.renderer.camera) {
			this.renderer.camera.far = 15000;
			this.renderer.camera.updateProjectionMatrix();
		}
	}
}
