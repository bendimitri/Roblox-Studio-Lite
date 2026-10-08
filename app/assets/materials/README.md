# Roblox PBR materials

Source: [MaximumADHD/Roblox-Materials](https://github.com/MaximumADHD/Roblox-Materials) (`Modern/`), resized to 512² for the editor.

| File | Role |
|------|------|
| `color.png` | Albedo / ColorMap |
| `normal.png` | NormalMap |
| `roughness.png` | RoughnessMap |
| `metalness.png` | MetalnessMap (when present) |

Refresh / re-download:

```bash
node tools/fetch-roblox-materials.mjs
```

Runtime also falls back to the jsDelivr CDN mirror of the same repo if a local file is missing.

Tiling: one texture tile = `TILE_STUDS` (default **4**) world studs — see `app/rendering/Materials.js`.
