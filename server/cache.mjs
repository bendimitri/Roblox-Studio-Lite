/*
 * Tiny in-memory TTL cache with separate namespaces (metadata / thumbnail / content). Prevents
 * repeated Roblox calls when the user clicks the same asset multiple times.
 */
export class TtlCache {
	/** @param {number} ttlMs time-to-live per entry @param {number} max max entries before pruning */
	constructor(ttlMs, max = 500) {
		this.ttlMs = ttlMs;
		this.max = max;
		/** @type {Map<string, { value: unknown, expires: number }>} */
		this.store = new Map();
	}

	get(key) {
		const hit = this.store.get(key);
		if (!hit) return undefined;
		if (Date.now() > hit.expires) { this.store.delete(key); return undefined; }
		// Refresh LRU order.
		this.store.delete(key);
		this.store.set(key, hit);
		return hit.value;
	}

	set(key, value) {
		if (this.store.size >= this.max) {
			const oldest = this.store.keys().next().value;
			if (oldest !== undefined) this.store.delete(oldest);
		}
		this.store.set(key, { value, expires: Date.now() + this.ttlMs });
	}

	/** Returns the cached value or computes, caches and returns it (de-dupes in-flight promises). */
	async wrap(key, fn) {
		const cached = this.get(key);
		if (cached !== undefined) return cached;
		const promise = Promise.resolve().then(fn);
		// Store the promise so concurrent callers share one upstream request.
		this.set(key, promise);
		try {
			const value = await promise;
			this.set(key, value);
			return value;
		} catch (err) {
			this.store.delete(key);
			throw err;
		}
	}
}
