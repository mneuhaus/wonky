# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["matplotlib==3.10.7", "numpy==2.3.3", "scipy==1.16.2", "trimesh==4.8.3", "pillow==11.3.0", "pyyaml==6.0.2"]
# ///
"""Paired, fixed-camera mesh previews using cad-project-043's maintained renderer.

Usage: uv run scripts/render-comparison.py before.stl after.stl --out out/views
These are visual measurements, not a geometry, clearance or fabrication verdict.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import platform
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--out", type=Path, default=Path("out/views"))
    parser.add_argument("--cad-project-043", type=Path, default=Path(__file__).resolve().parents[2] / "cad/cad-project-043")
    parser.add_argument("--camera", type=Path, help="Reuse a previously recorded camera.json for baseline checks")
    parser.add_argument("--size", type=int, default=384, help="Pixels per square view; used when creating a camera")
    parser.add_argument("--pixel-threshold", type=int, default=16, help="RGB-channel difference threshold, 0..255")
    args = parser.parse_args()
    if not 64 <= args.size <= 2048 or not 0 <= args.pixel_threshold <= 255:
        parser.error("size must be 64..2048 and pixel threshold 0..255")
    renderer_path = args.cad-project-043 / "skills/cad-design-system/scripts/render_views.py"
    spec = importlib.util.spec_from_file_location("cad-project-043_render_views", renderer_path)
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    renderer.plt.rcParams.update({"font.family": "DejaVu Sans", "figure.facecolor": "white"})
    groups = [renderer.load_meshes([str(path)], "+Z") for path in [args.before, args.after]]
    all_vertices = np.vstack([m.vertices for group in groups for _, m in group])
    if not np.isfinite(all_vertices).all() or len(all_vertices) == 0:
        raise ValueError("Missing or non-finite preview geometry")
    if args.camera:
        camera = json.loads(args.camera.read_text())
        if camera.get("schema") != "wonky.render-camera/1":
            raise ValueError("Unsupported camera schema")
    else:
        lo, hi = all_vertices.min(axis=0), all_vertices.max(axis=0)
        center = (lo + hi) / 2
        half_span = float(max(hi - lo)) * 0.525
        if half_span <= 0:
            raise ValueError("Cannot frame zero-size geometry")
        camera = {"schema": "wonky.render-camera/1", "projection": "orthographic", "up": "+Z",
                  "size": args.size, "limitsMm": [[float(c - half_span), float(c + half_span)] for c in center],
                  "boxAspect": [1, 1, 1], "zoom": 1.0, "light": [0.3, -0.6, 0.75],
                  "views": [{"name": name, "elevation": elev, "azimuth": azim} for name, elev, azim in renderer.VIEWS]}
    limits = np.asarray(camera["limitsMm"], dtype=float)
    size = camera["size"]
    if limits.shape != (3, 2) or not np.isfinite(limits).all() or np.any(limits[:, 0] >= limits[:, 1]):
        raise ValueError("Invalid camera bounds")
    if camera["projection"] != "orthographic" or camera["up"] != "+Z" or not isinstance(size, int) or not 64 <= size <= 2048:
        raise ValueError("Unsupported camera parameters")
    # Do not silently crop new material outside a pinned baseline camera.
    if np.any(all_vertices.min(axis=0) < limits[:, 0]) or np.any(all_vertices.max(axis=0) > limits[:, 1]):
        raise ValueError("Geometry exceeds the pinned camera bounds; visual check is incomplete")
    args.out.mkdir(parents=True, exist_ok=True)
    report = {"schema": "wonky.visual-comparison/1", "status": "measured", "evidenceBasis": "rasterized display meshes",
              "inputs": [{"path": str(p.resolve()), "sha256": digest(p)} for p in [args.before, args.after]],
              "camera": camera, "pixelThreshold": args.pixel_threshold,
              "renderer": {"path": str(renderer_path.resolve()), "sha256": digest(renderer_path),
                           "orientationHelperSha256": digest(renderer_path.with_name("check_mesh.py")),
                           "wrapperSha256": digest(__file__), "antialias": False, "triangleEdgeWidth": 0},
              "environment": {"python": platform.python_version(), "platform": platform.platform(),
                              **{p: importlib.metadata.version(p) for p in ["matplotlib", "numpy", "scipy", "trimesh", "pillow", "pyyaml"]}},
              "limitations": ["No geometric-equivalence or interference verdict", "Interior changes may be invisible",
                              "Pixel metrics depend on the recorded renderer environment", "Mesh subdivision is display processing only"], "views": []}
    panels = []
    for i, view in enumerate(camera["views"]):
        images = []
        for label, meshes in zip(["before", "after"], groups):
            fig = renderer.plt.figure(figsize=(size / 100, size / 100), dpi=100)
            ax = fig.add_axes([0, 0, 1, 1], projection="3d")
            renderer.draw(ax, meshes, view["elevation"], view["azimuth"], light=np.array(camera["light"]))
            # Override cad-project-043's per-model auto-fit with the same recorded frame.
            ax.set_xlim(*limits[0]); ax.set_ylim(*limits[1]); ax.set_zlim(*limits[2])
            ax.set_box_aspect(camera["boxAspect"], zoom=camera["zoom"])
            for collection in ax.collections:
                collection.set_antialiased(False)
                collection.set_linewidth(0)
            fig.canvas.draw()
            from mpl_toolkits.mplot3d import proj3d
            px, py, _ = proj3d.proj_transform(*all_vertices.T, ax.get_proj())
            pixels = ax.transData.transform(np.column_stack([px, py]))
            if np.any(pixels < 0) or np.any(pixels > size):
                renderer.plt.close(fig)
                raise ValueError("Projected geometry exceeds the image; visual check is incomplete")
            rgb = np.asarray(fig.canvas.buffer_rgba())[:, :, :3].copy()
            renderer.plt.close(fig)
            image = Image.fromarray(rgb)
            image.save(args.out / f"{i}-{label}.png")
            images.append(rgb)
        difference = np.abs(images[0].astype(np.int16) - images[1].astype(np.int16)).max(axis=2)
        changed = difference > args.pixel_threshold
        heat = np.full_like(images[0], 248)
        heat[changed] = [214, 48, 76]
        Image.fromarray(heat).save(args.out / f"{i}-diff.png")
        report["views"].append({"name": view["name"], "changedPixels": int(changed.sum()), "totalPixels": int(changed.size),
                                "changedFraction": float(changed.mean()), "maxChannelDifference": int(difference.max())})
        panels.append([Image.fromarray(images[0]), Image.fromarray(images[1]), Image.fromarray(heat)])
    sheet = Image.new("RGB", (3 * size, len(panels) * (size + 32) + 32), "white")
    draw = ImageDraw.Draw(sheet)
    from matplotlib.font_manager import findfont
    font = ImageFont.truetype(findfont("DejaVu Sans"), size=17)
    for j, label in enumerate(["Before", "After", "Changed pixels"]):
        draw.text((j * size + 12, 8), label, fill="#20242b", font=font)
    for i, (panel, measured) in enumerate(zip(panels, report["views"])):
        y = 32 + i * (size + 32)
        draw.text((12, y + 6), f"{measured['name']} | {measured['changedFraction']:.2%} changed", fill="#20242b", font=font)
        for j, image in enumerate(panel):
            sheet.paste(image, (j * size, y + 32))
    sheet.save(args.out / "comparison.png")
    report["overview"] = {"file": "comparison.png", "sha256": digest(args.out / "comparison.png")}
    for i, view in enumerate(report["views"]):
        view["images"] = {label: {"file": f"{i}-{label}.png", "sha256": digest(args.out / f"{i}-{label}.png")}
                          for label in ["before", "after", "diff"]}
    (args.out / "camera.json").write_text(json.dumps(camera, indent=2) + "\n")
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(args.out / "report.json"), "views": report["views"]}))


if __name__ == "__main__":
    main()
