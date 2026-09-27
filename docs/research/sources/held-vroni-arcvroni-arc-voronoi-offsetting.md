# Held: VRONI / ArcVRONI (Voronoi diagrams of segments and circular arcs, arc-preserving offsets) and Held & Mann 2011 (floating point vs exact)

- Kind: closed-source research/industrial code + papers.
  - Project page: [VRONI: Voronoi Diagrams of Points, Segments and Circular Arcs](https://www.cosy.sbg.ac.at/~held/projects/vroni/vroni.html) (read; local copy `/tmp/vroni.html` during this session). Related pages: [pocket offsetting](https://www.cosy.sbg.ac.at/~held/projects/pocket_off/pocket.html), [biarcs](https://www.cosy.sbg.ac.at/~held/projects/biarcs/biarcs.html) (not read).
  - Papers:
    - M. Held, "VRONI: An engineering approach to the reliable and efficient computation of Voronoi diagrams of points and line segments", *CGTA* 18(2):95-123, 2001.
    - M. Held, S. Huber, "Topology-oriented incremental computation of Voronoi diagrams of circular arcs and straight-line segments", *CAD* 41(5):327-338, 2009 ([DOI 10.1016/j.cad.2008.08.004](https://dx.doi.org/10.1016/j.cad.2008.08.004); the author PDF link on the project page returns 404, ScienceDirect 403; **not read**).
    - M. Held, W. Mann, "An Experimental Analysis of Floating-Point Versus Exact Arithmetic", CCCG 2011, pp. 261-266 ([PDF](http://2011.cccg.ca/PDFschedule/papers/paper77.pdf), local `tmp/research/pdf/held-mann-2011-float-vs-exact-cccg.pdf`, **read in full**).
  - Stefan Huber's overview page: [sthu.org/research/voronoidiagrams](https://www.sthu.org/research/voronoidiagrams/).
- Authors: Martin Held (Univ. Salzburg, CGA Lab), Stefan Huber, Willi Mann.
- License: **proprietary**. "The source codes for VRONI and ArcVRONI are available for both academic and commercial use ... neither VRONI nor ArcVRONI have been released into the public domain", access by email (project page). Nothing can be ported; only published ideas.
  - Open alternative for points/segments only: [OpenVoronoi](https://github.com/aewallin/openvoronoi) (LGPL-2.1, 223 stars, pushed 2026-03-23, same topology-oriented incremental approach; no arcs).
- Status: long-lived industrial code ("wide-spread use, both commercially and within academic research projects"); FWF-funded research until ~2011.

## What it is

VRONI computes Voronoi diagrams of points and segments; ArcVRONI adds "genuine circular arcs without approximation ... with genuine conic arcs as bisectors" (project page). On top of the diagram it computes medial axes, maximum inscribed circles, Delaunay triangulations, and **offset patterns** "consisting of straight-line segments and circular arcs ... the offsets of the arcs are genuine arcs". It never generates mitred or purely polygonal offsets.

## How it works

- **Topology-oriented incremental construction** (Sugihara-Iri style, generalized to segments and arcs). Topological consistency of the diagram (a tree-like structure per insertion) takes precedence over numerical decisions. Numeric results feed a combinatorial update that is always kept valid.
- **Numerics** (project page): "very careful implementation of the numerical computations required"; "automatic relaxation of epsilon thresholds"; "multi-level recovery process combined with desperate mode"; ANSI C on "standard floating-point arithmetic".
- **Offsets from the diagram** (INFERRED from the project page and standard Voronoi-offset theory): every offset point at distance d lies in the Voronoi cell of its closest site. Within a cell the offset is a line parallel to a segment site or a concentric arc to an arc/point site, clipped by the cell boundary. So the whole family of offsets for all d comes from one diagram. Self-intersections of raw offsets never occur, because they are resolved by the cell structure.

## Robustness and guarantees

- Claimed: "the first code for computing Voronoi diagrams of points, line segments and circular arcs which is both reliable and fast"; copes "with any form of polygonal input data, be it clean or not". Reliability is engineering (thresholds, relaxation, recovery), not proof.
- **Held & Mann 2011 (DOCUMENTED measurements):**
  - VRONI with MPFR (53/212/1000 bits) is 50-70× slower than double (vroniFp ≈ 0.6·n log n µs for n ≥ 2,000; i7 X980) but more accurate.
  - VRONI and BONE **could not run with CORE even on trivial inputs** ("several minutes of CPU time do not suffice for CORE to evaluate the sign of one expression tree").
  - CGAL 3.8's segment Voronoi diagram (filtered exact traits) was 50-80× slower than vroniFp. Its node *coordinates* were less accurate than vroniFp's, though its topology may be correct (not assessed). Some smooth polygonal approximations of elliptical arcs forced Ω(n²) time; 0.36 % of inputs exceeded the limits.
  - FIST triangulation in double: a GMP verifier reading the inputs as decimals reported 4.92 % faulty outputs. Reading them as the binary64 values actually stored, it reported **0 %**. Lesson: **the exact input is the binary64 value, not the decimal string**.
  - x87 80-bit registers changed FIST's output on 15 % of inputs between `-O0` and `-O`.
  - Coding lesson: write `|x| ≤ ε`, not `|x| < ε`, so that ε := 0 works.

## Parallelism and performance

Single-threaded. Project page (hardware not stated):

| input | size | time |
|---|---|---|
| Salzburg skyline | 1,079 segments | 25 ms (VD + medial axis + max. inscribed circle + all offsets) |
| MRI slice | 1,570 segments | 34 ms |
| mechanical part | 84 segments + 134 arcs | 204 ms |
| 480 tangent-continuous arcs + 4 segments | 484 sites | 463 ms (VD alone 381 ms) |
| offset family (star polygon) | 962 segments + 898 arcs | 2,037 ms |
| India roads | 159,032 segments | 4,598 ms |

Arc-heavy inputs cost about 1 ms per site against about 0.02-0.03 ms per segment site, i.e. tens of times more (INFERRED from the rows above; the workloads differ in how many offsets were computed).

## Known failures, limitations, war stories

- Held & Mann: exact-arithmetic retrofits of mature float codes are not drop-in. CORE's `intValue()` rounds inconsistently. Expression-tree sizes depend on how equivalent formulas are written. MPFR global variables silently kept 53-bit precision.
- The CGAL Voronoi comparison above (runtime variance ≥ 20×, crashes in its double variant, less accurate nodes).

## Relevance for wonky

- **Offset semantics:** a Voronoi/medial-axis offset gives the *whole family* of offsets and exact arc preservation. It is the gold standard for pocketing and for multi-offset FDM perimeters (concentric walls), and it answers "thinnest wall / maximum inscribed circle" queries (FDM printability: minimum feature width), which slice-and-stitch offsets do not.
- **Cost for wonky (INFERRED):**
  - arc/arc bisectors are conics;
  - Voronoi vertices of three arcs are roots of degree-8 systems (Apollonius-type problems);
  - exact predicates for them are far heavier than arrangement predicates.
  - An exact Bend ArcVRONI is out of reach near term. A float/F32x2 topology-oriented version is conceivable but would violate "approximations need explicit tolerances" unless every numeric decision is bounded.
- **Bend fit:** incremental insertion with topology repair is inherently sequential and mutation-heavy. Batch alternatives (divide-and-conquer Voronoi) exist in theory but are much harder for arcs. Poor fit.
- **Transferable lessons:**
  1. Interpret binary64 inputs exactly (wonky already keeps the SI binary64 words; sketch-lines.md).
  2. Give topology precedence over numerics: never let a numeric decision produce an invalid combinatorial state.
  3. An arc-preserving offset for FDM needs the arrangement plus a winding/distance filter (see [CavalierContours](cavalier-contours-cpp-and-rust.md), [CGAL offset](cgal-boolean-set-operations-2-and-minkowski-offset-wein-2007.md)), not a Voronoi diagram, unless medial-axis queries are wanted.

## Pointers worth porting or studying

- Held & Mann 2011 §2.1-2.3, §3.3.2 (input interpretation, verifier design), Fig. 2-4 (accuracy comparison method: distance-ratio errors per node, verified in GMP rationals). This is a reusable **verification recipe** for any wonky 2D construction.
- Held & Huber 2009 (to read when accessible): arc site handling and conic bisectors in a topology-oriented scheme.
- OpenVoronoi source (LGPL) as a readable topology-oriented incremental implementation for segments.

## Verdict: **learn-from** (offset semantics, verification recipe); **unreachable** as code

Proprietary and sequential; exact arc Voronoi predicates are too heavy for Bend today. Keep it as the reference for what a complete offset family and medial-axis toolkit looks like, and use Held & Mann's verifier methodology and input-interpretation lesson directly.
