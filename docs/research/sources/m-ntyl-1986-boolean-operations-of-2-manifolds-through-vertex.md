# Mäntylä 1986: Boolean operations of 2-manifolds through vertex neighborhood classification

- Kind: journal paper. ACM Transactions on Graphics 5(1):1-29, January 1986. DOI https://doi.org/10.1145/7529.7530
  - Open PDF (scanned, verified HTTP 200, 1.79 MB, 2026-09-23): https://www.cs.upc.edu/~virtual/SGI/articles/Mantyla_OBs.pdf. Local copy: `tmp/research/pdf/mantyla1986-vertex-neighborhood.pdf` (+ OCR `.txt`; the OCR drops pages 14-15, 17, 19 and 23, which are figures; Tables I-III were read from the page images).
  - Book version with code: M. Mäntylä, *An Introduction to Solid Modeling*, Computer Science Press, 1988. The GWB source cites "Table 15.1" for the reclassification rules, so the set-operation chapter is chapter 15 (DOCUMENTED, comment in `gwb/setop/sreclsectors.c`).
  - Original GWB C source (1988), mirrored from `http://www.cs.hut.fi/~mam/gwb.shar`: https://github.com/aki5/gwb. Cloned to `tmp/research/m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex/gwb`.
  - Modern reimplementation, rGWB: https://github.com/mfernba/rGWB. Cloned to `tmp/research/m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex/rGWB`.
- Author/org: Martti Mäntylä, Helsinki University of Technology. Partly done while visiting Stanford.
- License:
  - Paper: ACM copyright. The algorithm itself is freely re-implementable (INFERRED; no patent is mentioned).
  - GWB code: "NOT released to public domain ... permission is granted to inspect the code and use it, or portions of it for research or educational purposes ... Commercial exploitation is disallowed" (DOCUMENTED, `gwb/README.md`). Treat it as study-only for wonky.
  - rGWB: MIT (DOCUMENTED, `gh api repos/mfernba/rGWB`). Porting ideas or code is allowed with attribution. The code is imperative C over a mutable half-edge structure, so only the logic is reusable.
- Status:
  - Paper: foundational and heavily cited. It is the classic answer to "on" cases in B-rep Booleans.
  - aki5/gwb: one commit (2016-11-01), 2 stars, no license file, pre-ANSI C, about 3,500 lines in `setop/` + `split/`. The README warns it is "old and incomplete" (rGWB README).
  - mfernba/rGWB: C, 24 stars, 1 contributor, last push 2019-03-28, about 9,700 lines in the setop/split modules, 2 closed issues, no releases. Needs Xcode and the author's private viewer and debug modules to build (DOCUMENTED, README).

## What it is

A topologically complete Boolean algorithm (∪*, ∩*, \* regularized) for planar polyhedral 2-manifold solids in a winged-edge/half-edge B-rep. Under the stated assumption that "all numerical tests required can be correctly evaluated", it resolves all special cases: coplanar faces, edge on face, vertex on edge, vertex on vertex (DOCUMENTED, abstract). The core idea is to reduce every special case to one of two local problems:

1. **Vertex-face:** a vertex of one solid lies inside a face of the other.
2. **Vertex-vertex:** two vertices coincide.

A *vertex neighborhood classifier* solves each problem with decision rules that guarantee regularity. Non-manifold results are emitted as a "pseudo-manifold": surfaces may touch at edges or vertices but never cross (criterion 3′, §2).

## How it works

### Data model (DOCUMENTED, §2)

- Every edge has exactly two flat faces. Every vertex is surrounded by a single cycle of edges and faces.
- Faces may have holes (one outer loop plus inner loops), and faces are consistently oriented (outward normals).
- "Dangling" edges, i.e. edges that belong twice to the same face, are allowed in intermediate steps. **Null edges** (zero length, joining two vertices at the same location) are the carrier of all intermediate cut information.

### Splitting by a plane (§3), the template for everything else

1. Split every edge that properly crosses the plane SP.
2. Collect all vertices on SP.
3. For each such vertex, classify its neighborhood. The neighborhood is the ordered cycle of edges and *sectors*, a sector being the wedge of a face adjacent to the vertex.
   - Label each edge ABOVE, ON or BELOW by its far vertex.
   - Reclassify ON cases in this order:
     - **ON sector** (two consecutive ON edges, i.e. a face lying in SP): reclassify "to the side of the material". If the sector's face normal equals SP's normal the sector becomes BELOW, otherwise ABOVE. The ON edges of its neighbours follow.
     - **Remaining ON edges** between labelled sectors:

       | sequence | ON edge becomes |
       |---|---|
       | ABOVE-ON-ABOVE | ABOVE |
       | BELOW-ON-BELOW | BELOW |
       | ABOVE-ON-BELOW | BELOW |
       | BELOW-ON-ABOVE | BELOW |

     These rules prevent dangling faces and dangling edges (DOCUMENTED, §3).
   - A sector of at most 180° intersects SP iff its two bounding edges are on different sides. A "wide" sector (more than 180°) always intersects SP unless it is coplanar with it.
4. Split each intersecting neighborhood by inserting a null edge at the vertex.
5. Join all null edges into cut loops. This builds the new faces, which are then separated into Above and Below (details in Mäntylä 1983, GWB paper [9], and the book).

### Boolean = boundary classification (§4)

- The four-way boundary classification is AinB, AoutB, BinA, BoutA, with eq. (4):
  - `b(A∪B) = AoutB & BoutA`
  - `b(A∩B) = AinB & BinA`
  - `b(A\B) = AoutB & (BinA)⁻¹`

  Here & is gluing along the intersection faces and ⁻¹ reverses orientation.
- The eight-way classification adds AonB+, AonB−, BonA+ and BonA− (+ means overlapping with equal normals, − opposite normals), with eq. (5):
  - `b(A∪B) = AoutB & BoutA & AonB+`
  - `b(A∩B) = AinB & BinA & AonB+`
  - `b(A\B) = AoutB & (BinA)⁻¹ & AonB−`
- **Table I** (the ON reclassification rules, transcribed from the page image) folds the ON parts into the four-way classes so that only eq. (4) is needed:

  | op | AonB+ | AonB− | BonA+ | BonA− |
  |---|---|---|---|---|
  | ∪ | AoutB | AinB | BinA | BinA |
  | ∩ | AinB | AoutB | BoutA | BoutA |
  | \ (as printed) | AoutB | AinB | BoutA | BoutA |

- **Erratum (INFERRED):** the printed "\" row contradicts eq. (5). Eq. (5) keeps AonB− and drops AonB+, so the row should read AonB+ → AinB and AonB− → AoutB.
  - Check: A = unit box, B = box sitting on A's top face. A's top is AonB− and must survive A\B.
  - The 1988 GWB code agrees with eq. (5), not with the printed row. `sreclsectors.c` and `srecledges.c` use `newsa = (op == UNION) ? OUT : IN` and `newsb = (op == UNION) ? IN : OUT` for equal normals, and `(op == UNION) ? IN : OUT` for both solids with opposite normals. So \ is treated exactly like ∩, and `setopfinish.c` reverts BinA afterwards.
  - Implement from eq. (5) and the code, not from the printed Table I row.

### Algorithm outline (DOCUMENTED, §5)

1. Split all edge pairs of A and B that properly intersect.
2. Split edges of A that pass through a vertex of B, and symmetrically for B (steps 2-3).
3. Collect coincident vertex pairs (step 4).
4. Split edges that properly cross a face of the other solid (steps 5-6).
5. Collect (vertex, face) pairs where a vertex lies inside a face of the other solid (steps 7-8).
6. Run the vertex-face and vertex-vertex classifiers. They insert null edges.
7. Join the null edges into intersection faces and assemble the result by eq. (4).

No point-in-polyhedron test is needed, except when the surfaces do not intersect at all (§8).

### Vertex-face classifier (§6.1)

The splitting classifier with the face plane as SP. Above/below become out/in, and ON sectors use Table I. A null edge is also inserted into the pierced face as an inner loop, so the intersection polygon can be threaded through it (Fig. 13).

### Vertex-vertex classifier (§6.2), the novel part

- **Sector test (Fig. 14-15):**
  - For each sector pair, `int = n1 × n2` gives the direction of the planes' intersection line. If it vanishes, the sectors are coplanar and "not considered to intersect".
  - Otherwise test whether `int` or `−int` lies inside both sectors.
  - The inside-sector test for a sector with bounding vectors ref1, ref2 is `ref = ref1×ref2`, `test1 = ref1×int`, `test2 = int×ref2`. For a sector under 180°, `int` is inside iff all three point the same way.
  - For exactly 180°, test the complement. For a wide sector, compare `int` with an inward vector `in`. GWB instead splits wide sectors in two with a bisector (`nbr_preproc` in `setopgetnbr.c`).
- **Edge-sector coincidence** (an edge of one neighborhood lies in the other's sector plane):
  - Classify the two test sectors sharing that edge as IN, OUT or ON against the reference sector, by the signed distance of the non-coplanar bounding vector (or of the bisector for sectors of 180° or more).
  - **Table II** (9 rows) decides whether each test sector intersects:
    - ON/ON gives No/No.
    - IN/OUT gives Yes/No.
    - OUT/IN gives No/Yes.
    - Touching cases (IN/IN, OUT/OUT) give No/No.
    - Rows with ON use "rule" or "NOT(rule)".
  - **Table III** is that rule, depending on orientation (identical/opposite), comparison direction (A vs B, B vs A) and op:

    | orientation | comparison | ∪ | \ | ∩ |
    |---|---|---|---|---|
    | identical | A vs B | Yes | Yes | No |
    | identical | B vs A | No | Yes | Yes |
    | opposite | A vs B | No | No | Yes |
    | opposite | B vs A | No | Yes | Yes |

    It is deliberately asymmetric between A and B, so that exactly one copy of an overlapping pair survives.
- **Edge-edge coincidence** (Fig. 19-20):
  - Sort the four sectors around the common edge by angle. A "mixed order" means they intersect.
  - Ties (coplanar sectors) are resolved again with the Table I/III rules. All-pairwise-coplanar means no intersection.
- **Output:** an ordered sequence of intersecting sector pairs. Null edges are inserted between them, with a dangling null edge when one sector meets several (Fig. 21-22).

### Numerics (DOCUMENTED, §7; the author disclaims a full analysis)

- Required tests:
  - line-line intersection;
  - point coincidence;
  - point-on-plane;
  - point-in-polygon;
  - polygon/edge intersection;
  - vector collinearity, implemented as the length of the cross product of normalized vectors.
- **Consistency rule 1: one primitive at the bottom.** Tests form a hierarchy in which every high-level test reduces to *point coincidence*. For example, point-on-edge is "project, then test coincidence", so the same measure is used everywhere.
- **Consistency rule 2: ordering and tolerances.** Tests run in a fixed order with tolerances scaled to object size. Edge-edge runs before edge-face, and with a larger tolerance.
- These measures were still "not sufficient" for nearly coplanar faces, which the implementation handles by a separate pass.

## Robustness and guarantees

- **Proven (DOCUMENTED):** topological completeness *assuming* consistent predicate results, plus regularity and pseudo-manifoldness of the output. No numerical analysis.
- **Heuristic:** everything numeric. GWB uses a global `EPS`/`BIGEPS` with `comp(x, 0, EPS)` and `vecnull(v, EPS)`. rGWB uses 1e-6 for coordinates, angles and parallel dot products, and 0.01 for boxes (`csmtolerance.c`).
- **Explicitly out of scope (DOCUMENTED, §8):**
  - Curved faces: they "may intersect each other in a way that cannot be reduced to vertex-vertex coincidences (consider spheres)".
  - Non-manifold operands: these would need many-to-many neighborhood classification.

## Parallelism and performance

- DOCUMENTED (§8): "As presented, the algorithm is slow". Optimizing steps 1-8 gives "a factor of 10 or so", after which entity search dominates. No numbers are given; spatial search follows Mäntylä & Tamminen 1983.
- INFERRED structure:
  - Steps 1-8 are embarrassingly parallel candidate-pair tests (BVH plus predicate map).
  - Classification is independent per coincident vertex pair or vertex-face pair, so it forks well.
  - The sequential bottleneck is null-edge joining. GWB `setopconnect.c` sorts null edges lexicographically, then scans with a "loose ends" list (`scanjoin`/`neighbor`) and applies Euler operators (`lkef`/`lkemr`) in place.
  - Neighborhood sizes vary, so the work is not uniform: CPU fork-join, not GPU.

## Known failures, limitations, war stories

- **Book code is buggy and incomplete** (HEARSAY-level but from an implementer): "this code is old and incomplete, and the code in book sometimes is buggy". The rGWB author had to "complete" the vertex neighborhood classification (DOCUMENTED, https://github.com/mfernba/rGWB README).
  - Visible in the GWB source: `sectoroverlap()` in `setop/sectors.c` is a stub that returns 1, and neighborhoods are fixed arrays of `MAXSECTORS 100`.
- **Null-edge joining fails in practice.** rGWB adds two fallbacks:
  - A last-resort joining algorithm from Bhardwaj & Malik 1997 (Cornell CSG applet tech report), found via H. J. Koelman (SARC), "Reflections on the implementation of boolean operations with polyhedral solids" (HEARSAY pointer; not read).
  - A **perturbation retry loop** in `csmsetop.c`: on `IMPROPER_INTERSECTIONS`, solid B is uniformly scaled by 1 + k·1e-4 about the origin and the operation retried, up to 10 times. The README admits it "could produce an incorrect output in some cases". This is a geometry-changing hack, exactly what wonky's "explicit failure" rule forbids.
- **Maximal faces are required.** Coplanar adjacent faces must be merged before and after each operation (DOCUMENTED, rGWB README).
- **Precision patch for asymmetric ON classification.** `i_correct_impossible_classifications_due_to_precision_errors` (`csmsetop_vtxvtx.c`): if A's sector is fully ON against B, B's must be ON too, and the classification is forced symmetric. This shows tolerance-based predicates can be mutually inconsistent.
- **Printed-table erratum:** Table I row "\" disagrees with eq. (5) and with the code (above).

## Relevance for wonky

- **The Table I / eq. (5) rules are the canonical ON-case policy** for any Boolean that meets coincident geometry, planar or curved.
  - For wonky's plane/cylinder cases: a cap face coplanar with a plane face, two co-cylindrical faces (proto-recover already merges "same cylinder axis line and radius" carriers across leaves), and a union where one body's cap sits on the other's face.
  - The rule is a pure function `onRule(op, sameNormal, which) → In | Out`, trivially expressible in Bend. Use the corrected \ row.
- **Vertex-vertex classification is the right local tool for degenerate vertices** such as the hex-nut "tangent degenerate vertex" proto-recover refuses. The inputs are small (the two cycles of sectors).
  - The predicates are sign tests of cross and dot products (degree 2-3 in coordinates). With F32x2 dyadic inputs they are exact on multi-limb U32 (INFERRED: 3 × ~50 bits plus exponent alignment, well under 10 limbs).
  - For *constructed* vertices, use plane-based or indirect predicates (see [ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md](ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md)) instead of rounded points.
- **Curved faces need a second-order extension (INFERRED).** Mäntylä's `n1 × n2 = 0 ⇒ coplanar ⇒ ON` is wrong for tangency.
  - A plane tangent to a cylinder along a generator has parallel normals at every contact vertex, yet the faces only share a line.
  - The fix is a tie-break on the sign of the height difference along the sector bisector, i.e. the difference of normal curvatures. It is exact for plane/cylinder: the cylinder lies strictly on one side, height r − √(r² − s²) > 0.
  - Then only genuinely overlapping surface patches go to Table I.
  - **The general form of that tie-break: a second-fundamental-form classifier for tangent vertices** (INFERRED, worked by hand 2026-09-24).
    - At a point p where both surfaces have parallel normals n, write each surface locally as a height over the common tangent plane: `hA(v) ≈ ½ vᵀ IIA v`, `hB(v) ≈ ½ vᵀ IIB v` (II = second fundamental form, orientation by n).
    - The sign of the 2×2 symmetric form `H = IIA − IIB` along a tangent direction v says which surface is above the other in the sector containing v. So H replaces the n1 × n2 test at such vertices:

      | H | local picture | sectors |
      |---|---|---|
      | definite | isolated contact point | none cross; the vertex is dropped, or kept as a touching point per Table I policy |
      | indefinite | the intersection has a crossing (node) there | 4 alternating sectors, separated by the two directions with vᵀHv = 0, which are exactly the tangents of the two curve branches |
      | singular, non-zero | contact of higher order along one direction | refuse by name, or decide by third order / by the pencil classification in [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md) |
      | H = 0 | second-order contact | coincident patches (the common case): decide coincidence exactly, then use Table I. Anything else is higher-order contact: refuse by name |

    - The three cylinder cases the QI server classified give exactly these answers:

      | case | contact point | local heights | H | QI answer |
      |---|---|---|---|---|
      | Steinmetz | (1, 0, 0) | x ≈ 1 − y²/2 and x ≈ 1 − z²/2 | `H ∝ z² − y²`, indefinite | two secant conics crossing along y = ±z |
      | internally tangent r = 2 / r = 1 | (2, 0, 0) | x ≈ 2 − y²/4 and x ≈ 2 − z²/2 | indefinite | nodal quartic |
      | externally tangent, skew | (1, 0, 0) | x ≈ 1 − y²/2 (cylinder A) and x ≈ 1 + z²/2 (cylinder B) | definite | single point |

      The QI results are recorded in [qi-quadric-intersection-library-loria-gamble.md](qi-quadric-intersection-library-loria-gamble.md).
    - Bend fit:
      - For analytic carriers, II is closed form: a plane has 0, a cylinder `(1/r)` along the circle direction, a sphere `(1/r)I`, a cone and a torus have known principal curvatures.
      - So H needs only a 2×2 determinant and trace sign test: exact on U32 limbs when the contact point is exact (e.g. from the pencil singular-point step), otherwise interval-evaluated with refusal on an undecided sign.
    - This is the local counterpart of Liu 2011's `F_uv² − F_uu F_vv` singular-point discriminant (see [li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md](li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md)).
- **Where it plugs in:**
  - The exact-plane prototype's coplanar handling.
  - A certification or repair pass in `recover` for vertices where the mesh topology is ambiguous.
  - A test oracle: enumerate the Table II/III cases as unit fixtures.
- **Do not port** the null-edge plus in-place Euler-operator machinery. In Bend, emit per-vertex cut records and assemble loops with a sort-join, which proto-recover already uses for boundary loops. That keeps it functional, with no mutation.
- **Tolerance lesson:** Mäntylä's consistency rules ("reduce everything to one coincidence primitive; fixed test order") are the pre-exact-arithmetic version of wonky's approach. Exact predicates make rule 2 unnecessary but rule 1 still matters: derive all tests from one predicate family so that answers cannot contradict each other.

## Pointers worth porting or studying

- Paper §3 (splitting classifier and ON rules), §4 Table I plus eq. (4)/(5), §6.2 Tables II/III, §7 consistency hierarchy.
- GWB (study only):
  - `setop/setopgetnbr.c` `nbr_preproc`: wide-sector bisector split and the (s1a, s2a, s1b, s2b) side codes.
  - `setop/sectors.c` `sectortest`/`sctrwithin`: sector inclusion.
  - `setop/sreclsectors.c`, `setop/srecledges.c`: ON reclassification, as the code actually does it.
  - `setop/setopconnect.c`: null-edge joining.
  - `setop/setopfinish.c`: result assembly and `revert(bina)`.
- rGWB (MIT):
  - `csmsetop_vtxvtx.c`: complete classifier, double and single ON-edge reclassification variants, `i_is_wide_sector`, and the precision-correction pass.
  - `csmsetop.c`: the perturbation loop, as an anti-pattern.
  - `csmsetop_join.c`: the null-edge join fallback.

## Verdict: adapt

Adapt the combinatorial core:
- the corrected Table I / eq. (5) ON policy;
- Table II/III sector decisions;
- the "all tests from one primitive" rule.

Implement them as exact predicates, extended with a second-order tangency tie-break for curved faces. Use them in the recovery and exact-plane paths for coincident and tangent configurations. Do not adopt the overall algorithm or GWB's null-edge/Euler machinery: by the author's own statement it does not extend to curved faces; it relies on tolerance consistency; and its practical implementations need perturbation hacks.
