# Autodesk US11886165B2: generative design to editable, watertight B-rep

- **Kind / canonical URL:** granted US patent, [US11886165B2](https://patents.google.com/patent/US11886165B2/en) [P]; [official grant PDF](https://patentimages.storage.googleapis.com/7d/8c/63/b13ce21ceedc0c/US11886165.pdf) [PDF]. Read all 32 PDF pages, especially specification §§1–6 and the granted claims.
- **Authors / organization / dates — DOCUMENTED:** Autodesk Inc.; Martin Cvetanov Marinov, Peter Hugh Charrot, Suguru Furuta, Nandakumar Santhanam **and ten additional inventors**, not just the four names in the brief. US application 17/229,320 filed 2021-04-13; grant 2024-01-30; continuation of PCT/US2019/034221 filed 2019-05-28, claiming provisional priority 2018-11-09. [PDF, cover and pp.2–3](https://patentimages.storage.googleapis.com/7d/8c/63/b13ce21ceedc0c/US11886165.pdf).
- **License / status — DOCUMENTED:** patent disclosure, not an open-source license. Google lists Active and an adjusted expiration of 2040-08-09, explicitly disclaiming legal-status accuracy. Do not equate public disclosure or independently written Bend code with freedom to practice. Current enforceability, territorial family members and claim scope require a proper legal review; this note is technical, not legal advice. [P, legal status/timeline](https://patents.google.com/patent/US11886165B2/en).
- **Activity / maturity:** a granted 33-claim patent with worked diagrams, not a downloadable kernel, executable reference implementation, benchmark suite or public issue tracker. GitHub language/size/stars/contributors/last commit are not applicable. The specification cites the authors' 2019 paper, *Generative Design Conversion to Editable and Watertight Boundary Representation*, Computer-Aided Design 115:194–205; that paper was not independently read for this note. [PDF, references](https://patentimages.storage.googleapis.com/7d/8c/63/b13ce21ceedc0c/US11886165.pdf).

## What it is

**DOCUMENTED:** a conversion pipeline for a generative solver's mesh plus its known input B-reps. It retains exact residual input surfaces where appropriate, fits editable smooth surfaces only to newly generated material, then composes a watertight B-rep. The input solids are keep-in, keep-out or seed regions of the optimization domain. The motivating defect is reconstructed attachment holes or interfaces moving enough to cause interference even though the topology optimizer met its constraints; Figures 2–3 demonstrate this distinction. This is **not** presented as an exact mesh-Boolean-to-analytic-B-rep algorithm. [P, §§1–2; PDF pp.4–6,15,18](https://patents.google.com/patent/US11886165B2/en).

**Important correction — DOCUMENTED:** the incidence relation is principally **a set of input-solid identifiers per mesh vertex**, not a single exact source-face identifier per triangle. Vertices may represent multiple solids and may be displaced from the exact surfaces by the solver's discretization accuracy. Face-ID provenance for wonky is a useful stronger contract, but is our inference, not this patent's algorithm. [P, §§2.1–2.2](https://patents.google.com/patent/US11886165B2/en).

## How it works

### 1. Represent input intent and partition the mesh

**DOCUMENTED:** let M=(V,E,T) be a **closed 2-manifold triangle mesh** approximating the generative shape. Same-type overlapping input solids are first united; denote all input solids by {S_i}, their union by S, and their incidence relation by I:V→power-set({S_i}). The specification offers three ways to obtain I. [P, §§1–2.1](https://patents.google.com/patent/US11886165B2/en).

- **Level-set extraction:** label relevant grid corners g with I(g)={S_i : g∈S_i}, using ray/surface crossing parity; limit the tests to the extraction narrow band. Record erosion of seed material separately. A mesh vertex extracted from a cell receives the **union of the eight corner incidence sets**. Pure additive-organic cells carry no input-solid incidence.
- **Volumetric mesh:** attach input-solid identity to boundary vertices when sampling the original B-reps; preserve those attributes through optimization for surviving vertices. Added or eroded vertices do not inherit the same meaning.
- **Distance fallback:** given a known solver accuracy d>0, evaluate signed distance D_j with D_j(p)≤0 inside S_j and set I(v)={S_j : D_j(v)≤d}; there is special handling for points deep inside an eroded seed. A solid bounding hierarchy accelerates proximity searches. This is a tolerance-based association, not an exact surface-membership predicate. [P, §§2.1.1–2.1.3; Fig.5](https://patents.google.com/patent/US11886165B2/en).

**DOCUMENTED:** for triangle (a,b,c), if **all three** vertex incidence sets are nonempty, set I(T)=I(a)∪I(b)∪I(c); otherwise I(T)=∅ and call the entire triangle organic. In particular, this is a **union, not an intersection**, and the vertices need not share a unique face. Build each solid's incident triangle subset, then C=union of incident subsets and O=T\C. Organic connected components are found by edge-adjacency flood fill. [P, §§2.2–2.3](https://patents.google.com/patent/US11886165B2/en).

### 2. Repair the partition boundary, not the original solid

**DOCUMENTED:** the organic boundary B consists of mesh edges separating C from O. Vertices with more than two incident boundary edges are problematic. Reassign incident-region triangles adjacent to such vertices to O, recompute organic components, and iterate until the boundary is manifold. The termination argument is monotonic growth of O: in the worst case the whole mesh becomes organic. Trace the resulting degree-two boundary graph into closed polylines. Optionally remesh a two-ring boundary channel and apply surface-constrained averaging to reduce jaggedness and neighboring edge-length disparity without unrestricted shrinkage. [P, §§3.1–3.3; Figs.7–8,16](https://patents.google.com/patent/US11886165B2/en).

### 3. Construct editable organic surfaces

**DOCUMENTED:** one fitted T-spline/T-NURCC-type surface per organic component. Compute a principal-curvature-aligned cross-field and anisotropic size field; constrain approximately flat boundary vertices (interior angle between π/2 and 3π/2) to be regular and propagate boundary tangent directions into a channel. Construct a quantized integer-grid parameterization, derive a quad atlas, relax its inverse map, and fit an editable surface. The specification distinguishes (a) simple linear least-squares L2 fitting, which **does not bound maximum error**, (b) nonlinear L∞ fitting with local T-junction refinement where tolerance δ is exceeded, and (c) bounded boundary fitting with cheaper interior L2 fitting. An example sets δ to √3 times the level-set cell edge, not to machine epsilon. [P, §§4.1–4.4; PDF pp.21–22](https://patents.google.com/patent/US11886165B2/en).

### 4. Deliberately overlap, intersect, then compose

**DOCUMENTED:** fitting alone does not guarantee the organic boundary contacts S. For a boundary parameterized c(t)=Σ c_i B_i(t), define F(c)=max_t D(c(t)), where D is signed distance to S. Move boundary control points in the negative gradient direction until F≤ξ with **ξ<0**, putting the boundary safely inside S. Cached uniform parameter samples, spatial hierarchy and an approximate gradient using the normal at the control point's projected location reduce cost. This is a pragmatic numerical minimization, not interval certification of the continuous maximum. [P, §§5.1–5.2](https://patents.google.com/patent/US11886165B2/en).

**DOCUMENTED:** compute contact curves C=O∩∂S and require each to be homeomorphic to its original organic boundary. Start ξ at minus the intersection algorithm's accuracy tolerance; if the topology check fails, increase its magnitude (example: double) and resume pulling. Locally bisect/refine a problematic boundary if pulling stalls (example iteration cap: 100). A separate tolerant-modeling embodiment permits positive ξ=μ, with μ the kernel's supported gap tolerance, and constructs prescribed contact geometry rather than requiring a true intersection. These are **two different contracts**: intentional overlap with intersection versus tolerant coincidence. [P, §§5.2–5.4](https://patents.google.com/patent/US11886165B2/en).

**DOCUMENTED:** compose the organic sheets and original input solids by either oriented-sheet Boolean operations or a cellular decomposition. For the latter, surround them with a universe solid, split into path-connected volume cells bounded by organic/input surfaces, discard the outside-universe cell, and classify the rest. Keep-in/input containment and organic boundary orientations determine inside/outside; contradictory orientation evidence emits an invalid-input diagnostic rather than selecting a side silently. Union the inside cells. [P, §§6.1–6.2.2; Fig.13](https://patents.google.com/patent/US11886165B2/en).

### Claims are not the same as embodiments

**DOCUMENTED:** independent granted claims are **1 (method) and 19 (system)**. Claim 1 includes the generative-design input, incident/nonincident partition, globally smoothly parameterized editable surfaces, modified contact boundaries homeomorphic to their originals, and composition into a gap-free editable B-rep. It does **not** require every detail of the grid-incidence embodiment. Dependent claims add, among other things, distance incidence (5), partition repair (7), gradient pull and safety tolerance (10), cellular/Boolean composition (12), filling undersized gaps (14), and blends (15). There is no independent computer-readable-medium claim 18 in this issued grant. [PDF pp.29–32, claims 1–33](https://patentimages.storage.googleapis.com/7d/8c/63/b13ce21ceedc0c/US11886165.pdf).

## Robustness and guarantees

- **DOCUMENTED:** manifold-boundary repair has a monotone finite termination argument, but may sacrifice all exact-source regions. It is not a proof of faithful reconstruction. [P, §3.1](https://patents.google.com/patent/US11886165B2/en).
- **DOCUMENTED:** under bounded incidence and fitting errors d, the initial boundary distance is bounded by approximately 2d, motivating a similarly sized pull. Under the unconstrained L2 option, the initial distance is explicitly **unbounded**, with acceptability justified by practice. [P, §5.5](https://patents.google.com/patent/US11886165B2/en).
- **DOCUMENTED:** nominal watertightness depends on obtaining valid contact curves and composing them successfully. Near-coincident intersections can fail; tolerances are adapted. No IEEE scalar format, exact-predicate scheme, interval bound, certified isotopy algorithm or general proof of SSI success is given. [P, §§5.2–6](https://patents.google.com/patent/US11886165B2/en).
- **INFERRED:** preserving analytic support surfaces does not certify reconstructed trims, incidence, orientation or topology. Wonky must verify those separately; a watertight mesh is insufficient evidence of an exact B-rep. This distinction follows from the patent's own separate contact and composition stages. [P, §§5–6](https://patents.google.com/patent/US11886165B2/en).

## Parallelism and performance

**DOCUMENTED:** Fig.9 gives examples with genera 88 and 54, but no reproducible timings, hardware, speedup, memory figures or failure-rate corpus. The pull is said to converge in a few iterations typically, with local refinement when it stalls. Generic processor/multithreading paragraphs are not a parallel algorithm or benchmark. [P, §§4,5.2 and Fig.9](https://patents.google.com/patent/US11886165B2/en).

**INFERRED:** vertex incidence tests and per-component fitting can be partitioned; boundary repair is an iterative graph fixed point, global parameterization/least squares is coupled, and adaptive refinement produces irregular workloads. None maps automatically to uniform GPU call trees. [P, §§2–5](https://patents.google.com/patent/US11886165B2/en).

## Known failures, limitations, war stories

**DOCUMENTED, specification admissions rather than issue reports:** (1) sub-grid gaps between input solids may disappear in the generative solver; the proposed remedy expands the original B-reps to fill them, changing design geometry; (2) boundary pulling can stall on small segments; (3) high-curvature pulling can create self-intersections that break SSI, motivating fairing energy; (4) nearly coincident SSI may be incorrect; (5) generic fit/Boolean repair of the whole mesh is described as unreliable for preserving interfaces. There is no public issue tracker. [P, §§5.2–5.3; discussion of steps 1510–1515 and 1745; Figs.2–3](https://patents.google.com/patent/US11886165B2/en).

## Relevance for wonky

**INFERRED, high conceptual relevance but not a drop-in Boolean:** retain source intent through the approximate representation, distinguish exact inherited geometry from constructed geometry, and make contact topology an explicit validation product. For wonky's plane/cylinder union, all output faces may already have known analytic sources: direct face-provenance retention plus analytic surface-pair intersections is narrower than fitting organic surfaces and pulling them. Do **not** implement distance-based reassignment, smoothing or gap-filling as a silent fix for exact Boolean topology. [P, §§2,5–6](https://patents.google.com/patent/US11886165B2/en).

**INFERRED Bend design:** immutable U32 provenance lists/bitsets and sorted edge-adjacency arrays are natural. Express each repair round as map/reduce followed by a new partition, with explicit iteration and loss-of-source limits; components can be independent fork-join tasks. F32x2 is plausible for scaled distances, normals and analytic construction, but the source does not establish sufficient precision. Exact U32-limb predicates can certify discrete mesh decisions, not NURBS approximation or SSI root completeness. Keep dimensionless scale normalization, construction error, tessellation deviation, incidence tolerance and intersection tolerance distinct. Avoid the global cross-field/quad-fit dependency entirely for the initial analytic-only hybrid. [P, §§2–5, basis for these design inferences](https://patents.google.com/patent/US11886165B2/en).

**INFERRED testing / FDM / introspection:** add fixtures for one organic vertex in an otherwise incident triangle, multiple-solid vertex incidence, a four-way partition-boundary vertex, close separate holes, a seed eroded by the solver, near-tangent contacts and high-curvature self-intersections. Expose changed/reused support surfaces, changed trims, lost provenance, tolerance growth and reason for rejection in the viewer. Printed-interface fidelity is the useful motivation; a visually organic watertight surface is not interchangeable with a dimensionally exact mating hole. [P, Figs.3,5,7,12 and §§5.2–5.5](https://patents.google.com/patent/US11886165B2/en).

## Pointers worth porting or studying

- Study **§§2.1–2.2 / Fig.5** for provenance versus geometric proximity and the exact triangle-labeling rule.
- Study **§3.1 / Fig.7** for monotone manifold-partition repair and its worst-case loss of preserved geometry.
- Study **§§5.2–5.5 / Fig.12** for signed overlap margins, contact-loop checks, stalled pulls and error budgets; do not treat them as certified algorithms.
- Study **§6.2.2** for orientation-based cell classification with explicit inconsistent-input reporting.
- Review **claims 1,19 and relevant dependent claims**, not merely the abstract, before implementing a materially similar product pipeline. All section/figure pointers refer to the [full patent](https://patents.google.com/patent/US11886165B2/en).

## Verdict: learn-from

The best commercial analog in this batch for provenance-guided mesh/B-rep coexistence, with unusually concrete failure handling. It does not supply wonky's missing general curved Boolean or certified analytic reconstruction. Learn the separation of source identity, approximate geometry, contact topology and validation; do not copy its generative fitting/pulling pipeline as a ready-to-port module, and do not infer patent clearance from wonky's narrower use case.

## Sources and local evidence

- [Full patent, metadata, description and claims](https://patents.google.com/patent/US11886165B2/en).
- [Granted patent PDF, 32 pages](https://patentimages.storage.googleapis.com/7d/8c/63/b13ce21ceedc0c/US11886165.pdf).
- Local PDF: `<repo>/tmp/research/pdf/US11886165B2.pdf`.
- Local HTML and searchable transcription: `<repo>/tmp/research/commercial-kernels-2/US11886165B2.html` and `<repo>/tmp/research/commercial-kernels-2/US11886165B2.txt`.

