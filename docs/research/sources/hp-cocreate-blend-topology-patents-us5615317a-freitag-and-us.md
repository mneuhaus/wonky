# HP/CoCreate blend-topology patents: US5615317A (Freitag) and US6133922A (Opitz), both expired

## Source data

- **Kind:** two US patents, read in full from Google Patents. Local copies are in `tmp/research/blend-patents/`: `US5615317A.{html,txt,abstract.txt,description.txt,claims.txt}` and the same set for US6133922A.
- **Paragraph references:** these patents have no official paragraph numbers. "¶n" in this note is the 1-based line number in the local `*.description.txt`, where there is one paragraph per line.
- **US5615317A**, "Method for blending edges of a geometric object in a computer-aided design system": https://patents.google.com/patent/US5615317A/en
  - Inventor: Stefan Freitag. Original assignee: Hewlett-Packard.
  - Priority 1993-10-11. Family: EP0649103A1/B1, DE69324363, JP3599386B2.
  - US filing 1996-05-31, a continuation of Ser. No. 08/280,808 filed 1994-07-26. Granted 1997-03-25.
  - Google lists it as "Expired - Lifetime", anticipated expiration 2014-07-26.
  - Current assignee: PTC Inc. The HP → PTC assignments were recorded 2009 and renamed 2013.
- **US6133922A**, "Method of integrating a blend or chamfer surface replacing an edge of a geometrical body into a solid model": https://patents.google.com/patent/US6133922A/en
  - Inventor: Karsten Opitz. Original assignee: Hewlett-Packard.
  - Priority 1996-10-17 (EP96116708A, granted as EP0837430B1). US filing 1997-09-18. Granted 2000-10-17.
  - "Expired - Lifetime", anticipated expiration 2017-09-18. Current assignee: PTC Inc.
  - All of the above is DOCUMENTED from the Google Patents pages. Both pages still returned HTTP 200 on 2026-09-24.
- **Product lineage:**
  - Both patents name HP's "PrecisionEngineering SolidDesigner", versions 1.0 and 4.0 respectively. DOCUMENTED.
  - SolidDesigner later became CoCreate OneSpace Modeling and then PTC Creo Elements/Direct. HEARSAY: well known, not verified here.
  - Prior art the patents cite: Braid's Cambridge CAD Group notes (1979) and Braid et al. "Stepwise Construction of Polyhedra" (1980) for the first; Mäntylä's "An Introduction to Solid Modeling" (1988) for Euler operators in the second. DOCUMENTED.
- **License and porting:**
  - Both patents are **expired**, so the claimed methods are free to implement. Patent text is public.
  - The HP/CoCreate code itself is proprietary and unavailable, so there is nothing to port.
  - Implementing these algorithms carries no licence obligation. INFERRED. This is not legal advice, but expiry is DOCUMENTED on Google Patents.
- **Status:**
  - Historical.
  - Google Patents lists later citing patents from Dassault Systèmes (US20110282632A1 "Method of Computer-Aided Design of Edges Connecting Faces of a Modeled Object"), Siemens PLM (US9690878B2, US20100305906A1, US20120271595A1), Geomagic (US8004517B1), Adobe and others.
  - US5615317A is cited by US6133922A. DOCUMENTED ("Cited By" lists).

## What it is

Two concrete, step-by-step recipes for the **topological** half of edge blending: integrating an already-computed blend or chamfer surface into a B-rep. Papers mostly skip this half.

- **US5615317A (1993)** handles blends whose neighbours **shrink or vanish**. It walks the edges around each end vertex of the blended edge. Every edge that the blend boundary or blend surface does not hit is deleted with Euler operators (`kev`, and `kbfv` for faces that lose all their edges). The blend face is then inserted between the intersection points found.
- **US6133922A (1996)** generalises this to neighbours that **grow**: faces that must extend, or merge with, originally disjoint faces. It deliberately puts the body into a *geometrically inconsistent* intermediate state. It then closes each "gap" with a **trimming path** found by **depth-first search with backtracking** over intersection-curve segments, and only afterwards applies the topology change. It works for one or several blends at once, and for any single-loop hole in a solid.
- The second patent states the first one's limitation. Its "known method" handles only topologies that "always shrink … this known method is however not capable of handling situations in which existing edges or faces grow". INFERRED: the "known method" is US5615317A, since it is the same company and US5615317A appears in the citation list.

## How it works

### Shared vocabulary

- The **blended edge** is E, with start vertex SV and end vertex EV.
- LF and RF are the faces left and right of E.
- The blend surface BS or F is bounded by the **left and right boundaries** LB and RB (in the second patent, the *primary boundaries* ep1 and ep2). For a rolling ball these are the two contact (spring) curves. DOCUMENTED: US6133922A, FIG. 2b text.
- Winged-edge B-rep with Euler operators (Braid; Mäntylä):
  - `KEV` (kill edge and vertex)
  - `KBFV` (patent: "kill object face vertex", i.e. remove an edge, a face and a vertex)
  - `ADEF` (add edge and face)

### US5615317A: shrink-only integration

The algorithm (FIG. 3–5, claim 1). DOCUMENTED.

1. Select E and the blend type (constant or variable radius, or chamfer). Compute **LB and RB** by intersecting the desired blend surface with the object (block 31).
2. **Sub-algorithm A1**, run for V = SV and then V = EV. It trims the boundaries:
   - a. On LF, take the edge LE that ends in V, other than E, and intersect it with LB.
   - b. If there is no intersection, **`kev(LE)`** and repeat (a) with the new edge that now ends in V.
   - c. Do the same on RF with RB.
   - Result: four boundary intersection points S1…S4.
3. Compute the blend surface BS (block 36).
4. **Sub-algorithm A2**, run for V = SV and then V = EV. For each face F that owns V, is not adjacent to E and is not yet processed:
   - a. Take the edge EF of F that ends in V. **Intersect it with BS using the edge's *original* 3D curve.** After earlier `kev`s the edge's topology has been "pulled" to V (the patent calls it "elastic bands"), but its geometry is still the original curve.
   - b. On a hit, mark F processed.
   - c. Otherwise **`kev(EF)`**. If F has no edges left, **`kbfv(F)`**, which removes the face entirely ("swallowed").
5. **Sanity check:** count the intersections found against the known expected number (block 41).
6. Insert BS trimmed at the intersection points, and connect the points with new edges (block 42).

Notes:
- Claim 2 names the rule: delete edges and faces "made external to the geometric object by the blend surface geometry and have no intersection with the blend surface".
- FIG. 6 and 7 are worked examples. In FIG. 7 a whole face F is removed by `kbfv` after its last edge W5 misses BS.
- The surface type is irrelevant to the procedure: constant radius, variable radius or chamfer (claims 4 and 5).

### US6133922A: gaps, trimming paths, DFS

The overall flow (FIG. 2, FIG. 3, claim 1). DOCUMENTED.

1. **Geometry first, without touching the body** (FIG. 2b–c):
   - Create the primary surface F and the primary boundaries ep1 and ep2.
   - Trim the boundaries: walk the edges of RF from SV (e1, e2, …) and intersect each with ep1 until one hits. The hit is RV on edge RN. Mark the missed edges. Do the same on LF to get LV on LN.
2. **Remove the marked edges with `KEV`** (FIG. 2d–g). The neighbouring edges are pulled into SV.
   - RN is pulled "such that the vertex and the respective intersection point are connected", so the part of RN beyond RV stays intact (claim 3).
   - The body is now **geometrically inconsistent**. Topologically adjacent edges no longer meet geometrically; the patent draws them dashed.
3. **`ADEF`**: replace E by the new face F (the "banana-shaped" face) bounded by RB and LB plus inconsistent edges. Mark F as a blend face.
4. **General routine per vertex** (FIG. 3):
   - **O1, collect primary gaps.** For each blend face Fᵢ containing V, take edge I (starts at V) and edge O (ends at V). If `start(I) ≠ end(O)` geometrically, Fᵢ has a **gap** (FIG. 4a, claim 6).
   - While gaps remain:
     - **O2:** compute a trimming path for the gap.
     - **O3:** integrate the path topologically and mark new gaps.
     - **O4:** collect **secondary gaps** on non-blend faces around V (same test, FIG. 4b).
   - Shrinking faces get trimmed "as a side-effect". Growing faces are the ones that end up in the gap list.
5. **O2, trimming path = DFS over curve segments** (FIG. 8–9, claims 1 and 7).
   - Nodes are curve segments. The start node is one boundary edge (RB) and the end node is the other (LB).
   - The search is symmetric. If it fails from RB, it can be rerun from LB.
   - **Preprocessing, "ray shooting":** the endpoints of the start and end edges may be wrong, because an edge is too short after the pulls.
     - Treat the edge as a semi-infinite ray and intersect it with all *open* faces around its end vertex. **The hit that makes the edge shortest** is its new endpoint.
     - Extending an edge marks the adjacent face as **growing**.
     - The extension alone may close the gap.
   - **Child generation (D1).** Input: current end point EP and current face Fc.
     - a. Intersect the gap face's surface with Fc's surface (an SSI).
     - b. Keep the curves through EP. Split each into **two semi-curves** leaving EP in opposite directions.
     - c. Intersect each semi-curve with the edges of Fc.
       - If there is a hit **inside an original edge**, create one child (EP → I).
       - Otherwise intersect the semi-curve with **all open faces around V** and create one child per hit.
   - **Ordering heuristic** (claim 7):
     - Sort the semi-curves by the **angle to the parent segment measured inside face F**; the smallest angle gets the highest priority.
     - Within the best semi-curve, take the **shortest segment** first.
   - **Validity check at every level:** (i) the partial path must not self-intersect; (ii) it must not cross existing edges. If either fails, drop the last node and **backtrack**.
   - **Why geometry and topology are separated:** "the inverse of topological operations is in general … not unique". If partial paths were integrated, they could not be undone. So the full path is found first, and only then integrated.
6. **O3, integrate a path** (FIG. 11, claim 8). For each successor segment Sᵢ, whose face is Fᵢ:
   - Rotate counter-clockwise around the current vertex to Fᵢ's edge eᵢ.
   - If Sᵢ intersects an original edge e_int of Fᵢ, then **Fᵢ shrinks**: kill all edges between eᵢ and e_int.
   - Otherwise **Fᵢ grows**: mark it as having a gap.
   - Create a new edge e_new between F and Fᵢ.
   - Edges between the current edge and eᵢ move to e_new's start vertex. The rest move to its end vertex.
   - Continue until the end node.
7. **Worked example** (FIG. 5, 10–17), five iterations:
   - Gap on F closed by edges C0 and C1 → F1 marked.
   - F1: R1 extended by ray shooting to V1 on F4, then path [(V1,V2),(V2,V0)] → F2 and F4 marked.
   - F2: R2 extended to V3, then edge C4 → F3 marked.
   - F3 and F4 closed by ray-shooting extensions alone.
   - F5 is never marked; it is trimmed as a by-product.
8. **Multiple blends at once** (FIG. 18): three edges blended simultaneously. The original faces B and H grow until they "actually become one common face".

The patent's own list of "important features":
- each face is trimmed independently while other faces are still open;
- new gaps are detected while trimming, so shrinking vs growing never has to be classified in advance;
- geometry is separated from topological integration;
- the search handles several open faces;
- the integration step both grows and swallows topology.

DOCUMENTED, description ¶¶158–163.

## Robustness and guarantees

- **Claims, not proofs.**
  - The 1993 patent claims universality: "no limitations regarding edges which have to be deleted … can be applied for all possible geometric objects and shapes of the blend surface".
  - The 1996 patent contradicts this for growing topology, and claims its search "guarantees a global consistent body" when a valid path is found.
  - Neither patent states tolerances, analyses complexity, or says what happens if the DFS exhausts without a path. INFERRED: then the operation fails.
- **Heuristic parts** (INFERRED from the text):
  - The child ordering (smallest angle, then shortest segment) is a local greedy heuristic, which the text admits: "the sorting is basically a local decision".
  - Ray shooting's "hit that makes the edge shortest" assumes the nearest open face is the right one.
  - The gap test `start(I) ≠ end(O)` is a geometric equality, which in practice needs a tolerance. The patent does not give one.
- **Exactness hazards:**
  - Tangential or grazing intersections (semi-curve vs edge, and the blend boundary touching an edge exactly at a vertex) decide *which* child exists.
  - In wonky these decisions must go through exact or filtered predicates, or return an explicit ambiguity error. INFERRED.

## Parallelism and performance

- Nothing is stated in either patent. The algorithms are sequential per vertex.
- INFERRED:
  - The two end vertices SV and EV are handled symmetrically and independently until the final face insertion (first patent) or the final gap closure (second patent). That is a natural two-way fork-join.
  - Disjoint vertices of a multi-blend could also run in parallel if their gap regions do not share faces.
  - The DFS itself is irregular, branchy search: CPU-side Bend, not GPU.
  - The SSI and curve/surface intersections inside child generation are the expensive leaves. For wonky's quadric pairs they are closed form and could be batched per level.

## Known failures, limitations, war stories

- The 1996 patent's background states the industry failure mode: "Certain special cases of growing topologies are implemented but more complicated ones are not handled reliably. This either leads to a failure of the entire blend operation … or to the creation of a body which is actually not manufacturable". DOCUMENTED, ¶29.
- FIG. 7 of the 1996 patent shows that local choices can produce a **non-manifold** result (FIG. 7c). The validity check plus backtracking exists specifically to reject it. DOCUMENTED, ¶¶122, 139.
- The first patent's background: prior systems "produce an error message … that the blending operation cannot be performed" whenever the blend reaches past short edges. That forced users to remodel without short edges. DOCUMENTED, ¶¶11–12.
- Neither patent covers vertex blends (n-sided corner patches), setbacks or miters. They integrate *one surface per edge*. Multiple simultaneous blends are handled only as simultaneous gap closing. DOCUMENTED by absence.

## Relevance for wonky

INFERRED throughout.

- **Where it plugs in: fillet stage 2.** Wonky can attach a computed blend in two ways:
  - **(a) Boolean route.** Build a closed tool body from the blend surface, the two support planes and caps, then subtract it (convex edge) or union it (concave edge) with the hybrid Boolean.
  - **(b) Local surgery, as these patents do.**
  - Route (a) reuses the Boolean, but needs careful caps and yields weaker face identity. Route (b) preserves **face identity and provenance** explicitly. The patents literally classify every neighbour as shrinking, vanishing (killed, "swallowed") or growing. Those are exactly the provenance events wonky's topology-identity layer and review/diff viewer want to report, for example "F4 grew and merged with F7", "F1 swallowed by fillet F".
  - A pragmatic plan: route (a) for correctness, then use the patents' classification logic to *derive* the provenance by comparing before and after around each end vertex.
- **Immutability is an advantage here.** The second patent separates geometry from topology *because* topological edits are not uniquely invertible, so it cannot backtrack. In wonky's persistent (immutable) B-rep, backtracking is free: keep the old version. So the DFS can interleave tentative integration with validation, and even validate complete candidate bodies. Keep the separation anyway, for determinism and clearer diagnostics.
- **Euler operators as pure rewrites.**
  - `KEV` (merge an edge's end vertex into its start and splice the loops), `KBFV` and `ADEF` become pure functions `Body → Body` on wonky's immutable arrays.
  - The patents' "topology pulled, geometry stale" intermediate state maps to an explicit *pending-geometry* flag per edge. It must never escape the operation.
  - Invariant to enforce at exit: no edge has pending geometry, and every loop is geometrically closed (the O1/O4 gap test holds everywhere).
- **Ready-made test oracle.** The O1/O4 gap test (for every face and vertex, the incoming edge's geometric end equals the outgoing edge's geometric start) is a cheap post-condition for *any* wonky operation that edits topology locally.
- **FDM relevance.** Short edges next to fillet edges are common in printed parts: chamfered corners, small steps, bosses near walls. The "blend swallows short edges and faces" case in FIG. 2 and FIG. 8 of US5615317A is exactly the case where naive fillet implementations fail and users remodel. Supporting at least the shrink/swallow case of the first patent covers a large share of real FDM fillets.
- **Bend fit.**
  - The graph walks are irregular and sequential; fine for CPU-side Bend fork-join (SV ∥ EV).
  - Precision:
    - The intersections inside the walks are plane/line, plane/cylinder and similar, and are exact or closed-form in F32x2.
    - The branch decisions (does the boundary hit this edge, and is the hit *inside* the original edge or at its end) need exact predicates, or explicit "ambiguous" failures, at the edge endpoints.

## Pointers worth porting or studying

- US5615317A: FIG. 3 (overall), FIG. 4 (A1, boundary trimming with `kev` loops), FIG. 5 (A2, surface–edge intersections with `kev`/`kbfv`); description ¶¶46–49 give the exact block logic; FIG. 6–7 are worked examples; claim 2 is the deletion rule.
- US6133922A:
  - ¶¶93–107: the initial steps, including the "pulled" edges and ADEF.
  - FIG. 4a/4b: the gap tests.
  - FIG. 8: the DFS.
  - FIG. 9, claim 1 h3: child creation with semi-curves.
  - Claim 7: the angle-then-length ordering.
  - ¶¶139–141: the validity checks and why integration waits for the full path.
  - FIG. 11 and claim 8: integrating a path, with the shrink/grow decision per face.
  - ¶¶149–150: ray shooting.
  - ¶¶158–163: the design rationale list.
- Braid 1979/1980 and Mäntylä 1988 give the Euler operator definitions both patents assume. See the Mäntylä 1986 Boolean note for the operator set.

## Verdict: adapt

- Both patents are **expired**, and they are the most concrete public description of the topological integration step of edge blending, including neighbours that grow.
- **Adapt:**
  - the shrink/swallow walk (US5615317A) as wonky's first local blend-attachment path, or as a provenance classifier on top of the Boolean route;
  - the gap concept, the pending-geometry state and the DFS trimming path (US6133922A) for growing neighbours and multi-blend.
- Re-express the Euler edits as pure rewrites, replace the implicit equality tests with exact or filtered predicates plus explicit ambiguity errors, and exploit persistence for backtracking.
- These are not complete fillet engines: there are no vertex blends, setbacks or miters. Pair them with ACIS/Parasolid/OCCT vertex-blend knowledge.
