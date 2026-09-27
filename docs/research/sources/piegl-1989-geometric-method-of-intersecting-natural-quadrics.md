# Piegl 1989: "Geometric method of intersecting natural quadrics represented in trimmed surface form" (CAD 21(4))

- Kind: journal paper.
  - Canonical: https://doi.org/10.1016/0010-4485(89)90045-6.
  - Abstract page: https://www.sciencedirect.com/science/article/abs/pii/0010448589900456. It returns HTTP 403 to non-browser clients.
  - Semantic Scholar: paper 001781b5bd7618b8174820da8c6bb56da46c299c.
- Authors/organization: Les A. Piegl, 1989. He later co-authored *The NURBS Book* with W. Tiller.
- License and access:
  - Elsevier copyright. OpenAlex/Unpaywall report `oa_status: closed` with no repository copy, and no author copy was found by search.
  - The **full text was not read**. Porting ideas is legally unproblematic; there is no code.
- Status: historical. Computer-Aided Design 21(4), May 1989, pp. 201-212, with 41 references (Crossref).
  - Author affiliation: Department of Computer Science and Engineering, University of South Florida, Tampa (OpenAlex).
  - Cited-by counts: 24 (Crossref), 36 (OpenAlex), 40 (Semantic Scholar), queried 2026-09-23 and rechecked 2026-09-24. OpenAlex puts it in the top 10% of its cohort (FWCI 5.56).
  - Access rechecked 2026-09-24: OpenAlex `oa_status: closed`, `any_repository_has_fulltext: false`; Semantic Scholar `openAccessPdf.status: CLOSED`. A web search found no author copy.

## What it is

- Abstract (DOCUMENTED, ScienceDirect abstract via search snippet; Semantic Scholar's TLDR repeats it): "A purely geometric method for intersecting natural quadrics (plane, cone, cylinder and sphere) is presented, which supports the Boolean algorithm to intersect trimmed surfaces given in rational B-spline form. The advantages of the geometric approach are emphasized and all the important issues of the intersection process are described in detail."
- It is one of the classic "geometric approach" methods for natural quadrics. Wang, Goldman and Tu 2003 §1.2 list it with Miller 1987, Shene-Johnstone 1994 and Miller-Goldman 1995 as methods that "exploit special geometric properties of a special class of quadrics to yield robust procedures" (DOCUMENTED, tmp/research/pdf/wang-goldman-tu-2003-levin-enhanced.txt).
- Miller and Goldman 1992 (IEEE CG&A, "Using tangent balls to find plane sections of natural quadrics", local tmp/research/pdf/miller-TangentBalls.txt) cite it as an example of the third representation family (DOCUMENTED):
  - Family: "rational piecewise polynomial parameterizations (for example, nonuniform rational B-splines)".
  - Contrast: the algebraic approach (Levin, Sarraga) and the tagged "scalars, points and vectors" geometric approach (Miller).
  - Their remark on this family: "if the quadric is represented as a rational polynomial (or piecewise polynomial) parametric curve, we can easily represent the intersection as a curve in the parameter space of the quadric".

## How it works (from secondary sources only)

- Shao and Chen 2024 (J. Syst. Sci. Complexity, doi:10.1007/s11424-024-2519-3; local tmp/research/pdf/shao-chen-2024-trimmed-quadrics.txt, lines 81-85) summarize it as follows. This is DOCUMENTED secondary description, not verified against the full text: Piegl "distinguished eight enumerations for the intersection of a cylinder and a cone, among which two are conic intersection and the others are non-planar. For the non-planar case, he presented a tracing like algorithm to approximate the QSIC with a B-spline curve. However, it is unclear how does his method extend to all natural quadrics."
- Reconstruction from the abstract, the reference list and that summary (INFERRED):
  - Inputs are trimmed rational B-spline faces whose carriers are natural quadrics. The geometric parameters (axis point, axis direction, radius, half-angle) are known alongside the NURBS form.
  - Configurations are enumerated geometrically. For cylinder/cone there are eight cases, two of them conic. Conic outputs can be emitted exactly, because every conic is a rational quadratic B-spline (Piegl's 1987 conic/rational B-spline work is in the reference list).
  - Non-planar QSICs are traced and fitted with a B-spline, so they are approximations that leave the exact representation.
  - The curve is then placed in the (u, v) domains of both trimmed faces and clipped against their trimming loops. This is the "supports the Boolean algorithm for trimmed surfaces" part. Farouki 1987 (IBM J. Res. Dev. 31(3), trimmed-surface algorithms) and Casale 1987 (trimmed-patch solid modeling) are in the references.
- More citation contexts (Semantic Scholar citations API with `fields=contexts`, queried 2026-09-24; all secondary, so HEARSAY-grade about the method itself):
  - Miller and Goldman 1991 (ACM SMA, "Combining algebraic rigor with geometric robustness…"): "Piegl presents an approach based on a geometric construction for computing quadric surface intersection curves". They group it with "case-by-case geometric analysis" and with the papers that stress detecting conic sections.
  - A 2002 IEEE IV paper ("A novel algorithm on computing intersections of two surfaces of revolution based on spherical decomposition") "employs Piegl's geometric method in [Piegl'89] to compute" the intersection of two cylinders inside its decomposition. Each resulting piece has "two branches or one branch", and the paper then concatenates pieces at their endpoints.
  - A 2007 French thesis (wave-energy floating-body simulation) says geometric methods such as Piegl's "can be slow and suffer from a lack of robustness in finding loops and singularities" (translated).
  - Kim et al. 1997/98 (torus/sphere by configuration space) list "reliable geometric algorithms that can intersect two natural quadrics efficiently and robustly" and cite the Piegl paper among them. The reference numbering was not resolved.
- Correction to the research brief: the claim that the paper "shows how the conic is clipped to face bounds without leaving the exact representation" cannot be confirmed. The only detailed secondary account says the non-planar cases are approximated by B-spline fitting. Only the two conic cases are plausibly exact (INFERRED).

## Robustness and guarantees

Unknown, since the full text was not read. The "geometric approach" family generally claims better numerical stability than Levin-type algebraic methods for natural quadrics: fewer derived quantities, and decisions made on geometric parameters such as axis angles and distances. The guarantees are tolerance-based, not certified (Miller-Goldman 1992 intro, DOCUMENTED as their argument). Shao and Chen note the coverage gap (only cylinder/cone enumerated in detail).

## Parallelism and performance

Not available.

## Known failures, limitations, war stories

- Coverage is apparently limited to specific pairs, e.g. the eight cylinder/cone cases, and it is "unclear" how the method extends to all natural quadric pairs (Shao & Chen 2024).
- The non-planar QSIC becomes an approximate B-spline, so later Boolean steps operate on an approximation with a fitting tolerance (INFERRED from the same source).

## Relevance for wonky

- Low. wonky's analytic faces are planes, cylinders and cones with pcurves for STEP. The things this paper would contribute are better covered elsewhere:
  - **Case enumeration for cylinder/cone:**
    - Miller and Goldman 1995, conic detection for any two natural quadrics: [miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md](miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md).
    - Shene and Johnstone 1994: [shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md](shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md).
    - DLLP 2008 for the exact general case.
  - **Trimming the QSIC to face bounds:** Shao and Chen 2024 compute topologically correct intersection curves of two *trimmed* quadrics with tolerance control. That is the modern version of exactly the "FF plus trim" step: [shao-chen-2024-topologically-correct-intersection-curves-of-.md](shao-chen-2024-topologically-correct-intersection-curves-of-.md).
  - **Exact pcurves of conic sections on cylinders and cones:** a plane section of a cylinder in (θ, h) parameters is the sinusoid h = a·cosθ + b·sinθ + c, which is rational in t = tan(θ/2). This is standard and needs no paper (INFERRED).
- Design lesson that still applies (INFERRED): keep natural quadrics tagged with their geometric parameters, not only as NURBS, and do the special-case geometry first. wonky already does this; Piegl-Tiller's "recognize special surfaces first" rule is recorded in [patrikalakis-maekawa-cho-shape-interrogation-for-cad-cam-fre.md](patrikalakis-maekawa-cho-shape-interrogation-for-cad-cam-fre.md).
- Do **not** adopt "trace plus B-spline fit" for non-planar QSICs. wonky's rules require explicit tolerances, and exact or certified alternatives exist (DLLP, the ELM morphology check).
- Current wonky gap in the conic cases (checked in the working tree on 2026-09-24): `plane_cone` in `kernel/hybrid/recover/geom.bend` refuses:
  - the hyperbola ("curve type missing in the body format");
  - the parabola;
  - the oblique ellipse ("not implemented").
  - Only the axis-perpendicular circle is emitted.
  - These are exactly the "conic" cases that geometric natural-quadric methods emit exactly. Take the construction from Miller-Goldman 1995 or the tangent-ball paper (Miller-Goldman 1992), not from this unread paper. docs/hybrid-boolean-plan.md item 9 lists the plane/cone hyperbola (hex-nut) first among the open `Unresolved` cases (INFERRED mapping).

## Pointers worth porting or studying

- If the full text is ever obtained (library access), check:
  - the eight cylinder/cone configurations and the criteria that separate them;
  - how the curve is mapped into each trimmed face's parameter domain and clipped;
  - which tolerances are used.
- Crossref reference list for the lineage: Levin 1976/79, Sarraga 1983, Miller 1987/88, Farouki 1986/87, Casale 1987, Pratt 1986 and Barnhill 1987 SSI surveys, Piegl 1987 (rational B-spline curves and surfaces).

## Verdict: unreachable

- The full text is paywalled with no open copy, so only the abstract and secondary descriptions were read.
- The secondary evidence says the method covers limited pair types and approximates non-planar curves. Use Miller-Goldman 1995, DLLP 2008 and Shao-Chen 2024 instead. They are reachable and stronger.
