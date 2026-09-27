# Corpus: cad_khana assemblies (cad-project-033, cad-project-048, cad-project-026,
# ...). Named parts from a project module, placed with Pos, colored, with a
# sub-assembly and declared assertions; the module-level `assembly` is the
# result, as Marc's watch.py reads it. Colors are (r, g, b) tuples here because
# the corpus' build123d Color is not implemented by the shim yet
# (see ../corpus-color).
from build123d import Pos

from cad_khana.mechanism.assembly import Assembly

import parts

TRAY = (0.77, 0.65, 0.49)
HOOD = (0.29, 0.43, 0.54)

pins = (
    Assembly()
    .with_part("pin_left", parts.build_pin(), location=Pos(-15, 0, 0), color=(0.8, 0.44, 0.13))
    .with_part("pin_right", parts.build_pin(), location=Pos(15, 0, 0), color=(0.8, 0.44, 0.13))
)

assembly = (
    Assembly()
    .with_part("tray", parts.build_tray(), color=TRAY, material="pla")
    .with_part("hood", parts.build_hood(), location=Pos(0, 0, 40), color=HOOD)
    .with_part("tray_slid_out", parts.build_tray(), location=Pos(0, 25, 0), color=TRAY + (0.5,))
    .with_subassembly("pins", pins, location=Pos(0, 0, 3))
    .assert_no_interference("tray", "hood")
    .assert_clearance("tray", "hood", min_mm=10)
)
