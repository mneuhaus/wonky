The unchanged files in `upstream/` are from Open CASCADE Technology (OCCT),
Open CASCADE SAS and other contributors, at revision
`3d097a0328e71b826377d4814ab05ec3c3d23871` of
<https://github.com/Open-Cascade-SAS/OCCT>.

They are distributed under GNU LGPL version 2.1 with the Open CASCADE exception.
The original `LICENSE_LGPL_21.txt`, `OCCT_LGPL_EXCEPTION.txt`, and `README.md`
are preserved in `upstream/`. Each original file and FeatureScript adaptation
has a SHA-256 in `manifest.json` with its upstream URL and the modifications.

The files in `adapted/` are local FeatureScript adaptations made on 2026-09-22,
under the same license as the originals. All operand coordinates, profiles,
sweep directions, dimensions, rotation axes/centers/angles, and the final
Boolean operations are retained. Tcl vertex/edge/wire/face construction is
expressed as a closed sketch and extrusion, and one original coordinate unit
is mapped to one millimeter. `trotate` becomes a rigid `opPattern` instance
followed by deletion of the unrotated body. This changes construction APIs,
not the requested operand geometry.

The original DRAW harness and `checkview` screenshot checks are not executed.
The numeric `checkprops result -s` values are retained as independent STEP
surface-area oracles, with explicit local comparison tolerances for the
rounded upstream values. `tests/boolean/begin` is frozen for context; it
loads DRAW, sets time/image defaults and `SCALE`, and supplies no operands.
No selected test uses `SCALE` or requires an external BREP/RLE operand.

This is a six-case adapted regression slice, not execution or a pass claim
for the OCCT test suite. Unsupported operations are failures of this slice.
