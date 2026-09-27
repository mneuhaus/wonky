# OpenSCAD prior art: interpreters, test corpora, backends

Status: research, 24 September 2026. Written by the architect from the
prior-art agent's machine-readable findings
(`tmp/openscad/prior-art/findings.json`), which left no Markdown report. The
labels and citations are the agent's; pinned URLs and file anchors are in the
JSON (`sources_markdown`, `repository_pins`). How the design uses this:
[design.md](design.md).

Labels: **MEASURED** (run locally, or counted from a pinned, non-truncated
repository tree), **READ** (primary docs, source, licence, paper), **INFERRED**
(recommendation). A project's own feature list is a claim, not a validation.
No code of any project was integrated; everything below is behavioural
knowledge for independently written tests.

## 1. Summary

1. **The test architecture already exists elsewhere** (INFERRED).
   ThingiCSG and Szalinski use real OpenSCAD to lower `.scad` into evaluated
   `.csg` trees and then test another implementation; scad123d does the same
   for B-rep reconstruction. wonky can separate interpreter bugs from Bend
   bugs the same way, while keeping its own independent `.scad` frontend as
   the product (READ arXiv 2405.12949v1 §3.2; szalinski README L49-72;
   scad123d README L57-62).
2. **Faceted first, intent as an explicit second mode; no automatic `$fn`
   threshold** (INFERRED). A hexagonal nut from `cylinder($fn = 6)` is
   intentionally polygonal; scad123d guesses by magnitude (below 20 =
   faceted) and admits that `.csg` cannot tell a global from a call-site
   `$fn`.
3. **Literal geometry is versioned** (MEASURED). The installed 2022.05.16
   truncates `$fn = 3.7` to 3 and `$fn = 6.9` to 6 cylinder segments; current
   upstream source uses `ceil` and would give 4 and 7 (READ
   `src/core/CurveDiscretizer.cc` L100-153 at 28fe66bc). Two independent
   probes agree (`tmp/openscad/prior-art/fractional-fn/results.json`,
   `fn-verification/results.json`).
4. **OpenSCAD's regression suite** at the pinned master has 577 `.scad`
   files under `tests/` (522 under `tests/data/scad/`) and 1,759 expected
   output files: 1,251 PNG, 241 CSG, 128 echo, 69 SVG, 39 AST and others
   (MEASURED tree count). These are files, not a CTest pass count.
5. **ThingiCSG is the best external geometry corpus** (READ): made for
   testing CSG engines; the paper used 83 inputs, the pinned repository has
   324 `.scad` files. Its root BSD-3-Clause does not relicense the original
   models.
6. **Thingi10K is meshes, CADPrompt is Python.** Neither is a `.scad`
   corpus. CADTalk and CADReview do use OpenSCAD, with synthetic or
   deliberately wrong programs and unclear dataset licences (READ).
7. **Manifold is a faster optional reference, not ground truth** (READ).
   Current OpenSCAD tests keep backend-specific expectations; current
   Manifold works in doubles (`MeshGL64`), so older "float32 only" warnings
   are historical.

## 2. OpenSCAD's own regression suite (MEASURED, READ)

- Pinned: `openscad/openscad` at `28fe66bcaf3e89239153cd16c34499c541d2841e`
  (23 September 2026). Counted from the non-truncated recursive tree; no
  build, configure or CTest run (`regression-inventory.json`).
- 2,517 files under `tests/`, 577 of them `.scad`; 629 `.scad` in the whole
  repository; 50 example files. Largest directories: `tests/data/scad/misc`
  115, `3D/issues` 79, `3D/features` 73, `2D/features` 36,
  `modulecache-tests` 33, `dxf` 30, `3D/misc` 26, `bugs` 21, `functions` 20,
  `experimental` 20.
- Expected outputs by suite: `dump` 167 and `dump-examples` 56 (evaluated
  `.csg`), `echo` 122, `astdump` 28, `throwntogether` 288 PNGs, export
  suites for STL, OFF, OBJ, 3MF, SVG, PDF, POV, and lazy-union variants.
- How the suite tests (READ `tests/CMakeLists.txt` L782-846, L848-870,
  L951-985): language lanes store AST dumps, evaluated `.csg`, expression
  terms and echo output; geometry lanes mostly compare rendered PNGs (not a
  solid-equivalence check); a few raw export goldens; an STL sanity test
  validates output rather than comparing with a stored solid.
- The test runner pins `OPENSCAD_FONT_PATH` to `tests/data/ttf`, because even
  identically named system Liberation fonts differ in glyph geometry (READ
  `tests/test_cmdline_tool.py` L11-16, L340-347).
- Licence (READ): OpenSCAD is GPL-2.0-or-later with a CGAL linking
  exception; `examples/COPYING-CC0.txt` makes the examples CC0, which does
  not extend to `tests/`. No test-wide permissive exception was found.
- Recommended adaptation (INFERRED): classify each file (language-only,
  geometry model, expected error, library fragment, manual, asset-dependent)
  before setting a denominator; start with primitive and special-variable
  semantics, scopes, include/use, children, echo, then flat CSG fixtures;
  store backend, version, flags and geometry metrics, not screenshots; keep
  golden generation separate from comparison; quarantine experimental and
  version-new files with an explicit minimum version.

## 3. Projects

| project | kind | licence (declared) | relevance for wonky |
|---|---|---|---|
| **scad123d / solid123d** (etjones) | real OpenSCAD evaluates `.scad` to `.csg`; Python + build123d/OCCT rebuild B-reps | MIT (OpenSCAD, OCCT separate) | closest analytic-importer prior art: independent language and geometry lanes, per-operation capability records, exact subcases of hull and Minkowski (ball Minkowski as offset, equal-radius sphere/cylinder hulls, two-sphere hull, polyhedral hull). **Counterexample** for wonky: mesh fallback for unsupported curved hulls, projections, surface and twist; magnitude-based `$fn` intent; low-`$fn` spheres delegated to OpenSCAD meshes. Its reference docs, not its README, list the fallbacks. |
| **buildSCAD** (smurfix) | independent PEG interpreter returning build123d/OCC solids | LGPL-3.0 | catalog of language traps; states it does not support `circle(r = 2, $fn = 6)` as a hexagon and leaves hull/minkowski out; deliberately diverges (delayed evaluation, unknown variables raise, `undef` as `None`); twist, scaled extrusion and `OPENSCADPATH` on its TODO; some tests skip topology checks |
| **BelfrySCAD openscad_cpp_evaluator** | independent AST-walking evaluator producing Manifold meshes | MIT | self-reports near-complete coverage (hull, minkowski, extrusions, roof, offset, surface, import, text); possible independent language oracle later, never a production dependency; own font handling differs |
| **openscad-wasm** | full Emscripten port of OpenSCAD | GPL-2.0 | not an independent oracle; useful as a design for a pinned virtual-filesystem manifest |
| **PythonSCAD** | OpenSCAD fork with Python | GPL-2.0 (+ CGAL exception) | same geometry engine; frontend/kernel separation prior art only |
| **JSCAD translator** (OpenJSCAD, scad-deserializer) | parses a subset and emits JSCAD mesh CSG | MIT | targets the 2011 API; no hull, minkowski or text in its dispatch; its resolution does not reproduce OpenSCAD's sphere rings |
| **BlocksCAD** | visual blocks + forked translator | GPL-3.0 (parts BSD/MIT/Apache) | adds hull and text through opentype.js; warns how translator forks drift from language semantics |
| **RapCAD** | independent SCAD-like CAD in C++/CGAL | GPL-3.0 | intentionally different semantics (mutable variables); a warning against equating syntax familiarity with compatibility |
| **ImplicitCAD / ExtOpenSCAD** | implicit/SDF CSG with a modified language | AGPL-3.0 | intentional extensions; implicit output never an exact B-rep; `circle`/`cylinder` do accept `$fn` |
| **punkfab openscad-occt** | minimal clean-room SCAD-style interpreter on OCCT | none found (treat as unknown) | lacks comprehensions, let, each, echo, assert, hull, minkowski, offset, import, text; `circle($fn >= 3)` becomes a real polygon |
| **tree-sitter-openscad** | incremental parser for editors | MIT | syntax edge cases, spans; not an evaluator |
| **alufers/openscad-parser** | TypeScript parser, formatter, symbols | MIT | AST and diagnostics design for a JS host |
| **timschmidt/openscad-rs** | typed Rust AST parser | MIT or Apache-2.0 | separates syntax diagnostics from execution; its exact-rational number tokens would not match OpenSCAD's doubles |
| **Michael-F-Bryan/scad-rs** | experimental Rust VM | MIT or Apache-2.0 | geometry enum empty at the pinned HEAD: not a geometry interpreter |
| **hhornbacher/node-scad-parser** | archived beta Nearley parser | Apache-2.0 (package.json) | historic parse cases only |
| **CadQuery / build123d importers** | native CAD formats | Apache-2.0 | not `.scad` interpreters; STL import cannot restore analytic intent |
| **scad-js** | TypeScript → OpenSCAD generator | MIT | the opposite direction; metamorphic test generation at most |

Lessons for wonky (INFERRED by the agent): keep an independent language lane
and geometry lane; record a capability per operation; recognize exact
analytic subcases explicitly and name every refusal; never accept a mesh or
SDF fallback as exact; never treat parser acceptance as modeling support.

## 4. Semantic design lessons (INFERRED from READ sources)

- **Two contracts.** Faceted preserves the exact versioned polygonal solid;
  intent changes the primitive semantics to ideal surfaces. An exact B-rep of
  a polygonal prism is exact in faceted mode without being a cylinder.
- **One fragment formula is not enough.** Cylinders and cones take the
  larger end radius; spheres have their own rings, phases and caps; facet
  orientation moves bounding boxes and Booleans, not only appearance (READ
  `src/core/primitives.cc` L59-65, L183-219, L258-302 at 28fe66bc).
- **Error envelopes are per primitive.** For a regular n-gon section with
  `x = 2π/n` the relative volume deficit is `1 − sin(x)/x` and the radial
  chord error `r(1 − cos(π/n))`. A curved cutter reverses the sign, and near
  contacts can change topology, so a single relative volume tolerance does
  not work for arbitrary CSG. scad123d's module header claims the exact
  volume is always above the faceted one; its generic test correctly says
  holes reverse the sign.
- **Refinement is not monotone** for a whole tree (n-gon orientation,
  topology, thin shells, call-site `$fn`); a global `-D $fn` override does
  not refine call-site values or literal polyhedra.
- **hull and minkowski need capability classes.** Faceted versions are
  polyhedral operations in Bend; intent versions have useful exact subcases,
  and everything else must refuse rather than being meshed by OpenSCAD or
  OCCT.
- **Language before geometry.** Immutable last-assignment scopes, `$`
  variables, `let`, include vs use, default bindings, `children`, list
  comprehensions, degree trig, `undef` and warnings each need observations
  from the real OpenSCAD.
- **Modifiers and context are semantic inputs.** `$preview`, `$t`, `!`, `%`,
  `#`, `*` select or hide geometry; references must record them.
- **Fonts are part of the input.** Freeze font files and the Fontconfig,
  FreeType and HarfBuzz versions; a missing font is a missing dependency, not
  a fallback glyph.
- **Assets need a manifest and a sandbox.** `include`, `import` and `surface`
  can read arbitrary paths; meshes and heightmaps have their own licences
  and may be invalid solids.
- **Keep indexed references and separate precision from semantics.** STL
  loses indexed topology; triangle order and raw hashes are not geometry
  equivalence.
- **Compare several measures.** Volume interval, bbox, two-sided surface
  distance, components, manifoldness, orientation and export round trips;
  volume alone hides a displaced or wrong body, image similarity is weaker
  still.

## 5. Manifold and the OpenSCAD backends (READ)

- Manifold is an Apache-2.0 manifold triangle-mesh Boolean library; its
  OpenSCAD integration is part of GPL OpenSCAD. It does not make primitives
  analytic.
- Author-reported speeds (PR #4533, March 2023, M1): `CSG.scad` with
  `$fn = 300`: about 50 s CGAL Nef, 2.8 s fast-csg, 0.8 s Manifold; a BOSL2
  offset3d/Minkowski example 4 min 31 s, 1 min 34 s and 4 s; 5 to 30× over
  fast-csg on selected workloads. Workload-specific, not a universal factor
  and not measured on Marc's machine.
- Lévy's 2024 ThingiCSG paper found Manifold fastest on its corpus but wrong
  on some dense and coplanar examples; that argues for correctness gates,
  not that those bugs persist.
- Current OpenSCAD tests keep separate expectations for Manifold (colors,
  winding repair, a thin-slice case, geometry CGAL cannot represent; no Nef3
  import in the Manifold lane) (`tests/CMakeLists.txt` L605-652).
- Current Manifold vectors and matrices are double; `MeshGL64` is the double
  API OpenSCAD uses (`include/manifold/common.h` L35-65,
  `src/geometry/manifold/ManifoldGeometry.cc` L105-133).
- Manifold rejects non-manifold input; STL re-import can lose manifoldness
  (its README recommends 3MF).
- Flags differ by version: current tests use `--backend=cgal|manifold`, old
  WASM examples `--enable=manifold`. Take flags from the pinned executable.
- Recommendation (INFERRED): keep the installed 2022.05.16 CGAL baseline; a
  separately approved, pinned Manifold-enabled OpenSCAD can be a throughput
  lane, with disagreements triaged. Because wonky's corefine is
  Manifold-inspired, CGAL adds algorithmic independence. Record frontend,
  evaluation, render/export and total time separately, with version,
  backend, threads and tessellation settings.
- Not done: no modern OpenSCAD installed, no Manifold run, no local speed
  ratio.

## 6. Corpora and benchmarks (READ, MEASURED where stated)

| corpus | what it is | licence | use for wonky |
|---|---|---|---|
| **ThingiCSG** (Lévy) | `.scad` plus evaluated `.csg` and meshes for CSG-engine testing; paper: 83 inputs (29 OpenSCAD examples, Les Hall tutorial, author regressions); pinned repo (f3626748): **324 `.scad`** (MiscThingiverse 220, Basic 41, OpenSCAD 30, Large 12, Presentation 12, BOSL2 8, QuickCSG 1), 11 `.csg`, 22 STL, 156 OFF (MEASURED) | root BSD-3-Clause for the project's own work; imported inputs keep their licences, MiscThingiverse without a per-file table | the target workflow exactly; start with Basic and self-contained OpenSCAD examples, then adversarial and community families; keep hard, coplanar and degenerate cases; freeze data and submodule commits |
| **Szalinski** (PLDI 2020) | 12,939 scraped Customizable Thingiverse files, 2,127 after filtering (unsupported features such as linear extrusion removed), primitive resolution capped at 25 | MIT tool; inputs keep their licences | methodology: stratified AST-size reporting, filtering statistics; the resolution cap changes semantics and must be a named variant; Hausdorff < 0.01 on the large corpus except 148 failures judged visually |
| **openscad-benchmark** (kintel) | geometry, preview and frame workloads with repeats and parameters | no root licence found | runner organization only; a fast wrong result is not a pass |
| **Thingi10K** | 10,000 meshes from 2,011 featured things; 9,956 STL | Apache-2.0 tooling; per-thing licences | later mesh-import robustness, not a language corpus |
| **CADTalk** (CVPR 2024) | 5,288 synthetic programs (4 × 1,322) + 45 real ones; 15 `.scad` in the pinned tree | MIT code; data rights unverified | small smoke tests after provenance review; keep synthetic and human strata apart |
| **CADReview** (ACL 2025) | program-image error variants; paper total 20,949 (17,334 / 2,000 / 1,615), public HF dataset 18,949 rows without the validation split (MEASURED via API) | no dataset licence found | mutation and negative tests after licence review; references must come from the exact tested source |
| **CADPrompt** (ICLR 2025) | 200 objects with Python programs, 0 `.scad` | no root licence | exclude |
| **redcathode/thingiverse-openscad** (HF) | 7,378 rows with Thingiverse id, creator, licence, source, synthetic prompt | card: CC-BY-NC-SA-4.0; per-design licence column | discovery pool with a per-item allowlist; NC and share-alike matter for a commercial user; deduplicate remixes |
| **adrlau/openscad-vision** (HF) | 1,963 rows of requests, OpenSCAD answers, images | none declared | discovery only |
| **P3D-Bench** (June 2026) | 1,003 text/image/assembly generation cases, OpenSCAD one output language | not established | evaluation ideas only |

Corpus tiers the agent recommends (INFERRED): **A** own and CC0 examples plus
upstream semantics; **B** licensed ThingiCSG and benchmarks; **C** community
and dataset sources only after a per-file licence and dependency audit.
Report family counts, file counts, executable units and the full distribution
of unsupported features separately.

## 7. Recommended packages of the agent (INFERRED)

- **P0** Freeze a versioned oracle and manifest contract first: source and
  dependency hashes, URLs, authors, licences, OpenSCAD version and hash,
  backend, flags, tessellation mode, fonts, environment, timeout, exit
  status, stderr, reference format and precision. Missing dependency,
  expected failure, timeout and invalid output are recorded apart from wonky
  failures.
- **P1** A test-only evaluated-`.csg` lane, separate from the language lane:
  OpenSCAD makes `.csg` and meshes, a Bend-backed adapter builds the `.csg`
  subset; separately, wonky's own frontend runs the original `.scad` and is
  compared on echoes and evaluated operations. The `.csg` adapter is not
  "full OpenSCAD support".
- **P2** Faceted primitives and bounded planar CSG first, pinned to
  2022.05.16 including fractional `$fn`; official small regressions plus
  ThingiCSG Basic; then 2D Booleans, extrusions, hull, Minkowski and assets
  in capability tiers.
- **P3** Intent mode qualified separately: analytic primitives with mode
  metadata, cases with known error envelopes first, then round cutters,
  grazing contact and exact hull/Minkowski subcases; named certified or
  unresolved outcomes; never intent from `$fn` size alone.
- **P4** Grow the corpus with provenance rather than headline counts.

The design adopts P0 to P4, with one change: the `.csg` lane is not a
separate adapter but wonky's own parser and evaluator restricted to literal
arguments, because `.csg` is valid OpenSCAD syntax ([design.md](design.md)
§4.1).

## 8. Open items

- The configured CTest count upstream is unknown; only the file inventory is
  reproducible.
- Alternative frontends were not installed or run; their pass rates,
  floating-point behaviour and font parity are unmeasured.
- Manifold's speed and its disagreements on Marc's models are unmeasured.
- Per-model licences and dependency closures remain to be audited for
  ThingiCSG community inputs, Szalinski inputs, CADTalk, CADReview and the HF
  datasets.
- The date of the `$fn` rounding change upstream was not found; the measured
  old binary and the pinned current source suffice to establish the split.
- No proof of intent-mode error bounds for arbitrary CSG, hull or Minkowski.

## 9. Artifacts

All under `tmp/openscad/prior-art/`: `findings.json` (profiles, 151 source
entries, 26 repository pins), `regression-inventory.json`,
`thingicsg-inventory.json`, `third-party-source-manifest.json`,
`fractional-fn/` and `fn-verification/` (local `$fn` probes),
`independent-verification.json` (second-pass check of paths, hashes and
counts, including the CADReview correction), `szalinski-paper.pdf`,
`worklog.json`.
