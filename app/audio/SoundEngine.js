import { localAsset, assetIdOf } from "../http/AssetIndex.js";

/*
 * Plays Roblox Sound instances during a Play session with HTMLAudioElements. Audio files come
 * from asset/ (tools/fetch-assets.mjs). Sounds parented to a part or attachment are attenuated by
 * the distance to the camera like Roblox's default RollOffMode (InverseTapered).
 *
 * A Sound whose file is missing still behaves for scripts: Played / Ended fire (Ended after
 * MISSING_LENGTH seconds) so `sound.Ended:Wait()` does not hang.
 */

const MISSING_LENGTH = 0.5;
const SPATIAL_INTERVAL = 100;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export class SoundEngine {
	/**
	 * @param {{ emit: (rec: object, name: string, ...tags: any[]) => void,
	 *           positionOf: (rec: object) => number[] | null,
	 *           listener: () => number[] | null,
	 *           warn: (key: string, message: string) => void,
	 *           touch?: (rec: object) => void,
	 *           groupVolume?: (rec: object) => number }} hooks
	 */
	constructor(hooks) {
		this.hooks = hooks;
		/** @type {Map<object, {audio: HTMLAudioElement | null, timer: number, startedAt: number, offset: number}>} */
		this.active = new Map();
		this.spatialTimer = 0;
	}

	_entry(rec) {
		let entry = this.active.get(rec);
		if (entry) return entry;
		this.hooks.touch?.(rec);
		const asset = localAsset(rec.SoundId, "sound");
		let audio = null;
		if (asset) {
			audio = new Audio(asset.url);
			audio.preload = "auto";
			audio.addEventListener("loadedmetadata", () => {
				rec.TimeLength = audio.duration || 0;
				rec.IsLoaded = true;
				this.hooks.emit(rec, "Loaded", ["v", rec.SoundId || ""]);
			});
			audio.addEventListener("ended", () => this._ended(rec));
		} else if (rec.SoundId) {
			const id = assetIdOf(rec.SoundId) || rec.SoundId;
			this.hooks.warn(`sound:${id}`, `Som ${id} não está em asset/ — rode "node tools/fetch-assets.mjs <place>" (com ROBLOX_COOKIE para áudios privados) para ouvi-lo`);
		}
		entry = { audio, timer: 0, startedAt: 0, offset: 0 };
		this.active.set(rec, entry);
		return entry;
	}

	_apply(rec, entry) {
		const audio = entry.audio;
		if (!audio) return;
		audio.loop = !!rec.Looped;
		audio.playbackRate = Math.min(16, Math.max(0.0625, num(rec.PlaybackSpeed, 1) || 1));
		audio.volume = clamp01(num(rec.Volume, 0.5) * this._gain(rec) * (this.hooks.groupVolume ? this.hooks.groupVolume(rec) : 1));
	}

	/** Distance attenuation (InverseTapered / Inverse / Linear) for positional sounds, else 1. */
	_gain(rec) {
		const pos = this.hooks.positionOf(rec);
		const ear = pos && this.hooks.listener();
		if (!pos || !ear) return 1;
		const d = Math.hypot(pos[0] - ear[0], pos[1] - ear[1], pos[2] - ear[2]);
		const min = Math.max(0.01, num(rec.RollOffMinDistance ?? rec.EmitterSize, 10));
		const max = Math.max(min, num(rec.RollOffMaxDistance ?? rec.MaxDistance, 10000));
		if (d <= min) return 1;
		if (d >= max) return 0;
		const mode = String(rec.RollOffMode ?? "InverseTapered");
		const inverse = min / d;
		const linear = 1 - (d - min) / (max - min);
		if (mode === "Linear" || mode === "2") return linear;
		if (mode === "LinearSquare" || mode === "3") return linear * linear;
		if (mode === "Inverse" || mode === "0") return inverse;
		return Math.min(inverse, linear * linear);
	}

	_spatialLoop() {
		if (this.spatialTimer) return;
		this.spatialTimer = setInterval(() => {
			if (!this.active.size) {
				clearInterval(this.spatialTimer);
				this.spatialTimer = 0;
				return;
			}
			for (const [rec, entry] of this.active) if (entry.audio && !entry.audio.paused) this._apply(rec, entry);
		}, SPATIAL_INTERVAL);
	}

	_ended(rec) {
		const entry = this.active.get(rec);
		if (!entry) return;
		if (rec.Looped && !entry.audio) {
			this.hooks.emit(rec, "DidLoop", ["v", rec.SoundId || ""], ["v", 1]);
			entry.timer = setTimeout(() => this._ended(rec), MISSING_LENGTH * 1000);
			return;
		}
		rec.Playing = false;
		rec.IsPlaying = false;
		rec.TimePosition = 0;
		this.hooks.emit(rec, "Ended", ["v", rec.SoundId || ""]);
	}

	play(rec) {
		const entry = this._entry(rec);
		clearTimeout(entry.timer);
		rec.Playing = true;
		rec.IsPlaying = true;
		rec.IsPaused = false;
		const start = Math.max(0, num(rec.TimePosition, 0));
		if (entry.audio) {
			this._apply(rec, entry);
			try {
				entry.audio.currentTime = start;
			} catch {}
			entry.audio.play().catch(() => {
				this.hooks.warn("sound:autoplay", "O navegador bloqueou o áudio até o primeiro clique na página — clique na viewport para liberar o som");
			});
			this._spatialLoop();
		} else {
			entry.timer = setTimeout(() => this._ended(rec), MISSING_LENGTH * 1000);
		}
		this.hooks.emit(rec, "Played", ["v", rec.SoundId || ""]);
	}

	stop(rec, silent = false) {
		const entry = this.active.get(rec);
		if (entry) {
			clearTimeout(entry.timer);
			if (entry.audio) {
				entry.audio.pause();
				entry.audio.currentTime = 0;
			}
		}
		const was = rec.IsPlaying || rec.Playing;
		rec.Playing = false;
		rec.IsPlaying = false;
		rec.IsPaused = false;
		rec.TimePosition = 0;
		if (was && !silent) this.hooks.emit(rec, "Stopped", ["v", rec.SoundId || ""]);
	}

	pause(rec) {
		const entry = this.active.get(rec);
		if (!entry || !rec.IsPlaying) return;
		clearTimeout(entry.timer);
		if (entry.audio) {
			entry.audio.pause();
			rec.TimePosition = entry.audio.currentTime;
		}
		rec.Playing = false;
		rec.IsPlaying = false;
		rec.IsPaused = true;
		this.hooks.emit(rec, "Paused", ["v", rec.SoundId || ""]);
	}

	resume(rec) {
		if (rec.IsPlaying) return;
		const entry = this._entry(rec);
		rec.Playing = true;
		rec.IsPlaying = true;
		rec.IsPaused = false;
		if (entry.audio) {
			this._apply(rec, entry);
			entry.audio.play().catch(() => {});
			this._spatialLoop();
		} else {
			entry.timer = setTimeout(() => this._ended(rec), MISSING_LENGTH * 1000);
		}
		this.hooks.emit(rec, "Resumed", ["v", rec.SoundId || ""]);
	}

	/** A script wrote a Sound property: keep the audio element in step. */
	sync(rec, key) {
		const entry = this.active.get(rec);
		switch (key) {
			case "Playing":
				if (rec.Playing && !(entry && entry.audio && !entry.audio.paused) && !(entry && entry.timer)) this.play(rec);
				else if (!rec.Playing && rec.IsPlaying) this.pause(rec);
				break;
			case "SoundId":
				if (entry) {
					const playing = rec.IsPlaying;
					this.stop(rec, true);
					entry.audio?.removeAttribute("src");
					this.active.delete(rec);
					if (playing) this.play(rec);
				}
				break;
			case "TimePosition":
				if (entry && entry.audio) {
					try {
						entry.audio.currentTime = Math.max(0, num(rec.TimePosition, 0));
					} catch {}
				}
				break;
			default:
				if (entry) this._apply(rec, entry);
		}
	}

	/** Live values a script can read. */
	read(rec, key) {
		const entry = this.active.get(rec);
		const audio = entry && entry.audio;
		switch (key) {
			case "IsPlaying": return ["v", !!rec.IsPlaying];
			case "IsPaused": return ["v", !!rec.IsPaused];
			case "IsLoaded": return ["v", !!(audio ? rec.IsLoaded : rec.SoundId)];
			case "TimePosition": return ["v", audio ? audio.currentTime : num(rec.TimePosition, 0)];
			case "TimeLength": return ["v", audio && audio.duration ? audio.duration : num(rec.TimeLength, 0)];
			case "PlaybackLoudness": return ["v", rec.IsPlaying && audio ? 300 * audio.volume : 0];
		}
		return null;
	}

	stopAll() {
		for (const [rec, entry] of this.active) {
			clearTimeout(entry.timer);
			if (entry.audio) {
				entry.audio.pause();
				entry.audio.removeAttribute("src");
			}
			rec.IsPlaying = false;
		}
		this.active.clear();
		clearInterval(this.spatialTimer);
		this.spatialTimer = 0;
	}
}
