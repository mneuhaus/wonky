# build123d / OCP loft and sweep failure reports (issue tracker) and the `loft()` wrapper

- Kind: issue tracker + library source.
  - Wrapper: `build123d/topology/utils.py::_make_loft` → `BRepOffsetAPI_ThruSections(filled, ruled)`; `Solid.make_loft(objs, ruled=False)` (`topology/three_d.py` l.1455), `Shell.make_loft` (`two_d.py` l.2707); read in the local clone `wonky-kernel/tmp/research/build123d-topology-selection-select-all-last-new-topo-path/` at `e22d34d` (2026-09-23).
  - Issues read (title, body, maintainer comments): https://github.com/gumyr/build123d/issues/756 , /1469 , /1351 , /1353 , /545 , /1022 , /681 . Titles only: #535, #1354, #1215, #746.
- Authors/organization: Roger Maitland (gumyr) and contributors; OCCT underneath via OCP.
- License: Apache-2.0 (`gh api repos/gumyr/build123d`). Porting ideas is unproblematic.
- Status: active, pushed 2026-09-23, 3197 stars.

## What it is
The field record of OCCT lofts as used by the Python code-CAD community that wonky wants to replace for Marc. The wrapper adds nothing geometric: vertex sections allowed only at the ends, then `ThruSections`; `ruled` defaults to False (smooth).

## How it works (DOCUMENTED)
`_make_loft`: validates vertex placement ("Only two vertices are allowed", "must be at the beginning and end"), builds `BRepOffsetAPI_ThruSections(filled, ruled)`, `AddVertex`/`AddWire`, `Build()`. No matching control, no twist check, no carrier simplification.

## Robustness and guarantees
Inherits OCCT's (see the OCCT loft note): heuristic matching, approximated smooth surfaces, no twist certification.

## Known failures, limitations, war stories (DOCUMENTED from the issues)
- **#756 (closed, 2024-11):** two rectangles lofted into a frustum; the trapezoid side faces are `GeomType.BSPLINE`, so `filter_by(Plane.XZ)` finds nothing. gumyr: "the OCCT CAD kernel returns these BSPLINE faces where a PLANAR face would be more appropriate"; fix was a planarity test (`GeomLib_IsPlanarSurface(surface, 1e-6)`) in the selector, not in the loft.
- **#1469 (open, 2026-09-23, OCCT 8.0.1):** loft of two filleted hexagons (20→12, fillet 4→3). "Every non-planar face of the loft, walls and blends alike, is a degree 7 non-rational B-spline surface with 8×2 poles: `BRepOffsetAPI_ThruSections` re-approximates the sections' arcs rather than keeping them rational, so the blends are only circular to within tolerance and are not cones." `ShapeAnalysis_CanonicalRecognition` finds the walls planar at 1e-6. `offset(..., openings=both caps)` returns an invalid 26-face result (five zero-area planar faces) because `MakeThickSolidByJoin` builds zero-width arc blends at the tangent wall/blend edges.
- **#1351 / #1353 (open, 2026-06):** a rounded loft that offset fine in 0.10 fails in 0.11 (OCCT 7.8→7.9); the loft produces PLANE, CONE and BSPLINE faces while the equivalent extrude+draft gives PLANE and CONE only, and the draft version offsets. #1353 proposes "limited loft surface repair" (recognise analytic faces after lofting).
- **#545 (open, 2024):** `offset(loft([SlotOverall(10,6), Pos(Z=4)*SlotOverall(6,4)]), -0.5)` → invalid shell, then `fix()` throws `Geom_TrimmedCurve::parameters out of range`.
- **#1022 (open):** multi-section sweep ignores profile holes; OCCT `BRepOffsetAPI_MakePipeShell` takes only wires, so holes need separate sweeps and a Boolean; "the same problem exists for loft".
- **#681 (open):** guide curves for sweep not exposed.

## Relevance for wonky
- The recurring pattern is **carrier loss**: lofts that should be planes and cones come out as approximated B-splines, and every downstream operation (selection, offset/shell, Boolean) then pays for it. For FDM parts (shelled funnels, tapered slots, chamfered transitions) this is the typical failure. wonky's carrier classification (addendum P-L1) addresses exactly this, and Onshape shows it is achievable (planes and exact cones in its exports).
- Validity checks do not catch wrong matching (OCCT #1315); wonky needs its own twist/self-intersection certificate.
- LLM ergonomics: build123d users (and LLMs) cannot see which vertices were matched; wonky should expose the matching and each face's carrier in its introspection output.
- Corpus (MEASURED, rg, 2026-09-24): 34 `.py` files in `~/Workspace/cad` contain `loft(`; most are generators that emit FS loft calls; one uses `ruled=True` (`cad-project-003/project-component-abeb2fd3.py`); FreeCAD `Part.makeLoft(…, True, True)` (solid, ruled) appears in `machine-interface-r11/top-entry-r12/geometry.py`. The brief's count of 110 build123d files used a wider pattern or tree (not re-derived).

## Pointers worth porting or studying
#1469's reduction (which faces are approximated, why the offset fails) as a regression case for wonky's future shell/offset; #756 as the simplest carrier-loss test (rectangle frustum must give 4 planes).

## Verdict: learn-from
A catalogue of what to avoid: approximated carriers, silent twist, no matching introspection.
