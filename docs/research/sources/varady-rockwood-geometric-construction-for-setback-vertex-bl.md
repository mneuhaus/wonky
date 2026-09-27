# Várady & Rockwood, "Geometric construction for setback vertex blending" (CAD 1997)

- **Kind:** journal paper.
- **Canonical URL:** https://www.sciencedirect.com/science/article/abs/pii/S001044859600070X (DOI 10.1016/S0010-4485(96)00070-X). Paywalled.
- **Other URLs:**
  - SZTAKI record: https://eprints.sztaki.hu/1451/. "Full text not available from this repository." Local copy: `tmp/research/blend-papers/eprints_1451.html`.
  - Semantic Scholar: paperId `84c9ca710ed9d821a28a03978538dad36b3650d1` (`tmp/research/blend-papers/s2_vr.json`).
  - OpenAlex: `tmp/research/blend-papers/openalex_10.1016_S0010-4485_96_00070-X.json`.
- **Authors / organization:**
  - Tamás Várady: MTA SZTAKI Geometric Modelling Laboratory, Budapest.
  - Alyn P. Rockwood: at the time, Arizona State University (HEARSAY; affiliation not verified).
  - Predecessor: Várady & Rockwood, "Vertex blending based on the setback split", Mathematical Methods for Curves and Surfaces, Vanderbilt UP, 1995 (SZTAKI hub, DOCUMENTED as a bibliographic entry).
- **Venue:** Computer-Aided Design 29(6):413–425, 1997. OpenAlex counts 27 citations and Semantic Scholar 37 (2026-09-23). Closed access.
- **License:** © Elsevier. No code exists.
  - A related **patent**, US8004517B1 (Geomagic, now Hexagon Manufacturing Intelligence; inventors Edelsbrunner, Facello, Gloth, Terék, **Várady**; priority 2005-06-24), covers setback-type vertex blends inside reverse-engineered "surface structures". Its expiry is listed as **2027-12-17**. DOCUMENTED via https://patents.google.com/patent/US8004517B1/en.
  - INFERRED, not legal advice: this does not affect a private, non-commercial wonky. Check the claims before any commercial release before 2028.

## What it is

**Full text: unreachable.** The paper describes *setback vertex blends*. Where n edge blends meet at a vertex, each edge blend is stopped ("set back") some distance before the vertex, and the hole is filled by one multi-sided patch. Compared with letting the edge blends intersect or using a sphere, this gives smoother shapes and handles unequal radii and mixed convexity.

What is known about the content (the abstract as returned by search snippets of the publisher page; HEARSAY because the page itself was not loadable):

- "Vertex blends are represented by 2n-sided patches, though special cases may also arise with an odd number of sides."
- "Standard polynomial patches are combined according to the so-called setback split, which provides a natural structure to define vertex blends and offers free parameters to adjust the interior shape."
- "Setback vertex blends merge edge blends by broadening them at certain distances from the vertex. The steps to create setback vertex blends and the basic mathematical constraints to be satisfied are illustrated by the control frame construction, which follows a repeated chamfering strategy."
- The Semantic Scholar TLDR (machine-generated, HEARSAY) says the same thing: 2n-sided patches, odd special cases, free interior parameters.

## How it works, reconstructed from reachable primary sources

The paper's own construction (the setback split and the repeated-chamfering control frame) could not be read. The *setback vertex blend as used in production kernels* is documented in detail elsewhere. Sources: ACIS R10 Blending Component manual, http://www-isl.ece.arizona.edu/ACIS-docs/PDF/BLND/01CMP.PDF (local `tmp/research/pdf/acis-blnd-01cmp.pdf`), "Vertex Blends", "Setbacks", "Bulge Factor", "Vertex N-Sided Gregory Polygon Surface"; Parasolid FD §30.3.3; patent US8004517B1. All DOCUMENTED unless marked.

- **Boundary structure** (patent):
  - "a setback-type vertex blend has maximum of 2n-sides, where in the most general case n spring curves and n profile curves alternate."
  - "Spring curves represent common borders between primary faces and vertex blends, and they smoothly connect two previously computed longitudinal boundaries of corresponding two edge blends."
  - INFERRED reading: each blended edge contributes one *profile* (cross) side where its edge blend stops. Each primary face that touches the vertex contributes one *spring* side between the two neighbouring edge blends' spring curves.
  - With zero setback, the spring sides can shrink to points. For example, three equal plane/plane rounds meeting at a convex corner produce a spherical triangle: 3 profile arcs, and the spring sides collapse to the sphere's tangent points on the three planes.
- **Side count by convexity** (ACIS): "For a blended vertex of uniform convexity (its n edges are all convex or are all concave), the vertex blend face made will have n sides. If the blended vertex is not of uniform convexity, the blend face will have more than n sides; i.e., in addition to n cross edges, it will have one or more spring edges." This fits "2n in the general case, odd in special cases".
- **Setback geometry** (ACIS):
  - "The setback defines a plane which is normal to the edge through a point on the edge and set back from the edge end by the given distance. The intersection of the setback plane with the blend surface defines a curve", the **cross curve**. For a constant round it is a circular arc.
  - **Oblique setbacks**: a signed left-minus-right difference tilts the cross edge.
  - **No setback given**: intersect this blend's two spring curves with the adjacent blends' spring curves, take "the intersection point further from the blended vertex", and place the cross edge through it. This is the "smallest setback practical". A reflex neighbour gives only one side's point.
  - A user setback smaller than that minimum is overridden.
- **Autosetback heuristic** (ACIS):
  - Take the "average blend size" at the vertex.
  - For each edge, look at the clockwise and counter-clockwise neighbours, find the setback "that allows a spring curve of radius close to the average blend size", and take the larger of the two.
  - It treats the vertex as polyhedral (normals and tangents at the vertex) and never produces oblique setbacks.
  - It is valid only when the blend sizes are similar and non-zero, the angles are not near 0 or π, and the edges are not highly curved.
- **Surface choice** (ACIS):
  - "If no setbacks are specified, simple vertex blend surfaces will be made whenever possible (e.g., spheres, tori, etc.). Using autosetback precludes the creation of such simple surfaces, and an n-sided patch will always result."
  - The general surface is an **n-sided Gregory polygon surface** (`VBL_SURF`). It is used "when a sphere, torus, or rolling ball blend will not fit into the vertex region (for example, if all the blends that meet there are of different radii), or when setbacks are given".
  - For export it is approximated "by n four-sided bs3_surfaces".
  - A **bulge factor** in [0, 2] (default 1) changes only the interior fullness. 0 suits mixed convexity; >0 suits uniform convexity.
- **Parasolid constraints:**
  - Setbacks only when **all** edges at a vertex of valence ≥ 3 are blended. Not for chamfers.
  - "Specifying a zero setback on an edge ensures that no setback blending occurs on that edge", which differs from giving no information, where the kernel may choose a setback itself.
  - "The remaining gap is then patched smoothly by a collection of faces."
- **Setback sizing in reverse engineering** (patent): "the setback value sb1 is computed by taking into consideration the maximum width of edge features e2 and e3".
- **The "repeated chamfering" control frame** (INFERRED from the abstract wording only): the corner of the control polyhedron is cut repeatedly (chamfered) so that the patch control points line up with the edge blends' boundary control points at the setback. The mathematical constraints are the G¹ conditions along the profile and spring boundaries. The exact construction is in the paper and unknown here.

## Robustness and guarantees

- Unknown for the paper. Its abstract promises "basic mathematical constraints to be satisfied" (presumably tangent-plane continuity with the edge blends and the primaries) but no algorithmic guarantee. HEARSAY.
- In ACIS the n-sided patch is a Gregory-type surface, approximated for export. It has no exact analytic form. The bulge factor and setbacks are *shape* parameters, not correctness guarantees. DOCUMENTED.
- ACIS warns that oblique setbacks at mixed-convexity vertices or with very different radii "can lead to poor shapes for the vertex blend boundary (angles at vertices of the boundary must be less than pi)". DOCUMENTED.

## Parallelism and performance

Nothing documented. INFERRED Bend view:

- Vertex blends are independent per vertex, so fork-join over vertices works. Valence varies, so for uniform GPU work, group vertices by valence and convexity pattern.
- Patch evaluation at sample points (for meshing and deviation certificates) is uniform per sample.
- The control-frame construction is a handful of small linear solves per vertex, fine in F32x2.

## Known failures, limitations, war stories

- Vertex blends are where open kernels stop:
  - OCCT fills unequal-radius corners with approximate Plate/Coons surfaces (`ChFi3d_Builder_CnCrn.cxx`) and has analytic special cases only for spheres (`ChFiKPart_Sphere`) and a "rotule". See the OCCT fillet note.
  - monstertruck has "no setback/corner-patch logic" (monstertruck note).
  - Parasolid reports `PK_blend_fault_vertex_c` at vertices of valence ≥ 5 or certain 4-valent vertices unless every edge is blended (Parasolid note).
- A 2026 open kernel hit the same wall. ogeom-rs (Rust, Apache-2.0, created 2026-08-04, 1 star) issue #18, "two blends meeting at a vertex, and the N>3 setback, are still owed their corner" (closed 2026, opened 2026-08-26), https://github.com/gilbertorconde/ogeom-rs/issues/18:
  - The corner state "is computed and discarded".
  - The three-blend corner existed only as a test-side "box−sphere tool construction".
  - The plan fills the N>3 setback "via `fit_surface_grid`/`fill_boundary`", i.e. an approximated patch.

  DOCUMENTED (issue text).
- ACIS autosetback degrades with dissimilar radii, near-degenerate angles and curved edges. DOCUMENTED.

## Relevance for wonky

- **Where it plugs in:** the fillet tier, at vertices where two or more blended edges meet. It also matters for LLM ergonomics, because FS users rarely think about corners, so wonky must name the failing vertex.
- **First cut: the analytic subset, no setbacks (INFERRED):**
  - **Sphere corner:** a vertex whose incident faces are all planes, all blended edges have the *same* radius r, and uniform convexity. The corner is a sphere of radius r centred at `c`, where `n_i · c = d_i − r·s` for every incident plane i (s = ±1 by convexity).
    - For valence 3 this is a 3×3 linear solve and has a solution whenever the three normals are independent, i.e. at a genuine corner. The cross curves are great-circle arcs, one per blended edge, lying in the plane through `c` normal to that edge's cylinder axis.
    - For valence ≥ 4 the system is overdetermined. A sphere exists **iff** the n offset planes share one point, which is true for symmetric pyramids and false in general.
    - Decide solvability with an exact rank test on the plane coefficients (multi-limb integer determinants of the augmented matrix). Construct `c` in F32x2.
    - This matches Parasolid's documented output ("a piece of sphere at the vertex") and ACIS's "simple vertex blend surfaces … whenever possible".
  - Terminal vertices (one blended edge, capped by the third face) and bi-blend smooth chains need no vertex patch.
  - Everything else gets an explicit `FILLET_VERTEX_EDGES_COMPLICATED` / `UnsupportedVertexConfig{valence, radii, convexities}` failure: unequal radii, mixed convexity, n ≥ 4 without a common offset point, any non-planar incident face.
- **Later tier: setback n-sided patches.**
  - This is a deliberate scope increase. It needs a non-analytic surface type (Gregory or multi-sided Bézier / transfinite), B-spline STEP export (as ACIS does with n four-sided B-splines), and deviation certificates for meshing.
  - It fits wonky's rule "approximations need explicit tolerances" only if the patch is treated as *exact by definition*: the patch is the design intent and its control net is the model. No real surface is being approximated.
  - Setback defaults can reuse ACIS's documented "no setback = smallest practical from spring-curve intersections" rule, which is deterministic and explainable to an LLM.
- **FDM relevance:**
  - Printed boxes and enclosures have mostly 3-valent all-convex or all-concave vertices with one radius, so the sphere corner covers them.
  - Mixed-convexity corners (a filleted boss meeting a filleted floor) are common enough that the setback tier will eventually matter. INFERRED.
- **Precision:** the sphere-corner test and construction are linear. Rational plane coefficients give exact predicates with multi-limb integers; the centre and radius in F32x2 are ample for 0.01 mm features. INFERRED.

## Pointers worth porting or studying

- ACIS R10 Blending manual (see URL above), sections "Vertex Blends", "Setbacks", "Oblique Setbacks", "Automatic Setback Calculation", "No Setback Specified", "Bulge Factor", "Vertex N-Sided Gregory Polygon Surface", "Approximated Vertex Blend Surface", "Simple Vertex Blend" (Figs. 1-8 to 1-10, 1-36, 1-37).
- Parasolid FD §30.3.3 (setback semantics), §29.4.3 (three of three), §30.3.8 (vertex blending past sharp edges of opposite convexity).
- Patent US8004517B1: the 2n-sided structure, and setback sizing from neighbouring feature widths (Fig. 4.5 in the patent).
- OCCT `ChFiKPart_ComputeData_Sphere.cxx` and `ChFiKPart_ComputeData_Rotule.cxx` (analytic corners), `ChFi3d_Builder_CnCrn.cxx` (approximated n-corner). See the OCCT note.
- For the later tier, still to be read: Várady & Hoffmann 1998 "Vertex blending: problems and solutions" (MMCS II, pp. 501–527, not freely online per Purdue's catalogue https://cs.purdue.edu/cgvlab/www/publications/varady1998vertex); Terék & Várady 2009 "Setback vertex blends in digital shape reconstruction" (LNCS 5654, https://link.springer.com/chapter/10.1007/978-3-642-03596-8_21); Várady et al. 2001 I-patches (implicit n-sided, which suits the SDF prototype).

## Verdict: unreachable

The full text is closed, with no open copy found. The setback concept is well documented through ACIS, Parasolid and the Geomagic patent, and that documentation is enough to design wonky's corner policy. For now:

- ship analytic sphere corners;
- fail explicitly on every other vertex configuration;
- treat setback n-sided patches as a later, deliberate tier.

Retry the paper, and Várady–Hoffmann 1998, if library access becomes available before that tier starts.
