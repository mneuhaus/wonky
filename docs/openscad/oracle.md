# OpenSCAD reference baselines: the oracle harness

Status: 24 September 2026. This is a design, backed by measurements. No
production code, fixture or test was changed. Scope: how OpenSCAD itself
produces **reference baselines** for `.scad` files, and how wonky's OpenSCAD
frontend is then **checked against them** ("Referenzbaselines, dann dagegen
prüfen"). This covers both modes of the frontend:

- **faceted**: wonky reproduces OpenSCAD's own polygonal tessellation, so
  every face is planar;
- **intent**: wonky reads circles, cylinders and spheres as exact analytic
  surfaces.

The frontend itself (grammar, evaluation, primitives) is specified elsewhere
(`docs/openscad.md`, `docs/openscad/semantics.md`). This document states only
what the harness needs from it (section 11).

**Revised after the review** ([review.md](review.md), same day). Changed:
`--render` on every `.csg`/`.echo`/`.ast` export (B1, sections 4.1, 4.3);
CGAL's float32 fallback and neighbour-cell merge (M1, sections 3.3, 4.4, 5);
the Nef facet count is advisory (M2, section 5); the intent volume bound
uses the true symmetric difference per leaf (M3, section 6); the OCCT intent
oracle reads a full-precision tree (M4, sections 6.4, 8); statuses
`inverted` and `exit0-error` (m1); the triangulation rule per CGAL path
(m2); export measurement from `brep.json` (m10); numbers compared within one
unit of the 6th digit (m11); the manifest path (m12). The dispositions are
in [design.md](design.md) section 15.

Evidence labels:
- **MEASURED**: run here with the installed CLI. Scripts and raw output are in
  `tmp/openscad/oracle/` (section 13).
- **READ**: taken from source code or documentation (file:line or URL).
- **INFERRED**: a conclusion or proposal that was not run.

## 1. Answer in short

1. **Reference producer.** The pinned OpenSCAD CLI with the CGAL backend is
   the faceted-mode reference, used as a test oracle only.
   - CGAL evaluates the Boolean in exact rational arithmetic. What goes into
     it is the faceted primitives, each snapped to a 2^-20 mm grid by
     truncation toward zero (MEASURED 124/124 coordinates; READ
     `Grid.h:97`), plus a merge into an occupied neighbour cell within one
     operand (READ `[S] Grid.h:104-140`).
   - **Exception, the float32 fallback.** A non-convex operand whose faces
     are non-planar after the snap makes the Nef constructor throw; CGAL
     then rebuilds it from vertices cast to **float32** (READ `[S]
     cgalutils.cc:62-99`, `PolySetUtils.cc:76`). The log says `CGAL error:
     assertion violation` and `PolySet has nonplanar faces`, the exit code
     is 0 (MEASURED review probe r04, section 3.7). Such a reference has its
     own status and a wider δ (sections 4.4, 5).
   - So in faceted mode, OpenSCAD answers **exactly** except for the snap,
     the float32 fallback, the export rounding and non-manifold results.
     That makes it a stronger faceted oracle than manifold3d.
   - The installed version is 2022.05.16 (git 6aae79634), a dev snapshot
     with CGAL 5.3 and no Manifold backend (MEASURED `--info`).
2. **Formats.** No mesh format of the installed version keeps exact
   coordinates:
   - ASCII STL, OFF and AMF write 6 significant digits. The error is up to
     5.5e-5 mm on 10 to 60 mm parts (MEASURED).
   - binary STL is float32 (error ≤ 3.8e-6 mm, MEASURED). 3MF writes 6
     decimals through lib3mf (≤ 5e-6 mm).
   - Only `.nef3` is exact: homogeneous integers on the 2^-20 grid.

   So the reference mesh is **binary STL triangles with every vertex snapped
   to its exact `.nef3` vertex**. Newer snapshots write ASCII STL as
   shortest round-trip doubles (READ), and there that file alone is exact
   (section 4.2).
3. **Side outputs are oracles too.**
   - `.csg` is OpenSCAD's fully evaluated flat tree, with resolved
     `$fn/$fa/$fs` and `multmatrix`. It is an oracle for the language layer,
     with no geometry involved. **It must be dumped with `--render`**:
     without it, `.csg`, `.echo` and `.ast` are evaluated with
     `$preview = true` while STL, OFF and nef3 get false (READ `[S]
     openscad.cc:422`, `:468`; MEASURED review probe r05, section 3.7).
   - `--summary` gives the Nef polyhedron's vertex, edge, facet and volume
     counts. `facets` is the number of maximal planar faces **of the
     snapped solid**, an advisory comparison with wonky's B-rep face count
     (section 5).
   - `-d` lists the whole include/use dependency closure, for the cache key.

   All of this is MEASURED.
4. **Faceted mode** compares the following, within `δ = δ_snap + δ_format`
   (δ_snap = √3·2^-20 ≈ 1.65e-6 mm on the main path; in a
   `float32-fallback` reference δ_snap + ½·ulp_f32(|x|max), section 5):
   - volume, area, bbox, sampled Hausdorff;
   - topology, hard: shells, genus, non-manifold edges;
   - topology, advisory: the planar face count against Nef `facets`, and V
     and E. The snap makes rotated planar faces non-planar and CGAL splits
     them (MEASURED review r02: 18 Nef facets where the exact B-rep has 12;
     section 5).

   The replica of OpenSCAD's faceting reproduces its volumes to ≤ 1e-3 mm³.
   That is the size of the snap, and each case stays below area × δ_snap
   (MEASURED, 5 cases).
5. **Intent mode** compares within allowances derived from each primitive's
   `$fn/$fa/$fs`:
   - **Volume.** The bound `|V_exact − V_openscad| ≤ Σ_i D_i` holds for
     every tree of ∪, ∩, − and affine maps (symmetric-difference lemma,
     section 6.2) when `D_i` is the volume of the **symmetric difference**
     of leaf i's exact and faceted solid, or a sound upper bound of it. Only
     for leaves that are provably inscribed (circle, cylinder, cone,
     sphere, straight or uniformly scaled extrusions of those) does that
     equal the deficit, for a cylinder `V_i (1 − sin x / x)` with
     `x = 2π/n`. A faceted `rotate_extrude` is **not** inscribed: it bulges
     into the hole of a torus (MEASURED review r03: |ΔV| = 2.1 × the
     deficit sum). MEASURED to hold on t01, t02 and t03.
   - **Hausdorff.** The allowance `ε` is sound for trees of unions, hulls,
     Minkowski sums and transforms. For ∩ and −, the Hausdorff check is
     advisory. The sampled Hausdorff distance to a high-`$fn` proxy matched
     the predicted `ε` within 5e-7 mm on the 5 cases measured.
   - **Main oracle.** OpenSCAD's defaults are coarse: r = 1 becomes a
     pentagon with 24 % volume deficit, and r = 100 has a chord error of
     0.55 mm. So the main intent oracle is **OCCT's exact CSG of the same
     tree**, at 1e-7 relative, as in the bake-off. On the geometry lane OCCT
     reads the full-precision tree that wonky dumps (17 significant digits),
     never the 6-digit `ref.csg`: the two differ by up to 2.9e-7 relative
     volume and 7.9e-5 mm (MEASURED, torus-customizer). On the csg lane OCCT
     and wonky both read `ref.csg` (section 6.4). OpenSCAD is then a coarse
     sanity bound.
6. **Triage.** A decision tree, in order:
   1. language layer (`.csg` diff);
   2. faceting (per-leaf diff);
   3. Boolean (manifold3d on wonky's own leaves);
   4. exact CSG (OCCT);
   5. snap-decided topology (ambiguous).

   Each class has a signal and an owner (section 7).

   The installed oracle has known wrong or lenient cases, MEASURED:
   - a 5e-7 mm gap is merged by the snap;
   - an edge-touching union is non-manifold. The STL is written with a
     warning, 3MF is written silently, AMF export fails, and the exit code
     is still 0;
   - `cylinder(r=undef)` silently becomes an r = 1 pentagon cylinder, and
     `cube(-3)` silently vanishes.
7. **Arbitration.** The pattern is the bake-off's:
   - the dispute definition, and third references in an `arbiter.json`
     keyed by case and reference hash;
   - a second independent oracle: manifold3d via `uv` on the faceted leaves,
     and OCCT on the exact tree and on wonky's STEP.

   MEASURED: manifold3d splits the edge-touching union into 2 components
   (genus −1) where CGAL keeps 1 non-manifold volume. That case is a
   dispute that policy settles as an expected refusal.
8. **Storage and licences.**
   - Committed: own files and permissively licensed files (MIT, BSD, Apache,
     ISC, zlib, CC0, CC-BY). Their references are committed as numbers,
     plus meshes ≤ 256 KiB.
   - Third-party copyleft, NC or unlicensed files stay in
     `tmp/openscad/corpus/`, recorded per file in
     `tmp/openscad/corpus-census/inventory.json`. Only facts about them (hashes
     and measures) may be committed.
   - Cached references go to `out/openscad/cache/<key>/` (gitignored).
9. **Integration.** `npm test` never runs OpenSCAD. It checks wonky against
   committed references of tiny own cases. The references are regenerated
   by an explicit command with `--check`. A nightly, resumable corpus run in
   the pattern of `scripts/corpus/run.mjs` compares labels against a
   baseline.

## 2. What wonky's harnesses already do (READ)

| harness | reference | compared | tolerance | storage |
|---|---|---|---|---|
| R20 acceptance `scripts/r20/acceptance.mjs` | Onshape STL + B-rep volume interval | volume, bbox, sampled symmetric Hausdorff, a "statement" check (stated deviation), mesh watertight + 1 component (`compare`, :147-187) | volume inside Onshape's [min, max] or 1e-6 relative (:49, :155-160); bbox and Hausdorff ≤ deviation + half-diagonal·(1 − cos 0.025) + 1e-4 mm float32 (:44-48, :140-150); a mesh-only reference uses area × tol for volume (:161-165) | the references live in the R20 project, read only; `out/r20/acceptance.json` |
| mesh tools `scripts/r20/mesh.mjs` | none | `readStl` (binary or multi-solid ASCII, :15-43); `measure`: signed volume, area, bbox, finiteness (:53-67); `topology`: welds bitwise-equal points, counts boundary, non-manifold and misoriented edges, and components (:72-101); `hausdorff`: BVH, all vertices + edge midpoints + 20,000 mulberry32 samples, deterministic (:166-201) | none | none |
| corpus runner `scripts/corpus/run.mjs` + `reference.mjs` | STEP/STL in the same project, matched by name (score ≥ 9) | volume, bbox extents, position (`agree` / `agree-shifted` / `disagree`) | STEP: 1e-3 relative, 0.05 mm; STL: 1e-2, 0.2 mm (`reference.mjs:104-111`) | append-only `out/corpus/runs.jsonl`; resumable; at most 3 processes (`run.mjs:58`); process-group kill on timeout (:158-173); benchmark labels plus `compare.mjs` regressions (exit 2) |
| Boolean bake-off `scripts/bakeoff/` | OCCT exact CSG + manifold3d on the same leaf meshes (`reference.py`, PEP 723 pins) | shells vs components, volume, area, bbox, genus, validity | agreement 1e-4 relative; dispute when shells differ or ΔV > area × deviation (`docs/bakeoff.md:417-420`) | jobs ≤ 256 KiB committed, larger ones in `out/` and regenerated, verified by the sidecar sha256 (`fixtures.mjs:10-28`); `reference.json` stores tool versions + `jobSha256` and is ignored when stale (`docs/bakeoff.md:344-360`); `arbiter.json` holds the third references (`docs/bakeoff.md:408-515`) |
| fillet harness `scripts/fillet/` | OCCT on wonky's input STEP, Onshape probes, closed forms | topology, geometry, G1, volume/area | volume/area 1e-7 relative, geometry 1e-6 mm (`validate.mjs:42-48`) | `fixtures/fillet/reference.json` with separate `occt` and `onshape` sections; `crosscheck.mjs` compares two prototypes where the oracles are weak |

To reuse unchanged: `scripts/r20/mesh.mjs`, the corpus run and benchmark
pattern, the bake-off fixture and sidecar rules, the arbiter pattern, the
OCCT measurement (`scripts/corpus/measure.py`, `scripts/validate-step.py`)
and the manifold3d pin (`manifold3d==3.5.3`).

## 3. Measurements with the installed CLI (MEASURED)

### 3.1 Probe set

Ten tiny files in `tmp/openscad/oracle/src/` (written for this study, no
third-party content) and one real file:

| id | content | why |
|---|---|---|
| t01 | `cube([20,20,10], center)` − `cylinder(r=5, h=30, $fn=32)` | through hole, explicit `$fn` |
| t02 | `cylinder(r=10)`, `cylinder(r=1)`, `sphere(r=10)`, default `$fa=12, $fs=2` | default fragment rule |
| t03 | `sphere(r=10, $fn=24)` | sphere rings, pole cap |
| t04 | `hull()` of a sphere and a cylinder, `$fn=16` | hull |
| t05 | `minkowski()` of a cube and a cylinder, `$fn=16` | Minkowski sum |
| t06 | `rotate_extrude($fn=32)` of a circle `$fn=16` at r = 10 | torus |
| t07 | `linear_extrude(h=10, twist=90, slices=10) square(5)` | twisted (helicoidal) sides |
| t08 | union of two cubes sharing one edge | non-manifold result |
| t09 | cube ∩ cube rotated 45° | rotated planar |
| t10 | coplanar union, then a flush pocket | coplanar faces |
| real | `openforge-bases/bases.scad` (Apache-2.0, 1,212 lines, customizer), copied from Marc's read-only corpus | timing, real CSG |

### 3.2 CLI behaviour

- **Exit codes are not enough.**
  - A failed `.csg` export ("Can't open file") exits 0.
  - A failed AMF export ("Export failed, the object isn't a valid
    2-manifold") exits 0 and leaves an empty 148-byte file.
  - A parser error exits 1. `--hardwarnings` turns the first warning into
    exit 1 with no output.

  The harness must parse the log and check every output (section 4.4).
- **`--export-format` overrides every `-o`.** In the first run, the `.3mf`,
  `.off` and `.amf` files were all ASCII STL. Use one format per `-o`
  (extension-driven), and `--export-format binstl` only in a separate
  invocation.
- **`.csg` and `.ast` need an absolute `-o` path.** A relative path is
  resolved against the source directory, fails, and exits 0.
- **Determinism.** Two runs of all 10 files produced byte-identical STL, OFF
  and AMF. 3MF differed only in random `p:UUID` attributes, and the summary
  JSON only in `.time`.
- **Speed.** The tiny files take 0.05 to 0.34 s each. `bases.scad` takes
  5.4 s at 1×1 and 11.7 s at 2×2 with CGAL, and 0.5 s / 1.0 s with
  `--enable=fast-csg`. That is 11× faster, but the output is not
  coplanar-merged (14,872 facets vs 1,309).
- **Lenient semantics** (`probe/lenient.scad`):
  - An unknown variable gives `WARNING: Ignoring unknown variable`, and
    `cylinder(r=undef)` then silently becomes an r = 1 cylinder with 5
    fragments (volume 11.888).
  - `cube(-3)` produces nothing, and no warning.
  - `sphere(r="x")` becomes an r = 1 sphere.
  - Exit code 0 throughout.
- **Modifiers.** `%` (background) is not exported, `*` is disabled, and `#`
  is exported as normal geometry.
- **Libraries.** `-d deps` lists the include/use closure, including BOSL2
  from `~/Documents/OpenSCAD/libraries`. Setting `HOME` to another directory
  does **not** move the user library path on macOS, so references are not
  hermetic unless the deps closure is recorded and checked.
- **`--summary`.**
  - It gives the Nef counts. t01: 72 vertices, 108 edges, 38 facets
    (= 6 box faces + 32 hole sides) and 2 volumes (the outer one plus 1
    solid).
  - But its `bounding_box` is float32: `6.0099992752075195` for 6.01 in
    `bases.scad`. Do not use it as a reference bbox.

### 3.3 Export precision against the exact `.nef3` vertices

Maximum distance of any exported vertex from its exact `.nef3` vertex, in mm
(`report.json`):

| case | ASCII STL / OFF | AMF | binary STL | 3MF | volume effect (ASCII vs exact) |
|---|---|---|---|---|---|
| t01 | 5.5e-6 | 5.5e-6 | 0 | 8.8e-7 | 4.9e-4 mm³ |
| t02 | 5.3e-5 | 4.8e-5 | 3.8e-6 | 5.0e-6 | 8.3e-4 mm³ |
| t03 | 8.5e-6 | 7.8e-6 | 1.5e-6 | 1.4e-6 | 1.6e-3 mm³ |
| t04 | 5.1e-5 | 5.0e-5 | 1.4e-6 | 1.1e-6 | 9.1e-4 mm³ |
| t06 | 4.6e-5 | 4.6e-5 | 1.5e-6 | 1.7e-6 | 1.3e-3 mm³ |

- **nef3** stores homogeneous integers. Every vertex lies on the 2^-20 grid:
  the denominators are powers of two ≤ 2^20, and `onGrid20` is true for all
  10 files. Binary STL of t01, t05 and t09 is bit-identical to nef3, because
  float32 represents 2^-20 multiples below 16 mm exactly.
- **The snap rule is truncation toward zero.** For t01, 124 of 124
  coordinates equal `trunc(x·2^20)/2^20`. Rounding would explain 92 and
  floor 68.
  - READ: snapshot `src/geometry/Grid.h:97` `int64_t(v[0] / this->res)`,
    `GRID_FINE = 2^-20` (`Grid.h:20`), applied when a PolySet becomes a Nef
    (`cgalutils.cc:43`).
  - Consequence: the snap moves each vertex toward the **world origin** by
    up to δ_snap = √3·2^-20 ≈ 1.65e-6 mm, not toward the primitive centre.
  - **Neighbour-cell merge** (READ `[S] geometry/Grid.h:104-140`,
    `Grid3d::align`): when a vertex's own cell is empty but a neighbouring
    cell (±1 per axis) is occupied, the vertex joins that cell. Inside one
    operand a vertex can therefore move by up to two cells, and two
    vertices closer than a cell can merge. So the rule is "truncation, plus
    merging into occupied neighbour cells within one operand". Topology
    decided by it is `ambiguous` (section 3.6).
  - **Float32 fallback** (READ `[S] geometry/cgal/cgalutils.cc:33-103`,
    `geometry/PolySetUtils.cc:76`). `createNefPolyhedronFromPolySet`
    quantizes the operand and triangulates it with
    `PolySetUtils::tessellate_faces`, which casts every vertex to float
    (`v.cast<float>()`). A convex operand is built as the convex hull of the
    snapped points (`cgalutils.cc:46-60`). For a non-convex operand whose
    faces are not planar after the snap, the Nef constructor throws, and
    the "alternate construction" uses the **float32** triangles. There the
    rounding is to nearest, not truncation, and coordinates that coincide in
    float32 merge (`Reindexer<Vector3f>`). MEASURED (review r04, section
    3.7): 100.123456789 becomes 100.123458862 (+2.07e-6 mm, above δ_snap);
    half a float32 ulp is 7.6e-6 mm at 128 to 256 mm.
- **Single primitives bypass CGAL.** A primitive exported without a Boolean
  skips CGAL: no snap, and OFF faces are n-gons (cylinder `$fn=10`: 20
  vertices, 12 faces). A reader must triangulate OFF faces in their plane,
  not fan them blindly.
- READ, master (`raw.githubusercontent.com/openscad/openscad/master/src/io/`):
  - `export_stl.cc` writes ASCII STL through double-conversion `ToShortest`,
    which is exact for doubles. Binary STL stays float32.
  - `export_off.cc` still uses the default stream (6 digits).
  - `export.cc` no longer lists AMF.
  - The `predictible-output` feature sorts vertices and faces.

### 3.4 Faceting replica and intent numbers

`analyze.mjs` holds a JS replica, as test tooling, of the 2022.05 rules:
- `get_fragments_from_r`: `n = int($fn)` with a minimum of 3 when `$fn > 0`;
  otherwise `ceil(max(min(360/$fa, 2πr/$fs), 5))`; and 3 below r = 2^-20;
- circles start at +X with `φ = 360 i/n`;
- spheres have `rings = (n+1)/2` at `φ = 180(i+0.5)/rings`.

READ: snapshot `src/utils/calc.cc:44-51`, via the semantics study in
`tmp/openscad/semantics/snap`.

MEASURED edge cases:
- `$fn=10.5` and `$fn=10.1` give 10 fragments. Master rounds up to 11
  (READ `src/core/CurveDiscretizer.cc`, `ceil(fn)`), so **the fragment rule
  is version dependent**.
- `$fn=2` gives 3 fragments.
- A cone with r2 = 0 has one apex vertex (9 vertices for `$fn=8`).
- `sphere($fn=7)` has 4 rings (28 vertices).
- r = 5e-7 gives 3 fragments.

| case | OpenSCAD volume (exact coords) | replica prediction | Δ (snap) | area × δ_snap | exact (intent) volume | deficit | bound Σ D_i |
|---|---|---|---|---|---|---|---|
| t01 hole n = 32 | 3219.638825 | 3219.638712 | +1.1e-4 | 2.9e-3 | 3214.601837 | +5.037 (0.157 %) | 15.11 (whole cylinder), 5.037 (clipped to the plate) |
| t02 defaults (n = 30, 5, sphere 30/15 rings) | 7255.313185 | 7255.313950 | −7.7e-4 | 4.2e-3 | 7361.798785 | −106.49 (1.45 %) | 106.48 + snap 0.004 |
| t03 sphere n = 24 | 4070.701633 | 4070.702609 | −9.8e-4 | 2.0e-3 | 4188.790205 | −118.09 (2.82 %) | 118.09 + snap 0.002 |
| t05 Minkowski n = 16 | 576.737589 | 576.737610 | −2.0e-5 | 9.0e-4 | 577.699112 | −0.962 | closed form of the faceted sum |
| t06 torus 32 × 16 | 764.495955 | 764.496221 | −2.7e-4 | 1.3e-3 | 789.568352 | −25.07 (3.18 %) | `sin x/x` × Pappus |
| t07 twist | 253.319354 | (not replicated) | | | 250 | **+3.32 (+1.33 %)**: the faceted solid is *larger* | none (helicoid) |
| t09 rotated ∩ | 828.427125 | | | | 828.427125 | 2.6e-10 relative (snap) | 0 |
| t10 coplanar | 880 | | | | 880 | 0 | 0 |
| t08 edge touch | 2000, **1 non-manifold edge**, STL not watertight | | | | 2000 | 0 | 0 |

Hausdorff: the sampled symmetric Hausdorff distance (`mesh.mjs`) between
OpenSCAD's faceted binary STL and a high-`$fn` OpenSCAD proxy
(`tmp/openscad/oracle/out-proxy/`), against the predicted allowance ε
(section 6.1):

| case | proxy | measured H (mm) | predicted ε (mm) |
|---|---|---|---|
| t01 hole | `$fn=1024` | 0.0240765 | 0.0240764 = 5 (1 − cos π/32) |
| t03 sphere | `$fn=256` | 0.16962 | 0.17037 = r − min_f h_f (proxy itself 1.5e-3 inside) |
| t04 hull | `$fn=128` | 0.18880 | 0.19030 = max(ε_sphere, ε_cyl) |
| t05 Minkowski | `$fn=128` | 0.0384299 | 0.0384294 = 0 + 2 (1 − cos π/16) |
| t06 torus | `$fn=256` | 0.09475 | 0.09621 = 12 (1 − cos π/32) + 2 (1 − cos π/16) |

The bbox caveat for spheres: the top ring sits at `r cos(90°/rings)`. For
t03 that is 9.9144 instead of 10: a 0.086 mm bbox deficit, which is inside ε.

Default faceting is coarse (`$fa=12, $fs=2`, computed with the replica):

| r (mm) | 0.5 | 1 | 2 | 3 | 5 | 10 | 50 | 100 |
|---|---|---|---|---|---|---|---|---|
| fragments n | 5 | 5 | 7 | 10 | 16 | 30 | 30 | 30 |
| chord error ε | 0.095 | 0.191 | 0.198 | 0.147 | 0.096 | 0.055 | 0.274 | 0.548 |
| area deficit 1 − sin x/x | 24.3 % | 24.3 % | 12.9 % | 6.45 % | 2.55 % | 0.73 % | 0.73 % | 0.73 % |

### 3.5 The second oracle (manifold3d, `uv run --offline`)

`tmp/openscad/oracle/manifold_probe.py` (manifold3d 3.5.3, the bake-off pin)
rebuilds four cases from the same unsnapped faceted primitives. manifold3d
3.5.3 has `hull`, `minkowski_sum`, `extrude`, `revolve` and `to_mesh64`.

| case | manifold3d | OpenSCAD CGAL | reading |
|---|---|---|---|
| t01 | V 3219.638711, genus 1, 1 component | 3219.638825 | Δ = snap (the truncated hole is 1.1e-4 mm³ smaller) |
| t08 | 2 components, genus −1 | 1 Nef volume with a non-manifold edge | **dispute** in topology; the exact regularized union is one non-manifold solid |
| t09 | 828.4271247461901 | 828.4271245345 | manifold3d equals the exact value (planar, no snap) |
| t10 | 880, 40 triangles | 880, 28 triangles | same solid, different triangulation |

### 3.6 Snap-decided topology

`union(){ cube(10); translate([10+g,0,0]) cube(10); }`:
- g = 5e-7 mm gives **one** box (8 vertices, 6 facets, 1 solid). The snap
  closed the gap.
- g = 1.5e-6 and 3e-6 give two solids.

This is the OpenSCAD counterpart of the bake-off's
`adv-box-union-gap-1e-9`, where OCCT's fuzzy merge closes the gap.

### 3.7 Review probes (MEASURED, `tmp/openscad/review/`)

Added after the review ([review.md](review.md)); all are own, tiny files
(no third-party content) and become own fixtures (design.md §12).

| id | content | result |
|---|---|---|
| r01 | a rotated non-convex operand | 21 Nef facets; snapped vertices |
| r02 / r02b | `rotate([10,20,30]) cube(10)` ∪ a small cube / the same unrotated | 18 / 12 Nef facets: the snap splits rotated planar faces (section 5) |
| r03 | torus R 10, r 2, revolution `$fn = 12`, tube `$fn = 256`, minus `cylinder(r = 10, $fn = 1024)` | faceted torus 753.907 vs exact 789.568 (D = 35.66); difference 352.525 vs exact 428.297, so \|ΔV\| = 75.77 = 2.1 × Σ D_i (section 6) |
| r04 | a non-convex L-prism with one raised vertex, at 50 to 230 mm, ∪ a cube | log `CGAL error: assertion violation! ... PolySet has nonplanar faces. Attempting alternate construction`, exit 0; all 12 polyhedron vertices float32 (section 3.3) |
| r05 | `echo(preview = $preview); $fn = $preview ? 8 : 64; cylinder(r = 5, h = 1);` | without `--render`: `.csg` has `$fn = 8`, `.echo` says `true`, the binary STL has 66 facets (`$fn = 64`); the same with several `-o` in one call; with `--render` all outputs agree |
| r05b | `w = $preview ? 1 : 2; ... cube([w, 1, 1]);` | `-D '$preview=false'` does not help: the file-scope assignment above the appended `-D` line still sees true (cube width 1, echo `false`); `--render` gives width 2 |

The census hit the float32 fallback once, in BOSL2 `spring_handle.scad`
(run 018, classified `success` with 0 warnings because only `ERROR:` and
`WARNING:` prefixes were counted; MEASURED `tmp/openscad/revise/csg-scan2.json`
quarantine flag `float32-fallback`).

## 4. Producing references

### 4.1 Oracle command

```sh
timeout -k 5 <T> /Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD --render \
  [-D name=value ...] [-p params.json -P set] \
  -o <abs>/ref.nef3 -o <abs>/ref.off -o <abs>/ref.csg -o <abs>/ref.echo \
  -d <abs>/ref.deps --summary all --summary-file <abs>/summary.json  <copy of src>.scad
OpenSCAD --render --export-format binstl -o <abs>/ref.bin.stl <copy>.scad   # second invocation
```

- **`--render` is mandatory** on every call that writes `.csg`, `.echo` or
  `.ast` (review B1). Without it those formats are evaluated with
  `$preview = true` (READ `[S] openscad.cc:422`, `:468`; `--render` sets
  the renderer, `:952`, `:1038-1040`), so the tree is not the tree of the
  geometry reference. `-D '$preview=false'` is not a substitute: the CLI
  appends `-D` lines at the end of the main file, and file-scope
  assignments above them still see true (MEASURED r05b, section 3.7).
  Effect on the census (MEASURED, `tmp/openscad/revise/csg-render.json`):
  re-dumping the 60 trees with `--render` changed 4 of them. Three are
  `$preview` effects: NopSCADlib `cable_clip` (strict; preview tree renders
  to 8490.97 mm³ with 47 volumes, reference 3433.17, render tree 3433.1675),
  `gridfinity-rebuilt-bins` (preview tree 4.75 mm Hausdorff off the
  reference, render tree 4.6e-5 mm) and NopSCADlib `rod` (a 17 MB preview
  tree, an empty render tree). The fourth, dotSCAD `packing_circles`,
  differs because of unseeded `rand()` (READ `packing_circles.scad:10`).
  `$preview` occurs in the dependency closure of 14 of the 60 runs.
- **Inputs.** Run on a **copy** under `tmp/` or `out/`. The corpus and
  libraries are read only, so mirror them as `scripts/corpus/run.mjs` does.
- **Paths.** Always use absolute `-o` paths (section 3.2).
- **Process control.** Spawn detached and kill the process group on timeout
  (`run.mjs:158-173`). Run at most 3 at once. Record `wallMs`, `timedOut`
  and max RSS (`/usr/bin/time -l`).
- **Backend.**
  - The default is CGAL (Nef). It is exact on the snapped input, merges
    coplanar faces, and its `--summary` counts are B-rep counts. It is the
    only backend whose topology can be the faceted reference.
  - `fast-csg` (2022.05) or `--backend=manifold` (nightlies since
    2024.09.28, READ fosstodon.org/@OpenSCAD/113256867413539398) are a
    speed fallback only. They are recorded in the cache key with the lower
    trust tier `mesh-backend`, and their summary counts are triangle-level.
  - Upstream reports Manifold and CGAL disagreeing on the same model
    (openscad/openscad#6652).
- **Version.**
  - Pin the executable: record `--version`, the git hash from `--info` and
    the sha256 of the binary.
  - Recommended but not done: install a current nightly *side by side* (do
    not replace 2022.05). It adds full-precision ASCII STL, Manifold,
    `predictible-output` and `$fe`.
  - Because the fragment rule changed (`int` → `ceil`), every reference and
    the faceting replica carry the version as a key.
- **Hermeticity.**
  - Record the deps closure (`-d`) with a sha256 per file. Fail the
    reference if a dependency lies outside the declared roots: the source
    copy and a pinned library snapshot passed through `OPENSCADPATH`.
  - `text()` depends on fontconfig and the installed fonts. Record the font
    path, and mark text cases `non-hermetic` so they never gate.

### 4.2 Which artifact is the reference mesh

| OpenSCAD | reference mesh | exact? |
|---|---|---|
| 2022.05 CGAL (installed) | binary STL triangles, each vertex replaced by its nearest `.nef3` vertex | yes, provided the nef3 vertex separation is > 2 × the float32 error (check it per case; otherwise parse the nef3 halffacet cycles or mark `precision-limited`) |
| nightly, CGAL or Manifold | ASCII STL (double-conversion shortest round trip, READ) welded bitwise, as `mesh.mjs topology` does | yes, as exact doubles (Manifold results are not snapped the same way; record the backend) |
| any | OFF / AMF / 3MF | no (6 digits, or float) |

The `.nef3` file is kept for arbitration: it holds exact rationals, so an
arbiter can decide a sub-1e-6 question on OpenSCAD's own data.

### 4.3 Side outputs stored with each reference

| file | use |
|---|---|
| `ref.csg` | dumped with `--render` (`$preview = false`). The language-layer oracle: diff it against wonky's evaluated tree (section 7, step 1); the source of per-leaf allowances (section 6.1); the csg-lane input for wonky and, on that lane only, for the OCCT intent oracle (section 8). Its numbers have 6 significant digits (`multmatrix` 0.707107, MEASURED), so it is **not** a bit-exact geometry input: its rotation matrices are orthonormal only to 5e-7 to 1.1e-6 (MEASURED in 14 of 46 meshed census trees, `tmp/openscad/revise/coverage2.json`) |
| `summary.json` | Nef V/E/F/volumes, `simple` (CGAL only); ignore `bounding_box` (float32) and `time` |
| `ref.echo` | dumped with `--render`. `echo()` and `assert` output, for the language layer |
| `ref.deps` | dependency closure, for the cache key |
| `run.log` | every `ERROR:`, `WARNING:`, `EXPORT-WARNING:`, `TRACE:` line, classified |

### 4.4 Reference status (fail closed)

The status is derived from the log and the outputs, never from the exit code
alone:

| status | condition |
|---|---|
| `ok` | exit 0, no `ERROR`/`WARNING`, every requested output exists and parses, the mesh is closed and 2-manifold |
| `warned` | as `ok` but with `WARNING:` lines. OpenSCAD substituted defaults (section 3.2). Never used as a plain pass reference; the expectation becomes "wonky refuses by name, or matches in a declared compat mode" |
| `non-manifold` | `EXPORT-WARNING` / `Export failed`, or `mesh.mjs topology` finds non-manifold or boundary edges |
| `empty` | no top-level 3D object (for example only `cube(-3)`); 2D-only files are `2d` |
| `error` | parser or evaluation error (exit ≠ 0) |
| `timeout` | killed. Retried once with the fast backend and then marked `mesh-backend` |
| `non-hermetic` | a dependency outside the declared roots, or `text()` |
| `openscad:float32-fallback` | the log has `CGAL error` or `PolySet has nonplanar faces` (section 3.3). The mesh is usable with δ = δ_snap + ½·ulp_f32(\|x\|max); topology below that δ is `ambiguous` (section 5). MEASURED r04 and census run 018 |
| `inverted` | the reference mesh has a **negative** signed volume. A wrongly wound `polyhedron` at top level exports that way, because no CSG runs (MEASURED semantics.md §7.3: −166.67). wonky's reorientation is then compared on \|V\| and must emit the named reorientation warning |
| `exit0-error` | exit 0, but the log has `ERROR:` lines, for example `The given mesh is not closed!` (READ `[S] cgalutils.cc:69`). Never a pass reference; the expectation is a named refusal, or `degraded` in compat mode |

Every status is recorded in `meta.json` together with the `$preview` value
the tree was evaluated with (always false with `--render`) and the
`--render` flag itself; a cached reference without that record is stale.

### 4.5 Caching

```
key = sha256(canonical JSON of {
  harness: 'wonky/openscad-reference/1',
  source: sha256(source bytes),
  deps: [[relative path, sha256], ...] (sorted, from -d; includes use/include/import/surface files),
  params: sorted -D list + customizer file sha256 + set name,
  openscad: { version, git, exeSha256, backend, features: sorted --enable list,
              render: true, preview: false },
  outputs: requested formats
})
```

- The cache lives in `out/openscad/cache/<key>/`, which is gitignored
  (`.gitignore` holds `out/`). A run with an existing key reuses it.
  `--check` regenerates the files and compares their hashes; STL, OFF and
  nef3 are deterministic (MEASURED).
- `meta.json` holds the key inputs, argv, exit code, `wallMs`, status, log
  classes, output hashes, the measures (section 5) and the per-leaf
  allowances (section 6).

## 5. Faceted mode: what is compared

wonky's faceted body is an exact B-rep with planar faces, so its own volume
(`brep.json validation.volumeMm3`) is exact. The reference coordinates are
off by the snap and the format.

Notation:
- `δ = δ_snap + δ_fmt + 1e-9·L`, where δ_snap = √3·2^-20 mm (CGAL main
  path; a vertex merged into a neighbour cell moves up to 2·√3·2^-20, and
  such topology is `ambiguous`) and L is the bbox diagonal. For an
  `openscad:float32-fallback` reference δ_snap becomes
  √3·2^-20 + ½·ulp_f32(|x|max) (7.6e-6 mm at 128 to 256 mm), and topology
  decided below that δ is `ambiguous`;
- `δ_fmt` = 0 for nef3-snapped or round-trip-double STL, √3·2^-24·|x|max
  for float32, and √3·5e-6·|x|max for 6-digit text.

| check | rule | source of truth |
|---|---|---|
| volume | \|V_w − V_ref\| ≤ A_ref·δ + 1e-9·V_ref | MEASURED replica vs OpenSCAD ≤ 1e-3 mm³, always < A·δ_snap |
| area | \|A_w − A_ref\| ≤ 1e-6·A_ref + ΣL_edges·δ | MEASURED ≤ 2.3e-7 relative across formats |
| bbox | each of the 6 bounds within δ | mesh bbox of the reference mesh (never `--summary`) |
| Hausdorff | sampled symmetric (`mesh.mjs hausdorff`, 20,000 samples) ≤ δ | the vertices should coincide |
| shells | wonky shells = Nef `volumes − 1` = reference mesh components (a void counts) | summary + `topology()` |
| genus / Euler | equal | `topology()` Euler characteristic; wonky validation |
| planar faces | **advisory**, like V and E: wonky B-rep face count vs Nef `facets`. Snapping each vertex separately makes a rotated planar face non-planar, and the convex path builds an operand as the hull of its snapped points (READ `[S] cgalutils.cc:46-60`), which splits the face into triangles (MEASURED r02: 18 Nef facets, exact B-rep 12; r02b unrotated: 12; r01: 21). A hard check is allowed only when every leaf matrix is an exact signed permutation plus a translation **and** every leaf face is axis-aligned or a wall of a straight Z prism (19 of 46 meshed census trees have only exact matrices, MEASURED `tmp/openscad/revise/coverage2.json`) | MEASURED t01: 38. INFERRED: Nef drops degree-2 vertices, so V and E are advisory too |
| manifoldness | wonky must be closed and 2-manifold (its own validation); reference `non-manifold` → the case expects a named refusal (`non-manifold contact`, `docs/hybrid-boolean-plan.md:142`) | policy |
| faceting | per leaf: wonky's faceted primitive vertex set = OpenSCAD's single-leaf export, within δ | section 7, step 2 |

Two cases are not exact equality:
- **Twist and non-planar faces.** OpenSCAD triangulates non-planar faces,
  and the diagonal choice changes the volume at first order: t07 is 1.3 %
  above the exact twisted prism. The rule depends on the source and on the
  CGAL path:
  - `linear_extrude` with twist or scale: OpenSCAD's own slice rule with the
    shorter-diagonal choice (semantics.md §7.7); faceted mode reproduces it
    (design.md S6c).
  - `polyhedron()` in a **convex** operand: the operand becomes the convex
    hull of its snapped points (READ `[S] cgalutils.cc:46-60`), so the face
    list does not matter; faceted mode builds the hull of the points.
  - `polyhedron()` in a **non-convex** operand with non-planar faces: the
    float32 fallback triangulates with libtess2
    (`PolySetUtils::tessellate_faces`, READ `[S] PolySetUtils.cc:103-110`);
    status `openscad:float32-fallback`. libtess2 is under the SGI Free
    Software License B (permissive), so a port is allowed; until one exists
    the case is `semantics:triangulation`.
  - A polyhedron exported alone, without CGAL, keeps n-gon faces in OFF
    (section 3.3).

  A non-planar polyhedron face that is planar within δ is compared
  normally; any other one without a reproduced rule is
  `semantics:triangulation`, never a kernel failure.
- **Snap-decided topology** (section 3.6). If a feature of the reference is
  below 2·δ_snap, meaning a gap, a wall or an overlap, the case is decided
  by the snap. It is scored `ambiguous` (section 8).

## 6. Intent mode: allowances

### 6.1 Per-primitive allowance from `$fn/$fa/$fs`

The allowance is read from the reference's own `.csg` (dumped with
`--render`, resolved specials per leaf) with the version's fragment rule.
Here `n` is the fragment count and `x = 2π/n`.

D is defined as `D_i := V(A_i Δ A_i′)`, the volume of the symmetric
difference of the exact leaf A_i and the faceted leaf A_i′, or a sound upper
bound of it (review M3). For an **inscribed** leaf (A_i′ ⊆ A_i) that equals
the deficit V(A_i) − V(A_i′). Where inscription is not proven, the sound
fallback is the volume of the ε_i tube around ∂A_i, because A Δ A′ lies
within ε_i of ∂A_i (INFERRED). For a smooth closed boundary with reach
≥ ε_i, Weyl's tube formula gives `2·ε_i·area(∂A_i) + (4π/3)·χ(∂A_i)·ε_i³`;
leaves with edges (cylinder rims) add at most `π·ε_i²` per unit of edge
length (INFERRED, conservative). For a torus from `rotate_extrude` this is
2·ε·S; r03 gives ε = 2(1 − cos π/256) + 12(1 − cos π/12) = 0.409 and
S = 789.6, so 2·ε·S = 646 ≥ 75.77: sound, but loose, so the per-wedge
V(A Δ A′) is the preferred D for revolutions.

| leaf (as in `.csg`) | Hausdorff ε | D = V(A Δ A′) |
|---|---|---|
| `circle`, `cylinder` (r1 = r2) | r (1 − cos π/n) | inscribed: V (1 − sin x / x) |
| `cylinder` (r1 ≠ r2, cone/frustum) | max(r1, r2)(1 − cos π/n) | inscribed (every section is an inscribed n-gon): V (1 − sin x / x) |
| `sphere` | r − min_f h_f over the replica's faces (h_f = distance from the centre to the face plane): exact for an inscribed convex polyhedron (6.3); MEASURED 0.1704 for r = 10, n = 24 | inscribed: V_sphere − V_replica |
| `rotate_extrude` (n) of a profile | ε_profile + R_max (1 − cos π/n) | **not inscribed**: between two rings the section is the profile scaled radially by cos(π/n) toward the axis, so an off-axis profile bulges into the hole (MEASURED r03: the inner half gains +40.1 mm³). Use V(A Δ A′) of the replica against the exact solid (by quadrature per wedge, INFERRED), or the tube bound. The Pappus deficit V_exact − (sin x / x)·2π ρ̄ A_profile′ is the **net** volume change only (MEASURED torus prediction exact to 2.7e-4) and is not a valid D |
| `linear_extrude` (no twist) of an inscribed profile | ε_profile · max(1, scale) | inscribed for scale = 1 or a uniform scale: h·(A_exact − A_poly) (· scale factor) |
| `offset(r > 0)` rounds | r (1 − cos π/n(r)) per arc | inscribed arcs: the arc segments' deficit |
| `offset(r < 0)`, `offset(-r) offset(+r)` | per arc as above | **not inscribed** (concave arcs are circumscribed; the idiom is neither, INFERRED): tube bound |
| `cube`, `square`, `polygon`, `polyhedron` (planar faces) | 0 | 0 |
| `linear_extrude(twist ≠ 0)`, `text`, `import`, `surface` | none: intent mode refuses by name, or treats the body as a stated-deviation mesh body | none |

Affine maps: ε scales with the largest singular value of `multmatrix`, and D
with |det|.

### 6.2 Tree rules

- **Volume (sound).** For op ∈ {∪, ∩, −},
  (A op B) Δ (A′ op B′) ⊆ (A Δ A′) ∪ (B Δ B′).
  By induction, `|V_w − V_ref| ≤ V(R Δ R′) ≤ Σ_i V(A_i Δ A_i′) + A_ref·δ
  = Σ_i D_i + A_ref·δ` with D_i as defined in 6.1.
  - This holds for **every** CSG tree, including grazing and tangent cases,
    **provided D_i is the symmetric-difference volume** (or a bound of it),
    not the net deficit. MEASURED to hold on t01, t02 and t03 (t02 is tight
    because its leaves are disjoint). MEASURED to fail with the net deficit
    on r03 (|ΔV| = 75.77 against a net-deficit sum of 35.67), where the
    faceted torus is not inscribed.
  - A tighter, still sound variant clips each leaf's D_i to the bbox of
    R ∪ R′. For t01 that gives 5.037 instead of 15.11. It gives no relief
    when the bbox contains the whole leaf (r03).
  - One-sided form: for trees with only ∪, hull and affine maps whose
    leaves are **all provably inscribed** (the leaf list of 6.1),
    `V_ref ≤ V_w + A_ref·δ`. A `rotate_extrude` or `offset(r < 0)` leaf
    voids it.
- **Hull.** `H(conv A, conv B) ≤ H(A, B)`, so ε(hull) = max ε_i. Volume:
  Steiner, `ΔV ≤ A·ε + M ε² + (4/3)π ε³` (use `A·ε·(1 + ε/r_min)` as a
  bound). MEASURED H: 0.1888 ≤ 0.1903.
- **Minkowski.** ε(A ⊕ B) ≤ ε_A + ε_B (MEASURED 0.038430 vs 0.038429,
  within float32 noise). Volume: the same Steiner-type bound.
- **Union.** ε(∪) = max ε_i for the **set** Hausdorff distance. The harness
  measures the surface distance, which agreed in every probe; an exceedance
  goes to triage, not straight to FAIL.
- **Intersection and difference.** There is **no** Hausdorff or bbox bound:
  a faceted hole can break through a wall that the exact hole does not
  reach. These checks are advisory. An exceedance triggers the faceted
  re-run (section 7, step 5).
- **Topology** (shells, genus) is advisory in intent mode for the same
  reason.

### 6.3 Why the sphere allowance is exact (INFERRED proof, MEASURED agreement)

The faceted sphere P′ is convex and inscribed in the sphere of radius r.

- For a sphere point p, let q be where the ray from the centre towards p
  crosses the face f it hits. Then |q| ≥ h_f, so
  `dist(p, P′) ≤ r − |q| ≤ r − h_f`.
- Conversely, for the direction normal to f, the whole of P′ lies on the
  inner side of f's plane, so `dist(r·n_f, P′) ≥ r − h_f`.
- Hence `H = r − min_f h_f`.

The same argument gives `r (1 − cos π/n)` for a cylinder's side.

### 6.4 The main intent oracle is not OpenSCAD

- Tolerances derived from OpenSCAD's defaults are large: 0.55 mm at
  r = 100, and 24 % volume at r ≤ 1.6. Against OpenSCAD, intent mode can
  therefore only show gross errors.
- The precise check is **OCCT's exact CSG** of the same tree (section 8).
  It uses the bake-off tolerances: volume and area 1e-7 relative, bbox
  1e-6 mm, shells equal, BRepCheck valid. Both sides must read **the same
  numbers** (review M4):
  - geometry lane: OCCT reads the full-precision tree that wonky dumps
    (`--dump-tree`, 17 significant digits, in the `--dump-job` format of
    section 11). The language lane proves separately that this tree equals
    `ref.csg` within one unit of the 6th significant digit (section 7,
    step 1). Comparing wonky-on-`.scad` with OCCT-on-`ref.csg` is **not**
    allowed: the 6-digit rounding alone gives 2.9e-7 relative volume and
    7.9e-5 mm Hausdorff on torus-customizer
    (`tmp/openscad/architect/rerender/compare.json`) and 2.86e-7 plus a bbox
    shift on Transforms-019 (`tmp/openscad/review/rerender/`); a
    translation like −29.5125 carries up to 5e-5 mm;
  - csg lane: OCCT on `ref.csg` against wonky on `ref.csg`. Both then see
    the 6-digit matrices; wonky must treat them as affine (design.md §5).
- An optional **refined OpenSCAD reference** tightens the OpenSCAD check
  (INFERRED, nightly only, preferably with Manifold):
  - rewrite every leaf's `$fn/$fa/$fs` in the flat `.csg` to 8× the
    fragments, and render that;
  - this is safe because the `.csg` is already fully evaluated, so no user
    logic depends on `$fn` any more;
  - the allowance shrinks by about 64× (ε ∝ 1/n²), plus the `.csg` 6-digit
    transform error (≈ 5e-6·|x|).

## 7. Triage of disagreements

In order, stop at the first step that explains the mismatch:

1. **Language layer.** Compare wonky's evaluated flat tree (`--dump-csg`,
   section 11) with `ref.csg`, after normalizing:
   - numbers parsed and compared within one unit of the 6th significant
     digit (`|a − b| ≤ 10^(e−5)` with e the decimal exponent of the larger
     magnitude), never as strings: a string comparison flips at rounding
     boundaries when wonky's binary64 value differs from OpenSCAD's in the
     last ulp (review m11);
   - `group() {}` wrappers removed;
   - specials resolved;
   - both trees evaluated with `$preview = false` (`ref.csg` from
     `--render`, section 4.1).

   A difference means `semantics:evaluation`: a wonky interpreter bug, or
   OpenSCAD leniency if `ref` is `warned`. Also re-run wonky on `ref.csg`
   itself. If the mismatch disappears, the language layer is confirmed as
   the cause.
2. **Faceting.** Per leaf, compare wonky's faceted primitive with OpenSCAD's
   export of that single leaf (render each `.csg` leaf with its
   `multmatrix`). A difference is `semantics:faceting` (rule or version) or
   `semantics:triangulation` (twist, non-planar polyhedron faces).
3. **Boolean.** Run manifold3d (uv) on **wonky's own faceted leaves** and the
   same tree, as the bake-off does with the same leaf meshes:
   - manifold3d = OpenSCAD ≠ wonky → `wonky-wrong:boolean`. Minimize it and
     add it to `fixtures/bakeoff/adversarial-*.json`.
   - manifold3d = wonky ≠ OpenSCAD → OpenSCAD is suspect. Go on to steps 4
     and 5.
   - all three differ → `unarbitrated` until an arbiter entry exists.
4. **Export.** If wonky's `brep.json` volume agrees but its STL or STEP
   measured independently does not, the class is `wonky-wrong:export`. The
   STEP is measured with OCCT through `scripts/validate-step.py` or
   `scripts/corpus/measure.py`. The mesh side is measured from `brep.json`
   with a planar triangulation in the harness, or from `--format print`:
   prism-arm and hybrid results carry `geometry: 'analytic'` even when
   every face is planar (READ `src/analytic.mjs:120`, `src/hybrid.mjs:420`),
   and `toStl` refuses every analytic body (READ `src/exporters.mjs:191`).
   A planar-analytic STL path is a change to `src/exporters.mjs` that has to
   be agreed with its owners (review m10).
5. **Snap and precision.** OpenSCAD is wrong or ambiguous in these cases:
   - The reference topology changes when the feature is shifted by
     < 2·δ_snap, or the smallest gap, wall or overlap is below 2·δ_snap.
     Class `openscad:snap`, scored `ambiguous` (MEASURED example: the 5e-7
     gap).
   - A 6-digit format merged or degenerated vertices. Class
     `openscad:export-precision`; re-derive from nef3.
   - The reference took CGAL's float32 fallback (section 3.3). Class
     `openscad:float32-fallback`: compare within the widened δ of section 5,
     topology below it is `ambiguous`.
   - The reference is non-manifold. Class `openscad:non-manifold`; the
     expected answer is a named refusal.
   - A mesh backend (fast-csg or Manifold) disagrees with CGAL. Class
     `openscad:backend`; use CGAL (openscad/openscad#6652).
6. **Intent only.** If intent disagrees beyond the allowance but faceted
   mode passes, the class is `semantics:faceting-sensitive`. That is not a
   bug; record it.

| class | signal | owner | score |
|---|---|---|---|
| `wonky-wrong:evaluation` / `:faceting` / `:boolean` / `:export` | steps 1 to 4 | frontend / kernel / exporter | FAIL |
| `openscad:snap` | step 5, topology decided below 2·δ_snap | none | `ambiguous` |
| `openscad:export-precision` | step 5 | harness (use nef3) | re-run |
| `openscad:float32-fallback` | log `CGAL error` / `nonplanar faces` | none | widened δ; `ambiguous` below it |
| `openscad:non-manifold` | reference status `non-manifold` | policy | expected refusal |
| `openscad:backend` | CGAL ≠ fast backend | none | use CGAL |
| `semantics:lenient` | reference `warned` | policy | expected refusal (or compat) |
| `semantics:version` | fragment rule or feature differs between versions | harness key | re-key |
| `semantics:faceting-sensitive` | intent mismatch while faceted passes | none | `info` |
| `semantics:unsupported` | `text`, `import`, `surface`, `$t`, 2D-only output | frontend | named refusal expected |

`$preview`-dependent code is **not** refused: wonky evaluates with
`$preview = false`, as the `--render` reference does (section 4.1).

## 8. Second oracle and arbitration

- **Faceted mode: manifold3d on the same leaves.** wonky dumps its faceted
  leaves and the tree as a bake-off job (the codec is already byte-stable,
  `docs/bakeoff.md` "Job and result format"). `uv run`, with a PEP 723 pin
  `manifold3d==3.5.3` as in `scripts/bakeoff/reference.py`, evaluates it
  with `Mesh64`. That gives an independent mesh Boolean on identical input
  (MEASURED feasible, section 3.5).
- **Intent mode: OCCT on the tree and on wonky's STEP.**
  - A `uv` script (cadquery-ocp 8.0.1, as in `scripts/corpus/measure.py`)
    builds the exact CSG with `BRepPrimAPI` and `BRepAlgoAPI`, fuzzy 0,
    from wonky's full-precision tree dump on the geometry lane and from
    `ref.csg` on the csg lane only (section 6.4). It covers `multmatrix`
    (as a general affine map, `gp_GTrsf`, since 6-digit rotations are not
    orthonormal), `cube`, `sphere`,
    `cylinder`/cone, `polyhedron` with planar faces, `linear_extrude` of
    polygons and circles without twist, and `rotate_extrude` of
    polygons/circles.
  - It records volume, area, bbox, solids, shells and BRepCheck validity.
  - wonky's own STEP is measured by the same library (`validate-step.py`).
  - Hull, Minkowski, twist, offset, text and import have no OCCT path. Such
    cases are compared with OpenSCAD only (section 6).
- **Disputes.** A case is disputed when:
  - (faceted) OpenSCAD's shells differ from manifold3d's components, or
    their volumes differ by more than A·δ;
  - (intent) wonky and OCCT differ by more than 1e-7 relative.

  Known OCCT failure modes are in `docs/bakeoff.md:408-446`: the fuzzy merge
  closes gaps and drops slabs.
- **Third reference and policy.** Third references are computed as in
  `scripts/bakeoff/arbiter.mjs`: a closed form, a set identity, a
  constructed mesh plus the exact validator, or quadrature. They are stored
  in `fixtures/openscad/arbiter.json`, keyed by case id **and** reference
  cache key.

  Policy: the reference is the exact CSG of the **unsnapped** faceted input
  (faceted mode) or of the analytic input (intent mode). If the snap or the
  input rounding can change the topology, the case is `ambiguous`: either
  topology with the reference volume is admissible. MEASURED example: t08,
  where CGAL gives a non-manifold volume and manifold3d 2 components; the
  policy answer is the expected refusal `non-manifold contact`.
- **Scoring vocabulary** (the union of R20 and the bake-off): `PASS`,
  `REFUSED` (by name, a capability error), `FAIL:<class>`, `ambiguous`,
  `unarbitrated`, `info`, `ref-invalid`, `ref-timeout`.

## 9. Storage layout and licences

```
fixtures/openscad/
  cases/<id>.scad            own or permissively licensed sources only (SPDX header)
  cases.json                 id, source path, params, modes, expectation, licence, provenance
  reference.json             per case and mode: reference cache key, OpenSCAD version/backend,
                             status, measures (section 5), per-leaf allowances (section 6),
                             output sha256; ignored when the key is stale (bake-off rule)
  meshes/<id>.<fmt>          reference meshes <= 256 KiB, only for committable sources
  arbiter.json               third references for disputed cases
  provenance.json            per file: origin URL, licence SPDX, copyright line, sha256
out/openscad/                (gitignored)
  cache/<key>/               ref.bin.stl, ref.nef3, ref.off, ref.csg, ref.echo, ref.deps,
                             summary.json, run.log, meta.json
  runs.jsonl, run-meta.jsonl nightly corpus records (append-only, resumable)
  bench/<label>/             labelled runs + compare.json
tmp/openscad/corpus/         third-party downloads and read-only mirrors; never committed.
                             The per-file record (sourceUrl, licence, sha256) is
                             tmp/openscad/corpus-census/inventory.json (2,550 entries,
                             every non-local one with sourceUrl and licence, MEASURED)
tmp/openscad/work/<slug>/    per-unit working copies (the corpus is read only)
```

Licence rules, INFERRED from the licence texts, for a commercial user:

| source licence | commit the source? | commit the reference mesh? | commit numbers and hashes? |
|---|---|---|---|
| own (Marc, wonky-authored) | yes | yes (≤ 256 KiB) | yes |
| CC0 / public domain | yes | yes | yes |
| MIT, BSD-2/3 (BOSL2 is BSD-2-Clause, MEASURED `LICENSE`), ISC, zlib, Apache-2.0 | yes, with the licence text and copyright notice (+ `NOTICE` for Apache) | yes (a derivative, same terms) | yes |
| CC-BY-4.0 | yes, with attribution in `provenance.json` and the file header | yes | yes |
| GPL/LGPL, CC-BY-SA | no, unless Marc decides to accept share-alike files in the repo | no | yes (facts) |
| CC-BY-NC(-SA), Thingiverse defaults, no licence (all rights reserved) | **no** | **no** | yes (facts only) |

Measured mix in Marc's `cad-project-043/var/research/openlock/downloads`: MIT
(F1nnM, hadencain), GPL-2 (PieterVdc), Apache-2.0 (devonjones
openforge-bases), CC BY-SA 4.0 (manolitto), and several directories with no
licence file. A reference mesh exported from a third-party model is a
derivative of it, so it follows the source's row.

## 10. How it plugs into `npm test` and a nightly run

- **`npm test`** (`package.json`: `check:bend && node --test test/*.test.mjs`).
  Add `test/openscad-oracle.test.mjs`, which must take < 10 s:
  - It runs the frontend in both modes on `fixtures/openscad/cases/*`: about
    20 tiny own cases such as t01 to t10, plus regressions.
  - It compares against the committed `reference.json` and meshes.
  - It **never needs OpenSCAD**. It fails on a stale reference, when the
    source sha differs from the key input.
  - It also carries unit tests of the harness: the OFF/nef3/STL readers, the
    tolerance formulas checked against the numbers in section 3, and a
    mutation self-test (flipped triangle, shifted leaf, wrong `$fn` rule),
    as `scripts/fillet/selftest.mjs` does.
- **Reference regeneration.** `node scripts/openscad/reference.mjs [--cases]
  [--check]` (proposed `npm run openscad:reference`).
  - It needs the pinned CLI. `--check` regenerates in memory and fails on a
    hash difference, like `scripts/bakeoff/fixtures.mjs --check`.
  - When the CLI is missing, it reports `oracle-unavailable`, never a pass.
- **Nightly corpus.** `node scripts/openscad/corpus.mjs [--label] [--only]
  [--retry-timeouts]`, copying `scripts/corpus/run.mjs`:
  - **Units.** A unit is a file × parameter set × mode. Customizer sets
    count like FS features.
  - **Execution.** At most 3 processes; references come from the cache; the
    OpenSCAD timeout is 120 s (600 s with `--retry-timeouts`, then the fast
    backend); the wonky timeout matches the corpus runner.
  - **Records.** One JSON line per unit: reference key and status, the wonky
    status, checks, verdict and class.
  - **Reporting.** `compare.mjs --label` reports new passes, regressions
    (exit 2) and class transitions.
  - **Populations.** Marc's 395 files are read-only mirrors. The public
    corpus lives in `tmp/openscad/corpus/`, per `corpus-census/inventory.json`. For the
    BSD-2-Clause BOSL2 and similar libraries, examples may be committed.
- **Gates.** Only `ok` references with committable sources gate `npm test`.
  Corpus results are trend data, like the FS corpus, not a gate.

## 11. What the harness needs from the frontend (proposal)

- **CLI.** `node bin/wonky-scad.mjs <file.scad> --mode faceted|intent
  [--openscad-compat 2022.05|<nightly>] [-D name=value] [-p file -P set]
  --format print|step|all --out <prefix> [--dump-csg <file>]`
  - The fragment rule and the triangulation of non-planar faces are
    selected by the compat version.
  - `--dump-csg` writes the evaluated flat tree in OpenSCAD `.csg` syntax.
- **brep.json.** Per body: `validation` (vertices, edges, faces, volumeMm3,
  boundsMm, closed), as the corpus runner reads it (`run.mjs:180-184`).
  Plus an `openscad` block per leaf: primitive, params, resolved specials,
  fragments, rings, transform, tree path, ε and D as the frontend computed
  them. The harness recomputes them independently from `ref.csg` and
  compares the two.
- **Leaf dump.** A `--dump-job` option writes the faceted leaves plus the
  tree in the bake-off job format, for the manifold3d oracle.
- **Full-precision tree.** A `--dump-tree` option writes the evaluated tree
  with every number at 17 significant digits, in the same job format, for
  the OCCT intent oracle on the geometry lane (section 6.4).
- **`$preview`.** Evaluation, `--dump-csg` and `.echo` use
  `$preview = false`, matching the `--render` reference; `brep.json` and the
  dumps record the value.
- **Refusals.** OpenSCAD leniency (unknown variable, invalid size, wrong
  argument type) raises a named capability or semantics error in strict
  mode (AGENTS.md: no silent skips), and is emulated only in an explicit
  compat mode.

## 12. Open questions for Marc

1. Install a current OpenSCAD nightly **side by side**, for Manifold,
   full-precision ASCII STL and `$fe`? The 2022.05 CGAL oracle stays pinned
   either way. Its fragment rule differs from master for fractional `$fn`.
2. Which reference compat version should faceted mode target by default:
   2022.05 (installed) or the current rule (`ceil($fn)`)?
3. May share-alike files (GPL, CC-BY-SA) be committed as fixtures, or only
   permissive ones?
4. Strict or compat by default for OpenSCAD leniency, such as `r=undef`
   becoming 1 and `cube(-3)` giving nothing?
5. Should `ambiguous` (snap-decided) cases count against the pass rate, or
   be reported separately as in the bake-off?

## 13. Evidence (all under `tmp/openscad/oracle/`)

| file | content |
|---|---|
| `src/t01…t10.scad`, `src-proxy/` | probe sources and high-`$fn` proxies |
| `run1.sh`, `out1/`, `out2/` | exports in every format, twice (determinism) |
| `analyze.mjs` → `report.json` | precision, volumes, replica, bounds, Hausdorff (`node tmp/openscad/oracle/analyze.mjs`) |
| `manifold_probe.py` → `manifold_probe.json` | second oracle (`uv run --offline tmp/openscad/oracle/manifold_probe.py`) |
| `probe/` | fragment edge cases, lenient semantics, modifiers, BOSL2 deps, snap gap |
| `real/openforge-bases/` (Apache-2.0, `real/PROVENANCE.md`), `run-real.sh`, `out-real/` | real-file timing CGAL vs fast-csg, deps file |
| `../review/r01…r05b*` | review probes of section 3.7 (Nef facet split, non-inscribed revolution, float32 fallback, `$preview` per export) |
| `../revise/csg-render.mjs` → `csg-render.json`, `runs/` | the 60 census trees re-dumped with `--render` (section 4.1) |
| `../revise/rerender/` | OpenSCAD's render of the render and preview trees of `cable_clip` and `gridfinity-rebuilt-bins` against the reference STLs |
