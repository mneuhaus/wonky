# Curv

- Kind: pure-functional language for F-Rep/SDF shapes. It compiles distance functions to GLSL for GPU sphere tracing and to C++ for "JIT" mesh export.
  - Original repo: https://github.com/curv3d/curv (**archived** 2023-09-27).
  - Canonical since then: https://codeberg.org/doug-moen/curv.
  - Site: https://curv3d.org.
- Clone read: `tmp/research/curv`, a shallow clone of the Codeberg origin at `4168cb9` (2026-09-02).
- Authors: Doug Moen (creator; 3,833 commits on GitHub). Maintainer is now Tim Ayres (@3DLirious; README "Current status"). Minor contributors: gsohler, lf94 (Lee Fallat), A-G-D.
- License: **Apache-2.0** (DOCUMENTED, `gh api`, `LICENSE`, file headers "Licensed under the Apache License, version 2.0").
  - Permissive. Porting ideas or code requires keeping the NOTICE and attribution. There is a patent grant.
  - Vendored `extern/` pieces carry their own licenses: libfive MPL-2.0, OpenVDB MPL-2.0 (Apache-2.0 in newer releases), dmc (rogrosso).
- Status (DOCUMENTED, 2026-09-22). **Not abandoned, but migrated**:
  - GitHub: 1,165 stars, 73 forks, archived. The final commit is "Curv has migrated to https://codeberg.org/doug-moen/curv".
  - Codeberg (`/api/v1/repos/doug-moen/curv`): 24 stars, 7 forks, 44 open issues, updated 2026-09-12.
  - Recent Codeberg commits: 2026-02 colour/stdlib work by 3DLirious, 2026-05 build fixes by Louis, 2026-09 "language ideas update" by Doug Moen.
  - Releases: 0.2 (2018-08), 0.3 (2018-09), 0.4 (2019-03), 0.5 (2021-09).
  - Core engine development has been essentially frozen since about 2021. The current work is library content (TPMS lattices, blends, colour maps) plus design notes in `ideas/` (INFERRED from the commit list and README).

## What it is

Curv is a dynamically typed, pure functional language (no side effects; files are "secure" shape documents) for 2D/3D F-Rep art and 3D printing.
- A shape is a record `make_shape {dist[x,y,z,t] = …, colour[x,y,z,t] = …, bbox = …, is_2d/is_3d}` (`docs/Theory.rst`, "Function Representation").
- The whole geometry library (`lib/curv/std.curv`, `lib.blend`, `lib.tpms`, `lib.builder`/`lib.sketch`) is written in Curv itself.
- Rendering is live GPU sphere tracing of the SDF in a fragment shader.
- Export: STL, OBJ and X3D (colour) via voxel meshing; PNG/GIF images. There is **no B-rep and no STEP**.

## How it works

### Two-stage evaluation (`docs/language/Shape_Compiler.rst`, `libcurv/sc_compiler.cc`)

1. A tree-walking **interpreter** (`libcurv/evaluator.cc` et al., double-precision `Num`) evaluates the program to a *shape value*: a record with closures `dist` and `colour`.
2. The **Shape Compiler** (SC) compiles those closures into GPU or CPU code.
   - It accepts only **SubCurv**: a statically typed subset with `bool`, `number` = **32-bit float**, `vec2/3/4`, and constant multi-dimensional arrays. **Recursion is not supported.**
   - Types are inferred bottom-up.
   - Implementation: abstract interpretation over the closure's operation tree. `sc_eval_*` emits SSA-style temporaries, and `sc_constify` / `sc_try_constify` folds everything not depending on `[x,y,z,t]`.
   - Broadcasting and elementwise ops are unified at compile time (`sc_try_broadcast`, `sc_try_unify`).
   - Targets (`SC_Target`): GLSL (`libcurv/glsl.cc` emits `dist(vec4)->float` and `colour(vec4)->vec3`) and C++ (`libcurv/io/cpp_program.cc`, `-Ojit`). The C++ is compiled by the system `c++`, which makes mesh export "30 times faster" (`docs/Mesh_Export.rst`).
3. **Parametric shapes**: parameters bound to GUI value pickers (sliders) are emitted as **uniform variables**, not constants (`glsl_function_export`). Tweaking a parameter re-renders without recompiling the shader.

### SDF model and operations (`docs/Theory.rst`)

- SDF classes:
  - exact (Euclidean);
  - approximate or "distance bound": must be Lipschitz-1, i.e. never overestimate;
  - "mitred": min/max boxes whose positive isosurfaces give mitred offsets.
- `union = min`, `intersection = max`, complement = negation. These are closed over approximate SDFs but **map exact SDFs to approximate ones**. Union is exact outside and on the boundary but not inside.
- `lipschitz k` declares a looser bound for bent or twisted fields, so the sphere tracer shrinks its step (`twist … >> lipschitz 2.2`).
- **Blends** (`lib.blend`; article `docs/articles/const_max_thickness_blends.rst`, Tim Ayres 2025-03-21): 14+ smooth-min kernels (IQ and Mercury `hg_sdf`: circular_geo, circular, quadratic, chamfer, stairs, columns …).
  - The article's key point: F-Rep blends are **"Constant Maximum Thickness"**. The blend thickness normal to the surfaces is constant, and the effective radius *varies with the angle between surfaces*.
  - B-rep fillets are "Constant Radius", with thickness varying. So SDF blends are *not* drop-in CAD fillets. The article's Table 1 compares kernels on rigidity, locality, conservativeness, associativity and cost.
- `lib.builder` / `lib.sketch` (`docs/Engineering.rst`): a CadQuery-inspired workplane/sketch API (`move_abs`, `spline`, `tangent_arc_point`, `close`, `extrude`) on top of SDFs.

### Meshing (`curv/mesher.h`, `curv/*_mesher.cc`, `docs/Mesh_Export.rst`, `issues/Meshing`)

- The voxel grid is `cellsize = vsize` or `cbrt(bbox_volume / vcount)`, with default `vcount = 100,000`, padded by 2 voxels. Infinite shapes are rejected with "mesh export: shape is infinite".
- `#smooth` (default): dense sampling into an OpenVDB `FloatGrid` level set, then `openvdb::tools::VolumeToMesh`. Per `issues/Meshing` this is "Neilson's DMC" (dual marching cubes).
  - Claimed "watertight, manifold, no self intersections", but **rounds sharp edges**.
- `#sharp`: libfive dual contouring with Curv as a libfive **Oracle** (`curv/libfive_mesher.cc`, `CurvOracle`).
  - Curv has **no interval arithmetic**, so `evalInterval` returns `[-inf, inf]`: libfive can never prune and subdivides everywhere.
  - Gradients come from forward finite differences with step `eps` (`evalFeatures`). Only one feature per point; "Points on sharp features may not be handled correctly".
- `#tmc`: rogrosso's DMC, "slow but very light".
- `#iso` / `#hybrid`: libfive's experimental meshers ("slow and not worthwhile").

## Robustness and guarantees

- Nothing is exact. The GPU evaluates in F32 and the interpreter in F64. Sphere tracing correctness depends on the user-declared Lipschitz bound. A wrong `lipschitz` value gives rendering holes, not an error (INFERRED from the `lipschitz` mechanism).
- Mesh quality depends on the algorithm:
  - `#smooth` is topologically clean but feature-rounding;
  - `#sharp` preserves features but "is not guaranteed to create a topologically correct mesh" (`docs/Mesh_Export.rst`). It produces self-intersections and spikes on "bent" fields (bend, twist, ellipsoid) because the finite-difference gradients are not surface normals (`issues/Meshing`, "Eliminating artifacts from #sharp meshing").
- `issues/Meshing` states it plainly: "Artifact-free #sharp meshing is seemingly an unsolved research problem."
- Mesh accuracy is controlled only by `vsize`. The rule of thumb is half the smallest feature or wall; otherwise "small details will disappear and holes will appear in thin walls". There is no certified deviation.

## Parallelism and performance

- Rendering: one monolithic fragment shader per shape. `ideas/v-rep/Hybrid.rst` documents the **performance cliff**: "Compiling a large F-Rep CSG tree into a single monolithic GPU kernel doesn't give good ray-tracing performance. Once the kernel gets too big, you run out of registers and overwhelm the instruction cache … you run off a performance cliff."
  - Proposed fixes: non-inlined per-leaf functions, then beam culling (a culling kernel producing leaf-id lists per screen tile, followed by a megakernel), i.e. a BVH over CSG leaves.
- OpenGL 3.3 only, because macOS blocks compute shaders. The WebGPU rewrite (issue #146, https://github.com/curv3d/curv/issues/146) never happened.
- Mesh export: `-Ojit` is about 30× faster than the interpreter (DOCUMENTED claim, `docs/Mesh_Export.rst`; issue #86). The default budget is about 1e5 voxels, and "1-2 million triangles is a practical upper limit for 3D printing".
- No measured benchmark tables were found.

## Known failures, limitations, war stories

- **Union seams** (issue #145, https://github.com/curv3d/curv/issues/145): `union[cube>>move[1,0,0], cube>>move[-1,0,0]]` exports with an internal seam under `#smooth`, although it is invisible in the viewer and in `show_dist`.
  - Doug Moen: "I do not fully grok why union seams appear". It is attributed to DMC vertex placement off the surface.
  - The workaround is `#sharp` or an overlapping or smooth union. This is exactly the face-coincident case CAD users hit constantly.
- **Bent fields** break `#sharp`: the shreks_donut, skull and twisted-cylinder artifacts (`issues/Meshing`).
- **No interval arithmetic**, so there is no pruning in meshing and no guaranteed ray hits (`ideas/v-rep/Ray_Tracing.rst`: "Interval arithmetic would be a powerful extension to Curv").
- Issue #118: exporting multiple disjoint meshes. Issue #149: bad GLTF export.
- The web front-ends from 2021 are "defunct" (README, 2024).
- **Architectural stall**: the language-core rewrite ideas (`ideas/Curv2.md`, `ideas/new_core`) and GPU pipeline plans (WebGPU, compute shaders, mTec-style pipelines) remain design documents. There is no route to exact or exportable CAD geometry (INFERRED).

## Relevance for wonky

1. **The architecture pattern is the relevant part**:
   - interpret a user language on the CPU into a *value*;
   - compile only a restricted, statically typed, recursion-free, F32 subset to GPU code, with constant folding of everything independent of the per-thread inputs;
   - lift UI-tweakable parameters to runtime uniforms.

   This is the same split wonky has: FeatureScript interpreted in JS; Bend kernels compiled to Metal with uniform work. SubCurv's restrictions (no recursion, fixed-size vectors, F32) are a good checklist of what a Bend→Metal "uniform kernel" subset must forbid (INFERRED).
2. **Parameter-as-uniform** maps to wonky's live preview. Parametric FeatureScript variables could be passed as kernel arguments instead of being recompiled into the kernel. It is cheap to adopt in the viewer and preview path.
3. **The performance-cliff war story** applies directly to Bend→Metal. One giant expression kernel spills registers. Partition the work: cull per tile or cell first, then evaluate small per-leaf kernels (same as Fidget/MPR tape pruning). This is relevant if the libfive-style SDF prototype is compiled to Metal.
4. **Negative lessons for the SDF bake-off**:
   - SDF plus voxel meshing yields either rounded edges (DMC) or self-intersections (DC).
   - Coincident-face unions produce seams (#145).
   - Blends are constant-thickness, not constant-radius.

   None of this meets wonky's "explicit tolerance, fail explicitly, exact B-rep/STEP" rules. It confirms that SDF can serve only as preview, offset or fallback, which is consistent with the brief's INFERRED expectation.
5. **Bend fit of the math**: min/max CSG, smooth-min blends and Lipschitz sphere tracing are all uniform F32 work, trivially fork-join/GPU. Curv adds nothing numerically beyond libfive/Fidget.
   - The one ergonomic idea worth borrowing: the explicit `lipschitz k` annotation as a *declared numeric contract* on a field, analogous to wonky requiring explicit tolerances on approximations (INFERRED).
6. **The blend article is a useful fillet-semantics reference.** It explains to users and LLMs why "SDF fillet" ≠ "CAD fillet", and gives the constant-radius vs constant-thickness comparison with figures (`docs/articles/const_max_thickness_blends.rst`).

## Pointers worth porting or studying

- `docs/language/Shape_Compiler.rst`: the SubCurv type system and restrictions.
- `libcurv/sc_compiler.cc`: `sc_eval_op`, `sc_constify`, `sc_try_broadcast`/`sc_try_unify` (compile-time type unification), `SC_Uniform_Variable` (parameters as uniforms).
- `libcurv/glsl.cc`: the `dist`/`colour` export contract. `libcurv/io/cpp_program.cc`: the CPU JIT path via a system compiler.
- `ideas/v-rep/Hybrid.rst`: megakernel register-cliff analysis and the beam-culling plan.
- `docs/Theory.rst`: exact / approximate / mitred SDF taxonomy and the Lipschitz contract.
- `docs/articles/const_max_thickness_blends.rst` and `lib/curv/lib/blend.curv`: the blend-kernel catalogue with properties.
- `curv/libfive_mesher.cc`: how *not* to plug into libfive (a `[-inf, inf]` interval oracle disables pruning).
- `issues/Meshing`: honest comparison of four mesh generators and their artifact classes.

## Verdict: learn-from

Curv validates the "pure functional language → restricted F32 GPU kernels" pipeline and contributes two directly reusable ideas: parameters as runtime uniforms, and avoiding the megakernel register cliff. Its geometry side offers wonky nothing to adopt: F32 SDF only, no interval arithmetic, meshing artifacts, no exact output.

The source list's "abandoned" status is inaccurate. The project moved to Codeberg and is lightly maintained, but its engine has stalled since 2021.
