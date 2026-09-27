# Corpus: all 12 corpus files that call Color(...) are cad_khana files (48
# calls: sRGB float triples, '#rrggbb' strings; the cad-khana skill's models
# also write Color(0x...) and named colors). wonky's build123d.Color is
# python/_wonky_color.py; the part's appearance is tuple(Color(0x4A6E8A)).
from build123d import Box, Color

from cad_khana.mechanism.assembly import Assembly

assembly = Assembly().with_part("hood", Box(40, 30, 20), color=Color(0x4A6E8A))
