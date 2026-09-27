import Base
import ../kernel/real.bend as R
import ../kernel/geometry.bend as GE
import ../kernel/precise.bend as G
import ../kernel/analytic.bend as A
import ../kernel/topology.bend as T
import ../kernel/boolean.bend as B
import ../kernel/intersections.bend as I
import ../kernel/face-classification.bend as F
import ../kernel/ports/solid-intersection.bend as SI
import ../kernel/ports/planar-boolean.bend as PB
import ../kernel/ports/planar-boolean-types.bend as PT

# The six frozen fixtures/performance-build123d cases, rebuilt from the SAME
# production kernel functions the JavaScript adapter calls, with the Python
# shim, RPC and host validation removed. Identical source for JS, native
# ARM64 and Metal. Every output field feeds a bitwise hash; the kernel's own
# volume is accumulated separately so a wrong result cannot pass unnoticed.
type Evidence is Data:
  Evidence{hash: U32, volume: R.Real, errors: U32}

def mix(a: U32, b: U32) -> U32:
  (a * 16777619 + b : U32)

def bit(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

def real_hash(r: R.Real) -> U32:
  R.Real{hi, lo} = r
  mix(F32.bits(hi), F32.bits(lo))

def vec_hash(v: G.Vec3) -> U32:
  G.V3{x, y, z} = v
  mix(mix(real_hash(x), real_hash(y)), real_hash(z))

def vertices(xs: List<&2, G.Vec3>) -> U32:
  match xs:
    case Nil{}:
      1
    case x <> tail:
      mix(vec_hash(x), vertices(tail))

def curve(c: A.Curve) -> U32:
  match c:
    case A.Line{o, d}:
      mix(1, mix(vec_hash(o), vec_hash(d)))
    case A.Circle{o, n, x, r}:
      mix(2, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), real_hash(r))))
    case A.Ellipse{o, n, x, a, b}:
      mix(3, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), mix(real_hash(a), real_hash(b)))))

def surface(s: A.Surface) -> U32:
  match s:
    case A.Plane{o, n, x}:
      mix(1, mix(mix(vec_hash(o), vec_hash(n)), vec_hash(x)))
    case A.Cylinder{o, n, x, r}:
      mix(2, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), real_hash(r))))
    case A.Cone{o, n, x, r, a}:
      mix(3, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), mix(real_hash(r), real_hash(a)))))
    case A.Sphere{o, n, x, r}:
      mix(4, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), real_hash(r))))
    case A.Torus{o, n, x, a, b}:
      mix(5, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), mix(real_hash(a), real_hash(b)))))

def edges(xs: List<&2, A.Edge>) -> U32:
  match xs:
    case Nil{}:
      1
    case A.Edge{a, b, c, s} <> tail:
      mix(mix(mix(a, b), mix(curve(c), bit(s))), edges(tail))

def uses(xs: List<&2, T.Coedge>) -> U32:
  match xs:
    case Nil{}:
      1
    case T.Use{e, f} <> tail:
      mix(mix(e, bit(f)), uses(tail))

def loops(xs: List<&2, A.Loop>) -> U32:
  match xs:
    case Nil{}:
      1
    case A.Loop{o, us} <> tail:
      mix(mix(bit(o), uses(us)), loops(tail))

def faces(xs: List<&2, A.Face>) -> U32:
  match xs:
    case Nil{}:
      1
    case A.Face{s, f, ls} <> tail:
      mix(mix(surface(s), mix(bit(f), loops(ls))), faces(tail))

def solid_hash(s: A.Solid) -> U32:
  A.Solid{vs, es, fs} = s
  mix(mix(vertices(vs), edges(es)), faces(fs))

def bounds_hash(b: A.Bounds) -> U32:
  A.Bounds{a, z} = b
  mix(vec_hash(a), vec_hash(z))

def combine(a: Evidence, b: Evidence) -> Evidence:
  Evidence{ah, av, ae} = a
  Evidence{bh, bv, be} = b
  Evidence{(ah + bh : U32), R.add(av, bv), (ae + be : U32)}

def empty() -> Evidence:
  Evidence{0, R.from_f32(0.0), 0}

# ---------------------------------------------------------------------------
# Operand construction. src/kernel.mjs lifts an F32 profile through
# topology.extrude; src/face-classification.mjs then lifts that F32 boundary
# to the F32x2 analytic form the Boolean ports consume. Both steps are
# reproduced here rather than approximated.

def rect(+x0: F32, +y0: F32, +x1: F32, +y1: F32, +z: F32) -> List<&2, GE.Vec3>:
  GE.V3{x0, y0, z} <> GE.V3{x1, y0, z} <> GE.V3{x1, y1, z} <> GE.V3{x0, y1, z} <> Nil{}

def lift_v(v: GE.Vec3) -> G.Vec3:
  GE.V3{x, y, z} = v
  G.V3{R.from_f32(x), R.from_f32(y), R.from_f32(z)}

def lift_points(xs: List<&2, GE.Vec3>) -> List<&2, G.Vec3>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> tail:
      lift_v(x) <> lift_points(tail)

# face-classification rejects a degenerate edge; a placeholder keeps the list
# aligned so the hash still observes the defect instead of losing the row.
def edge_or_degenerate(m: Maybe<&2, A.Edge>) -> A.Edge:
  match m:
    case Some{e}:
      e
    case None{}:
      A.Edge{0, 0, A.Line{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0)}, True{}}

def analytic_edges(+vs: List<&2, G.Vec3>, es: List<&2, T.Edge>) -> List<&2, A.Edge>:
  match es:
    case Nil{}:
      Nil{}
    case T.Edge{s, e} <> tail:
      edge_or_degenerate(F.linear_edge(vs, s, e)) <> analytic_edges(vs, tail)

def analytic_faces(fs: List<&2, T.Face>) -> List<&2, A.Face>:
  match fs:
    case Nil{}:
      Nil{}
    case T.Face{o, n, x, b} <> tail:
      A.Face{A.Plane{lift_v(o), lift_v(n), lift_v(x)}, True{}, A.Loop{True{}, b} <> Nil{}} <> analytic_faces(tail)

def analytic_of(s: T.Solid) -> A.Solid:
  T.Solid{vs, es, fs} = s
  +lifted = lift_points(vs)
  A.Solid{lifted, analytic_edges(lifted, es), analytic_faces(fs)}

def box_solid(+x0: F32, +y0: F32, +z0: F32, +x1: F32, +y1: F32, +h: F32) -> A.Solid:
  analytic_of(T.extrude(rect(x0, y0, x1, y1, z0), GE.V3{0.0, 0.0, h}))

# An extruded quadrilateral has twelve edges; every operand here is a box.
def autos(n: Nat) -> List<&2, F.DomainChoice>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      F.AutoDomain{} <> autos(p)

def box_domains() -> List<&2, F.DomainChoice>:
  autos(12n)

def zero() -> R.Real:
  R.from_f32(0.0)

# src/intersections.mjs production defaults.
def tolerance() -> I.Tolerance:
  I.Tolerance{R.from_f32(0.0000001), R.from_f32(0.0000000001)}

# ---------------------------------------------------------------------------
# Evidence per result shape.

def measures_evidence(m: SI.PlanarMeasures, +h: U32) -> Evidence:
  SI.PlanarMeasures{+v, b} = m
  Evidence{mix(h, mix(real_hash(v), bounds_hash(b))), v, 0}

def measured_evidence(s: A.Solid) -> Evidence:
  +kept = s
  measures_evidence(SI.planar_measures(kept), solid_hash(kept))

def planar_bodies(xs: List<&2, PT.Body>) -> Evidence:
  match xs:
    case Nil{}:
      empty()
    case PT.Body{s, d, fo, eo} <> tail:
      combine(measured_evidence(s), planar_bodies(tail))

def planar_evidence(r: PT.Result) -> Evidence:
  match r:
    case PT.Bodies{bs, sb, st}:
      combine(planar_bodies(bs), Evidence{real_hash(sb), zero(), 0})
    case PT.Unresolved{rs, sg, dt, sb, st}:
      Evidence{mix(900, mix(sg, dt)), zero(), 1}

def coaxial_bodies(xs: List<&2, B.Body>) -> Evidence:
  match xs:
    case Nil{}:
      empty()
    case B.Body{s, +v, b} <> tail:
      combine(Evidence{mix(solid_hash(s), mix(real_hash(v), bounds_hash(b))), v, 0}, coaxial_bodies(tail))

def coaxial_evidence(r: B.BooleanResult) -> Evidence:
  B.BooleanResult{ok, void, bs} = r
  combine(coaxial_bodies(bs), Evidence{0, zero(), (bit(Bool.not(ok)) + bit(void) : U32)})

# A resolved planar Boolean returns exactly one body in every frozen case; a
# split or an Unresolved stage is reported through hash and error count.
def first_body(r: PT.Result) -> Maybe<&2, PT.Body>:
  match r:
    case PT.Bodies{bs, sb, st}:
      match bs:
        case Nil{}:
          None{}
        case head <> rest:
          Some{head}
    case PT.Unresolved{rs, sg, dt, sb, st}:
      None{}

# The intermediate body carries its own per-edge domains, exactly as
# src/planar-boolean.mjs writes them back for the next classificationInput.
def chained_union(body: PT.Body, +tab: A.Solid) -> Evidence:
  PT.Body{s, d, fo, eo} = body
  planar_evidence(PB.union(s, d, zero(), tab, box_domains(), zero(), tolerance()))

def chained(m: Maybe<&2, PT.Body>, +tab: A.Solid) -> Evidence:
  match m:
    case Some{frame}:
      chained_union(frame, tab)
    case None{}:
      Evidence{901, zero(), 1}

# ---------------------------------------------------------------------------
# The six cases. Literal parameters match the frozen Python files exactly;
# build123d's Align.MIN places each box at its minimum corner, and Pos
# translates it. Expected analytic volumes: 12000, 1280*pi, 2380*pi, 15500,
# 18240 and 13840 mm3.

# box.py: Box(40, 30, 10, align=Align.MIN)
def case_box() -> Evidence:
  measured_evidence(box_solid(0.0, 0.0, 0.0, 40.0, 30.0, 10.0))

# translated-cylinder.py: Pos(3, -4, 10) * Cylinder(8, 20). build123d centres
# a Cylinder on its own origin, so the translated axis runs z = 0 to 20.
def case_translated_cylinder() -> Evidence:
  +bottom = G.v3(3.0, F32.neg(4.0), 0.0)
  +top = G.v3(3.0, F32.neg(4.0), 20.0)
  +r = R.from_f32(8.0)
  +s = A.frustum(bottom, top, G.v3(1.0, 0.0, 0.0), r, r)
  +v = A.frustum_volume_between(bottom, top, r, r)
  b = A.frustum_bounds(bottom, top, r, r)
  Evidence{mix(solid_hash(s), mix(real_hash(v), bounds_hash(b))), v, 0}

# coaxial-bore.py: Cylinder(12, 20) - Cylinder(5, 24), both origin-centred.
def case_coaxial_bore() -> Evidence:
  coaxial_evidence(B.coaxial(G.v3(0.0, 0.0, F32.neg(10.0)), G.v3(0.0, 0.0, 10.0), R.from_f32(12.0),
    G.v3(0.0, 0.0, F32.neg(12.0)), G.v3(0.0, 0.0, 12.0), R.from_f32(5.0), 2))

# planar-union.py: Box(40, 30, 10) + Pos(20, 10, 0) * Box(30, 25, 10).
def case_planar_union() -> Evidence:
  planar_evidence(PB.union(box_solid(0.0, 0.0, 0.0, 40.0, 30.0, 10.0), box_domains(), zero(),
    box_solid(20.0, 10.0, 0.0, 50.0, 35.0, 10.0), box_domains(), zero(), tolerance()))

# planar-pocket.py: Box(50, 40, 12) - Pos(8, 8, 4) * Box(30, 24, 10).
def case_planar_pocket() -> Evidence:
  planar_evidence(PB.subtract(box_solid(0.0, 0.0, 0.0, 50.0, 40.0, 12.0), box_domains(), zero(),
    box_solid(8.0, 8.0, 4.0, 38.0, 32.0, 10.0), box_domains(), zero(), tolerance()))

# frame-with-tab.py: (Box(50, 40, 10) - Pos(8, 8, -1) * Box(34, 24, 12))
# + Pos(48, 10, 0) * Box(12, 20, 10). Two dependent Boolean stages.
def case_frame_with_tab() -> Evidence:
  frame = PB.subtract(box_solid(0.0, 0.0, 0.0, 50.0, 40.0, 10.0), box_domains(), zero(),
    box_solid(8.0, 8.0, F32.neg(1.0), 42.0, 32.0, 12.0), box_domains(), zero(), tolerance())
  chained(first_body(frame), box_solid(48.0, 10.0, 0.0, 60.0, 30.0, 10.0))

def one(id: Nat) -> Evidence:
  match id:
    case 0n:
      case_box()
    case 1n+a:
      match a:
        case 0n:
          case_translated_cylinder()
        case 1n+b:
          match b:
            case 0n:
              case_coaxial_bore()
            case 1n+c:
              match c:
                case 0n:
                  case_planar_union()
                case 1n+d:
                  match d:
                    case 0n:
                      case_planar_pocket()
                    case 1n+e:
                      match e:
                        case 0n:
                          case_frame_with_tab()
                        case 1n+rest:
                          Evidence{902, zero(), 1}

# ---------------------------------------------------------------------------
# Repetition. A single case is one dependent feature history and cannot be
# parallelised; repeats are independent instances of the same case, which is
# what the balanced fork tree distributes. This measures throughput of the
# frozen workload, not acceleration of one Boolean.

def leaf(left: Nat, +id: Nat, acc: Evidence) -> Evidence:
  match left:
    case 0n:
      acc
    case 1n+p:
      leaf(p, id, combine(acc, one(id)))

def batch_nodes(depth: Nat, +count: Nat, +id: Nat) -> Evidence:
  match depth:
    case 0n:
      leaf(count, id, empty())
    case 1n+ +p:
      a b = batch_nodes(p, count, id) batch_nodes(p, count, id)
      combine(a, b)

def batch(+depth: Nat, +count: Nat, id: Nat) -> Evidence:
  batch_nodes(depth, count, id)

def evidence_json(e: Evidence) -> String:
  Evidence{hash, R.Real{hi, lo}, errors} = e
  "\"hash\":" ++ U32.show(hash) ++ ",\"hiBits\":" ++ U32.show(F32.bits(hi)) ++ ",\"loBits\":" ++ U32.show(F32.bits(lo)) ++ ",\"errors\":" ++ U32.show(errors)

def number(m: Maybe<&2, Nat>) -> Nat:
  match m:
    case Some{n}:
      n
    case None{}:
      0n
