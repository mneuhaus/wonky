"""Use the pinned, unmodified backend as the independent wire client."""
import os
from pathlib import Path
import sys

BACKEND = Path(os.environ.get("TWIN_SORTER_ROOT", "<repo>/tmp/twin-sorter/8bd54541")) / "software/sorter/backend"
sys.dont_write_bytecode = True  # The pinned source archive is read-only, including caches.
if (BACKEND / "hardware/bus.py").is_file():
    sys.path.insert(0, str(BACKEND))
