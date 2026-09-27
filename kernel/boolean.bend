import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T

# Coaxial cylinder booleans. Classify the radial/axial arrangement in Bend,
# then revolve its boundary into planes and cylinders with shared circles.
# Operations: 0 union, 1 intersection, 2 first minus second.
type Interval is Data:
  Interval{index: U32, low: R.Real, high: R.Real}

type Cell is Data:
  Cell{z: Interval, r: Interval}

type Component is Data:
  Component{inside: List<&2, Cell>, remaining: List<&2, Cell>}

type Body is Data:
  Body{solid: A.Solid, volume: R.Real, bounds: A.Bounds}

type BooleanResult is Data:
  BooleanResult{supported: Bool, enclosed_void: Bool, bodies: List<&2, Body>}

def insert(+value: R.Real, sorted: List<&2, R.Real>) -> List<&2, R.Real>:
  match sorted:
    case Nil{}:
      [value]
    case +head <> +tail:
      Bool.pick(List<&2, R.Real>, R.equal(value, head), head <> tail,
        Bool.pick(List<&2, R.Real>, R.less(value, head), value <> head <> tail, head <> insert(value, tail)))

def intervals(values: List<&2, R.Real>, +index: U32) -> List<&2, Interval>:
  match values:
    case low <> +high <> +tail:
      Interval{index, low, high} <> intervals(high <> tail, (index + 1 : U32))
    case _:
      Nil{}

def midpoint(interval: Interval) -> R.Real:
  Interval{_, a, b} = interval
  R.div(R.add(a, b), R.from_f32(2.0))

def enclosed(+z: R.Real, r: R.Real, a: R.Real, b: R.Real, radius: R.Real) -> Bool:
  Bool.and(R.less(a, z), Bool.and(R.less(z, b), R.less(r, radius)))

# Arrangement intervals are delimited by all operand endpoints. Their open
# interiors therefore belong to an operand iff both bounds are contained.
# Do not classify tiny intervals with a rounded midpoint that can equal an end.
def enclosed_cell(z: Interval, r: Interval, a: R.Real, b: R.Real, radius: R.Real) -> Bool:
  Interval{_, +low, +high} = z
  Interval{_, inner, +outer} = r
  Bool.and(R.less(low, high), Bool.and(R.less(inner, outer),
    Bool.and(Bool.not(R.less(low, a)), Bool.and(Bool.not(R.less(b, high)), Bool.not(R.less(radius, outer))))))

def selected(+op: U32, +a: Bool, +b: Bool) -> Bool:
  Bool.pick(Bool, U32.is_eq(op, 0), Bool.or(a, b),
    Bool.pick(Bool, U32.is_eq(op, 1), Bool.and(a, b), Bool.and(a, Bool.not(b))))

def radial_cells(+z: Interval, radii: List<&2, Interval>, +ha: R.Real, +ra: R.Real, +b0: R.Real, +b1: R.Real, +rb: R.Real, +op: U32) -> List<&2, Cell>:
  match radii:
    case Nil{}:
      Nil{}
    case +r <> tail:
      keep = selected(op, enclosed_cell(z, r, R.from_f32(0.0), ha, ra), enclosed_cell(z, r, b0, b1, rb))
      +rest = radial_cells(z, tail, ha, ra, b0, b1, rb, op)
      Bool.pick(List<&2, Cell>, keep, Cell{z, r} <> rest, rest)

def cells(zs: List<&2, Interval>, +rs: List<&2, Interval>, +ha: R.Real, +ra: R.Real, +b0: R.Real, +b1: R.Real, +rb: R.Real, +op: U32) -> List<&2, Cell>:
  match zs:
    case Nil{}:
      Nil{}
    case z <> tail:
      List.append(&2, Cell, radial_cells(z, rs, ha, ra, b0, b1, rb, op), cells(tail, rs, ha, ra, b0, b1, rb, op))

def adjacent(a: Cell, b: Cell) -> Bool:
  Cell{Interval{+az, _, _}, Interval{+ar, _, _}} = a
  Cell{Interval{+bz, _, _}, Interval{+br, _, _}} = b
  Bool.or(Bool.and(U32.is_eq(az, bz), Bool.or(U32.is_eq((ar + 1 : U32), br), U32.is_eq((br + 1 : U32), ar))),
    Bool.and(U32.is_eq(ar, br), Bool.or(U32.is_eq((az + 1 : U32), bz), U32.is_eq((bz + 1 : U32), az))))

def touches(+cell: Cell, group: List<&2, Cell>) -> Bool:
  match group:
    case Nil{}:
      False{}
    case c <> tail:
      Bool.or(adjacent(cell, c), touches(cell, tail))

def flood_pass(pending: List<&2, Cell>, +group: List<&2, Cell>, +skipped: List<&2, Cell>) -> Component:
  match pending:
    case Nil{}:
      Component{group, skipped}
    case +cell <> tail:
      +join = touches(cell, group)
      flood_pass(tail, Bool.pick(List<&2, Cell>, join, cell <> group, group), Bool.pick(List<&2, Cell>, join, skipped, cell <> skipped))

def flood(left: Nat, state: Component) -> Component:
  match left:
    case 0n:
      state
    case 1n+p:
      Component{group, remaining} = state
      flood(p, flood_pass(remaining, group, Nil{}))

def component_inside(state: Component) -> List<&2, Cell>:
  Component{inside, _} = state
  inside

def component_remaining(state: Component) -> List<&2, Cell>:
  Component{_, remaining} = state
  remaining

def components(left: Nat, pending: List<&2, Cell>) -> List<&2, List<&2, Cell>>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      match pending:
        case Nil{}:
          Nil{}
        case cell <> tail:
          +state = flood(6n, Component{[cell], tail})
          component_inside(state) <> components(p, component_remaining(state))

def occupied(cells: List<&2, Cell>, +z: U32, +r: U32) -> Bool:
  match cells:
    case Nil{}:
      False{}
    case Cell{Interval{zi, _, _}, Interval{ri, _, _}} <> tail:
      Bool.or(Bool.and(U32.is_eq(zi, z), U32.is_eq(ri, r)), occupied(tail, z, r))

def center(origin: G.Vec3, axis: G.Vec3, z: R.Real) -> G.Vec3:
  G.add(origin, G.scale(axis, z))

def circles_at(zs: List<&2, R.Real>, +radius: R.Real, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +index: U32) -> List<&2, A.Edge>:
  match zs:
    case Nil{}:
      Nil{}
    case z <> tail:
      A.Edge{index, index, A.Circle{center(origin, axis, z), axis, x, radius}, True{}} <>
        circles_at(tail, radius, origin, axis, x, (index + 1 : U32))

def circles(rs: List<&2, R.Real>, +zs: List<&2, R.Real>, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +index: U32) -> List<&2, A.Edge>:
  match rs:
    case Nil{}:
      Nil{}
    case r <> tail:
      List.append(&2, A.Edge, circles_at(zs, r, origin, axis, x, index), circles(tail, zs, origin, axis, x, (index + U32.from_nat(List.length(&2, R.Real, zs)) : U32)))

def circle_vertices(edges: List<&2, A.Edge>) -> List<&2, G.Vec3>:
  match edges:
    case Nil{}:
      Nil{}
    case A.Edge{_, _, curve, _} <> tail:
      A.curve_point(curve, R.from_f32(0.0)) <> circle_vertices(tail)

def cap(cell: Cell, +top: Bool, +nz: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Face:
  Cell{Interval{+zi, z0, z1}, Interval{+ri, _, _}} = cell
  +level = Bool.pick(U32, top, (zi + 1 : U32), zi)
  +outer = {A.Loop{True{}, [T.Use{(ri * nz + level : U32), top}]} : A.Loop}
  hole = {A.Loop{False{}, [T.Use{((ri - 1) * nz + level : U32), Bool.not(top)}]} : A.Loop}
  loops = Bool.pick(List<&2, A.Loop>, U32.is_eq(ri, 0), [outer], [outer, hole])
  A.Face{A.Plane{center(origin, axis, Bool.pick(R.Real, top, z1, z0)), axis, x}, top, loops}

def side(cell: Cell, +outer: Bool, +nz: U32, +origin: G.Vec3, axis: G.Vec3, +x: G.Vec3) -> A.Face:
  Cell{Interval{+zi, _, _}, Interval{+ri, r0, r1}} = cell
  +row = Bool.pick(U32, outer, ri, (ri - 1 : U32))
  lower = (row * nz + zi : U32)
  upper = (row * nz + zi + 1 : U32)
  A.Face{A.Cylinder{origin, axis, x, Bool.pick(R.Real, outer, r1, r0)}, outer,
    [A.Loop{True{}, [T.Use{lower, outer}]}, A.Loop{False{}, [T.Use{upper, Bool.not(outer)}]}]}

def cell_faces(+cell: Cell, +group: List<&2, Cell>, +nz: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> List<&2, A.Face>:
  Cell{Interval{+zi, _, _}, Interval{+ri, _, _}} = cell
  below = Bool.pick(List<&2, A.Face>, occupied(group, (zi - 1 : U32), ri), Nil{}, [cap(cell, False{}, nz, origin, axis, x)])
  above = Bool.pick(List<&2, A.Face>, occupied(group, (zi + 1 : U32), ri), Nil{}, [cap(cell, True{}, nz, origin, axis, x)])
  inner = Bool.pick(List<&2, A.Face>, Bool.or(U32.is_eq(ri, 0), occupied(group, zi, (ri - 1 : U32))), Nil{}, [side(cell, False{}, nz, origin, axis, x)])
  outer = Bool.pick(List<&2, A.Face>, occupied(group, zi, (ri + 1 : U32)), Nil{}, [side(cell, True{}, nz, origin, axis, x)])
  List.append(&2, A.Face, List.append(&2, A.Face, below, above), List.append(&2, A.Face, inner, outer))

def faces(pending: List<&2, Cell>, +group: List<&2, Cell>, +nz: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> List<&2, A.Face>:
  match pending:
    case Nil{}:
      Nil{}
    case cell <> tail:
      List.append(&2, A.Face, cell_faces(cell, group, nz, origin, axis, x), faces(tail, group, nz, origin, axis, x))

def has_use(uses: List<&2, T.Coedge>, +edge: U32) -> Bool:
  match uses:
    case Nil{}:
      False{}
    case T.Use{id, _} <> tail:
      Bool.or(U32.is_eq(id, edge), has_use(tail, edge))

def loop_has(loops: List<&2, A.Loop>, +edge: U32) -> Bool:
  match loops:
    case Nil{}:
      False{}
    case A.Loop{_, uses} <> tail:
      Bool.or(has_use(uses, edge), loop_has(tail, edge))

def referenced(faces: List<&2, A.Face>, +edge: U32) -> Bool:
  match faces:
    case Nil{}:
      False{}
    case A.Face{_, _, loops} <> tail:
      Bool.or(loop_has(loops, edge), referenced(tail, edge))

def used_indices(edges: List<&2, A.Edge>, +faces: List<&2, A.Face>, +index: U32) -> List<&2, U32>:
  match edges:
    case Nil{}:
      Nil{}
    case _ <> tail:
      +rest = used_indices(tail, faces, (index + 1 : U32))
      Bool.pick(List<&2, U32>, referenced(faces, index), index <> rest, rest)

def index_of(indices: List<&2, U32>, +old: U32, +index: U32) -> U32:
  match indices:
    case Nil{}:
      4294967295
    case head <> tail:
      Bool.pick(U32, U32.is_eq(head, old), index, index_of(tail, old, (index + 1 : U32)))

def remap_uses(uses: List<&2, T.Coedge>, +indices: List<&2, U32>) -> List<&2, T.Coedge>:
  match uses:
    case Nil{}:
      Nil{}
    case T.Use{id, forward} <> tail:
      T.Use{index_of(indices, id, 0), forward} <> remap_uses(tail, indices)

def remap_loops(loops: List<&2, A.Loop>, +indices: List<&2, U32>) -> List<&2, A.Loop>:
  match loops:
    case Nil{}:
      Nil{}
    case A.Loop{outer, uses} <> tail:
      A.Loop{outer, remap_uses(uses, indices)} <> remap_loops(tail, indices)

def remap_faces(faces: List<&2, A.Face>, +indices: List<&2, U32>) -> List<&2, A.Face>:
  match faces:
    case Nil{}:
      Nil{}
    case A.Face{surface, sense, loops} <> tail:
      A.Face{surface, sense, remap_loops(loops, indices)} <> remap_faces(tail, indices)

def renumber_circle(edge: A.Edge, +index: U32) -> A.Edge:
  A.Edge{_, _, curve, sense} = edge
  A.Edge{index, index, curve, sense}

def compact_circles(remaining: List<&2, U32>, +edges: List<&2, A.Edge>, +index: U32) -> List<&2, A.Edge>:
  match remaining:
    case Nil{}:
      Nil{}
    case old <> tail:
      renumber_circle(A.edge_at(edges, old), index) <> compact_circles(tail, edges, (index + 1 : U32))


def boundary(+group: List<&2, Cell>, +circles: List<&2, A.Edge>, nz: U32, origin: G.Vec3, axis: G.Vec3, x: G.Vec3) -> A.Solid:
  +boundary = faces(group, group, nz, origin, axis, x)
  +indices = used_indices(circles, boundary, 0)
  +compact = compact_circles(indices, circles, 0)
  A.with_seams(A.Solid{circle_vertices(compact), compact, remap_faces(boundary, indices)})

def volume(cells: List<&2, Cell>) -> R.Real:
  match cells:
    case Nil{}:
      R.from_f32(0.0)
    case Cell{Interval{_, z0, z1}, Interval{_, +r0, +r1}} <> tail:
      R.add(R.mul(R.mul(R.pi(), R.sub(z1, z0)), R.sub(R.mul(r1, r1), R.mul(r0, r0))), volume(tail))

def merge_bounds(a: A.Bounds, b: A.Bounds) -> A.Bounds:
  A.Bounds{al, ah} = a
  A.Bounds{bl, bh} = b
  A.Bounds{A.component_min(al, bl), A.component_max(ah, bh)}

# Tight for the complete circular rims and generator seams produced here.
# This must not be used for general trimmed analytic input geometry.
def rim_extent_component(+x: R.Real, +y: R.Real, radius: R.Real) -> R.Real:
  R.mul(radius, R.sqrt(R.add(R.mul(x, x), R.mul(y, y))))

def rim_extent(x: G.Vec3, y: G.Vec3, +radius: R.Real) -> G.Vec3:
  G.V3{xx, xy, xz} = x
  G.V3{yx, yy, yz} = y
  G.V3{rim_extent_component(xx, yx, radius),
    rim_extent_component(xy, yy, radius), rim_extent_component(xz, yz, radius)}

def circle_bounds(+origin: G.Vec3, normal: G.Vec3, +x: G.Vec3, radius: R.Real) -> A.Bounds:
  # Use the actual curve basis, as A.curve_point does. sqrt(1-normal_i^2)
  # amplifies tiny normalization errors into false axial extents near a pole.
  +extent = rim_extent(x, G.cross(normal, x), radius)
  A.Bounds{G.sub(origin, extent), G.add(origin, extent)}

def rim_bounds_more(edges: List<&2, A.Edge>, bounds: A.Bounds) -> A.Bounds:
  match edges:
    case Nil{}:
      bounds
    case A.Edge{_, _, curve, _} <> tail:
      match curve:
        case A.Circle{origin, normal, x, radius}:
          rim_bounds_more(tail, merge_bounds(bounds, circle_bounds(origin, normal, x, radius)))
        case _:
          rim_bounds_more(tail, bounds)

def rim_bounds(edges: List<&2, A.Edge>) -> A.Bounds:
  match edges:
    case Nil{}:
      A.Bounds{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0)}
    case A.Edge{_, _, curve, _} <> tail:
      match curve:
        case A.Circle{origin, normal, x, radius}:
          rim_bounds_more(tail, circle_bounds(origin, normal, x, radius))
        case _:
          rim_bounds(tail)

def bounds_more(cells: List<&2, Cell>, bounds: A.Bounds, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Bounds:
  match cells:
    case Nil{}:
      bounds
    case Cell{Interval{_, z0, z1}, Interval{_, _, +r1}} <> tail:
      bounds_more(tail, merge_bounds(bounds, merge_bounds(circle_bounds(center(origin, axis, z0), axis, x, r1),
        circle_bounds(center(origin, axis, z1), axis, x, r1))), origin, axis, x)


def bounds(cells: List<&2, Cell>, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> A.Bounds:
  match cells:
    case Nil{}:
      A.Bounds{origin, origin}
    case Cell{Interval{_, z0, z1}, Interval{_, _, +r1}} <> tail:
      bounds_more(tail, merge_bounds(circle_bounds(center(origin, axis, z0), axis, x, r1),
        circle_bounds(center(origin, axis, z1), axis, x, r1)), origin, axis, x)

def bodies(groups: List<&2, List<&2, Cell>>, +circles: List<&2, A.Edge>, +nz: U32, +origin: G.Vec3, +axis: G.Vec3, +x: G.Vec3) -> List<&2, Body>:
  match groups:
    case Nil{}:
      Nil{}
    case +group <> tail:
      Body{boundary(group, circles, nz, origin, axis, x), volume(group), bounds(group, origin, axis, x)} <> bodies(tail, circles, nz, origin, axis, x)

def resolvable(intervals: List<&2, Interval>) -> Bool:
  match intervals:
    case Nil{}:
      True{}
    case Interval{_, low, high} <> tail:
      Bool.and(R.less(R.from_f32(0.0000001), R.sub(high, low)), resolvable(tail))

def material_resolvable(cells: List<&2, Cell>) -> Bool:
  match cells:
    case Nil{}:
      True{}
    case Cell{z, r} <> tail:
      Bool.and(resolvable([z, r]), material_resolvable(tail))

def coaxial(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +op: U32) -> BooleanResult:
  +axis = G.normalize(G.sub(a1, a0))
  +ha = G.dot(G.sub(a1, a0), axis)
  +db0 = G.sub(b0, a0)
  +db1 = G.sub(b1, a0)
  +zb0 = G.dot(db0, axis)
  +zb1 = G.dot(db1, axis)
  +lo = R.min(zb0, zb1)
  +hi = R.max(zb0, zb1)
  aligned = Bool.and((G.distance(db0, G.scale(axis, zb0)) < 0.000000001 : F32), (G.distance(db1, G.scale(axis, zb1)) < 0.000000001 : F32))
  +enclosed_void = Bool.and(U32.is_eq(op, 2), Bool.and(R.less(R.from_f32(0.0), lo), Bool.and(R.less(hi, ha), R.less(rb, ra))))
  +zs = insert(R.from_f32(0.0), insert(ha, insert(lo, [hi])))
  +positive_rs = insert(ra, [rb])
  +zi = intervals(zs, 0)
  +ri = intervals(R.from_f32(0.0) <> positive_rs, 0)
  +material = cells(zi, ri, ha, ra, lo, hi, rb, op)
  +x = A.axis_x(axis)
  all = circles(positive_rs, zs, a0, axis, x, 0)
  # Four axial endpoints and two positive radii make at most 3 * 2 cells;
  # six flood passes/component iterations exhaust this finite arrangement.
  # Empty external cells create no geometry. Only material cells need to meet
  # the construction resolution; tiny retained material is still rejected.
  BooleanResult{Bool.and(Bool.not(enclosed_void), Bool.and(aligned, material_resolvable(material))), enclosed_void,
    bodies(components(6n, material), all, U32.from_nat(List.length(&2, R.Real, zs)), a0, axis, x)}
