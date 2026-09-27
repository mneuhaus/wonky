# Wang & Nnaji 2005: Geometry-based semantic ID for persistent and interoperable reference in feature-based parametric modeling

- Kind: research paper. DOI: https://doi.org/10.1016/j.cad.2004.11.009. Author-hosted full text, all 13 pages read: https://msse.gatech.edu/publication/JCAD_PID_wang.pdf. Page references below are printed journal pages 1081-1093.
- Authors: Yan Wang and Bartholomew O. Nnaji, Center for e-Design, University of Pittsburgh. Received April 2004, accepted November 2004; Computer-Aided Design 37 (2005), 1081-1093.
- DOCUMENTED license: PDF says copyright 2004 Elsevier Ltd., all rights reserved. Public author hosting is not an open-source code license. No implementation repository or code license was supplied; reimplement concepts independently and cite the paper, do not assume its prose/figures are freely reusable.
- Maturity: historical research prototype integrated with Pro/Engineer Wildfire 2.0 through Pro/Toolkit, not a maintained downloadable kernel (Section 5.3). No stars, commit dates, contributors or modern releases applicable.

## What it is

DOCUMENTED: a semantic naming layer that identifies topological entities through more stable geometric supports and feature/assembly namespaces, plus a naming service that binds/resolves/updates those names. Importantly, it is MORE than 'edge = pair of face IDs': it separates unbounded surfaces, their intersection curves, trimmed faces/edges and extra branch-disambiguation data. Sections 3-5 of the author PDF above.

## How it works

### Geometric versus topological identity

DOCUMENTED: Section 3 introduces a parametric complex Euclidean space R^p × C^3 (written P^p C^3), distinguishes shape and relation parameters, and proposes continuity of unbounded geometry under parameter changes as a sufficient basis for boundary-representation variance/parametric families. The two-circle example extends real intersections into complex coordinates when real intersections disappear. This motivates preserving geometric reference meaning even when a bounded topological entity vanishes; it is not a numerical continuation implementation. Source: pp. 1084-1086, Figs. 5-6.

DOCUMENTED namespace hierarchy: assembly -> subassembly -> component -> feature -> entity. Prefixes localize allocation and reduce accidental renumbering after edits; feature subnamespaces can distinguish Profile and Trajectory. The authors distinguish implicit/intensional feature construction entities from evaluated explicit geometry. The system keeps geometric support identifiers rather than putting full coordinates into names. Source: Section 4.1, Fig. 7, p. 1086.

DOCUMENTED semantic construction:

- A face refers to a feature namespace, its unbounded support surface and its boundary surfaces.
- A curve refers to the two intersecting surfaces, plus disambiguators when they yield multiple curves.
- An edge refers to that curve, its bounding surfaces and, where needed, disambiguation at its endpoints.
- A point refers to three or more intersecting surfaces; vertices refer to points.
- Circles/spheres and other entities without intrinsic boundary may need added boundary entities.

The example has FACE(PROTRUSION(p1)::SURFACE(s1)-SURFACE(s2),SURFACE(s3),SURFACE(s4),SURFACE(s5)) and an edge on the intersection of s1/s2 bounded by s3/s5. The detailed grammar in Fig. 11 includes feature/surface/curve/point types and orientation/adaptation supplements. Sources: Section 4.2, pp. 1086-1089, Figs. 8 and 11.

### Multiple intersection branches: the real contribution beyond adjacency names

DOCUMENTED: two surfaces can generate two or more intersection components; a single component can be trimmed into several edges by the same boundary surfaces. Therefore neither a surface pair nor a pair-plus-boundary-set is necessarily unique. Fig. 10 covers plane/hyperboloid, plane/parabolic-cylinder, cubic-cylinder and torus cases. Source: pp. 1088-1089.

For implicit surfaces f=0, g=0 at point p, the paper defines D^k f=(d^k f/dx^k,d^k f/dy^k,d^k f/dz^k), a vector of pure derivatives, NOT the full kth derivative tensor. Orientation is I11(f,g,p)=grad(f)(p) × grad(g)(p). 'Adaptations' include I12=Df×D²g, I21=D²f×Dg, I22=D²f×D²g. Surface order must be retained: swapping f/g reverses first-order orientation. At tangency I11 may be zero. Sources: equations (3)-(8), pp. 1088-1089.

DOCUMENTED worked counterexample to first-order naming: plane z=0 with cubic cylinder x³-x-z=0 gives three parallel lines. The left and right branches have identical first-order direction [0,2,0]; second derivatives of the cubic distinguish them, [-6,0,0] versus [6,0,0]. If second order is insufficient the authors propose higher derivatives, and approximations for surfaces not conveniently implicit. This is not the same as merely sorting branches by current position. Source: Fig. 10(j), p. 1089.

### Updating names across reevaluation

DOCUMENTED service architecture: binding maps semantic IDs to system-dependent IDs/addresses; resolution retrieves entities; update maps old to new support surfaces and then curves/edges/points. Old surfaces can be kept and forwarded to latest surfaces; a feature's own parameter changes can preserve its support identity. The prototype relies on Pro/Engineer's native surface update mapping, a dependency that would have to be supplied by wonky provenance. Sources: Section 5.1, Fig. 12, pp. 1090-1091.

DOCUMENTED curve mapping: intersect each candidate branch with a chosen coordinate plane x=a, y=b or z=c to choose comparable points p and q. Define k-closeness (equation 9) as ||p-q|| + sum(i=1..k,j=1..k) ||Iij(f_old,g_old,p)-Iij(f_new,g_new,q)||. For k=0 it is positional distance. Construct an m-by-n table for m new versus n old branches, rank each row by closeness, and choose rank 1. On ties increase derivative order; multiple new rows may choose the same old branch, allowing a split. Edge closeness is the sum of the two endpoint curve-closenesses (equation 10). Sources: Section 5.2, pp. 1090-1091.

DOCUMENTED caching: Pro/Engineer stores virtual datum curves/points corresponding to surface intersections; later features reference those rather than repeatedly asking the naming server. Reevaluate virtual entities when supports move. Source: Section 5.3, p. 1091.

## Robustness and guarantees

DOCUMENTED: the paper proposes a continuity-based sufficient condition and demonstrates improved reference behavior on examples, but gives no certified floating-point error bounds, derivative normalization policy, tie epsilon or proof that k-closeness recovers user intent for arbitrary models. Implementation says most practical cases use only real Euclidean intersections and normally at most two curves. Complex-space theory must not be read as support for constructing physically nonexistent real B-rep edges. Sources: Sections 3, 5.2-5.3.

INFERRED key numerical weaknesses, derived directly from equations (3)-(10):

- Scaling an implicit equation f by a nonzero constant leaves its zero set unchanged but changes derivative-vector magnitudes; coordinate units likewise affect position and derivative terms differently. The unnormalized closeness sum is not a representation- or unit-invariant metric.
- Tangency collapses cross products, repeated/symmetric branches can tie, a chosen slicing plane can miss or multiply-intersect components, and endpoint ordering can change. No published bounded failure policy solves all these.
- Row-wise nearest matching is not a globally constrained one-to-one assignment. It intentionally permits splits but cannot by itself certify a complete split/merge lineage.

The plane/curve examples and continuity argument do not prove a universal robust SSI solver; arbitrary complex/projective continuation is far beyond the concrete naming mechanism. Source basis: Sections 3-5 and the explicit zero-vector/tie discussions.

## Parallelism and performance

DOCUMENTED: authors report name resolution O(d) and storage O(bd), defining d as namespace depth and b as maximum breadth in their description (p. 1087). They state O(k²) computation/storage for derivative/closeness matrices (p. 1091), typically k<4. No wall-clock timings, memory measurements, benchmark corpus or modern comparison are supplied. Do not promote those formulas into end-to-end matching costs.

INFERRED: explicitly materializing m-by-n branch comparisons and k-by-k derivative terms costs at least O(m*n*k²) term work, excluding SSI, sampling and surface evaluation; the paper's O(k²) alone hides candidate multiplicity. Independent pairs/derivatives suit fork-join; name lookup is a short tree walk. Uniform GPU kernels require bounded derivative order, type-bucketed analytic surfaces and fixed candidate tiles; unconstrained higher-order fallback is unsuitable. Source basis: Section 5.2's m-by-n construction.

## Known failures, limitations, war stories

DOCUMENTED historical examples: moving a cut in Pro/Engineer can make a later hole reference jump to another edge (Fig. 1); SolidWorks/Inventor reevaluate another feature example differently (Fig. 2). These describe then-current software, not current product defects. Fig. 13 shows the authors' virtual intersection references retaining the hole definition under similar edits. Source: pp. 1082, 1092.

DOCUMENTED explicit limitations: surface-pair ambiguity, equal first-order orientations, tangent zero vectors, multiple bounded edges on one curve, and dependency on native support-surface updates. No public tracker/test repository accompanies the paper. Source: Sections 4.2 and 5.

## Relevance for wonky

INFERRED, based on the cited mechanism: this fits the analytic-recovery half of the hybrid very well if implemented as provenance-rich SUPPORT references rather than sorted FACE references. A face can split into many trims while retaining one surface; provenance must distinguish support identity, intersection component, trim interval and oriented occurrence.

Suggested record structure: SurfaceRef{featureId, semanticRole, supportLineage}; IntersectionRef{orderedSurfaceRefs, componentEvidence}; EdgeRef{intersectionRef, endpointRefs/trimDomain, useOrientation}. Use canonical support order plus an explicit orientation correction; blindly sorting a pair loses the cross-product convention. Store boundary multiset/incidence when necessary, not only an unordered set. Namespace identities must survive insertion and feature renaming independently of their human-readable display labels.

Bend fit: U32 symbol tables, interned structured names and immutable update maps are straightforward. Planes/quadrics/cubics permit bounded F32x2 derivative evaluation and exact U32-limb sign predicates for suitable polynomial inputs. F32x2 is not an exact real/complex-number implementation, and multi-limb integers do not make roots or normalized normals rational. Normalize implicit representations, carry length/angle/derivative units, bound condition numbers, and make ambiguity/unsupported continuation explicit.

Do NOT replace component identity with 'branch k in current sorted order'. Branch order changes under crossing/tangency; use stored construction provenance and certified component continuation when available, otherwise return candidate sets with evidence. Likewise, do not silently substitute a virtual support curve for a user-selected finite edge: expose distinct query types and explain which reference survives topology disappearance. This directly improves LLM-facing reference diagnostics and diff explanations while respecting the real B-rep/FDM boundary.

## Pointers worth porting or studying

- Fig. 7 / Section 4.1: hierarchical naming domains.
- Fig. 8 / Section 4.2: support versus trim references.
- Fig. 10(j), equations (3)-(8): branch ambiguity and higher-order evidence.
- Fig. 11: structured name grammar, useful as a tagged AST rather than strings.
- Equations (9)-(10): matching heuristic and its representation-dependence pitfalls.
- Fig. 12 / Section 5.3: bind/resolve/update separation and virtual-geometry cache.
- Local PDF: <repo>/tmp/research/pdf/wang-nnaji-2005-semantic-id.pdf.

## Verdict: adapt

Adopt stable geometric-support provenance, structured namespaces and explicit branch/trim evidence. Adapt or replace the numerical matching heuristic; do not promise universal naming from adjacent face IDs, arbitrary branch indices, unnormalized gradients or complex-continuity rhetoric. Open work is designing deterministic, tolerance-aware component resolution for wonky's supported analytic surface pairs. No implementation or tests were run.

Sources:
- [Full author-hosted paper](https://msse.gatech.edu/publication/JCAD_PID_wang.pdf)
- [Journal DOI](https://doi.org/10.1016/j.cad.2004.11.009)

