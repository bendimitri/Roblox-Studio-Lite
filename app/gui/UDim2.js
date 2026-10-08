/*
 * Roblox GUI datatypes: UDim, UDim2, Vector2 and Color3, plus the compiler that turns a
 * UDim2 into CSS. Scale is a fraction (0..1) of the parent container, Offset is pixels:
 *   new UDim2(0.5, -50, 1, -30)  ->  left: calc(50% - 50px); top: calc(100% - 30px);
 */

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const trim = (n) => String(Math.round(n * 10000) / 10000);

export class UDim {
	constructor(scale = 0, offset = 0) {
		this.Scale = num(scale);
		this.Offset = Math.round(num(offset));
	}

	add(other) {
		return new UDim(this.Scale + other.Scale, this.Offset + other.Offset);
	}

	equals(other) {
		return !!other && this.Scale === other.Scale && this.Offset === other.Offset;
	}

	toString() {
		return `${trim(this.Scale)}, ${this.Offset}`;
	}
}

export class UDim2 {
	constructor(xScale = 0, xOffset = 0, yScale = 0, yOffset = 0) {
		this.X = new UDim(xScale, xOffset);
		this.Y = new UDim(yScale, yOffset);
	}

	get isUDim2() {
		return true;
	}

	get Width() {
		return this.X;
	}

	get Height() {
		return this.Y;
	}

	static fromScale(x = 0, y = 0) {
		return new UDim2(x, 0, y, 0);
	}

	static fromOffset(x = 0, y = 0) {
		return new UDim2(0, x, 0, y);
	}

	/** Accepts a UDim2, the parser shape { X: { Scale, Offset }, Y: { … } }, an array or a string. */
	static from(value, fallback = new UDim2()) {
		if (value instanceof UDim2) return value;
		if (typeof value === "string") return UDim2.parse(value) || fallback;
		if (Array.isArray(value) && value.length === 4) return new UDim2(...value);
		if (value && value.X && value.Y && "Scale" in value.X) {
			return new UDim2(value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset);
		}
		return fallback;
	}

	/** "{0.5, -50}, {1, -30}" (Studio format) or "0.5, -50, 1, -30". */
	static parse(text) {
		const parts = String(text).match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
		if (!parts || parts.length !== 4) return null;
		const [xs, xo, ys, yo] = parts.map(Number);
		return new UDim2(xs, xo, ys, yo);
	}

	add(other) {
		return new UDim2(this.X.Scale + other.X.Scale, this.X.Offset + other.X.Offset, this.Y.Scale + other.Y.Scale, this.Y.Offset + other.Y.Offset);
	}

	sub(other) {
		return new UDim2(this.X.Scale - other.X.Scale, this.X.Offset - other.X.Offset, this.Y.Scale - other.Y.Scale, this.Y.Offset - other.Y.Offset);
	}

	lerp(goal, alpha) {
		const l = (a, b) => a + (b - a) * alpha;
		return new UDim2(l(this.X.Scale, goal.X.Scale), l(this.X.Offset, goal.X.Offset), l(this.Y.Scale, goal.Y.Scale), l(this.Y.Offset, goal.Y.Offset));
	}

	equals(other) {
		return !!other && this.X.equals(other.X) && this.Y.equals(other.Y);
	}

	clone() {
		return new UDim2(this.X.Scale, this.X.Offset, this.Y.Scale, this.Y.Offset);
	}

	toString() {
		return `{${this.X}}, {${this.Y}}`;
	}

	toJSON() {
		return { X: { Scale: this.X.Scale, Offset: this.X.Offset }, Y: { Scale: this.Y.Scale, Offset: this.Y.Offset } };
	}
}

/** One axis: Scale is a percentage of the parent, Offset is added in pixels. */
export function udimToCSS(udim) {
	const pct = trim(udim.Scale * 100);
	const px = udim.Offset;
	return `calc(${pct}% ${px < 0 ? "-" : "+"} ${Math.abs(px)}px)`;
}

/** Position -> { left, top } */
export function compilePosition(udim2) {
	return { left: udimToCSS(udim2.X), top: udimToCSS(udim2.Y) };
}

/** Size -> { width, height } */
export function compileSize(udim2) {
	return { width: udimToCSS(udim2.X), height: udimToCSS(udim2.Y) };
}

/** Absolute pixels of a UDim2 inside a parent of the given size. */
export function resolveUDim2(udim2, parentWidth, parentHeight) {
	return {
		x: udim2.X.Scale * parentWidth + udim2.X.Offset,
		y: udim2.Y.Scale * parentHeight + udim2.Y.Offset
	};
}

export class Vector2 {
	constructor(x = 0, y = 0) {
		this.X = num(x);
		this.Y = num(y);
	}

	static from(value, fallback = new Vector2()) {
		if (value instanceof Vector2) return value;
		if (typeof value === "string") {
			const parts = value.match(/-?\d*\.?\d+/g);
			return parts && parts.length === 2 ? new Vector2(parts[0], parts[1]) : fallback;
		}
		if (value && "X" in value && "Y" in value) return new Vector2(value.X, value.Y);
		return fallback;
	}

	equals(other) {
		return !!other && this.X === other.X && this.Y === other.Y;
	}

	toString() {
		return `${trim(this.X)}, ${trim(this.Y)}`;
	}
}

export class Color3 {
	/** Components are 0..1, like Roblox Color3.new. */
	constructor(r = 0, g = 0, b = 0) {
		this.R = Math.min(1, Math.max(0, num(r)));
		this.G = Math.min(1, Math.max(0, num(g)));
		this.B = Math.min(1, Math.max(0, num(b)));
	}

	static fromRGB(r = 0, g = 0, b = 0) {
		return new Color3(r / 255, g / 255, b / 255);
	}

	static fromHex(hex) {
		const m = String(hex).replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
		return m ? Color3.fromRGB(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) : null;
	}

	/** Color3, { R, G, B } in 0..1 or 0..255, "#rrggbb" or "r, g, b" (0..255). */
	static from(value, fallback = new Color3()) {
		if (value instanceof Color3) return value;
		if (typeof value === "string") {
			if (value.trim().startsWith("#")) return Color3.fromHex(value.trim()) || fallback;
			const parts = value.match(/\d*\.?\d+/g);
			return parts && parts.length === 3 ? Color3.fromRGB(...parts.map(Number)) : fallback;
		}
		if (value && "R" in value && "G" in value && "B" in value) {
			const big = value.R > 1 || value.G > 1 || value.B > 1;
			return big ? Color3.fromRGB(value.R, value.G, value.B) : new Color3(value.R, value.G, value.B);
		}
		return fallback;
	}

	get rgb() {
		return [Math.round(this.R * 255), Math.round(this.G * 255), Math.round(this.B * 255)];
	}

	toHex() {
		return `#${this.rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
	}

	/** Color3 + Roblox transparency (0 opaque .. 1 invisible) -> CSS rgba(). */
	toCSS(transparency = 0) {
		const alpha = Math.round((1 - Math.min(1, Math.max(0, num(transparency)))) * 1000) / 1000;
		return `rgba(${this.rgb.join(", ")}, ${alpha})`;
	}

	equals(other) {
		return !!other && this.R === other.R && this.G === other.G && this.B === other.B;
	}

	toString() {
		return this.rgb.join(", ");
	}
}
