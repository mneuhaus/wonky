# Li, Yang & Jia 2026: Advances and challenges in surface–surface intersection computation — An overview

- Kind: survey paper. Computer-Aided Design 193, article 104039, April 2026 issue. OpenAlex gives 2026-02-06 as the online date. DOI https://doi.org/10.1016/j.cad.2026.104039
  - Publisher page: https://www.sciencedirect.com/science/article/pii/S0010448526000096
- Authors/org:
  - Kai Li, ORCID 0000-0001-7265-1767.
  - Jieyin Yang.
  - Xiaohong Jia, ORCID 0000-0001-6206-3216.

  All three are at the Academy of Mathematics and Systems Science, Chinese Academy of Sciences, and UCAS (DOCUMENTED, Crossref and OpenAlex). This group also produced the 2023 TOG topology-guaranteed B-spline SSI and the 2025 TOG hybrid Boolean and overlap papers.
- License: Elsevier subscription article (Crossref: Elsevier TDM user licence; Scopus `openaccess: 0`). Reading and summarizing are fine. There is no code.
- Status: new. 135 references and 0 citations as of 2026-09-23 (Crossref).

## Access (why this note is thin)

**The full text and the abstract were unreachable on 2026-09-23 (DOCUMENTED):**
- ScienceDirect returns a Cloudflare "Sorry, you have been blocked" page to curl (saved as `tmp/research/pdf/li-yang-jia-2026-elsevier.txt`) and HTTP 403 to WebFetch.
- The Elsevier article API needs an API key (401). The Scopus abstract endpoint returns only core data without the abstract.
- Crossref, OpenAlex and Semantic Scholar carry no abstract.
- Unpaywall and OpenAlex list no OA copy.
- No arXiv preprint was found (arXiv API search by title and author).
- **Re-checked 2026-09-24:**
  - OpenAlex (W7127987895) and Semantic Scholar (CorpusId 285416095, DBLP `journals/cad/LiYJ26`) still carry no abstract, no TLDR and no OA location.
  - A headless Chrome session got Elsevier's "There was a problem providing the content you requested" block page (reference a3ff2de96b1adbc8), not the article.
  - No further circumvention was attempted.

**What was available:**
- The complete Crossref reference list, 135 entries, saved as `tmp/research/pdf/li-yang-jia-2026-refs.txt`.
- The group's accessible related work.

**Correction (2026-09-24).** The earlier run quoted a search-engine sentence as the survey's abstract: challenges remain "in balancing computational efficiency, accuracy as well as topology correctness", and "most practical intersection algorithms fail to guarantee the correct topology ... under near-critical or other complicated relative positions".
- Those words are actually from the abstract of Yang, Jia & Yan 2023 TOG, "Topology Guaranteed B-Spline Surface/Surface Intersection" (DOCUMENTED, https://history.siggraph.org/learning/topology-guaranteed-b-spline-surface-surface-intersection-by-yang-jia-and-yan/).
- The search engine had attached them to the survey. They show the group's framing, but they are **not** evidence of the survey's content.
- The same 2023 abstract adds, DOCUMENTED:
  - "Even for the most successfully used commercial geometry engines ACIS ... some complicated intersection topology can still be a tough nut to crack".
  - The hard cases it names are cross intersections, isolated contact points, intersections along boundaries, contacts in different branches, and high-order contact along a curve.
  - It shows examples that "challenge the open-source geometry engine OCCT and the commercial engine ACIS".

## What it is

The most current SSI survey, from the most active SSI group. Its content below is **INFERRED from the reference list**, which Elsevier numeric style orders by first citation, so the order approximates the section structure.

## How it works: coverage map reconstructed from the 135 references (INFERRED)

1. **Motivation and applications.**
   - Booleans: Yang et al. 2025 TOG hybrid Boolean; see [yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md](yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md).
   - Isogeometric CAD/CAE (Upreti 2017), 5-axis CNC (Bo 2020/2022, Chichell 2024, Ponce-Vanegas 2023), collision of ellipsoids (Choi 2008, Jia 2011, Wang 2001), Kasik "Ten CAD challenges" 2005.
2. **Watertightness and trimming.**
   - Sederberg 2008 "Watertight trimmed NURBS", Urick 2019 "Watertight boolean operations", Shepherd 2022, Martin 2022, U-splines 2022.
   - Katz 1988 (genus of SSI curves), Wang 2025 CGF "Improving the watertightness of parametric SSI" (https://onlinelibrary.wiley.com/doi/10.1111/cgf.70298).
3. **Floating-point error analysis:** Shewchuk 1997 adaptive predicates, Higham 2002 and 2019 (probabilistic rounding), Barrio 2003 (rounding bound for polynomial evaluation). So the survey likely discusses a-priori error bounds for evaluating intersection equations.
4. **Classical general SSI families.**
   - Algebraic: Kriezis 1990; Jia 2022 CAD "matrix representations".
   - Lattice: Rossignac & Requicha 1987 piecewise-circular.
   - Subdivision and interval: de Figueiredo 1996 affine arithmetic, Teixeira 2008, Krishnamurthy 2008 GPU NURBS (see [krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md](krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md)).
   - Marching: Bajaj 1988, Barnhill 1990, Lee 2002.
   - Surveys: Patrikalakis 1990/1993/2002 (see [patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md](patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md)), Grandine 1997.
5. **Topology guarantees for general surfaces.**
   - Loop detection: Sederberg 1988/1989, Hohmeyer 1991, Ma 1998.
   - Krishnan-Manocha 1997 lower-dimensional formulation, Song 2004 linear perturbation, Hass 2007 coupled topology resolution and domain decomposition.
   - Shen 2012 homeomorphic approximation, Lin 2013 affine arithmetic on GPU, Park 2020 BVH with osculating toroidal patches, Marschner 2021 sum-of-squares geometry processing.
   - Recent: Cheng 2023 TOG "interval algebraic topology analysis", **Yang/Jia/Yan 2023 TOG "Topology guaranteed B-spline SSI"**, Bo 2025 (Visual Computer), Chen & Chen 2025 (matrix-representation tracing), Zhang 2025 CAGD "topology guaranteed and error controlled curve tracing".
6. **Special surface pairs.**
   - Quadrics: Levin 1976/1979, Farouki 1989, Wilf 1993, Wang/Joe/Goldman 2002 (plane cubics), Wang/Goldman/Tu 2003 (enhanced Levin), **Dupont et al. 2008 I-III**, Lazard et al. 2006 (QI), Tu/Wang/Mourrain 2009 (signature sequences), Shao & Chen 2023 (discriminants), **Shao & Chen 2024**.
   - Tori: Kim/Kim/Oh 1998, Jia 2013 ring tori.
   - Ellipsoids: Jia 2020 TOG, Chu 2025.
   - Dupin cyclides: Yao 2022.
   - See [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md), [qi-quadric-intersection-library-loria-gamble.md](qi-quadric-intersection-library-loria-gamble.md), [shao-chen-2024-topologically-correct-intersection-curves-of-.md](shao-chen-2024-topologically-correct-intersection-curves-of-.md) and [li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md](li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md).
7. **Self-intersection:** Thomassen 2005 (approximate implicitization), Galligo 2006, Busé 2008 (Bezoutians), Pekerman 2008, Elber 2009, Jia 2009 and 2022 TOG (singularities via moving planes), Huang 2011, Pérez-Díaz 2015, Hong 2019, Park 2021, Li 2025 TOG (NURBS self-intersections).
8. **Algebraic and numeric toolbox.**
   - Mudur 1984 interval methods, Sherbrooke & Patrikalakis 1993 (projected polyhedron solver), Kerber 2012 and Jin 2021 (complexity of curve topology), Dixon 1908 resultant.
   - Implicitization: Buchberger/Cox Gröbner, Sederberg & Chen 1995 moving curves/surfaces, Chen 2005 μ-bases, Busé, Lai and Shen moving planes/quadrics 2016-2022.
9. **Degenerate configurations:** Bartoň/Elber/Hanniel 2010 no-loop tests, Hu 1997 robust interval SSI, curve/surface coincidence (Vlachkova 2017/2023), **Yang & Jia 2025 TOG overlap region extraction**, Farouki 2018 reduced difference polynomials.
10. **Industrial and mesh context:** Open Cascade SAS 2024, Spatial (ACIS) 2024, Biermann 2001 approximate Booleans, Wang 2011, Cherchi 2020/2022 mesh arrangements and Booleans (see [cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md](cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md) and [cherchi-pellacini-attene-livesu-2022-interactive-and-robust-.md](cherchi-pellacini-attene-livesu-2022-interactive-and-robust-.md)).

### Group work that was accessible (DOCUMENTED from local slides)

**Yang/Jia/Yan 2023 TOG (https://doi.org/10.1145/3618349; `tmp/research/pdf/yang2023-ssi-topology-slides.pdf`):**
- Pipeline:
  1. box test;
  2. implicitize one rational patch with *moving planes* and a *Dixon matrix* (`F = det D_{u,v}(d·x − a·w, d·y − b·w, d·z − c·w)`);
  3. substitute the other patch, giving a plane algebraic curve g(s,t) = 0;
  4. topology from the critical points of `R(s) = Res_t(g, ∂g/∂t)` plus boundary points;
  5. parallel tracing;
  6. clip to the first patch's domain using Dixon-matrix inversion (`D(X0)·L(u,v) = 0`).
- Claimed handled cases: crossing singularities, tangent points, boundary intersections, tangent curves, high-order contact, isolated points.
- Compared against OCCT, ACIS, SISL, interactive mesh Booleans and AA-GPU.
- Stated limitation: "computation efficiency".

**Yang & Jia 2025 TOG overlap extraction (`tmp/research/pdf/yang2025-overlap-slides.pdf`):**
- Tolerance-based overlap `O1 = {(u,v) : min_{s,t} ‖r1(u,v) − r2(s,t)‖ ≤ ε}`.
- Boundary found by bilevel optimization.
- Triangulation-based boundary region estimation, then a signed ±ε branch split via `(r1 − r2)·n2`, then Delaunay-based boundary topology and refinement.
- Explicitly floating-point.

## Robustness and guarantees

Unknown for the survey itself. The reference list suggests the survey frames robustness along three axes (INFERRED):
1. Exact or certified topology: algebraic classification and topology of the projected curve.
2. Error-bounded geometry: the rounding-error literature and "error controlled tracing".
3. Watertightness of the final B-rep: Sederberg, Urick and Wang 2025.

## Parallelism and performance

No data from the survey. The group's own methods trace in parallel after the topology stage (2023 slides) and name efficiency as the main limitation. GPU SSI (Krishnamurthy 2008, Lin 2013) is cited.

## Known failures, limitations, war stories

- The full text was not read, so nothing here is DOCUMENTED for the survey itself.
- DOCUMENTED for the group's 2023 TOG paper, not the survey (see the correction above): topology failures under near-critical relative positions are the main practical instability of CAD SSI, and OCCT and ACIS both fail on the hard contact configurations the paper lists.

## Relevance for wonky

- **Use as a map, not a method.** For wonky's analytic carriers (planes, cylinders, cones, spheres, tori) the relevant clusters are 6 (special surfaces) and 5 (topology guarantees, for the eventual fillet and B-spline surfaces). Clusters 7 and 8 matter only once wonky has freeform or blend surfaces (fillets).
- **Solved versus open** (INFERRED from the reference list plus the group's 2023-2025 work):
  - Treated as solved:
    - exact classification and parameterization of quadric pairs (DLLP, Tu 2009, Shao & Chen 2023/2024);
    - transversal intersections of generic patches in industrial kernels (marching plus subdivision).
  - Recent and still expensive: topology-guaranteed freeform SSI (2023-2025).
  - Open or active:
    - near-critical and tangential configurations;
    - tolerance-based overlaps (2025);
    - watertightness of trimmed results (2019-2025);
    - efficiency of certified methods.
- **Implications for Bend (INFERRED):**
  - The moving-plane/Dixon implicitization plus resultant topology pipeline is exact-polynomial work: determinants of polynomial matrices, resultants, root isolation. That is feasible on multi-limb U32 but heavy.
  - The parallel tracing stage is uniform F32x2 work.
  - For quadrics and tori the special-case literature (cluster 6) is far cheaper than the general pipeline.
- **The cluster-6 route has become concrete** (INFERRED, 2026-09-24; derivations in the linked notes). Torus and sphere became production face types on 2026-09-24 (`docs/entscheidungen.md` item 2), which makes the special-surface cluster the priority. Three results from this batch's notes already show how cheap it can be:
  - every cylinder/cone pair reduces to one quadratic per generator, with topology from the real roots of one quartic Δ(tan(φ/2)) ([dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md));
  - torus/sphere and plane/torus reduce to one circle/circle or circle/line solve per meridian, with topology from a quadratic in cos θ ([li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md](li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md));
  - tangent vertices are classified by the sign of the difference of second fundamental forms ([m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex.md](m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex.md)).

  None of this needs the general Dixon/resultant machinery. That machinery becomes relevant only with blend or B-spline surfaces.

## Pointers worth porting or studying

- Obtain the PDF via a browser session or a library, then read the taxonomy and "challenges" sections. Check the inferred solved/open split above against the text.
- From the reference list, the highest-value follow-ups for wonky:
  - Tu/Wang/Mourrain 2009 (local `tmp/research/pdf/hku-qsic-2009.pdf`);
  - Shao & Chen 2023 CAGD (discriminant classification of QSIC), https://doi.org/10.1016/j.cagd.2023.102244;
  - Jia 2013 CAGD (ring torus classification);
  - Cheng 2023 TOG and Yang 2023 TOG (topology-guaranteed rational SSI);
  - Zhang 2025 CAGD (error-controlled tracing);
  - Yang & Jia 2025 TOG (overlap);
  - Wang 2025 CGF (watertight SSI);
  - Urick 2019 (watertight Booleans).

## Verdict: unreachable

The full text and abstract are paywalled and bot-blocked; this was re-confirmed on 2026-09-24. This note therefore only reconstructs the survey's coverage from its 135-entry Crossref reference list and the group's accessible work.
- Once obtained, read it as the entry map (expected verdict: learn-from). Nothing in it is portable code.
- Getting it needs a library login or a manual browser download by Marc; an agent should not try to get around the block.
