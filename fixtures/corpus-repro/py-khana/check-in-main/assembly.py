# Corpus: 16 cad_khana files call check() (26 assembly.py files do it in their
# `if __name__ == "__main__":` block). wonky runs a model like
# `python model.py`, so the block runs and check() fails as a capability at its
# call line; the assembly itself builds.
from build123d import Box, Pos

from cad_khana.mechanism.assembly import Assembly
from cad_khana.mechanism.check import check

assembly = (
    Assembly()
    .with_part("base", Box(20, 20, 4))
    .with_part("lid", Box(20, 20, 2), location=Pos(0, 0, 10))
    .assert_no_interference("base", "lid")
)

if __name__ == "__main__":
    check(assembly, out="outputs")
