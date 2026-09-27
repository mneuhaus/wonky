# Geometry needs specific to FDM printing

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.** By product-owner decision this topic got **no new deep
reads**. The khana design work of 2026-09-24 already researched printability
checks, fits and DfAM tools in depth. This chapter summarizes that work for the
knowledge base and cross-links it. It adds the scout's landscape of
print-intent geometry (polyholes, teardrops, 3MF, slicing, tessellation) and
ranks what wonky should take. Primary inputs:

| input | what it holds |
| --- | --- |
| [../khana/prior-art.md](../khana/prior-art.md) | pointer and the maintainer's cautions (Parasolid local extrema, TVCG 2010 trim pruning, volume-bound guard) |
| `tmp/khana/prior-art/findings.json` | canonical findings, sources **S01 to S38**, kernel primitives, acceptance corpus |
| `tmp/khana/prior-art/literature-synthesis.json` | second synthesis, sources **D1-D11, W1-W9, F1-F13, C1-C6, T1-T2** (41), 12 ranked ideas, `doNotAdopt` |
| [../khana/design.md](../khana/design.md) | what wonky will build: checks C1 to C11, query primitives Q1 to Q12, packages K1 to K20 |
| [../khana/doctrine-draft.md](../khana/doctrine-draft.md) | Marc's FDM doctrine, with every rule tied to a check and a profile field |
| scout landscape and catalog (workflow input) | 38 catalog-only sources, reproduced in section 7 |

**Light verification done for this chapter (no deep reads).**

- GitHub metadata through `gh api repos/...` on 2026-09-24 for 25
  repositories. Licenses, stars and last push dates in section 2 come from
  that call.
- Three single-file fetches, archived under `tmp/research/fdm-geometry/`:
  - OrcaSlicer `src/libslic3r/PrintConfig.cpp` (main);
  - PrusaSlicer `src/occt_wrapper/OCCTWrapper.cpp` (master);
  - Klipper `docs/Config_Reference.md`.
- The metadata of BOSL2 issue 1679 and a directory listing of OrcaSlicer's
  `src/slic3r/GUI/CAD`.

**No source notes exist for this topic.** `tmp/research/notes/` has no JSON
for this topic, so the publish-first step was a no-op. No
`docs/research/sources/<slug>.md` file covers it. The link column of the table
in section 2 therefore gives the primary URL and, where it applies, the khana
source id.

**Labels.**

- **DOCUMENTED**: read in a primary source, by this chapter's light
  verification or by the khana agents (their citation id is given).
- **DOCUMENTED (scout)**: reported by the scout from a primary source, not
  re-read for this chapter.
- **INFERRED**: this chapter's reasoning.
- **HEARSAY**: secondhand.

---

## 1. Landscape

### 1.1 The fault line: intent as geometry versus intent reconstructed from triangles

The field splits along one line.

**Design-side libraries encode print knowledge as geometry.** Examples:

- polyholes, teardrops, layer-aware horizontal holes and hanging holes with
  sacrificial bridges ([NopSCADlib](https://github.com/nophead/NopSCADlib));
- teardrop masks, threads with blunt starts and a global `$slop`
  ([BOSL2](https://github.com/BelfrySCAD/BOSL2));
- crush ribs and layer-height-dependent magnet floors
  ([gridfinity-rebuilt](https://github.com/kennetek/gridfinity-rebuilt-openscad)).

(All DOCUMENTED (scout).)

**Slicers receive float triangle soup** and have to reverse-engineer the same
intent:

- **OrcaSlicer guesses circles from triangles.** The `hole_to_polyhole`
  tooltip reads "Search for almost-circular holes that span more than one
  layer and convert the geometry to polyholes". The detection margin
  `hole_to_polyhole_threshold` defaults to **0.01 mm**, "as cylinders are
  often exported as triangles of varying size, points may not be on the circle
  circumference". Other settings: at most 50 edges, twist per layer on by
  default, and a link to the HydraRaptor polyhole post. DOCUMENTED:
  [PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/libslic3r/PrintConfig.cpp),
  lines 7853 to 7888 of the 2026-09-24 main, archived
  `tmp/research/fdm-geometry/orca-PrintConfig.cpp`.
- **PrusaSlicer's STEP import meshes with fixed defaults and casts to
  float.** It calls `BRepMesh_IncrementalMesh` with
  `STEP_TRANS_CHORD_ERROR = 0.005` (mm), `STEP_TRANS_ANGLE_RES = 1` (rad),
  relative mode off and parallel mode on, unless the caller passes other
  deflections. It then stores vertices as `Vec3f(float(...))`. DOCUMENTED:
  [OCCTWrapper.cpp](https://github.com/prusa3d/PrusaSlicer/blob/master/src/occt_wrapper/OCCTWrapper.cpp)
  lines 28-29, 133-135 and 153. The `/*BBS:*/` comments at line 83 show code
  shared with Bambu Studio. That the import path is the same in Bambu Studio
  is INFERRED from those comments.
- **Klipper splits every G2/G3 arc back into segments.** `[gcode_arcs]`
  `resolution` defaults to 1 mm, and "arcs smaller than the configured value
  will become straight lines". DOCUMENTED:
  [Config_Reference.md](https://www.klipper3d.org/Config_Reference.html#gcode_arcs).
  ArcWelder refits G1 runs into arcs beforehand
  ([ArcWelderLib](https://github.com/FormerLurker/ArcWelderLib), last push
  2024-04-14).
- **INFERRED: exact arcs do not survive to the machine.** Arcs travel exact
  CAD → triangles → G1 segments → refitted arcs → machine segments.
  Fighting for arc output is low value. Wonky's leverage is upstream:
  - own the print-compensated feature geometry, because the kernel knows the
    exact circles, axes and the build direction;
  - ship a watertight print mesh with a certified chordal bound.

### 1.2 Lineages

| lineage | members | what it contributes |
| --- | --- | --- |
| Printed-machine design libraries (OpenSCAD) | HydraRaptor blog posts (2011 polyholes, 2014 hanging holes, 2020 horiholes) → NopSCADlib; BOSL2; gridfinity-rebuilt; threadlib | print compensation as explicit geometry |
| B-rep part libraries | bd_warehouse (build123d), cq_warehouse (CadQuery, abandoned) | threads, fasteners, clearance/tap/insert holes as analytic B-rep |
| Slic3r family | Slic3r → PrusaSlicer → SuperSlicer → Bambu Studio → OrcaSlicer; CuraEngine alongside | layer-wise 2D geometry (Clipper), bridge/support detection, XY compensation, Arachne variable-width walls (khana S27) |
| Direct and implicit slicing | IceSL (2013), Starly direct NURBS slicing (2005), 3MF Slice extension, OpenVCAD, 3MF Volumetric (Gladius) | skip the boundary mesh: slice the CSG tree or the implicit field |
| Toolpath-first | FullControl, ArcWelder, ZAA (2016 paper → Orca `zaa_*`), non-planar: Ahlers' Slic3r fork, CurviSlicer, S3-Slicer, S4 | curvature and non-planarity at the path level |
| DfAM checkers (khana research) | Onshape thickness analysis, Netfabb, Magics, Meshmixer, Fusion orientation and Additive Assistant, SOLIDWORKS Print3D, Tweaker-3 | wall thickness, overhang and orientation advice; none certified (khana findings, topic `dfam-products-defaults`) |
| Exchange formats | STL, AMF curved triangles (abandoned in practice), 3MF Core 1.4.0 plus the Boolean, Slice, Beam Lattice and Volumetric extensions, lib3mf | how much intent survives the hand-off |

### 1.3 Trends 2024 to 2026

- **CAD is moving into the slicer.** OrcaSlicer main has
  `src/slic3r/GUI/CAD/` with these files:
  - `DesignCanvas`, `DesignPanel`, `DesignSketchTool`, `SketchInlineEditor`
    and `McpControl`;
  - its `deps/` bundle `OCCT` and `SLVS` (the SolveSpace solver);
  - commits touch it up to 2026-09-23, including 2026-09-15 "Extrude accepts
    a negative distance, and the Bodies card gains Boolean".

  DOCUMENTED (GitHub API listing,
  [src/slic3r/GUI/CAD](https://github.com/OrcaSlicer/OrcaSlicer/tree/main/src/slic3r/GUI/CAD)).
  The scout traces it to Snapmaker's SnapOrca (not re-checked, HEARSAY
  here). `McpControl` suggests that the in-slicer CAD can be driven over MCP
  (INFERRED from the file name only). Its robustness is OCCT's (INFERRED from
  the dependency). It is the closest competitor to wonky's workflow
  (INFERRED).
- **ZAA reached a mainstream slicer.** Orca's settings:
  - `zaa_enabled` (default false, expert mode);
  - `zaa_minimize_perimeter_height` (35°);
  - `zaa_min_z` (0.05 mm, "also controls the slicing plane").

  DOCUMENTED: PrintConfig.cpp lines 4889-4925. The method is Song, Ray,
  Sokolov and Lefebvre 2016 ([arXiv 1609.03032](https://arxiv.org/abs/1609.03032)).
- **Implicit 3MF is active but unconsumed.**
  [spec_volumetric](https://github.com/3MFConsortium/spec_volumetric) was
  last pushed 2026-09-18. No slicer reads it (DOCUMENTED (scout)).
- **Native thickness analysis in CAD.** Onshape offers ray and rolling-ball
  thickness with gradients (khana S08, W1). A single sampled minimum-wall
  number is now below the UX baseline (prior-art.md).
- **The Boolean extension exists but nobody uses it.**
  [spec_booleans](https://github.com/3MFConsortium/spec_booleans) (v1.1.1)
  has one star and no slicer consumers (DOCUMENTED (scout)).

### 1.4 What is conspicuously missing

1. **An open printability analyzer on exact B-rep with sound verdicts.** All
   open checks are mesh-based or slicer-internal. Commercial tools do not
   certify either:
   - Parasolid's default range query may return a local extremum (khana D2,
     [fd_chap.029](http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.029.html));
   - Magics, Netfabb and SOLIDWORKS publish capabilities, not guarantees
     (khana topic `dfam-products-defaults`).

   DOCUMENTED.
2. **A portable way to carry per-feature print intent** (hole class, fit,
   seam, orientation assumption) in 3MF. Per-object settings are vendor
   dialects (DOCUMENTED (scout): PrusaSlicer import matrix).
3. **A certified-deviation tessellator in production use** (DOCUMENTED
   (scout)). OCCT's deflection is a target, not a proven bound (INFERRED from
   the [BRepMesh guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__mesh.html)
   catalog entry). Wonky already has one for its v1 surfaces
   (`src/print-mesh.mjs`, section 3.7).
4. **A calibrated, directional fit model.**
   - BOSL2's issue [#1679 "Rethink $slop system"](https://github.com/BelfrySCAD/BOSL2/issues/1679)
     is open since 2025-05-11 (DOCUMENTED, API metadata).
   - Published FDM clearances are starting points, not fits (khana topic
     `fits-tolerances`).

These gaps line up with wonky's strengths: exact predicates, explicit
tolerances and fail-explicit semantics (INFERRED).

---

## 2. Comparison table

Verdict vocabulary:

- **take**: reimplement the idea in Bend or the host;
- **study**: read for ideas, do not port code (license or fit);
- **oracle**: use only as an external artifact validator, like OCCT for STEP;
- **watch**: follow, no action now;
- **reject**: do not follow.

Stars and push dates are from `gh api` on 2026-09-24.

| name | kind | status (push, stars) | license | verdict | key idea | sources |
| --- | --- | --- | --- | --- | --- | --- |
| khana design (C1 to C11) | wonky design | 2026-09-24, not built | private | **take** | exact per-face overhang bands, two-anchor bridge rule, opposed-face walls, tri-state verdicts with witnesses | [design.md](../khana/design.md) |
| Prusa BridgeDetector | slicer code | pinned commit | AGPL-3.0 | study | anchors = intersection with lower-layer slices; candidate directions; a test line counts only if both ends are anchored | khana F3/S19, [source](https://github.com/prusa3d/PrusaSlicer/blob/30ef59195e0f3ee6f270b185bb5f9fb5f349f81f/src/libslic3r/src/libslic3r/BridgeDetector.cpp) |
| CuraEngine support/bridge | slicer code | 2026-09-22, 1852 | AGPL-3.0 | study | allowed lateral protrusion `tan(angle)·h` against the offset lower layer; bridge intervals scored by two-sided support | khana S20, F9 |
| SuperSlicer BridgeDetector | slicer code | pinned | AGPL-3.0 | study (anti-pattern) | 2° candidates; its fallback accepts one-ended lines | khana F4 |
| OrcaSlicer PrintConfig | slicer settings | 2026-09-24, 15761 | AGPL-3.0 | study | polyhole detection from triangles, XY hole/contour compensation, multi-layer elephant foot, arc fitting, ZAA | [PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/libslic3r/PrintConfig.cpp), khana F6-F8 |
| OrcaSlicer CAD tab | product | 2026-09-23 | AGPL-3.0 | watch | sketch + extrude + Boolean inside the slicer, OCCT + SolveSpace, MCP control | [GUI/CAD](https://github.com/OrcaSlicer/OrcaSlicer/tree/main/src/slic3r/GUI/CAD) |
| PrusaSlicer OCCTWrapper | slicer code | 2026-09-21, 9364 | AGPL-3.0 | study (anti-pattern) | STEP → BRepMesh 0.005 mm / 1 rad → float vertices | [OCCTWrapper.cpp](https://github.com/prusa3d/PrusaSlicer/blob/master/src/occt_wrapper/OCCTWrapper.cpp) |
| NopSCADlib | design library | 2025-10-08, 1636 | GPL-3.0 | study (formulas only) | reference polyholes, teardrop_plus, horiholes, hanging holes | [repo](https://github.com/nophead/NopSCADlib) |
| HydraRaptor posts | blog | 2011, 2014, 2020 | all rights reserved | take (formulas) | polyhole n = max(round(2d), 3), circumscribed; sacrificial bridge layers; layer-aware horiholes | [polyholes](https://hydraraptor.blogspot.com/2011/02/polyholes.html), [hanging holes](https://hydraraptor.blogspot.com/2014/03/buried-nuts-and-hanging-holes.html), [horiholes 2](https://hydraraptor.blogspot.com/2020/07/horiholes-2.html) |
| BOSL2 | design library | 2026-09-23, 2374 | BSD-2-Clause | **take** (portable) | teardrop/onion/edge masks, blunt-start threads, snap pins, dovetails; `$slop` as a counter-example | [repo](https://github.com/BelfrySCAD/BOSL2), [#1679](https://github.com/BelfrySCAD/BOSL2/issues/1679) |
| gridfinity-rebuilt-openscad | design library | 2025-08-31, 2262 | NOASSERTION | study | crush ribs, supportless hole bridging, layer-height-dependent floors | [repo](https://github.com/kennetek/gridfinity-rebuilt-openscad) |
| threadlib | design library | 2026-05-08, 483 | BSD-3-Clause | take (table idea) | thread geometry from a CSV of standards with tolerance classes | [repo](https://github.com/adrianschlatter/threadlib) |
| bd_warehouse | B-rep library | 2026-09-21, 108 | Apache-2.0 | take (portable) | ISO/UTS threads, fasteners with clearance/tap/insert holes on B-rep | [repo](https://github.com/gumyr/bd_warehouse) |
| Clipper2 | 2D library | 2026-04-20, 2494 | BSL-1.0 | take (ideas; portable) | integer-coordinate polygon Boolean, offset, Minkowski: the de facto slicer 2D engine | [repo](https://github.com/AngusJohnson/Clipper2) |
| IceSL (Lefebvre 2013) | paper + tool | paper historical | paper; tool closed freeware (HEARSAY) | **take** (principle) | slicing commutes with CSG: slice the tree per layer, no boundary mesh | [HAL](https://hal.science/hal-00926861) |
| Filip, Magedson, Markot 1986 | paper | historical | Elsevier | **take** (already used) | chord error from second-derivative bounds: certified tessellation | [DOI](https://doi.org/10.1016/0167-8396(86)90005-1) |
| OCCT BRepMesh | docs | active | LGPL-2.1 + exception | study | linear/angular deflection, shared edge discretization | [guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__mesh.html) |
| 3MF Core 1.4.0 | spec | 2025-02-11 | BSD-2-Clause | **take** (export) | the mesh/package format every modern slicer reads | [spec](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) |
| lib3mf | library | 2026-09-09, 311 | BSD-2-Clause | oracle | reference reader/writer and conformance suites | [repo](https://github.com/3MFConsortium/lib3mf) |
| 3MF Boolean ext. v1.1.1 | spec | 2025-04-03, 1 | BSD-2-Clause | reject (no consumers) | deferred Boolean tree for the consumer | [spec](https://github.com/3MFConsortium/spec_booleans/blob/master/3MF%20Boolean%20operations.md) |
| 3MF Slice ext. | spec | 2024-02-23, 14 | BSD-2-Clause | watch | a closed-polygon stack per Z | [spec](https://github.com/3MFConsortium/spec_slice) |
| 3MF Volumetric ext. + Gladius | spec | 2026-09-18, 26 | BSD-2-Clause | watch | implicit function graphs in 3MF | [spec](https://github.com/3MFConsortium/spec_volumetric) |
| Arachne (Kuipers et al. 2020) | paper | deployed in Cura/Prusa/Orca | open access; code AGPL | study | variable-width beads from a skeletal trapezoidation | [DOI](https://doi.org/10.1016/j.cad.2020.102907), khana S27 |
| Onshape thickness analysis | product docs | current | proprietary | study (UX bar) | ray and rolling-ball thickness, gradients, clickable regions | khana S08, W1 |
| Netfabb / Magics / Meshmixer | products | current | proprietary | study | critical thickness, affected-area fraction, first-failure mode | khana W3, W4, S11 |
| Tweaker-3 | orientation tool | 2026-03-24, 110 | GPL-3.0 | study | candidate normals + scored bottom area, overhang and contour | khana F10/S23 |
| Fusion Automatic Orientation | product docs | current | proprietary | study | support, height and COM objectives; user priorities | khana C1/S33 |
| Prusa KB (modeling, elephant foot, Arachne) | vendor docs | maintained | proprietary | take (as labelled starters) | line-width walls, ≥ 0.3 mm moving clearance, ~0.2 mm elephant foot | khana F1, F2, S26-S28 |
| Formlabs / AON3D fit guides | vendor docs | current | proprietary | study | fit terminology; crush ribs 0.2 mm, ~2° taper (AON3D) | khana T1, T2, S38 |
| ArcWelderLib | library | 2024-04-14, 382 | AGPL-3.0 (headers) / no SPDX on repo | reject (for wonky) | refit G1 to G2/G3 | [repo](https://github.com/FormerLurker/ArcWelderLib) |
| Klipper `[gcode_arcs]` | firmware docs | 2026-09-19 | GPL-3.0 | evidence | arcs re-segmented at 1 mm | [docs](https://www.klipper3d.org/Config_Reference.html#gcode_arcs) |
| ZAA (Song et al. 2016) | paper + Orca feature | 2025-26 deployment | arXiv; impl. AGPL | watch | vary Z inside a top layer to remove stair steps | [arXiv](https://arxiv.org/abs/1609.03032) |
| CurviSlicer / S3-Slicer / S4 / Ahlers fork | research slicers | 2023-2025 | AGPL / BSD-3 / GPL-3 / AGPL | reject (scope) | mesh or tet-mesh deformation pipelines | section 7 |
| Starly et al. 2005 | paper | historical, patent abandoned | Elsevier | study | direct NURBS slicing into exact contours | [paper](https://www.sciencedirect.com/science/article/pii/S0010448504001356) |
| AMF curved triangles | ISO/ASTM 52915 | abandoned in practice | ISO paywall | reject | curvature carried by vertex normals and subdivision | [ISO](https://www.iso.org/standard/74640.html) |
| wonky sdf prototype `fdm.bend` | wonky prototype | 2026-09 | private | take (advisory channel) | offset, shell, interference, Lipschitz thickness rays on one tape | [../proto-sdf.md](../proto-sdf.md) |

---

## 3. State of the art: techniques, real guarantees, where they break

### 3.1 Print-compensated holes

| technique | what it does | real guarantee | where it breaks |
| --- | --- | --- | --- |
| **Polyhole** (HydraRaptor 2011; Orca `hole_to_polyhole`) | replaces a vertical circle of diameter d with a regular n-gon, n = max(round(2d), 3), sized on the circumscribed radius, so the plastic that cuts across polygon corners leaves the hole at size (DOCUMENTED (scout); Orca implements it and cites the post, DOCUMENTED) | empirical only; no geometric statement about the printed diameter | horizontal holes; double compensation if the slicer also applies `xy_hole_compensation`; a silent circle → polygon swap destroys the exact circle (khana `doNotAdopt`: "Silently polygonizing analytic circles into polyholes") |
| **Teardrop** (BOSL2, NopSCADlib `teardrop_plus`) | adds two 45° tangent flanks to a horizontal hole, optionally truncated to a flat roof | by construction no ceiling steeper than 45° except the apex (or the flat roof) | the fit diameter is only the inscribed circle; the apex is a narrow bridge; khana design §5.7 treats it exactly that way |
| **Horiholes** (HydraRaptor 2020) | computes each layer's actually printed cross-section, so horizontal holes print round without support | layer-exact if the layer schedule matches | the geometry depends on layer height; a change of profile invalidates the design (INFERRED) |
| **Hanging hole / sacrificial bridges** (HydraRaptor 2014) | a hole that starts in mid-air over a larger pocket prints on two bridge layers, then a square, then an octagon (DOCUMENTED (scout)) | every layer is a two-anchored bridge by construction | needs the membrane drilled or broken out; layer-height dependent |
| **Crush ribs** (gridfinity-rebuilt; AON3D) | small ribs that deform on insertion and absorb dimensional variance | tolerant by design, not exact | rib height and taper need calibration (AON3D suggests about 0.2 mm and 2°, khana S38, "not portable settings") |

**Common thread (INFERRED).** None of these is a geometric certificate. Each
is a process rule turned into geometry. That is exactly why they belong in the
kernel: the kernel knows the circle, the axis and the build direction, while
the slicer has to guess them back from triangles with a 0.01 mm margin.

### 3.2 XY compensation and elephant foot

- **OrcaSlicer: `xy_hole_compensation` and `xy_contour_compensation`.** Both
  "will expand or contract in the XY plane by the set value", default 0.
  DOCUMENTED: PrintConfig.cpp lines 7837-7851. Radius versus diameter is not
  stated. The khana agents flagged this: "version-pinned source verification
  is required before implementing that mapping" (findings topic
  `fdm-support-orientation`, S29).
- **OrcaSlicer: `elefant_foot_compensation`.** Default 0. It works together
  with `elefant_foot_compensation_layers` (default 1, a linear taper over N
  layers). DOCUMENTED: lines 896-914.
- **Prusa: about 0.2 mm for a 0.4 mm nozzle** as a starting point, preserving
  thin features adaptively (khana S28, DOCUMENTED). The scout reports
  PrusaSlicer's local-width-aware `contour_distance2`, not re-read here. A
  uniform offset would close thin slots.
- **The engine underneath.** Slicers do all XY work as 2D offsets and
  Booleans in integer coordinates (Clipper; DOCUMENTED (scout)).
  [Clipper2](https://github.com/AngusJohnson/Clipper2) is int64-coordinate
  (catalog).
- **Guarantee:** the offset itself is exact on integer polygons. The amount
  is a calibration value. **Where it breaks:** twice-applied compensation
  (CAD plus slicer), unknown sign or radius convention, and elephant-foot
  shrink that closes first-layer holes.

### 3.3 Overhangs, bridges, first layer

**What slicers really do** (all DOCUMENTED via pinned source by the khana
agents):

- **CuraEngine support.** `computeBasicAndFullOverhang` allows a lateral
  protrusion of `tan(support_angle) · layer_height`. It offsets the lower
  layer's outline by that amount and subtracts it from the current outline
  (khana S20, `cura-support.cpp:1651-1688`). The previous layer's real
  geometry decides, not a face angle.
- **PrusaSlicer BridgeDetector.** It grows candidate regions into the
  lower-layer slices to get anchors and tests candidate directions (5° steps
  plus contour directions). A test line counts only if **both** endpoints lie
  in anchors, and the detector prefers shorter worst spans (khana F3/S19).
- **SuperSlicer** uses 2° candidates. Its no-full-coverage fallback accepts
  lines with *either* endpoint anchored, so "a produced angle is not a proof
  of two-ended bridging" (khana F4).
- **Cura's bridge scoring** counts intervals that span two supported regions
  positively, hanging intervals negatively (khana F9).

**Guarantee.** These are discretized, toolpath-oriented heuristics, not proofs
that a bridge prints (khana). Sag, cooling and material decide the rest.

**What wonky designed** (khana design §5.7, C6):

- **Exact per-face overhang bands.** α = asin(max(0, −n·u)). A plane is all
  or nothing; a cylinder or cone has one closed-form angular band, clipped by
  the face trims.
- **One bridge rule replaces the ≤ Ø12 bore exemption and the two-probe
  test.** A candidate region is a bridge iff:
  - its minimal width across the build plane is ≤ `bridge.max_span_mm`, and
  - both opposite sides are anchored in non-candidate material over at least
    `bridge.min_anchor_mm`.
- **Consequence for horizontal bores.** Their chord is 2r·sin(half band), so
  at α_max = 45° it is r√2. A Ø12 bore gives 8.49 mm and passes a 10 mm
  span; a Ø20 bore gives 14.14 mm and fails. The result comes from the
  profile, in every orientation, and slots and inner fillets are covered too.
- **Bed level** h0 = min p·u, exact for any up vector. It replaces the
  AABB-corner projection that khana's baseline uses (literature-synthesis
  `currentBaseline`).
- **Later: a layer mode** (design §9 row 21; khana ranks 5 and 6). Layer
  sections, Cura's rule against the previous layer, two-anchor bridge
  directions, first-layer islands.

**Where exact per-face analysis breaks (INFERRED).** Stacked islands and
bridges over sparse infill are layer phenomena. A face-wise test cannot see
them; they need the layer mode (proposal R5).

### 3.4 Wall thickness

**Definitions** (khana topic `wall-thickness`):

- normal ray;
- cone rays (the Shape Diameter Function, W8);
- rolling ball / medial axis (Onshape, nTop, W1, W6);
- local feature size.

They disagree at sharp wedges.

**Tools.** Onshape exposes ray, rolling ball and gradients (W1). Netfabb has
a user-set critical thickness, an acceptable surface fraction and a fast
first-failure mode (W3).

**Real guarantee of sampling.** "The minimum over sampled chords is generally
an upper bound on the global minimum". A thin witness proves a violation, a
missed sample proves nothing (khana, DOCUMENTED as a derived statement).

**Arachne.** Arachne may omit features below a configured size and widen
retained thin features. Fixed nozzle-multiple wall rules are therefore
inadequate (khana executive findings, S27).

**What wonky designed** (C7, design §5.8):

- **The wall chord.** A wall chord is taken between faces whose normals are
  ≥ 120° apart. Every wall chord between faces A and B is at least dist(A, B).
  - A face-pair distance ≥ wall_min certifies a pass without sampling.
  - A double normal at interior points is an exact fail.
  - Otherwise the pair is `unresolved`.
- **Knife edges.** A dihedral angle below 60° is reported as a knife edge,
  not as a 0.05 mm wall.
- **Air gaps** are reported separately from walls.
- **Measured contrast.** A bored 20 mm plate reads 0.0746 mm in cad_khana
  (a self-hit) and exactly 20 in wonky.

**wonky's sdf prototype** (`kernel/proto/sdf/fdm.bend`) traces Lipschitz
sphere rays for thickness. It found the enclosure's 1.0 mm blind-vent
membrane, but it is "a sampled estimate of local wall thickness, not a
certified medial-axis minimum" ([../proto-sdf.md](../proto-sdf.md),
DOCUMENTED). Under the khana label rules that is an `estimate` channel: it can
prove a violation, never a pass.

### 3.5 Fits and clearances

**Terminology and formulas** (khana topic `fits-tolerances`, DOCUMENTED as
derived):

- **allowance** (designed), **tolerance** (manufactured range) and
  **clearance** are different things;
- diametral gap Cd = Dh − Ds; centered radial gap Cr = Cd/2;
- the worst-case interval is [DhL − DsU, DhU − DsL]:
  - lower bound > 0 guarantees clearance;
  - upper bound < 0 guarantees interference;
  - an interval straddling zero is a transition fit.

**Starting values and their status:**

- Prusa: ≥ 0.3 mm for moving parts, context dependent (S26);
- Formlabs: FDM 0.5 mm in a comparison table (T2, "not sufficiently
  explicit");
- AON3D: 1 to 2 extrusion widths (S38);
- OrcaSlicer: a tolerance calibration coupon (F8).

None is a universal fit class.

**Global slop is a known failure.** BOSL2 uses one global `$slop`. Its own
issue #1679 "Rethink $slop system" is open (DOCUMENTED).

**Threads use machining classes.** Thread libraries use machining tolerance
classes (threadlib, bd_warehouse; DOCUMENTED (scout)). The scout reports that
Orca's new CAD tab ships ISO/UTS thread profiles with zero print clearance
(not re-checked).

**wonky's design** (design §5.6, doctrine §4):

- **Fit classes live in one profile:** `sliding` 0.2 mm per side,
  `rib_line_contact` 0.1, `moving_min` 0.2, `press` uncalibrated.
- **Every value carries provenance** `starter` or `calibrated`.
- **Report wording:** a nominal pass reads "nominally clear, not calibrated".
- **Coupons:** a radial sweep of 0.10 to 0.50 mm in 0.05 mm steps, separately
  for vertical and horizontal bores. This is a proposal, not a validated
  range.

### 3.6 Orientation

- **Tweaker-3** scores candidate normals by bottom area, overhang and contour
  with tuned coefficients (F10/S23).
- **Fusion** ranks by support, box volume, height and COM height (C1/S33).

Neither is a certified optimum.

**wonky's design (C11).** Candidates are the six axes plus the lay-flat
normals of large planar faces and the axes of fit-critical bores,
deduplicated exactly. The metrics are exact moments; the output is a Pareto
set with exact ties reported. It stays advisory (design §5.12).

### 3.7 Tessellation for printing

**OCCT BRepMesh** meshes with linear and angular deflection and an optional
relative mode, and shares edge discretizations between adjacent faces
(catalog). Slicers run it with fixed defaults and cast to float (3.1).

**Filip, Magedson and Markot (1986)** bound the error of linear interpolation
of a C² curve over a parameter step h by M·h²/8, with M ≥ |f''|, and give
the analogous mixed-derivative form for surfaces. The exact constant form is
a catalog summary (DOCUMENTED (scout)); the formula written here is INFERRED
from the standard statement.

**wonky already implements this family of bounds.** From `src/print-mesh.mjs`
(header lines 7-39, DOCUMENTED):

- **Watertight by construction.** Every edge is sampled once and both faces
  take those samples. All points between vertices come from
  `kernel/tessellate.bend`.
- **Deviation bounds per surface:**
  - arcs obey the sagitta r(1 − cos(t/2));
  - cylinders and cones obey r_max(1 − cos(t/2));
  - spheres and tori obey ((R + r)du² + 2r·du·dv + r·dv²)/8 (`grid_bound`),
    the Filip form.
- **Refused by name:** ellipse and intersection-curve edges, and B-spline
  faces.

**Float cast budget (INFERRED arithmetic).** A float32 coordinate in
[256, 512) mm has an ulp of 2⁻¹⁵ mm ≈ 3.1·10⁻⁵ mm. That is two orders below
PrusaSlicer's 0.005 mm chord default. A certified bound stays meaningful after
the slicer's float cast if the report adds half an ulp at the part's extent.

**Sederberg et al. 2008** (watertight trimmed NURBS via T-splines) solves the
NURBS trim-gap problem. It is irrelevant for wonky's analytic carriers, where
shared edge sampling already closes the gaps (INFERRED).

### 3.8 Slicing and CSG

- **IceSL** slices CSG trees of meshes and analytic primitives per layer on
  the GPU, without building a boundary mesh (catalog,
  [HAL](https://hal.science/hal-00926861)).
- **Why that works (INFERRED).** For a plane z = c,
  (A op B) ∩ {z = c} = (A ∩ {z = c}) op₂ (B ∩ {z = c}). The identity is exact
  as sets. Regularization differs only where a face lies *in* the slicing
  plane, and slicers slice at mid-layer heights precisely to avoid that.
- **The 3MF positive fill rule** makes overlapping bodies legal. A slicer
  therefore unions them without a 3D Boolean (DOCUMENTED (scout), 3MF Core
  1.4.0).
- **Subtraction still needs a real Boolean.** The 3MF Boolean extension has
  no slicer consumers (DOCUMENTED (scout)).
- **The 3MF Slice extension** ships a closed-polygon stack per Z
  (DOCUMENTED (scout)). It is a lossless carrier for a sliced result, but it
  is rarely read.
- **Direct NURBS slicing** (Starly 2005) produced exact contour curves, and
  adaptive layer heights from curvature. It had no downstream consumer
  (scout).

### 3.9 Toolpath-level curvature and non-planar printing

- **ZAA** is the only non-planar technique in mainstream 3-axis slicing
  (Orca, 3.1). It would benefit from exact surface heights (INFERRED).
- **CurviSlicer, S3-Slicer, S4 and Ahlers' fork** are mesh or tet-mesh
  deformation pipelines (DOCUMENTED (scout)). They are out of kernel scope.
- **FullControl** designs G-code directly (GPL-3.0). It is useful as a
  reference for lattice and research prints, not for the kernel.

---

## 4. War stories and anti-patterns

**Measured on Marc's corpus.** Numbers 1 to 7 are measurements from the khana
inventories, cited in [design.md](../khana/design.md) §1, §2.1, §5.7, §5.8
and §5.14.

1. **Noisy checks get switched off globally.**
   - 52 of 175 real printability outputs raised the overhang threshold to
     ≥ 90°, and 17 set `wall_min_mm ≤ 0.05`.
   - 30 outputs report a "wall" < 0.1 mm, almost all at the 0.05 mm sliver
     floor.

   Lesson: a rule that flags correct geometry trains users to disable it
   (design §2.2 rule 5).
2. **Ray-sampled walls hit themselves.**
   - A 20 mm plate with a Ø60 bore reported 0.0746 mm.
   - A Ø1.5 pin at `wall_min 1.5` failed at 1.4977.
   - A 45° cone rim reported a 0.0596 mm "wall".

   59 of 61 printability failures are walls.
3. **Blanket exemptions lie in both directions.** The ≤ Ø12 bore exemption
   and the two-probe bridge test produced:
   - false fails: a 45° countersink from below, a 6 mm slot rotated 45° in
     plan, and a 6 mm bridge between 0.4 mm walls;
   - unconditional passes: inner fillets exempted as "Ø4 bores".
4. **`status: ok` next to overlaps.** 7 of 39 stored `mechanism.json` files
   carry 25 overlap rows; 20 of them are unasserted.
5. **Boundary distance instead of solid distance.**
   - A cube buried in another reported distance 8.0 and passed a 5 mm
     clearance.
   - A nominal 0.25 mm pin/bore gap measured 0.24999999999999983 and failed.
     Users patched this with `-1e-6` workarounds.
6. **A volume epsilon used as a contact tolerance.** 0.001 mm³ means a depth
   of 1e-5 mm on a 10 × 10 contact but 0.025 mm on a 0.2 × 0.2 contact. It is
   not scale-free.
7. **The checked proxy is not the exported part.** A thread-free proxy passed
   while the threaded export was broken
   (`~/Workspace/cad/cad-khana/field-notes.md:161-172`, via design §5.14).

**Anti-patterns elsewhere:**

8. **One-anchored "bridges".** SuperSlicer's fallback accepts lines with
   either endpoint anchored (khana F4). A bridge angle is not a bridge proof.
9. **Circles guessed back from triangles.** Orca's polyhole detection needs a
   0.01 mm margin "as cylinders are often exported as triangles of varying
   size" (DOCUMENTED, 1.1). The information was destroyed upstream and is
   recovered with a tolerance.
10. **STEP → fixed deflection → float.** PrusaSlicer's STEP path discards the
    exact surfaces at 0.005 mm / 1 rad and stores float vertices (DOCUMENTED,
    1.1). A kernel that exports its own certified mesh avoids a second,
    uncontrolled tessellation.
11. **Double compensation.** Examples: a CAD-enlarged hole plus slicer
    `xy_hole_compensation`, or a CAD elephant-foot chamfer plus slicer
    `elefant_foot_compensation`. Khana: "Warn when both layers appear to
    compensate the same feature" (topic `fits-tolerances`).
12. **The radial/diametral factor of two.** "A declared 0.2 mm per-side gap
    requires 0.4 mm diameter difference" (khana formulas). The slicer's UI
    labels do not say which one they mean (3.2).
13. **Importing another process's numbers.** Formlabs Form 4 resin values
    (0.2 mm walls, 0.4 mm clearance) must not become FDM defaults (khana
    S37). A 0.4 mm nozzle does not imply a 0.4 mm clearance (khana
    `startingValuesPolicy`).
14. **A global slop.** BOSL2 acknowledges its single `$slop` as inadequate
    (issue #1679, open).
15. **Silent pruning.** Krishnamurthy/McMains trim-texture culling can drop a
    surviving feature smaller than the resolution, and the paper leaves it to
    the user to notice visually (prior-art.md, S06). Parasolid's default range
    query may return a local extremum (D2). Neither is a certificate.
16. **Arcs that do not survive.** ArcWelder refits arcs that Klipper then
    re-segments at 1 mm (1.1). AMF curved triangles never reached printers
    (catalog). Carrying curvature to the machine has repeatedly failed as a
    format strategy.
17. **Geometry-mutating slicer options.** Orca's "Make Overhang Printable"
    changes geometry. In wonky such a change must be a named manufacturing
    derivative, never a silent edit (khana S22).
18. **Implicit fields as a geometry authority.** wonky's own sdf prototype
    returned 47 of 216 adversarial Boolean cases as `ok` with wrong geometry.
    It is kept only for FDM analyses
    ([../bakeoff.md](../bakeoff.md) "Verdict", DOCUMENTED).
19. **The AABB corner as the bed plane.** For an oblique up vector, projecting
    the AABB's eight corners gives an enclosure, not the real contact plane
    (khana baseline, `overhangs.py:25-43`).

---

## 5. What wonky should take: ranked proposals

**Status of the bake-off.** [../bakeoff.md](../bakeoff.md) "Verdict"
(DOCUMENTED):

- The winner is the **corefine + recover hybrid**: a tagged mesh Boolean
  decides the topology, and recover rebuilds the exact B-rep.
- exact-plane stays as a differential oracle.
- sdf is kept for FDM analyses only.
- Metal does not pay: it is slower than 18 CPU threads for every prototype.
- The hybrid is **not production-safe yet**. On the adversarial suites,
  corefine returns 18 wrong `ok` results and recover returns 15 wrong
  "exact" STEP files.

The proposals below say where they depend on that hybrid.

Ranking = value for Marc's FDM loop ÷ risk, with khana's evidence of what he
actually does (design §2.1) as the tie-breaker.

### R1. Build the khana FDM check core first: exact overhang bands, two-anchor bridges, opposed-face walls, knife edges

- **Idea.** Implement C6 (design §5.7) and C7 (§5.8) as designed: face bands,
  the bridge rule with exact region width (Q10) and topological anchors, the
  opposed-face wall certificate, knife edges and air gaps. Every result
  carries an interval, a label and a witness.
- **Plugs in.** `kernel/check/overhang.bend` and `kernel/check/wall.bend`
  (packages K8 and K9), on:
  - Q1 to Q3 face and edge facts (K3);
  - Q6 face-pair distance (K4);
  - the printer profile (K6).
- **Bend fit.** Good.
  - Per-face and per-face-pair closed forms on plane, cylinder and cone.
  - Balanced fork-join over face pairs. The work per pair family is uniform,
    so it could batch on the GPU, but the CPU fork tree stays the default
    (bake-off: Metal does not pay).
  - F32x2 closed forms with a stated arithmetic allowance, no mutation.
  - The 1-D certified search for edge minima is fuel-bounded and refuses on
    exhaustion.
- **Benefit.** It fixes the two checks Marc switches off most (war stories 1
  to 3) and removes the ≤ Ø12 exemption and the probes.
- **Risk.**
  - Q6 and Q10 are new, L-sized kernel work.
  - v1 covers plane, cylinder and cone only; sphere and torus are `refused`
    until K17, which needs the r20 hybrid.
  - Unresolved edge minima on filleted parts may be frequent (open question
    4).
- **First acceptance test.** The case tables of design §5.7 and §5.8. For
  example:
  - a 45° countersink from below has no candidate;
  - a horizontal Ø20 bore gives bridge width 14.14 > 10 → fail, Ø12 gives
    8.49 → pass;
  - a 20 mm plate with a Ø60 bore gives wall 20 exact;
  - a Ø1.5 pin at wall_min 1.5 passes.
- **Bake-off relation.** It is independent of the Boolean winner for bodies
  from today's special-case Booleans. For hybrid-recovered bodies it needs
  recover's exact faces (K17/K18).

### R2. One print profile and a directional, calibrated fit model, with coupons generated by wonky

- **Idea.** Model clearance as
  `clearance(feature kind, size, orientation relative to up, fit class,
  printer/material profile)`.
  - Radial and diametral values are always labelled.
  - The predicted printed interval is kept separate from the nominal exact
    gap.
  - wonky generates the calibration coupons: the khana sweep of 0.10 to 0.50
    mm radial in 0.05 mm steps, vertical and horizontal, plus crush-rib
    variants. It imports the measured results with printer, nozzle,
    filament, slicer profile and date.
  - **Reconciling the scout and khana.** The scout wants missing calibration
    to be an error; khana wants a labelled starter. Recommendation:
    - a *nominal* fit assertion passes with the text "nominally clear, not
      calibrated";
    - an assertion that explicitly asks for a *production* fit is
      `unresolved` until the profile row is `calibrated`;
    - it is never silently `pass`.
- **Plugs in.** `wonky-print-profile/1` and fit classes in `min_mm` (K6). A
  coupon model in the FeatureScript or Python frontend. The coaxial gap comes
  from Q12 plus Q6.
- **Bend fit.** Trivial. The exact coaxial gap is closed form. Interval
  propagation is host arithmetic on Bend-certified values (the threshold
  decision itself stays in Bend, design §4.1).
- **Benefit.** Directly fewer reprints of pins, bores and rails; no more
  factor-2 errors; the `-1e-6` hacks disappear.
- **Risk.**
  - The calibration burden is on Marc.
  - Process drift between filament spools.
  - Anisotropy and correlation between mating parts; statistical stack-up
    only with stated assumptions (khana).
- **First acceptance test.**
  - A 6 mm shaft in a 6.4 mm bore reports 0.4 diametral and 0.2 centered
    radial, `exact`.
  - Under the starter profile the verdict text says "not calibrated".
  - A coupon import flips that row's provenance to `calibrated` and changes
    the predicted interval, not the nominal one.

### R3. Print-intent hole and edge features as explicit, provenance-carrying operations

- **Idea.** The kernel owns what slicers guess:
  - teardrop and flat-roof teardrop for horizontal holes;
  - the sacrificial bridge membrane (nophead hanging hole);
  - a bottom-mouth chamfer against elephant foot (a coaxial cone cut);
  - crush ribs;
  - polyholes **only** as an opt-in export derivative, never as a silent swap
    of the analytic circle.

  Each feature records its intent (kind, fit class, profile hash) in
  provenance. C10 and C6 then read the intent instead of inferring it.
- **Plugs in.**
  - A small library of FeatureScript-callable wonky features (the frontend
    stays unmodified FS syntax; these are library features).
  - Existing kernel operations. A teardrop through-hole is **one convex prism
    tool** (an arc plus two tangent lines), so it uses the convex-tool
    subtraction and never forms the tangent cylinder/prism union that
    Booleans struggle with (INFERRED from the kernel's case list).
  - The membrane is a planar case.
  - The mouth chamfer is a coaxial cone cut (the round-through-hole and
    coaxial families).
- **Bend fit.** Excellent: no new surface types and no new predicates.
- **Benefit.** Horizontal fit bores print round enough, and the doctrine's
  "teardrop it" rule becomes one call. The slicer never needs to guess
  circles.
- **Risk.**
  - Horiholes and membranes depend on the layer height. The feature must
    record the profile hash, and a profile change must invalidate it
    visibly.
  - Polyholes contradict the exact-circle doctrine, so they stay export-only.
  - Outer bottom-edge chamfers on arbitrary outlines need a chamfer
    operation, which wonky does not have yet (fillets and chamfers are
    missing).
- **First acceptance test.** A flat-roof teardrop Ø5 through a 10 mm plate
  lying horizontally:
  - the body validates and the STEP passes `validate-step.py`;
  - C6 reports exactly one bridge region, of exact width 2r(√2 − 1) = 2.071
    mm, anchored on both flanks;
  - the 45° flanks are not candidates;
  - the provenance names `teardrop`, the fit class and the profile hash.

### R4. A slice-commutation oracle for the hybrid Boolean (IceSL as validator)

- **Idea.** Use "slicing commutes with CSG" (3.8) as an independent referee
  for 3D Boolean results. For each bake-off case:
  - section every leaf at a set of planes with `kernel/section.bend`;
  - combine the per-layer 2D regions with an exact 2D Boolean;
  - compare with the section of the 3D result: area, contour count and
    nesting per plane.

  The plane set is the layer planes plus every vertex and edge-extremum
  height ± a small offset, so thin features between planes are not missed.
- **Plugs in.** `scripts/bakeoff/validate.mjs` as a fourth referee next to
  OCCT, manifold3d and arbitration. A Bend 2D region module grows from Q10
  ("region intersection") into full region Booleans.
- **Bend fit.** Good.
  - Planes are independent, so balanced fork-join over plane indices works.
    Per-plane work is not uniform, so it runs on the CPU fork tree, not
    Metal.
  - Section contours are analytic lines, arcs and ellipses in F32x2 (today
    `section.bend` covers planar/cylindrical solids, see
    [../section.md](../section.md)).
  - Exact 2D predicates for line contours: quantize to an integer grid (for
    example 2⁻²⁰ mm within ±2048 mm fits a signed 32-bit word). An
    orientation determinant then needs about 67 bits, i.e. 3 U32 limbs
    (INFERRED).
  - Arc/arc ordering needs squared comparisons of degree-2 algebraic numbers,
    about 9 limbs by a rough count (INFERRED, to be prototyped, question 1).
- **Benefit.** It catches wrong-`ok` answers of corefine and wrong-"exact"
  recover STEP without OCCT, from wonky's own exact machinery. It is exactly
  what the hybrid lacks before production dispatch. The same 2D engine
  becomes R5's layer engine and R7's slice fallback.
- **Risk.**
  - A finite plane set can miss features between planes. Mitigation:
    event-height planes, plus a statement of coverage.
  - Cone and sphere sections are not in `section.bend` yet.
  - A 2D Boolean with arcs is real work (Clipper is polygon-only).
- **First acceptance test.** On the corpus cases where recover emits exact
  STEP, the per-plane area of slice(result) equals the 2D Boolean of the
  sliced leaves to within the stated tolerance, at 0.2 mm spacing plus event
  heights. On the adversarial cases with known wrong corefine answers, the
  oracle flags each one whose defect crosses a sampled plane, and reports
  coverage for the rest.

### R5. Layer-aware support, first-layer and bead-width analysis on exact sections

- **Idea.** Add the layer mode deferred by design §9 row 21 (khana ranks 5
  and 6):
  - **Support:** layer k's region outside the offset of layer k−1 by
    h·tan(α_max) is unsupported (Cura's rule).
  - **Bridges:** two-anchor bridge directions over exact sections (Prusa's
    rule, without its discretization).
  - **First layer:** islands, minimum neck and COM-projection margin.
  - **Bead width:** narrowest section width against Arachne-style bead
    limits from the profile, reported apart from structural wall thickness.
  - Line/arc regions are closed under offsetting by a disc: the offset of a
    line is a line, of an arc an arc (INFERRED, standard). Ellipse contours
    are not, and must be refused or approximated with a stated tolerance.
- **Plugs in.** `kernel/check/overhang.bend` layer mode, on the R4 2D engine
  plus a 2D offset.
- **Bend fit.** Good (fork-join over layers). The offsets and Booleans are
  the hard part.
- **Benefit.** It finds what per-face angles cannot:
  - floating islands inside one solid;
  - supports hidden by stacked geometry;
  - elephant-foot closure of first-layer holes;
  - sub-bead features that Arachne will drop.
- **Risk.** Large (2D offset plus Boolean with arcs), and the physical
  outcome (sag, adhesion) stays advisory. The value partly overlaps a pinned
  slicer run (khana rank 11).
- **First acceptance test.**
  - A bridge and a cantilever of the same length classify differently.
  - A floating island inside one connected solid is reported with its layer
    range.
  - A first-layer thin rim is reported with its exact width against the
    profile's elephant-foot value.

### R6. Certified print export: 3MF with stated deviation, extended surface coverage

- **Idea.**
  - Extend `src/print-mesh.mjs` to ellipse edges (plane sections of
    cylinders) and to hybrid-recovered faces, and choose the deflection from
    the profile (for example ≤ min(0.01 mm, line width / 40), INFERRED
    starting point).
  - Add half an ulp of float32 at the part extent to the stated bound.
  - Write 3MF Core with one named object per part, units in mm, and the
    deviation and profile in metadata.
- **Plugs in.** K14 (3MF), `kernel/tessellate.bend`, the recover output of
  the hybrid.
- **Bend fit.** Good. Per-face closed-form bounds and per-edge shared
  samples are uniform, embarrassingly parallel work. It is still best on the
  CPU fork tree.
- **Benefit.** It replaces the slicer's uncontrolled second tessellation
  (war story 10) and gives watertightness by construction, with a certified
  number in the file. No certified-deviation tessellator is in production
  elsewhere (1.4).
- **Risk.** Mesh size at tight bounds (open question 6); an ellipse bound
  needs a curvature maximum (closed form: a/b² at the major-axis vertices,
  for semi-axes a ≥ b);
  vendor 3MF dialects.
- **First acceptance test.** A bored plate and a plane-cut cylinder (ellipse
  edge) export to 3MF:
  - every edge is used by exactly two triangles;
  - an independent validator measures the vertex and mid-triangle distance
    to the analytic surfaces within the stated bound;
  - lib3mf reads the file back as artifact validation (like
    `validate-step.py` for STEP).

### R7. Declared Boolean-free print fallbacks, opt-in and labelled

- **Idea.** When a 3D Boolean is refused, offer two print-only exits, never
  silent and never for CAD export:
  - **(a) union by overlap.** Emit overlapping objects in one 3MF build item.
    Consumers union them under the positive fill rule. This matches the
    doctrine's "≥ 1 mm overlap skirt" rule (C9).
  - **(b) slice-only output** from the R4 engine, as per-layer contours or
    the 3MF Slice extension. It needs stated XY and Z tolerances.

  Subtraction cannot use (a).
- **Plugs in.** The export layer (K14), with the record `print-fallback:
  union-by-overlap | slice-only`, the tolerance and the refused operation.
- **Bend fit.** (a) is trivial. (b) is R4.
- **Benefit.** Marc can print while the hybrid's gaps close.
- **Risk.** The Slice extension has few readers. It conflicts with "one
  connected solid" unless the report says so. The AGENTS.md rule against
  silent fallback demands an explicit flag.
- **First acceptance test.** A refused plane/cylinder union exports with
  `--print-fallback=union-by-overlap`:
  - the report carries the fallback record;
  - STEP export of the same body still refuses;
  - a pinned OrcaSlicer CLI run on a copy slices it to one region (artifact
    evidence only).

### R8. Threads and inserts sized for printing

- **Idea.** Take the table-driven thread approach (threadlib, bd_warehouse)
  and BOSL2's blunt starts, but with **print** clearance classes from the
  profile instead of machining classes. Add heat-set insert pockets per the
  CNC Kitchen guide (catalog). Marc's doctrine already prefers printed
  trapezoidal screws (doctrine §8).
- **Plugs in.** A frontend feature library. The kernel needs a helicoidal
  sweep surface, which it does not have.
- **Bend fit.** Poor today: a new surface type. Insert pockets are plain
  cylinders and cones (good).
- **Benefit.** It removes the thread-free proxy problem (war story 7).
- **Risk.** A new surface family across the Boolean, tessellation and
  checks. Until then threads are a capability error and the proxy relation
  must be declared (design §5.14).
- **First acceptance test.** A heat-set insert pocket for an M3 insert from a
  profile row gives an exact diameter and depth. A thread request returns a
  capability error that names the missing sweep.

### R9. Z-aware geometry for ZAA and horiholes (research)

- **Idea.** Expose exact top-surface heights z(x, y) per face for ZAA-style
  slicers, and layer-exact horiholes computed from the profile's layer
  schedule.
- **Bend fit.** Good for heights (closed form on planes, cylinders and
  cones).
- **Benefit.** Only if a consumer exists. Orca's ZAA works on the mesh it
  slices, not on supplied heights (INFERRED from its settings, which take no
  external input).
- **Risk.** No consumer. Keep as research.
- **First acceptance test.** Not before a consumer exists.

### Anti-proposals

- **Do not chase G2/G3 arc output** (war story 16).
- **Do not port non-planar slicers.** They are mesh-optimization pipelines,
  out of kernel scope.
- **Do not link Clipper2, OCCT or lib3mf as a backend.** Clipper2 is
  BSL-1.0 and portable as ideas, but production geometry stays in Bend.
  lib3mf may validate artifacts.
- **Do not make the sdf field a geometry authority.** It stays an `estimate`
  channel for thickness and clearance previews (bake-off verdict).
- **Do not import copyleft code.** Slicer internals (PrusaSlicer, OrcaSlicer,
  CuraEngine, SuperSlicer) are AGPL-3.0; NopSCADlib, FullControl, S4 and
  Tweaker-3 are GPL-3.0. Reimplement from the published formulas
  (HydraRaptor posts, papers) and from permissive sources (BOSL2
  BSD-2-Clause, bd_warehouse Apache-2.0, threadlib BSD-3-Clause, Clipper2
  BSL-1.0, 3MF specs and lib3mf BSD-2-Clause, Kiri:Moto MIT). wonky is
  private and unlicensed today; permissive sources keep every future license
  option open (INFERRED).

---

## 6. Open questions worth a prototype

1. **Exact line/arc/ellipse 2D regions in Bend.** What limb count do arc/arc
   intersection orderings need on a quantized grid? Is there a
   filtered-then-exact path in F32x2 → multi-limb U32 as in
   `robust-predicates.bend`? Prototype: region Boolean and offset of rounded
   rectangles and circles; compare against a Clipper run on a copy (oracle
   only).
2. **Slice-oracle sensitivity.** Which plane sets (layers only; plus event
   heights) catch the 18 wrong-`ok` corefine and the 15 wrong-STEP recover
   cases of the bake-off? What does it cost against OCCT arbitration?
3. **Coupon design for Marc's printers.**
   - Which feature families: round against teardrop horizontal bores, crush
     ribs against plain clearance, snap engagement.
   - How many prints are needed for bias and variation.
   - Does orientation dominate material?

   The doctrine's open point lists A1 and others as unknown
   ([doctrine-draft §11](../khana/doctrine-draft.md)).
4. **How often is C7 `unresolved` on real parts?** On Marc's plane, cylinder
   and cone corpus, how often does the wall minimum sit on an edge and need
   the ray `estimate` channel? That measures whether R1 is enough alone.
5. **First-layer width.** Is Q10's minimal region width enough for
   elephant-foot closure, or does it need a 2D medial axis (PrusaSlicer's
   `contour_distance2`, not re-read)?
6. **Deflection policy.** Which chord bound, relative to the line width,
   gives manageable 3MF sizes on the corpus parts? Measure triangle counts at
   0.005, 0.01 and 0.02 mm.
7. **sdf thickness as a fast violation finder.** Do the Lipschitz rays find
   C7 violations earlier than the exact pair enumeration on hybrid-recovered
   bodies, without ever deciding a pass?
8. **Per-feature intent in 3MF.** Is any consumer-readable carrier worth
   writing per slicer (Orca/Bambu modifiers, Prusa per-object settings)? Or
   does everything have to be baked into geometry, as the scout concluded
   from the PrusaSlicer import matrix?

---

## 7. Catalog of the remaining sources

Sources that are neither deep-read here nor rows with a verdict in section 2.
All are catalog-only. License and status come from the scout, or from
`gh api` where a star count is given.

**Design-side and part libraries**

- [cq_warehouse](https://github.com/gumyr/cq_warehouse): the CadQuery
  predecessor of bd_warehouse, abandoned, Apache-2.0.
- [CNC Kitchen: heat-set inserts](https://www.cnckitchen.com/blog/tipps-amp-tricks-fr-gewindeeinstze-im-3d-druck-3awey):
  hole diameter per insert, depth allowance, wall, technique. Blog; source
  for R8.
- [Prusa KB: Modeling with 3D printing in mind](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135):
  45° rule, bridging, bottom chamfers instead of fillets, teardrops,
  elephant foot, tolerances. Read by khana as F1/S26.

**Slicers, slicer components, firmware**

- [Kiri:Moto / grid-apps](https://github.com/GridSpace/grid-apps): browser
  JS slicer for FDM, SLA, CNC and laser. MIT, 904 stars, pushed 2026-08-30.
  The only permissive full slicer; a code reference for JS-side slicing if
  ever needed.
- [Tweaker-3](https://github.com/ChristophSchranz/Tweaker-3): GPL-3.0
  (khana F10).
- Pinned slicer sources read by khana: PrusaSlicer BridgeDetector (F3/S19),
  SuperSlicer BridgeDetector and PrintConfig (F4, S21), Orca BridgeDetector
  (F5), CuraEngine bridge.cpp and support.cpp (F9, S20). URLs are in
  `literature-synthesis.json` `sources` and `findings.json` `sources`.
- OrcaSlicer wikis: [bridging](https://github.com/OrcaSlicer/OrcaSlicer/wiki/quality_settings_bridging),
  [precision](https://github.com/OrcaSlicer/OrcaSlicer/wiki/quality_settings_precision),
  [overhangs](https://github.com/OrcaSlicer/OrcaSlicer/wiki/quality_settings_overhangs),
  [tolerance calibration](https://www.orcaslicer.com/wiki/calibration/tolerance_calib)
  (khana F6-F8, S22, S29).
- [Arc overhangs (CNC Kitchen)](https://www.cnckitchen.com/blog/arc-overhangs-in-prusaslicer)
  and the [third-party Orca postprocessor](https://github.com/Kelsch/arc-overhang-orcaslicer-integration)
  (khana F13, S31): experimental. They grant no geometric exemption.
- [PrusaSlicer issue 2575: droop compensation for horizontal holes](https://github.com/prusa3d/PrusaSlicer/issues/2575)
  (khana S30).

**Formats**

- [3MF Beam Lattice extension](https://github.com/3MFConsortium/spec_beamlattice):
  beams with radii and cap modes. BSD-2-Clause, 10 stars, pushed 2024-02-23.
  Relevant only if wonky ever emits lattices.
- [AMF, ISO/ASTM 52915](https://www.iso.org/standard/74640.html): curved
  triangles. Abandoned in practice.

**Papers**

- [Sederberg et al. 2008, Watertight Trimmed NURBS](https://doi.org/10.1145/1360612.1360678):
  T-spline conversion for gap-free tessellation. Not needed for analytic
  carriers (3.7).
- [Starly et al. 2005](https://www.sciencedirect.com/science/article/pii/S0010448504001356):
  direct NURBS slicing, adaptive layer thickness; patent abandoned.
- Orientation and support: [Clever Support (Vanek et al. 2014)](https://doi.org/10.1111/cgf.12437),
  [Delfs et al. 2016](https://www.sciencedirect.com/science/article/abs/pii/S2214860416301142),
  [Dumas et al. 2014 scaffoldings](https://members.loria.fr/JDumas/publications/scaffoldings/)
  (khana S24, S25, F11, F12).
- Thickness: [Cabiddu/Attene 2017 epsilon-shapes](https://arxiv.org/abs/1704.08049),
  [Shapira et al. 2008 SDF](https://link.springer.com/article/10.1007/s00371-007-0197-5),
  [Hildebrand/Rüegsegger 1997](https://doi.org/10.1046/j.1365-2818.1997.1340694.x),
  [Baltadouros/Duflou 2026 (preprint)](https://arxiv.org/html/2609.15245)
  (khana W7, W8, S17, S18/W9).
- Distance and motion, relevant to fits: [Krishnamurthy/McMains/Haller TVCG 2010](https://mcmains.me.berkeley.edu/pubs/TVCG2010finalKrishnamurthyMcMains.pdf)
  (S06/D8), [FCL](https://github.com/flexible-collision-library/fcl) (D6/S05),
  [CCD benchmark (Wang et al.)](https://arxiv.org/abs/2009.13349) (D9). These
  belong to the distance and clearance topic; see khana topic
  `distance-clash-motion`.

**Non-planar and toolpath-first (out of kernel scope)**

- [CurviSlicer](https://github.com/mfx-inria/curvislicer): AGPL-3.0, 260
  stars, pushed 2025-03-28. Volumetric deformation for curved layers on
  3-axis printers.
- [S3_DeformFDM](https://github.com/zhangty019/S3_DeformFDM): BSD-3-Clause,
  175 stars, pushed 2025-04-24. Multi-axis, quaternion-field deformation.
- [S4_Slicer](https://github.com/jyjblrd/S4_Slicer): GPL-3.0, 951 stars,
  pushed 2025-04-26. Deform, slice planar, back-transform.
- [Ahlers nonplanar Slic3r fork](https://github.com/Zip-o-mat/Slic3r):
  AGPL-3.0, 611 stars, last push 2023-12-11. Abandoned.
- [FullControl](https://github.com/FullControlXYZ/fullcontrol): GPL-3.0,
  1007 stars, pushed 2026-09-05. Direct G-code design.
- [OpenVCAD](https://github.com/MacCurdyLab/OpenVCAD-Public): custom license
  (NOASSERTION), 64 stars, pushed 2026-07-29. Implicit multi-material design
  compiled to printer inputs.

**Commercial DfAM tools (khana; capability evidence only)**

- Onshape thickness analysis ([help](https://cad.onshape.com/help/Content/View/thickness_analysis.htm),
  S08-S10) and forum apps (C5, C6, S32).
- Netfabb (W3, S16), Magics (W4, S14), i.materialise (S15), Meshmixer (S11),
  nTop (W6, S12, S13; pages returned 403).
- Fusion Automatic Orientation (C1/S33) and Additive Assistant (C2/S34, the
  listing could not be fetched).
- SOLIDWORKS Print3D and thickness analysis (C3, C4, S35, S36; help shells
  only).
- Formlabs Form 4 specs (S37: SLA, do not import) and fit guides (T1, T2),
  AON3D engineering fits (S38).
