# Aetheris: brep-boolean-lessons.md

- Kind: design document inside an open-source C#/.NET CAD kernel. Primary URL https://github.com/yuechen-li-dev/Aetheris/blob/main/docs/development/architecture/kernel/brep-boolean-lessons.md (117 lines). Companion https://github.com/yuechen-li-dev/Aetheris/blob/main/docs/development/architecture/kernel/brep-surgery.md (93 lines). Read at commit `6708fc825501894684d91106eef88f45f052a2f3` (2026-09-22), clone in `tmp/research/aetheris-brep-boolean-lessons-md/repo`.
- Authors / years: Yuechen Li, solo developer (README: "developed solo by Yuechen Li"). Repo created 2026-02-25, pushed 2026-09-22. The README credits showcase art to "Claude 5 Sonnet" and "GPT-6 Astra" and says "Unlike most other vibe coded geometry kernel ..." (DOCUMENTED, https://github.com/yuechen-li-dev/Aetheris/blob/main/README.md), so this is an agent-assisted solo project (INFERRED).
- License: AGPL-3.0 (DOCUMENTED, https://github.com/yuechen-li-dev/Aetheris/blob/main/LICENSE). Porting implication: **ideas only, no code, no transliteration**. wonky is private and unlicensed, and AGPL code would force disclosure. Nothing below quotes code; only design statements from the docs.
- Status / activity: 6 stars and 1 fork (`gh api repos/yuechen-li-dev/Aetheris`, 2026-09-24), active daily. There are 1,939 commits, all from one account (`gh api .../contributors`), and the last push was 2026-09-24. The lessons doc was last changed 2026-08-18 (commit `add040c0`). The Boolean directory `Aetheris.Kernel.Core/Brep/Boolean/` was last touched 2026-09-23 (commit `1948100b`, message "holes."). `Aetheris.Kernel.Core` is about 52.5k lines of C# (`find ... -name '*.cs' | xargs cat | wc -l`). There are about 45 top-level projects (sheet metal, FEA, piping, surfacing, sculpture ...). The release is `2.0.0-preview.3` (README). Maturity: broad but shallow. Every Boolean is a recognized bounded family.

## What it is

A short, opinionated lessons document explaining why Aetheris *abandoned the general B-rep Boolean* in favour of **bounded topology recipes**: "The public Boolean names are compatibility vocabulary; they are not evidence that the kernel can infer arbitrary result topology" (DOCUMENTED, brep-boolean-lessons.md line 3-5). The kernel's Boolean dispatcher (`BrepBoolean.cs`, 2158 lines) recognizes a closed set of families and returns a typed `NotImplemented` rejection for everything else. The families are:

- box/cylinder through-hole and blind hole
- coaxial subtract stack (stepped holes, counterbore)
- coaxial countersink
- box/prism through-cut and polygonal prism through-cut
- cylinder open slot / keyway
- box mixed through-void
- orthogonal union

(DOCUMENTED by file names under `Aetheris.Kernel.Core/Brep/Boolean/` and by https://github.com/yuechen-li-dev/Aetheris/blob/main/docs/development/architecture/system/artifacts/archaeology-m6/current-paths.md: "admitted recognized family OR typed NotImplemented rejection").

## How it works

The pipeline stated in both docs is (DOCUMENTED, brep-boolean-lessons.md line 113-117 and brep-surgery.md):

```text
high-level intent -> recognized bounded recipe -> explicit BRep Surgery -> validation
```

- **Recognition** proves the configuration belongs to a family. For example, "a world-Z cylinder fully spans a box" (line 21-22).
- **Recipe**: a request object carries the root, the recognized descriptor, the tolerance, the feature identity and the composition history. The recipe states the *expected result topology before any editing*. For the through-hole that is "six surviving exterior faces, one inner circular loop on each planar support, one cylindrical wall, two rings, and a periodic seam" (line 24-27).
- **Surgery** is a low-level layer that only *realizes* caller-specified loops, faces and shells. It "does not recognize features, select Boolean families, interpret intersection curves, or decide which topology survives". It rejects:
  - missing edges, repeated directed uses and open chains (loop builder);
  - "any edge incidence other than two face-boundary uses" (shell assembler);
  - non-finite vertices.

  "No local epsilon is used by these topology-only operations" (DOCUMENTED, brep-surgery.md).
- **Validation** is structural plus STEP AP242 export *and reimport* for every recipe.
- **Intersection queries** (`IntersectionQuery`, `ClosestPointQuery`, `SignedSideQuery`, `ContactQuery`) are "evidence-only": "Numerical contact can tell a recipe where supports meet; it cannot decide loop roles, surviving trims, cavity intent, or accumulated-history admissibility" (DOCUMENTED, brep-surgery.md).
- **Tolerance**: an immutable `ToleranceContext {Linear = 1e-6, Angular = 1e-9, Relative = 1e-12}`, validated positive and finite, passed explicitly (DOCUMENTED, https://github.com/yuechen-li-dev/Aetheris/blob/main/Aetheris.Kernel.Core/Numerics/ToleranceContext.cs; read for facts only).
- **Semantic front end**: Firmament (a DSL) lowers to "AIR", a semantic IR (hole features, chamfer and fillet compilers for specific admitted junctions such as "the three positive, mutually incident box edges"). The recipes consume AIR rather than rediscovering intent from bodies. "Do not recognize a temporary tool body again when the semantic caller already knows the construction intent" (DOCUMENTED, lessons line 93; AIR file doc comments under `Aetheris.Kernel.Core/Air/`).

## Robustness and guarantees

- Guarantee model: **correct by admission**. Inside an admitted family the output topology is known in advance, so it cannot come back as a plausible wrong solid. Outside, the result is a typed rejection (`KernelResult<T>` with `KernelDiagnostic`; the server maps it to HTTP 422, test `UnsupportedBoolean_OnV1_ReturnsUnprocessableEntityWithDiagnosticEnvelope`) (DOCUMENTED, current-paths.md).
- "Do not treat numerical zero as proof of topological identity or intended contact." "Overlap and tangency are similarly topological events, not merely small distances. A zero-distance witness may mean intended contact, a non-manifold result, coincident support, or tolerance noise; the owning bounded family must decide" (DOCUMENTED, lessons lines 62, 92).
- Arithmetic is plain double with epsilons in recognition. There is no exact-predicate machinery: grepping `Aetheris.Kernel.Core` and `docs` for `orient3d`, `shewchuk`, "exact predicate" and "adaptive precision" finds nothing (DOCUMENTED by absence at the read commit).
- Honest about legacy seams: some "canonical legacy builders use historical coedge-sense conventions, while orthogonal merged rectangles can retain T-junction incidence" and a `CreateKnownLoopPreservingLegacySense` path exists that skips the endpoint-closure check (DOCUMENTED, lessons line 111, brep-surgery.md "M3 compatibility seams").

## Parallelism and performance

Not discussed in the lessons doc. The architecture is sequential .NET (NativeAOT host mentioned in the README). Irrelevant to wonky's GPU/fork-join model (INFERRED).

## Known failures, limitations, war stories

- **The stepped-hole cliff** (DOCUMENTED, lessons line 44-50; root-cause doc https://github.com/yuechen-li-dev/Aetheris/blob/main/docs/development/milestones/general/brep-boolean-stack-a0-stepped-root-cause.md):
  1. Through hole r=2 succeeds.
  2. Blind continuation r=3 depth 6 succeeds.
  3. Larger shallower blind r=4 depth 3 fails with `NotImplemented` / `HoleInterference`.

  The cause was a validator gate `composition.Holes.Count == 1`. Lesson: "Topology reconstruction complexity therefore depends on accumulated operation history, not only the current two bodies."
- **Generic CIR executor** experiment: mapping a Boolean expression tree recursively to `BrepBoolean` "succeeded only for families already supported below ... A generic syntax tree is a generic traversal mechanism; it does not create a generic topology reconstruction algorithm" (DOCUMENTED, line 56-58).
- **Rotated and conic tools**: "Rotating a cylinder or cone changes more than an axis value: support intersections, seam placement, parameter intervals, face splitting, and orientation all change" (DOCUMENTED, line 62). Rotated/conic regressions are kept as "permanent educational evidence".
- Limitation by design: an arbitrary two-body Boolean (for example an imported STEP body minus another) is only a "compatibility or experimental path"; expect rejection (DOCUMENTED, decision ladder item 6).
- **Supported subset versus deferred pile** (DOCUMENTED, https://github.com/yuechen-li-dev/Aetheris/blob/main/docs/development/milestones/general/boolean-deferred.md). The header says: "Central Boolean-family expansion is frozen unless real compatibility usage justifies a bounded family with an owner and migration plan."
  - Supported:
    - box − cylinder/cone, through and blind;
    - box − box blind pocket and through-slot;
    - box − single sphere cavity;
    - cylinder-root coaxial bores;
    - rotated cylinder through-hole;
    - independent world-Z multi-hole continuation;
    - prismatic through-cuts on a root with no prior subtract;
    - face-contact orthogonal unions.
  - Deferred:
    - rotated cone through-hole, and rotated blind cylinder or cone;
    - arbitrary-axis blind-hole chaining;
    - torus Booleans;
    - general add/intersect;
    - mixed analytic plus prismatic continuation;
    - multi-sphere chains;
    - "general BRep booleans".
  - The one named blocker is technical: rotated cone through-hole is deferred "due to a **section-curve representation mismatch in the builder/export path**". A plane cuts an oblique cone in an ellipse, parabola or hyperbola, and the recipe and exporter only had circle-shaped rings (INFERRED explanation). wonky's cone support will hit the same conic-section representation question.
- **Cost of one new family** (DOCUMENTED, the `air-region-x2…x13-side-hole-*` and `air-firmament-x4…x12-side-hole-*` milestone docs under `docs/development/milestones/general/`). Getting *one* controlled fixture to a closed shell and a STEP smoke test took 21 milestone documents:
  - The fixture is a radius-1 side hole entering the +X face of a 10 × 8 × 6 box and exiting at −X.
  - The steps each cleared one named blocker: face splitting, then exit loop insertion, then cut-wall attachment, then shell closure.
  - The final docs still disclaim "general side-hole support, arbitrary face/axis support, production Boolean fallback". A hole along X instead of Z is a new family.

  This is the practical price of "correct by admission". The recipe count grows with orientation × tool shape × history (INFERRED).

## Relevance for wonky

wonky's frontend is FeatureScript, so user intent often *is* available: `opExtrude` with REMOVE, a hole feature, a fillet on a named edge. Aetheris argues that when intent is known, a recipe that states the expected topology beats inferring topology from intersection fragments. That maps to wonky in three ways (all INFERRED):

1. **Fast path, not replacement.** wonky needs a general Boolean (FeatureScript `opBoolean` on arbitrary bodies), so Aetheris's "reject everything else" is not acceptable as the only path. It *is* a good design for a family-recognized fast path in front of the tagged-mesh hybrid. Through-holes, pockets, counterbores and prism cuts on planar/cylindrical supports are the bulk of real parts. They can emit exact analytic topology directly and be cross-checked against the general hybrid in the bake-off. Aetheris's side-hole saga shows the trap: define each family in the *tool's local frame*, admitting any axis that is perpendicular to a planar support, not in world axes. Otherwise every orientation becomes a new family. Also keep the fast path strictly optional: when a family rejects, the general hybrid runs, and the Boolean call never fails just because no family matched.
2. **Separate realization from decision.** Aetheris's Surgery layer (strict loop closure, exactly-two-uses shell assembly, finite vertices, no epsilon) is the right contract for wonky's final B-rep assembly after analytic recovery. Recovery decides, a pure validating assembler realizes, and both are expressible as pure functions in Bend.
3. **Evidence is not authority.** Intersection witnesses and near-zero distances must not directly become trims or topological identities. In wonky, exact multi-limb predicates *can* make "is zero" authoritative for the mesh stage. For the analytic recovery stage (F32x2 approximations), Aetheris's rule applies: a tolerance-level coincidence is a candidate that must be confirmed by a family or topology rule, and otherwise fails explicitly.

hypermesh (`sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md`) gives a concrete, mesh-level example of rule 3. A fuzzer found that it discarded a genuine intersection segment only because the segment's endpoints lay exactly on triangle boundaries. The fix: "Only a genuinely shared authored feature, proved by retained construction identity, is elided." Coincidence is confirmed by *identity* (which source planes and edges built the point), not by a numeric zero (DOCUMENTED there; the parallel is INFERRED).

Precision mapping: nothing to map. The doc is about topology authority, not arithmetic. Licensing: AGPL, so no code; the ideas are generic, well known in feature-based CAD, and free to use.

## Pointers worth porting or studying

- The six-step decision ladder (lessons line 76-87) as a template for wonky's operation routing.
- The rule "write the expected face/edge/loop graph first ... If those facts cannot be stated without inspecting arbitrary fragments and guessing their role, the proposed recipe is not bounded enough" (line 102-107). Use it as the acceptance test for any wonky fast-path family.
- The stepped-hole history cliff. Any family admission in wonky must be a function of accumulated history, so gate tests should include N ≥ 3 compositions.
- The Surgery validator set (closed loops, no repeated directed use, exactly two uses per edge, finite vertices) as wonky's minimum B-rep validity check. Add STEP export plus reimport as a test oracle.
- Do not study the C# source for porting. AGPL.

## Verdict: learn-from

Short, sharp, and correct about *why* general B-rep Booleans produce plausible wrong solids, and a useful pattern for an intent-driven fast path. It is not a general Boolean and it is AGPL, so it contributes ideas only.
