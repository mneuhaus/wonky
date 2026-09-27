# Hoffmann, "Geometric and Solid Modeling: An Introduction" (1989), with Hoffmann and Vaněček, "Fundamental Techniques for Geometric and Solid Modeling" (Purdue TR 1991)

- Kind: book plus technical report.
  - **Book:** Christoph M. Hoffmann, *Geometric and Solid Modeling: An Introduction*, Morgan Kaufmann 1989. The online text is the 2nd printing (1992).
    - The author distributed it online ("The book is out of print. You may download the online version for personal use as prescribed by copyright law"; figures redrawn, otherwise unchanged).
    - The old page https://www.cs.purdue.edu/homes/cmh/distribution/books/geo.html now returns 404.
    - Archived with all chapter PDFs (front, chap1-7, bib): http://web.archive.org/web/20230815203555/https://www.cs.purdue.edu/homes/cmh/distribution/books/geo.html.
    - Local copies: tmp/research/pdf/hoffmann-1989-{front,chap3,chap4,chap5,chap6,chap7}.{pdf,txt}. Chapters 3-7 were read, with 3, 4 and 6 in depth.
  - **TR:** C. M. Hoffmann and G. Vaněček Jr., "Fundamental Techniques for Geometric and Solid Modeling", Purdue CSD-TR-91-044, June 1991.
    - Landing page: https://docs.lib.purdue.edu/cstech/885. PDF: https://www.cs.purdue.edu/cgvlab/www/resources/papers/Hoffmann-Ctrl_and_Dynamic-1991-Fundamental_Technique_for_Geo_and_Solid_Modeling.pdf (HTTP 200, 1.9 MB).
    - Also published in *Advances in Control and Dynamics* (C. T. Leondes, ed., Academic Press).
    - Local: tmp/research/pdf/hoffmann-1991-fundamental-techniques.pdf and hoffmann-1991.txt.
- Authors/organization: Christoph M. Hoffmann (Purdue), with George Vaněček Jr. on the TR. The book's foreword is by John Hopcroft.
- License:
  - The book is copyrighted and distributed by the author for personal use only. Do not redistribute the PDFs; quote sparingly.
  - The TR is on Purdue e-Pubs.
  - There is no code. The ideas and algorithms can be reimplemented freely.
- Status: historical, 1989-1992, and foundational. It is the reference text for the robustness problem in B-rep Booleans and for classical SSI tracing.
- **Correction to the research brief:** the 1991 TR is *not* a condensed version of the book. It covers:
  - the "B-rep index", a BSP-like spatial index over a B-rep for classification and collision;
  - the "dimensionality paradigm", surfaces defined by systems of equations in higher dimension, e.g. offsets and blends;
  - the skeleton (medial axis transform).
  - It says little about Boolean robustness and refers to the book's Chapter 4 for it. The robustness and SSI material is in book Chapters 3-6.

## What it is

- A textbook on implementing solid modelers:
  - Ch. 2: topology and validity of solids.
  - Ch. 3: Booleans on (non-manifold polyhedral) B-reps.
  - Ch. 4: robust and error-free geometric operations.
  - Ch. 5: curved edges and faces (implicit and parametric forms, conversions, edge identification).
  - Ch. 6: surface intersection (tracing, mapping to plane curves, desingularization).
  - Ch. 7: Gröbner bases.
- The TR adds three representation paradigms and their interrogation algorithms.

## How it works (the parts that matter)

### Ch. 3: Boolean on B-rep, organized for consistency

- Conceptual pipeline for A ∩ B with single shells (§3.4):
  1. Find intersecting face pairs via boxes.
  2. Intersect each pair and **analyze the 3D neighborhood immediately, posting the result to every adjacent face of A and B**.
  3. Find the faces of each solid that lie inside the other by adjacency exploration.
  4. Assemble.
  - If no faces intersect, a shell-containment test (line/solid classification) decides between four outcomes.
- §3.4.1, the key robustness rule (DOCUMENTED):
  - The popular "mark B's curves on A, then A's on B, then merge" algorithm decides every vertex/vertex incidence twice, with different arithmetic. Floating point then yields incompatible curve sets, so "this paradigm is also not robust".
  - Fix: "avoid asking the same geometric question more than once": every intersection fact is computed once and posted to all adjacent elements.
- §3.4.4, neighborhood analysis in six cases: face/face, edge/face, edge/edge, vertex/face, vertex/edge, vertex/vertex. Each has a generic and a degenerate subcase:
  - coplanar faces: same normal keeps the area, opposite normal drops it after regularization;
  - edge lying in a face;
  - collinear overlapping edges.
  - Transfers are decided by dot products of face-direction vectors against the other solid's normals ("volume-enclosing pair" tests).
- §3.7 face boxing: static interval tree, segment tree, and red-blue box intersection in O(n log² n + J).

### Ch. 4: robustness taxonomy

- Failure demonstrations in IEEE double (§4.2):
  - **Incidence asymmetry.** Take exactly representable lines with a2 = −(1 + 2⁻²³), c3 = c4 = −(1 + 2⁻¹⁵), and ε = 10⁻¹⁰.
    - u = L1 ∩ L2 = (1, 1) is "not on" L3 or L4: residual ≈ 3·10⁻⁵.
    - v = L3 ∩ L4 = (1.000030517578125, …) *is* "on" L1 and L2: residuals 0 and 7·10⁻¹².
    - So "u = v?" depends on which side computes.
  - **Incidence intransitivity.** A symmetric distance test with ε = 10⁻¹⁰ gives u ~ v and v ~ w but u ≁ w. The implied minimum feature size δ > 2ε is hard to derive once errors propagate.
  - **Topology violations.** A shallow-angle edge/face intersection is judged "near edge (w, w′)" from one face and "not near" from the adjacent face.
  - **Line-intersection conditioning.** Condition number κ ≈ 4/sin θ; a crossing angle of 2⁻ᵐ loses about m + 2 bits.
- **Exact rational arithmetic on a fixed grid (§4.3):**
  - Planes are ax + by + cz + d = 0 with integers |a|, |b|, |c| ≤ L and |d| ≤ L². All vertices and edges are symbolic, as plane intersections.
  - Booleans never create new planes, so there is no precision growth.
  - The only predicate is: point u = P1 ∩ P2 ∩ P3 against plane P4 = sign(J)·sign(D), where J is the 4x4 determinant of the four planes and D is the 3x3 determinant of the first three.
  - |J| ≤ 24·L⁵, so **5l + 5 bits** suffice (l = bits of L). The book's example L = 2⁴⁸ − 1 needs 245 bits.
- **Rigid motions (§4.3.3-4.3.5):**
  - A translation is exact iff |e| = |d + a·tx + b·ty + c·tz| ≤ L².
  - Rotations use rational points on the unit circle: u′ = (n² − m²)/(n² + m²), v′ = 2nm/(n² + m²), with m/n ≈ tan(θ/2).
  - Planes that fall off the grid are "element-rounded": best rational approximation with a bounded denominator via continued fractions (convergents and quasi-convergents, O(log Q) steps, error ≤ 1/(qQ)).
  - Warning: floating-point continued-fraction expansion of 0.123 drifts after 6 terms. Compare against the original at every step.
- **Object reconstruction (§4.3.5):**
  - Rounding can destroy small features. The example is the union of 150 random triangles, whose boundary has a 500x-magnified crack.
  - Remedy: move the *primitives* and replay the Booleans (CSG replay). Primitives should be trihedral, e.g. a parallelepiped has 24 "vertex below plane" consistency checks after motion, and a minimum feature separation is needed.
  - Topology may still change slightly (DOCUMENTED, §4.3.6).
- **Representation versus model (§4.4):**
  - A representation (symbolic plus numeric data) is *correct* only relative to a *model*: an exact object satisfying the symbolic data, ε-close to the numbers.
  - An operation is correct if for all input representations there are models Mi and an output model M with M = op(Mi), and the output is δ(ε)-close.
  - The intuitive "fuzz region" notion is mathematically defective.
  - Purely symbolic incidence data may be unrealizable (a Pascal-theorem configuration) or realizable only with irrational coordinates (a pentagram configuration: b⁴ − 2b² + b = 0, b = (±√5 ± 1)/2).
- **Three strategies (§4.4.2):**
  1. Restructure the algorithm so logically dependent decisions come from one computation. This is Ch. 3.
  2. Keep the symbolic data exact and perturb the numbers until they are consistent (Sugihara/Iri line).
  3. Alter the symbolic data or the meaning of elements, e.g. lines become monotone polylines (Milenkovic line).
  - Decision paradigm: a computed r with |r| < t(C) is "uncertain" and must be decided consistently with earlier decisions.
- **Polygon intersection (§4.4.4):** "overconstrained" edges contain vertices of the other polygon. Proposition: at least one edge is never overconstrained, which is why 2D intersection can always be made realizable.

### Ch. 5: curved edge identification (§5.7)

- An edge on a closed or singular carrier is not determined by its two vertices. Orient the carrier by t = ∇f × ∇g with the (left face, right face) order. Flip the order when the angle between the face normals is obtuse.
- The orientation reverses at singular points where the gradients are collinear. Hence the rule: **put a vertex at every singular point of an intersection curve that bounds the object**.
- Even with these conventions a B-rep can be globally ambiguous: a grooved torus intersected with a Cartesian-folium cylinder y³ + z³ − 6yz = 0 admits two different solids for the same tables.
- Disambiguation needs extra data: an auxiliary interior point per edge, or tangent directions at both vertices.
- Also in Ch. 5 (not detailed here): rational parameterization of conics and quadrics, cubics, monoids, and implicitization by resultants.

### Ch. 6: surface intersection

- **Numerical tracing (§6.2):**
  - Local Taylor approximant up to degree 3, capturing curvature and torsion, obtained by solving linear systems in the derivatives of f and g.
  - Adaptive step size, then Newton correction (SVD for the underdetermined step).
  - Fails at singular points, where ∇f ∥ ∇g.
- **Tracing in higher dimensions (§6.3):** e.g. param/param as 3 equations in 4 unknowns. The degrees stay low, which improves double-precision accuracy. The same formulation is used for offsets and blends.
- **Mapping to plane curves (§6.4):**
  - Substitution maps (put one surface's parameterization into the other's implicit form).
  - A **monoid construction**: repeated leading/trailing-term elimination in homogeneous F and G finds a surface in the ideal that is linear in one variable. Worked example: cylinder x² + (z + 1)² = 1 against sphere x² + y² + (z + 2)² = 4 gives the plane curve s⁴ + 4u²(v² − s²) = 0 with a node, which is the minimal degree.
  - Torus/ellipsoid through the monoid gives a degree-16 plane curve with extraneous factors of degree 2 and 6.
  - Projections after a random linear map succeed with probability 1 but add spurious singularities.
- **Desingularization (§6.5):** quadratic transformations that trace through singular points of plane curves.
- Remarks (§6.6): bicubic/bicubic gives a plane curve of degree 324; substitution in floating point is error-prone; starting points and singularities in higher dimension are open issues.

### TR 1991 highlights

- B-rep index: a tree of cutting planes over faces with an ε-thick "on" band. Two equivalent trees classify a point near two vertices differently when ε is too large relative to the feature separation (Fig. 15, DOCUMENTED).
- Newton-system collision heuristics: average mismatched contact points and give priority to reported contacts. The authors describe these as heuristics that "ameliorate robustness problems but do not completely eliminate them".
- Dimensionality paradigm: represent offsets, equal-distance surfaces and constant- or variable-radius blends exactly as systems of equations with auxiliary variables (footpoints), rather than by elimination. Exclude extraneous solutions with additional inequations. Interrogate by tracing, local approximants and curvature evaluation.

## Robustness and guarantees

- The grid-rational scheme (Ch. 4.3) is exact and provably consistent for *polyhedral* Booleans, with explicit bit bounds. Motions are approximate (element rounding) and reconstruction can change topology.
- Strategy 1 (single-decision posting) is heuristic but "increases perceptibly" the robustness. The book says it is "unlikely" to remove all failures (DOCUMENTED, §4.4.3).
- Tracing (Ch. 6) is numerical with no certification; it fails near singularities without the plane-curve desingularization machinery.

## Parallelism and performance

- No benchmark numbers of note.
- Complexities: box intersection O(n log² n + J); continued-fraction approximation O(log Q).
- The design is sequential and pointer-based, typical of 1989.

## Known failures, limitations, war stories

- The examples themselves are the war stories: incidence asymmetry and intransitivity, shallow-angle topology violations, continued-fraction drift, rounding cracks after rotation, and ambiguous curved B-reps.
- Curved Booleans are treated only conceptually. Ch. 3 is polyhedral, and the curved extension "necessitates additions to the algorithm" for singularities and precision (DOCUMENTED, Ch. 3 intro).

## Relevance for wonky

- **Imprint consistency:** wonky's Boolean (the analytic stage and the hybrid "mesh decides topology" stage) should follow Hoffmann's rule literally (INFERRED):
  - Each (edge of A, face of B) event and each (vertex, face) classification is computed once, keyed by its entity pair, and shared by every adjacent face.
  - Never recompute the same incidence per face.
  - In Bend this becomes a pure map from entity-pair keys to event records, built by a fork-join pass and then consumed. No mutation is needed.
  - It is also a natural provenance record: every new vertex names the entity pair that created it.
- **Bit budgets for exact predicates:**
  - The 5l + 5 bit rule for point-versus-plane via 4x4 determinants is the planning number for wonky's multi-limb U32 predicates (INFERRED).
  - F32x2 inputs are dyadic with about 48-bit mantissas but a wide exponent range. Quantizing construction inputs to a fixed grid (e.g. 2⁻²⁰ mm) would make l small and bounded and give fixed-size exact kernels, which fits uniform GPU work.
  - That is a design decision to take explicitly, with a documented tolerance, per project rules.
- **Transforms:**
  - FeatureScript transforms and patterns rotate faces by arbitrary angles, and exact rotated planes are generally not representable.
  - Options from §4.3: rational rotations (tan(θ/2) = m/n, exact for Pythagorean angles, approximate otherwise, with the error reported), or replaying the feature tree on transformed primitives.
  - wonky is code-driven, so replay is the default anyway (INFERRED).
- **Correctness contract:** the representation-versus-model definition is a good formal target for wonky's validity checks. The claim is: "there exists an exact solid, within δ of the stored numbers, whose topology equals the stored topology, and it equals op(inputs)". It matches the certified-deviation print mesh idea (INFERRED).
- **SSI and edges:**
  - Split every intersection curve at its singular points: tangent cylinders give crunodes (see the Wang-Goldman-Tu note).
  - Store edge orientation from the ordered face pair, and add disambiguating data (an interior point or end tangents) for closed or singular carriers. This matters for topology identity and diff: two edges with equal endpoints on one carrier must still differ.
  - This rule is live in wonky today (working tree, 2026-09-24). docs/proto-recover.md lists `steinmetz-intersect` and `steinmetz-union` as "unresolved: 2-carrier vertex (quartic)".
    - Recover builds every vertex as an intersection of three carriers. The Steinmetz crossing points are singular points of a two-carrier intersection curve, which is exactly the §5.7 case.
    - They need their own vertex constructor: the singular points of the curve, e.g. via Wang-Goldman-Tu Theorem 8 in [wang-goldman-tu-2003-enhancing-levin-s-method-for-computing-.md](wang-goldman-tu-2003-enhancing-levin-s-method-for-computing-.md).
    - The four edges meeting there need the §5.7 disambiguation, because each ellipse passes through both vertices (INFERRED).
- **Fillets:** the dimensionality paradigm is the classical background for defining rolling-ball blends as systems (surface, footpoints, radius) and tracing them. It is useful when wonky designs fillet surfaces that are not tori.
- **Bend fit:**
  - The principles are data-structure agnostic.
  - Box-pair search should become a sort-based or BVH fork-join pass instead of interval/segment trees.
  - Continued fractions and determinant predicates map directly to multi-limb integer code.

## Pointers worth porting or studying

- Book §3.4.1-3.4.4: the single-decision posting design and the six neighborhood cases with degenerate subcases, as a checklist for wonky's imprint stage.
- §4.2.2: the incidence asymmetry, intransitivity and topology violation examples. They make good regression tests for any tolerance-based code path.
- §4.3.1-4.3.2: the grid representation and the 5l + 5 bit bound.
- §4.3.3-4.3.4: rational rotation and continued-fraction element rounding, with the drift warning.
- §4.4: model-based correctness and the three robustness strategies.
- §5.7: edge orientation and disambiguation rules.
- §6.2: the degree-3 tracing approximant.
- §6.4.1: the monoid construction and the cylinder/sphere example (a small exact fixture with a known node at the origin).
- TR §IV: dimensionality paradigm for offsets and blends.

## Verdict: learn-from

- This is background and design doctrine, not a port target. Its polyhedral algorithms predate modern exact mesh Booleans, and its curved SSI methods are uncertified.
- Its robustness principles still decide wonky's architecture:
  - one decision per incidence, posted everywhere;
  - a fixed-grid exact arithmetic budget;
  - a model-based correctness definition;
  - vertices at curve singularities, with edge disambiguation.
- Adopt these as documented rules.
