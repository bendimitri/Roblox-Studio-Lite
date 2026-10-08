/**
 * Object-space triplanar sampling for MeshStandardMaterial.
 * Uses local position × mesh scale / TILE_STUDS so textures keep physical density
 * on wedges, cylinders, spheres and MeshParts (no UV stretch).
 */
import { Vector3 } from "../thirdparty/three/three.core.js";

const TMP = new Vector3();

/**
 * Patches a MeshStandardMaterial to sample map/normalMap/roughnessMap/metalnessMap
 * via triplanar projection in object space.
 * @param {import('../thirdparty/three/three.core.js').MeshStandardMaterial} material
 * @param {number} tileStuds world studs per texture tile
 */
export function enableTriplanar(material, tileStuds = 4) {
	if (!material || material.userData.triplanar) return material;
	material.userData.triplanar = true;
	material.userData.tileStuds = tileStuds;
	material.userData.meshScale = new Vector3(1, 1, 1);
	material.userData._triUniforms = null;

	const prev = material.onBeforeCompile;
	material.onBeforeCompile = (shader, renderer) => {
		if (typeof prev === "function") prev(shader, renderer);
		shader.uniforms.uTileStuds = { value: material.userData.tileStuds || 4 };
		shader.uniforms.uMeshScale = { value: material.userData.meshScale };
		material.userData._triUniforms = shader.uniforms;

		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				`#include <common>
varying vec3 vLocalPos;
varying vec3 vLocalNormal;`
			)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
vLocalPos = position;
vLocalNormal = normal;`
			);

		// Sample a map with triplanar blend; `tex` is the sampler2D uniform name.
		// Three only declares normalMatrix in the fragment stage for object-space normal maps; uniforms are program-wide, so redeclaring it gets it set.
		const triFn = `
uniform float uTileStuds;
uniform vec3 uMeshScale;
#ifndef USE_NORMALMAP_OBJECTSPACE
uniform mat3 normalMatrix;
#endif
varying vec3 vLocalPos;
varying vec3 vLocalNormal;

vec4 triplanarSample(sampler2D tex, vec3 pos, vec3 nor) {
	vec3 blend = abs(normalize(nor));
	blend = pow(blend, vec3(4.0));
	blend /= (blend.x + blend.y + blend.z + 1e-5);
	vec3 p = pos / max(uTileStuds, 0.0001);
	vec4 x = texture2D(tex, p.zy);
	vec4 y = texture2D(tex, p.xz);
	vec4 z = texture2D(tex, p.xy);
	return x * blend.x + y * blend.y + z * blend.z;
}

// Whiteout-blended triplanar normal map, returned in object space.
vec3 triplanarNormal(sampler2D tex, vec3 pos, vec3 nor, vec2 scale) {
	vec3 n = normalize(nor);
	vec3 blend = abs(n);
	blend = pow(blend, vec3(4.0));
	blend /= (blend.x + blend.y + blend.z + 1e-5);
	vec3 p = pos / max(uTileStuds, 0.0001);
	vec3 tx = texture2D(tex, p.zy).xyz * 2.0 - 1.0;
	vec3 ty = texture2D(tex, p.xz).xyz * 2.0 - 1.0;
	vec3 tz = texture2D(tex, p.xy).xyz * 2.0 - 1.0;
	tx.xy *= scale; ty.xy *= scale; tz.xy *= scale;
	tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	return normalize(tx.zyx * blend.x + ty.xzy * blend.y + tz.xyz * blend.z);
}
`;

		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", `#include <common>\n${triFn}`)
			.replace(
				"#include <map_fragment>",
				`#ifdef USE_MAP
	vec4 sampledDiffuseColor = triplanarSample(map, vLocalPos * uMeshScale, vLocalNormal);
	diffuseColor *= sampledDiffuseColor;
#endif`
			)
			.replace(
				"#include <normal_fragment_maps>",
				`#ifdef USE_NORMALMAP
	vec3 objN = triplanarNormal(normalMap, vLocalPos * uMeshScale, vLocalNormal, normalScale);
	#ifdef FLIP_SIDED
		objN = -objN;
	#endif
	#ifdef DOUBLE_SIDED
		objN *= faceDirection;
	#endif
	normal = normalize(normalMatrix * objN);
#endif`
			)
			.replace(
				"#include <roughnessmap_fragment>",
				`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = triplanarSample(roughnessMap, vLocalPos * uMeshScale, vLocalNormal);
	roughnessFactor *= texelRoughness.g;
#endif`
			)
			.replace(
				"#include <metalnessmap_fragment>",
				`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = triplanarSample(metalnessMap, vLocalPos * uMeshScale, vLocalNormal);
	metalnessFactor *= texelMetalness.b;
#endif`
			);

		material.userData.shader = shader;
	};

	material.customProgramCacheKey = () => "triplanar-pbr-v2";
	material.needsUpdate = true;
	return material;
}

/** Updates triplanar uniforms after a part resize (mesh.scale or Size change). */
export function setTriplanarScale(material, scaleX, scaleY, scaleZ, tileStuds) {
	for (const m of Array.isArray(material) ? material : [material]) {
		if (!m || !m.userData || !m.userData.triplanar) continue;
		if (!m.userData.meshScale) m.userData.meshScale = new Vector3(1, 1, 1);
		m.userData.meshScale.set(scaleX, scaleY, scaleZ);
		if (tileStuds != null) m.userData.tileStuds = tileStuds;
		const u = m.userData._triUniforms;
		if (u) {
			if (u.uMeshScale) u.uMeshScale.value.copy(m.userData.meshScale);
			if (u.uTileStuds && tileStuds != null) u.uTileStuds.value = tileStuds;
		}
	}
}

/** Convenience: derive scale from part Size vs geometry baseSize. */
export function syncTriplanarFromPart(material, mesh, part, tileStuds) {
	if (!mesh || !part || !part.Size) return;
	const base = mesh.userData.baseSize || part.Size;
	const sx = part.Size.X / (base.X || 1);
	const sy = part.Size.Y / (base.Y || 1);
	const sz = part.Size.Z / (base.Z || 1);
	// Geometry was built at baseSize, so local pos is already in base studs;
	// multiplying by scale yields current studs. If geometry was built at Size and scale=1,
	// mesh.scale is 1 and we still want studs = local position → use scale 1,1,1
	// but tile from actual Size via: when scale is baked into geometry, pass (1,1,1)
	// and set tile from Size through UV path instead.
	// Prefer reading live mesh.scale when present:
	if (mesh.scale) {
		TMP.copy(mesh.scale);
		setTriplanarScale(material, TMP.x, TMP.y, TMP.z, tileStuds);
	} else {
		setTriplanarScale(material, sx, sy, sz, tileStuds);
	}
}
