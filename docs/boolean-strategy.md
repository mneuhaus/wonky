# Boolean strategy: established methods and the Bend implementation

Status: 22 September 2026. This is an architecture decision and comparison of
published methods with the present source, not a claim that the missing Boolean
construction has been implemented. Production geometry remains entirely in Bend.
Frozen r10b and its dependencies remain unchanged. No test or acceptance result
changes as a consequence of this document.

## Assessment

Analytic B-rep is appropriate for the requested editable CAD surfaces, STEP,
face/edge provenance and code-to-CAD inspection. The established algorithm family
is intersect, split, classify and assemble, with regularization/contact policy.
Our supporting intersections, classifiers, shared coedges and convex halfspace
clipping follow known geometric ideas. Current Bend code is our own new
implementation. It has not systematically ported a particular end-to-end
reference implementation, and is not a complete port of OCCT, CGAL, or another
published robust Boolean implementation. Operational error guards, F32x2 handling and
separate tolerance records are project-specific engineering and require evidence.

The implemented primitives are useful, but the present architecture is not yet
an operation-wide Boolean arrangement. Merely adding more local rejection rules
will not supply the missing shared event decisions, face partitions and shell
construction. The next integration milestone must produce actual closed solids.

## Primary reference architecture

Use the public [OCCT Boolean specification][occt] as the reference decomposition.
Its Intersection Part and Building Part share a data structure across General
Fuse, Boolean, Splitter and Section operators. It explicitly handles interactions
among vertices, edges and faces, shared/same-domain entities, ordered edge splits,
section edges, p-curves, split faces, solids and construction history.

The Bend implementation should introduce the corresponding explicit contracts:

1. One operation-scoped record of source entities, candidate intersections,
   accepted contacts, overlapping intervals, split parameters and identities.
   All incident faces consume the same decisions rather than independently
   deriving potentially contradictory roots or connections.
2. Separate numeric uncertainty and modeled tolerance. Retain original source
   geometry; generated output entities may need a declared representative point
   and bounded incidence errors on their associated curves/surfaces. A permitted
   contact does not become an exact-incidence claim. Reject competing or
   inconsistent associations, and bound accumulated allowances across operations.
3. A shared 3D curve and corresponding per-face parameter-space representation
   for each relevant boundary. Build face arrangements with orientation, holes,
   coincident boundaries and periodic seams. Primitive-specific analytic mappings
   can implement the first surface families; a universal NURBS solver is not
   required before the plane/cylinder case works.
4. Classify resulting regions/cells and assemble oriented connected shells with
   explicit empty/disconnected/contact outcomes. Construction records must retain
   source attribution through splits and merges; history alone is insufficient
   evidence for a correspondence between individual faces.

OCCT's tolerance model is a reference, not an instruction to enlarge tolerances
without bounds or modify frozen inputs. Its documented operations can generate
representative vertices and enlarge their tolerances. Our immutable input
snapshots are compatible with constructing separate output entities while
retaining the original evidence. The exact choice of representative, budget
propagation and ambiguity rules still needs an implemented/tested contract.

## What a port to Bend would involve

A bounded, coherent port is feasible in principle. An isolated translation of a
public Boolean entrypoint is insufficient: OCCT V7_8_1's
[`BRepAlgoAPI_Common`][occt-common] selects an operation and calls inherited build
machinery. Its [`BOPAlgo_PaveFiller`][occt-pavefiller] coordinates shared
interaction data and geometry tools; the
[`face builder`][occt-builderface] needs wire splitting, per-face geometric
classification and topology construction, while the
[`solid builder`][occt-buildersolid] needs shell splitting and solid
classification. These dependencies are part of the algorithm's contract.

For a selected plane/cylinder subset, a meaningful port unit therefore includes
the shared event representation, its decision rules, face partitioning, result
classification and shell construction. Existing Bend analytic primitives can
provide the restricted geometry backend. Porting code without these contracts
would leave the same missing construction stages behind.

Numerical behavior also needs deliberate translation. Our F32x2 arithmetic is
not IEEE binary64; reproducing C++ control flow with different arithmetic does
not reproduce its convergence, rounding or tolerance behavior. Reference cases,
degeneracies and repeated-operation validation must accompany the translation.
This source inspection is representative, not a complete dependency inventory
or a cost estimate.

A source-derived translation also carries license obligations. The inspected
OCCT files use LGPL 2.1 with the OCCT exception, or commercial terms. Rewriting
the source in Bend does not by itself remove those obligations. No production
source was copied during this review. The reviewed files and license texts are
preserved in `out/boolean-method-review/occt-port/`.

## Numerical methods

Use established robust-predicate methods where they apply. [Shewchuk's adaptive
predicates][shewchuk] combine a fast evaluation with extra precision when a
predicate is close to a decision boundary. They address specified orientation
and incircle/insphere determinants; they do not solve arbitrary curved-surface
intersection, import tolerance or shell assembly.

Our current expansions certify selected zero polynomial expressions within a
restricted exponent range. They are not a complete adaptive exact-sign kernel,
and current F32x2 construction guards are not certified interval bounds. Extend
or replace these components against published methods and independent oracles,
with explicit supported domains. Increasing fixed precision alone cannot decide
which distinct imported representations should share tolerant topology.

For comparison, [CGAL mesh corefinement][cgal] distinguishes exact predicates,
exact construction and the embedding of rounded output coordinates. It recommends
exact predicates and constructions for consecutive corefinement operations.
These guarantees concern supported polygon meshes, not automatically analytic
curves or approximate imported B-reps. [CGAL Nef polyhedra][nef] provide another
well-established exact polyhedral set representation, including non-manifold
sets and regularization; they do not directly supply curved CAD faces.

## First construction milestone

Implement clipping of a bounded planar/cylindrical B-rep by one plane using the
shared arrangement above. This is an established halfspace-clipping
specialization: the first P10/box operation can then use the box's six oriented
halfspaces. It must share the future general Boolean data model rather than
encode r10b part IDs or source-face indices.

Evidence already available: at z=68, one P10 ring has twelve edges; at
x=-92.79000091552734, two rings have four and eight edges. At y=4, sixteen face
results remain unresolved. Completing those contact cases still does not finish
face splitting, cap nesting or closed-shell construction.

Acceptance for the new clipping constructor should include real exported
solids, geometric incidence and orientation checks, independent STEP checks,
inside/outside and volume comparisons on controlled cases, holes and seams,
face/edge/vertex contacts, small perturbations, rigid transforms, idempotent cuts
and repeated clipping. Preserve explicit failure for unsupported cases.

## Reference kernels and applicability

OCCT is not the only useful source. Different implementations supply different
parts of the required behavior; implementation language or project age does not
establish a numerical robustness advantage.

| Reference | Geometry and useful lessons | Limits for a Bend port |
|---|---|---|
| [OCCT][occt] | Analytic/spline B-rep; shared interactions, tolerance-aware splitting, face/solid construction and history | Extensive geometry/topology dependencies; the public Boolean wrapper is not a portable standalone algorithm |
| [SolveSpace][solvespace-boolean] | Trimmed rational polynomial surfaces; relatively compact split/classify/retrim pipeline and UV classification | Some intersection trims are piecewise-linear approximations; generic intersections depend on chord tolerance; explicit coincident-surface detection is plane-only |
| [Truck][truck-integrate] | Parametric B-rep with retained source surfaces; curve organization, trim loops and face reconstruction in Rust | Mesh-assisted numerical intersection search; its documented Boolean scope is transverse surface intersections, with tangential cases unsupported |
| [CGAL corefinement][cgal] / [Nef][nef] | Exact-predicate/construction methods, shared mesh intersection edges, polyhedral sets and regularization | The reviewed Boolean packages operate on triangle meshes or polyhedral sets; they do not directly supply arbitrary curved CAD faces |
| [Manifold][manifold] | Triangle-mesh topology, consistently reused geometric decisions, symbolic tie-breaking and parallel broad phase | Requires tessellated curved input; its topology guarantee is not an analytic B-rep accuracy guarantee |

The SolveSpace review is pinned to
`cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84`. Its main surface Boolean pipeline is
readable as a whole, but it also depends on geometry utilities, mutable handles,
BSP trees, C++ `double` and application configuration. The general intersection
routine numerically marches along a surface intersection, with a chord tolerance
and a step limit. Its [own documentation][solvespace-limits] describes unsupported
intersections and tolerance-dependent failures. A port must preserve Wonky's
explicit failure for unknown classifications and cannot silently replace its
analytic trims with SolveSpace's approximate alternatives.

The Truck review is pinned to `8d03d8f7900d6aaff784d02092bf5126c1425749`.
It triangulates input shells to initialize intersection polylines, projects onto
the original surfaces using Newton iteration, and reconstructs parametric
trimmed faces. Approximate B-spline guide curves reference the original surface
pair: the result is not simply a triangle mesh, but the method is not a certified
exact analytic intersection solver either. Its [explicit transverse-only
scope][truck-scope] excludes the tangential/coincident cases that a general CAD
Boolean needs. The inspected path uses `f64`, a package-wide tolerance and
quantized point IDs; those choices cannot simply be relabeled as our numeric
contract.

For source-derived ports, SolveSpace is [GPLv3 or later][solvespace-license];
Truck and Manifold are [Apache-2.0][truck-license]
([Manifold license][manifold-license]). OCCT's inspected terms are described
above. The selected files' license obligations remain applicable to translated
code; this review itself adds no copied production implementation.

Recommendation: retain OCCT's shared interaction/building contract as the main
architecture reference. Use SolveSpace's trim-graph and classification stages
and Truck's parametric interfaces as smaller implementation references. Select
a coherent plane/cylinder subsystem against those contracts, retain our analytic
intersection primitives, and implement the entire path to a validated solid in
Bend. Use CGAL/Shewchuk for applicable numeric predicates and Manifold for
consistent topology decisions. Do not assemble incompatible tolerance policies
from several kernels. This is a reference-guided implementation plan, not an
already completed port or a switch of the production kernel.

No common workload, perturbation suite or performance benchmark was executed
against these candidates. This review establishes neither that a newer kernel
is generally more stable than OCCT nor that a Bend translation would be faster.

## Other representations

[Sampled level sets / SDF / voxels][openvdb] can support previews and approximate
checks; finite sampling and boundary reconstruction change precision and entity
correspondence. An unevaluated CSG tree is useful as an intermediate
representation but does not by itself produce an exportable evaluated B-rep.
Using an existing CAD kernel directly would change the user's explicit all-Bend
requirement and is not selected.

[Manifold's published design][manifold] provides a useful alternative lesson:
its topology is built from consistent dependent decisions over triangle meshes.
Its documented symbolic perturbation and output guarantees cannot be transferred
unchanged to tolerant analytic B-reps. Our display mesh can remain an independent
approximate diagnostic artifact; no production fallback is introduced.

Bend itself remains an experimental engineering choice. The current cache
benchmark establishes faster repeated startup, and native/Metal experiments
measure specific tasks. Neither establishes a production CAD advantage over an
established C++ kernel. Profile equivalent workloads before making such claims.

## References and inspection evidence

The implementation mapping is in
`out/boolean-method-review/implementation-review.md`. Public source snapshots,
URLs and SHA-256 values are in `out/boolean-method-review/sources.json`.
The pinned source reviews and their manifests are under
`out/boolean-method-review/occt-port/`, `out/boolean-method-review/solvespace/`
and `out/boolean-method-review/truck/`.
The local snapshots support this review; canonical documentation links follow.

[occt]: https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html
[occt-common]: https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BRepAlgoAPI/BRepAlgoAPI_Common.cxx
[occt-pavefiller]: https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPAlgo/BOPAlgo_PaveFiller.hxx
[occt-builderface]: https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPAlgo/BOPAlgo_BuilderFace.cxx
[occt-buildersolid]: https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPAlgo/BOPAlgo_BuilderSolid.cxx
[shewchuk]: https://www.cs.cmu.edu/~quake/robust.html
[cgal]: https://doc.cgal.org/latest/PMP_Boolean_operations/index.html
[nef]: https://doc.cgal.org/latest/Nef_3/index.html
[manifold]: https://github.com/elalish/manifold/wiki/Manifold-Library
[manifold-license]: https://github.com/elalish/manifold/blob/3ec2325b25cbc858755a0165dc03f600a7f40877/LICENSE
[solvespace-boolean]: https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/src/srf/boolean.cpp#L850-L898
[solvespace-limits]: https://github.com/solvespace/solvespace-web/blob/9e586628cc351b970d8ab434b6183d3d806ab644/ref.pl#L2278-L2289
[solvespace-license]: https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/README.md#L354-L356
[truck-integrate]: https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal/integrate/mod.rs#L55-L131
[truck-scope]: https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/lib.rs#L3-L9
[truck-license]: https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/Cargo.toml#L1-L8
[openvdb]: https://www.openvdb.org/documentation/doxygen/Composite_8h.html
