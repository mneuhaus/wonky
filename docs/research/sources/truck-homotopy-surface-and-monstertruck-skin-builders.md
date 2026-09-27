# truck `builder::homotopy` / `try_wire_homotopy` / `HomotopySurface`, and monstertruck `skin` / `sweep_rail` / `birail` / `gordon`

- Kind: open-source code (Rust).
  - truck at `8d03d8f` (2026-09-07), local clone `wonky-kernel/tmp/research/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean/`: `truck-modeling/src/builder.rs` l.196 (`homotopy`), l.294 (`try_wire_homotopy`), l.484 (`tsweep`), l.596 (`rsweep`); `truck-geometry/src/decorators/homotopy.rs` (`HomotopySurface`); `truck-geometry/src/nurbs/bspsurface.rs` l.1404 (`BSplineSurface::homotopy`).
  - monstertruck at `e6520c2` (2026-09-19), local clone `tmp/research/monstertruck/repo/`: `monstertruck-geometry/src/nurbs/bspline_surface/builders.rs` (`homotopy` l.26, `skin` l.85, `sweep_rail` l.160, `birail1` l.240, `birail2` l.334, `gordon` l.496), `nurbs/compat/mod.rs` (`make_curves_compatible`).
  - Repo facts (licence, activity, authors) as recorded in the existing notes `truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md` and `monstertruck-truck-fork-monstertruck-fillet-crate.md`.
- Authors/organization: RICOS Co. Ltd. (Yoshinori Tanimura) for truck; Moritz Moeller (virtualritz) for the monstertruck fork.
- License: Apache-2.0 (both). Porting permitted with attribution.
- Status: truck active (2026-09-07); monstertruck active (0.4.1, 2026-09-19, ~29 stars).

## What it is
The only open-source B-rep kernels in wonky's port lineage that have a loft primitive, and they show the minimal honest design: ruled faces between matched edges, no matching heuristics.

## How it works (DOCUMENTED from code)
- **`HomotopySurface<C0, C1>`**: a procedural surface S(u,v) = (1−v)·C0(u) + v·C1(u) over the two curves' own parameterisations; derivatives delegate to the curves. `builder::homotopy(edge0, edge1)` builds one face bounded by edge0, a line between end vertices, edge1 reversed and a line between start vertices.
- **`try_wire_homotopy(wire0, wire1)`**: requires equal edge counts (`Err(Error::NotSameNumberOfEdges)` otherwise); pairs edges i↔i in wire order; lateral lines between vertex pairs are shared through an entry map keyed by (v0.id, v1.id), so adjacent faces share lateral edges. No start-vertex search, no orientation check, no twist check.
- **`BSplineSurface::homotopy(c0, c1)`**: `syncro_degree` + `syncro_knots` (degree elevation + knot union), then a control net of two rows; v-knots [0,0,1,1]. Exact for polynomial/rational inputs that share the parameterisation.
- **monstertruck `skin(curves)`**: `make_curves_compatible` (max degree, merged normalised knot vector), then a **degree-1** v-direction with uniform knots i/(n−1): a piecewise-ruled skin, C0 at every section (not Onshape's cubic C2 skin). `sweep_rail(profile, rail, n_sections)`: samples the rail, rotates the profile to the tangent frame, skins (an approximation even for a straight rail, which the doc test says "should approximate extrusion"). `birail1/2`, `gordon` build networks the same way.
- **`tsweep` / `rsweep`** (truck): exact translational and rotational sweeps of vertices/edges/faces/shells into extrusions and revolutions (the analytic sweeps).

## Robustness and guarantees
Exact where the inputs are exact and the correspondence is the curves' native parameterisation; otherwise none. Responsibility for matching and twist is left to the caller.

## Parallelism and performance
Not measured. Per-face construction is independent (trivially parallel).

## Known failures, limitations
- No handling of unequal counts, no origin/orientation search, no self-intersection check.
- The ruling correspondence is the raw curve parameterisation: a line ruled to an arc gets whatever parameterisation the arc curve type has, so geometry differs from Parasolid/OCCT for the same input (INFERRED).
- `skin` is only C0 across sections; `sweep_rail` is a sampled approximation.

## Relevance for wonky
- The `try_wire_homotopy` shape (equal counts, shared lateral edges, one face per edge pair) is exactly the topology of Onshape's `MINIMAL`/`COLUMNS` two-profile loft and of wonky's planned `ruled(bottom, top)` constructor (corpus report phase 1). Port the topology construction, add wonky's own matching, carrier classification and twist certificate on top.
- `HomotopySurface` is the right internal representation for a ruled face whose carrier is not simpler: store the two boundary curves and evaluate (1−v)C0 + vC1 in F32x2 (uniform map work, GPU-friendly). Classify it into plane / bilinear / quadric where possible (addendum P-L1).
- `tsweep`/`rsweep` confirm the plan to treat extrusions and revolutions (and pipes made of them) as exact sweeps rather than lofts.

## Pointers worth porting or studying
`builder.rs::try_wire_homotopy` (shared lateral edge map), `decorators/homotopy.rs` (derivative formulas), monstertruck `compat::make_curves_compatible` (compatibility step for skins).

## Verdict: adapt
Take the topology construction and the procedural ruled surface; supply matching, simplification and validation that these kernels lack.
