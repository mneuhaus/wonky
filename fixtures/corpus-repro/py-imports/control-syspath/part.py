# Control, not a failure: the runner sets __file__ correctly, only sys.path
# lacks the model directory. Adding it by hand (8 unique corpus files do)
# makes the sibling import work under today's runner.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build123d import *
from helpers import WIDTH

result = Box(WIDTH, 10, 5)
