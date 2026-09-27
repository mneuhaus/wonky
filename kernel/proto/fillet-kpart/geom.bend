import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J

# Geometry helpers of prototype A "fillet-kpart" (docs/fillet/proto-kpart.md):
# F32x2 scalars and vectors, the 2D section plane, face normals, edge
# tangents and edge/face incidence on the job's B-rep. Conventions are those
# of docs/fillet/theory.md §1 and scripts/fillet/geom.mjs: a face's outward
# normal is the carrier's natural normal, negated when same_sense is false;
# an edge runs start -> end, `same` says that is increasing curve parameter.

# ---------------------------------------------------------------------------
# Scalars

def rf(x: F32) -> R.Real:
  R.from_f32(x)

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def two_pi() -> R.Real:
  R.mul(R.pi(), R.from_f32(2.0))

# Linear decision tolerance (mm): equal widths, sphere vs torus, contacts on
# the axis. Inputs are F32x2 (≈1e-14 relative), so exact configurations land
# far inside it and every other configuration far outside.
def tol_lin() -> R.Real:
  R.from_f32(0.000000001)

# Direction tolerance (unit vectors): parallel axes, smooth edges.
def tol_dir() -> R.Real:
  R.from_f32(0.000000001)

def sq(+a: R.Real) -> R.Real:
  R.mul(a, a)

def half(a: R.Real) -> R.Real:
  R.mul(a, R.from_f32(0.5))

def is_neg(a: R.Real) -> Bool:
  R.less(a, zero())

def is_pos(a: R.Real) -> Bool:
  R.less(zero(), a)

# |a| < tol
def near(+a: R.Real, tol: R.Real) -> Bool:
  R.less(R.abs(a), tol)

def near_lin(a: R.Real) -> Bool:
  near(a, tol_lin())

def near_dir(a: R.Real) -> Bool:
  near(a, tol_dir())

def pick_r(c: Bool, a: R.Real, b: R.Real) -> R.Real:
  Bool.pick(R.Real, c, a, b)

def tan(+a: R.Real) -> R.Real:
  R.div(R.sin(a), R.cos(a))

# ---------------------------------------------------------------------------
# 3D vectors

def neg(v: G.Vec3) -> G.Vec3:
  G.scale(v, R.neg(R.from_f32(1.0)))

def len(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

def pick_v(c: Bool, a: G.Vec3, b: G.Vec3) -> G.Vec3:
  Bool.pick(G.Vec3, c, a, b)

def signed(c: Bool, +v: G.Vec3) -> G.Vec3:
  pick_v(c, v, neg(v))

def axpy(p: G.Vec3, +s: R.Real, d: G.Vec3) -> G.Vec3:
  G.add(p, G.scale(d, s))

# Component of p - o perpendicular to the unit axis a.
def radial(o: G.Vec3, +a: G.Vec3, p: G.Vec3) -> G.Vec3:
  +d = G.sub(p, o)
  G.sub(d, G.scale(a, G.dot(d, a)))

# |u × v| for unit vectors: 0 when parallel.
def cross_len(u: G.Vec3, v: G.Vec3) -> R.Real:
  len(G.cross(u, v))

def parallel(u: G.Vec3, v: G.Vec3) -> Bool:
  near_dir(cross_len(u, v))

# Distance of point p from the line (o, unit a).
def line_dist(o: G.Vec3, a: G.Vec3, p: G.Vec3) -> R.Real:
  len(radial(o, a, p))

def dist(a: G.Vec3, b: G.Vec3) -> R.Real:
  len(G.sub(a, b))

def zero_v() -> G.Vec3:
  G.v3(0.0, 0.0, 0.0)

# ---------------------------------------------------------------------------
# 2D (section plane) points and vectors

type P2 is Data:
  P2{x: R.Real, y: R.Real}

def p2(x: R.Real, y: R.Real) -> P2:
  P2{x, y}

def p2_add(a: P2, b: P2) -> P2:
  P2{ax, ay} = a
  P2{bx, by} = b
  P2{R.add(ax, bx), R.add(ay, by)}

def p2_sub(a: P2, b: P2) -> P2:
  P2{ax, ay} = a
  P2{bx, by} = b
  P2{R.sub(ax, bx), R.sub(ay, by)}

def p2_scale(a: P2, +s: R.Real) -> P2:
  P2{ax, ay} = a
  P2{R.mul(ax, s), R.mul(ay, s)}

def p2_dot(a: P2, b: P2) -> R.Real:
  P2{ax, ay} = a
  P2{bx, by} = b
  R.add(R.mul(ax, bx), R.mul(ay, by))

def p2_cross(a: P2, b: P2) -> R.Real:
  P2{ax, ay} = a
  P2{bx, by} = b
  R.sub(R.mul(ax, by), R.mul(ay, bx))

def p2_len(+a: P2) -> R.Real:
  R.sqrt(p2_dot(a, a))

def p2_unit(+a: P2) -> P2:
  p2_scale(a, R.div(one(), p2_len(a)))

# Rotated by +90°.
def p2_perp(a: P2) -> P2:
  P2{ax, ay} = a
  P2{R.neg(ay), ax}

def p2_x(a: P2) -> R.Real:
  P2{ax, _} = a
  ax

def p2_y(a: P2) -> R.Real:
  P2{_, ay} = a
  ay

def pick_p2(c: Bool, a: P2, b: P2) -> P2:
  Bool.pick(P2, c, a, b)

# ---------------------------------------------------------------------------
# Section frames. A translation section maps (x, y) -> e + x u + y w; a
# rotation (meridian) section maps (ρ, h) -> o + ρ r + h a.

type Sec is Data:
  Tra{e: G.Vec3, d: G.Vec3, u: G.Vec3, w: G.Vec3, len: R.Real}
  Rot{o: G.Vec3, a: G.Vec3, r: G.Vec3, closed: Bool}

def sec_dir(+s: Sec, +v: G.Vec3) -> P2:
  match s:
    case Tra{_, _, u, w, _}:
      P2{G.dot(u, v), G.dot(w, v)}
    case Rot{_, a, r, _}:
      P2{G.dot(r, v), G.dot(a, v)}

def sec_pt(+s: Sec, +p: G.Vec3) -> P2:
  match s:
    case Tra{e, _, u, w, _}:
      +q = G.sub(p, e)
      P2{G.dot(u, q), G.dot(w, q)}
    case Rot{o, a, r, _}:
      +q = G.sub(p, o)
      P2{G.dot(r, q), G.dot(a, q)}

def sec_lift(+s: Sec, q: P2) -> G.Vec3:
  match s:
    case Tra{e, _, u, w, _}:
      P2{x, y} = q
      G.add(e, G.add(G.scale(u, x), G.scale(w, y)))
    case Rot{o, a, r, _}:
      P2{x, y} = q
      G.add(o, G.add(G.scale(r, x), G.scale(a, y)))

def sec_lift_dir(+s: Sec, q: P2) -> G.Vec3:
  match s:
    case Tra{_, _, u, w, _}:
      P2{x, y} = q
      G.add(G.scale(u, x), G.scale(w, y))
    case Rot{_, a, r, _}:
      P2{x, y} = q
      G.add(G.scale(r, x), G.scale(a, y))

# Meridian coordinates (ρ, h) of any point about the axis (o, a).
def meridian(+o: G.Vec3, +a: G.Vec3, +p: G.Vec3) -> P2:
  +q = G.sub(p, o)
  P2{len(radial(o, a, p)), G.dot(a, q)}

# ---------------------------------------------------------------------------
# Lists

def vtx.m(m: Maybe<&2, G.Vec3>) -> G.Vec3:
  match m:
    case None{}:
      zero_v()
    case Some{x}:
      x

def vtx(+vs: List<&2, G.Vec3>, i: U32) -> G.Vec3:
  vtx.m(List.get(&2, G.Vec3, vs, U32.to_nat(i)))

def bad_edge() -> J.Edge:
  J.Edge{0, 0, J.CLine{zero_v(), G.v3(1.0, 0.0, 0.0)}, True{}, False{}, zero(), zero()}

def edge_at.m(m: Maybe<&2, J.Edge>) -> J.Edge:
  match m:
    case None{}:
      bad_edge()
    case Some{x}:
      x

def edge_at(+es: List<&2, J.Edge>, i: U32) -> J.Edge:
  edge_at.m(List.get(&2, J.Edge, es, U32.to_nat(i)))

def bad_face() -> J.Face:
  J.Face{True{}, J.SPlane{zero_v(), G.v3(0.0, 0.0, 1.0), G.v3(1.0, 0.0, 0.0)}, Nil{}}

def face_at.m(m: Maybe<&2, J.Face>) -> J.Face:
  match m:
    case None{}:
      bad_face()
    case Some{x}:
      x

def face_at(+fs: List<&2, J.Face>, i: U32) -> J.Face:
  face_at.m(List.get(&2, J.Face, fs, U32.to_nat(i)))

def count(-A: Data, xs: List<&2, A>) -> U32:
  U32.from_nat(List.length(&2, A, xs))

def mem(xs: List<&2, U32>, +x: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case h <> t:
      Bool.or(U32.is_eq(h, x), mem(t, x))

def le_u32(a: U32, b: U32) -> Bool:
  U32.is_le(a, b)

def push_if(c: Bool, x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match c:
    case True{}:
      x <> acc
    case False{}:
      acc

# Sorted, without duplicates.
def uniq.go(xs: List<&2, U32>, +last: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case h <> t:
      +k = h
      uniq.go(t, k, push_if(U32.is_ne(k, last), k, acc))

def uniq(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case h <> t:
      +k = h
      uniq.go(t, k, [k])

def sort_uniq(+xs: List<&2, U32>) -> List<&2, U32>:
  uniq(List.sort(~U32, ~le_u32, xs))

# ---------------------------------------------------------------------------
# Surfaces and faces

def surf_normal(+s: J.Surf, +p: G.Vec3) -> G.Vec3:
  match s:
    case J.SPlane{_, n, _}:
      n
    case J.SCyl{o, a, _, _}:
      G.normalize(radial(o, a, p))
    case J.SCone{o, a, _, _, ang}:
      G.normalize(G.sub(G.normalize(radial(o, a, p)), G.scale(a, tan(ang))))
    case J.SSphere{o, _, _, _}:
      G.normalize(G.sub(p, o))
    case J.STorus{o, a, _, big, _}:
      +c = G.add(o, G.scale(G.normalize(radial(o, a, p)), big))
      G.normalize(G.sub(p, c))

def face_normal(+f: J.Face, +p: G.Vec3) -> G.Vec3:
  J.Face{same, s, _} = f
  signed(same, surf_normal(s, p))

def face_surf(+f: J.Face) -> J.Surf:
  J.Face{_, s, _} = f
  s

# 0 plane, 1 cylinder, 2 cone, 3 sphere, 4 torus
def surf_kind(+s: J.Surf) -> U32:
  match s:
    case J.SPlane{_, _, _}:
      0
    case J.SCyl{_, _, _, _}:
      1
    case J.SCone{_, _, _, _, _}:
      2
    case J.SSphere{_, _, _, _}:
      3
    case J.STorus{_, _, _, _, _}:
      4

def surf_name(+k: U32) -> String:
  match k:
    case 0:
      "plane"
    case 1:
      "cylinder"
    case 2:
      "cone"
    case 3:
      "sphere"
    case _:
      "torus"

# ---------------------------------------------------------------------------
# Edges

def edge_start(+vs: List<&2, G.Vec3>, +e: J.Edge) -> G.Vec3:
  J.Edge{s, _, _, _, _, _, _} = e
  vtx(vs, s)

def edge_end(+vs: List<&2, G.Vec3>, +e: J.Edge) -> G.Vec3:
  J.Edge{_, t, _, _, _, _, _} = e
  vtx(vs, t)

def edge_s(+e: J.Edge) -> U32:
  J.Edge{s, _, _, _, _, _, _} = e
  s

def edge_e(+e: J.Edge) -> U32:
  J.Edge{_, t, _, _, _, _, _} = e
  t

def body_vs(+b: J.Body) -> List<&2, G.Vec3>:
  J.Body{vs, _, _} = b
  vs

def body_es(+b: J.Body) -> List<&2, J.Edge>:
  J.Body{_, es, _} = b
  es

def body_fs(+b: J.Body) -> List<&2, J.Face>:
  J.Body{_, _, fs} = b
  fs

def edge_closed(+e: J.Edge) -> Bool:
  J.Edge{s, t, _, _, _, _, _} = e
  U32.is_eq(s, t)

# 0 line, 1 circle, 2 ellipse
def curve_kind(+c: J.Curve) -> U32:
  match c:
    case J.CLine{_, _}:
      0
    case J.CCircle{_, _, _, _}:
      1
    case J.CEllipse{_, _, _, _, _}:
      2

def edge_curve(+e: J.Edge) -> J.Curve:
  J.Edge{_, _, c, _, _, _, _} = e
  c

# Unit tangent in the curve's increasing-parameter direction at p (on it).
def curve_tangent(+c: J.Curve, +p: G.Vec3) -> G.Vec3:
  match c:
    case J.CLine{_, d}:
      G.normalize(d)
    case J.CCircle{o, n, _, _}:
      G.normalize(G.cross(n, G.sub(p, o)))
    case J.CEllipse{o, n, x, a, b}:
      +q = G.sub(p, o)
      +y = G.cross(n, x)
      +cs = R.div(G.dot(q, x), a)
      +sn = R.div(G.dot(q, y), b)
      G.normalize(G.add(G.scale(x, R.neg(R.mul(a, sn))), G.scale(y, R.mul(b, cs))))

# Unit tangent start -> end at p.
def edge_tangent(+e: J.Edge, +p: G.Vec3) -> G.Vec3:
  J.Edge{_, _, c, same, _, _, _} = e
  signed(same, curve_tangent(c, p))

# ---------------------------------------------------------------------------
# Edge/face incidence: the face using the edge forward (its coedge runs
# start -> end) and the one using it reversed.

type Inc is Data:
  Inc{nfwd: U32, nrev: U32, ffwd: U32, frev: U32}

def inc.add(hit: Bool, fwd: Bool, +fi: U32, acc: Inc) -> Inc:
  match hit:
    case False{}:
      acc
    case True{}:
      match fwd:
        case True{}:
          Inc{nf, nr, ff, fr} = acc
          Inc{(nf + 1 : U32), nr, fi, fr}
        case False{}:
          Inc{nf, nr, ff, fr} = acc
          Inc{nf, (nr + 1 : U32), ff, fi}

def inc.uses(us: List<&2, J.Use>, +e: U32, +fi: U32, acc: Inc) -> Inc:
  match us:
    case Nil{}:
      acc
    case J.Use{edge, fwd} <> t:
      inc.uses(t, e, fi, inc.add(U32.is_eq(edge, e), fwd, fi, acc))

def inc.loops(ls: List<&2, J.Loop>, +e: U32, +fi: U32, acc: Inc) -> Inc:
  match ls:
    case Nil{}:
      acc
    case J.Loop{_, us} <> t:
      inc.loops(t, e, fi, inc.uses(us, e, fi, acc))

def inc.faces(fs: List<&2, J.Face>, +e: U32, +fi: U32, acc: Inc) -> Inc:
  match fs:
    case Nil{}:
      acc
    case J.Face{_, _, ls} <> t:
      inc.faces(t, e, (fi + 1 : U32), inc.loops(ls, e, fi, acc))

def incidence(fs: List<&2, J.Face>, e: U32) -> Inc:
  inc.faces(fs, e, 0, Inc{0, 0, 0, 0})

# Manifold edge between two different faces.
def inc_ok(+i: Inc) -> Bool:
  Inc{nf, nr, _, _} = i
  Bool.and(U32.is_eq(nf, 1), U32.is_eq(nr, 1))

def inc_seam(+i: Inc) -> Bool:
  Inc{nf, nr, ff, fr} = i
  Bool.and(Bool.and(U32.is_eq(nf, 1), U32.is_eq(nr, 1)), U32.is_eq(ff, fr))

# Edge indices of a face (all loops), in loop order.
def face_edges.uses(us: List<&2, J.Use>, acc: List<&2, U32>) -> List<&2, U32>:
  match us:
    case Nil{}:
      acc
    case J.Use{edge, _} <> t:
      face_edges.uses(t, edge <> acc)

def face_edges.loops(ls: List<&2, J.Loop>, acc: List<&2, U32>) -> List<&2, U32>:
  match ls:
    case Nil{}:
      acc
    case J.Loop{_, us} <> t:
      face_edges.loops(t, face_edges.uses(us, acc))

def face_edges(+f: J.Face) -> List<&2, U32>:
  J.Face{_, _, ls} = f
  List.reverse(&2, U32, face_edges.loops(ls, Nil{}))

# Edges (by index) with vertex v as an end.
def vertex_edges.go(es: List<&2, J.Edge>, +v: U32, +i: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match es:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case J.Edge{s, t, _, _, _, _, _} <> rest:
      vertex_edges.go(rest, v, (i + 1 : U32), push_if(Bool.or(U32.is_eq(s, v), U32.is_eq(t, v)), i, acc))

def vertex_edges(es: List<&2, J.Edge>, v: U32) -> List<&2, U32>:
  vertex_edges.go(es, v, 0, Nil{})

# Do edges a and b share a vertex?
def adjacent(+ea: J.Edge, +eb: J.Edge) -> Bool:
  J.Edge{as, ae, _, _, _, _, _} = ea
  J.Edge{bs, be, _, _, _, _, _} = eb
  +a0 = as
  +a1 = ae
  +b0 = bs
  +b1 = be
  Bool.or(Bool.or(U32.is_eq(a0, b0), U32.is_eq(a0, b1)), Bool.or(U32.is_eq(a1, b0), U32.is_eq(a1, b1)))

# ---------------------------------------------------------------------------
# Decimal text for reasons: indices, and point coordinates with 6 decimals
# (approximate, F32; the exact values are in the ladder data as F32x2
# words). Needed and available values use show_sci / show_gap below.

def put_digits(f: Nat, +n: U32, acc: String, more: Bool) -> String:
  match f:
    case 0n:
      acc
    case 1n+g:
      match more:
        case True{}:
          put_digits(g, (n / 10 : U32), SCon{Chr{(48 + (n % 10 : U32) : U32)}, acc}, (n >= 10 : U32))
        case False{}:
          acc

def show_u32(n: U32) -> String:
  put_digits(10n, n, "", True{})

def pad6.go(f: Nat, +n: U32, acc: String) -> String:
  match f:
    case 0n:
      acc
    case 1n+g:
      pad6.go(g, (n / 10 : U32), SCon{Chr{(48 + (n % 10 : U32) : U32)}, acc})

def show_dec.pos(+x: F32) -> String:
  +ip = F32.floor(x)
  +fr = F32.round(((x - ip) * 1000000.0 : F32))
  +carry = (fr >= 1000000.0 : F32)
  +ip2 = Bool.pick(F32, carry, (ip + 1.0 : F32), ip)
  +fr2 = Bool.pick(F32, carry, 0.0, fr)
  show_u32(U32.from_nat(F32.to_nat(ip2))) ++ "." ++ pad6.go(6n, U32.from_nat(F32.to_nat(fr2)), "")

def show_dec.if(neg: Bool, +x: F32) -> String:
  match neg:
    case True{}:
      "-" ++ show_dec.pos(F32.neg(x))
    case False{}:
      show_dec.pos(x)

# Fixed-point text with 6 decimals.
def show_dec(r: R.Real) -> String:
  +x = R.approx(r)
  show_dec.if((x < 0.0 : F32), x)

# Exponent text for reasons (harness step 0, docs/fillet-plan.md §8): a
# refusal names the needed and the available value with ten significant
# digits of their F32x2 value and their difference with four, e.g. "needs
# width 1.000000100e+0 but ... lies at 1.000000000e+0 (short by 1.000e-7)".
# Fixed-point text with 6 decimals hid differences below 1e-6 mm ("1.000000
# vs 1.000000"), and with them the tolerance a case would need.

type Sci is Data:
  Sci{m: R.Real, e: U32}

# Decimal exponents are stored with a bias of 400 (U32 has no sign).
def sci_bias() -> U32:
  400

# Scale m into [1, 10) by powers of ten, counting the exponent: `small`
# (m < 1) and `big` (m >= 10) are the state of the current m; `fuel`
# bounds the steps.
def sci_norm(fuel: Nat, +small: Bool, +big: Bool, +m: R.Real, +e: U32) -> Sci:
  match fuel:
    case 0n:
      Sci{m, e}
    case 1n+f:
      match small:
        case True{}:
          +up = R.mul(m, R.from_f32(10.0))
          sci_norm(f, R.less(up, one()), Bool.not(R.less(up, R.from_f32(10.0))), up, (e - 1 : U32))
        case False{}:
          match big:
            case True{}:
              +dn = R.div(m, R.from_f32(10.0))
              sci_norm(f, R.less(dn, one()), Bool.not(R.less(dn, R.from_f32(10.0))), dn, (e + 1 : U32))
            case False{}:
              Sci{m, e}

# The leading decimal digit of m in [0, 10): the floor of the F32 sum,
# lowered by one where that sum rounds up across an integer.
def sci_digit(+m: R.Real) -> F32:
  +d = F32.floor(R.approx(m))
  +d2 = Bool.pick(F32, R.less(R.sub(m, R.from_f32(d)), zero()), (d - 1.0 : F32), d)
  Bool.pick(F32, (d2 > 9.0 : F32), 9.0, Bool.pick(F32, (d2 < 0.0 : F32), 0.0, d2))

def digit_txt(+d: F32) -> String:
  SCon{Chr{(48 + U32.from_nat(F32.to_nat(d)) : U32)}, ""}

def sci_digits(n: Nat, +m: R.Real, acc: String) -> String:
  match n:
    case 0n:
      acc
    case 1n+k:
      +d = sci_digit(m)
      sci_digits(k, R.mul(R.sub(m, R.from_f32(d)), R.from_f32(10.0)), acc ++ digit_txt(d))

def sci_exp.pick(+pos: Bool, +e: U32) -> String:
  match pos:
    case True{}:
      "e+" ++ show_u32((e - sci_bias() : U32))
    case False{}:
      "e-" ++ show_u32((sci_bias() - e : U32))

def sci_exp(+e: U32) -> String:
  sci_exp.pick((e >= sci_bias() : U32), e)

# The text of a mantissa in [1, 10) (already rounded) and its exponent.
def sci_txt(+s: Sci, rest: Nat) -> String:
  match s:
    case Sci{m, e}:
      +d = sci_digit(m)
      digit_txt(d) ++ "." ++ sci_digits(rest, R.mul(R.sub(m, R.from_f32(d)), R.from_f32(10.0)), "") ++ sci_exp(e)

# Round by adding `half` (5 x 10^-(rest+1)) to the mantissa; renormalise
# when that carries to 10.
def sci_round(+s: Sci, rest: Nat, half: F32) -> String:
  match s:
    case Sci{m0, e0}:
      +m1 = R.add(m0, R.from_f32(half))
      sci_txt(sci_norm(1n, False{}, Bool.not(R.less(m1, R.from_f32(10.0))), m1, e0), rest)

# 1 + `rest` significant digits of r > 0.
def sci_pos(+r: R.Real, rest: Nat, half: F32) -> String:
  sci_round(sci_norm(200n, R.less(r, one()), Bool.not(R.less(r, R.from_f32(10.0))), r, sci_bias()), rest, half)

def show_sci.pick(+z: Bool, +neg: Bool, +r: R.Real, rest: Nat, half: F32) -> String:
  match z:
    case True{}:
      "0"
    case False{}:
      match neg:
        case True{}:
          "-" ++ sci_pos(R.neg(r), rest, half)
        case False{}:
          sci_pos(r, rest, half)

# A needed or an available value: ten significant digits.
def show_sci(+r: R.Real) -> String:
  show_sci.pick(R.equal(r, zero()), is_neg(r), r, 9n, 0.0000000005)

# A difference (needed minus available, a gap): four significant digits.
def show_gap(+r: R.Real) -> String:
  show_sci.pick(R.equal(r, zero()), is_neg(r), r, 3n, 0.0005)
