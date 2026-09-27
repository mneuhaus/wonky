# Vida, Martin, Várady, "A survey of blending methods that use parametric surfaces" (CAD 1994)

- **Kind:** survey paper.
- **Canonical URL:** https://www.sciencedirect.com/science/article/abs/pii/001044859490023X (DOI 10.1016/0010-4485(94)90023-X). HTTP 403 to WebFetch on 2026-09-23; paywalled.
- **Other URLs, and what they give:**
  - SZTAKI record of the journal paper: https://eprints.sztaki.hu/682/. "Full text not available from this repository." Local copy: `tmp/research/blend-papers/eprints_682.html`.
  - SZTAKI record of the preprint, Research report GML 1992/4, "A survey of blending methods using parametric surfaces", MTA SZTAKI, 59 pp.: https://eprints.sztaki.hu/158/. Also "Full text not available". Local copy: `eprints_158.html`.
  - SZTAKI GML publication hub: http://wwwold.sztaki.hu/gml/publications/publications.html. Local copy: `tmp/research/blend-papers/sztaki-gml-pubs.txt`.
  - Academia.edu copy: https://www.academia.edu/9222838/A_survey_of_blending_methods_that_use_parametric_surfaces. Cloudflare challenge plus login wall; not accessed.
  - OpenAlex metadata: `tmp/research/blend-papers/openalex_10.1016_0010-4485_94_90023-X.json`. Semantic Scholar returns "not found" for this DOI.
- **Authors / organization:**
  - János Vida and Tamás Várady: Geometric Modelling Laboratory, Computer and Automation Research Institute (MTA SZTAKI), Budapest.
  - Ralph R. Martin: University of Wales College of Cardiff.
  - Year: 1994 (the report dates from 1992).
- **Venue:** Computer-Aided Design 26(5):341–365, May 1994. OpenAlex: 117 citations, `oa_status: closed`, `any_repository_has_fulltext: false` (queried 2026-09-23).
- **License:** © Elsevier. No open full text exists anywhere reachable. Nothing to port; ideas only.
- **Status:** historical reference; the standard citation for blend terminology. It is cited, for example, as ref. [21] in Kós–Martin–Várady 2000 and ref. [7] in the 2012 PMC paper below.

## What it is

**Full text: unreachable.** It could not be read in this pass. Everything below about its *content* is second-hand.

- **Abstract** (HEARSAY: reconstructed from search-engine snippets of the publisher page, which returned 403 directly):
  - The paper "discusses the blending problem in geometric modelling, and provides a comprehensive review of solutions that use parametric surfaces".
  - "A terminology and a classification are presented to help clarify the nature of blending, and the relationships between various parametric blending methods."
  - "Several geometric techniques are evaluated … Topological issues are also discussed."
  - It emphasises "the applicability and efficiency of parametric techniques for general blending situations", lists open questions, and gives an "up-to-date list of publications on blending".
- The claim that it classifies blends into **rolling-ball, cross-sectional / spine-based, polynomial, trimline-driven and vertex blends** comes from the research brief and from secondary citations. HEARSAY; not verified against the text.
- A secondary 2012 open-access paper confirms the framing. It classifies approaches "according to the type of surfaces which are used to describe the blend surface". Rolling-ball blends are "a procedural description of the blend surface", generalised to variable-radius rolling balls built from canal-surface segments. "Parametric blend surfaces are often favored in applications, since they can easily be added to an existing boundary representation of a solid using trimmed surfaces." DOCUMENTED at https://pmc.ncbi.nlm.nih.gov/articles/PMC3268256/, which cites Vida et al. as [7].

## How it works: the vocabulary, reconstructed from reachable primary sources

The survey's value to wonky is its vocabulary. The same terms are defined in documents that *could* be read, so wonky can adopt them without the paper. Each term below carries its source.

- **Primary surfaces**: the surfaces being blended, "relatively large in comparison to smaller blending surfaces". DOCUMENTED in Kós, Martin & Várady 2000 (open-access author version, ORCA Cardiff: https://orca.cardiff.ac.uk/id/eprint/13565/; local copy `tmp/research/pdf/kos-martin-varady-2000-blend-radius.pdf`), §1.
- **Rolling-ball blend**: the envelope of a ball rolling in contact with both primaries. For constant radius R, the ball-centre locus is called the **spine**.
  - Construction: "offsetting each primary surface by a distance R and intersecting the offset surfaces". DOCUMENTED, Kós et al. §3.2, Fig. 6.
  - Parasolid stores fixed blends as `(geom_1, geom_2, radii, spine, spine_ext)`. DOCUMENTED, Parasolid FD §29.6.1.
- **Conic spines.** "In the cases where the primary surfaces are plane-plane, plane-sphere, plane-cylinder or plane-cone, the spine for a given R is always a conic curve, which can be computed explicitly." DOCUMENTED, Kós et al. §3.2.5.
  - INFERRED consequence: a plane/cylinder fillet is a cylinder only if the plane is parallel to the axis (line spine), and a torus only if the plane is perpendicular to the axis (circle spine). A general oblique plane gives an **elliptic spine**, so the fillet is a pipe surface outside the analytic zoo.
- **Spring curves / trimlines / contact curves**: the curves where the blend touches the primaries.
  - ACIS: "Spring curves are traced by the contact points between the rolling ball and the blend faces." DOCUMENTED, ACIS R10 Blending Component manual, http://www-isl.ece.arizona.edu/ACIS-docs/PDF/BLND/01CMP.PDF; local copy `tmp/research/pdf/acis-blnd-01cmp.pdf`.
  - "Trimline" is the parametric-blend term for the same boundary. It is prescribed first, and the surface is built between the trimlines. INFERRED from the Parasolid holdline concept and the brief.
- **Cross-section / profile**:
  - The shape of the blend in a plane transversal to the spine: circular, conic (with ρ), chamfer, or curvature-continuous.
  - The plane is orthogonal to the walls (rolling ball), orthogonal to a guide **parameter spine** ("disc"), or taken from isoparameter curves.

  DOCUMENTED, Parasolid FD ch. 33 §33.3–33.5.
- **Range**: the distance of the spine from each primary. Unequal ranges give an asymmetric (elliptic) section. DOCUMENTED, Parasolid §29.2.2.
- **Holdline / cliffedge**: an existing edge that forces the blend boundary. With a holdline the blend stays tangent; with a cliffedge it does not. DOCUMENTED, Parasolid §30.3.1 and §33.4.
- **Setback, cross curve, vertex blend, n-sided patch, bulge, miter, bi-blend, capping (end cap vs side cap)**: see the Várady–Rockwood and Braid notes. DOCUMENTED in the ACIS manual.
- **Variable-radius rolling ball (VRB)**: a canal surface with a varying radius. DOCUMENTED, Parasolid §29.5; the PMC 2012 paper.
- **Rossignac's earlier (1985) taxonomy of blending approaches**: "annotation, function combination [implicit blending, Ricci], sculptured surfaces, sweeping". DOCUMENTED, Rossignac PhD thesis TM-54, §2.1 (see the Rossignac–Requicha note). INFERRED: Vida et al. narrowed this to the parametric branches (sculptured and sweeping) and subdivided them.

### Follow-up work from the same group

Listed on the SZTAKI GML hub, DOCUMENTED as bibliographic entries only. These are the concrete technical papers the survey leads into:

- Hermann, "Rolling ball blends and self-intersection", SPIE Curves and Surfaces in Computer Vision and Graphics III, 1992.
- Hermann, Lukács, Várady, "Techniques for variable radius rolling ball blends", Mathematical Methods for Curves and Surfaces, 1995.
- Lukács, Hermann, Várady, "Continuity and selfintersections of variable radius rolling ball blend surfaces", IFIP WG 5.2, 1997.
- Lukács, "Differential geometry of G1 variable radius rolling ball blend surfaces", CAGD 15(6):585–613, 1998.
- Hermann, "On the smoothness of offset surfaces", CAGD 15(2), 1998.
- Várady & Rockwood, "Vertex blending based on the setback split", 1995, and "A geometric construction for setback vertex blending", CAD 29(6), 1997 (own note).
- Várady & Hoffmann, "Vertex blending: problems and solutions", MMCS II, 1998, pp. 501–527.
- Várady, "Vertex blending surfaces in computer aided geometric design", DSc dissertation, 1997.
- Várady, "Topological aspects of vertex blending", 2000.
- Kós, Martin, Várady, "Methods to recover constant radius rolling ball blends in reverse engineering", CAGD 17(2):127–160, 2000. **Open access** at ORCA; read for this note.
- Várady, Benkő, Kós, Rockwood, "Implicit surfaces revisited — I-patches", Computing Suppl. 14, 2001.

## Robustness and guarantees

Not assessable from the paper. From reachable sources:

- Rolling-ball blends self-intersect when the radius exceeds the principal curvature radius of the offset geometry (Hermann 1992, title only; Rossignac thesis §2.2, "when the radius of the rolling-sphere exceeds the radius of curvature of the trajectory"). DOCUMENTED (Rossignac).
- Kós et al. 2000 give numeric tolerances for their recovery iterations: relative 1e-6 per step, "at least 5 correct digits" overall. On clean synthetic data, the iterative-spine and maximum-ball radius estimates have a 0.000% average and 0.001% maximum error. With noise: 0.051% / 0.685% and 0.079% / 0.715%. Curvature estimation manages only 2.7% / 18.8% clean and 8.5% / 41.9% noisy (Tables 1–2). DOCUMENTED.

## Parallelism and performance

Nothing known about the survey itself. Kós et al. note that explicit conic spines make the plane/cylinder case faster than the general iteration (§3.2.5). DOCUMENTED; no timings copied here.

## Known failures, limitations, war stories

- Full text unreachable: closed access, both SZTAKI records without full text, academia.edu behind a login.
- The classification claim is unverified.
- Kós et al. report that for concave blends where "the curvature is greater along the blend direction", curvature estimation "chooses the wrong side" (datasets pc3a.20, nn1a.10, nn1a.20). This is relevant to fillet recognition on meshes. DOCUMENTED.

## Relevance for wonky

- **Naming and API (INFERRED):** wonky's internal blend record should use this shared vocabulary so that LLM-written code and docs line up with Parasolid, ACIS and Onshape terms:
  - `BlendSurface{ primaries: (FaceId, FaceId), ranges: (r1, r2), spine: Curve, springs: (Curve, Curve), section: Circular | Conic(rho) | Chamfer, sourceEdge: EdgeId }`.
  - Vertex blends: `VertexBlend{ vertex, setbacks[], crossCurves[], patch }`.
- **Scoping the analytic tier (INFERRED, from Kós §3.2.5):**
  - plane/plane: line spine, **cylinder**;
  - plane/cylinder: **cylinder** only when parallel to the axis, **torus** only when perpendicular to it (a circular edge);
  - plane/cone: **torus** only for a perpendicular plane (circular edge);
  - plane/sphere: circle spine, **torus**.
  - Every other orientation has a conic, non-circular spine, a non-analytic pipe surface, and must fail explicitly in the first cut. Rossignac's PCC (bi-arcs → torus and cylinder pieces with a stated tolerance) is a later option.
- **Mesh-recovery hybrid:** Kós et al. is exactly the "recover analytic fillet from a tagged mesh" subproblem.
  - The iterative-spine method minimises `S(R) = Σ (‖c(b_i, R) − b_i‖ − R)²` over the spine.
  - The maximum-ball method takes the largest sphere through a point that is tangent to both primaries, then the median over points.
  - Both give radius estimates to about 1e-5 relative on clean data. That suits recovering fillets from the Boolean bake-off's mesh output, or from imported STLs (the `scan-reverse-engineering` workflow).
  - Bend fit: per-point work is uniform, the median is a reduction, and a Newton iteration on R is scalar and sequential. F32x2 easily supports 1e-6 relative.
- **Testing:** the survey's topic list (cross-section types, vertex blends, topology) is covered in executable form by the Parasolid and ACIS docs. Use those for fixtures.

## Pointers worth porting or studying

- If the paper ever becomes available (library access or an author copy), read its classification tables and its "topological issues" section first.
- Kós, Martin, Várady 2000 (ORCA open access): §3.2 (spine as offset intersection; iterative spine reconstruction with a Newton step on R), §3.2.5 (explicit conic spines for plane/{plane, sphere, cylinder, cone}), §3.3 (maximum-ball method), §5.2–5.3 (applicability; accuracy Tables 1–2). Local copy: `tmp/research/pdf/kos-martin-varady-2000-blend-radius.pdf`.
- The SZTAKI hub entries above, for the VRB self-intersection and vertex-blend theory.

## Verdict: unreachable

The full text is closed and no legal open copy was found. Its vocabulary is fully recoverable from the Parasolid FD, the ACIS blending manual, Rossignac's thesis and Kós et al. 2000, and wonky should adopt that vocabulary from those readable sources. Retry only if library access appears. The open follow-up by Kós et al. is directly useful for mesh-to-analytic fillet recovery.
