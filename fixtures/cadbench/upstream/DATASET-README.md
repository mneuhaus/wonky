---
license: apache-2.0
configs:
- config_name: default
  data_files:
  - split: train
    path: data/dataset.parquet
---

# CAD Generation Dataset

Each row in this dataset describes one parametric CAD part. Columns:

- `id` — row identifier (also the basename of the per-row asset files)
- `name` — part family (e.g. `flanges`, `spur_gear_stock`)
- `description` — natural-language description of the geometry
- `key_parameters` — the dimensions that drive the parametric model
- `image` — 512×512 PNG preview rendered from the FCStd
- `fcstd_path` — relative path inside this repo to the parametric FreeCAD document (`fcstd/<id>.FCStd`)
- `viewer_url` — full URL to an in-browser 3-D preview of the part on the viewer Space

The repo root also contains `fcstd/<id>.FCStd`, `glb/<id>.glb`, and
`edges/<id>_edges.json` for each row. The `fcstd_path` column points
into `fcstd/`; the viewer Space fetches GLB meshes and edge polylines
from `glb/` and `edges/`.

## Resolving `fcstd_path`

`fcstd_path` is a path relative to this dataset repo's root — for
example, `fcstd/0603c53148.FCStd`. Use `huggingface_hub.hf_hub_download`
to fetch one; it caches locally and handles auth for private repos:

```python
from datasets import load_dataset
from huggingface_hub import hf_hub_download

ds = load_dataset("gnucleus-ai/cad-gen-freecad", split="train")
row = ds[0]

local_fcstd = hf_hub_download(
    repo_id="gnucleus-ai/cad-gen-freecad",
    repo_type="dataset",
    filename=row["fcstd_path"],
)
print(local_fcstd)  # local cached path, openable in FreeCAD
```

Or build a direct download URL if you want to share a link:

```
https://huggingface.co/datasets/gnucleus-ai/cad-gen-freecad/resolve/main/<fcstd_path>
```

## Using `viewer_url`

`viewer_url` opens an interactive 3-D preview of the part:

```
<viewer-space-host>/?id=<id>
```

The HF Dataset Viewer renders this as plain text — it isn't clickable
in the table. Copy the cell value into a new browser tab, or open it
programmatically:

```python
from datasets import load_dataset
ds = load_dataset("gnucleus-ai/cad-gen-freecad", split="train")
print(ds[0]["viewer_url"])
```

## License

The dataset (parquet rows, PNG previews, GLB meshes, edges JSON, and the
FCStd files under `fcstd/`) is © gNucleus AI, Inc. and released under the
Apache License, Version 2.0.

The FCStd files are CAD geometry authored by gNucleus AI and saved via
FreeCAD. As user data outputs of FreeCAD, they are not derivative works
of FreeCAD itself, and FreeCAD's LGPL terms do not propagate to them.

## Opening the FCStd files

Each `fcstd/<id>.FCStd` was authored with FreeCAD 0.21.2 and opens in any
FreeCAD 0.21+. FreeCAD is a separate open-source project (LGPL-2.1+) at
https://www.freecad.org/ — it is not bundled with this dataset. Most
readers will only need the parquet, PNG previews, and viewer Space; the
FCStd files are provided for users who want to edit the parametric source.

## Validating model- or agent-generated FCStd files

If you've used a model or agent to generate a `.FCStd` from a row's
`description` and `key_parameters`, use the open-source
[gNucleus-AI/freecad-validator](https://github.com/gNucleus-AI/freecad-validator)
to score the generated file against the row's reference
`fcstd/<id>.FCStd`:

```bash
pip install gnucleus-freecad-validator
```

The validator reports `geometry_similarity` (solid count, volume,
surface area, bounding box, surface-type distribution),
`cad_spec_consistency` (named driven dimensions matching the part
spec within tolerance), and a harmonic-mean composite of the two.
See the repo README for the CLI and Python API.
