"""Smooth-span copies for independent OCCT property integration.

OCCT's adaptive Gauss estimator can report convergence while crossing interior
B-spline knots (it overestimated AC101's extrusion-side area).
Divide a measurement copy at intrinsic surface continuity breaks; callers retain the original
shape for topology, classification, and export. No geometry is approximated.
"""
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS

# OCCT 7 and 8 expose the same downcasts under different binding names.
_face = getattr(TopoDS, "Face_s", None) or TopoDS.Face
from OCP.GeomAbs import GeomAbs_CN
from OCP.ShapeExtend import ShapeExtend_FAIL
from OCP.ShapeUpgrade import ShapeUpgrade_ShapeDivideContinuity


def _needs_partition(shape):
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        surface = BRepAdaptor_Surface(_face(faces.Current()))
        if surface.NbUIntervals(GeomAbs_CN) > 1 or surface.NbVIntervals(GeomAbs_CN) > 1:
            return True
        faces.Next()
    return False


def integration_shape(shape):
    # Surface-property integrands need partitioning at intrinsic surface knots.
    # Knots of a trimming edge alone do not introduce a surface knot break.
    # Upgrading those edges can fail at valid periodic trim seams; leave smooth
    # surface supports intact instead of attempting an unnecessary upgrade.
    if not _needs_partition(shape):
        return shape
    divider = ShapeUpgrade_ShapeDivideContinuity(shape)
    divider.SetBoundaryCriterion(GeomAbs_CN)
    divider.SetPCurveCriterion(GeomAbs_CN)
    divider.SetSurfaceCriterion(GeomAbs_CN)
    changed = divider.Perform()
    if divider.Status(ShapeExtend_FAIL):
        raise ValueError("OCCT_PROPERTY_SPAN_PARTITION_FAILED")
    result = divider.Result() if changed else shape
    if result.IsNull():
        raise ValueError("OCCT_PROPERTY_SPAN_PARTITION_NULL")
    return result
