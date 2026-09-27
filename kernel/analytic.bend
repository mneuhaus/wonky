import Base
import ./precise.bend as G
import ./real.bend as R
import ./topology.bend as T

# Analytic input geometry. Loops retain holes and periodic boundaries; curve
# sense is independent of coedge direction and face/surface orientation.
type Curve is Data:
  Line{origin: G.Vec3, direction: G.Vec3}
  Circle{origin: G.Vec3, normal: G.Vec3, x: G.Vec3, radius: R.Real}
  Ellipse{origin: G.Vec3, normal: G.Vec3, x: G.Vec3, major: R.Real, minor: R.Real}

# Sphere: centre, polar axis, seam direction and radius; axis and x fix the
# parametrisation (longitude from x about the axis, latitude toward it).
# Torus: centre, axis, seam direction, the radius of the tube centre circle
# (major) and the tube radius (minor). Its point set here is
# (rho - major)^2 + h^2 = minor^2, rho the distance from the axis: for a
# spindle torus (minor > major) only the sheet on the tube centre side, which
# is all that revolve builds. No comment lines inside a type body:
# scripts/native-bridge/gen-wire.mjs reads constructors as consecutive lines.
type Surface is Data:
  Plane{origin: G.Vec3, normal: G.Vec3, x: G.Vec3}
  Cylinder{origin: G.Vec3, axis: G.Vec3, x: G.Vec3, radius: R.Real}
  Cone{origin: G.Vec3, axis: G.Vec3, x: G.Vec3, radius: R.Real, angle: R.Real}
  Sphere{origin: G.Vec3, axis: G.Vec3, x: G.Vec3, radius: R.Real}
  Torus{origin: G.Vec3, axis: G.Vec3, x: G.Vec3, major: R.Real, minor: R.Real}

type Edge is Data:
  Edge{start: U32, end: U32, curve: Curve, same_sense: Bool}

type Loop is Data:
  Loop{outer: Bool, uses: List<&2, T.Coedge>}

type Face is Data:
  Face{surface: Surface, same_sense: Bool, loops: List<&2, Loop>}

type Solid is Data:
  Solid{vertices: List<&2, G.Vec3>, edges: List<&2, Edge>, faces: List<&2, Face>}

def axis_x(+n: G.Vec3) -> G.Vec3:
  G.V3{nx, _, _} = n
  +candidate = Bool.pick(G.Vec3, R.less(R.abs(nx), R.from_f32(0.9)), G.v3(1.0, 0.0, 0.0), G.v3(0.0, 1.0, 0.0))
  G.normalize(G.sub(candidate, G.scale(n, G.dot(candidate, n))))

def circle(origin: G.Vec3, normal: G.Vec3, x: G.Vec3, radius: R.Real) -> Curve:
  Circle{origin, G.normalize(normal), G.normalize(x), radius}

def ellipse(origin: G.Vec3, normal: G.Vec3, x: G.Vec3, major: R.Real, minor: R.Real) -> Curve:
  Ellipse{origin, G.normalize(normal), G.normalize(x), major, minor}

def plane(origin: G.Vec3, normal: G.Vec3) -> Surface:
  +n = G.normalize(normal)
  Plane{origin, n, axis_x(n)}

def cylinder(origin: G.Vec3, axis: G.Vec3, radius: R.Real) -> Surface:
  +n = G.normalize(axis)
  Cylinder{origin, n, axis_x(n), radius}

def cone(origin: G.Vec3, axis: G.Vec3, radius: R.Real, angle: R.Real) -> Surface:
  +n = G.normalize(axis)
  Cone{origin, n, axis_x(n), radius, angle}

def point_transform(p: G.Vec3, rotation: G.Rotation, offset: G.Vec3) -> G.Vec3:
  G.add(G.rotate(p, rotation), offset)

def curve_transform(curve: Curve, +rotation: G.Rotation, offset: G.Vec3) -> Curve:
  match curve:
    case Line{origin, direction}:
      Line{point_transform(origin, rotation, offset), G.rotate(direction, rotation)}
    case Circle{origin, normal, x, radius}:
      Circle{point_transform(origin, rotation, offset), G.rotate(normal, rotation), G.rotate(x, rotation), radius}
    case Ellipse{origin, normal, x, major, minor}:
      Ellipse{point_transform(origin, rotation, offset), G.rotate(normal, rotation), G.rotate(x, rotation), major, minor}

def surface_transform(surface: Surface, +rotation: G.Rotation, offset: G.Vec3) -> Surface:
  match surface:
    case Plane{origin, normal, x}:
      Plane{point_transform(origin, rotation, offset), G.rotate(normal, rotation), G.rotate(x, rotation)}
    case Cylinder{origin, axis, x, radius}:
      Cylinder{point_transform(origin, rotation, offset), G.rotate(axis, rotation), G.rotate(x, rotation), radius}
    case Cone{origin, axis, x, radius, angle}:
      Cone{point_transform(origin, rotation, offset), G.rotate(axis, rotation), G.rotate(x, rotation), radius, angle}
    case Sphere{origin, axis, x, radius}:
      Sphere{point_transform(origin, rotation, offset), G.rotate(axis, rotation), G.rotate(x, rotation), radius}
    case Torus{origin, axis, x, major, minor}:
      Torus{point_transform(origin, rotation, offset), G.rotate(axis, rotation), G.rotate(x, rotation), major, minor}

def edges_transform(edges: List<&2, Edge>, +rotation: G.Rotation, +offset: G.Vec3) -> List<&2, Edge>:
  match edges:
    case Nil{}:
      Nil{}
    case Edge{start, end, curve, sense} <> tail:
      Edge{start, end, curve_transform(curve, rotation, offset), sense} <> edges_transform(tail, rotation, offset)

def faces_transform(faces: List<&2, Face>, +rotation: G.Rotation, +offset: G.Vec3) -> List<&2, Face>:
  match faces:
    case Nil{}:
      Nil{}
    case Face{surface, sense, loops} <> tail:
      Face{surface_transform(surface, rotation, offset), sense, loops} <> faces_transform(tail, rotation, offset)

def transform(solid: Solid, +rotation: G.Rotation, +offset: G.Vec3) -> Solid:
  Solid{vertices, edges, faces} = solid
  Solid{G.transform_points(vertices, rotation, offset), edges_transform(edges, rotation, offset), faces_transform(faces, rotation, offset)}

# Signed distance to a plane; radial residual to a cylinder or cone; distance
# to the centre (sphere) or to the tube centre circle (torus) minus the radius.
def surface_residual(surface: Surface, point: G.Vec3) -> F32:
  match surface:
    case Plane{origin, normal, _}:
      R.approx(R.abs(G.dot(G.sub(point, origin), normal)))
    case Cylinder{origin, +axis, _, radius}:
      +d = G.sub(point, origin)
      +radial = G.sub(d, G.scale(axis, G.dot(d, axis)))
      R.approx(R.abs(R.sub(R.sqrt(G.dot(radial, radial)), radius)))
    case Cone{origin, +axis, _, radius, +angle}:
      +d = G.sub(point, origin)
      +height = G.dot(d, axis)
      +radial = G.sub(d, G.scale(axis, height))
      R.approx(R.abs(R.sub(R.sub(R.sqrt(G.dot(radial, radial)), radius), R.mul(height, R.div(R.sin(angle), R.cos(angle))))))
    case Sphere{origin, _, _, radius}:
      +d = G.sub(point, origin)
      R.approx(R.abs(R.sub(R.sqrt(G.dot(d, d)), radius)))
    case Torus{origin, +axis, _, major, minor}:
      +d = G.sub(point, origin)
      +height = G.dot(d, axis)
      +radial = G.sub(d, G.scale(axis, height))
      +off = R.sub(R.sqrt(G.dot(radial, radial)), major)
      R.approx(R.abs(R.sub(R.sqrt(R.add(R.mul(off, off), R.mul(height, height))), minor)))

def curve_point(curve: Curve, +t: R.Real) -> G.Vec3:
  match curve:
    case Line{origin, direction}:
      G.add(origin, G.scale(direction, t))
    case Circle{origin, normal, +x, radius}:
      +y = G.cross(normal, x)
      G.add(origin, G.scale(G.add(G.scale(x, R.cos(t)), G.scale(y, R.sin(t))), radius))
    case Ellipse{origin, normal, +x, major, minor}:
      y = G.cross(normal, x)
      G.add(origin, G.add(G.scale(x, R.mul(major, R.cos(t))), G.scale(y, R.mul(minor, R.sin(t)))))

def curve_tangent(curve: Curve, +t: R.Real) -> G.Vec3:
  match curve:
    case Line{_, direction}:
      direction
    case Circle{_, normal, +x, _}:
      G.add(G.scale(x, R.neg(R.sin(t))), G.scale(G.cross(normal, x), R.cos(t)))
    case Ellipse{_, normal, +x, major, minor}:
      G.normalize(G.add(G.scale(x, R.mul(R.neg(major), R.sin(t))), G.scale(G.cross(normal, x), R.mul(minor, R.cos(t)))))

def max(+a: F32, +b: F32) -> F32:
  Bool.pick(F32, (a > b : F32), a, b)

def curve_residual(curve: Curve, point: G.Vec3) -> F32:
  match curve:
    case Line{origin, direction}:
      +perp = G.cross(G.sub(point, origin), direction)
      R.approx(R.sqrt(G.dot(perp, perp)))
    case Circle{origin, +normal, _, radius}:
      +d = G.sub(point, origin)
      R.approx(R.max(R.abs(G.dot(d, normal)), R.abs(R.sub(R.sqrt(G.dot(d, d)), radius))))
    case Ellipse{origin, +normal, +x, +major, +minor}:
      +d = G.sub(point, origin)
      +u = R.div(G.dot(d, x), major)
      +v = R.div(G.dot(d, G.cross(normal, x)), minor)
      R.approx(R.max(R.abs(G.dot(d, normal)), R.mul(R.abs(R.sub(R.sqrt(R.add(R.mul(u, u), R.mul(v, v))), R.from_f32(1.0))), major)))

# Nonparallel plane/cylinder intersection. The caller checks |dot(n,axis)|
# away from zero; the exact intersection is an ellipse, without fitting points.
def plane_cylinder(plane_origin: G.Vec3, +normal: G.Vec3, +cyl_origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> Curve:
  +denom = G.dot(normal, axis)
  center = G.add(cyl_origin, G.scale(axis, R.div(G.dot(normal, G.sub(plane_origin, cyl_origin)), denom)))
  projection = G.sub(axis, G.scale(normal, denom))
  Ellipse{center, normal, G.normalize(projection), R.div(radius, R.abs(denom)), radius}

def ellipse_forward(curve: Curve, point: G.Vec3, direction: G.Vec3) -> Bool:
  match curve:
    case Ellipse{origin, normal, +x, +major, +minor}:
      +radial = G.sub(point, origin)
      +y = G.cross(normal, x)
      u = R.div(G.dot(radial, x), major)
      v = R.div(G.dot(radial, y), minor)
      tangent = G.add(G.scale(x, R.mul(R.neg(major), v)), G.scale(y, R.mul(minor, u)))
      R.less(R.from_f32(0.0), G.dot(tangent, direction))
    case _:
      False{}

def curve_parameter(curve: Curve, point: G.Vec3) -> R.Real:
  match curve:
    case Line{origin, direction}:
      G.dot(G.sub(point, origin), direction)
    case Circle{origin, normal, +x, _}:
      +d = G.sub(point, origin)
      R.atan2(G.dot(d, G.cross(normal, x)), G.dot(d, x))
    case Ellipse{origin, normal, +x, major, minor}:
      +d = G.sub(point, origin)
      R.atan2(R.div(G.dot(d, G.cross(normal, x)), minor), R.div(G.dot(d, x), major))

# A vertex-free periodic ellipse has no source vertex to preserve. Choose its
# artificial seam on the same surface generator as adjacent circular rims.
# The ellipse itself is unchanged; its seam parameter need not be zero.
def periodic_section_checked(clear: Bool, +curve: Curve, +base: G.Vec3, +direction: G.Vec3, +plane_origin: G.Vec3, +plane_normal: G.Vec3) -> Maybe<&2, G.Vec3>:
  match clear:
    case False{}:
      None{}
    case True{}:
      +point = G.add(base, G.scale(direction, R.div(G.dot(plane_normal, G.sub(plane_origin, base)), G.dot(plane_normal, direction))))
      Bool.pick(Maybe<&2, G.Vec3>, (curve_residual(curve, point) < 0.0003 : F32), Some{point}, None{})

def periodic_section(curve: Curve, base: G.Vec3, +direction: G.Vec3, plane_origin: G.Vec3, +plane_normal: G.Vec3) -> Maybe<&2, G.Vec3>:
  clear = R.less(R.from_f32(0.000000001), R.abs(G.dot(plane_normal, direction)))
  periodic_section_checked(clear, curve, base, direction, plane_origin, plane_normal)

def periodic_surfaces(surfaces: List<&2, Surface>, +curve: Curve, +plane_origin: G.Vec3, +plane_normal: G.Vec3) -> Maybe<&2, G.Vec3>:
  match surfaces:
    case Nil{}:
      Some{curve_point(curve, R.from_f32(0.0))}
    case Plane{_, _, _} <> tail:
      periodic_surfaces(tail, curve, plane_origin, plane_normal)
    case Cylinder{origin, axis, x, radius} <> _:
      periodic_section(curve, G.add(origin, G.scale(x, radius)), axis, plane_origin, plane_normal)
    case Cone{origin, +axis, +x, radius, +angle} <> _:
      direction = G.add(axis, G.scale(x, R.div(R.sin(angle), R.cos(angle))))
      periodic_section(curve, G.add(origin, G.scale(x, radius)), direction, plane_origin, plane_normal)
    case Sphere{_, _, _, _} <> _:
      Some{curve_point(curve, R.from_f32(0.0))}
    case Torus{_, _, _, _, _} <> _:
      Some{curve_point(curve, R.from_f32(0.0))}

def periodic_vertex(+curve: Curve, surfaces: List<&2, Surface>) -> Maybe<&2, G.Vec3>:
  match curve:
    case Ellipse{origin, normal, _, _, _}:
      periodic_surfaces(surfaces, curve, origin, normal)
    case _:
      Some{curve_point(curve, R.from_f32(0.0))}

def length(+point: G.Vec3) -> R.Real:
  R.sqrt(G.dot(point, point))

def radial(point: G.Vec3, origin: G.Vec3, +axis: G.Vec3) -> G.Vec3:
  +delta = G.sub(point, origin)
  G.sub(delta, G.scale(axis, G.dot(delta, axis)))

def segment_min_parameter(nonzero: Bool, +first: G.Vec3, +delta: G.Vec3) -> R.Real:
  match nonzero:
    case False{}:
      R.from_f32(0.0)
    case True{}:
      R.min(R.from_f32(1.0), R.max(R.from_f32(0.0), R.div(R.neg(G.dot(first, delta)), G.dot(delta, delta))))

# The radial norm along a line segment is convex. Its minimum is the exact
# quadratic stationary point or an endpoint; its maximum is at an endpoint.
# Thus endpoint-only cylinder checks cannot silently accept a chord as a seam.
def segment_cylinder_residual(first: G.Vec3, last: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real) -> R.Real:
  +a = radial(first, origin, axis)
  +b = radial(last, origin, axis)
  +delta = G.sub(b, a)
  t = segment_min_parameter(R.less(R.from_f32(0.0), G.dot(delta, delta)), a, delta)
  low = length(G.add(a, G.scale(delta, t)))
  high = R.max(length(a), length(b))
  R.max(R.abs(R.sub(low, radius)), R.abs(R.sub(high, radius)))

def cylinder_line_residual(curve: Curve, surface: Surface, start: G.Vec3, end: G.Vec3) -> R.Real:
  match curve surface:
    case Line{+origin, +direction} Cylinder{center, axis, _, radius}:
      +length2 = G.dot(direction, direction)
      a = G.add(origin, G.scale(direction, R.div(G.dot(G.sub(start, origin), direction), length2)))
      b = G.add(origin, G.scale(direction, R.div(G.dot(G.sub(end, origin), direction), length2)))
      segment_cylinder_residual(a, b, center, G.normalize(axis), radius)
    case _ _:
      R.from_f32(0.0)

# Parameter from an input circle tangent avoids subtracting large world-space
# coordinates when the edge endpoint is close to a tangential junction.
def endpoint_parameter(curve: Curve, point: G.Vec3, tangent: G.Vec3, sense: Bool) -> R.Real:
  match curve:
    case Circle{_, +normal, +x, _}:
      +radial = G.scale(G.cross(tangent, normal), R.from_f32(Bool.pick(F32, sense, 1.0, F32.neg(1.0))))
      R.atan2(G.dot(radial, G.cross(normal, x)), G.dot(radial, x))
    case _:
      curve_parameter(curve, point)

type CurveRange is Data:
  CurveRange{first: R.Real, last: R.Real}

def arc_range(curve: Curve, start: G.Vec3, end: G.Vec3, start_tangent: G.Vec3, end_tangent: G.Vec3, +sense: Bool, sweep: R.Real) -> CurveRange:
  +first = endpoint_parameter(curve, Bool.pick(G.Vec3, sense, start, end), Bool.pick(G.Vec3, sense, start_tangent, end_tangent), sense)
  CurveRange{first, R.add(first, sweep)}

def assemble(vertices: List<&2, G.Vec3>, edges: List<&2, Edge>, faces: List<&2, Face>) -> Solid:
  Solid{vertices, edges, faces}

def edge_at(edges: List<&2, Edge>, +index: U32) -> Edge:
  match edges:
    case Nil{}:
      Edge{0, 0, Line{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0)}, True{}}
    case head <> tail:
      Bool.pick(Edge, U32.is_eq(index, 0), head, edge_at(tail, (index - 1 : U32)))

def vertex_at(vertices: List<&2, G.Vec3>, +index: U32) -> G.Vec3:
  match vertices:
    case Nil{}:
      G.v3(0.0, 0.0, 0.0)
    case head <> tail:
      Bool.pick(G.Vec3, U32.is_eq(index, 0), head, vertex_at(tail, (index - 1 : U32)))

type FacesEdges is Data:
  FacesEdges{faces: List<&2, Face>, edges: List<&2, Edge>}

def is_periodic(surface: Surface) -> Bool:
  match surface:
    case Plane{_, _, _}:
      False{}
    case _:
      True{}

# Make the topological seam of full periodic faces explicit. It appears twice
# in the face boundary with opposite directions; the analytic shape is intact.
def seam_pair(a: Edge, b: Edge, e0: U32, f0: Bool, e1: U32, f1: Bool, +face: Face,
  +vertices: List<&2, G.Vec3>, +edges: List<&2, Edge>) -> FacesEdges:
  Edge{+s0, t0, _, _} = a
  Edge{+s1, t1, _, _} = b
  Face{surface, sense, _} = face
  +p0 = vertex_at(vertices, s0)
  p1 = vertex_at(vertices, s1)
  +n = U32.from_nat(List.length(&2, Edge, edges))
  seam = {Edge{s0, s1, Line{p0, G.normalize(G.sub(p1, p0))}, True{}} : Edge}
  boundary = {[T.Use{e0, f0}, T.Use{n, True{}}, T.Use{e1, f1}, T.Use{n, False{}}] : List<&2, T.Coedge>}
  candidate = {FacesEdges{[Face{surface, sense, [Loop{True{}, boundary}]}], List.append(&2, Edge, edges, [seam])} : FacesEdges}
  Bool.pick(FacesEdges, Bool.and(U32.is_eq(s0, t0), U32.is_eq(s1, t1)), candidate, FacesEdges{[face], edges})

def seam_face(+face: Face, +vertices: List<&2, G.Vec3>, +edges: List<&2, Edge>) -> FacesEdges:
  Face{+surface, sense, +loops} = face
  match surface:
    case Plane{_, _, _}:
      FacesEdges{[face], edges}
    case _:
      match loops:
        case Loop{_, [T.Use{+e0, f0}]} <> Loop{_, [T.Use{+e1, f1}]} <> Nil{}:
          seam_pair(edge_at(edges, e0), edge_at(edges, e1), e0, f0, e1, f1, face, vertices, edges)
        case _:
          FacesEdges{[face], edges}

def result_faces(result: FacesEdges) -> List<&2, Face>:
  FacesEdges{faces, _} = result
  faces

def result_edges(result: FacesEdges) -> List<&2, Edge>:
  FacesEdges{_, edges} = result
  edges

def seam_join(front: List<&2, Face>, result: FacesEdges) -> FacesEdges:
  FacesEdges{back, all_edges} = result
  FacesEdges{List.append(&2, Face, front, back), all_edges}

def seam_faces(faces: List<&2, Face>, +vertices: List<&2, G.Vec3>, edges: List<&2, Edge>) -> FacesEdges:
  match faces:
    case Nil{}:
      FacesEdges{Nil{}, edges}
    case head <> tail:
      +result = seam_face(head, vertices, edges)
      seam_join(result_faces(result), seam_faces(tail, vertices, result_edges(result)))

def seam_solid(vertices: List<&2, G.Vec3>, result: FacesEdges) -> Solid:
  FacesEdges{new_faces, new_edges} = result
  Solid{vertices, new_edges, new_faces}

def with_seams(solid: Solid) -> Solid:
  Solid{+vertices, edges, faces} = solid
  seam_solid(vertices, seam_faces(faces, vertices, edges))

# Exact circular loft, including the equal-radius (cylinder) case.
# Preconditions: distinct centers, positive radii, x perpendicular to the axis.
def frustum(+bottom: G.Vec3, +top: G.Vec3, +x: G.Vec3, +r0: R.Real, +r1: R.Real) -> Solid:
  +delta = G.sub(top, bottom)
  +height = R.sqrt(G.dot(delta, delta))
  +axis = G.normalize(delta)
  +p0 = G.add(bottom, G.scale(x, r0))
  +p1 = G.add(top, G.scale(x, r1))
  side = Bool.pick(Surface, R.equal(r0, r1), Cylinder{bottom, axis, x, r0},
    Bool.pick(Surface, R.less(r0, r1),
      Cone{bottom, axis, x, r0, R.atan(R.div(R.sub(r1, r0), height))},
      Cone{top, G.scale(axis, R.from_f32(F32.neg(1.0))), x, r1, R.atan(R.div(R.sub(r0, r1), height))}))
  Solid{[p0, p1],
    [Edge{0, 0, Circle{bottom, axis, x, r0}, True{}},
     Edge{1, 1, Circle{top, axis, x, r1}, True{}},
     Edge{0, 1, Line{p0, G.normalize(G.sub(p1, p0))}, True{}}],
    [Face{Plane{bottom, axis, x}, False{}, [Loop{True{}, [T.Use{0, False{}}]}]},
     Face{Plane{top, axis, x}, True{}, [Loop{True{}, [T.Use{1, True{}}]}]},
     Face{side, True{}, [Loop{True{}, [T.Use{0, True{}}, T.Use{2, True{}}, T.Use{1, False{}}, T.Use{2, False{}}]}]}]}

def frustum_volume(+r0: R.Real, +r1: R.Real, height: R.Real) -> R.Real:
  R.div(R.mul(R.mul(R.pi(), height), R.add(R.add(R.mul(r0, r0), R.mul(r0, r1)), R.mul(r1, r1))), R.from_f32(3.0))

def frustum_volume_between(bottom: G.Vec3, top: G.Vec3, r0: R.Real, r1: R.Real) -> R.Real:
  +d = G.sub(top, bottom)
  frustum_volume(r0, r1, R.sqrt(G.dot(d, d)))

type Bounds is Data:
  Bounds{low: G.Vec3, high: G.Vec3}

def min(+a: F32, +b: F32) -> F32:
  Bool.pick(F32, (a < b : F32), a, b)

def component_min(a: G.Vec3, b: G.Vec3) -> G.Vec3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{R.min(ax, bx), R.min(ay, by), R.min(az, bz)}

def component_max(a: G.Vec3, b: G.Vec3) -> G.Vec3:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  G.V3{R.max(ax, bx), R.max(ay, by), R.max(az, bz)}

def extent_component(+axis: R.Real, radius: R.Real) -> R.Real:
  R.mul(radius, R.sqrt(R.max(R.from_f32(0.0), R.sub(R.from_f32(1.0), R.mul(axis, axis)))))

def circle_extent(axis: G.Vec3, +radius: R.Real) -> G.Vec3:
  G.V3{+x, +y, +z} = axis
  G.V3{extent_component(x, radius), extent_component(y, radius), extent_component(z, radius)}

def frustum_bounds(+bottom: G.Vec3, +top: G.Vec3, r0: R.Real, r1: R.Real) -> Bounds:
  +axis = G.normalize(G.sub(top, bottom))
  +e0 = circle_extent(axis, r0)
  +e1 = circle_extent(axis, r1)
  Bounds{component_min(G.sub(bottom, e0), G.sub(top, e1)), component_max(G.add(bottom, e0), G.add(top, e1))}
