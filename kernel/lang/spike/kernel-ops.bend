import Base
import ../../../kernel/real.bend as R
import ../../../kernel/geometry.bend as GE
import ../../../kernel/precise.bend as G
import ../../../kernel/analytic.bend as A
import ../../../kernel/topology.bend as T
import ../../../kernel/face-classification.bend as F
import ../../../kernel/ports/solid-intersection.bend as SI
import ../../../kernel/ports/planar-boolean.bend as PB
import ../../../kernel/ports/planar-boolean-types.bend as PT
import ../../../scripts/build123d-workload.bend as W
import ./core.bend as C

# ===========================================================================
# Kernel builtins of the core-language spike. Every geometric result is
# produced by the production Bend kernel functions that
# scripts/build123d-workload.bend (the native build123d reference workload)
# calls: topology.extrude, the F32 -> F32x2 analytic lift of
# face-classification, ports/planar-boolean union/subtract and
# ports/solid-intersection.planar_measures. Unsupported inputs raise explicit
# capability errors carrying the call's span id; nothing is approximated or
# silently repaired.
# ===========================================================================

def cap(span: U32, msg: String) -> C.Value:
  C.VErr{6, span, msg, Nil{}}

def type_err(span: U32, msg: String) -> C.Value:
  C.VErr{2, span, msg, Nil{}}

# The kernel's extrude takes F32 profile coordinates. A core number is an
# F32x2 Real; it is accepted only when its low word is zero, i.e. when the
# F32 conversion is exact. Anything else is a capability error, never a
# rounding.
def f32_pick(ok: Bool, hi: F32) -> Maybe<&2, F32>:
  match ok:
    case True{}:
      Some{hi}
    case False{}:
      None{}

def exact_f32(r: R.Real) -> Maybe<&2, F32>:
  R.Real{hi, lo} = r
  f32_pick(F32.is_eq(lo, 0.0), hi)

def num_f32(v: C.Value) -> Maybe<&2, F32>:
  match v:
    case C.VNum{r}:
      exact_f32(r)
    case _:
      None{}

def point_of(+z: F32, xy: List<&2, C.Value>) -> Maybe<&2, GE.Vec3>:
  match xy:
    case x <> y <> Nil{}:
      do Maybe<&2, GE.Vec3>:
        px : F32 <- num_f32(x)
        py : F32 <- num_f32(y)
        return GE.V3{px, py, z}
    case _:
      None{}

def point_value(+z: F32, p: C.Value) -> Maybe<&2, GE.Vec3>:
  match p:
    case C.VList{xy}:
      point_of(z, xy)
    case _:
      None{}

def profile(ps: List<&2, C.Value>, +z: F32) -> Maybe<&2, List<&2, GE.Vec3>>:
  match ps:
    case Nil{}:
      Some{Nil{}}
    case p <> rest:
      do Maybe<&2, List<&2, GE.Vec3>>:
        v : GE.Vec3 <- point_value(z, p)
        vs : List<&2, GE.Vec3> <- profile(rest, z)
        return v <> vs

# Twice the signed area of the closed profile in exact-enough F32x2 (the
# inputs are exact F32 values). Only counter-clockwise, non-degenerate
# profiles are accepted: topology.extrude orients its faces from the area
# vector and the planar Boolean assumes outward normals.
def cross2(a: GE.Vec3, b: GE.Vec3) -> R.Real:
  GE.V3{ax, ay, az} = a
  GE.V3{bx, by, bz} = b
  R.sub(R.mul(R.from_f32(ax), R.from_f32(by)), R.mul(R.from_f32(bx), R.from_f32(ay)))

def shoelace_pair(rest: List<&2, GE.Vec3>, a: GE.Vec3, +first: GE.Vec3) -> R.Real:
  match rest:
    case Nil{}:
      cross2(a, first)
    case b <> more:
      +bb = b
      R.add(cross2(a, bb), shoelace_pair(more, bb, first))

def shoelace(vs: List<&2, GE.Vec3>, +first: GE.Vec3) -> R.Real:
  match vs:
    case Nil{}:
      R.from_f32(0.0)
    case a <> rest:
      shoelace_pair(rest, a, first)

# Checked version of the workload's analytic lift: a degenerate edge is an
# error here instead of the workload's hash placeholder.
def analytic_edges_checked(+vs: List<&2, G.Vec3>, es: List<&2, T.Edge>) -> Maybe<&2, List<&2, A.Edge>>:
  match es:
    case Nil{}:
      Some{Nil{}}
    case T.Edge{s, e} <> tail:
      do Maybe<&2, List<&2, A.Edge>>:
        edge : A.Edge <- F.linear_edge(vs, s, e)
        rest : List<&2, A.Edge> <- analytic_edges_checked(vs, tail)
        return edge <> rest

def lift_finish(+span: U32, es: Maybe<&2, List<&2, A.Edge>>, lifted: List<&2, G.Vec3>, fs: List<&2, T.Face>, n: Nat) -> C.Value:
  match es:
    case Some{edges}:
      C.VBody{A.Solid{lifted, edges, W.analytic_faces(fs)}, W.autos(Nat.mul(3n, n))}
    case None{}:
      cap(span, "extrude produced a degenerate edge")

def lift_checked(+span: U32, s: T.Solid, +n: Nat) -> C.Value:
  T.Solid{vs, es, fs} = s
  +lifted = W.lift_points(vs)
  lift_finish(span, analytic_edges_checked(lifted, es), lifted, fs, n)

def extrude_checked(+span: U32, ok: Bool, +pts: List<&2, GE.Vec3>, +h: F32) -> C.Value:
  match ok:
    case True{}:
      lift_checked(span, T.extrude(pts, GE.V3{0.0, 0.0, h}), List.length(&2, GE.Vec3, pts))
    case False{}:
      cap(span, "extrude needs >= 3 profile points, a counter-clockwise non-degenerate profile and a positive height")

def extrude_profile(+span: U32, m: Maybe<&2, List<&2, GE.Vec3>>, +h: F32) -> C.Value:
  match m:
    case None{}:
      cap(span, "extrude profile must be a list of [x y] numbers exactly representable as F32")
    case Some{+pts}:
      +first = GE.first_or(pts, GE.V3{0.0, 0.0, 0.0})
      +three = Nat.is_ge(List.length(&2, GE.Vec3, pts), 3n)
      +ccw = R.less(R.from_f32(0.0), shoelace(pts, first))
      extrude_checked(span, Bool.and(three, Bool.and(ccw, (h > 0.0 : F32))), pts, h)

def extrude_zh(+span: U32, ps: List<&2, C.Value>, mz: Maybe<&2, F32>, mh: Maybe<&2, F32>) -> C.Value:
  match mz:
    case Some{+z}:
      match mh:
        case Some{+h}:
          extrude_profile(span, profile(ps, z), h)
        case None{}:
          cap(span, "extrude height must be exactly representable as F32")
    case None{}:
      cap(span, "extrude base z must be exactly representable as F32")

def extrude3(+span: U32, p: C.Value, z: C.Value, h: C.Value) -> C.Value:
  match p:
    case C.VList{ps}:
      extrude_zh(span, ps, num_f32(z), num_f32(h))
    case C.VErr{c, s, m, t}:
      C.VErr{c, s, m, t}
    case _:
      type_err(span, "extrude expects a profile list")

def prim_extrude(+span: U32, xs: List<&2, C.Value>) -> C.Value:
  match xs:
    case p <> z <> h <> Nil{}:
      extrude3(span, p, z, h)
    case _:
      C.VErr{3, span, "extrude expects (profile z height)", Nil{}}

# --- planar Boolean -------------------------------------------------------

def single_rest(+span: U32, s: A.Solid, d: List<&2, F.DomainChoice>, rest: List<&2, PT.Body>) -> C.Value:
  match rest:
    case Nil{}:
      C.VBody{s, d}
    case _:
      cap(span, "Boolean produced several disjoint bodies; multi-body values are not supported by the spike")

def single_body(+span: U32, bs: List<&2, PT.Body>) -> C.Value:
  match bs:
    case Nil{}:
      cap(span, "Boolean produced an empty result; empty bodies are not representable in the spike")
    case PT.Body{s, d, fo, eo} <> rest:
      single_rest(span, s, d, rest)

def boolean_result(+span: U32, r: PT.Result) -> C.Value:
  match r:
    case PT.Bodies{bs, sb, st}:
      single_body(span, bs)
    case PT.Unresolved{rs, sg, dt, sb, st}:
      cap(span, "planar Boolean unresolved at stage " ++ U32.show(sg) ++ ", detail " ++ U32.show(dt))

# The source budgets are zero exactly as in the reference workload's
# chained_union (scripts/build123d-workload.bend), so results are
# bit-comparable with it.
def run_boolean(+span: U32, subtraction: Bool, sa: A.Solid, da: List<&2, F.DomainChoice>, sb: A.Solid, db: List<&2, F.DomainChoice>) -> C.Value:
  match subtraction:
    case True{}:
      boolean_result(span, PB.subtract(sa, da, W.zero(), sb, db, W.zero(), W.tolerance()))
    case False{}:
      boolean_result(span, PB.union(sa, da, W.zero(), sb, db, W.zero(), W.tolerance()))

def boolean2(+span: U32, a: C.Value, b: C.Value, subtraction: Bool) -> C.Value:
  match a:
    case C.VBody{sa, da}:
      match b:
        case C.VBody{sb, db}:
          run_boolean(span, subtraction, sa, da, sb, db)
        case C.VErr{c, s, m, t}:
          C.VErr{c, s, m, t}
        case _:
          type_err(span, "Boolean expects two bodies")
    case C.VErr{c, s, m, t}:
      C.VErr{c, s, m, t}
    case _:
      type_err(span, "Boolean expects two bodies")

def prim_boolean(+span: U32, xs: List<&2, C.Value>, subtraction: Bool) -> C.Value:
  match xs:
    case a <> b <> Nil{}:
      boolean2(span, a, b, subtraction)
    case _:
      C.VErr{3, span, "Boolean expects 2 arguments", Nil{}}

def volume_of(m: SI.PlanarMeasures) -> C.Value:
  SI.PlanarMeasures{v, b} = m
  C.VNum{v}

def faces_of(s: A.Solid) -> C.Value:
  A.Solid{vs, es, fs} = s
  C.VNum{R.from_f32(U32.to_f32(U32.from_nat(List.length(&2, A.Face, fs))))}

def measure_body(which: U32, s: A.Solid) -> C.Value:
  match which:
    case 0:
      volume_of(SI.planar_measures(s))
    case _:
      faces_of(s)

def measure1(+span: U32, a: C.Value, which: U32) -> C.Value:
  match a:
    case C.VBody{s, d}:
      measure_body(which, s)
    case C.VErr{c, s, m, t}:
      C.VErr{c, s, m, t}
    case _:
      type_err(span, "volume/faces expects a body")

def prim_measure(+span: U32, xs: List<&2, C.Value>, which: U32) -> C.Value:
  match xs:
    case a <> Nil{}:
      measure1(span, a, which)
    case _:
      C.VErr{3, span, "volume/faces expects 1 argument", Nil{}}

# The ~kernel template argument of C.step: kernel ops first, then the pure
# primitives. Compile-time inlined, so no closure call per primitive.
def kernel(span: U32, op: C.Op, xs: List<&2, C.Value>) -> C.Value:
  match op:
    case C.OExtrude{}:
      prim_extrude(span, xs)
    case C.OUnion{}:
      prim_boolean(span, xs, False{})
    case C.OSubtract{}:
      prim_boolean(span, xs, True{})
    case C.OVolume{}:
      prim_measure(span, xs, 0)
    case C.OFaces{}:
      prim_measure(span, xs, 1)
    case _:
      C.pure_prim(span, op, xs)

def no_kernel(span: U32, op: C.Op, xs: List<&2, C.Value>) -> C.Value:
  C.pure_prim(span, op, xs)

# Evidence of a body, identical to W.measured_evidence so a core-language
# result can be compared bit for bit with the native reference workload.
def body_hash(s: A.Solid) -> W.Evidence:
  W.measured_evidence(s)
