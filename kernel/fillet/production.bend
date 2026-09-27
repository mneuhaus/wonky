import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../curve-plane.bend as C
import ../intersections.bend as I
import ../face-classification.bend as F
import ./job.bend as J
import ./geom.bend as K
import ./main.bend as M
import ./ladder.bend as L

# The production fillet's record (docs/fillet-plan.md §8 steps 1-2). The
# fillet (kernel/fillet: prototype A ported onto the production carriers of
# kernel/analytic.bend; kernel/proto/fillet-kpart stays the reference) works
# on A.Surface and A.Curve throughout. This module turns its result into the
# production solid:
#   fillet(job)   -> Record: the produced solid (or the typed refusal), the
#                    deterministic stripe order (ascending edge index, tangent
#                    continuations added) and the selection notes
#                    ("seam-ignored <edge>", "propagated <edge>");
#   result(text)  -> Produced from a result text (the harness format, word
#                    for word; the fillet's own text is its input);
#   fragments(job) -> the coplanar-fragment edges of the job's body.
#
# The carriers already are the production types (A's spindle rims lie on the
# tube-centre sheet, the only sheet the production Torus holds). Only the
# cone differs: the fillet may use a negative angle (kernel/analytic.bend's
# radius r + h tan(angle) allows it); the production solid writes it with
# the axis reversed: (a, ang) and (-a, -ang) give the same radius at every
# point and the same natural normal, and STEP's CONICAL_SURFACE needs a
# half-angle in (0, pi/2).
#
# Edge domains use the production DomainChoice: a closed conic (both ends at
# one vertex) ranged over exactly one period is a periodic edge (AutoDomain,
# the production convention for whole circles); every other stated range is
# kept as given (GivenDomain Interval); an unranged edge is AutoDomain.
#
# Nothing here computes or adjusts geometry. A result the production types
# cannot hold exactly (a face that states an approximation tolerance, a
# non-positive radius, a cone half-angle outside (0, pi/2)) is refused by name
# (Unmapped), and a malformed text is refused, never guessed.

type Produced is Data:
  Built{solid: A.Solid, domains: List<&2, F.DomainChoice>, roles: List<&2, U32>}
  Refused{cls: String, why: String}
  Unmapped{why: String}

type SurfMap is Data:
  SurfOk{surface: A.Surface}
  SurfNo{why: String}

# A result face: orientation, carrier, role (0 support, 1 blend, 2 corner,
# 3 cap, 4 unknown), stated tolerance, loops.
type RFace is Data:
  RFace{same: Bool, s: A.Surface, role: U32, tol: R.Real, loops: List<&2, J.Loop>}

def zero() -> R.Real:
  R.from_f32(0.0)

def positive(+x: R.Real) -> Bool:
  R.less(zero(), x)

# ---------------------------------------------------------------------------
# Carriers

def radius_ok(+ok: Bool, +what: String, s: A.Surface) -> SurfMap:
  Bool.pick(SurfMap, ok, SurfOk{s}, SurfNo{what})

def cone_of(o: G.Vec3, +a: G.Vec3, x: G.Vec3, +r: R.Real, +ang: R.Real) -> SurfMap:
  +flip = R.less(ang, zero())
  +axis = Bool.pick(G.Vec3, flip, G.scale(a, R.neg(R.from_f32(1.0))), a)
  +half = Bool.pick(R.Real, flip, R.neg(ang), ang)
  +ok = Bool.and(positive(r), Bool.and(positive(half), R.less(half, R.div(R.pi(), R.from_f32(2.0)))))
  radius_ok(ok, "a cone with radius " ++ K.show_sci(r) ++ " and half-angle " ++ K.show_sci(ang) ++ " has no production Cone (radius > 0, half-angle in (0, pi/2))", A.Cone{o, axis, x, r, half})

def surface_of(s: A.Surface) -> SurfMap:
  match s:
    case A.Plane{o, n, x}:
      SurfOk{A.Plane{o, n, x}}
    case A.Cylinder{o, a, x, +r}:
      radius_ok(positive(r), "a cylinder of radius " ++ K.show_sci(r), A.Cylinder{o, a, x, r})
    case A.Cone{o, a, x, r, ang}:
      cone_of(o, a, x, r, ang)
    case A.Sphere{o, a, x, +r}:
      radius_ok(positive(r), "a sphere of radius " ++ K.show_sci(r), A.Sphere{o, a, x, r})
    case A.Torus{o, a, x, +big, +small}:
      radius_ok(Bool.and(positive(big), positive(small)), "a torus of major radius " ++ K.show_sci(big) ++ " and minor radius " ++ K.show_sci(small) ++ " (both must be positive)", A.Torus{o, a, x, big, small})

def closed_conic(c: A.Curve) -> Bool:
  match c:
    case A.Line{_, _}:
      False{}
    case _:
      True{}

# ---------------------------------------------------------------------------
# Edges

def domain_of(e: J.Edge) -> F.DomainChoice:
  J.Edge{+s, +t, +c, _, +ranged, +t0, +t1} = e
  +turn = R.mul(R.pi(), R.from_f32(2.0))
  +whole = Bool.and(U32.is_eq(s, t), Bool.and(closed_conic(c), I.at_most(R.abs(R.sub(R.sub(t1, t0), turn)), I.angular_guard())))
  Bool.pick(F.DomainChoice, Bool.or(Bool.not(ranged), whole), F.AutoDomain{}, F.GivenDomain{C.Interval{t0, t1}})

def edge_of(e: J.Edge) -> A.Edge:
  J.Edge{s, t, c, same, _, _, _} = e
  A.Edge{s, t, c, same}

def edges_of(es: List<&2, J.Edge>) -> List<&2, A.Edge>:
  match es:
    case Nil{}:
      Nil{}
    case e <> tail:
      edge_of(e) <> edges_of(tail)

def domains_of(es: List<&2, J.Edge>) -> List<&2, F.DomainChoice>:
  match es:
    case Nil{}:
      Nil{}
    case e <> tail:
      domain_of(e) <> domains_of(tail)

# ---------------------------------------------------------------------------
# Faces

def uses_of(us: List<&2, J.Use>) -> List<&2, T.Coedge>:
  match us:
    case Nil{}:
      Nil{}
    case J.Use{e, f} <> tail:
      T.Use{e, f} <> uses_of(tail)

def loops_of(ls: List<&2, J.Loop>) -> List<&2, A.Loop>:
  match ls:
    case Nil{}:
      Nil{}
    case J.Loop{outer, us} <> tail:
      A.Loop{outer, uses_of(us)} <> loops_of(tail)

type FacesMap is Data:
  FacesOk{faces: List<&2, A.Face>, roles: List<&2, U32>}
  FacesNo{why: String}

def faces_cons(f: A.Face, role: U32, rest: FacesMap) -> FacesMap:
  match rest:
    case FacesOk{fs, rs}:
      FacesOk{f <> fs, role <> rs}
    case FacesNo{why}:
      FacesNo{why}

def face_exact(exact: Bool, s: A.Surface, +same: Bool, +role: U32, +tol: R.Real, loops: List<&2, J.Loop>, +index: U32, rest: FacesMap) -> FacesMap:
  match exact:
    case False{}:
      FacesNo{"face " ++ K.show_u32(index) ++ " states the approximation tolerance " ++ K.show_sci(tol) ++ " mm; the production types hold exact faces only"}
    case True{}:
      Bool.pick(FacesMap, U32.is_lt(role, 4), faces_cons(A.Face{s, same, loops_of(loops)}, role, rest),
        FacesNo{"face " ++ K.show_u32(index) ++ " has an unknown role"})

def face_mapped(m: SurfMap, +same: Bool, +role: U32, +tol: R.Real, loops: List<&2, J.Loop>, +index: U32, rest: FacesMap) -> FacesMap:
  match m:
    case SurfNo{why}:
      FacesNo{"face " ++ K.show_u32(index) ++ ": " ++ why}
    case SurfOk{s}:
      face_exact(R.equal(tol, zero()), s, same, role, tol, loops, index, rest)

def faces_of(fs: List<&2, RFace>, +index: U32) -> FacesMap:
  match fs:
    case Nil{}:
      FacesOk{Nil{}, Nil{}}
    case RFace{same, s, role, tol, loops} <> tail:
      face_mapped(surface_of(s), same, role, tol, loops, index, faces_of(tail, (index + 1 : U32)))

# ---------------------------------------------------------------------------
# Reading A's result text (the job reader's pieces; a malformed token poisons
# the rest of the input, so every error reaches the final `end` check)

# Carriers exactly as written. The job reader (J.surf) normalizes directions
# for A's own computation; a result is taken word for word.
def rs.two(kind: U32, o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real, p: R.Real & String) -> A.Surface & String:
  match kind:
    case 2:
      (q, s) = p
      (A.Cone{o, a, x, r, q}, s)
    case _:
      (q, s) = p
      (A.Torus{o, a, x, r, q}, s)

def rs.one(kind: U32, o: G.Vec3, a: G.Vec3, x: G.Vec3, p: R.Real & String) -> A.Surface & String:
  match kind:
    case 1:
      (r, s) = p
      (A.Cylinder{o, a, x, r}, s)
    case 3:
      (r, s) = p
      (A.Sphere{o, a, x, r}, s)
    case _:
      (r, s) = p
      rs.two(kind, o, a, x, r, J.real(s))

def rs.x(kind: U32, o: G.Vec3, a: G.Vec3, p: G.Vec3 & String) -> A.Surface & String:
  match kind:
    case 0:
      (x, s) = p
      (A.Plane{o, a, x}, s)
    case _:
      (x, s) = p
      rs.one(kind, o, a, x, J.real(s))

def rs.a(kind: U32, o: G.Vec3, p: G.Vec3 & String) -> A.Surface & String:
  (a, s) = p
  rs.x(kind, o, a, J.vec3(s))

def rs.o(kind: U32, p: G.Vec3 & String) -> A.Surface & String:
  (o, s) = p
  rs.a(kind, o, J.vec3(s))

def rs.k(kind: U32, s: String) -> A.Surface & String:
  match kind:
    case 5:
      J.bad_surf()
    case _:
      rs.o(kind, J.vec3(s))

def rs.w(p: String & String) -> A.Surface & String:
  (w, s) = p
  rs.k(J.surf_kind(w), s)

def rsurf(s: String) -> A.Surface & String:
  rs.w(J.word(s))

def role_code(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "support"), 0, Bool.pick(U32, String.eq(w, "blend"), 1,
    Bool.pick(U32, String.eq(w, "corner"), 2, Bool.pick(U32, String.eq(w, "cap"), 3, 4))))

def rface.ls(same: Bool, sf: A.Surface, role: U32, tol: R.Real, p: List<&2, J.Loop> & String) -> RFace & String:
  (ls, s) = p
  (RFace{same, sf, role, tol, ls}, s)

def rface.n(same: Bool, sf: A.Surface, role: U32, tol: R.Real, p: U32 & String) -> RFace & String:
  (n, s) = p
  rface.ls(same, sf, role, tol, J.loops(U32.to_nat(n), s))

def rface.tol(same: Bool, sf: A.Surface, role: U32, p: R.Real & String) -> RFace & String:
  (tol, s) = p
  rface.n(same, sf, role, tol, J.number(s))

def rface.role(same: Bool, sf: A.Surface, p: String & String) -> RFace & String:
  (w, s) = p
  rface.tol(same, sf, role_code(w), J.real(s))

def rface.s(same: Bool, p: A.Surface & String) -> RFace & String:
  (sf, s) = p
  rface.role(same, sf, J.word(s))

def rface.same(p: Bool & String) -> RFace & String:
  (same, s) = p
  rface.s(same, rsurf(s))

def rface(s: String) -> RFace & String:
  rface.same(J.flag(J.expect(s, "f")))

def rfaces.go(n: Nat, st: RFace & String, acc: List<&2, RFace>) -> List<&2, RFace> & String:
  match n:
    case 0n:
      (v, s) = st
      (List.reverse(&2, RFace, v <> acc), s)
    case 1n+p:
      (v, s) = st
      rfaces.go(p, rface(s), v <> acc)

def rfaces(n: Nat, s: String) -> List<&2, RFace> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      rfaces.go(p, rface(s), Nil{})

def blank(s: String) -> Bool:
  match s:
    case SNil{}:
      True{}
    case SCon{Chr{32}, t}:
      blank(t)
    case SCon{Chr{10}, t}:
      blank(t)
    case SCon{Chr{13}, t}:
      blank(t)
    case SCon{Chr{9}, t}:
      blank(t)
    case SCon{_, _}:
      False{}

def malformed() -> Produced:
  Unmapped{"malformed fillet result text (token or count mismatch before `end`)"}

def built.m(m: FacesMap, vs: List<&2, G.Vec3>, +es: List<&2, J.Edge>) -> Produced:
  match m:
    case FacesNo{why}:
      Unmapped{why}
    case FacesOk{fs, rs}:
      Built{A.Solid{vs, edges_of(es), fs}, domains_of(es), rs}

def built.end(ok: Bool, vs: List<&2, G.Vec3>, es: List<&2, J.Edge>, fs: List<&2, RFace>) -> Produced:
  match ok:
    case True{}:
      built.m(faces_of(fs, 0), vs, es)
    case False{}:
      malformed()

def built.w(vs: List<&2, G.Vec3>, es: List<&2, J.Edge>, fs: List<&2, RFace>, p: String & String) -> Produced:
  (w, rest) = p
  built.end(Bool.and(String.eq(w, "end"), blank(rest)), vs, es, fs)

def built.fs(vs: List<&2, G.Vec3>, es: List<&2, J.Edge>, p: List<&2, RFace> & String) -> Produced:
  (fs, s) = p
  built.w(vs, es, fs, J.word(s))

def built.es(vs: List<&2, G.Vec3>, nf: U32, p: List<&2, J.Edge> & String) -> Produced:
  (es, s) = p
  built.fs(vs, es, rfaces(U32.to_nat(nf), s))

def built.vs(ne: U32, nf: U32, p: List<&2, G.Vec3> & String) -> Produced:
  (vs, s) = p
  built.es(vs, nf, J.edges(U32.to_nat(ne), s))

def built.nf(nv: U32, ne: U32, p: U32 & String) -> Produced:
  (nf, s) = p
  built.vs(ne, nf, J.vertices(U32.to_nat(nv), s))

def built.ne(nv: U32, p: U32 & String) -> Produced:
  (ne, s) = p
  built.nf(nv, ne, J.number(s))

def built.nv(p: U32 & String) -> Produced:
  (nv, s) = p
  built.ne(nv, J.number(s))

# One line (without its newline) and the text after it.
def line.go(s: String, acc: String) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{10}, t}:
      (String.reverse(acc), t)
    case SCon{c, t}:
      line.go(t, SCon{c, acc})

def line.trim(s: String) -> String:
  match s:
    case SCon{Chr{32}, t}:
      line.trim(t)
    case _:
      s

def refused.end(cls: String, why: String, p: String & String) -> Produced:
  (w, rest) = p
  Bool.pick(Produced, Bool.and(String.eq(w, "end"), blank(rest)), Refused{cls, why}, malformed())

# `unresolved <class> <reason ...>` on the first line, then `end`.
def refused.cls(rest: String, p: String & String) -> Produced:
  (cls, why) = p
  refused.end(cls, line.trim(why), J.word(rest))

def status_kind(+w: String) -> U32:
  Bool.pick(U32, String.eq(w, "ok"), 0, Bool.pick(U32, String.eq(w, "unresolved"), 1, 2))

def status.ok(clean: Bool, rest: String) -> Produced:
  match clean:
    case True{}:
      built.nv(J.number(J.expect(rest, "brep")))
    case False{}:
      malformed()

def status.k(kind: U32, rest: String, after: String) -> Produced:
  match kind:
    case 0:
      status.ok(blank(after), rest)
    case 1:
      refused.cls(rest, J.word(after))
    case _:
      malformed()

def status.w(rest: String, p: String & String) -> Produced:
  (w, after) = p
  status.k(status_kind(w), rest, after)

def status(p: String & String) -> Produced:
  (first, rest) = p
  status.w(rest, J.word(first))

# Production entry: A's result text -> the production solid, its edge domains
# and the face roles; A's own typed refusal; or a named refusal to map.
def result(text: String) -> Produced:
  status(line.go(text, SNil{}))

# ---------------------------------------------------------------------------
# The production entry: run the fillet on a job and keep its record

type Record is Data:
  Record{out: Produced, order: List<&2, U32>, notes: List<&2, String>}

def record.o(+o: M.Out) -> Record:
  match o:
    case M.Out{_, _, _, _, notes, order, _, _, _, _, _, _, _, _}:
      Record{result(M.show(o)), order, notes}
    case M.OutNo{_, cls, why}:
      Record{Refused{cls, why}, Nil{}, Nil{}}

# The fillet of a job text (docs/fillet/harness.md "Job and result format"):
# the production solid (or the typed refusal), the stripe order and the
# selection notes.
def fillet(job: String) -> Record:
  record.o(M.finish(M.solve0(M.parse(job))))

# The coplanar-fragment edges of a job's body (ladder.bend is_fragment: two
# plane faces with exactly parallel outward normal words), ascending: the
# edges the fillet ignores when they are selected. The frontends read a face
# as the plane region these edges split (src/fillet-fragments.mjs), so they
# select what the fillet blends.
def fragments.go(n: Nat, +b: J.Body, +e: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      List.reverse(&2, U32, acc)
    case 1n+m:
      fragments.go(m, b, (e + 1 : U32), K.push_if(L.is_fragment(b, e), e, acc))

def fragments.j(+j: J.Job) -> List<&2, U32>:
  match j:
    case J.Job{_, _, _, _, +b, _}:
      fragments.go(U32.to_nat(K.count(J.Edge, K.body_es(b))), b, 0, Nil{})
    case _:
      Nil{}

def fragments(job: String) -> List<&2, U32>:
  fragments.j(M.parse(job))
