# /// script
# requires-python = ">=3.11"
# dependencies = ["trimesh==4.5.3", "numpy<3"]
# ///
"""Independently check an exported print mesh.

Reads the .stl and its .print.json sibling and verifies, with an
implementation this project did not write, the two properties the mesh
claims: that it is watertight and consistently wound, and that its volume
agrees with the exact analytic volume the kernel recorded to within the
deviation the manifest declares it holds.

This only ever reads artifacts. It constructs no geometry and is not part of
any modelling path, exactly as scripts/validate-step.py is not.

Usage: uv run scripts/validate-print-mesh.py <prefix> [<prefix> ...]
"""
import json
import math
import sys

import trimesh


def check(prefix: str) -> dict:
    mesh = trimesh.load_mesh(f"{prefix}.stl")
    with open(f"{prefix}.print.json", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("schema") != "wonky.print-mesh/1":
        raise ValueError(f"{prefix}: not a wonky.print-mesh/1 manifest")

    # trimesh merges coincident vertices itself, so this is its own view of the
    # topology rather than a reading of the one the exporter believed it wrote.
    if not mesh.is_watertight:
        raise ValueError(f"{prefix}: mesh is not watertight")
    if not mesh.is_winding_consistent:
        raise ValueError(f"{prefix}: mesh winding is not consistent")
    if mesh.volume <= 0:
        raise ValueError(f"{prefix}: mesh volume {mesh.volume} is not positive")

    bodies = manifest["bodies"]
    exact = sum(b["exactVolumeMm3"] for b in bodies if b.get("exactVolumeMm3") is not None)
    deviation = max(b["achievedDeviationMm"] for b in bodies)
    result = {
        "file": f"{prefix}.stl",
        "watertight": True,
        "windingConsistent": True,
        "eulerNumber": int(mesh.euler_number),
        "triangles": int(len(mesh.faces)),
        "meshVolumeMm3": float(mesh.volume),
        "achievedDeviationMm": deviation,
        "checker": f"trimesh {trimesh.__version__}",
    }

    if exact:
        # Bounded in both directions, because the sign is a property of the
        # body and not of the method. Chords are inscribed, so an outer wall
        # loses material while a bore GAINS it: the hole's own polygon sits
        # inside its circle and leaves the opening smaller than nominal. A
        # revolved tube comes out under because its outer wall dominates; a
        # pierced plate, whose outline is exact and whose only curve is the
        # hole, comes out over. area * deviation is a generous envelope for
        # either, and still a far tighter statement than a percentage.
        difference = mesh.volume - exact
        envelope = mesh.area * deviation
        if abs(difference) > envelope:
            raise ValueError(
                f"{prefix}: mesh differs from the exact solid by {difference:.6f} mm3, "
                f"beyond the {envelope:.6f} mm3 its declared {deviation} mm deviation allows")
        result.update(exactVolumeMm3=exact, differenceMm3=float(difference),
                      allowedDifferenceMm3=float(envelope),
                      relativeError=float(abs(difference) / exact))
    return result


def main() -> int:
    prefixes = sys.argv[1:]
    if not prefixes:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    print(json.dumps([check(prefix) for prefix in prefixes], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
