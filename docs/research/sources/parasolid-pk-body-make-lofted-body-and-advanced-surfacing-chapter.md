# Parasolid `PK_BODY_make_lofted_body` and the "Advanced Surfacing" chapter (sweep, loft, matching, simplification)

- Kind: official vendor documentation (Parasolid v12.0 era, mirrored on q-solid.com).
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_body_make_lofted_body.html (HTTP 200, 2026-09-24)
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_body_make_lofted_body_o_t.html
  - http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.28.html ("Advanced Surfacing": 27.2 Sweeping, 27.3 Lofting, 27.3.6 Matching, 27.3.8 Simplification)
  - http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.14.html ("Local Ops: Spinning or Sweeping an Entity")
  - Also downloaded, not yet read in full: `pk_body_make_swept_body.html`, `pk_body_loft_deriv_conds_t.html`, `pk_body_loft_matches_t.html`, `pk_body_profile_match_t.html`.
  - Local copies + text: `wonky-kernel/tmp/research/parasolid-loft/`.
- Authors/organization: Siemens (formerly EDS/Unigraphics) Parasolid team. The mirror is an old release (v12.0 titles); the PK function and option names match what Onshape's `opLoft` exposes today (`LoftTopology` MINIMAL/COLUMNS/GRID = `PK_BODY_topology_minimal_c/columns_c/grid_c`).
- License: proprietary documentation. Ideas and documented semantics may be re-implemented; no code is available or copied.
- Status: stable API family; Parasolid v35+ still ships `PK_BODY_make_lofted_body` (see the existing `overview-of-parasolid-v35-july-2022.md` note for the version line).

## What it is
The semantic spec of the kernel behind Onshape's loft and sweep. It is the closest thing to a definition of what `@opLoft` does.

## How it works (DOCUMENTED)
- **Profiles:** wire, sheet or minimum (point) bodies. Point profiles only at the ends. All open or all closed. Wires must be oriented; "All the profiles should have the same orientation in order to avoid twist in the result." Each profile needs ≥1 vertex (`PK_EDGE_imprint_point` to add one). "A start vertex must be supplied for each profile. The start vertices for the profiles should be aligned to avoid twist in the result" (Figure 27-10). Sheet end profiles give a solid.
- **Matching (27.3.6):** "Where all the profiles in the loft have the same number of edges, and hence the same number of vertices, the vertices are mapped one-to-one across the profiles. All start vertices are matched with each other, then subsequent vertices on each profile are matched in order (i.e. nth vertices are matched)." With different counts the caller must either imprint extra vertices or supply `PK_BODY_loft_matches_t`. Legal maps: only between neighbouring profiles; every vertex matched at least once to each neighbour; intermediate-profile vertices exactly once; "Paths must not cross over"; a vertex repeated in a map means a degenerate section inserted at that vertex.
- **Errors:** `PK_ERROR_bad_profile_matching` ("The vertex matching information couldn't be incorporated into a non-intersecting collection of curves interpolating vertices along the loft direction"), `PK_ERROR_bad_end_conditions`, `PK_ERROR_loft_failed` ("internal algorithmic failure"). The result struct carries a fault type, a fault point and fault topology.
- **Topology form (27.3.7):** minimal ("Profile edges which meet smoothly may be lofted into a single face"), columns, grid ("n_profiles − 1 faces … for each set of corresponding profile edges").
- **Simplification (27.3.8):** `PK_BODY_simplify_yes_c` (default) — "The lofted surfaces may be replaced where the combination of loft profile geometries produces an analytic simplification of the loft. If the surface of a face is simplified, the edges of the face may be simplified as well." `simplify_no_c` → always B-surfaces. "Simplification is performed on the entire surface of each face and does not alter the topology."
- **End/intermediate/guide derivative conditions:** unconstrained (default), natural (zero curvature), vector/face/planar clamps, periodic flag; guide wires must be G1, pass through matched vertices, and are interpolated as iso-parameter curves; clamps with magnitude are forbidden at guided vertices.
- **Tracking:** each lateral face records the profile edges it depends on; cap faces map to the copied profile face.
- **Sweep (27.2):** profile wire/sheet along an oriented path wire; non-G1 path corners give mitred corners; alignment `parallel` (constant orientation) or `normal` (default; frame adjusted at G2 breaks); twist/scale laws as values per path vertex or a B-spline law on [0,1] proportional to arc length ("cannot be applied along a non-smooth path"); topology minimal/columns/grid; simplification as for loft; **self-intersection repair**: "When a sweep results in a body that intersects itself, Parasolid attempts to repair the body … Locally self-intersecting surfaces and clashes between adjacent faces are not repaired."
- **Spin/sweep local ops (fd_chap.14):** "Any new surfaces created are analytic surfaces if possible"; otherwise swept/spun procedural classes or B-surfaces; spun B-geometry is "rational cubics, creating one patch for each 180 degrees of spin".

## Robustness and guarantees
Semantics only. No statement on tolerances, on how the non-simplified surface is fitted, or on how Onshape picks start vertices. The documented failure modes (bad matching, crossing matches, local self-intersection not repaired) are the checks wonky must perform itself.

## Parallelism and performance
Not documented.

## Known failures, limitations, war stories
- Twist is the user's problem: the kernel matches nth-to-nth from the given start vertices; misaligned start vertices twist the result without an error (Figure 27-10).
- Local self-intersections of swept surfaces are explicitly not repaired.

## Relevance for wonky
- Gives wonky an exact, testable matching rule for equal vertex counts (the whole corpus except square-to-circle) and a precise legality rule for explicit matches (a monotone staircase path over the m×n vertex grid, the same structure as Sederberg-Greenwood's and Fuchs-Kedem-Uselton's graphs; INFERRED equivalence).
- "Simplify where the combination of profile geometries produces an analytic simplification" is confirmed by Onshape exports (planes, cones). The hyperbolic paraboloid is not in Parasolid's analytic set, so twisted sides stay B-surfaces.
- Error model: wonky should mirror the fault classes (`bad_profile_matching` with a witness point, `bad_end_conditions`) in its capability errors.
- Bend fit: the rules are combinatorial on small inputs; nothing numerically heavy.

## Pointers worth porting or studying
27.3.6 matching legality rules and Figure 27-15; 27.3.8 simplification wording; 27.2.9 self-intersection repair limits; `PK_BODY_loft_matches_t` (not yet read) for the explicit-match data layout.

## Verdict: adopt (semantics)
It is the definition behind Onshape's loft. Re-implement the matching rules and the error classes; derive the geometry independently.
