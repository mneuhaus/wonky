import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A

# Job reader of the production fillet (prototype A "fillet-kpart" ported onto
# the production carriers; docs/fillet-plan.md §8 step 2,
# docs/fillet/proto-kpart.md). Reads the harness job text
# (docs/fillet/harness.md, "Job and result format") into the fillet's working
# B-rep. Carriers are kernel/analytic.bend's Surface and Curve (a cone may
# carry a negative angle here: radius r + h tan(angle));
# kernel/fillet/production.bend writes the production solid. The topology
# records (Edge with its stated parameter range, Use, Loop, Face, Body) stay
# local: the surgery reads the ranges, the production Edge has none.
#
# Style (forced by Bend 2.0.25, as in kernel/hybrid/mesh-io.bend): every reader
# returns `value & rest`; each step of a record is its own def taking the
# previous pair. A malformed token turns the rest of the input into the poison
# "!", so an error reaches the final `end` check and the parse answers Bad.

# ---------------------------------------------------------------------------
# Carriers and topology

# An edge runs vertex s -> vertex e; `same` says that is increasing curve
# parameter; [t0, t1] is the stated parameter range when `ranged`.
type Edge is Data:
  Edge{s: U32, e: U32, c: A.Curve, same: Bool, ranged: Bool, t0: R.Real, t1: R.Real}

type Use is Data:
  Use{edge: U32, fwd: Bool}

type Loop is Data:
  Loop{outer: Bool, uses: List<&2, Use>}

type Face is Data:
  Face{same: Bool, s: A.Surface, loops: List<&2, Loop>}

type Body is Data:
  Body{vs: List<&2, G.Vec3>, es: List<&2, Edge>, fs: List<&2, Face>}

type Job is Data:
  Job{id: String, chamfer: Bool, size: R.Real, propagate: Bool, body: Body, sel: List<&2, U32>}
  Bad{why: String}

# ---------------------------------------------------------------------------
# Lexing

def poison() -> String:
  "!"

def digit(acc: U32, d: U32) -> U32:
  ((acc * 10 : U32) + d : U32)

def number.go(s: String, +acc: U32, started: Bool) -> U32 & String:
  match s:
    case SNil{}:
      match started:
        case True{}:
          (acc, SNil{})
        case False{}:
          (0, poison())
    case SCon{Chr{32}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{10}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{13}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{9}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{48}, t}:
      number.go(t, digit(acc, 0), True{})
    case SCon{Chr{49}, t}:
      number.go(t, digit(acc, 1), True{})
    case SCon{Chr{50}, t}:
      number.go(t, digit(acc, 2), True{})
    case SCon{Chr{51}, t}:
      number.go(t, digit(acc, 3), True{})
    case SCon{Chr{52}, t}:
      number.go(t, digit(acc, 4), True{})
    case SCon{Chr{53}, t}:
      number.go(t, digit(acc, 5), True{})
    case SCon{Chr{54}, t}:
      number.go(t, digit(acc, 6), True{})
    case SCon{Chr{55}, t}:
      number.go(t, digit(acc, 7), True{})
    case SCon{Chr{56}, t}:
      number.go(t, digit(acc, 8), True{})
    case SCon{Chr{57}, t}:
      number.go(t, digit(acc, 9), True{})
    case SCon{_, _}:
      (0, poison())

def number(s: String) -> U32 & String:
  number.go(s, 0, False{})

def word.go(s: String, acc: String, started: Bool) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{32}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{10}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{13}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{9}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{c, t}:
      word.go(t, SCon{c, acc}, True{})

def word(s: String) -> String & String:
  word.go(s, SNil{}, False{})

def expect.if(rest: String, same: Bool) -> String:
  match same:
    case True{}:
      rest
    case False{}:
      poison()

def expect.k(p: String & String, kw: String) -> String:
  (w, rest) = p
  expect.if(rest, String.eq(w, kw))

def expect(s: String, kw: String) -> String:
  expect.k(word(s), kw)

def f32_of(x: U32) -> F32:
  match x:
    case U32{w}:
      F32{w}

def real.lo(hi: U32, p: U32 & String) -> R.Real & String:
  (lo, s) = p
  (R.Real{f32_of(hi), f32_of(lo)}, s)

def real.hi(p: U32 & String) -> R.Real & String:
  (hi, s) = p
  real.lo(hi, number(s))

def real(s: String) -> R.Real & String:
  real.hi(number(s))

def vec3.z(x: R.Real, y: R.Real, p: R.Real & String) -> G.Vec3 & String:
  (z, s) = p
  (G.V3{x, y, z}, s)

def vec3.y(x: R.Real, p: R.Real & String) -> G.Vec3 & String:
  (y, s) = p
  vec3.z(x, y, real(s))

def vec3.x(p: R.Real & String) -> G.Vec3 & String:
  (x, s) = p
  vec3.y(x, real(s))

def vec3(s: String) -> G.Vec3 & String:
  vec3.x(real(s))

def flag.k(p: U32 & String) -> Bool & String:
  (n, s) = p
  (U32.is_eq(n, 1), s)

def flag(s: String) -> Bool & String:
  flag.k(number(s))

# ---------------------------------------------------------------------------
# Curves

def c_line.d(o: G.Vec3, p: G.Vec3 & String) -> A.Curve & String:
  (d, s) = p
  (A.Line{o, d}, s)

def c_line(p: G.Vec3 & String) -> A.Curve & String:
  (o, s) = p
  c_line.d(o, vec3(s))

def c_circle.r(o: G.Vec3, n: G.Vec3, x: G.Vec3, p: R.Real & String) -> A.Curve & String:
  (r, s) = p
  (A.Circle{o, n, x, r}, s)

def c_circle.x(o: G.Vec3, n: G.Vec3, p: G.Vec3 & String) -> A.Curve & String:
  (x, s) = p
  c_circle.r(o, n, x, real(s))

def c_circle.n(o: G.Vec3, p: G.Vec3 & String) -> A.Curve & String:
  (n, s) = p
  c_circle.x(o, n, vec3(s))

def c_circle(p: G.Vec3 & String) -> A.Curve & String:
  (o, s) = p
  c_circle.n(o, vec3(s))

def c_ellipse.b(o: G.Vec3, n: G.Vec3, x: G.Vec3, a: R.Real, p: R.Real & String) -> A.Curve & String:
  (b, s) = p
  (A.Ellipse{o, n, x, a, b}, s)

def c_ellipse.a(o: G.Vec3, n: G.Vec3, x: G.Vec3, p: R.Real & String) -> A.Curve & String:
  (a, s) = p
  c_ellipse.b(o, n, x, a, real(s))

def c_ellipse.x(o: G.Vec3, n: G.Vec3, p: G.Vec3 & String) -> A.Curve & String:
  (x, s) = p
  c_ellipse.a(o, n, x, real(s))

def c_ellipse.n(o: G.Vec3, p: G.Vec3 & String) -> A.Curve & String:
  (n, s) = p
  c_ellipse.x(o, n, vec3(s))

def c_ellipse(p: G.Vec3 & String) -> A.Curve & String:
  (o, s) = p
  c_ellipse.n(o, vec3(s))

def bad_curve() -> A.Curve & String:
  (A.Line{G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0)}, poison())

# 0 line, 1 circle, 2 ellipse, 3 unknown.
def curve_kind(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "line"), 0, Bool.pick(U32, String.eq(w, "circle"), 1, Bool.pick(U32, String.eq(w, "ellipse"), 2, 3)))

def curve.k(k: U32, s: String) -> A.Curve & String:
  match k:
    case 0:
      c_line(vec3(s))
    case 1:
      c_circle(vec3(s))
    case 2:
      c_ellipse(vec3(s))
    case _:
      bad_curve()

def curve.w(p: String & String) -> A.Curve & String:
  (w, s) = p
  curve.k(curve_kind(w), s)

def curve(s: String) -> A.Curve & String:
  curve.w(word(s))

# ---------------------------------------------------------------------------
# Surfaces

def s_plane.x(o: G.Vec3, n: G.Vec3, p: G.Vec3 & String) -> A.Surface & String:
  (x, s) = p
  (A.Plane{o, G.normalize(n), x}, s)

def s_plane.n(o: G.Vec3, p: G.Vec3 & String) -> A.Surface & String:
  (n, s) = p
  s_plane.x(o, n, vec3(s))

def s_plane(p: G.Vec3 & String) -> A.Surface & String:
  (o, s) = p
  s_plane.n(o, vec3(s))

# Cylinder, cone, sphere and torus share "o axis x" then 1 or 2 reals.
def s_axis.one(kind: U32, o: G.Vec3, a: G.Vec3, x: G.Vec3, p: R.Real & String) -> A.Surface & String:
  match kind:
    case 1:
      (r, s) = p
      (A.Cylinder{o, G.normalize(a), x, r}, s)
    case _:
      (r, s) = p
      (A.Sphere{o, G.normalize(a), x, r}, s)

def s_axis.two.b(kind: U32, o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, p: R.Real & String) -> A.Surface & String:
  match kind:
    case 2:
      (q, s) = p
      (A.Cone{o, G.normalize(a), x, r, q}, s)
    case _:
      (q, s) = p
      (A.Torus{o, G.normalize(a), x, r, q}, s)

def s_axis.two(kind: U32, o: G.Vec3, a: G.Vec3, x: G.Vec3, p: R.Real & String) -> A.Surface & String:
  (r, s) = p
  s_axis.two.b(kind, o, a, x, r, real(s))

def s_axis.x.if(two: Bool, kind: U32, o: G.Vec3, a: G.Vec3, x: G.Vec3, s: String) -> A.Surface & String:
  match two:
    case True{}:
      s_axis.two(kind, o, a, x, real(s))
    case False{}:
      s_axis.one(kind, o, a, x, real(s))

def s_axis.x(+kind: U32, o: G.Vec3, a: G.Vec3, p: G.Vec3 & String) -> A.Surface & String:
  (x, s) = p
  s_axis.x.if(Bool.or(U32.is_eq(kind, 2), U32.is_eq(kind, 4)), kind, o, a, x, s)

def s_axis.a(kind: U32, o: G.Vec3, p: G.Vec3 & String) -> A.Surface & String:
  (a, s) = p
  s_axis.x(kind, o, a, vec3(s))

def s_axis(kind: U32, p: G.Vec3 & String) -> A.Surface & String:
  (o, s) = p
  s_axis.a(kind, o, vec3(s))

def bad_surf() -> A.Surface & String:
  (A.Plane{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0), G.v3(1.0, 0.0, 0.0)}, poison())

# 0 plane, 1 cylinder, 2 cone, 3 sphere, 4 torus, 5 unknown.
def surf_kind(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "plane"), 0, Bool.pick(U32, String.eq(w, "cylinder"), 1,
    Bool.pick(U32, String.eq(w, "cone"), 2, Bool.pick(U32, String.eq(w, "sphere"), 3,
      Bool.pick(U32, String.eq(w, "torus"), 4, 5)))))

def surf.k(+k: U32, s: String) -> A.Surface & String:
  match k:
    case 0:
      s_plane(vec3(s))
    case 5:
      bad_surf()
    case _:
      s_axis(k, vec3(s))

def surf.w(p: String & String) -> A.Surface & String:
  (w, s) = p
  surf.k(surf_kind(w), s)

def surf(s: String) -> A.Surface & String:
  surf.w(word(s))

# ---------------------------------------------------------------------------
# Records


def edge.b(a: U32, b: U32, c: A.Curve, same: Bool, ranged: Bool, t0: R.Real, p: R.Real & String) -> Edge & String:
  (t1, s) = p
  (Edge{a, b, c, same, ranged, t0, t1}, s)

def edge.t0(a: U32, b: U32, c: A.Curve, same: Bool, ranged: Bool, p: R.Real & String) -> Edge & String:
  (t0, s) = p
  edge.b(a, b, c, same, ranged, t0, real(s))

def edge.ranged(a: U32, b: U32, c: A.Curve, same: Bool, p: Bool & String) -> Edge & String:
  (ranged, s) = p
  edge.t0(a, b, c, same, ranged, real(s))

def edge.same(a: U32, b: U32, c: A.Curve, p: Bool & String) -> Edge & String:
  (same, s) = p
  edge.ranged(a, b, c, same, flag(s))

def edge.c(a: U32, b: U32, p: A.Curve & String) -> Edge & String:
  (c, s) = p
  edge.same(a, b, c, flag(s))

def edge.e(a: U32, p: U32 & String) -> Edge & String:
  (b, s) = p
  edge.c(a, b, curve(s))

def edge.s(p: U32 & String) -> Edge & String:
  (a, s) = p
  edge.e(a, number(s))

def edge(s: String) -> Edge & String:
  edge.s(number(expect(s, "e")))


def use.f(i: U32, p: Bool & String) -> Use & String:
  (f, s) = p
  (Use{i, f}, s)

def use.k(p: U32 & String) -> Use & String:
  (i, s) = p
  use.f(i, flag(s))

def use(s: String) -> Use & String:
  use.k(number(s))

def vtx(s: String) -> G.Vec3 & String:
  vec3(expect(s, "v"))

def vertices.go(n: Nat, st: G.Vec3 & String, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, G.Vec3, v <> acc), s)
    case 1n+p:
      (v, s) = st
      vertices.go(p, vtx(s), v <> acc)

def vertices(n: Nat, s: String) -> List<&2, G.Vec3> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      vertices.go(p, vtx(s), Nil{})

def edges.go(n: Nat, st: Edge & String, acc: List<&2, Edge>) -> List<&2, Edge> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, Edge, v <> acc), s)
    case 1n+p:
      (v, s) = st
      edges.go(p, edge(s), v <> acc)

def edges(n: Nat, s: String) -> List<&2, Edge> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      edges.go(p, edge(s), Nil{})

def uses.go(n: Nat, st: Use & String, acc: List<&2, Use>) -> List<&2, Use> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, Use, v <> acc), s)
    case 1n+p:
      (v, s) = st
      uses.go(p, use(s), v <> acc)

def uses(n: Nat, s: String) -> List<&2, Use> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      uses.go(p, use(s), Nil{})

def u32s.go(n: Nat, st: U32 & String, acc: List<&2, U32>) -> List<&2, U32> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, U32, v <> acc), s)
    case 1n+p:
      (v, s) = st
      u32s.go(p, number(s), v <> acc)

def u32s(n: Nat, s: String) -> List<&2, U32> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      u32s.go(p, number(s), Nil{})


def loop.us(outer: Bool, p: List<&2, Use> & String) -> Loop & String:
  (us, s) = p
  (Loop{outer, us}, s)

def loop.n(outer: Bool, p: U32 & String) -> Loop & String:
  (n, s) = p
  loop.us(outer, uses(U32.to_nat(n), s))

def loop.o(p: Bool & String) -> Loop & String:
  (outer, s) = p
  loop.n(outer, number(s))

def loop(s: String) -> Loop & String:
  loop.o(flag(expect(s, "l")))

def loops.go(n: Nat, st: Loop & String, acc: List<&2, Loop>) -> List<&2, Loop> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, Loop, v <> acc), s)
    case 1n+p:
      (v, s) = st
      loops.go(p, loop(s), v <> acc)

def loops(n: Nat, s: String) -> List<&2, Loop> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      loops.go(p, loop(s), Nil{})


def face.ls(same: Bool, sf: A.Surface, p: List<&2, Loop> & String) -> Face & String:
  (ls, s) = p
  (Face{same, sf, ls}, s)

def face.n(same: Bool, sf: A.Surface, p: U32 & String) -> Face & String:
  (n, s) = p
  face.ls(same, sf, loops(U32.to_nat(n), s))

def face.s(same: Bool, p: A.Surface & String) -> Face & String:
  (sf, s) = p
  face.n(same, sf, number(s))

def face.same(p: Bool & String) -> Face & String:
  (same, s) = p
  face.s(same, surf(s))

def face(s: String) -> Face & String:
  face.same(flag(expect(s, "f")))

def faces.go(n: Nat, st: Face & String, acc: List<&2, Face>) -> List<&2, Face> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, Face, v <> acc), s)
    case 1n+p:
      (v, s) = st
      faces.go(p, face(s), v <> acc)

def faces(n: Nat, s: String) -> List<&2, Face> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      faces.go(p, face(s), Nil{})



# ---------------------------------------------------------------------------
# The job

type Head is Data:
  Head{id: String, chamfer: Bool, size: R.Real, propagate: Bool}

def done.if(ok: Bool, h: Head, b: Body, sel: List<&2, U32>) -> Job:
  match ok:
    case True{}:
      Head{id, ch, size, pr} = h
      Job{id, ch, size, pr, b, sel}
    case False{}:
      Bad{"malformed job text (token or count mismatch before `end`)"}

def done.w(h: Head, b: Body, sel: List<&2, U32>, p: String & String) -> Job:
  (w, _) = p
  done.if(String.eq(w, "end"), h, b, sel)

def job.sel(h: Head, b: Body, p: List<&2, U32> & String) -> Job:
  (sel, s) = p
  done.w(h, b, sel, word(s))

def job.selk(h: Head, b: Body, p: U32 & String) -> Job:
  (k, s) = p
  job.sel(h, b, u32s(U32.to_nat(k), s))

def job.fs(h: Head, vs: List<&2, G.Vec3>, es: List<&2, Edge>, p: List<&2, Face> & String) -> Job:
  (fs, s) = p
  job.selk(h, Body{vs, es, fs}, number(expect(s, "select")))

def job.es(h: Head, vs: List<&2, G.Vec3>, nf: U32, p: List<&2, Edge> & String) -> Job:
  (es, s) = p
  job.fs(h, vs, es, faces(U32.to_nat(nf), s))

def job.vs(h: Head, ne: U32, nf: U32, p: List<&2, G.Vec3> & String) -> Job:
  (vs, s) = p
  job.es(h, vs, nf, edges(U32.to_nat(ne), s))

def job.nf(h: Head, nv: U32, ne: U32, p: U32 & String) -> Job:
  (nf, s) = p
  job.vs(h, ne, nf, vertices(U32.to_nat(nv), s))

def job.ne(h: Head, nv: U32, p: U32 & String) -> Job:
  (ne, s) = p
  job.nf(h, nv, ne, number(s))

def job.nv(h: Head, p: U32 & String) -> Job:
  (nv, s) = p
  job.ne(h, nv, number(s))

def job.prop(id: String, ch: Bool, size: R.Real, p: Bool & String) -> Job:
  (pr, s) = p
  job.nv(Head{id, ch, size, pr}, number(expect(s, "brep")))

# The chamfer type word is read and only "equal-offsets" / "none" accepted.
def job.cht.if(id: String, ch: Bool, size: R.Real, s: String, ok: Bool) -> Job:
  match ok:
    case True{}:
      job.prop(id, ch, size, flag(expect(s, "propagate")))
    case False{}:
      Bad{"unsupported chamfer type (only equal-offsets)"}

def job.cht(id: String, ch: Bool, size: R.Real, p: String & String) -> Job:
  (w, s) = p
  +w2 = w
  job.cht.if(id, ch, size, s, Bool.or(String.eq(w2, "equal-offsets"), String.eq(w2, "none")))

def job.size(id: String, ch: Bool, p: R.Real & String) -> Job:
  (size, s) = p
  job.cht(id, ch, size, word(expect(s, "chamfer")))

def job.op.if(id: String, +w: String, s: String, ok: Bool) -> Job:
  match ok:
    case True{}:
      job.size(id, String.eq(w, "chamfer"), real(expect(s, "size")))
    case False{}:
      Bad{"unknown op (fillet or chamfer)"}

def job.op(id: String, p: String & String) -> Job:
  (w, s) = p
  +w2 = w
  job.op.if(id, w2, s, Bool.or(String.eq(w2, "fillet"), String.eq(w2, "chamfer")))

def job.id(p: String & String) -> Job:
  (id, s) = p
  job.op(id, word(expect(s, "op")))

def job.magic(s: String, ok: Bool) -> Job:
  match ok:
    case True{}:
      job.id(word(expect(s, "case")))
    case False{}:
      Bad{"first line is not wonky-fillet-job 1"}

def job.m2(p: String & String) -> Job:
  (w, s) = p
  job.magic(s, String.eq(w, "1"))

def job.m1.if(s: String, ok: Bool) -> Job:
  match ok:
    case True{}:
      job.m2(word(s))
    case False{}:
      Bad{"first line is not wonky-fillet-job 1"}

def job.m1(p: String & String) -> Job:
  (w, s) = p
  job.m1.if(s, String.eq(w, "wonky-fillet-job"))

def parse(text: String) -> Job:
  job.m1(word(text))
