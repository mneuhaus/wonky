# CADmium

- Kind: product (browser parametric CAD: SvelteKit, three.js/Threlte and Tauri UI over a Rust/WASM library on top of the Truck B-rep kernel).
- URLs:
  - Canonical: https://github.com/CADmium-Co/CADmium
  - Launch post: https://mattferraro.dev/posts/cadmium (2024-05-21, saved at `tmp/research/cadmium/ferraro-post.html`)
  - HN: https://news.ycombinator.com/item?id=40428827 (669 points, 241 comments; saved at `tmp/research/cadmium/hn-40428827.json`)
  - Hackaday: https://hackaday.com/2024/05/23/cadmium-moves-cad-to-the-browser/
- Shallow clone: `tmp/research/cadmium/` (head `29e39ce4`, 2025-09-05).
- Authors: Matt Ferraro (270 commits) with `av8ta` (86), `dzervas` (16), `jbcpollak` (11) and 10 others (14 contributors). 2023-09 to 2024-06.
- License: Elastic License 2.0 (`LICENSE.md`); GitHub reports NOASSERTION.
  - Source-available, not OSI. It forbids offering the software "as a hosted or managed service". Derivative works are allowed otherwise, but wonky should treat it as study-only to keep lineage clean.
  - The README FAQ promised: "If you choose at some point to stop developing CADmium ... We would convert the license to MIT, GPL, or something similar." This did not happen before archiving (DOCUMENTED absence at head).
- Status: archived (`gh api`: `archived: true`). README: "This repo is inactive. No PRs or issues will be accepted." The post header: "This project is discontinued. The github repos are still available as archives, but no deployment is maintained". 1,635 stars, 74 forks, 404 commits, 86 PRs, 14 open issues.
  - Commits per month (`gh api`): 2023-09 19, 10 58, 11 16, 12 93; 2024-01 27, 02 17, 03 37, 04 43, 05 56, 06 36; then nothing until two README edits on 2025-09-05.
  - The last code commit was 2024-06-28 (`8d631dab`), five weeks after the HN launch.

## What it is
An attempt at "80% of the most common CAD use cases while doing less than 10% of the work" for hobbyists with 3D printers (README).
- The Rust crate `packages/cadmium` (about 7.7k lines) holds projects, workbenches, sketches with a constraint solver, extrusions (New/Add/Remove), and JSON `.cadmium` files.
- All solid geometry is Truck (`truck-modeling`, `truck-shapeops`, `truck-meshalgo`, `truck-stepio`, pinned at git rev `c84318b8dec`).
- The launch post is an influential landscape essay: OpenCascade is "the Pontiac Aztek of b-rep kernels", Truck is "the Rivian R3". It also argues for an append-only operation log as the single source of truth, spring-mass iterative sketch solving, and text formats for LLMs.

## How it works
- Extrude "New" is `Solid::from_extrusion` via Truck sweeps (`packages/cadmium/src/workbench.rs:350-363`).
- Extrude "Add" works around Truck's broken touching-solid union (DOCUMENTED, `extrusion.rs:271-310`, `workbench.rs:364-426`).
  - A hand-written `fuse` asserts that each solid has exactly one boundary and that there is exactly one coplanar face pair (`assert!(fusable_faces.len() == 1); // TODO: support the case where more than one is fusable`).
  - It removes both faces, concatenates the shells, and then has to "merge the two fusable faces together. This is complicated because one might be bigger than the other ... or they might overlap somewhat".
  - Failure prints "Failed to merge with OR" and silently keeps the unmerged solid. An earlier workaround, "this is some bullshit ... lengthen the extrusion a tiny bit, basically build in some buffer" (+0.001), is commented out.
- Extrude "Remove" (DOCUMENTED, `workbench.rs:428-487`, re-read 2026-09-24) calls `solid_and(existing, punch, 0.1)` (Truck's `truck_shapeops::and`) with the complement line `// punch.not();` commented out.
  - INFERRED: at the archived head this computes an intersection, not a difference, or it was left mid-change.
  - A failure prints "Failed to merge with AND" and keeps the original solid.
- Face references (DOCUMENTED, CADmium issue #98, https://github.com/CADmium-Co/CADmium/issues/98, "The referenced faces problem"): faces were referenced by index, which broke on sketch edits.
  - The proposed centroid-anchor scheme was criticised in-thread: "There's no way to 'fail'. ... all 3 extrusions will extrude the same face without producing any errors or warnings"; coincident centroids are ambiguous; moving geometry flips the selection.
  - It remained open (Notes.md: "simple indices aren't sufficient because the number of faces will change, and they are sorted by size").

## Robustness and guarantees
- None beyond Truck's. The Truck issues Ferraro filed (DOCUMENTED via `gh api search/issues ... author:MattFerraro`) are still open as of 2026-09-24:
  - #57 (2024-02-06): `or` returns `None` for two unit cubes touching face to face with offset 0.1. It works for overlap (z = 0.9) and for separation (z = 1.1), i.e. it fails exactly on the coplanar contact case. https://github.com/ricosjp/truck/issues/57
  - #53 (2023-12-21): support for chamfer and fillet. None existed at the time. Truck master now contains an experimental `truck-shapeops/src/fillet/` (`mod.rs` 19.6 kB, `experiment.rs` 49.2 kB, `tests.rs`), which the maintainer calls a prototype with numeric errors (see below).
  - #68 (2024-05-29): Booleans on a 100 mm cube and an r = 7 cylinder take "13 seconds of compute time on my M1 macbook air" (15 s for OR alone), with a tolerance argument of 1.0 or 0.2. https://github.com/ricosjp/truck/issues/68
  - #70 (2024-06-03): cylindrical mesh improvements.
  - #67 (2024-05-27): a collaboration request. Truck's maintainer answered: "truck is still young and immature" (ytanimura, 2024-05-28).
- What happened upstream after CADmium stopped (re-checked 2026-09-24, all five issues still open; Truck last pushed 2026-09-07):
  - #53: the maintainer wrote on 2024-11-18 that fillets were being implemented "with the aim of doing so by the middle of next year", from a NURBS prototype (`truck-shapeops/src/fillet/mod.rs`) with "still a lot of numeric errors". The plan was a more accurate internal structure, with NURBS only as the approximation for speed and STEP output. A 2026-04-05 comment points to the `monstertruck` fork's fillet engine instead (see sibling note `monstertruck-truck-fork-monstertruck-fillet-crate.md`; Truck itself: `truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md`).
  - #57: a community patch claimed on 2026-01-03 to fix the coplanar-touch `or` in a personal fork, reportedly with an LLM in about 20 minutes (HEARSAY, https://github.com/ricosjp/truck/issues/57). A 2026-04-05 comment names the root cause: two solids sharing an exact face have no transversal intersection curve, so the transversal intersection code returns `None` (also Truck #114). Nothing is merged upstream.
  - So the kernel gaps that stopped CADmium in mid-2024 were still open upstream more than two years later. INFERRED: waiting for the kernel was never a viable plan.

## Parallelism and performance
- Truck Booleans at 13-15 s for a cube/cylinder pair (truck #68) made interactive parametric editing impractical. INFERRED: this compounded the correctness gaps.

## Known failures, limitations, war stories
- Why it died is INFERRED; there is no postmortem (searched 2026-09-22; the post and README only say "discontinued" and "inactive"). The evidence:
  1. The kernel's union failed on touching solids, which every "Add" extrusion onto a face produces. The app shipped a one-face-pair splice with asserts instead.
  2. No fillets or chamfers existed in the kernel.
  3. Booleans took 10+ seconds.
  4. The topological naming problem was unsolved.
  5. The team was app developers ("This is our first project in Rust"; README Contributing asks for help with "Computational Geometry (patches to Truck)") with no kernel team.
  Activity peaked with the HN launch and stopped five weeks later.
- HN foreshadowing (HEARSAY): "Are boolean operations working yet?" (dvh). "Once Truck (and CADmium) lands stable fillets (surprisingly one of the hardest features to make stable)" (samwillis). "The top kernels in the industry have been in development for decades by armies of CAGD PhDs" (s1mon).

## Relevance for wonky
- Cautionary tale that matches wonky's strategy. An app on an immature hobby kernel dies at the first coplanar union, the first fillet, and the first 10-second Boolean. Wonky owns its kernel and puts Booleans and fillets first, which is the right priority. Touching and coplanar unions ("extrude Add onto a face") must be first-class bake-off cases, not edge cases: they are the most common FDM modeling operation.
- The Add/Remove code is a concrete anti-pattern list for wonky:
  - asserts on topology assumptions;
  - `println!` plus keeping the old solid on failure (silent failure);
  - commented-out geometric fudge (+0.001 lengthening);
  - a missing complement that turns subtract into intersect.
  Wonky's rules (explicit failure, explicit tolerances) exist precisely to prevent these.
- The #98 naming discussion supports wonky's provenance design. A reference scheme must be able to fail ("no way to fail" was the decisive criticism of centroid anchors). This matches remus's "evolution complete or explicitly unresolved" and keel's `Derivation` buckets.
- Launch-post ideas still relevant for LLM ergonomics: an append-only operation log as the source of truth, a JSON/text model format, and a CLI. Wonky's FeatureScript-as-code and diff/review viewer already go further.
- No algorithms to port. The sketch solver and UI are irrelevant to wonky's Bend kernel.

## Pointers worth porting or studying
- `README.md` (License FAQ and its unkept conversion promise), `Notes.md` (face-reference problem).
- `packages/cadmium/src/extrusion.rs:271-330` (`fuse` workaround), `packages/cadmium/src/workbench.rs:340-490` (Add/Remove over truck shapeops).
- CADmium issue #98 (referenced faces problem), truck issues #57, #68, #53, #67.
- https://mattferraro.dev/posts/cadmium (landscape essay; operation-log and text-format arguments).

## Verdict: learn-from
CADmium is a documented example of a promising CAD app stalling because its hobby kernel lacked robust coplanar Booleans, fillets and speed, and because no one on the team owned the kernel. Nothing to port (ELv2, thin app code). The lessons feed wonky's bake-off case list and error-contract rules.
