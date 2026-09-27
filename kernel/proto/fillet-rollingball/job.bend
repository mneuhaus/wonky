import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./io.bend as T

# Reader of the fillet job (docs/fillet/harness.md, "Job and result format"):
#
#   wonky-fillet-job 1 / case <id> / op fillet|chamfer / size <real> /
#   chamfer <kind> / propagate 0|1 / brep V E F / v.. / e.. / f.. /
#   select k <edges> / end
#
# Loops are kept only as edge uses (edge, forward): the contact solver needs
# the two faces of an edge and the direction each face runs it, not the loop
# structure. Anything malformed ends as Malformed with a named reason.

type Curve is Data:
  Line{o: G.Vec3, d: G.Vec3}
  Circle{o: G.Vec3, n: G.Vec3, x: G.Vec3, r: R.Real}
  Ellipse{o: G.Vec3, n: G.Vec3, x: G.Vec3, a: R.Real, b: R.Real}
  BadCurve{}

type Surf is Data:
  Plane{o: G.Vec3, n: G.Vec3, x: G.Vec3}
  Cyl{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real}
  Cone{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, ang: R.Real}
  Sphere{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real}
  Torus{o: G.Vec3, a: G.Vec3, x: G.Vec3, big: R.Real, small: R.Real}
  BadSurf{}

# same: 1 when start -> end is the increasing curve parameter; ranged: 1 when
# [first, last] is stated.
type Edge is Data:
  Edge{start: U32, end: U32, curve: Curve, same: U32, ranged: U32, first: R.Real, last: R.Real}

type Use is Data:
  Use{edge: U32, fwd: U32}

# A loop keeps its outer flag and its uses in order (the B-rep builders of
# stage 2 need them); `uses` of a face is every loop's uses, in order.
type Loop is Data:
  Loop{outer: U32, uses: List<&2, Use>}

type Face is Data:
  Face{same: U32, surf: Surf, uses: List<&2, Use>, loops: List<&2, Loop>}

# op: 0 fillet, 1 chamfer.
type Job is Data:
  Job{id: String, op: U32, size: R.Real, verts: List<&2, G.Vec3>, edges: List<&2, Edge>, faces: List<&2, Face>, select: List<&2, U32>}

type Parse is Data:
  Parsed{job: Job}
  Malformed{why: String}

type Head is Data:
  Head{id: String, op: U32, size: R.Real}

# ---------------------------------------------------------------------------
# Geometry records from flat real lists

def vec_of(+x: R.Real, +y: R.Real, +z: R.Real) -> G.Vec3:
  G.V3{x, y, z}

def curve_line(xs: List<&2, R.Real>) -> Curve:
  match xs:
    case ox <> oy <> oz <> dx <> dy <> dz <> Nil{}:
      Line{G.V3{ox, oy, oz}, G.V3{dx, dy, dz}}
    case _:
      BadCurve{}

def curve_circle(xs: List<&2, R.Real>) -> Curve:
  match xs:
    case ox <> oy <> oz <> nx <> ny <> nz <> xx <> xy <> xz <> r <> Nil{}:
      Circle{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}, r}
    case _:
      BadCurve{}

def curve_ellipse(xs: List<&2, R.Real>) -> Curve:
  match xs:
    case ox <> oy <> oz <> nx <> ny <> nz <> xx <> xy <> xz <> a <> b <> Nil{}:
      Ellipse{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}, a, b}
    case _:
      BadCurve{}

def surf_plane(xs: List<&2, R.Real>) -> Surf:
  match xs:
    case ox <> oy <> oz <> nx <> ny <> nz <> xx <> xy <> xz <> Nil{}:
      Plane{G.V3{ox, oy, oz}, G.V3{nx, ny, nz}, G.V3{xx, xy, xz}}
    case _:
      BadSurf{}

def surf_cyl(xs: List<&2, R.Real>) -> Surf:
  match xs:
    case ox <> oy <> oz <> ax <> ay <> az <> xx <> xy <> xz <> r <> Nil{}:
      Cyl{G.V3{ox, oy, oz}, G.V3{ax, ay, az}, G.V3{xx, xy, xz}, r}
    case _:
      BadSurf{}

def surf_cone(xs: List<&2, R.Real>) -> Surf:
  match xs:
    case ox <> oy <> oz <> ax <> ay <> az <> xx <> xy <> xz <> r <> g <> Nil{}:
      Cone{G.V3{ox, oy, oz}, G.V3{ax, ay, az}, G.V3{xx, xy, xz}, r, g}
    case _:
      BadSurf{}

def surf_sphere(xs: List<&2, R.Real>) -> Surf:
  match xs:
    case ox <> oy <> oz <> ax <> ay <> az <> xx <> xy <> xz <> r <> Nil{}:
      Sphere{G.V3{ox, oy, oz}, G.V3{ax, ay, az}, G.V3{xx, xy, xz}, r}
    case _:
      BadSurf{}

def surf_torus(xs: List<&2, R.Real>) -> Surf:
  match xs:
    case ox <> oy <> oz <> ax <> ay <> az <> xx <> xy <> xz <> big <> small <> Nil{}:
      Torus{G.V3{ox, oy, oz}, G.V3{ax, ay, az}, G.V3{xx, xy, xz}, big, small}
    case _:
      BadSurf{}

# kind: 1 line, 2 circle, 3 ellipse, 0 unknown
def curve_kind(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "line"), 1, Bool.pick(U32, String.eq(w, "circle"), 2, Bool.pick(U32, String.eq(w, "ellipse"), 3, 0)))

def curve_count(+k: U32) -> Nat:
  match k:
    case 1:
      6n
    case 2:
      10n
    case 3:
      11n
    case _:
      0n

def curve_build(k: U32, xs: List<&2, R.Real>) -> Curve:
  match k:
    case 1:
      curve_line(xs)
    case 2:
      curve_circle(xs)
    case 3:
      curve_ellipse(xs)
    case _:
      BadCurve{}

def curve.k(+k: U32, p: List<&2, R.Real> & String) -> Curve & String:
  (xs, s) = p
  (curve_build(k, xs), Bool.pick(String, U32.is_eq(k, 0), T.poison(), s))

def curve.w(p: String & String) -> Curve & String:
  (w, s) = p
  +k = curve_kind(w)
  curve.k(k, T.reals(curve_count(k), s))

def curve(s: String) -> Curve & String:
  curve.w(T.word(s))

# kind: 1 plane, 2 cylinder, 3 cone, 4 sphere, 5 torus, 0 unknown
def surf_kind(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "plane"), 1, Bool.pick(U32, String.eq(w, "cylinder"), 2, Bool.pick(U32, String.eq(w, "cone"), 3, Bool.pick(U32, String.eq(w, "sphere"), 4, Bool.pick(U32, String.eq(w, "torus"), 5, 0)))))

def surf_count(+k: U32) -> Nat:
  match k:
    case 1:
      9n
    case 2:
      10n
    case 3:
      11n
    case 4:
      10n
    case 5:
      11n
    case _:
      0n

def surf_build(k: U32, xs: List<&2, R.Real>) -> Surf:
  match k:
    case 1:
      surf_plane(xs)
    case 2:
      surf_cyl(xs)
    case 3:
      surf_cone(xs)
    case 4:
      surf_sphere(xs)
    case 5:
      surf_torus(xs)
    case _:
      BadSurf{}

def surf.k(+k: U32, p: List<&2, R.Real> & String) -> Surf & String:
  (xs, s) = p
  (surf_build(k, xs), Bool.pick(String, U32.is_eq(k, 0), T.poison(), s))

def surf.w(p: String & String) -> Surf & String:
  (w, s) = p
  +k = surf_kind(w)
  surf.k(k, T.reals(surf_count(k), s))

def surf(s: String) -> Surf & String:
  surf.w(T.word(s))

# ---------------------------------------------------------------------------
# Vertices: "v x y z"

def vertex.k(p: List<&2, R.Real> & String) -> G.Vec3 & String:
  (xs, s) = p
  match xs:
    case x <> y <> z <> Nil{}:
      (G.V3{x, y, z}, s)
    case _:
      (G.v3(0.0, 0.0, 0.0), T.poison())

def vertex(s: String) -> G.Vec3 & String:
  vertex.k(T.reals(3n, T.expect(s, "v")))

def vertices.go(n: Nat, st: G.Vec3 & String, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, G.Vec3, v <> acc), s)
    case 1n+p:
      (v, s) = st
      vertices.go(p, vertex(s), v <> acc)

def vertices(n: Nat, s: String) -> List<&2, G.Vec3> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      vertices.go(p, vertex(s), Nil{})

# ---------------------------------------------------------------------------
# Edges: "e start end <curve> same ranged first last"

def edge.done(a: U32, b: U32, c: Curve, same: U32, ranged: U32, xs: List<&2, R.Real>, s: String) -> Edge & String:
  match xs:
    case f <> l <> Nil{}:
      (Edge{a, b, c, same, ranged, f, l}, s)
    case _:
      (Edge{a, b, BadCurve{}, 0, 0, R.from_f32(0.0), R.from_f32(0.0)}, T.poison())

def edge.done.k(a: U32, b: U32, c: Curve, same: U32, ranged: U32, p: List<&2, R.Real> & String) -> Edge & String:
  (xs, s) = p
  edge.done(a, b, c, same, ranged, xs, s)

def edge.range(a: U32, b: U32, c: Curve, fl: List<&2, U32>, p: List<&2, R.Real> & String) -> Edge & String:
  match fl:
    case same <> ranged <> Nil{}:
      edge.done.k(a, b, c, same, ranged, p)
    case _:
      (Edge{a, b, BadCurve{}, 0, 0, R.from_f32(0.0), R.from_f32(0.0)}, T.poison())

def edge.tail(a: U32, b: U32, c: Curve, p: List<&2, U32> & String) -> Edge & String:
  (fl, s) = p
  edge.range(a, b, c, fl, T.reals(2n, s))

def edge.curve(a: U32, b: U32, p: Curve & String) -> Edge & String:
  (c, s) = p
  edge.tail(a, b, c, T.numbers(2n, s))

def edge.ends(p: List<&2, U32> & String) -> Edge & String:
  (ab, s) = p
  match ab:
    case a <> b <> Nil{}:
      edge.curve(a, b, curve(s))
    case _:
      (Edge{0, 0, BadCurve{}, 0, 0, R.from_f32(0.0), R.from_f32(0.0)}, T.poison())

def edge(s: String) -> Edge & String:
  edge.ends(T.numbers(2n, T.expect(s, "e")))

def edges.go(n: Nat, st: Edge & String, acc: List<&2, Edge>) -> List<&2, Edge> & String:
  match n:
    case 0n:
      (e, s) = st
      (List.reverse(&2, Edge, e <> acc), s)
    case 1n+p:
      (e, s) = st
      edges.go(p, edge(s), e <> acc)

def edges(n: Nat, s: String) -> List<&2, Edge> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      edges.go(p, edge(s), Nil{})

# ---------------------------------------------------------------------------
# Faces: "f same <surf> nloops (l outer n (edge fwd)^n)^nloops"

def pairs_to_uses(xs: List<&2, U32>, acc: List<&2, Use>) -> List<&2, Use>:
  match xs:
    case e <> f <> t:
      pairs_to_uses(t, Use{e, f} <> acc)
    case _:
      acc

def loop.mk(outer: U32, p: List<&2, U32> & String) -> Loop & String:
  (xs, s) = p
  (Loop{outer, List.reverse(&2, Use, pairs_to_uses(xs, Nil{}))}, s)

def loop.body(outer: U32, p: U32 & String) -> Loop & String:
  (n, s) = p
  loop.mk(outer, T.numbers(Nat.mul(2n, U32.to_nat(n)), s))

def loop.outer(p: U32 & String) -> Loop & String:
  (outer, s) = p
  loop.body(outer, T.number(s))

def loop(s: String) -> Loop & String:
  loop.outer(T.number(T.expect(s, "l")))

def loops.push(acc: List<&2, Loop>, r: Loop & String) -> List<&2, Loop> & String:
  (l, s) = r
  (l <> acc, s)

def loops.go(n: Nat, st: List<&2, Loop> & String) -> List<&2, Loop> & String:
  match n:
    case 0n:
      st
    case 1n+p:
      (acc, s) = st
      loops.go(p, loops.push(acc, loop(s)))

def loop_uses(+l: Loop) -> List<&2, Use>:
  Loop{_, us} = l
  us

def flat_uses(ls: List<&2, Loop>, acc: List<&2, Use>) -> List<&2, Use>:
  match ls:
    case Nil{}:
      acc
    case +h <> t:
      flat_uses(t, List.append(&2, Use, acc, loop_uses(h)))

def face.done(same: U32, sf: Surf, p: List<&2, Loop> & String) -> Face & String:
  (ls, s) = p
  +ordered = List.reverse(&2, Loop, ls)
  (Face{same, sf, flat_uses(ordered, Nil{}), ordered}, s)

def face.loops(same: U32, sf: Surf, p: U32 & String) -> Face & String:
  (nl, s) = p
  face.done(same, sf, loops.go(U32.to_nat(nl), (Nil{}, s)))

def face.surf(same: U32, p: Surf & String) -> Face & String:
  (sf, s) = p
  face.loops(same, sf, T.number(s))

def face.same(p: U32 & String) -> Face & String:
  (same, s) = p
  face.surf(same, surf(s))

def face(s: String) -> Face & String:
  face.same(T.number(T.expect(s, "f")))

def faces.go(n: Nat, st: Face & String, acc: List<&2, Face>) -> List<&2, Face> & String:
  match n:
    case 0n:
      (f, s) = st
      (List.reverse(&2, Face, f <> acc), s)
    case 1n+p:
      (f, s) = st
      faces.go(p, face(s), f <> acc)

def faces(n: Nat, s: String) -> List<&2, Face> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      faces.go(p, face(s), Nil{})

# ---------------------------------------------------------------------------
# Header and body

def op_code(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "fillet"), 0, Bool.pick(U32, String.eq(w, "chamfer"), 1, 9))

def finish.check(j: Job, ok: Bool) -> Parse:
  match ok:
    case True{}:
      Parsed{j}
    case False{}:
      Malformed{"job does not parse (bad token, unknown curve/surface or op, or missing end)"}

def finish.end(h: Head, vs: List<&2, G.Vec3>, es: List<&2, Edge>, fs: List<&2, Face>, sel: List<&2, U32>, p: String & String) -> Parse:
  Head{id, +op, size} = h
  (w, _) = p
  finish.check(Job{id, op, size, vs, es, fs, sel}, Bool.and(String.eq(w, "end"), U32.is_lt(op, 2)))

def finish(h: Head, vs: List<&2, G.Vec3>, es: List<&2, Edge>, fs: List<&2, Face>, p: List<&2, U32> & String) -> Parse:
  (sel, s) = p
  finish.end(h, vs, es, fs, sel, T.word(s))

def select(h: Head, vs: List<&2, G.Vec3>, es: List<&2, Edge>, fs: List<&2, Face>, p: U32 & String) -> Parse:
  (k, s) = p
  finish(h, vs, es, fs, T.numbers(U32.to_nat(k), s))

def body.f(h: Head, vs: List<&2, G.Vec3>, es: List<&2, Edge>, p: List<&2, Face> & String) -> Parse:
  (fs, s) = p
  select(h, vs, es, fs, T.number(T.expect(s, "select")))

def body.e(h: Head, vs: List<&2, G.Vec3>, nf: U32, p: List<&2, Edge> & String) -> Parse:
  (es, s) = p
  body.f(h, vs, es, faces(U32.to_nat(nf), s))

def body.v(h: Head, ne: U32, nf: U32, p: List<&2, G.Vec3> & String) -> Parse:
  (vs, s) = p
  body.e(h, vs, nf, edges(U32.to_nat(ne), s))

def body(h: Head, p: List<&2, U32> & String) -> Parse:
  (counts, s) = p
  match counts:
    case nv <> ne <> nf <> Nil{}:
      body.v(h, ne, nf, vertices(U32.to_nat(nv), s))
    case _:
      Malformed{"bad brep counts"}

def head.prop(h: Head, p: U32 & String) -> Parse:
  (_, s) = p
  body(h, T.numbers(3n, T.expect(s, "brep")))

def head.cham(h: Head, p: String & String) -> Parse:
  (_, s) = p
  head.prop(h, T.number(T.expect(s, "propagate")))

def head.size(id: String, op: U32, p: R.Real & String) -> Parse:
  (size, s) = p
  head.cham(Head{id, op, size}, T.word(T.expect(s, "chamfer")))

def head.op(id: String, p: String & String) -> Parse:
  (w, s) = p
  head.size(id, op_code(w), T.real(T.expect(s, "size")))

def head.id(p: String & String) -> Parse:
  (id, s) = p
  head.op(id, T.word(T.expect(s, "op")))

def parse.if(ok: Bool, rest: String) -> Parse:
  match ok:
    case True{}:
      head.id(T.word(T.expect(rest, "case")))
    case False{}:
      Malformed{"first line is not wonky-fillet-job 1"}

def parse.magic(p: String & String) -> Parse:
  (magic, rest) = p
  parse.if(String.eq(magic, "wonky-fillet-job 1"), rest)

def parse(job: String) -> Parse:
  parse.magic(T.line(job))
