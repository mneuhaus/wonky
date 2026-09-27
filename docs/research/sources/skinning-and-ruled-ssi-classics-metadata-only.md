# Skinning and ruled-surface intersection classics that could not be read (metadata-only record)

- Kind: papers/book behind paywalls; recorded so later agents do not re-search them. Metadata from Semantic Scholar API (`api.semanticscholar.org/graph/v1/paper/DOI:…`, 2026-09-24: all `openAccessPdf.status = CLOSED` except Fuchs et al., whose ACM PDF was blocked by Cloudflare) and publisher/search abstracts.
  1. C. D. Woodward, "Skinning techniques for interactive B-spline surface interpolation", Computer-Aided Design 20(8) 441–451, 1988. https://doi.org/10.1016/0010-4485(88)90002-4 (ScienceDirect abstract page: https://www.sciencedirect.com/science/article/abs/pii/0010448588900024).
  2. L. Piegl, W. Tiller, "Surface skinning revisited", The Visual Computer 18, 273–283, 2002. https://doi.org/10.1007/s003710100156.
  3. L. Piegl, W. Tiller, The NURBS Book, 2nd ed., Springer 1997, §10.3 "Skinned surfaces" (not accessed).
  4. H.-S. Heo, M.-S. Kim, G. Elber, "The intersection of two ruled surfaces", Computer-Aided Design 31(1) 33–50, 1999. https://doi.org/10.1016/S0010-4485(98)00078-5.
  5. H. Fuchs, Z. M. Kedem, S. P. Uselton, "Optimal surface reconstruction from planar contours", CACM 20(10), 1977. https://doi.org/10.1145/359842.359846.
  6. G. Elber, T. Grandine, M.-S. Kim, "Surface self-intersection computation via algebraic decomposition", Computer-Aided Design 41(12) 1060–1066, 2009 (listed on https://gershon.cs.technion.ac.il/irit/site/reports.html, no link).
- License: publisher copyright; algorithms free to re-implement.

## What they are (claims labelled)
1. Woodward: the standard skinning method interpolates user-defined sections; a spine curve places planar sections in space; projection-curve techniques add control in the longitudinal direction (search-result abstract; HEARSAY-level). The OCCT pipeline (compatible sections → interpolate/approximate across) is the same scheme (DOCUMENTED in the OCCT note).
2. Piegl-Tiller 2002: "studies several skinning problems and proposes a solution that avoids anomalies" (search summary; HEARSAY-level). The anomalies of classic skinning are known to be wiggles from knot-vector merging and poor cross-sectional parameterisation (INFERRED from the OCCT code's compatibility step and general knowledge; not read).
3. NURBS Book §10.3: skinning = make section curves compatible (degree elevation, knot refinement to a common vector), choose v-parameters (e.g. averaged chord length across sections), interpolate each column of control points with a v-direction B-spline. INFERRED (OCCT `GeomFill_Profiler` + `GeomFill_AppSurf` implement these steps; the book itself was not read).
4. Heo-Kim-Elber: ruled/ruled intersection (title and venue DOCUMENTED). The standard reduction, INFERRED: rulings L1(s) and L2(u) meet iff they are coplanar, det(A1(s)−A2(u), D1(s), D2(u)) = 0, a bivariate polynomial whose zero set in (s,u) is traced, then filtered by the ruling parameter ranges.
5. Fuchs-Kedem-Uselton: optimal triangulation between two planar contours as a minimum-cost path in a toroidal graph (well known; cited as the basis of Sederberg-Greenwood's DP, which is DOCUMENTED in that note).
6. Elber-Grandine-Kim: surface self-intersection via algebraic decomposition (title DOCUMENTED; content not read).

## Robustness and guarantees
Unknown from primary text. Do not cite these for specific numbers or theorems until read.

## Relevance for wonky
- Skinning (1–3) is only needed for multi-section lofts (6 corpus units). Onshape's result there is a cubic C2 skin with undocumented knot placement (STEP-evidence note), so parity is only achievable within a tolerance anyway.
- Ruled/ruled SSI (4) is needed only when two non-quadric loft faces meet; corpus lofts meet planes, cylinders and other prisms far more often (INFERRED from the corpus report's loft-then-unite/cut patterns).
- Contour stitching (5) is the mesh-side analogue of vertex matching; relevant if the mesh Boolean route triangulates loft sides directly.

## Pointers worth porting or studying
Obtain 1, 2 and 4 through a library if skinning or ruled/ruled SSI becomes a work item.

## Verdict: learn-from (pending access)
Recorded as leads only; every claim above that is not labelled DOCUMENTED needs the text before it is relied on.
