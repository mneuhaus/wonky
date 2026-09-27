import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./big.bend as B
import ./geom.bend as E
import ./poly.bend as P
import ./setup.bend as S
import ./arrange.bend as A
import ./classify.bend as C
import ./assemble.bend as X
import ./finish.bend as F
import ./comps.bend as W
import ./psort.bend as Z
import ./device.bend as D

# Bake-off prototype "exact-plane": an exact plane-based mesh Boolean after
# EMBER (Trettner, Nehring-Wirxel, Kobbelt 2022) and Campen & Kobbelt 2010.
# See docs/proto-exact-plane.md for the algorithm, numeric model and limits.

# Per-triangle results: kept faces, counters, all pieces classified, piece
# count, and the free triangles (classified later per component).
type Res is Data:
  Res{fs: List<&2, X.KF>, st: P.St, ok: Bool, pieces: U32, free: List<&2, S.TriI>}

def res0() -> Res:
  Res{Nil{}, P.st0(), True{}, 0, Nil{}}

def res_merge(a: Res, b: Res) -> Res:
  Res{af, ast, aok, an, afr} = a
  Res{bf, bst, bok, bn, bfr} = b
  Res{M.rev_onto(X.KF, List.reverse(&2, X.KF, af), bf), P.st_add(ast, bst), Bool.and(aok, bok), (an + bn : U32), M.rev_onto(S.TriI, afr, bfr)}

# --- per triangle: arrangement, then classification of every piece ------------

def piece.k(c: C.Cls, +tag: U32, +p: P.Poly, acc: Res) -> Res:
  C.Cls{ok, keep, flip, st} = c
  Res{fs, _, aok, n, fr} = acc
  Res{W.keep_put(keep, tag, flip, p, fs), st, Bool.and(ok, aok), (n + 1 : U32), fr}

def pieces.go(ps: List<&2, P.Poly>, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg, acc: Res) -> Res:
  match ps:
    case Nil{}:
      acc
    case +p <> rest:
      Res{fs, st, ok, n, fr} = acc
      pieces.go(rest, t, bvh, tree, piece.k(C.classify(p, t, bvh, tree, st), A.tri_tag(t), p, Res{fs, P.st0(), ok, n, fr}))

# Pieces of one triangle are classified in parallel (a large face cut by many
# holes has thousands of pieces).
type PH is Data:
  PH{a: List<&2, P.Poly>, b: List<&2, P.Poly>}

def p_halve(xs: List<&2, P.Poly>, a: List<&2, P.Poly>, b: List<&2, P.Poly>) -> PH:
  match xs:
    case Nil{}:
      PH{a, b}
    case x <> Nil{}:
      PH{x <> a, b}
    case x <> y <> t:
      p_halve(t, x <> a, y <> b)

def pieces.par(d: Nat, h: PH, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg) -> Res:
  match d:
    case 0n:
      PH{a, b} = h
      pieces.go(b, t, bvh, tree, pieces.go(a, t, bvh, tree, res0()))
    case 1n+(+e):
      PH{a, b} = h
      x y = pieces.par(e, p_halve(a, Nil{}, Nil{}), t, bvh, tree) pieces.par(e, p_halve(b, Nil{}, Nil{}), t, bvh, tree)
      res_merge(x, y)

def res_st(r: Res, +st: P.St) -> Res:
  Res{fs, st0, ok, n, fr} = r
  Res{fs, P.st_add(st0, st), ok, n, fr}

# About 8 pieces per leaf task, at most 2^8 tasks per triangle.
def pieces_depth(+n: U32) -> Nat:
  U32.to_nat(U32.min(S.depth_of((n >> 3n : U32)), 8))

def tri.k(r: A.PS, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg, acc: Res) -> Res:
  A.PS{+ps, st} = r
  res_merge(res_st(pieces.par(pieces_depth(M.count(&2, P.Poly, ps)), p_halve(ps, Nil{}, Nil{}), t, bvh, tree), st), acc)

def tri.free(+t: S.TriI, +kst: P.St, acc: Res) -> Res:
  Res{fs, st, ok, n, fr} = acc
  Res{fs, P.st_add(st, kst), ok, (n + 1 : U32), t <> fr}

def tri.pick(free: Bool, +t: S.TriI, +cks: List<&2, A.CK>, +kst: P.St, +bvh: S.BVH, +tree: M.Csg, acc: Res) -> Res:
  match free:
    case True{}:
      tri.free(t, kst, acc)
    case False{}:
      tri.k(A.arrange_k(t, cks, kst), t, bvh, tree, acc)

def tri.kl(kl: A.KL, +t: S.TriI, +bvh: S.BVH, +tree: M.Csg, acc: Res) -> Res:
  A.KL{cks, apart, st} = kl
  tri.pick(apart, t, cks, st, bvh, tree, acc)

# The relation of every candidate to t's plane is computed once; a triangle
# whose candidates all lie strictly on one side of its plane (or that has no
# candidate) is free.
def tri.one(+t: S.TriI, +cs: List<&2, S.TriI>, +bvh: S.BVH, +tree: M.Csg, acc: Res) -> Res:
  tri.kl(A.kinds(cs, A.tri_s(t), A.KL{Nil{}, True{}, P.st0()}), t, bvh, tree, acc)

# --- interleaved halves (they keep the load of the fork trees even) --------------

type H is Data:
  H{a: List<&2, S.TriI>, b: List<&2, S.TriI>}

def halve(xs: List<&2, S.TriI>, a: List<&2, S.TriI>, b: List<&2, S.TriI>) -> H:
  match xs:
    case Nil{}:
      H{a, b}
    case x <> Nil{}:
      H{x <> a, b}
    case x <> y <> t:
      halve(t, x <> a, y <> b)

# Fork depth: about 32 triangles per leaf task, at most 2^12 tasks.
def fork_depth(+n: U32) -> Nat:
  U32.to_nat(U32.min(S.depth_of((n >> 5n : U32)), 12))

# --- accessors (used by tools) ---

def inp_tris(i: S.Input) -> List<&2, S.TriI>:
  S.Input{ts, _, _, _, _} = i
  ts

def inp_nv(i: S.Input) -> U32:
  S.Input{_, _, _, _, nv} = i
  nv

def res_fs(r: Res) -> List<&2, X.KF>:
  Res{fs, _, _, _, _} = r
  fs

def res_free(r: Res) -> List<&2, S.TriI>:
  Res{_, _, _, _, fr} = r
  fr

def fm_ts(f: X.FM) -> List<&2, X.TT>:
  X.FM{ts, _, _, _, _, _} = f
  ts

# --- entry points ------------------------------------------------------------------
#
# The outcome travels with its report: the predicate counters of all phases,
# the measured input quantization error and the measured export rounding
# displacement. show() prints the result text and then one deterministic
# info line after "end" (ignored by result parsers).

# dp, dd: candidate pairs tested by the device pair filter, and pairs it
# certified disjoint (dropped before the exact arrangement).
type Out is Data:
  Out{o: M.Outcome, st: P.St, qerr: F32, disp: F32, pieces: U32, dp: U32, dd: U32}

def out0(o: M.Outcome) -> Out:
  Out{o, P.st0(), 0.0, 0.0, 0, 0, 0}

def out_st(r: Out, +st: P.St) -> Out:
  Out{o, st0, q, d, n, dp, dd} = r
  Out{o, P.st_add(st0, st), q, d, n, dp, dd}

def out_q(r: Out, +q: F32, +n: U32) -> Out:
  Out{o, st, _, d, _, dp, dd} = r
  Out{o, st, q, d, n, dp, dd}

def out_dev(r: Out, +dp: U32, +dd: U32) -> Out:
  Out{o, st, q, d, n, _, _} = r
  Out{o, st, q, d, n, dp, dd}

def out_o(r: Out) -> M.Outcome:
  Out{o, _, _, _, _, _, _} = r
  o

def fin_ok(f: F.Fin) -> Bool:
  F.Fin{_, _, _, _, ok} = f
  ok

def fin_mesh(f: F.Fin) -> M.Mesh:
  F.Fin{mesh, _, _, _, _} = f
  mesh

# Nothing moved at export (no rounding collision, no dropped or flipped
# triangle): a failed closed-2-manifold check is then a property of the exact
# result itself.
def fin_exact(f: F.Fin, +coll: U32, +pinv: U32) -> Bool:
  F.Fin{_, _, +dropped, +inv, _} = f
  Bool.and(U32.is_eq(coll, 0), Bool.and(U32.is_eq(pinv, 0), Bool.and(U32.is_eq(dropped, 0), U32.is_eq(inv, 0))))

def fin_info(f: F.Fin, +coll: U32, +pinv: U32) -> String:
  F.Fin{_, _, dropped, inv, _} = f
  " (distinct exact points rounded onto one point: " ++ U32.show(coll) ++ ", triangles flipped by rounding: " ++ U32.show((pinv + inv : U32)) ++ ", collapsed triangles: " ++ U32.show(dropped) ++ ")"

def solve.fin.n(exact: Bool, +f: F.Fin, +coll: U32, +pinv: U32) -> M.Outcome:
  match exact:
    case True{}:
      M.Unresolved{"exact-plane: non-manifold contact: the exact regularized result is not a closed 2-manifold (its surface touches itself along a line or at a point); refused rather than perturbed"}
    case False{}:
      M.Unresolved{"exact-plane: rounding the exact result to the 2^-36 mm export grid would not give a closed, consistently oriented 2-manifold" ++ fin_info(f, coll, pinv)}

# The exact result, rounded once to the 2^-36 mm export grid, must pass the
# exact orientation and closed-2-manifold checks; no vertex is ever moved
# further than that rounding.
def solve.fin(ok: Bool, +f: F.Fin, +ups: List<&2, X.Pt>, +pinv: U32, +coll: U32) -> Out:
  match ok:
    case True{}:
      Out{M.Solved{fin_mesh(f)}, P.st0(), 0.0, X.max_disp(ups, 0.0), 0, 0, 0}
    case False{}:
      out0(solve.fin.n(fin_exact(f, coll, pinv), f, coll, pinv))

def solve.fm.k(noties: Bool, ok: Bool, +bad: U32, +ts: List<&2, X.TT>, +ups: List<&2, X.Pt>, +t: X.PB, +pinv: U32, +coll: U32) -> Out:
  match noties ok:
    case False{} _:
      out0(M.Unresolved{"exact-plane: T-junction vertices at the same exact position or unmatched corner after rounding (coincident + 65536 x unmatched = " ++ U32.show(bad) ++ ")"})
    case True{} False{}:
      out0(M.Unresolved{"exact-plane: rounding correction did not converge"})
    case True{} True{}:
      +f0 = F.finish(ups, ts)
      solve.fin(fin_ok(f0), f0, ups, pinv, coll)

def solve.fm(f: X.FM, +ups: List<&2, X.Pt>, +t: X.PB, +coll: U32) -> Out:
  X.FM{ts, st, +bad, _, ok, pinv} = f
  out_st(solve.fm.k(U32.is_eq(bad, 0), ok, bad, ts, ups, t, pinv, coll), st)

def assemble.u(+ups: List<&2, X.Pt>, +fs: List<&2, X.KF>, +coll: U32) -> Out:
  +t = X.pb(ups)
  solve.fm(X.frags.par(fork_depth(M.count(&2, X.KF, fs)), X.kf_halve(fs, Nil{}, Nil{}), t), ups, t, coll)

# coll: distinct exact points that round onto one output point (merged).
def assemble.k(u: X.Uniq, +fs: List<&2, X.KF>) -> Out:
  X.Uniq{ps, coll} = u
  assemble.u(X.number(List.reverse(&2, X.Pt, ps), 0, Nil{}), fs, coll)

def assemble(+fs: List<&2, X.KF>) -> Out:
  assemble.k(X.uniq(Z.psort(~X.Pt, ~X.pt_le, X.kf_pts(fs, Nil{}))), fs)

def solve.res.k(ok: Bool, good: Bool, fs: List<&2, X.KF>) -> Out:
  match ok good:
    case False{} _:
      out0(M.Unresolved{"exact-plane: no generic interior point for a piece (classification degenerate)"})
    case True{} False{}:
      out0(M.Unresolved{"exact-plane: degenerate construction"})
    case True{} True{}:
      assemble(fs)

def st_bads(st: P.St) -> U32:
  P.St{_, _, _, _, bad, _} = st
  bad

def solve.res.w(g: W.GS, fs: List<&2, X.KF>, st: P.St, ok: Bool) -> Out:
  W.GS{W.FR{gf, gst, gok}, _, _} = g
  +all = P.st_add(st, gst)
  out_st(solve.res.k(Bool.and(ok, gok), U32.is_eq(st_bads(all), 0), M.rev_onto(X.KF, gf, fs)), all)

def solve.res(r: Res, +n: U32, +nv: U32, +bvh: S.BVH, +tree: M.Csg) -> Out:
  Res{fs, st, ok, pieces, fr} = r
  out_q(solve.res.w(W.free_faces(fr, n, nv, bvh, tree), fs, st, ok), 0.0, pieces)


def out_qerr(r: Out, +q: F32) -> Out:
  Out{o, st, _, d, n, dp, dd} = r
  Out{o, st, q, d, n, dp, dd}

# --- the solve in three stages: pre (host), dev (device), post (host) ---------------
#
# pre: quantized plane-based input, BVH, and for every triangle its candidate
# list (boxes of other leaves' triangles that meet its box), in a balanced
# fork tree; the same tree carries the flat F32 jobs of the device pair filter
# (device.bend). dev: the pair filter as one `!` call. post: arrangement,
# classification, free components, assembly and checks, where pairs that the
# device certified disjoint are dropped first. The native driver puts an IO
# step between the stages (a device call that follows host forks in one
# evaluation would run on the CPU pool); solve() runs them back to back. With
# --gpu off the `!` runs on the CPU pool and on the JS target sequentially;
# every target computes the same bytes.

type TC is Data:
  TC{t: S.TriI, cs: List<&2, S.TriI>}

type TT is Data:
  TL{xs: List<&2, TC>}
  TN{l: TT, r: TT}

type PP is Data:
  PP{tt: TT, dt: D.DT}

def pre.go(ts: List<&2, S.TriI>, +bvh: S.BVH, tcs: List<&2, TC>, djs: List<&2, D.DJ>) -> PP:
  match ts:
    case Nil{}:
      PP{TL{List.reverse(&2, TC, tcs)}, D.DL{List.reverse(&2, D.DJ, djs)}}
    case +t <> rest:
      +cs = S.find_other(bvh, S.tri_box(t), A.tri_leaf(t))
      pre.go(rest, bvh, TC{t, cs} <> tcs, D.dj_of(t, cs) <> djs)

def pre.join(x: PP, y: PP) -> PP:
  PP{xt, xd} = x
  PP{yt, yd} = y
  PP{TN{xt, yt}, D.DN{xd, yd}}

def pre.par(d: Nat, h: H, +bvh: S.BVH) -> PP:
  match d:
    case 0n:
      H{a, b} = h
      pre.go(M.rev_onto(S.TriI, a, b), bvh, Nil{}, Nil{})
    case 1n+(+e):
      H{a, b} = h
      x y = pre.par(e, halve(a, Nil{}, Nil{}), bvh) pre.par(e, halve(b, Nil{}, Nil{}), bvh)
      pre.join(x, y)

type Pre is Data:
  PreDone{o: Out}
  PreGo{tt: TT, dt: D.DT, bvh: S.BVH, tree: M.Csg, n: U32, nv: U32, err: F32}

type Dev is Data:
  DevDone{o: Out}
  DevGo{tt: TT, fr: D.FR, bvh: S.BVH, tree: M.Csg, n: U32, nv: U32, err: F32}

def pre.go2(pp: PP, +bvh: S.BVH, +tree: M.Csg, +n: U32, +nv: U32, +err: F32) -> Pre:
  PP{tt, dt} = pp
  PreGo{tt, dt, bvh, tree, n, nv, err}

def pre.input.k(ok: Bool, nondeg: Bool, +ts: List<&2, S.TriI>, +n: U32, +nv: U32, +tree: M.Csg, +err: F32) -> Pre:
  match ok nondeg:
    case False{} _:
      PreDone{out_qerr(out0(M.Unresolved{"exact-plane: coordinates outside the +-1024 mm quantization box"}), err)}
    case True{} False{}:
      PreDone{out_qerr(out0(M.Unresolved{"exact-plane: triangle degenerate after quantization to 2^-24 mm"}), err)}
    case True{} True{}:
      +bvh = S.bvh(ts)
      pre.go2(pre.par(fork_depth(n), halve(ts, Nil{}, Nil{}), bvh), bvh, tree, n, nv, err)

def pre.input(inp: S.Input, +tree: M.Csg) -> Pre:
  S.Input{+ts, +n, +err, ok, +nv} = inp
  pre.input.k(ok, S.all_nondegenerate(ts, True{}), ts, n, nv, tree, err)

def parse(job: String) -> M.JobParse:
  MIO.parse_job(job)

# Stage 1 (host).
def pre(p: M.JobParse) -> Pre:
  match p:
    case M.Malformed{reason}:
      PreDone{out0(M.Unresolved{"malformed-job " ++ reason})}
    case M.Parsed{job}:
      M.Job{_, _, tree, _, _, meshes} = job
      pre.input(S.input(meshes), tree)

# Stage 2: the device pass (Metal with --gpu; the CPU pool with --gpu off).
def dev(p: Pre) -> Dev:
  match p:
    case PreDone{o}:
      DevDone{o}
    case PreGo{tt, dt, bvh, tree, n, nv, err}:
      DevGo{tt, D.dmap!(dt), bvh, tree, n, nv, err}

# Stage 3 (host): drop the certified-disjoint pairs, then the exact path.
def keep_code(c: U32, +b: S.TriI, acc: List<&2, S.TriI>) -> List<&2, S.TriI>:
  match c:
    case 0:
      b <> acc
    case _:
      acc

def kept(cs: List<&2, S.TriI>, fl: List<&2, U32>, acc: List<&2, S.TriI>) -> List<&2, S.TriI>:
  match cs fl:
    case +b <> ct c <> ft:
      kept(ct, ft, keep_code(c, b, acc))
    case _ _:
      List.reverse(&2, S.TriI, acc)

def post.go(xs: List<&2, TC>, fls: List<&2, List<&2, U32>>, +bvh: S.BVH, +tree: M.Csg, acc: Res) -> Res:
  match xs fls:
    case TC{+t, cs} <> xt fl <> ft:
      post.go(xt, ft, bvh, tree, tri.one(t, kept(cs, fl, Nil{}), bvh, tree, acc))
    case _ _:
      acc

# Same shape by construction; a mismatch is an internal error, reported as a
# bad construction (refusal), never skipped.
def post.par(t: TT, f: D.FR, +bvh: S.BVH, +tree: M.Csg) -> Res:
  match t f:
    case TL{xs} D.FL{fls, _, _}:
      post.go(xs, fls, bvh, tree, res0())
    case TN{l, r} D.FN{a, b}:
      x y = post.par(l, a, bvh, tree) post.par(r, b, bvh, tree)
      res_merge(x, y)
    case _ _:
      Res{Nil{}, P.st_bad(P.st0()), True{}, 0, Nil{}}

def fr_np(f: D.FR) -> U32:
  match f:
    case D.FL{_, np, _}:
      np
    case D.FN{a, b}:
      (fr_np(a) + fr_np(b) : U32)

def fr_nd(f: D.FR) -> U32:
  match f:
    case D.FL{_, _, nd}:
      nd
    case D.FN{a, b}:
      (fr_nd(a) + fr_nd(b) : U32)

def post(d: Dev) -> Out:
  match d:
    case DevDone{o}:
      o
    case DevGo{tt, +fr, +bvh, +tree, +n, +nv, +err}:
      out_dev(out_qerr(solve.res(post.par(tt, fr, bvh, tree), n, nv, bvh, tree), err), fr_np(fr), fr_nd(fr))

def solve(p: M.JobParse) -> Out:
  post(dev(pre(p)))

# A length in mm as whole femtometres (1e-12 mm), rounded up.
def fm_up(+x: F32) -> String:
  U32.show(F32.to_u32(F32.ceil((x * 1000000000000.0 : F32))))

def info(r: Out) -> String:
  Out{_, st, +q, +d, +n, +dp, +dd} = r
  P.St{f, e, z, m, b, sy} = st
  "exact-plane grid_mm 2^-24 export_grid_mm 2^-36 quantization_max_fm " ++ fm_up(q) ++ " export_rounding_max_fm " ++ fm_up(d) ++ " pieces " ++ U32.show(n) ++ " device_pairs " ++ U32.show(dp) ++ " device_disjoint " ++ U32.show(dd) ++ " predicates_filtered " ++ U32.show(f) ++ " exact_nonzero " ++ U32.show(e) ++ " exact_zero " ++ U32.show(z) ++ " symbolic_zero " ++ U32.show(sy) ++ " vertices_built " ++ U32.show(m) ++ "\n"

def show(+r: Out) -> String:
  MIO.show_outcome(out_o(r)) ++ info(r)

def run(job: String) -> String:
  show(solve(parse(job)))

# Checksums over the stage values (the native driver stamps the clock after
# them, so no stage leaks into the next one's time).
def dt_n(t: D.DT) -> U32:
  match t:
    case D.DL{xs}:
      (M.count(&2, D.DJ, xs) + 1 : U32)
    case D.DN{l, r}:
      (dt_n(l) + dt_n(r) : U32)

def pre_sum(p: Pre) -> U32:
  match p:
    case PreDone{_}:
      1
    case PreGo{_, dt, _, _, _, _, _}:
      dt_n(dt)

def dev_sum(d: Dev) -> U32:
  match d:
    case DevDone{_}:
      1
    case DevGo{_, fr, _, _, _, _, _}:
      (fr_np(fr) + 1 : U32)
