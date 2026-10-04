"""CE9 independent OCCT twin: keep a primitive parameter seam off the blend.

Only the cylindrical parametrization changes; radius, axes, spans and the
native Boolean/fillet operations retain the catalog geometry. Historical twins
and their frozen observations are preserved byte-for-byte.
"""
import math
from build123d import Solid
from acid_blend import _zone, _label, _cylinder, _nearest_edge, frame_for


def cylinder_with_seam(frame, radius, span, axis, seam_direction):
    """Place an analytic cylinder's periodic seam along a local radial vector.

    Project the requested direction into the radial plane. This is a general
    primitive-frame mechanism, independent of any catalog zone or family.
    """
    length = math.sqrt(sum(x*x for x in axis))
    normal = tuple(x / length for x in axis)
    axial = sum(a*b for a, b in zip(seam_direction, normal))
    radial = tuple(d - axial*n for d, n in zip(seam_direction, normal))
    if sum(x*x for x in radial) == 0:
        raise ValueError('cylinder seam direction must not be parallel to its axis')
    base = tuple(span[0]*x for x in normal)
    return Solid.make_cylinder(radius, span[1]-span[0], frame.plane(base, radial, normal))


def build(variant, zone='AC36'):
    if zone != 'AC36':
        raise ValueError(f'unsupported CE9 twin zone {zone}')
    params = _zone('AC20')['construction']['params']
    axes = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}
    post, branch = params['C1'], params['C2']
    frame = frame_for(zone, variant)
    # The seam faces away from the neighbouring cylinder's axis, rather than
    # passing through the rolling-ball patch and splitting its periodic face.
    a = cylinder_with_seam(frame, post['R'], post['span'], axes[post['axis']],
                           tuple(-x for x in axes[branch['axis']]))
    b = _cylinder(frame, branch['r'], branch['span'], branch['axis'])
    united = a.fuse(b)
    edge = _nearest_edge(united, frame, (math.sqrt(48), 4, 0))
    blended = united.fillet(_zone(zone)['construction']['params']['radius'], [edge])
    return _label(zone, variant, [blended])
