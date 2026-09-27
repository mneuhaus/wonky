"""Why wonky does not provide the external packages the corpus imports.

Data for the runner's capability error at an unavailable import (decision 3,
docs/python-khana.md). The runner's finders enforce the policy; this table only
adds the package-specific reason to the message; any other installed package
gets only the general policy. Packages that wonky provides are the top-level
entries of this directory (build123d, cad_khana, ocp_vscode).
"""

POLICY = "docs/python-khana.md"

# OCP, OCC and cadquery never get here: the runner's external-geometry guard
# refuses them first ("production geometry must be constructed in Bend").
REASONS = {
    "bd_warehouse": ("its threads, fasteners, bearings and pipes are built by the real build123d on "
                     "OpenCascade; wonky provides no Bend port of it"),
    "ocp_tessellate": "it tessellates OpenCascade shapes for the OCP viewer",
    "trimesh": "wonky exports meshes itself (bin/wonky-python.mjs --format all)",
    "pytest": "pytest modules are test suites, not models; wonky builds models",
}


def reason(package):
    """The package-specific reason, or None for packages without an entry."""
    return REASONS.get(package)
