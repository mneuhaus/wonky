import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../analytic.bend as A
import ../../topology.bend as T
import ../mesh.bend as M
import ./util.bend as U
import ./geom.bend as S
import ./clear.bend as C

# Mesh topology stages of the "recover" prototype (docs/proto-recover.md):
#   1 carrier classes of the face tags (coincident carriers merge)
#   2 per-triangle face key = class * 2 + orientation, tag residual check
#   3 half-edge twins (sort by undirected edge), closed 2-manifold check
#   4 patches = connected components of equal face key (union-find)
#   5 corners = mesh vertices where >= 3 patches meet
#   6 boundary half-edges between patches, next pointers (sort-join)
#   7 boundary loops (walk), 8 runs between corners, 9 run pairing -> edges
# Everything is sorting, joins and tables; no geometry is guessed here.

def none() -> U32:
  4294967295

def b2u(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

# A refusal reason. Cert: the mesh measured against the exact geometry is
# outside its certified bound (it becomes a BCert refusal, see Out); Why: any
# other refusal. The first refusal wins, whatever its class.
type Why is Data:
  Fine{}
  Why{reason: String}
  Cert{reason: String}

def why.or(a: Why, b: Why) -> Why:
  match a:
    case Fine{}:
      b
    case Why{r}:
      Why{r}
    case Cert{r}:
      Cert{r}

def why.if(c: Bool, msg: String) -> Why:
  Bool.pick(Why, c, Why{msg}, Fine{})

def why.cert(c: Bool, msg: String) -> Why:
  Bool.pick(Why, c, Cert{msg}, Fine{})

# The first refusal of a sequence of checks, with its class (see Out).
type Ref is Data:
  RFine{}
  RGeom{reason: String}
  RCert{reason: String}

def ref.geom(w: Why, rest: Ref) -> Ref:
  match w:
    case Fine{}:
      rest
    case Why{r}:
      RGeom{r}
    case Cert{r}:
      RCert{r}

def ref.cert(w: Why, rest: Ref) -> Ref:
  match w:
    case Fine{}:
      rest
    case Why{r}:
      RCert{r}
    case Cert{r}:
      RCert{r}

def f32s(+x: F32) -> String:
  F32.show(x)

def arr.list(a: Array<F32>, acc: List<&2, F32>) -> List<&2, F32>:
  match a:
    case ALeaf{x}:
      x <> acc
    case ANode{xs, ys}:
      arr.list(xs, arr.list(ys, acc))

# Lookup context shared (read-only) by every stage.
type Ctx is Data:
  Ctx{pos: U.Tab<&2, G.Vec3>, dv: Nat, nv: U32, surf: U.Tab<&2, S.Surf>, df: Nat, nf: U32, cls: U.Tab<&2, U32>, dev: R.Real}

def ctx.pos(+c: Ctx, +i: U32) -> G.Vec3:
  Ctx{p, dv, _, _, _, _, _, _} = c
  U.tab.get(G.Vec3, p, dv, i)

def ctx.surf(+c: Ctx, +k: U32) -> S.Surf:
  Ctx{_, _, _, s, df, _, _, _} = c
  U.tab.get(S.Surf, s, df, k)

def ctx.cls(+c: Ctx, +tag: U32) -> U32:
  Ctx{_, _, _, _, df, _, k, _} = c
  U.tab.get(U32, k, df, tag)

def ctx.dev(+c: Ctx) -> R.Real:
  Ctx{_, _, _, _, _, _, _, d} = c
  d

def ctx.nv(+c: Ctx) -> U32:
  Ctx{_, _, n, _, _, _, _, _} = c
  n

def ctx.dv(+c: Ctx) -> Nat:
  Ctx{_, dv, _, _, _, _, _, _} = c
  dv

def ctx.nf(+c: Ctx) -> U32:
  Ctx{_, _, _, _, _, n, _, _} = c
  n

# ---------------------------------------------------------------------------
# 1. Carrier classes: class of a tag = first tag with the same carrier.

def cls.find(ss: List<&2, S.Surf>, +s: S.Surf, +j: U32, hit: Bool) -> U32:
  match ss hit:
    case _ True{}:
      (j - 1 : U32)
    case Nil{} False{}:
      j
    case h <> t False{}:
      cls.find(t, s, (j + 1 : U32), S.same(h, s))

type SI is Data:
  SI{s: S.Surf, i: U32}

def cls.idx(xs: List<&2, S.Surf>, +i: U32, acc: List<&2, SI>) -> List<&2, SI>:
  match xs:
    case Nil{}:
      U.rev(SI, acc)
    case s <> t:
      cls.idx(t, (i + 1 : U32), SI{s, i} <> acc)

# The search always reaches the tag itself; min() keeps a class inside the
# table even if a carrier compared unequal to itself (NaN input).
def cls.f(all: List<&2, S.Surf>, x: SI) -> U32:
  SI{s, +i} = x
  U32.min(i, cls.find(all, s, 0, False{}))

# One independent search per tag, forked (O(F^2) carrier comparisons).
def cls.go(+xs: List<&2, S.Surf>, +n: U32) -> List<&2, U32>:
  U.par.map(~List<&2, S.Surf>, ~SI, ~U32, ~cls.f, xs, U.fork_depth(), U.two(SI, cls.idx(xs, 0, Nil{}), U32.to_nat(n)))

def surfs.go(fs: List<&2, M.FaceTag>, acc: List<&2, S.Surf>) -> List<&2, S.Surf>:
  match fs:
    case Nil{}:
      U.rev(S.Surf, acc)
    case M.FaceTag{_, _, s} <> t:
      surfs.go(t, S.of_wire(s) <> acc)

# ---------------------------------------------------------------------------
# 2. Triangle info.

type TI is Data:
  TI{t: U32, a: U32, b: U32, c: U32, fk: U32, v: F32}

type TOne is Data:
  TOne{ti: TI, res: F32, flat: U32, bad: U32}

def third() -> R.Real:
  R.div(S.rf(1.0), S.rf(3.0))

def tri.one(+ctx: Ctx, tri: M.Tri, +t: U32) -> TOne:
  M.Tri{+a, +b, +c, +tag} = tri
  +pa = ctx.pos(ctx, a)
  +pb = ctx.pos(ctx, b)
  +pc = ctx.pos(ctx, c)
  +s = ctx.surf(ctx, tag)
  +k = ctx.cls(ctx, tag)
  +rep = ctx.surf(ctx, k)
  +res = U.f32max(R.approx(S.residual(s, pa)), U.f32max(R.approx(S.residual(s, pb)), R.approx(S.residual(s, pc))))
  +n = G.cross(G.sub(pb, pa), G.sub(pc, pa))
  +m = G.scale(G.add(G.add(pa, pb), pc), third())
  +cosv = (R.approx(G.dot(n, S.normal_at(rep, m))) / R.approx(S.vlen(n)) : F32)
  +out = (cosv > 0.0 : F32)
  +clear = (F32.abs(cosv) > 0.5 : F32)
  +nv = ctx.nv(ctx)
  +bad = Bool.or(Bool.or((a >= nv : U32), (b >= nv : U32)), Bool.or((c >= nv : U32), (tag >= ctx.nf(ctx) : U32)))
  +vol = (R.approx(G.dot(pa, G.cross(pb, pc))) / 6.0 : F32)
  TOne{TI{t, a, b, c, ((k * 2 : U32) + Bool.pick(U32, out, 0, 1) : U32), vol}, res, Bool.pick(U32, clear, 0, 1), Bool.pick(U32, bad, 1, 0)}

type TPass is Data:
  TPass{tis: List<&2, TI>, res: F32, flat: U32, bad: U32}

def tri.fold(o: TOne, p: TPass) -> TPass:
  TOne{ti, r1, f1, b1} = o
  TPass{tis, r2, f2, b2} = p
  TPass{ti <> tis, U.f32max(r1, r2), (f1 + f2 : U32), (b1 + b2 : U32)}

def tri.go(ts: List<&2, M.Tri>, +ctx: Ctx, +t: U32, acc: TPass) -> TPass:
  match ts:
    case Nil{}:
      acc
    case x <> rest:
      tri.go(rest, ctx, (t + 1 : U32), tri.fold(tri.one(ctx, x, t), acc))

def tpass.rev(p: TPass) -> TPass:
  TPass{tis, r, f, b} = p
  TPass{U.rev(TI, tis), r, f, b}

type TriI is Data:
  TriI{tri: M.Tri, t: U32}

def tri.idx(ts: List<&2, M.Tri>, +t: U32, acc: List<&2, TriI>) -> List<&2, TriI>:
  match ts:
    case Nil{}:
      U.rev(TriI, acc)
    case x <> rest:
      tri.idx(rest, (t + 1 : U32), TriI{x, t} <> acc)

def tri.f(ctx: Ctx, x: TriI) -> TOne:
  TriI{tri, t} = x
  tri.one(ctx, tri, t)

def tri.folds(os: List<&2, TOne>, acc: TPass) -> TPass:
  match os:
    case Nil{}:
      acc
    case o <> t:
      tri.folds(t, tri.fold(o, acc))

# Per-triangle work as a balanced fork-join map (2^fork_depth leaves). The
# `!` ships it to the GPU on the Metal build (CPU pool with --gpu off; the JS
# target runs it sequentially). It reaches the device only as its own
# evaluation step, so the native driver runs prep / map / finish as separate
# IO steps (a bang following host forks in one evaluation stays on the CPU).
def tri.map(+ctx: Ctx, work: U.Two<&2, TriI>) -> List<&2, TOne>:
  U.par.map!(~Ctx, ~TriI, ~TOne, ~tri.f, ctx, U.fork_depth(), work)

def tri.pass(os: List<&2, TOne>) -> TPass:
  tpass.rev(tri.folds(os, TPass{Nil{}, 0.0, 0, 0}))

def fk.list(tis: List<&2, TI>, acc: List<&2, U32>) -> List<&2, U32>:
  match tis:
    case Nil{}:
      U.rev(U32, acc)
    case TI{_, _, _, _, k, _} <> t:
      fk.list(t, k <> acc)

# Coincident distinct vertices mean the Boolean mesh touches itself (tangent
# contact resolved by perturbation): refused, like the validator does.
def vkey.go(vs: List<&2, G.Vec3>, +i: U32, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match vs:
    case Nil{}:
      acc
    case G.V3{R.Real{xh, _}, R.Real{yh, _}, R.Real{zh, _}} <> t:
      vkey.go(t, (i + 1 : U32), U.Q{F32.bits(xh), F32.bits(yh), F32.bits(zh), i} <> acc)

def veq(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  Bool.and(Bool.and(R.equal(ax, bx), R.equal(ay, by)), R.equal(az, bz))

# Positions are read only for the rare pairs whose F32 keys agree.
def vdup.same(keys: Bool, +ctx: Ctx, +i: U32, +j: U32) -> U32:
  match keys:
    case True{}:
      b2u(veq(ctx.pos(ctx, i), ctx.pos(ctx, j)))
    case False{}:
      0

def vdup.go(xs: List<&2, U.Q>, +ctx: Ctx, acc: U32) -> U32:
  match xs:
    case U.Q{+a1, +a2, +a3, +i} <> U.Q{+b1, +b2, +b3, +j} <> t:
      +keys = Bool.and(Bool.and(U32.is_eq(a1, b1), U32.is_eq(a2, b2)), U32.is_eq(a3, b3))
      vdup.go(U.Q{b1, b2, b3, j} <> t, ctx, (acc + vdup.same(keys, ctx, i, j) : U32))
    case _:
      acc

# ---------------------------------------------------------------------------
# 3. Half-edge twins. Half-edge id = 4 t + k for edges (a b), (b c), (c a).

# Q{lo, hi, half-edge, fk * 2 + direction}: the face key rides along so the
# twin pass can emit same-key unions without table lookups.
def hq(+x: U32, +y: U32, +e: U32, +fk: U32) -> U.Q:
  U.Q{U32.min(x, y), U32.max(x, y), e, ((fk * 2 : U32) + Bool.pick(U32, (x < y : U32), 0, 1) : U32)}

def he.go(tis: List<&2, TI>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match tis:
    case Nil{}:
      acc
    case TI{t, +a, +b, +c, +fk, _} <> rest:
      +e = (t * 4 : U32)
      he.go(rest, hq(c, a, (e + 2 : U32), fk) <> hq(b, c, (e + 1 : U32), fk) <> hq(a, b, e, fk) <> acc)

type PW is Data:
  PW{cross: List<&2, U.Q>, unions: List<&2, U.Q>, bad: U32}

def pw.differs(rest: List<&2, U.Q>, +l: U32, +h: U32) -> Bool:
  match rest:
    case Nil{}:
      True{}
    case U.Q{l2, h2, _, _} <> _:
      Bool.not(Bool.and(U32.is_eq(l2, l), U32.is_eq(h2, h)))

def pw.go(xs: List<&2, U.Q>, acc: List<&2, U.Q>, +un: List<&2, U.Q>, +bad: U32) -> PW:
  match xs:
    case Nil{}:
      PW{acc, un, bad}
    case _ <> Nil{}:
      PW{acc, un, (bad + 1 : U32)}
    case U.Q{+l1, +h1, +e1, +k1} <> U.Q{l2, h2, +e2, +k2} <> +rest:
      +d1 = U32.and(k1, 1)
      +ok = Bool.and(Bool.and(U32.is_eq(l1, l2), U32.is_eq(h1, h2)), Bool.and(U32.is_ne(d1, U32.and(k2, 1)), pw.differs(rest, l1, h1)))
      +fwd = U32.is_eq(d1, 0)
      +same = U32.is_eq((k1 >> 1n : U32), (k2 >> 1n : U32))
      +acc2 = acc
      pw.go(rest, Bool.pick(List<&2, U.Q>, same, acc2, U.Q{e1, e2, Bool.pick(U32, fwd, l1, h1), Bool.pick(U32, fwd, h1, l1)} <> acc2),
        Bool.pick(List<&2, U.Q>, same, U.Q{(e1 >> 2n : U32), (e2 >> 2n : U32), 0, 0} <> un, un), (bad + Bool.pick(U32, ok, 0, 1) : U32))

# ---------------------------------------------------------------------------
# 4. Union-find (smaller root wins, so parent < child; single-node path
# compression on every find).

def uf.find(fuel: Nat, st: Array<U.Link> & U.Link, +x: U32) -> Array<U.Link> & U32:
  match fuel:
    case 0n:
      (par, _) = st
      (par, x)
    case 1n+f:
      (par, l) = st
      match l:
        case U.Root{}:
          (par, x)
        case U.Up{+p}:
          uf.find(f, Array.get(U.Link, par, p), p)

def uf.set(par: Array<U.Link>, +x: U32, +r: U32) -> Array<U.Link>:
  Array.set(U.Link, par, x, Bool.pick(U.Link, U32.is_eq(x, r), U.Root{}, U.Up{r}))

def uf.link2(+a: U32, +ra: U32, +b: U32, st: Array<U.Link> & U32) -> Array<U.Link>:
  (par, +rb) = st
  +lo = U32.min(ra, rb)
  +hi = U32.max(ra, rb)
  uf.set(uf.set(uf.set(par, hi, lo), a, lo), b, lo)

def uf.link1(+b: U32, +fuel: Nat, +a: U32, st: Array<U.Link> & U32) -> Array<U.Link>:
  (par, ra) = st
  uf.link2(a, ra, b, uf.find(fuel, Array.get(U.Link, par, b), b))

def uf.unions(xs: List<&2, U.Q>, par: Array<U.Link>, +fuel: Nat) -> Array<U.Link>:
  match xs:
    case Nil{}:
      par
    case U.Q{+a, +b, _, _} <> t:
      uf.unions(t, uf.link1(b, fuel, a, uf.find(fuel, Array.get(U.Link, par, a), a)), fuel)

# Roots of 0..n in order; st is the find result of index t.
def uf.roots(n: Nat, +t: U32, st: Array<U.Link> & U32, +fuel: Nat, acc: List<&2, U32>) -> List<&2, U32>:
  match n:
    case 0n:
      (_, r) = st
      U.rev(U32, r <> acc)
    case 1n+m:
      (par, +r) = st
      +t1 = (t + 1 : U32)
      uf.roots(m, t1, uf.find(fuel, Array.get(U.Link, uf.set(par, t, r), t1), t1), fuel, r <> acc)

# Component roots of 0..count-1 under the given unions.
def uf.components(xs: List<&2, U.Q>, +count: U32, +d: Nat) -> List<&2, U32>:
  +fuel = U32.to_nat(count)
  par = uf.unions(xs, Array.new(U.Link, d, U.Root{}), fuel)
  uf.roots(U32.to_nat((count - 1 : U32)), 0, uf.find(fuel, Array.get(U.Link, par, 0), 0), fuel, Nil{})

def same_fk.go(ps: List<&2, U.Q>, +fk: U.Tab<&2, U32>, +d: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ps:
    case Nil{}:
      acc
    case U.Q{e1, e2, _, _} <> t:
      +t1 = (e1 >> 2n : U32)
      +t2 = (e2 >> 2n : U32)
      +eq = U32.is_eq(U.tab.get(U32, fk, d, t1), U.tab.get(U32, fk, d, t2))
      +acc2 = acc
      same_fk.go(t, fk, d, Bool.pick(List<&2, U.Q>, eq, U.Q{t1, t2, 0, 0} <> acc2, acc2))

# ---------------------------------------------------------------------------
# 5. Corners: vertices where at least three patches meet.

type VG is Data:
  VG{v: U32, ps: List<&2, U32>, n: U32}

def vg.go(xs: List<&2, U.Q>, +cv: U32, +lp: U32, +cur: List<&2, U32>, +cn: U32, acc: List<&2, VG>) -> List<&2, VG>:
  match xs:
    case Nil{}:
      U.rev(VG, VG{cv, cur, cn} <> acc)
    case U.Q{+v, +p, _, _} <> t:
      +samev = U32.is_eq(v, cv)
      +newp = Bool.not(Bool.and(samev, U32.is_eq(p, lp)))
      +acc2 = acc
      vg.go(t, v, p,
        Bool.pick(List<&2, U32>, samev, Bool.pick(List<&2, U32>, newp, p <> cur, cur), [p]),
        Bool.pick(U32, samev, (cn + Bool.pick(U32, newp, 1, 0) : U32), 1),
        Bool.pick(List<&2, VG>, samev, acc2, VG{cv, cur, cn} <> acc2))

def vg.start(xs: List<&2, U.Q>) -> List<&2, VG>:
  match xs:
    case Nil{}:
      Nil{}
    case U.Q{+v, +p, _, _} <> t:
      vg.go(t, v, p, [p], 1, Nil{})

def has(xs: List<&2, U32>, +x: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case h <> t:
      Bool.or(U32.is_eq(h, x), has(t, x))

def distinct.go(xs: List<&2, U32>, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case +h <> t:
      distinct.go(t, Bool.pick(List<&2, U32>, has(acc, h), acc, h <> acc))

def classes_of(ps: List<&2, U32>, +fk: U.Tab<&2, U32>, +d: Nat, acc: List<&2, U32>) -> List<&2, U32>:
  match ps:
    case Nil{}:
      distinct.go(acc, Nil{})
    case p <> t:
      classes_of(t, fk, d, (U.tab.get(U32, fk, d, p) >> 1n : U32) <> acc)

def surfs_of(ks: List<&2, U32>, +ctx: Ctx, acc: List<&2, S.Surf>) -> List<&2, S.Surf>:
  match ks:
    case Nil{}:
      acc
    case k <> t:
      surfs_of(t, ctx, ctx.surf(ctx, k) <> acc)

# A corner's drift bounds (corner.fold): `cond` = 3 dev / |det| (+ 1e-6) is how far
# a correct mesh vertex may stray from the exact one at this conditioning
# (each carrier's patch within dev, the three unit gradients spanning |det|);
# `bound` caps it at 10 dev, the most an exact vertex may drift and still be
# certified. `trans`: S.Corner.trans.
type CornerOut is Data:
  CornerOut{v: U32, p: G.Vec3, k: U32, drift: F32, bound: F32, cond: F32, det: F32, res: F32, aided: Bool, trans: F32}

def corner.fin(+v: U32, +k: U32, +dev: R.Real, c: S.Corner) -> CornerOut:
  S.Corner{p, drift, det, res, aided, trans} = c
  +dt = R.approx(det)
  +cond = ((3.0 * R.approx(dev) : F32) / F32.max(dt, 0.000001) : F32)
  +bound = (F32.min(cond, (10.0 * R.approx(dev) : F32)) + 0.000001 : F32)
  CornerOut{v, p, k, R.approx(drift), bound, (cond + 0.000001 : F32), dt, R.approx(res), aided, R.approx(trans)}

def corner.one(g: VG, +ctx: Ctx, +fk: U.Tab<&2, U32>, +d: Nat) -> CornerOut:
  VG{+v, ps, _} = g
  +ks = classes_of(ps, fk, d, Nil{})
  +ss = surfs_of(ks, ctx, Nil{})
  corner.fin(v, U.count(U32, ks, 0), ctx.dev(ctx), S.refine(ss, ctx.pos(ctx, v)))

def corners.filter(gs: List<&2, VG>, acc: List<&2, VG>) -> List<&2, VG>:
  match gs:
    case Nil{}:
      U.rev(VG, acc)
    case VG{v, ps, +n} <> t:
      +acc2 = acc
      corners.filter(t, Bool.pick(List<&2, VG>, (n >= 3 : U32), VG{v, ps, n} <> acc2, acc2))

type CC is Data:
  CC{ctx: Ctx, fk: U.Tab<&2, U32>, d: Nat}

def corner.f(c: CC, g: VG) -> CornerOut:
  CC{ctx, fk, d} = c
  corner.one(g, ctx, fk, d)

def corners.go(+gs: List<&2, VG>, +ctx: Ctx, +fk: U.Tab<&2, U32>, +d: Nat) -> List<&2, CornerOut>:
  U.par.map(~CC, ~VG, ~CornerOut, ~corner.f, CC{ctx, fk, d}, U.fork_depth(), U.two(VG, gs, U32.to_nat(U.count(VG, gs, 0))))

type VKind is Data:
  VPlain{}
  VCorner{id: U32}

def vkind.hit(cs: List<&2, CornerOut>, +i: U32) -> Bool:
  match cs:
    case Nil{}:
      False{}
    case CornerOut{v, _, _, _, _, _, _, _, _, _} <> _:
      U32.is_eq(v, i)

# Dense vertex kinds for 0..n-1 from corners sorted by vertex id.
def vkind.go(n: Nat, +i: U32, +cs: List<&2, CornerOut>, +id: U32, acc: List<&2, VKind>) -> List<&2, VKind>:
  match n:
    case 0n:
      U.rev(VKind, acc)
    case 1n+m:
      +hit = vkind.hit(cs, i)
      vkind.go(m, (i + 1 : U32), Bool.pick(List<&2, CornerOut>, hit, List.tail(&2, CornerOut, cs), cs),
        Bool.pick(U32, hit, (id + 1 : U32), id), Bool.pick(VKind, hit, VCorner{id}, VPlain{}) <> acc)

# ---------------------------------------------------------------------------
# 5b. Tessellation slivers. A patch of at most sliver_max() triangles every
# triangle of which (its vertices, edge midpoints and centroid) lies within
# the deviation of every neighbouring carrier has zero exact area at the
# stated tolerance: the cap of a countersink cone lying on the circle where
# cone and bore meet, cut into fragments because the two tessellations do not
# share that circle, or a blister of cone rim and cap poking through a sphere
# tessellation where the rim lies on the sphere. (A real small face, such as a
# pin top, has interior points away from its neighbours and is kept.) It is merged into the neighbour patch it shares
# the most boundary with among the neighbours that are not slivers themselves
# (a blister of two sliver patches, e.g. a cone rim poking through a sphere
# tessellation, is absorbed by the carrier around it, never swapped between
# its own pieces); a sliver with only sliver neighbours stays as it is. The
# count is reported in the output stats.

def sliver_max() -> U32:
  16

def size.go(tis: List<&2, TI>, +root: U.Tab<&2, U32>, +dt: Nat, st: Array<U32> & U32) -> Array<U32>:
  match tis:
    case Nil{}:
      (arr, _) = st
      arr
    case TI{t, _, _, _, _, _} <> rest:
      (arr, _) = st
      size.go(rest, root, dt, Array.atomic.add(arr, U.tab.get(U32, root, dt, t), 1))

def arr.u32s(a: Array<U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match a:
    case ALeaf{x}:
      x <> acc
    case ANode{xs, ys}:
      arr.u32s(xs, arr.u32s(ys, acc))

# Neighbour patches of each patch with the number of shared boundary
# half-edges, from boundary records Q{from, patch, to, other}.
def nb.keys(bs: List<&2, U.Q>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match bs:
    case Nil{}:
      acc
    case U.Q{_, p, _, q} <> t:
      nb.keys(t, U.Q{p, q, 0, 0} <> acc)

type NB is Data:
  NB{p: U32, qs: List<&2, U.Q>}

# Group sorted Q{p, q} into NB{p, [Q{q, count}]}.
def nb.go(xs: List<&2, U.Q>, +cp: U32, +cq: U32, +cn: U32, +cur: List<&2, U.Q>, acc: List<&2, NB>) -> List<&2, NB>:
  match xs:
    case Nil{}:
      U.rev(NB, NB{cp, U.Q{cq, cn, 0, 0} <> cur} <> acc)
    case U.Q{+p, +q, _, _} <> t:
      +samep = U32.is_eq(p, cp)
      +sameq = Bool.and(samep, U32.is_eq(q, cq))
      +cur2 = Bool.pick(List<&2, U.Q>, sameq, cur, Bool.pick(List<&2, U.Q>, samep, U.Q{cq, cn, 0, 0} <> cur, Nil{}))
      +acc2 = acc
      nb.go(t, p, q, Bool.pick(U32, sameq, (cn + 1 : U32), 1), cur2,
        Bool.pick(List<&2, NB>, samep, acc2, NB{cp, U.Q{cq, cn, 0, 0} <> cur} <> acc2))

def nb.start(xs: List<&2, U.Q>) -> List<&2, NB>:
  match xs:
    case Nil{}:
      Nil{}
    case U.Q{+p, +q, _, _} <> t:
      nb.go(t, p, q, 1, Nil{}, Nil{})

# Candidate: small, and at least two distinct neighbour carriers.
type SL is Data:
  SL{p: U32, cand: Bool, ks: List<&2, U32>, qs: List<&2, U.Q>}

# The neighbour sharing the most boundary half-edges, skipping accepted
# slivers (flag 1 in acc); none() when every neighbour is a sliver.
def sl.best(qs: List<&2, U.Q>, +acc: U.Tab<&2, U32>, +dt: Nat, +bq: U32, +bn: U32) -> U32:
  match qs:
    case Nil{}:
      bq
    case U.Q{+q, +n, _, _} <> t:
      +more = Bool.and((n > bn : U32), U32.is_eq(U.tab.get(U32, acc, dt, q), 0))
      sl.best(t, acc, dt, Bool.pick(U32, more, q, bq), Bool.pick(U32, more, n, bn))

def sl.classes(qs: List<&2, U.Q>, +fk: U.Tab<&2, U32>, +dt: Nat, +own: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match qs:
    case Nil{}:
      distinct.go(acc, Nil{})
    case U.Q{q, _, _, _} <> t:
      +k = (U.tab.get(U32, fk, dt, q) >> 1n : U32)
      +acc2 = acc
      sl.classes(t, fk, dt, own, Bool.pick(List<&2, U32>, U32.is_eq(k, own), acc2, k <> acc2))

def planar(+ctx: Ctx, +k: U32) -> Bool:
  U32.is_eq(S.kind(ctx.surf(ctx, k)), 0)

def all.planar(ks: List<&2, U32>, +ctx: Ctx) -> Bool:
  match ks:
    case Nil{}:
      True{}
    case k <> t:
      Bool.and(planar(ctx, k), all.planar(t, ctx))

# A patch whose carrier and neighbour carriers are all planes is never a
# sliver: planar tessellations have deviation 0, so there is no tessellation
# mismatch to repair and every small planar face is real (a corner chip, the
# tip of a bump).
def sl.of(g: NB, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +size: U.Tab<&2, U32>) -> SL:
  NB{+p, +qs} = g
  +own = (U.tab.get(U32, fk, dt, p) >> 1n : U32)
  +ks = sl.classes(qs, fk, dt, own, Nil{})
  +flat = Bool.and(planar(ctx, own), all.planar(ks, ctx))
  +cand = Bool.and(Bool.and((U.tab.get(U32, size, dt, p) <= sliver_max() : U32), (U.count(U32, ks, 0) >= 1 : U32)), Bool.not(flat))
  SL{p, cand, ks, qs}

def sl.go(gs: List<&2, NB>, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +size: U.Tab<&2, U32>, acc: List<&2, SL>) -> List<&2, SL>:
  match gs:
    case Nil{}:
      U.rev(SL, acc)
    case g <> t:
      sl.go(t, ctx, fk, dt, size, sl.of(g, ctx, fk, dt, size) <> acc)

def sl.none(+i: U32) -> SL:
  SL{i, False{}, Nil{}, Nil{}}

def sl.hit(cs: List<&2, SL>, +i: U32) -> Bool:
  match cs:
    case Nil{}:
      False{}
    case SL{p, _, _, _} <> _:
      U32.is_eq(p, i)

def sl.head(cs: List<&2, SL>, +i: U32) -> SL:
  match cs:
    case Nil{}:
      sl.none(i)
    case s <> _:
      s

# Dense over patch ids 0..n-1 (non-patches and non-candidates: cand False).
def sl.dense(n: Nat, +i: U32, +cs: List<&2, SL>, acc: List<&2, SL>) -> List<&2, SL>:
  match n:
    case 0n:
      U.rev(SL, acc)
    case 1n+m:
      +hit = sl.hit(cs, i)
      sl.dense(m, (i + 1 : U32), Bool.pick(List<&2, SL>, hit, List.tail(&2, SL, cs), cs),
        Bool.pick(SL, hit, sl.head(cs, i), sl.none(i)) <> acc)

def within.all(ks: List<&2, U32>, +ctx: Ctx, +p: G.Vec3, +tol: R.Real) -> Bool:
  match ks:
    case Nil{}:
      True{}
    case k <> t:
      Bool.and(R.less(S.residual(ctx.surf(ctx, k), p), tol), within.all(t, ctx, p, tol))

def sl.tri(s: SL, +p: U32, +a: U32, +b: U32, +c: U32, +ctx: Ctx, +tol: R.Real, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  SL{_, cand, +ks, _} = s
  match cand:
    case False{}:
      acc
    case True{}:
      +pa = ctx.pos(ctx, a)
      +pb = ctx.pos(ctx, b)
      +pc = ctx.pos(ctx, c)
      +h = S.rf(0.5)
      +ok = Bool.and(Bool.and(within.all(ks, ctx, pa, tol), Bool.and(within.all(ks, ctx, pb, tol), within.all(ks, ctx, pc, tol))),
        Bool.and(Bool.and(within.all(ks, ctx, G.scale(G.add(pa, pb), h), tol), within.all(ks, ctx, G.scale(G.add(pb, pc), h), tol)),
          Bool.and(within.all(ks, ctx, G.scale(G.add(pc, pa), h), tol), within.all(ks, ctx, G.scale(G.add(G.add(pa, pb), pc), third()), tol))))
      U.Q{p, Bool.pick(U32, ok, 0, 1), 0, 0} <> acc

# Q{patch, 1 if this triangle keeps its patch from being a sliver}.
def sl.tris(tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +slT: U.Tab<&2, SL>, +dt: Nat, +tol: R.Real, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match tis:
    case Nil{}:
      acc
    case TI{t, a, b, c, _, _} <> rest:
      +p = U.tab.get(U32, root, dt, t)
      sl.tris(rest, ctx, root, slT, dt, tol, sl.tri(U.tab.get(SL, slT, dt, p), p, a, b, c, ctx, tol, acc))

# Accepted slivers (sorted input): candidates none of whose triangles failed.
def sl.accept(xs: List<&2, U.Q>, +cp: U32, +bad: U32, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      U.rev(U32, Bool.pick(List<&2, U32>, Bool.and(U32.is_ne(cp, none()), U32.is_eq(bad, 0)), cp <> acc, acc))
    case U.Q{+p, +f, _, _} <> t:
      +same = U32.is_eq(p, cp)
      +acc2 = acc
      +close = Bool.and(Bool.not(same), Bool.and(U32.is_ne(cp, none()), U32.is_eq(bad, 0)))
      sl.accept(t, p, Bool.pick(U32, same, (bad + f : U32), f), Bool.pick(List<&2, U32>, close, cp <> acc2, acc2))

def sl.cands(xs: List<&2, SL>, acc: List<&2, SL>) -> List<&2, SL>:
  match xs:
    case Nil{}:
      U.rev(SL, acc)
    case SL{p, +cand, ks, qs} <> t:
      +acc2 = acc
      sl.cands(t, Bool.pick(List<&2, SL>, cand, SL{p, cand, ks, qs} <> acc2, acc2))

def sl.target(s: SL, +acc: U.Tab<&2, U32>, +dt: Nat) -> U32:
  SL{_, _, _, qs} = s
  sl.best(qs, acc, dt, none(), 0)

def sl.flags(xs: List<&2, U32>, arr: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      arr
    case p <> t:
      sl.flags(t, Array.set(U32, arr, p, 1))

def sl.relabel.k(orphan: Bool, +p: U32, +target: U32, +fk: U.Tab<&2, U32>, +dt: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match orphan:
    case True{}:
      acc
    case False{}:
      U.Q{p, U.tab.get(U32, fk, dt, target), 0, 0} <> acc

def sl.relabel1(+p: U32, +target: U32, +fk: U.Tab<&2, U32>, +dt: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  sl.relabel.k(U32.is_eq(target, none()), p, target, fk, dt, acc)

# Q{sliver patch, face key it takes}.
def sl.relabels(ps: List<&2, U32>, +slT: U.Tab<&2, SL>, +fk: U.Tab<&2, U32>, +dt: Nat, +acc: U.Tab<&2, U32>, out: List<&2, U.Q>) -> List<&2, U.Q>:
  match ps:
    case Nil{}:
      out
    case +p <> t:
      sl.relabels(t, slT, fk, dt, acc, sl.relabel1(p, sl.target(U.tab.get(SL, slT, dt, p), acc, dt), fk, dt, out))

# Absorbed slivers with the area check below.
type SC is Data:
  SC{rs: List<&2, U.Q>, why: Why}

# The area an absorbed sliver deletes is bounded by what a tessellation
# mismatch can produce: a fragment between two differently tessellated
# copies of one curve is at most the deviation wide, so its area is at most
# deviation x its perimeter. A larger absorbed area is a real face (a cone tip
# dimple or bump narrower than the deviation): refused with the area.
def tri.area(+pa: G.Vec3, +pb: G.Vec3, +pc: G.Vec3) -> F32:
  (R.approx(S.vlen(G.cross(G.sub(pb, pa), G.sub(pc, pa)))) * 0.5 : F32)

def sa.add(on: Bool, +a: U32, +b: U32, +c: U32, +ctx: Ctx) -> F32:
  match on:
    case False{}:
      0.0
    case True{}:
      tri.area(ctx.pos(ctx, a), ctx.pos(ctx, b), ctx.pos(ctx, c))

def sa.go(tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +flags: U.Tab<&2, U32>, +dt: Nat, st: Array<F32> & F32) -> Array<F32>:
  match tis:
    case Nil{}:
      (arr, _) = st
      arr
    case TI{t, a, b, c, _, _} <> rest:
      (arr, _) = st
      +p = U.tab.get(U32, root, dt, t)
      sa.go(rest, ctx, root, flags, dt, Array.atomic.fadd(arr, p, sa.add(U32.is_eq(U.tab.get(U32, flags, dt, p), 1), a, b, c, ctx)))

def sp.add(on: Bool, +x: U32, +y: U32, +ctx: Ctx) -> F32:
  match on:
    case False{}:
      0.0
    case True{}:
      R.approx(S.vlen(G.sub(ctx.pos(ctx, y), ctx.pos(ctx, x))))

# Boundary records Q{from, patch, to, other patch}.
def sp.go(bs: List<&2, U.Q>, +ctx: Ctx, +flags: U.Tab<&2, U32>, +dt: Nat, st: Array<F32> & F32) -> Array<F32>:
  match bs:
    case Nil{}:
      (arr, _) = st
      arr
    case U.Q{x, +p, y, _} <> rest:
      (arr, _) = st
      sp.go(rest, ctx, flags, dt, Array.atomic.fadd(arr, p, sp.add(U32.is_eq(U.tab.get(U32, flags, dt, p), 1), x, y, ctx)))

def sl.qflags(xs: List<&2, U.Q>, arr: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      arr
    case U.Q{p, _, _, _} <> t:
      sl.qflags(t, Array.set(U32, arr, p, 1))

def sa.why(rs: List<&2, U.Q>, +area: U.Tab<&2, F32>, +per: U.Tab<&2, F32>, +dt: Nat, +dev: F32, acc: Why) -> Why:
  match rs:
    case Nil{}:
      acc
    case U.Q{+p, _, _, _} <> t:
      +ar = U.tab.get(F32, area, dt, p)
      +lim = (dev * U.tab.get(F32, per, dt, p) : F32)
      sa.why(t, area, per, dt, dev, why.or(acc, why.if((ar > lim : F32), "sliver absorption would delete a patch of " ++ f32s(ar) ++ " mm2, more than deviation x its perimeter (" ++ f32s(lim)
        ++ " mm2): a real face narrower than the deviation, not a tessellation fragment")))

def sl.area(rs: List<&2, U.Q>, +tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +bhs: List<&2, U.Q>, +dt: Nat) -> Why:
  match rs:
    case Nil{}:
      Fine{}
    case +r <> +t:
      +flags = U.tab.of(U32, arr.u32s(sl.qflags(r <> t, Array.new(U32, dt, 0)), Nil{}), dt, 0)
      area = sa.go(tis, ctx, root, flags, dt, Array.atomic.fadd(Array.new(F32, dt, 0.0), 0, 0.0))
      per = sp.go(bhs, ctx, flags, dt, Array.atomic.fadd(Array.new(F32, dt, 0.0), 0, 0.0))
      sa.why(r <> t, U.tab.of(F32, arr.list(area, Nil{}), dt, 0.0), U.tab.of(F32, arr.list(per, Nil{}), dt, 0.0), dt, R.approx(ctx.dev(ctx)), Fine{})

def sl.check(cands: List<&2, SL>, +tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +fk: U.Tab<&2, U32>, +dt: Nat, +nt: U32, +bhs: List<&2, U.Q>) -> SC:
  match cands:
    case Nil{}:
      SC{Nil{}, Fine{}}
    case +c <> t:
      +slT = U.tab.of(SL, sl.dense(U32.to_nat(nt), 0, c <> t, Nil{}), dt, sl.none(0))
      +tol = R.add(ctx.dev(ctx), S.rf(0.000000001))
      +acc = sl.accept(U.bsort(sl.tris(tis, ctx, root, slT, dt, tol, Nil{}), dt), none(), 0, Nil{})
      +flags = U.tab.of(U32, arr.u32s(sl.flags(acc, Array.new(U32, dt, 0)), Nil{}), dt, 0)
      +rs = sl.relabels(acc, slT, fk, dt, flags, Nil{})
      SC{rs, sl.area(rs, tis, ctx, root, bhs, dt)}

def sliver.find(+tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +bhs: List<&2, U.Q>, +fk: U.Tab<&2, U32>, +dt: Nat, +nt: U32) -> SC:
  +sizes = U.tab.of(U32, arr.u32s(size.go(tis, root, dt, Array.atomic.add(Array.new(U32, dt, 0), 0, 0)), Nil{}), dt, 0)
  +sls = sl.go(nb.start(U.bsort(nb.keys(bhs, Nil{}), dt)), ctx, fk, dt, sizes, Nil{})
  sl.check(sl.cands(sls, Nil{}), tis, ctx, root, fk, dt, nt, bhs)

def relab.fill(xs: List<&2, U.Q>, arr: Array<U32>) -> Array<U32>:
  match xs:
    case Nil{}:
      arr
    case U.Q{p, k, _, _} <> t:
      relab.fill(t, Array.set(U32, arr, p, k))

def fk2.go(tis: List<&2, TI>, +root: U.Tab<&2, U32>, +rl: U.Tab<&2, U32>, +fk: U.Tab<&2, U32>, +dt: Nat, acc: List<&2, U32>) -> List<&2, U32>:
  match tis:
    case Nil{}:
      U.rev(U32, acc)
    case TI{+t, _, _, _, _, _} <> rest:
      +n = U.tab.get(U32, rl, dt, U.tab.get(U32, root, dt, t))
      fk2.go(rest, root, rl, fk, dt, Bool.pick(U32, U32.is_eq(n, none()), U.tab.get(U32, fk, dt, t), n) <> acc)

type FR is Data:
  FR{fk: U.Tab<&2, U32>, roots: List<&2, U32>, slivers: U32, why: Why}

# Recompute patches only when a sliver was absorbed.
def sl.redo.k(+rs: List<&2, U.Q>, +w: Why, +cross: List<&2, U.Q>, +unions: List<&2, U.Q>, +tis: List<&2, TI>, +fk: U.Tab<&2, U32>, +root: U.Tab<&2, U32>, +roots: List<&2, U32>, +nt: U32, +dt: Nat) -> FR:
  match rs:
    case Nil{}:
      FR{fk, roots, 0, w}
    case +r <> t:
      +rl = U.tab.of(U32, arr.u32s(relab.fill(r <> t, Array.new(U32, dt, none())), Nil{}), dt, none())
      +fk2 = U.tab.of(U32, fk2.go(tis, root, rl, fk, dt, Nil{}), dt, 0)
      FR{fk2, uf.components(same_fk.go(cross, fk2, dt, unions), nt, dt), U.count(U.Q, r <> t, 0), w}

def sl.redo(sc: SC, +cross: List<&2, U.Q>, +unions: List<&2, U.Q>, +tis: List<&2, TI>, +fk: U.Tab<&2, U32>, +root: U.Tab<&2, U32>, +roots: List<&2, U32>, +nt: U32, +dt: Nat) -> FR:
  SC{+rs, +w} = sc
  sl.redo.k(rs, w, cross, unions, tis, fk, root, roots, nt, dt)

# A second pass absorbs slivers whose neighbours were all slivers in the
# first pass (a cap fragment enclosed by rim fragments reaches the carrier
# around the blister only after the rim fragments joined it).
def sl.addn(+n: U32, +w: Why, fr: FR) -> FR:
  FR{a, b, c, w2} = fr
  FR{a, b, (c + n : U32), why.or(w, w2)}

# ---------------------------------------------------------------------------
# 6. Boundary half-edges: Q{patch, from, to, other patch}.

# From each twin pair Q{e1, e2, x, y} (e1 runs x -> y, e2 y -> x) whose
# triangles have different face keys (only those can lie in different
# patches): when the two triangles lie in different patches both half-edges
# bound their patch.
# Boundary records are Q{from, patch, to, other patch}: keyed by the start
# vertex first, so the bucket sort sees small buckets.
def bh.go(ps: List<&2, U.Q>, +root: U.Tab<&2, U32>, +dt: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ps:
    case Nil{}:
      acc
    case U.Q{e1, e2, +x, +y} <> rest:
      +p1 = U.tab.get(U32, root, dt, (e1 >> 2n : U32))
      +p2 = U.tab.get(U32, root, dt, (e2 >> 2n : U32))
      +acc2 = acc
      bh.go(rest, root, dt, Bool.pick(List<&2, U.Q>, U32.is_ne(p1, p2), U.Q{x, p1, y, p2} <> U.Q{y, p2, x, p1} <> acc2, acc2))

# (vertex, patch) of every boundary half-edge start: every patch incident to a
# boundary vertex has a boundary half-edge leaving it.
def vp.bh(bs: List<&2, U.Q>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match bs:
    case Nil{}:
      acc
    case U.Q{x, p, _, _} <> t:
      vp.bh(t, U.Q{x, p, 0, 0} <> acc)

# Used mesh vertices (Euler check): one mark per triangle corner.
def used.go(tis: List<&2, TI>, arr: Array<U32>) -> Array<U32>:
  match tis:
    case Nil{}:
      arr
    case TI{_, a, b, c, _, _} <> t:
      used.go(t, Array.set(U32, Array.set(U32, Array.set(U32, arr, a, 1), b, 1), c, 1))

def arr.sum(a: Array<U32>) -> U32:
  match a:
    case ALeaf{x}:
      x
    case ANode{xs, ys}:
      (arr.sum(xs) + arr.sum(ys) : U32)

type BHs is Data:
  BHs{l1: List<&2, U.Q>, l2: List<&2, U.Q>, recs: List<&2, U.Q>, n: U32, pinch: U32}

def bh.index(xs: List<&2, U.Q>, +i: U32, +lp: U32, +lx: U32, l1: List<&2, U.Q>, l2: List<&2, U.Q>, recs: List<&2, U.Q>, +pinch: U32) -> BHs:
  match xs:
    case Nil{}:
      BHs{U.rev(U.Q, l1), l2, U.rev(U.Q, recs), i, pinch}
    case U.Q{+x, +p, +y, +q} <> t:
      +dup = Bool.and(U32.is_eq(p, lp), U32.is_eq(x, lx))
      bh.index(t, (i + 1 : U32), p, x, U.Q{x, p, i, 0} <> l1, U.Q{y, p, i, 0} <> l2, U.Q{p, x, y, q} <> recs, (pinch + Bool.pick(U32, dup, 1, 0) : U32))

type JS is Data:
  JS{l1: List<&2, U.Q>, l2: List<&2, U.Q>, acc: List<&2, U.Q>, bad: U32}

def key.lt(+p1: U32, +v1: U32, +p2: U32, +v2: U32) -> Bool:
  Bool.or((p1 < p2 : U32), Bool.and(U32.is_eq(p1, p2), (v1 < v2 : U32)))

def join.step(x: U.Q, +xt: List<&2, U.Q>, y: U.Q, +yt: List<&2, U.Q>, +acc: List<&2, U.Q>, +bad: U32) -> JS:
  U.Q{+px, +vx, +ix, _} = x
  U.Q{+py, +vy, +iy, _} = y
  +lt = key.lt(px, vx, py, vy)
  +eq = Bool.and(U32.is_eq(px, py), U32.is_eq(vx, vy))
  Bool.pick(JS, lt, JS{xt, U.Q{py, vy, iy, 0} <> yt, acc, bad},
    Bool.pick(JS, eq, JS{xt, yt, U.Q{iy, ix, 0, 0} <> acc, bad}, JS{U.Q{px, vx, ix, 0} <> xt, yt, acc, (bad + 1 : U32)}))

def join.go(fuel: Nat, st: JS) -> JS:
  match fuel:
    case 0n:
      st
    case 1n+f:
      JS{l1, l2, acc, bad} = st
      match l1 l2:
        case xs Nil{}:
          JS{xs, Nil{}, acc, bad}
        case Nil{} ys:
          JS{Nil{}, Nil{}, acc, (bad + U.count(U.Q, ys, 0) : U32)}
        case x <> xt y <> yt:
          join.go(f, join.step(x, xt, y, yt, acc, bad))

def q.k2s(xs: List<&2, U.Q>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      U.rev(U32, acc)
    case U.Q{_, v, _, _} <> t:
      q.k2s(t, v <> acc)

# ---------------------------------------------------------------------------
# 7. Boundary loops: follow next pointers, marking visited half-edges.

def walk(fuel: Nat, st: Array<U.Seen> & U.Seen, +cur: U32, +nx: U.Tab<&2, U32>, +d: Nat, acc: List<&2, U32>) -> Array<U.Seen> & List<&2, U32>:
  match fuel:
    case 0n:
      (arr, _) = st
      (arr, acc)
    case 1n+f:
      (arr, s) = st
      match s:
        case U.Visited{}:
          (arr, acc)
        case U.Fresh{}:
          +n2 = U.tab.get(U32, nx, d, cur)
          walk(f, Array.get(U.Seen, Array.set(U.Seen, arr, cur, U.Visited{}), n2), n2, nx, d, cur <> acc)

def push_loop(lp: List<&2, U32>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match lp:
    case Nil{}:
      acc
    case h <> t:
      U.rev(U32, h <> t) <> acc

def loops.go(n: Nat, +i: U32, st: Array<U.Seen> & List<&2, U32>, +nx: U.Tab<&2, U32>, +d: Nat, +fuel: Nat, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match n:
    case 0n:
      (_, lp) = st
      U.rev(List<&2, U32>, push_loop(lp, acc))
    case 1n+m:
      (arr, lp) = st
      loops.go(m, (i + 1 : U32), walk(fuel, Array.get(U.Seen, arr, i), i, nx, d, Nil{}), nx, d, fuel, push_loop(lp, acc))

# ---------------------------------------------------------------------------
# 8. Runs: maximal boundary pieces between corners (or whole closed loops).

type Ann is Data:
  Ann{x: U32, y: U32, q: U32, corner: Bool, cid: U32}

def ann.of(k: VKind, +x: U32, +y: U32, +q: U32) -> Ann:
  match k:
    case VCorner{id}:
      Ann{x, y, q, True{}, id}
    case VPlain{}:
      Ann{x, y, q, False{}, none()}

def ann.rec(rec: U.Q, +vk: U.Tab<&2, VKind>, +dv: Nat) -> Ann:
  U.Q{_, +x, y, q} = rec
  ann.of(U.tab.get(VKind, vk, dv, x), x, y, q)

def ann.go(ids: List<&2, U32>, +bh: U.Tab<&2, U.Q>, +db: Nat, +vk: U.Tab<&2, VKind>, +dv: Nat, acc: List<&2, Ann>) -> List<&2, Ann>:
  match ids:
    case Nil{}:
      U.rev(Ann, acc)
    case i <> t:
      ann.go(t, bh, db, vk, dv, ann.rec(U.tab.get(U.Q, bh, db, i), vk, dv) <> acc)

def rec.p(rec: U.Q) -> U32:
  U.Q{p, _, _, _} = rec
  p

def loop.p(ids: List<&2, U32>, +bh: U.Tab<&2, U.Q>, +db: Nat) -> U32:
  match ids:
    case Nil{}:
      none()
    case i <> _:
      rec.p(U.tab.get(U.Q, bh, db, i))

type Rot is Data:
  Rot{pre: List<&2, Ann>, suf: List<&2, Ann>}

def rot.go(xs: List<&2, Ann>, pre: List<&2, Ann>) -> Rot:
  match xs:
    case Nil{}:
      Rot{pre, Nil{}}
    case Ann{x, y, q, True{}, cid} <> t:
      Rot{pre, Ann{x, y, q, True{}, cid} <> t}
    case h <> t:
      rot.go(t, h <> pre)

type Run is Data:
  Run{p: U32, q: U32, closed: Bool, sc: U32, ec: U32, vs: List<&2, U32>, klo: U32, khi: U32, bad: Bool}

type RA is Data:
  RA{q: U32, sc: U32, vs: List<&2, U32>, ly: U32, klo: U32, khi: U32, bad: Bool}

def ra.start(a: Ann) -> RA:
  Ann{+x, +y, q, _, cid} = a
  RA{q, cid, [x], y, U32.min(x, y), U32.max(x, y), False{}}

def ra.push(r: RA, a: Ann) -> RA:
  RA{+q, sc, vs, _, +klo, +khi, bad} = r
  Ann{+x, +y, q2, _, _} = a
  +lo = U32.min(x, y)
  +hi = U32.max(x, y)
  +lt = key.lt(lo, hi, klo, khi)
  RA{q, sc, x <> vs, y, Bool.pick(U32, lt, lo, klo), Bool.pick(U32, lt, hi, khi), Bool.or(bad, U32.is_ne(q, q2))}

def ra.close(r: RA, +p: U32, +ec: U32, closed: Bool) -> Run:
  RA{q, sc, vs, ly, klo, khi, bad} = r
  Run{p, q, closed, sc, ec, U.rev(U32, ly <> vs), klo, khi, bad}

def split.go(xs: List<&2, Ann>, +p: U32, cur: RA, acc: List<&2, Run>, +fc: U32) -> List<&2, Run>:
  match xs:
    case Nil{}:
      U.rev(Run, ra.close(cur, p, fc, U32.is_eq(fc, none())) <> acc)
    case Ann{x, y, q, True{}, +cid} <> t:
      split.go(t, p, ra.start(Ann{x, y, q, True{}, cid}), ra.close(cur, p, cid, False{}) <> acc, fc)
    case a <> t:
      split.go(t, p, ra.push(cur, a), acc, fc)

def runs.start(xs: List<&2, Ann>, +p: U32) -> List<&2, Run>:
  match xs:
    case Nil{}:
      Nil{}
    case Ann{x, y, q, c, +cid} <> t:
      split.go(t, p, ra.start(Ann{x, y, q, c, cid}), Nil{}, cid)

def runs.of_rot(r: Rot, +p: U32) -> List<&2, Run>:
  Rot{pre, suf} = r
  runs.start(M.rev_onto(Ann, U.rev(Ann, suf), U.rev(Ann, pre)), p)

type LR is Data:
  LR{p: U32, first: U32, n: U32}

type RL is Data:
  RL{runs: List<&2, Run>, loops: List<&2, LR>, next: U32}

def rl.add(st: RL, +p: U32, +rs: List<&2, Run>) -> RL:
  RL{runs, loops, +next} = st
  +k = U.count(Run, rs, 0)
  RL{M.rev_onto(Run, rs, runs), LR{p, next, k} <> loops, (next + k : U32)}

def loops.runs(ls: List<&2, List<&2, U32>>, +bh: U.Tab<&2, U.Q>, +db: Nat, +vk: U.Tab<&2, VKind>, +dv: Nat, st: RL) -> RL:
  match ls:
    case Nil{}:
      st
    case +ids <> t:
      +p = loop.p(ids, bh, db)
      loops.runs(t, bh, db, vk, dv, rl.add(st, p, runs.of_rot(rot.go(ann.go(ids, bh, db, vk, dv, Nil{}), Nil{}), p)))

# ---------------------------------------------------------------------------
# 9. Pair each run (patch p, other q) with its reverse on q: canonical side
# p < q owns the edge. Key = smallest undirected mesh edge of the run.

type MT is Data:
  MT{cs: List<&2, U.Q>, ts: List<&2, U.Q>, bad: U32}

def mt.go(rs: List<&2, Run>, +rid: U32, st: MT) -> MT:
  match rs:
    case Nil{}:
      st
    case Run{+p, +q, _, _, _, _, +klo, +khi, bad} <> t:
      MT{cs, ts, +b} = st
      +cs2 = cs
      +ts2 = ts
      +e = {U.Q{klo, khi, rid, 0} : U.Q}
      mt.go(t, (rid + 1 : U32), MT{Bool.pick(List<&2, U.Q>, (p < q : U32), e <> cs2, cs2), Bool.pick(List<&2, U.Q>, (p < q : U32), ts2, e <> ts2),
        (b + Bool.pick(U32, Bool.or(bad, U32.is_eq(p, q)), 1, 0) : U32)})

type ZO is Data:
  ZO{re: List<&2, U.Q>, er: List<&2, U32>, n: U32, bad: U32}

def zip.go(cs: List<&2, U.Q>, ts: List<&2, U.Q>, +e: U32, re: List<&2, U.Q>, er: List<&2, U32>, +bad: U32) -> ZO:
  match cs ts:
    case Nil{} Nil{}:
      ZO{re, U.rev(U32, er), e, bad}
    case U.Q{l1, h1, +r1, _} <> ct U.Q{l2, h2, r2, _} <> tt:
      +ok = Bool.and(U32.is_eq(l1, l2), U32.is_eq(h1, h2))
      zip.go(ct, tt, (e + 1 : U32), U.Q{r1, ((e * 2 : U32) + 1 : U32), 0, 0} <> U.Q{r2, (e * 2 : U32), 0, 0} <> re, r1 <> er, (bad + Bool.pick(U32, ok, 0, 1) : U32))
    case _ _:
      ZO{re, U.rev(U32, er), e, (bad + 1 : U32)}

# ---------------------------------------------------------------------------
# 10. Exact edge curves and their certification against the mesh polyline.

def pts.of(vs: List<&2, U32>, +ctx: Ctx, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match vs:
    case Nil{}:
      U.rev(G.Vec3, acc)
    case v <> t:
      pts.of(t, ctx, ctx.pos(ctx, v) <> acc)

type SW is Data:
  SW{sum: F32, minstep: F32}

def sweep.go(ps: List<&2, G.Vec3>, +c: A.Curve, +prev: F32, +conic: Bool, st: SW) -> SW:
  match ps:
    case Nil{}:
      st
    case p <> t:
      SW{s, m} = st
      +th = S.angle(c, p)
      +d = Bool.pick(F32, conic, S.wrap((th - prev : F32)), (th - prev : F32))
      sweep.go(t, c, th, conic, SW{(s + d : F32), F32.min(m, d)})

def sweep(ps: List<&2, G.Vec3>, +c: A.Curve, +conic: Bool) -> SW:
  match ps:
    case Nil{}:
      SW{0.0, 0.0}
    case p <> t:
      sweep.go(t, c, S.angle(c, p), conic, SW{0.0, 1000000000.0})

def sw.sum(s: SW) -> F32:
  SW{x, _} = s
  x

def sw.min(s: SW) -> F32:
  SW{_, x} = s
  x

def maxd.go(ps: List<&2, G.Vec3>, +c: A.Curve, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      maxd.go(t, c, U.f32max(acc, R.approx(S.cdist(c, p))))

def half() -> R.Real:
  S.rf(0.5)

def maxm.go(ps: List<&2, G.Vec3>, +c: A.Curve, +prev: G.Vec3, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      maxm.go(t, c, p, U.f32max(acc, R.approx(S.cdist(c, G.scale(G.add(prev, p), half())))))

def maxm(ps: List<&2, G.Vec3>, +c: A.Curve) -> F32:
  match ps:
    case Nil{}:
      0.0
    case +p <> t:
      maxm.go(t, c, p, 0.0)

def cmax.go(ps: List<&2, G.Vec3>, +s1: S.Surf, +s2: S.Surf, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      cmax.go(t, s1, s2, U.f32max(acc, F32.abs(R.approx(G.dot(S.normal_at(s1, p), S.normal_at(s2, p))))))

# Signed area swept around the curve centre, seen along the curve normal.
def carea.go(ps: List<&2, G.Vec3>, +o: G.Vec3, +n: G.Vec3, +prev: G.Vec3, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      carea.go(t, o, n, p, (acc + R.approx(G.dot(G.cross(G.sub(prev, o), G.sub(p, o)), n)) : F32))

def carea(ps: List<&2, G.Vec3>, +c: A.Curve) -> F32:
  match ps:
    case Nil{}:
      0.0
    case +p <> t:
      carea.go(t, S.curve_center(c), S.curve_normal(c), p, 0.0)

def orient(c: A.Curve, +ps: List<&2, G.Vec3>, +start: G.Vec3, +end: G.Vec3) -> A.Curve:
  match c:
    case A.Line{_, +d}:
      A.Line{start, Bool.pick(G.Vec3, R.less(G.dot(d, G.sub(end, start)), S.rf(0.0)), S.vneg(d), d)}
    case +other:
      Bool.pick(A.Curve, (carea(ps, other) < 0.0 : F32), S.flip_curve(other), other)

type EdgeOut is Data:
  EdgeOut{why: Why, c: A.Curve, sv: U32, ev: U32, closed: Bool, seam: G.Vec3, maxd: F32, bound: F32, cmax: F32, ranged: Bool, first: R.Real, last: R.Real}

# Parameter range of an open arc traversed along its curve: [t(start),
# t(start) + sweep] with the sweep in (0, 2 pi] (kernel curveRange convention,
# A.curve_parameter).
def arc_last(+first: R.Real, +d: R.Real) -> R.Real:
  R.add(first, Bool.pick(R.Real, R.less(d, S.rf(0.000000000001)), R.add(d, R.mul(R.pi(), S.rf(2.0))), d))

def dummy_curve() -> A.Curve:
  A.Line{S.zero3(), G.v3(0.0, 0.0, 1.0)}

def pts.first(ps: List<&2, G.Vec3>, d: G.Vec3) -> G.Vec3:
  match ps:
    case Nil{}:
      d
    case p <> _:
      p

def pts.last(ps: List<&2, G.Vec3>, d: G.Vec3) -> G.Vec3:
  pts.first(U.rev(G.Vec3, ps), d)

def edge.checked(+c: A.Curve, +seam: G.Vec3, +tangent: Bool, +ps: List<&2, G.Vec3>, +s1: S.Surf, +s2: S.Surf, +closed: Bool, +sc: U32, +ec: U32, +start: G.Vec3, +end: G.Vec3, +dev: F32) -> EdgeOut:
  +oc = orient(c, ps, start, end)
  +line = S.is_line(oc)
  +md = maxd.go(ps, oc, 0.0)
  +mm = maxm(ps, oc)
  +cm = cmax.go(ps, s1, s2, 0.0)
  +factor = S.cdist_factor(oc)
  # Transversal edges: a point within dev of both carriers is within
  # dev / min(sin, cos)(theta/2) of their intersection (theta = angle of the
  # normals, |cos theta| <= cm), times the ellipse distance factor. Tangent
  # (G1) edges have no transversality bound: the measured distance must stay
  # within dev itself.
  # The acceptance bound is capped at 10 dev: the certificate is the measured
  # distance, the bound only says how far a correct mesh may stray.
  # Grazing edges (normals parallel within 1e-6 along the mesh boundary, not
  # an exact tangent contact) have no usable transversality bound either. They
  # are accepted only on a pair whose carriers meet in two parallel lines
  # (S.line_gap: a plane parallel to a cylinder axis, parallel cylinders; for
  # example two three-point arcs of a profile that are tangent only to the
  # precision of their shared end point, which lies exactly on both): the
  # boundary must follow the chosen line within dev (the G1 bound) and stay
  # within a quarter of the gap of it, so every mesh point is at least twice
  # as far from the other line and the choice is not decided by rounding.
  # The end vertices, refined independently from their own seeds, must lie
  # on the chosen line (endoff below).
  +gap = R.approx(S.line_gap(s1, s2))
  +grazing = Bool.and(Bool.not(tangent), (cm > 0.999999 : F32))
  +pinned = Bool.and(line, Bool.and((md <= dev : F32), ((4.0 * md : F32) < gap : F32)))
  +tau = Bool.pick(F32, Bool.or(tangent, grazing), (dev + 0.000001 : F32), (F32.min((((dev / F32.sqrt(F32.max(((1.0 - cm) / 2.0 : F32), 0.000001)) : F32) * factor : F32)), (10.0 * dev : F32)) + 0.000001 : F32))
  +sw = sweep(ps, oc, Bool.not(line))
  +sum = sw.sum(sw)
  +minstep = sw.min(sw)
  +tau2 = (2.0 * F32.pi() : F32)
  +raw = S.wrap((S.angle(oc, end) - S.angle(oc, start) : F32))
  +expect = Bool.pick(F32, closed, tau2, Bool.pick(F32, (raw <= 0.000001 : F32), (raw + tau2 : F32), raw))
  # The expected sweep runs between the exact end vertices, the mesh's
  # between its own end corners. Each end's angular offset (measured) is the
  # corner drift that the corner certificate has already bounded as a
  # distance (corner.fold); on an arc of radius r it is drift / r, so a fixed
  # 0.05 rad would re-judge an accepted corner by a bound that shrinks with
  # the radius (the KT1 relief rim at 2^-3 scale: r 0.26 mm, drifts 0.0098
  # and 0.0107 mm within their 0.0125 mm bound, 0.078 rad). The measured
  # offsets are added to the slack, so the check keeps certifying what it is
  # for: one monotone traversal over the exact range, not the long way round
  # (a wrong range differs by about 2 pi minus the offsets).
  +offs = (F32.abs(S.wrap((S.angle(oc, pts.first(ps, start)) - S.angle(oc, start) : F32))) + F32.abs(S.wrap((S.angle(oc, pts.last(ps, end)) - S.angle(oc, end) : F32))) : F32)
  +slack = Bool.pick(F32, closed, 0.05, (0.05 + offs : F32))
  +sweep_bad = Bool.pick(Bool, line, (minstep < F32.neg(0.000001) : F32),
    Bool.or((F32.abs((sum - expect : F32)) > slack : F32), (minstep < F32.neg(0.01) : F32)))
  +endoff = U.f32max(R.approx(S.cdist(oc, start)), R.approx(S.cdist(oc, end)))
  +w = why.or(why.if(Bool.and(closed, line), "closed boundary loop on a straight line"),
    why.or(why.if(Bool.and(grazing, Bool.not(pinned)), "tangent carriers along an edge that is neither an exact tangent contact line nor pinned to one of two parallel intersection lines (|cos| " ++ f32s(cm) ++ ", line gap " ++ f32s(gap) ++ " mm, boundary distance " ++ f32s(md) ++ " mm) [" ++ S.kind_name(S.kind(s1)) ++ "/" ++ S.kind_name(S.kind(s2)) ++ "]"),
    why.or(why.cert((md > tau : F32), "mesh boundary leaves its exact curve by " ++ f32s(md) ++ " mm (certified bound " ++ f32s(tau) ++ ")"),
    why.or(why.cert((mm > (tau + (dev * factor : F32) : F32) : F32), "mesh boundary segment midpoint leaves its exact curve by " ++ f32s(mm) ++ " mm"),
    why.or(why.cert(sweep_bad, "mesh boundary does not traverse its exact curve once (sweep " ++ f32s(sum) ++ ", expected " ++ f32s(expect) ++ ")"),
      why.if((endoff > 0.000001 : F32), "exact vertex off its exact curve by " ++ f32s(endoff) ++ " mm"))))))
  +first = A.curve_parameter(oc, start)
  +last = arc_last(first, R.sub(A.curve_parameter(oc, end), first))
  EdgeOut{w, oc, sc, ec, closed, seam, md, tau, cm, Bool.and(Bool.not(closed), Bool.not(line)), first, last}

def edge.cv(cv: S.Cv, +ps: List<&2, G.Vec3>, +s1: S.Surf, +s2: S.Surf, +closed: Bool, +sc: U32, +ec: U32, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat, +dev: F32) -> EdgeOut:
  match cv:
    case S.CvNo{why}:
      EdgeOut{Why{why ++ " [" ++ S.kind_name(S.kind(s1)) ++ "/" ++ S.kind_name(S.kind(s2)) ++ "]"}, dummy_curve(), sc, ec, closed, S.zero3(), 0.0, 0.0, 0.0, False{}, S.rf(0.0), S.rf(0.0)}
    case S.CvOk{c, +seam, +tangent}:
      +start = Bool.pick(G.Vec3, closed, seam, U.tab.get(G.Vec3, cpos, dc, sc))
      +end = Bool.pick(G.Vec3, closed, seam, U.tab.get(G.Vec3, cpos, dc, ec))
      edge.checked(c, seam, tangent, ps, s1, s2, closed, sc, ec, start, end, dev)

def head_or(ps: List<&2, G.Vec3>, dflt: G.Vec3) -> G.Vec3:
  match ps:
    case Nil{}:
      dflt
    case p <> _:
      p

def class_surf(+ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +p: U32) -> S.Surf:
  ctx.surf(ctx, (U.tab.get(U32, fk, dt, p) >> 1n : U32))

def edge.one(r: Run, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat) -> EdgeOut:
  Run{+p, +q, +closed, +sc, +ec, vs, _, _, _} = r
  +ps = pts.of(vs, ctx, Nil{})
  +s1 = class_surf(ctx, fk, dt, p)
  +s2 = class_surf(ctx, fk, dt, q)
  edge.cv(S.curve(s1, s2, head_or(ps, S.zero3())), ps, s1, s2, closed, sc, ec, cpos, dc, R.approx(ctx.dev(ctx)))

type EC is Data:
  EC{runs: U.Tab<&2, Run>, dr: Nat, ctx: Ctx, fk: U.Tab<&2, U32>, dt: Nat, cpos: U.Tab<&2, G.Vec3>, dc: Nat}

def edge.f(c: EC, rid: U32) -> EdgeOut:
  EC{runs, dr, ctx, fk, dt, cpos, dc} = c
  edge.one(U.tab.get(Run, runs, dr, rid), ctx, fk, dt, cpos, dc)

def edges.go(+er: List<&2, U32>, +runs: U.Tab<&2, Run>, +dr: Nat, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat) -> List<&2, EdgeOut>:
  U.par.map(~EC, ~U32, ~EdgeOut, ~edge.f, EC{runs, dr, ctx, fk, dt, cpos, dc}, U.fork_depth(), U.two(U32, er, U32.to_nat(U.count(U32, er, 0))))


def edge.why(es: List<&2, EdgeOut>, acc: Why) -> Why:
  match es:
    case Nil{}:
      acc
    case EdgeOut{w, _, _, _, _, _, _, _, _, _, _, _} <> t:
      edge.why(t, why.or(acc, w))

# ---------------------------------------------------------------------------
# 11. Faces: one per patch; loops from its runs.

type LoopOut is Data:
  LoopOut{outer: Bool, uses: List<&2, T.Coedge>}

type LD is Data:
  LD{uses: List<&2, T.Coedge>, pts: List<&2, G.Vec3>, n: U32}

def lr.uses(n: Nat, +rid: U32, +re: U.Tab<&2, U32>, +dr: Nat, acc: List<&2, T.Coedge>) -> List<&2, T.Coedge>:
  match n:
    case 0n:
      U.rev(T.Coedge, acc)
    case 1n+m:
      +pk = U.tab.get(U32, re, dr, rid)
      lr.uses(m, (rid + 1 : U32), re, dr, T.Use{(pk >> 1n : U32), U32.is_eq(U32.and(pk, 1), 1)} <> acc)

def run.vs(r: Run) -> List<&2, U32>:
  Run{_, _, _, _, _, vs, _, _, _} = r
  vs

def lr.pts(n: Nat, +rid: U32, +runs: U.Tab<&2, Run>, +dr: Nat, +ctx: Ctx, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match n:
    case 0n:
      U.rev(G.Vec3, acc)
    case 1n+m:
      lr.pts(m, (rid + 1 : U32), runs, dr, ctx, M.rev_onto(G.Vec3, pts.of(run.vs(U.tab.get(Run, runs, dr, rid)), ctx, Nil{}), acc))

def lr.data(l: LR, +re: U.Tab<&2, U32>, +runs: U.Tab<&2, Run>, +dr: Nat, +ctx: Ctx) -> LD:
  LR{_, +first, +n} = l
  LD{lr.uses(U32.to_nat(n), first, re, dr, Nil{}), lr.pts(U32.to_nat(n), first, runs, dr, ctx, Nil{}), n}

def lds.go(ls: List<&2, LR>, +re: U.Tab<&2, U32>, +runs: U.Tab<&2, Run>, +dr: Nat, +ctx: Ctx, acc: List<&2, LD>) -> List<&2, LD>:
  match ls:
    case Nil{}:
      U.rev(LD, acc)
    case l <> t:
      lds.go(t, re, runs, dr, ctx, lr.data(l, re, runs, dr, ctx) <> acc)

def parea.go(ps: List<&2, G.Vec3>, +p0: G.Vec3, +n: G.Vec3, +prev: G.Vec3, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      parea.go(t, p0, n, p, (acc + R.approx(G.dot(G.cross(G.sub(prev, p0), G.sub(p, p0)), n)) : F32))

def parea(ps: List<&2, G.Vec3>, +n: G.Vec3) -> F32:
  match ps:
    case Nil{}:
      0.0
    case +p <> t:
      parea.go(t, p, n, p, 0.0)

def theta(+p: G.Vec3, +o: G.Vec3, +x: G.Vec3, +y: G.Vec3) -> F32:
  +d = G.sub(p, o)
  F32.atan2(R.approx(G.dot(d, y)), R.approx(G.dot(d, x)))

def wind.go(ps: List<&2, G.Vec3>, +o: G.Vec3, +x: G.Vec3, +y: G.Vec3, +prev: F32, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case p <> t:
      +th = theta(p, o, x, y)
      wind.go(t, o, x, y, th, (acc + S.wrap((th - prev : F32)) : F32))

# Turns of a closed polyline around the axis (o, a).
def wind.frame(ps: List<&2, G.Vec3>, +o: G.Vec3, +x: G.Vec3, +y: G.Vec3) -> F32:
  match ps:
    case Nil{}:
      0.0
    case p <> t:
      (wind.go(t, o, x, y, theta(p, o, x, y), 0.0) / (2.0 * F32.pi() : F32) : F32)

def wind(ps: List<&2, G.Vec3>, +o: G.Vec3, +a: G.Vec3) -> F32:
  +x = A.axis_x(a)
  wind.frame(ps, o, x, G.cross(a, x))

# Output surfaces: the kernel body surfaces (plane, cylinder, cone) plus the
# sphere and torus faces the body format does not have yet. Spheres and tori
# carry the frame of their STEP placement: axis `a` and seam direction `x`.
type OSurf is Data:
  OA{s: A.Surface}
  OSphere{o: G.Vec3, a: G.Vec3, x: G.Vec3, r: R.Real}
  OTorus{o: G.Vec3, a: G.Vec3, x: G.Vec3, big: R.Real, small: R.Real}

# A periodic band face: two plain rims e0, e1 joined by a seam curve from the
# vertex of e0 to the vertex of e1 (a generator line on cylinders and cones,
# a meridian arc with parameter range on spheres and tori).
# A full sphere (a closed patch without boundary) gets two pole vertices and
# a meridian seam arc from the south to the north pole.
type Band is Data:
  NoBand{}
  Band{e0: U32, f0: Bool, e1: U32, f1: Bool, c: A.Curve, ranged: Bool, first: R.Real, last: R.Real}
  Full{c: A.Curve, first: R.Real, last: R.Real, south: G.Vec3, north: G.Vec3}
  Ring{lat: A.Curve, mer: A.Curve, v: G.Vec3}

type FaceOut is Data:
  FaceOut{why: Why, p: U32, sense: Bool, s: OSurf, tag: U32, loops: List<&2, LoopOut>, band: Band}

type BW is Data:
  BW{band: Band, why: Why}

def no_face(+why: String, +p: U32, +sense: Bool, +k: U32) -> FaceOut:
  FaceOut{Why{why}, p, sense, OA{A.Plane{S.zero3(), G.v3(0.0, 0.0, 1.0), G.v3(1.0, 0.0, 0.0)}}, k, Nil{}, NoBand{}}

type PL is Data:
  PL{loops: List<&2, LoopOut>, outers: U32}

def plane.go(ls: List<&2, LD>, +nout: G.Vec3, st: PL) -> PL:
  match ls:
    case Nil{}:
      st
    case LD{uses, pts, _} <> t:
      PL{acc, k} = st
      +out = (parea(pts, nout) > 0.0 : F32)
      plane.go(t, nout, PL{LoopOut{out, uses} <> acc, (k + Bool.pick(U32, out, 1, 0) : U32)})

def face.plane(pl: PL, +p: U32, +k: U32, +sense: Bool, s: A.Surface) -> FaceOut:
  PL{ls, +outers} = pl
  +w = why.if(U32.is_ne(outers, 1), "planar face with " ++ U32.show(outers) ++ " outer loops (patch " ++ U32.show(p) ++ ")")
  FaceOut{w, p, sense, OA{s}, k, U.rev(LoopOut, ls), NoBand{}}

def use.e(us: List<&2, T.Coedge>) -> U32:
  match us:
    case Nil{}:
      none()
    case T.Use{e, _} <> _:
      e

def use.f(us: List<&2, T.Coedge>) -> Bool:
  match us:
    case Nil{}:
      False{}
    case T.Use{_, f} <> _:
      f

def turns(+w: F32) -> F32:
  F32.abs(w)

def eo.seam(e: EdgeOut) -> G.Vec3:
  EdgeOut{_, _, _, _, _, s, _, _, _, _, _, _} = e
  s

def eo.curve(e: EdgeOut) -> A.Curve:
  EdgeOut{_, c, _, _, _, _, _, _, _, _, _, _} = e
  c

def eo.closed(e: EdgeOut) -> Bool:
  EdgeOut{_, _, _, _, c, _, _, _, _, _, _, _} = e
  c

def dummy_edge() -> EdgeOut:
  EdgeOut{Fine{}, dummy_curve(), 0, 0, False{}, S.zero3(), 0.0, 0.0, 0.0, False{}, S.rf(0.0), S.rf(0.0)}

def res3(+s: S.Surf, +p0: G.Vec3, +p1: G.Vec3, +p2: G.Vec3) -> F32:
  U.f32max(R.approx(S.residual(s, p0)), U.f32max(R.approx(S.residual(s, p1)), R.approx(S.residual(s, p2))))

# Cylinder / cone band: the seam is the generator line through both rim
# vertices (both lie on the generator at A.axis_x(axis)).
def band.line(+carrier: S.Surf, +e0: U32, +f0: Bool, +e1: U32, +f1: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +p: U32) -> BW:
  +p0 = eo.seam(U.tab.get(EdgeOut, eT, de, e0))
  +p1 = eo.seam(U.tab.get(EdgeOut, eT, de, e1))
  +len = R.approx(S.vlen(G.sub(p1, p0)))
  +sres = res3(carrier, p0, p1, G.scale(G.add(p0, p1), half()))
  +bad = Bool.or((len < 0.000001 : F32), (sres > 0.0000001 : F32))
  BW{Band{e0, f0, e1, f1, A.Line{p0, G.normalize(G.sub(p1, p0))}, False{}, S.rf(0.0), S.rf(0.0)},
    why.if(bad, "seam of a band face does not lie on its carrier (patch " ++ U32.show(p) ++ ", residual " ++ f32s(sres) ++ ")")}

# General form: the seam is an arc of the circle (m, normal +-nm, x, rm).
def band.arc.g(+m: G.Vec3, +rm: R.Real, +nm: G.Vec3, +carrier: S.Surf, +sense: Bool, +x: G.Vec3, +e0: U32, +f0: Bool, +e1: U32, +f1: Bool, +r0: EdgeOut, +r1: EdgeOut, +p: U32) -> BW:
  +p0 = eo.seam(r0)
  +p1 = eo.seam(r1)
  +c0 = eo.curve(r0)
  +t0 = G.scale(G.cross(S.curve_normal(c0), G.sub(p0, S.curve_center(c0))), Bool.pick(R.Real, f0, S.rf(1.0), S.rf(F32.neg(1.0))))
  +nf = G.scale(S.normal_at(carrier, p0), Bool.pick(R.Real, sense, S.rf(1.0), S.rf(F32.neg(1.0))))
  +left = G.normalize(G.cross(nf, t0))
  +dir = G.normalize(G.cross(nm, G.sub(p0, m)))
  +cosv = R.approx(G.dot(left, dir))
  +arc = {A.Circle{m, Bool.pick(G.Vec3, (cosv > 0.0 : F32), nm, S.vneg(nm)), x, rm} : A.Curve}
  +first = A.curve_parameter(arc, p0)
  +last = arc_last(first, R.sub(A.curve_parameter(arc, p1), first))
  +mid = A.curve_point(arc, R.mul(R.add(first, last), half()))
  +sres = res3(carrier, p0, p1, mid)
  +off = U.f32max(R.approx(S.cdist(arc, p0)), R.approx(S.cdist(arc, p1)))
  +len = R.approx(S.vlen(G.sub(p1, p0)))
  +bad = Bool.or(Bool.or((len < 0.000001 : F32), (sres > 0.0000001 : F32)), Bool.or((off > 0.0000001 : F32), (F32.abs(cosv) < 0.5 : F32)))
  BW{Band{e0, f0, e1, f1, arc, True{}, first, last},
    why.if(bad, "meridian seam of a band face is not on its carrier and rims (patch " ++ U32.show(p) ++ ", residual " ++ f32s(sres) ++ ", rim offset " ++ f32s(off) ++ ", |cos| " ++ f32s(cosv) ++ ")")}

# Sphere / torus band: the seam is the arc of the meridian circle at x from
# the vertex of rim e0 to the vertex of rim e1 that enters the face, i.e.
# leaves e0 on the face side (left of the rim as used, seen along the face's
# outward normal).
def band.arc.m(mer: S.Mer, +carrier: S.Surf, +sense: Bool, +a: G.Vec3, +x: G.Vec3, +e0: U32, +f0: Bool, +e1: U32, +f1: Bool, +r0: EdgeOut, +r1: EdgeOut, +p: U32) -> BW:
  S.Mer{+m, +rm} = mer
  band.arc.g(m, rm, G.normalize(G.cross(x, a)), carrier, sense, x, e0, f0, e1, f1, r0, r1, p)

def band.arc(+carrier: S.Surf, +sense: Bool, +a: G.Vec3, +x: G.Vec3, +e0: U32, +f0: Bool, +e1: U32, +f1: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +p: U32) -> BW:
  band.arc.m(S.meridian(carrier, x), carrier, sense, a, x, e0, f0, e1, f1, U.tab.get(EdgeOut, eT, de, e0), U.tab.get(EdgeOut, eT, de, e1), p)

def face.band(bw: BW, +p: U32, +sense: Bool, s: OSurf, +k: U32, +w: Why) -> FaceOut:
  BW{band, bwhy} = bw
  FaceOut{why.or(w, bwhy), p, sense, s, k, Nil{}, band}

# Signed area of a closed polyline in the (theta, h) chart of a surface of
# revolution about (o, a); positive = counter-clockwise seen from outside
# (the chart is right-handed with respect to the outward carrier normal).
def uvarea.go(ps: List<&2, G.Vec3>, +o: G.Vec3, +a: G.Vec3, +x: G.Vec3, +y: G.Vec3, +pth: F32, +ph: F32, acc: F32) -> F32:
  match ps:
    case Nil{}:
      acc
    case +p <> t:
      +th = theta(p, o, x, y)
      +h = R.approx(G.dot(G.sub(p, o), a))
      uvarea.go(t, o, a, x, y, th, h, (acc - ((S.wrap((th - pth : F32)) * ((h + ph : F32) * 0.5 : F32) : F32)) : F32))

def uvarea.xy(ps: List<&2, G.Vec3>, +o: G.Vec3, +a: G.Vec3, +x: G.Vec3, +y: G.Vec3) -> F32:
  match ps:
    case Nil{}:
      0.0
    case +p <> t:
      uvarea.go(M.rev_onto(G.Vec3, U.rev(G.Vec3, t), [p]), o, a, x, y, theta(p, o, x, y), R.approx(G.dot(G.sub(p, o), a)), 0.0)

def uvarea(ps: List<&2, G.Vec3>, +o: G.Vec3, +a: G.Vec3) -> F32:
  +x = A.axis_x(a)
  uvarea.xy(ps, o, a, x, G.cross(a, x))

type WL is Data:
  WL{w: F32, uses: List<&2, T.Coedge>, n: U32, area: F32}

def per.go(ls: List<&2, LD>, +o: G.Vec3, +a: G.Vec3, acc: List<&2, WL>) -> List<&2, WL>:
  match ls:
    case Nil{}:
      U.rev(WL, acc)
    case LD{uses, +pts, n} <> t:
      per.go(t, o, a, WL{wind(pts, o, a), uses, n, uvarea(pts, o, a)} <> acc)

# General periodic face (kernel convention: no explicit seam; the STEP reader
# adds it). Either exactly two loops wind once around the axis (a band, whose
# other loops are holes) or none does (a partial face: one outer loop by
# signed chart area, the others holes).
type PF is Data:
  PF{loops: List<&2, LoopOut>, wound: U32, bad: U32, outers: U32}

def pf.go(ws: List<&2, WL>, +sense: Bool, st: PF) -> PF:
  match ws:
    case Nil{}:
      st
    case WL{+w, uses, _, +ar} <> t:
      PF{ls, +nw, +bad, +no} = st
      +wound = (turns(w) > 0.5 : F32)
      +outer = Bool.pick(Bool, wound, U32.is_eq(nw, 0), Bool.not(Bool.xor((ar > 0.0 : F32), sense)))
      pf.go(t, sense, PF{LoopOut{outer, uses} <> ls, (nw + b2u(wound) : U32), (bad + b2u((turns(w) > 1.5 : F32)) : U32), (no + b2u(Bool.and(outer, Bool.not(wound))) : U32)})

def face.general.k(pf: PF, +p: U32, +k: U32, +sense: Bool, s: A.Surface) -> FaceOut:
  PF{ls, +nw, +bad, +no} = pf
  +ok = Bool.and(U32.is_eq(bad, 0), Bool.or(U32.is_eq(nw, 2), Bool.and(U32.is_eq(nw, 0), U32.is_eq(no, 1))))
  +w = why.if(Bool.not(ok), "periodic face with " ++ U32.show(nw) ++ " loops around its axis and " ++ U32.show(no) ++ " outer loops (patch " ++ U32.show(p) ++ "; needs 2 and any, or 0 and 1)")
  FaceOut{w, p, sense, OA{s}, k, U.rev(LoopOut, ls), NoBand{}}

def face.general(ws: List<&2, WL>, +p: U32, +k: U32, +sense: Bool, s: A.Surface) -> FaceOut:
  face.general.k(pf.go(ws, sense, PF{Nil{}, 0, 0, 0}), p, k, sense, s)

def wl.plain(+w: WL) -> Bool:
  WL{+x, _, n, _} = w
  Bool.and((turns(x) > 0.5 : F32), U32.is_eq(n, 1))

def wl.uses(w: WL) -> List<&2, T.Coedge>:
  WL{_, u, _, _} = w
  u

def face.pick2(+plain: Bool, +w0: WL, +w1: WL, +carrier: S.Surf, +p: U32, +k: U32, +sense: Bool, +s: A.Surface, +eT: U.Tab<&2, EdgeOut>, +de: Nat) -> FaceOut:
  match plain:
    case True{}:
      +u0 = wl.uses(w0)
      +u1 = wl.uses(w1)
      face.band(band.line(carrier, use.e(u0), use.f(u0), use.e(u1), use.f(u1), eT, de, p), p, sense, OA{s}, k, Fine{})
    case False{}:
      face.general([w0, w1], p, k, sense, s)

# A band of two plain rims gets its explicit seam line (kernel with_seams);
# every other periodic face keeps its loops.
def face.per(wls: List<&2, WL>, +carrier: S.Surf, +p: U32, +k: U32, +sense: Bool, +s: A.Surface, +eT: U.Tab<&2, EdgeOut>, +de: Nat) -> FaceOut:
  match wls:
    case +w0 <> +w1 <> Nil{}:
      face.pick2(Bool.and(wl.plain(w0), wl.plain(w1)), w0, w1, carrier, p, k, sense, s, eT, de)
    case ws:
      face.general(ws, p, k, sense, s)

# A sphere face bounded by one closed circle is a cap; its STEP frame puts the
# pole inside the cap (axis = the rim normal as used: the rim runs counter-
# clockwise about the axis, seen from outside) and the seam through the rim
# vertex (x = the rim's x), so the sphere's own seam meets the rim there.
def face.cap(+e: EdgeOut, +fwd: Bool, +n: U32, uses: List<&2, T.Coedge>, +o: G.Vec3, +r: R.Real, +p: U32, +k: U32, +sense: Bool) -> FaceOut:
  +c = eo.curve(e)
  +ok = Bool.and(U32.is_eq(n, 1), Bool.and(eo.closed(e), S.is_circle(c)))
  +nc = S.curve_normal(c)
  +w = why.if(Bool.not(ok), "sphere face bounded by one loop that is not a single closed circle (patch " ++ U32.show(p) ++ "): needs a sphere seam split, not implemented")
  FaceOut{w, p, sense, OSphere{o, Bool.pick(G.Vec3, fwd, nc, S.vneg(nc)), S.curve_x(c), r}, k, [LoopOut{True{}, uses}], NoBand{}}

# Two coaxial plain rims (closed circles) on a sphere or torus: a band.
def rims.ok(+r0: EdgeOut, +r1: EdgeOut, +n0: U32, +n1: U32, +a: G.Vec3) -> Bool:
  +c0 = eo.curve(r0)
  +c1 = eo.curve(r1)
  Bool.and(Bool.and(Bool.and(U32.is_eq(n0, 1), U32.is_eq(n1, 1)), Bool.and(eo.closed(r0), eo.closed(r1))),
    Bool.and(Bool.and(S.is_circle(c0), S.is_circle(c1)), Bool.and(S.parallel(S.curve_normal(c0), a), S.parallel(S.curve_normal(c1), a))))

def face.rev2(+carrier: S.Surf, +s: OSurf, +a: G.Vec3, +x: G.Vec3, +u0: List<&2, T.Coedge>, +n0: U32, +u1: List<&2, T.Coedge>, +n1: U32, +p: U32, +k: U32, +sense: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +what: String) -> FaceOut:
  +e0 = use.e(u0)
  +e1 = use.e(u1)
  +ok = rims.ok(U.tab.get(EdgeOut, eT, de, e0), U.tab.get(EdgeOut, eT, de, e1), n0, n1, a)
  +wd = why.if(Bool.not(ok), what ++ " face with two loops that are not two coaxial plain rim circles (patch " ++ U32.show(p) ++ "): needs a seam split, not implemented")
  face.band(band.arc(carrier, sense, a, x, e0, use.f(u0), e1, use.f(u1), eT, de, p), p, sense, s, k, wd)

def eo.start(e: EdgeOut, +fwd: Bool) -> U32:
  EdgeOut{_, _, sv, ev, _, _, _, _, _, _, _, _} = e
  Bool.pick(U32, fwd, sv, ev)

def area_vec.go(ps: List<&2, G.Vec3>, +o: G.Vec3, +prev: G.Vec3, acc: G.Vec3) -> G.Vec3:
  match ps:
    case Nil{}:
      acc
    case +q <> t:
      area_vec.go(t, o, q, G.add(acc, G.cross(G.sub(prev, o), G.sub(q, o))))

# Twice the vector area of a closed polyline about o.
def area_vec(ps: List<&2, G.Vec3>, +o: G.Vec3) -> G.Vec3:
  match ps:
    case Nil{}:
      S.zero3()
    case +q <> t:
      area_vec.go(M.rev_onto(G.Vec3, U.rev(G.Vec3, t), [q]), o, q, S.zero3())

# A sphere face bounded by one loop with vertices (e.g. a sphere minus a box
# corner): the STEP frame puts a pole inside the face (axis = the vector area
# of the boundary as used) and the seam meridian through the loop's first
# exact vertex; the loop must wind once around that axis.
def face.cap.general(+uses: List<&2, T.Coedge>, pts: List<&2, G.Vec3>, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat, +o: G.Vec3, +r: R.Real, +p: U32, +k: U32, +sense: Bool) -> FaceOut:
  +ps = pts
  +axis = G.normalize(area_vec(ps, o))
  +v0 = U.tab.get(G.Vec3, cpos, dc, eo.start(U.tab.get(EdgeOut, eT, de, use.e(uses)), use.f(uses)))
  +d0 = G.sub(v0, o)
  +x = G.normalize(G.sub(d0, G.scale(axis, G.dot(d0, axis))))
  +w = wind(ps, o, axis)
  +bad = (F32.abs((w - 1.0 : F32)) > 0.25 : F32)
  FaceOut{why.if(bad, "sphere face bounded by one loop that does not wind once around its vector-area axis (patch " ++ U32.show(p) ++ ", winding " ++ f32s(w) ++ ")"), p, sense, OSphere{o, axis, x, r}, k, [LoopOut{True{}, uses}], NoBand{}}

def face.cap.pick(circle: Bool, +uses: List<&2, T.Coedge>, pts: List<&2, G.Vec3>, +n: U32, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat, +o: G.Vec3, +r: R.Real, +p: U32, +k: U32, +sense: Bool) -> FaceOut:
  match circle:
    case True{}:
      face.cap(U.tab.get(EdgeOut, eT, de, use.e(uses)), use.f(uses), n, uses, o, r, p, k, sense)
    case False{}:
      face.cap.general(uses, pts, eT, de, cpos, dc, o, r, p, k, sense)

def cap.is_circle(+e: EdgeOut, +n: U32) -> Bool:
  Bool.and(U32.is_eq(n, 1), Bool.and(eo.closed(e), S.is_circle(eo.curve(e))))

# Full sphere: STEP frame axis +z, seam direction +x; the seam is the
# meridian half circle in the xz plane from -z to +z (circle normal x cross a,
# so that the circle's second axis is +a).
def face.full(+o: G.Vec3, +r: R.Real, +p: U32, +k: U32, +sense: Bool) -> FaceOut:
  +a = G.v3(0.0, 0.0, 1.0)
  +x = G.v3(1.0, 0.0, 0.0)
  +c = {A.Circle{o, G.cross(x, a), x, r} : A.Curve}
  +south = G.sub(o, G.scale(a, r))
  +north = G.add(o, G.scale(a, r))
  +first = A.curve_parameter(c, south)
  FaceOut{Fine{}, p, sense, OSphere{o, a, x, r}, k, Nil{}, Full{c, first, arc_last(first, R.sub(A.curve_parameter(c, north), first)), south, north}}

def face.sphere(lds: List<&2, LD>, +carrier: S.Surf, +o: G.Vec3, +r: R.Real, +p: U32, +k: U32, +sense: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat) -> FaceOut:
  match lds:
    case Nil{}:
      face.full(o, r, p, k, sense)
    case LD{+uses, pts, +n} <> Nil{}:
      face.cap.pick(cap.is_circle(U.tab.get(EdgeOut, eT, de, use.e(uses)), n), uses, pts, n, eT, de, cpos, dc, o, r, p, k, sense)
    case LD{+u0, _, n0} <> LD{u1, _, n1} <> Nil{}:
      +a = S.curve_normal(eo.curve(U.tab.get(EdgeOut, eT, de, use.e(u0))))
      +x = A.axis_x(a)
      face.rev2(carrier, OSphere{o, a, x, r}, a, x, u0, n0, u1, n1, p, k, sense, eT, de, "sphere")
    case _:
      no_face("sphere face with more than two boundary loops (patch " ++ U32.show(p) ++ "): needs a sphere seam split, not implemented", p, sense, k)

# Torus band between two meridian rims (a torus cut by planes through its
# axis): the seam is the arc of the outer equator (circle about the axis of
# radius major + minor) from the vertex of rim 0 to the vertex of rim 1 that
# enters the face; the STEP frame's reference direction points at rim 0, so
# the face starts at u = 0.
def meridian.rims(+r0: EdgeOut, +r1: EdgeOut, +n0: U32, +n1: U32, +a: G.Vec3) -> Bool:
  +c0 = eo.curve(r0)
  +c1 = eo.curve(r1)
  Bool.and(Bool.and(Bool.and(U32.is_eq(n0, 1), U32.is_eq(n1, 1)), Bool.and(eo.closed(r0), eo.closed(r1))),
    Bool.and(Bool.and(S.is_circle(c0), S.is_circle(c1)),
      Bool.and(R.less(R.abs(G.dot(S.curve_normal(c0), a)), S.rf(0.000000001)), R.less(R.abs(G.dot(S.curve_normal(c1), a)), S.rf(0.000000001)))))

def face.torus.mer(+carrier: S.Surf, +o: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +u0: List<&2, T.Coedge>, +u1: List<&2, T.Coedge>, +p: U32, +k: U32, +sense: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat) -> FaceOut:
  +e0 = use.e(u0)
  +e1 = use.e(u1)
  +r0 = U.tab.get(EdgeOut, eT, de, e0)
  +x = G.normalize(A.radial(eo.seam(r0), o, a))
  face.band(band.arc.g(o, R.add(big, small), a, carrier, sense, x, e0, use.f(u0), e1, use.f(u1), r0, U.tab.get(EdgeOut, eT, de, e1), p), p, sense, OTorus{o, a, x, big, small}, k, Fine{})

def face.torus.two(mer: Bool, +carrier: S.Surf, +o: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +u0: List<&2, T.Coedge>, +n0: U32, +u1: List<&2, T.Coedge>, +n1: U32, +p: U32, +k: U32, +sense: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat) -> FaceOut:
  match mer:
    case True{}:
      face.torus.mer(carrier, o, a, big, small, u0, u1, p, k, sense, eT, de)
    case False{}:
      face.rev2(carrier, OTorus{o, a, A.axis_x(a), big, small}, a, A.axis_x(a), u0, n0, u1, n1, p, k, sense, eT, de, "torus")

# Full torus (a closed patch without boundary): one vertex on the outer
# equator at x, two closed seams through it (the outer equator and the
# meridian at x), one loop lat, mer, lat reversed, mer reversed.
def face.ring(+o: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +p: U32, +k: U32, +sense: Bool) -> FaceOut:
  +x = A.axis_x(a)
  +lat = {A.Circle{o, a, x, R.add(big, small)} : A.Curve}
  +mer = {A.Circle{G.add(o, G.scale(x, big)), G.cross(x, a), x, small} : A.Curve}
  FaceOut{Fine{}, p, sense, OTorus{o, a, x, big, small}, k, Nil{}, Ring{lat, mer, G.add(o, G.scale(x, R.add(big, small)))}}

def face.torus(lds: List<&2, LD>, +carrier: S.Surf, +o: G.Vec3, +a: G.Vec3, +big: R.Real, +small: R.Real, +p: U32, +k: U32, +sense: Bool, +eT: U.Tab<&2, EdgeOut>, +de: Nat) -> FaceOut:
  match lds:
    case Nil{}:
      face.ring(o, a, big, small, p, k, sense)
    case LD{+u0, _, +n0} <> LD{+u1, _, +n1} <> Nil{}:
      face.torus.two(meridian.rims(U.tab.get(EdgeOut, eT, de, use.e(u0)), U.tab.get(EdgeOut, eT, de, use.e(u1)), n0, n1, a), carrier, o, a, big, small, u0, n0, u1, n1, p, k, sense, eT, de)
    case _:
      no_face("torus face that is not a band between two rim circles (patch " ++ U32.show(p) ++ "): needs a torus seam split, not implemented", p, sense, k)

# Kernel body surfaces: a cone keeps its canonical axis and positive
# half-angle; an origin at the apex (radius 0) moves 1 mm up the axis, which
# is the same analytic surface with a positive reference radius.
def cone.out(+o: G.Vec3, +a: G.Vec3, x: G.Vec3, +r: R.Real, ang: R.Real, +tn: R.Real) -> A.Surface:
  +shift = R.less(r, S.rf(0.001))
  +h = R.div(S.rf(1.0), tn)
  A.Cone{Bool.pick(G.Vec3, shift, G.add(o, G.scale(a, h)), o), a, x, Bool.pick(R.Real, shift, R.add(r, S.rf(1.0)), r), ang}

def face.kind(+s: S.Surf, +p: U32, +k: U32, +sense: Bool, +lds: List<&2, LD>, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat) -> FaceOut:
  match s:
    case S.SPlane{o, +n, x}:
      face.plane(plane.go(lds, Bool.pick(G.Vec3, sense, n, S.vneg(n)), PL{Nil{}, 0}), p, k, sense, A.Plane{o, n, x})
    case S.SCyl{+o, +a, x, r}:
      face.per(per.go(lds, o, a, Nil{}), s, p, k, sense, A.Cylinder{o, a, x, r}, eT, de)
    case S.SCone{+o, +a, x, r, ang, tn, _, _}:
      face.per(per.go(lds, o, a, Nil{}), s, p, k, sense, cone.out(o, a, x, r, ang, tn), eT, de)
    case S.SSphere{o, r}:
      face.sphere(lds, s, o, r, p, k, sense, eT, de, cpos, dc)
    case S.STorus{o, a, big, small}:
      face.torus(lds, s, o, a, big, small, p, k, sense, eT, de)

def face.one(+p: U32, lrs: List<&2, LR>, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +re: U.Tab<&2, U32>, +runs: U.Tab<&2, Run>, +dr: Nat, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat) -> FaceOut:
  +fkp = U.tab.get(U32, fk, dt, p)
  +k = (fkp >> 1n : U32)
  face.kind(ctx.surf(ctx, k), p, k, U32.is_eq(U32.and(fkp, 1), 0), lds.go(lrs, re, runs, dr, ctx, Nil{}), eT, de, cpos, dc)

type FG is Data:
  FG{p: U32, lrs: List<&2, LR>}

def lr.keys(ls: List<&2, LR>, +i: U32, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match ls:
    case Nil{}:
      acc
    case LR{p, first, n} <> t:
      lr.keys(t, (i + 1 : U32), U.Q{p, first, n, i} <> acc)

def fg.go(xs: List<&2, U.Q>, +cp: U32, +cur: List<&2, LR>, acc: List<&2, FG>) -> List<&2, FG>:
  match xs:
    case Nil{}:
      U.rev(FG, FG{cp, U.rev(LR, cur)} <> acc)
    case U.Q{+p, +first, +n, _} <> t:
      +same = U32.is_eq(p, cp)
      +l = {LR{p, first, n} : LR}
      +acc2 = acc
      fg.go(t, p, Bool.pick(List<&2, LR>, same, l <> cur, [l]), Bool.pick(List<&2, FG>, same, acc2, FG{cp, U.rev(LR, cur)} <> acc2))

# Patches without boundary loops (a closed sphere) get an empty group; they
# are the roots missing from the grouped patches (both lists ascending).
def fg.loopless(n: Nat, +t: U32, +root: U.Tab<&2, U32>, +dt: Nat, gs: List<&2, FG>, acc: List<&2, FG>) -> List<&2, FG>:
  match n gs:
    case 0n _:
      M.rev_onto(FG, acc, gs)
    case 1n+m Nil{}:
      +isroot = U32.is_eq(U.tab.get(U32, root, dt, t), t)
      +acc2 = acc
      fg.loopless(m, (t + 1 : U32), root, dt, Nil{}, Bool.pick(List<&2, FG>, isroot, FG{t, Nil{}} <> acc2, acc2))
    case 1n+m FG{+p, +lrs} <> +gt:
      +isroot = U32.is_eq(U.tab.get(U32, root, dt, t), t)
      +here = U32.is_eq(p, t)
      +acc2 = acc
      +g = {FG{p, lrs} : FG}
      fg.loopless(m, (t + 1 : U32), root, dt, Bool.pick(List<&2, FG>, here, gt, g <> gt),
        Bool.pick(List<&2, FG>, here, g <> acc2, Bool.pick(List<&2, FG>, isroot, FG{t, Nil{}} <> acc2, acc2)))

def fg.all(few: Bool, gs: List<&2, FG>, +nt: U32, +root: U.Tab<&2, U32>, +dt: Nat) -> List<&2, FG>:
  match few:
    case False{}:
      gs
    case True{}:
      fg.loopless(U32.to_nat(nt), 0, root, dt, gs, Nil{})

def fg.start(xs: List<&2, U.Q>) -> List<&2, FG>:
  match xs:
    case Nil{}:
      Nil{}
    case U.Q{+p, first, n, _} <> t:
      fg.go(t, p, [LR{p, first, n}], Nil{})

type FC is Data:
  FC{ctx: Ctx, fk: U.Tab<&2, U32>, dt: Nat, re: U.Tab<&2, U32>, runs: U.Tab<&2, Run>, dr: Nat, eT: U.Tab<&2, EdgeOut>, de: Nat, cpos: U.Tab<&2, G.Vec3>, dc: Nat}

def face.f(c: FC, g: FG) -> FaceOut:
  FC{ctx, fk, dt, re, runs, dr, eT, de, cpos, dc} = c
  FG{p, lrs} = g
  face.one(p, lrs, ctx, fk, dt, re, runs, dr, eT, de, cpos, dc)

def faces.go(+gs: List<&2, FG>, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat, +re: U.Tab<&2, U32>, +runs: U.Tab<&2, Run>, +dr: Nat, +eT: U.Tab<&2, EdgeOut>, +de: Nat, +cpos: U.Tab<&2, G.Vec3>, +dc: Nat) -> List<&2, FaceOut>:
  U.par.map(~FC, ~FG, ~FaceOut, ~face.f, FC{ctx, fk, dt, re, runs, dr, eT, de, cpos, dc}, U.fork_depth(), U.two(FG, gs, U32.to_nat(U.count(FG, gs, 0))))

def face.why(fs: List<&2, FaceOut>, acc: Why) -> Why:
  match fs:
    case Nil{}:
      acc
    case FaceOut{w, _, _, _, _, _, _} <> t:
      face.why(t, why.or(acc, w))

# ---------------------------------------------------------------------------
# 12. Assembly: seam vertices of closed edges, seam edges of bands,
# components (one body each), void and Euler checks.

type EOut is Data:
  EOut{sv: U32, ev: U32, c: A.Curve, seam: Bool, maxd: F32, bound: F32, ranged: Bool, first: R.Real, last: R.Real}

type FOut is Data:
  FOut{body: U32, shell: U32, sense: Bool, s: OSurf, tag: U32, loops: List<&2, LoopOut>}

type Stats is Data:
  Stats{tris: U32, verts: U32, patches: U32, corners: U32, closed: U32, seams: U32, loops: U32, bodies: U32, maxd: F32, ratio: F32, drift: F32, dratio: F32, cres: F32, tagres: F32, mindet: F32, slivers: U32}

type Brep is Data:
  Brep{vs: List<&2, G.Vec3>, es: List<&2, EOut>, fs: List<&2, FOut>, st: Stats}

# A refusal is BCert when the tagged mesh itself is not certified as the
# Boolean's solid (a bad triangle or tag, a vertex off its carrier, not a
# closed oriented 2-manifold, a vertex link that is not one cycle, nested solid
# shells, faces closer than the clearance, a mesh boundary or an exact vertex
# farther from the exact geometry than its certified bound (Cert reasons), and
# every refusal of the stage-1 pre-certificate in tangent.bend), and BNo when
# only the exact recovery is refused (a curve or face type, a seam split, a
# corner, a sliver, the Euler check): the hybrid (kernel/hybrid/main.bend)
# answers the first Unresolved and keeps the mesh as a certified approximation
# for the second. Both print the same `unresolved <reason>` here.
type Out is Data:
  BOk{b: Brep}
  BNo{reason: String}
  BCert{reason: String}

def empty_brep(+nt: U32) -> Brep:
  Brep{Nil{}, Nil{}, Nil{}, Stats{nt, 0, 0, 0, 0, 0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0}}

type SV is Data:
  SV{es: List<&2, EOut>, vs: List<&2, G.Vec3>, vid: List<&2, U32>, sp: List<&2, G.Vec3>, next: U32, closed: U32, maxd: F32, ratio: F32}

def sv.go(eos: List<&2, EdgeOut>, st: SV) -> SV:
  match eos:
    case Nil{}:
      st
    case EdgeOut{_, c, sv, ev, +closed, +seam, +md, +bound, _, ranged, first, last} <> t:
      SV{es, vs, vid, sp, +next, +nc, +mx, +rt} = st
      +vs2 = vs
      sv.go(t, SV{EOut{Bool.pick(U32, closed, next, sv), Bool.pick(U32, closed, next, ev), c, False{}, md, bound, ranged, first, last} <> es,
        Bool.pick(List<&2, G.Vec3>, closed, seam <> vs2, vs2), Bool.pick(U32, closed, next, none()) <> vid, seam <> sp,
        (next + b2u(closed) : U32), (nc + b2u(closed) : U32), U.f32max(mx, md), U.f32max(rt, (md / F32.max(bound, 0.000000001) : F32))})

# `ill`: the first corner whose drift is beyond its certified bound (10 dev)
# only through the conditioning of its triple. That needs both
#   drift <= cond (3 dev / |det|: where a correct mesh vertex can lie), and
#   trans >= 0.1 for every pair of its carriers (S.min_trans): the mesh
#   vertex, within dev of each carrier (the input check), then lies within
#   dev / trans <= 10 dev of every pair's intersection curve, so the mesh
#   around the corner follows each of its edges within the certified bound
#   and only the vertex's place along those nearly concurrent curves is
#   open.
# Example: the KT1 relief (plane, an r 0.42 core cylinder, the 45 degree
# relief cone): pairwise 45 to 90 degrees apart, but the three curves meet at
# 7 degrees; |det| 0.088, drift 0.065 mm at dev 0.005. Such a vertex is
# neither certified exactly nor evidence against the mesh: the recovery goes
# on, every later check keeps its class (a boundary leaving its exact curve
# is still BCert), and one that passes them all is refused exactly (BNo)
# with this reason (st.final). With a nearly tangent pair (a lens crossing at
# 5 degrees, a plane shaving a cone) the mesh vertex is not pinned to that
# pair's curve and a drift beyond the bound stays a certificate failure.
# A vertex decided by a contact helper (geom.bend axial, CornerOut.aided)
# whose drift is beyond its bound goes to `ill` as well: its carriers are
# dependent, so the mesh vertex of a tangency can lie anywhere along the
# contact within its own per-vertex deviation, and the helper's point is one
# exact candidate on it. That drift alone refuses only the exact recovery
# (BNo, the certified mesh stands). It never enters `why`, so it stops
# nothing: the remaining corner, edge, face and assembly checks run as they
# would without it and a certificate failure among them is still BCert,
# whatever order the corners come in.
type CS is Data:
  CS{ps: List<&2, G.Vec3>, drift: F32, dratio: F32, res: F32, det: F32, why: Why, ill: Why}

def corner.fold(cs: List<&2, CornerOut>, st: CS) -> CS:
  match cs:
    case Nil{}:
      st
    case CornerOut{+v, p, +k, +drift, +bound, +cond, +det, +res, +aided, +trans} <> t:
      CS{ps, d, dr, r, dt, w, ill} = st
      +vs = U32.show(v)
      +far = "mesh vertex " ++ vs ++ ": exact vertex is " ++ f32s(drift) ++ " mm from the mesh (bound " ++ f32s(bound) ++ ")"
      +open = Bool.and((drift > bound : F32), Bool.and((drift <= cond : F32), (trans >= 0.1 : F32)))
      +beyond = Bool.and((drift > bound : F32), Bool.not(open))
      +w2 = why.or(w, why.or(why.if((k < 3 : U32), "mesh vertex " ++ vs ++ ": patches of only " ++ U32.show(k) ++ " distinct carriers meet (tessellation fragment or tangency)"),
        why.or(why.if((det < 0.000001 : F32), "mesh vertex " ++ vs ++ ": degenerate vertex, carriers dependent (|det| " ++ f32s(det) ++ ")"),
        why.or(why.if((res > 0.0000001 : F32), "mesh vertex " ++ vs ++ ": carriers are not concurrent (residual " ++ f32s(res) ++ " mm)"),
          why.cert(Bool.and(beyond, Bool.not(aided)), far)))))
      +ill2 = why.or(ill, why.or(why.if(open, far ++ ", within the " ++ f32s(cond) ++ " mm a correct mesh strays at |det| " ++ f32s(det) ++ " with every pair of its carriers transversal: the exact vertex is not certified"),
        why.if(Bool.and(beyond, aided), far ++ " (at a vertex decided by a contact line; exact recovery refused)")))
      corner.fold(t, CS{p <> ps, U.f32max(d, drift), U.f32max(dr, (drift / bound : F32)), U.f32max(r, res), F32.min(dt, det), w2, ill2})

def cs.ill(s: CS) -> Why:
  CS{_, _, _, _, _, _, v} = s
  v

type BF is Data:
  BF{fs: List<&2, FOut>, seams: List<&2, EOut>, next: U32, loops: U32, why: Why, pv: List<&2, G.Vec3>, vnext: U32}

# One face into the body list; a band gets its seam edge (id `next`) and the
# loop rim0, seam, rim1, seam reversed.
def bf.add(band: Band, +body: U32, +shell: U32, sense: Bool, s: OSurf, tag: U32, loops: List<&2, LoopOut>, +vid: U.Tab<&2, U32>, +de: Nat, st: BF) -> BF:
  match band:
    case NoBand{}:
      BF{fs, seams, next, nl, w, pv, vn} = st
      +ls = loops
      BF{FOut{body, shell, sense, s, tag, ls} <> fs, seams, next, (nl + U.count(LoopOut, ls, 0) : U32), w, pv, vn}
    case Band{+e0, f0, +e1, f1, c, ranged, first, last}:
      BF{fs, seams, +next, nl, w, pv, vn} = st
      +bl = {[LoopOut{True{}, [T.Use{e0, f0}, T.Use{next, True{}}, T.Use{e1, f1}, T.Use{next, False{}}]}] : List<&2, LoopOut>}
      BF{FOut{body, shell, sense, s, tag, bl} <> fs, EOut{U.tab.get(U32, vid, de, e0), U.tab.get(U32, vid, de, e1), c, True{}, 0.0, 0.0, ranged, first, last} <> seams,
        (next + 1 : U32), (nl + 1 : U32), w, pv, vn}
    case Ring{lat, mer, v}:
      BF{fs, seams, +next, nl, w, pv, +vn} = st
      +bl = {[LoopOut{True{}, [T.Use{next, True{}}, T.Use{(next + 1 : U32), True{}}, T.Use{next, False{}}, T.Use{(next + 1 : U32), False{}}]}] : List<&2, LoopOut>}
      BF{FOut{body, shell, sense, s, tag, bl} <> fs, EOut{vn, vn, mer, True{}, 0.0, 0.0, False{}, S.rf(0.0), S.rf(0.0)} <> EOut{vn, vn, lat, True{}, 0.0, 0.0, False{}, S.rf(0.0), S.rf(0.0)} <> seams,
        (next + 2 : U32), (nl + 1 : U32), w, v <> pv, (vn + 1 : U32)}
    case Full{c, first, last, south, north}:
      BF{fs, seams, +next, nl, w, pv, +vn} = st
      +bl = {[LoopOut{True{}, [T.Use{next, True{}}, T.Use{next, False{}}]}] : List<&2, LoopOut>}
      BF{FOut{body, shell, sense, s, tag, bl} <> fs, EOut{vn, (vn + 1 : U32), c, True{}, 0.0, 0.0, True{}, first, last} <> seams,
        (next + 1 : U32), (nl + 1 : U32), w, north <> south <> pv, (vn + 2 : U32)}

def owner(+own: U.Tab<&2, U32>, +dt: Nat, +c: U32) -> U32:
  +o = U.tab.get(U32, own, dt, c)
  Bool.pick(U32, U32.is_eq(o, none()), c, o)

# Faces carry their body (the outer shell's component) and their shell.
def bf.go(fos: List<&2, FaceOut>, +vid: U.Tab<&2, U32>, +de: Nat, +comp: U.Tab<&2, U32>, +own: U.Tab<&2, U32>, +dt: Nat, st: BF) -> BF:
  match fos:
    case Nil{}:
      st
    case FaceOut{_, p, sense, s, tag, loops, band} <> t:
      +c = U.tab.get(U32, comp, dt, p)
      bf.go(t, vid, de, comp, own, dt, bf.add(band, owner(own, dt, c), c, sense, s, tag, loops, vid, de, st))

def run.pq(r: Run) -> U.Q:
  Run{p, q, _, _, _, _, _, _, _} = r
  U.Q{p, q, 0, 0}

def comp.pairs(er: List<&2, U32>, +runs: U.Tab<&2, Run>, +dr: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match er:
    case Nil{}:
      acc
    case rid <> t:
      comp.pairs(t, runs, dr, run.pq(U.tab.get(Run, runs, dr, rid)) <> acc)

def vol.go(tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, st: Array<F32> & F32) -> Array<F32>:
  match tis:
    case Nil{}:
      (arr, _) = st
      arr
    case TI{t, _, _, _, _, v} <> rest:
      (arr, _) = st
      +idx = U.tab.get(U32, comp, dt, U.tab.get(U32, root, dt, t))
      vol.go(rest, ctx, root, comp, dt, Array.atomic.fadd(arr, idx, v))

def comp.keys(fs: List<&2, FaceOut>, +comp: U.Tab<&2, U32>, +dt: Nat, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match fs:
    case Nil{}:
      acc
    case FaceOut{_, p, _, _, _, _, _} <> t:
      comp.keys(t, comp, dt, U.Q{U.tab.get(U32, comp, dt, p), 0, 0, 0} <> acc)

def dedupe.go(xs: List<&2, U.Q>, +last: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      U.rev(U32, acc)
    case U.Q{+k, _, _, _} <> t:
      +acc2 = acc
      dedupe.go(t, k, Bool.pick(List<&2, U32>, U32.is_eq(k, last), acc2, k <> acc2))

def positives(cs: List<&2, U32>, +vol: U.Tab<&2, F32>, +dt: Nat, acc: U32) -> U32:
  match cs:
    case Nil{}:
      acc
    case c <> t:
      positives(t, vol, dt, (acc + b2u((U.tab.get(F32, vol, dt, c) > 0.0 : F32)) : U32))

# Inner void shells (components of negative signed volume) belong to the
# outer shell that contains them: the generalized winding number of each
# positive component around a vertex of the void (sum of the triangles'
# solid angles / 4 pi, Van Oosterom-Strackee) must be 1 for exactly one of
# them (0 outside; a touching void gives 1/2 and is refused).
def solid_angle(+p: G.Vec3, pa: G.Vec3, pb: G.Vec3, pc: G.Vec3) -> F32:
  +a = G.sub(pa, p)
  +b = G.sub(pb, p)
  +c = G.sub(pc, p)
  +la = S.vlen(a)
  +lb = S.vlen(b)
  +lc = S.vlen(c)
  +den = R.add(R.add(R.mul(R.mul(la, lb), lc), R.mul(G.dot(a, b), lc)), R.add(R.mul(G.dot(a, c), lb), R.mul(G.dot(b, c), la)))
  (2.0 * F32.atan2(R.approx(G.dot(a, G.cross(b, c))), R.approx(den)) : F32)

def wn.go(tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, +p: G.Vec3, st: Array<F32> & F32) -> Array<F32>:
  match tis:
    case Nil{}:
      (arr, _) = st
      arr
    case TI{t, a, b, c, _, _} <> rest:
      (arr, _) = st
      +idx = U.tab.get(U32, comp, dt, U.tab.get(U32, root, dt, t))
      wn.go(rest, ctx, root, comp, dt, p, Array.atomic.fadd(arr, idx, solid_angle(p, ctx.pos(ctx, a), ctx.pos(ctx, b), ctx.pos(ctx, c))))

def vpoint.go(tis: List<&2, TI>, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, +c: U32, +acc: U32) -> U32:
  match tis:
    case Nil{}:
      acc
    case TI{t, a, _, _, _, _} <> rest:
      +hit = Bool.and(U32.is_eq(acc, none()), U32.is_eq(U.tab.get(U32, comp, dt, U.tab.get(U32, root, dt, t)), c))
      vpoint.go(rest, root, comp, dt, c, Bool.pick(U32, hit, a, acc))

type Own is Data:
  Own{c: U32, n: U32}

def own.go(cs: List<&2, U32>, +vol: U.Tab<&2, F32>, +win: U.Tab<&2, F32>, +dt: Nat, st: Own) -> Own:
  match cs:
    case Nil{}:
      st
    case +c <> t:
      Own{+o, +n} = st
      +w = (U.tab.get(F32, win, dt, c) / (4.0 * F32.pi() : F32) : F32)
      +hit = Bool.and((U.tab.get(F32, vol, dt, c) > 0.0 : F32), (F32.abs((w - 1.0 : F32)) < 0.25 : F32))
      own.go(t, vol, win, dt, Own{Bool.pick(U32, hit, c, o), (n + b2u(hit) : U32)})

type VO is Data:
  VO{pairs: List<&2, U.Q>, why: Why}

def void.k(o: Own, +v: U32, +vv: F32, st: VO) -> VO:
  Own{+c, +n} = o
  VO{ps, w} = st
  VO{U.Q{v, c, 0, 0} <> ps, why.or(w, why.if(U32.is_ne(n, 1), "inner void shell (signed volume " ++ f32s(vv) ++ " mm3) lies inside " ++ U32.show(n) ++ " outer shells (winding-number test)"))}

def void.one(+v: U32, +tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, +cids: List<&2, U32>, +vol: U.Tab<&2, F32>, st: VO) -> VO:
  +p = ctx.pos(ctx, vpoint.go(tis, root, comp, dt, v, none()))
  win = wn.go(tis, ctx, root, comp, dt, p, Array.atomic.fadd(Array.new(F32, dt, 0.0), 0, 0.0))
  +winT = U.tab.of(F32, arr.list(win, Nil{}), dt, 0.0)
  void.k(own.go(cids, vol, winT, dt, Own{none(), 0}), v, U.tab.get(F32, vol, dt, v), st)

# A solid shell (positive volume) must lie outside every other shell: the
# summed winding number of the other components around one of its vertices
# is 0 (a shell inside a void inside a solid sums to 1 - 1 = 0). Nested
# solid shells mean overlapping bodies: refused.
def wsum(cs: List<&2, U32>, +win: U.Tab<&2, F32>, +dt: Nat, +own: U32, +acc: F32) -> F32:
  match cs:
    case Nil{}:
      acc
    case +c <> t:
      wsum(t, win, dt, own, Bool.pick(F32, U32.is_eq(c, own), acc, (acc + U.tab.get(F32, win, dt, c) : F32)))

def solid.k(+w: F32, +vv: F32, st: VO) -> VO:
  VO{ps, wy} = st
  VO{ps, why.or(wy, why.if((F32.abs(w) > 0.25 : F32), "solid shell (signed volume " ++ f32s(vv) ++ " mm3) lies inside other shells (winding number " ++ f32s(w) ++ "): overlapping bodies"))}

def solid.one(+v: U32, +tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, +cids: List<&2, U32>, +vol: U.Tab<&2, F32>, st: VO) -> VO:
  +p = ctx.pos(ctx, vpoint.go(tis, root, comp, dt, v, none()))
  win = wn.go(tis, ctx, root, comp, dt, p, Array.atomic.fadd(Array.new(F32, dt, 0.0), 0, 0.0))
  +winT = U.tab.of(F32, arr.list(win, Nil{}), dt, 0.0)
  solid.k((wsum(cids, winT, dt, v, 0.0) / (4.0 * F32.pi() : F32) : F32), U.tab.get(F32, vol, dt, v), st)

# Only components of nonpositive volume pay for the void test, and solid
# components only when there is more than one component (a match, not
# Bool.pick, which would evaluate both branches).
def void.if(neg: Bool, multi: Bool, +c: U32, +tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, +cids: List<&2, U32>, +vol: U.Tab<&2, F32>, st: VO) -> VO:
  match neg multi:
    case True{} _:
      void.one(c, tis, ctx, root, comp, dt, cids, vol, st)
    case False{} True{}:
      solid.one(c, tis, ctx, root, comp, dt, cids, vol, st)
    case False{} False{}:
      st

def voids.go(cs: List<&2, U32>, +multi: Bool, +tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +comp: U.Tab<&2, U32>, +dt: Nat, +cids: List<&2, U32>, +vol: U.Tab<&2, F32>, st: VO) -> VO:
  match cs:
    case Nil{}:
      st
    case +c <> t:
      voids.go(t, multi, tis, ctx, root, comp, dt, cids, vol, void.if((U.tab.get(F32, vol, dt, c) <= 0.0 : F32), multi, c, tis, ctx, root, comp, dt, cids, vol, st))

def loops.count(fs: List<&2, FOut>, acc: U32) -> U32:
  match fs:
    case Nil{}:
      acc
    case FOut{_, _, _, _, _, ls} <> t:
      loops.count(t, (acc + U.count(LoopOut, ls, 0) : U32))

# ---------------------------------------------------------------------------
# Driver: every stage matches the verdict of the previous one, so a refusal
# stops the pipeline with its reason.

type E1 is Data:
  E1{ctx: Ctx, nt: U32, nv: U32, dt: Nat, fk: U.Tab<&2, U32>, tis: List<&2, TI>, tagres: F32}

def e1.dv(+e: E1) -> Nat:
  E1{c, _, _, _, _, _, _} = e
  ctx.dv(c)

type E2 is Data:
  E2{bhs: List<&2, U.Q>, root: U.Tab<&2, U32>, nvused: U32, npatch: U32, cs: CS, nc: U32, dc: Nat, cpos: U.Tab<&2, G.Vec3>, vk: U.Tab<&2, VKind>, slivers: U32}

def count.roots(rs: List<&2, U32>, +t: U32, acc: U32) -> U32:
  match rs:
    case Nil{}:
      acc
    case r <> rest:
      count.roots(rest, (t + 1 : U32), (acc + b2u(U32.is_eq(r, t)) : U32))

def brep.of(cst: CS, sv: SV, bf: BF, +nt: U32, +tagres: F32, +nvused: U32, +npatch: U32, +nc: U32, +nb: U32, +nsl: U32) -> Out:
  CS{ps, drift, dratio, cres, det, _, _} = cst
  SV{es, vs, _, _, _, nclosed, maxd, ratio} = sv
  BF{fs, seams, _, nl, _, pv, _} = bf
  +sm = seams
  BOk{Brep{List.append(&2, G.Vec3, U.rev(G.Vec3, ps), List.append(&2, G.Vec3, U.rev(G.Vec3, vs), U.rev(G.Vec3, pv))), List.append(&2, EOut, U.rev(EOut, es), U.rev(EOut, sm)), U.rev(FOut, fs),
    Stats{nt, nvused, npatch, nc, nclosed, U.count(EOut, sm, 0), nl, nb, maxd, ratio, drift, dratio, cres, tagres, det, nsl}}}

def sv.vid(s: SV) -> List<&2, U32>:
  SV{_, _, v, _, _, _, _, _} = s
  v

def sv.sp(s: SV) -> List<&2, G.Vec3>:
  SV{_, _, _, v, _, _, _, _} = s
  v

def sv.next(s: SV) -> U32:
  SV{_, _, _, _, v, _, _, _} = s
  v

def bf.fs(s: BF) -> List<&2, FOut>:
  BF{v, _, _, _, _, _, _} = s
  v

def bf.next(s: BF) -> U32:
  BF{_, _, v, _, _, _, _} = s
  v

def bf.loops(s: BF) -> U32:
  BF{_, _, _, v, _, _, _} = s
  v

def bf.why(s: BF) -> Why:
  BF{_, _, _, _, v, _, _} = s
  v

def bf.vnext(s: BF) -> U32:
  BF{_, _, _, _, _, _, v} = s
  v

# Every check passed; an ill-conditioned corner (CS.ill) still refuses the
# exact recovery.
def st.final.ill(ill: Why, cst: CS, sv: SV, bf: BF, +nt: U32, +tagres: F32, +nvused: U32, +npatch: U32, +nc: U32, +nb: U32, +nsl: U32) -> Out:
  match ill:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      brep.of(cst, sv, bf, nt, tagres, nvused, npatch, nc, nb, nsl)

def st.final(w: Ref, +e1: E1, +e2: E2, +sv: SV, +bf: BF, +nbodies: U32) -> Out:
  match w:
    case RGeom{r}:
      BNo{r}
    case RCert{r}:
      BCert{r}
    case RFine{}:
      E1{_, nt, _, _, _, _, tagres} = e1
      E2{_, _, nvused, npatch, +cst, nc, _, _, _, nsl} = e2
      st.final.ill(cs.ill(cst), cst, sv, bf, nt, tagres, nvused, npatch, nc, nbodies, nsl)

# Euler characteristic of the recovered cell complex (V - E + 2F - L, faces
# with holes counted by their loops) against the mesh (V - T/2), doubled.
def euler.why(+vb: U32, +eb: U32, +fb: U32, +lb: U32, +vm: U32, +tm: U32) -> Why:
  +lhs = ((((2 * vb : U32) + (4 * fb : U32) : U32) + tm : U32))
  +rhs = ((((2 * eb : U32) + (2 * lb : U32) : U32) + (2 * vm : U32) : U32))
  why.if(U32.is_ne(lhs, rhs), "recovered topology differs from the mesh (Euler: 2V-2E+4F-2L = " ++ U32.show(lhs) ++ " - " ++ U32.show(rhs) ++ " vs 2V-T of the mesh)")

def vo.pairs(v: VO) -> List<&2, U.Q>:
  VO{p, _} = v
  p

def vo.why(v: VO) -> Why:
  VO{_, w} = v
  w

# Clearance (clear.bend): patches that share no mesh vertex must stay apart
# by more than the sum of their triangles' distance bounds h, or their exact
# faces may touch or cross. h is the deviation on curved carriers and the
# measured vertex residual on planes (a planar triangle lies in its plane).
def clr.pd(+o: G.Vec3, +n: G.Vec3, +p: G.Vec3) -> F32:
  F32.abs(R.approx(G.dot(G.sub(p, o), n)))

def clr.h(s: S.Surf, +pa: G.Vec3, +pb: G.Vec3, +pc: G.Vec3, +dev: F32) -> F32:
  match s:
    case S.SPlane{+o, +n, _}:
      (F32.max(clr.pd(o, n, pa), F32.max(clr.pd(o, n, pb), clr.pd(o, n, pc))) * 1.001 : F32)
    case _:
      dev

def clr.item(+p: U32, +a: U32, +b: U32, +c: U32, +pa: G.Vec3, +pb: G.Vec3, +pc: G.Vec3, s: S.Surf, +dev: F32) -> C.CT:
  C.ct.of(p, a, b, c, pa, pb, pc, clr.h(s, pa, pb, pc, dev))

def clr.items(tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +fk: U.Tab<&2, U32>, +dt: Nat, +dev: F32, acc: List<&2, C.CT>) -> List<&2, C.CT>:
  match tis:
    case Nil{}:
      acc
    case TI{+t, +a, +b, +c, _, _} <> rest:
      clr.items(rest, ctx, root, fk, dt, dev, clr.item(U.tab.get(U32, root, dt, t), a, b, c, ctx.pos(ctx, a), ctx.pos(ctx, b), ctx.pos(ctx, c), class_surf(ctx, fk, dt, t), dev) <> acc)

def clr.related(gs: List<&2, VG>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match gs:
    case Nil{}:
      acc
    case VG{_, ps, _} <> t:
      clr.related(t, C.rel.all(ps, acc))

def clr.why(r: C.Clr, +ctx: Ctx, +fk: U.Tab<&2, U32>, +dt: Nat) -> Why:
  C.Clr{hit, +p, +q, +d, +n} = r
  why.if(hit, "faces on a " ++ S.kind_name(S.kind(class_surf(ctx, fk, dt, p))) ++ " and a " ++ S.kind_name(S.kind(class_surf(ctx, fk, dt, q)))
    ++ " carrier come within " ++ f32s(d) ++ " mm without sharing an edge or a vertex (" ++ U32.show(n)
    ++ " close triangle pairs; clearance = deviation per curved side + plane residuals + 1e-6 mm): the mesh does not certify their topology")

def clr.check(+tis: List<&2, TI>, +ctx: Ctx, +root: U.Tab<&2, U32>, +fk: U.Tab<&2, U32>, +dt: Nat, +nt: U32, +bhs: List<&2, U.Q>) -> Why:
  +vgs = vg.start(U.bsort(vp.bh(bhs, Nil{}), ctx.dv(ctx)))
  clr.why(C.check(clr.items(tis, ctx, root, fk, dt, R.approx(ctx.dev(ctx)), Nil{}), nt, clr.related(vgs, Nil{})), ctx, fk, dt)

def st.assemble(+e1: E1, +e2: E2, +er: List<&2, U32>, +ne: U32, +runT: U.Tab<&2, Run>, +dr: Nat, +eos: List<&2, EdgeOut>, +fos: List<&2, FaceOut>) -> Out:
  E1{+ctx, +nt, _, +dt, +fk, +tis, _} = e1
  E2{+bhs, +root, +nvused, _, _, +nc, _, _, _, _} = e2
  +sv = sv.go(eos, SV{Nil{}, Nil{}, Nil{}, Nil{}, nc, 0, 0.0, 0.0})
  +de = U.depth(ne)
  +vidT = U.tab.of(U32, U.rev(U32, sv.vid(sv)), de, none())
  +comps = uf.components(comp.pairs(er, runT, dr, Nil{}), nt, dt)
  +compT = U.tab.of(U32, comps, dt, 0)
  vol = vol.go(tis, ctx, root, compT, dt, Array.atomic.fadd(Array.new(F32, dt, 0.0), 0, 0.0))
  +volT = U.tab.of(F32, arr.list(vol, Nil{}), dt, 0.0)
  +cids = dedupe.go(U.sort(comp.keys(fos, compT, dt, Nil{})), none(), Nil{})
  +vo = voids.go(cids, (U.count(U32, cids, 0) > 1 : U32), tis, ctx, root, compT, dt, cids, volT, VO{Nil{}, Fine{}})
  +ownT = U.tab.of(U32, arr.u32s(relab.fill(vo.pairs(vo), Array.new(U32, dt, none())), Nil{}), dt, none())
  +bf = bf.go(fos, vidT, de, compT, ownT, dt, BF{Nil{}, Nil{}, ne, 0, Fine{}, Nil{}, sv.next(sv)})
  +nbodies = positives(cids, volT, dt, 0)
  +vb = bf.vnext(bf)
  +eb = bf.next(bf)
  +fb = U.count(FaceOut, fos, 0)
  +lb = bf.loops(bf)
  st.final(ref.geom(bf.why(bf), ref.cert(vo.why(vo), ref.geom(euler.why(vb, eb, fb, lb, nvused, nt), ref.cert(clr.check(tis, ctx, root, fk, dt, nt, bhs), RFine{})))), e1, e2, sv, bf, nbodies)

def cs.ps(s: CS) -> List<&2, G.Vec3>:
  CS{v, _, _, _, _, _, _} = s
  v

def cs.why(s: CS) -> Why:
  CS{_, _, _, _, _, v, _} = s
  v

def dummy_run() -> Run:
  Run{0, 0, False{}, 0, 0, Nil{}, 0, 0, False{}}

def st.faces.k(w: Why, +fos: List<&2, FaceOut>, +eos: List<&2, EdgeOut>, +er: List<&2, U32>, +ne: U32, +runT: U.Tab<&2, Run>, +dr: Nat, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      st.assemble(e1, e2, er, ne, runT, dr, eos, fos)

def st.faces(w: Why, +eos: List<&2, EdgeOut>, +er: List<&2, U32>, +ne: U32, +runT: U.Tab<&2, Run>, +reT: U.Tab<&2, U32>, +dr: Nat, +lrs: List<&2, LR>, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E1{+ctx, +nt, _, +dt, +fk, _, _} = e1
      E2{_, +root, _, +npatch, _, _, +dc, +cpos, _, _} = e2
      +de = U.depth(ne)
      +eT = U.tab.of(EdgeOut, eos, de, dummy_edge())
      +gs = fg.start(U.bsort(lr.keys(lrs, 0, Nil{}), dt))
      +all = fg.all((U.count(FG, gs, 0) < npatch : U32), gs, nt, root, dt)
      +fos = faces.go(all, ctx, fk, dt, reT, runT, dr, eT, de, cpos, dc)
      st.faces.k(face.why(fos, Fine{}), fos, eos, er, ne, runT, dr, e1, e2)

def st.edges(w: Why, +rel: List<&2, U32>, +er: List<&2, U32>, +ne: U32, +runs: List<&2, Run>, +lrs: List<&2, LR>, +nr: U32, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E1{+ctx, _, _, +dt, +fk, _, _} = e1
      E2{_, _, _, _, _, _, +dc, +cpos, _, _} = e2
      +dr = U.depth(nr)
      +runT = U.tab.of(Run, runs, dr, dummy_run())
      +reT = U.tab.of(U32, rel, dr, 0)
      +eos = edges.go(er, runT, dr, ctx, fk, dt, cpos, dc)
      st.faces(edge.why(eos, Fine{}), eos, er, ne, runT, reT, dr, lrs, e1, e2)

def st.match.k(w: Why, z: ZO, +runs: List<&2, Run>, +lrs: List<&2, LR>, +nr: U32, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      ZO{re, +er, +ne, +bad} = z
      +rel = q.k2s(U.bsort(re, U.depth(nr)), Nil{})
      st.edges(why.if(Bool.or((bad > 0 : U32), U32.is_ne(U.count(U32, rel, 0), nr)), "boundary runs do not pair into edges"), rel, er, ne, runs, lrs, nr, e1, e2)

def st.match(m: MT, +runs: List<&2, Run>, +lrs: List<&2, LR>, +nr: U32, +e1: E1, +e2: E2) -> Out:
  MT{cs, ts, +bad} = m
  st.match.k(why.if((bad > 0 : U32), "a boundary run changes its neighbouring patch between corners"), zip.go(U.bsort(cs, e1.dv(e1)), U.bsort(ts, e1.dv(e1)), 0, Nil{}, Nil{}, 0), runs, lrs, nr, e1, e2)

def st.runs(rl: RL, +e1: E1, +e2: E2) -> Out:
  RL{rr, lr, +nr} = rl
  +runs = U.rev(Run, rr)
  st.match(mt.go(runs, 0, MT{Nil{}, Nil{}, 0}), runs, U.rev(LR, lr), nr, e1, e2)

def st.loops(w: Why, +nexts: List<&2, U32>, +recs: List<&2, U.Q>, +nb: U32, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E1{+ctx, _, _, _, _, _, _} = e1
      E2{_, _, _, _, _, _, _, _, +vk, _} = e2
      +db = U.depth(nb)
      +nx = U.tab.of(U32, nexts, db, 0)
      +bhT = U.tab.of(U.Q, recs, db, U.Q{0, 0, 0, 0})
      +fuel = U32.to_nat(nb)
      +ls = loops.go(fuel, 0, {(Array.new(U.Seen, db, U.Fresh{}), Nil{}) : Array<U.Seen> & List<&2, U32>}, nx, db, fuel, Nil{})
      st.runs(loops.runs(ls, bhT, db, vk, ctx.dv(ctx), RL{Nil{}, Nil{}, 0}), e1, e2)

def st.bh.k(w: Why, js: JS, +recs: List<&2, U.Q>, +nb: U32, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      JS{_, _, acc, +bad} = js
      +nexts = q.k2s(U.bsort(acc, U.depth(nb)), Nil{})
      st.loops(why.if(Bool.or((bad > 0 : U32), U32.is_ne(U.count(U32, nexts, 0), nb)), "the patch boundaries do not close into loops"), nexts, recs, nb, e1, e2)

def st.bh(b: BHs, +e1: E1, +e2: E2) -> Out:
  BHs{+l1, +l2, +recs, +nb, +pinch} = b
  st.bh.k(why.if((pinch > 0 : U32), "a patch boundary pinches at a vertex (" ++ U32.show(pinch) ++ " times)"), join.go(U32.to_nat((nb * 2 : U32)), JS{l1, U.bsort(l2, e1.dv(e1)), Nil{}, 0}), recs, nb, e1, e2)

def st.corners(w: Why, +e1: E1, +e2: E2) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E2{+bhs, _, _, _, _, _, _, _, _, _} = e2
      st.bh(bh.index(U.bsort(bhs, e1.dv(e1)), 0, none(), none(), Nil{}, Nil{}, Nil{}, 0), e1, e2)

def st.patches(+fk: U.Tab<&2, U32>, +roots: List<&2, U32>, +nsl: U32, +cross: List<&2, U.Q>, +e0: E1) -> Out:
  E1{+ctx, +nt, +nv, +dt, _, +tis, +res} = e0
  +e1 = {E1{ctx, nt, nv, dt, fk, tis, res} : E1}
  +root = U.tab.of(U32, roots, dt, 0)
  +bhs = bh.go(cross, root, dt, Nil{})
  +vgs = vg.start(U.bsort(vp.bh(bhs, Nil{}), ctx.dv(ctx)))
  +cs = corners.go(corners.filter(vgs, Nil{}), ctx, fk, dt)
  +nc = U.count(CornerOut, cs, 0)
  +dc = U.depth(nc)
  +cst = corner.fold(cs, CS{Nil{}, 0.0, 0.0, 0.0, 1000.0, Fine{}, Fine{}})
  +cpos = U.tab.of(G.Vec3, U.rev(G.Vec3, cs.ps(cst)), dc, S.zero3())
  +vk = U.tab.of(VKind, vkind.go(U32.to_nat(nv), 0, cs, 0, Nil{}), ctx.dv(ctx), VPlain{})
  +nused = arr.sum(used.go(tis, Array.new(U32, ctx.dv(ctx), 0)))
  st.corners(cs.why(cst), e1, E2{bhs, root, nused, count.roots(roots, 0, 0), cst, nc, dc, cpos, vk, nsl})

def st.twins.fr.k(w: Why, +fk: U.Tab<&2, U32>, +roots: List<&2, U32>, +nsl: U32, +cross: List<&2, U.Q>, +e0: E1) -> Out:
  match w:
    case Why{r}:
      BNo{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      st.patches(fk, roots, nsl, cross, e0)

def st.twins.fr(fr: FR, +cross: List<&2, U.Q>, +e0: E1) -> Out:
  FR{+fk, +roots, +nsl, w} = fr
  st.twins.fr.k(w, fk, roots, nsl, cross, e0)

# (only when the first pass absorbed something)
def sl.again.k(any: Bool, +fk1: U.Tab<&2, U32>, +roots1: List<&2, U32>, +n1: U32, +w1: Why, +cross: List<&2, U.Q>, +unions: List<&2, U.Q>, +tis: List<&2, TI>, +ctx: Ctx, +nt: U32, +dt: Nat) -> FR:
  match any:
    case False{}:
      FR{fk1, roots1, n1, w1}
    case True{}:
      +root1 = U.tab.of(U32, roots1, dt, 0)
      sl.addn(n1, w1, sl.redo(sliver.find(tis, ctx, root1, bh.go(cross, root1, dt, Nil{}), fk1, dt, nt), cross, unions, tis, fk1, root1, roots1, nt, dt))

def sl.again(fr: FR, +cross: List<&2, U.Q>, +unions: List<&2, U.Q>, +tis: List<&2, TI>, +ctx: Ctx, +nt: U32, +dt: Nat) -> FR:
  FR{+fk1, +roots1, +n1, +w1} = fr
  sl.again.k((n1 > 0 : U32), fk1, roots1, n1, w1, cross, unions, tis, ctx, nt, dt)

# Vertex links (defence in depth against point contact from any source): in
# a closed oriented edge-manifold mesh the triangle corners around a vertex
# form cycles, one per fan. Twin half-edges join the corners at both of their
# ends (corner id 3 t + k; half-edge 4 t + k starts at corner k and ends at
# corner k + 1 mod 3). The mesh is a 2-manifold at every vertex exactly when
# the number of corner cycles equals the number of used vertices; a vertex
# with two fans (two cubes touching at a corner, a cone apex on a face) is
# refused.
def c.start(+e: U32) -> U32:
  (((e >> 2n : U32) * 3 : U32) + U32.and(e, 3) : U32)

def c.end(+e: U32) -> U32:
  +k = U32.and(e, 3)
  (((e >> 2n : U32) * 3 : U32) + Bool.pick(U32, U32.is_eq(k, 2), 0, (k + 1 : U32)) : U32)

def link.go(xs: List<&2, U.Q>, acc: List<&2, U.Q>) -> List<&2, U.Q>:
  match xs:
    case Nil{}:
      acc
    case _ <> Nil{}:
      acc
    case U.Q{_, _, +e1, _} <> U.Q{_, _, +e2, _} <> rest:
      link.go(rest, U.Q{c.start(e1), c.end(e2), 0, 0} <> U.Q{c.end(e1), c.start(e2), 0, 0} <> acc)

def link.why(+tis: List<&2, TI>, hs: List<&2, U.Q>, +ctx: Ctx, +nt: U32) -> Why:
  +nc = (nt * 3 : U32)
  +cycles = count.roots(uf.components(link.go(hs, Nil{}), nc, U.depth(nc)), 0, 0)
  +nused = arr.sum(used.go(tis, Array.new(U32, ctx.dv(ctx), 0)))
  why.if(U32.is_ne(cycles, nused), "the Boolean mesh touches itself at a point: " ++ U32.show((cycles - nused : U32))
    ++ " extra vertex-link cycles over " ++ U32.show(nused) ++ " vertices (a vertex whose link is not one cycle, non-manifold contact)")

def st.twins.link(w: Why, +cross: List<&2, U.Q>, +unions: List<&2, U.Q>, +e1: E1) -> Out:
  match w:
    case Why{r}:
      BCert{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E1{+ctx, +nt, _, +dt, +fk0, +tis, _} = e1
      +roots0 = uf.components(unions, nt, dt)
      +root0 = U.tab.of(U32, roots0, dt, 0)
      +fr1 = sl.redo(sliver.find(tis, ctx, root0, bh.go(cross, root0, dt, Nil{}), fk0, dt, nt), cross, unions, tis, fk0, root0, roots0, nt, dt)
      st.twins.fr(sl.again(fr1, cross, unions, tis, ctx, nt, dt), cross, e1)

def st.twins.k(w: Why, +cross: List<&2, U.Q>, +unions: List<&2, U.Q>, +hs: List<&2, U.Q>, +e1: E1) -> Out:
  match w:
    case Why{r}:
      BCert{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E1{+ctx, +nt, _, _, _, +tis, _} = e1
      st.twins.link(link.why(tis, hs, ctx, nt), cross, unions, e1)

def st.twins(pw: PW, +hs: List<&2, U.Q>, +e1: E1) -> Out:
  PW{+cross, +unions, +bad} = pw
  E1{_, +nt, _, _, _, _, _} = e1
  +np = U.count(U.Q, cross, U.count(U.Q, unions, 0))
  st.twins.k(why.if(Bool.or((bad > 0 : U32), U32.is_ne((np * 2 : U32), (nt * 3 : U32))), "the Boolean mesh is not a closed oriented 2-manifold (" ++ U32.show(bad) ++ " bad edge groups)"), cross, unions, hs, e1)

def st.tri.k(w: Why, +e1: E1) -> Out:
  match w:
    case Why{r}:
      BCert{r}
    case Cert{r}:
      BCert{r}
    case Fine{}:
      E1{+ctx, _, _, _, _, +tis, _} = e1
      +hs = U.bsort(he.go(tis, Nil{}), ctx.dv(ctx))
      st.twins(pw.go(hs, Nil{}, Nil{}, 0), hs, e1)

def st.tri(p: TPass, +ctx: Ctx, +nt: U32, +nv: U32, +dups: U32) -> Out:
  TPass{+tis, +res, +flat, +bad} = p
  +dev = R.approx(ctx.dev(ctx))
  +w = why.or(why.if((bad > 0 : U32), "a triangle references a missing vertex or face tag"),
    why.or(why.if((dups > 0 : U32), U32.show(dups) ++ " pairs of distinct mesh vertices coincide: the Boolean mesh touches itself (non-manifold contact)"),
    why.or(why.if((flat > 0 : U32), U32.show(flat) ++ " triangles are not clearly oriented against their carrier"),
      why.if((res > ((dev * 1.000001 : F32) + 0.000000001 : F32) : F32), "a tagged triangle vertex lies " ++ f32s(res) ++ " mm off its carrier (deviation " ++ f32s(dev) ++ " mm)"))))
  +dt = U.depth(nt)
  st.tri.k(w, E1{ctx, nt, nv, dt, U.tab.of(U32, fk.list(tis, Nil{}), dt, 0), tis, res})

def st.start(empty: Bool, os: List<&2, TOne>, +ctx: Ctx, +nt: U32, +nv: U32, +dups: U32) -> Out:
  match empty:
    case True{}:
      BOk{empty_brep(0)}
    case False{}:
      st.tri(tri.pass(os), ctx, nt, nv, dups)

def dummy_surf() -> S.Surf:
  S.SSphere{S.zero3(), S.rf(1.0)}

# Three steps: prep (tables, carrier classes, coincident-vertex check, the
# balanced split of the triangles), map (per-triangle kernel, banged) and
# finish (all topology and geometry stages).
type Prep is Data:
  Prep{ctx: Ctx, work: U.Two<&2, TriI>, nt: U32, nv: U32, dups: U32}

def prep(job: M.Job, mesh: M.Mesh) -> Prep:
  M.Job{_, +dev, _, _, faces, _} = job
  M.Mesh{+vs, +ts} = mesh
  +nv = U.count(G.Vec3, vs, 0)
  +nt = U.count(M.Tri, ts, 0)
  +surfs = surfs.go(faces, Nil{})
  +nf = U.count(S.Surf, surfs, 0)
  +dv = U.depth(nv)
  +df = U.depth(nf)
  +ctx = {Ctx{U.tab.of(G.Vec3, vs, dv, S.zero3()), dv, nv, U.tab.of(S.Surf, surfs, df, dummy_surf()), df, nf, U.tab.of(U32, cls.go(surfs, nf), df, 0), dev} : Ctx}
  Prep{ctx, U.two(TriI, tri.idx(ts, 0, Nil{}), U32.to_nat(nt)), nt, nv, vdup.go(U.sort(vkey.go(vs, 0, Nil{})), ctx, 0)}

def prep.map(+p: Prep) -> List<&2, TOne>:
  Prep{ctx, work, _, _, _} = p
  tri.map(ctx, work)

def finish(+p: Prep, os: List<&2, TOne>) -> Out:
  Prep{ctx, _, +nt, nv, dups} = p
  st.start(U32.is_eq(nt, 0), os, ctx, nt, nv, dups)

# Recover the exact analytic B-rep of a tagged Boolean mesh.
def recover(job: M.Job, mesh: M.Mesh) -> Out:
  +p = prep(job, mesh)
  finish(p, prep.map(p))

def nbodies(s: Stats) -> U32:
  Stats{_, _, _, _, _, _, _, b, _, _, _, _, _, _, _, _} = s
  b
