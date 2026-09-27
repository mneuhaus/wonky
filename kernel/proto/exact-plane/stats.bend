import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./big.bend as B
import ./geom.bend as E
import ./poly.bend as P
import ./setup.bend as S
import ./assemble.bend as X
import ./finish.bend as F
import ./comps.bend as W
import ./psort.bend as Z
import ./main.bend as Q
import ./device.bend as D

# Diagnostic driver of the exact-plane prototype (not used by the bake-off
# runner): runs the phases of main.solve one by one on a job file, times them
# with IO.now, and prints one JSON line with the predicate counters, the
# observed integer widths, the quantization error and the export outcome.
#
#   stats [--threads N] [--gpu off] -- <job-file>
#
# F32 values are printed as their IEEE bit patterns ("...Bits") and decoded by
# kernel/proto/exact-plane/tools/stats.mjs.

def stamp(forced: U32) -> IO(Nat):
  match forced:
    case 0:
      IO.now()
    case _:
      IO.now()

def ms(t1: Nat, t0: Nat) -> String:
  Nat.show(Nat.sub(t1, t0))

def q(k: String, v: String) -> String:
  "\"" ++ k ++ "\":" ++ v

def jb(b: Bool) -> String:
  match b:
    case True{}:
      "true"
    case False{}:
      "false"

def st_json(st: P.St) -> String:
  P.St{f, e, z, m, b, sy} = st
  "{" ++ q("filtered", U32.show(f)) ++ "," ++ q("exactNonzero", U32.show(e)) ++ "," ++ q("exactZero", U32.show(z)) ++ "," ++ q("constructed", U32.show(m)) ++ "," ++ q("bad", U32.show(b)) ++ "," ++ q("symbolicZero", U32.show(sy)) ++ "}"

def bvh_n(t: S.BVH) -> U32:
  match t:
    case S.BL{_, items}:
      (M.count(&2, S.TriI, items) + 1 : U32)
    case S.BN{_, l, r}:
      (bvh_n(l) + bvh_n(r) : U32)
    case S.BF{_, _, s}:
      bvh_n(s)

def pb_n(t: X.PB) -> U32:
  match t:
    case X.PL{_, ps}:
      (M.count(&2, X.Pt, ps) + 1 : U32)
    case X.PN{_, l, r}:
      (pb_n(l) + pb_n(r) : U32)

def res_n(r: Q.Res) -> U32:
  Q.Res{fs, _, _, n, fr} = r
  (M.count(&2, X.KF, fs) + n + M.count(&2, S.TriI, fr) : U32)

def pp_tt(p: Q.PP) -> Q.TT:
  Q.PP{t, _} = p
  t

def pp_dt(p: Q.PP) -> D.DT:
  Q.PP{_, d} = p
  d

def pp_n(p: Q.PP) -> U32:
  Q.PP{_, d} = p
  Q.dt_n(d)

def gs_n(g: W.GS) -> U32:
  W.GS{W.FR{fs, _, _}, n, m} = g
  (M.count(&2, X.KF, fs) + n + m : U32)

def gs_fs(g: W.GS) -> List<&2, X.KF>:
  W.GS{W.FR{fs, _, _}, _, _} = g
  fs

def fm_n(f: X.FM) -> U32:
  X.FM{ts, _, _, _, _, _} = f
  M.count(&2, X.TT, ts)

def fin_n(f: F.Fin) -> U32:
  F.Fin{m, _, _, _, _} = f
  M.Mesh{_, ts} = m
  M.count(&2, M.Tri, ts)

# --- observed integer widths (16-bit limbs) over the kept pieces ----------------

type WD is Data:
  WD{pn: U32, pd: U32, vx: U32, vw: U32}

def wd_plane(p: E.Plane, w: WD) -> WD:
  E.Plane{a, b, c, d, _, _, _, _, _} = p
  WD{pn, pd, vx, vw} = w
  WD{U32.max(pn, E.max3(B.nlimbs(a), B.nlimbs(b), B.nlimbs(c))), U32.max(pd, B.nlimbs(d)), vx, vw}

def wd_vtx(v: E.Vtx, w: WD) -> WD:
  E.Vtx{x, y, z, vw0, _, _, _, _, _, _, _} = v
  WD{pn, pd, vx, vw} = w
  WD{pn, pd, U32.max(vx, E.max3(B.nlimbs(x), B.nlimbs(y), B.nlimbs(z))), U32.max(vw, B.nlimbs(vw0))}

def wd_edges(es: List<&2, P.Edge>, w: WD) -> WD:
  match es:
    case Nil{}:
      w
    case P.Edge{p, v} <> t:
      wd_edges(t, wd_vtx(v, wd_plane(p, w)))

def wd_kfs(ks: List<&2, X.KF>, w: WD) -> WD:
  match ks:
    case Nil{}:
      w
    case X.KF{_, _, s, es, _} <> t:
      wd_kfs(t, wd_edges(es, wd_plane(s, w)))

def wd_json(w: WD) -> String:
  WD{pn, pd, vx, vw} = w
  "{" ++ q("planeNormal", U32.show((pn * 16 : U32))) ++ "," ++ q("planeOffset", U32.show((pd * 16 : U32))) ++ "," ++ q("vertexXYZ", U32.show((vx * 16 : U32))) ++ "," ++ q("vertexW", U32.show((vw * 16 : U32))) ++ "}"

# --- export levels (as main.solve tries them) --------------------------------------

def fin_json(f: F.Fin, +level: U32) -> String:
  F.Fin{m, merged, dropped, inv, ok} = f
  M.Mesh{vs, ts} = m
  q("level", U32.show(level)) ++ "," ++ q("ok", jb(ok)) ++ "," ++ q("outTris", U32.show(M.count(&2, M.Tri, ts))) ++ "," ++ q("outVerts", U32.show(M.count(&2, G.Vec3, vs))) ++ "," ++ q("merged", U32.show(merged)) ++ "," ++ q("dropped", U32.show(dropped)) ++ "," ++ q("flipped", U32.show(inv))

def fin_ok(f: F.Fin) -> Bool:
  F.Fin{_, _, _, _, ok} = f
  ok

def uniq_ps(u: X.Uniq) -> List<&2, X.Pt>:
  X.Uniq{ps, _} = u
  ps

def uniq_coll(u: X.Uniq) -> U32:
  X.Uniq{_, c} = u
  c

def fm_json(f: X.FM) -> String:
  X.FM{ts, st, bad, tj, ok, inv} = f
  "{" ++ q("tris", U32.show(M.count(&2, X.TT, ts))) ++ "," ++ q("tjunctions", U32.show(tj)) ++ "," ++ q("bad", U32.show(bad)) ++ "," ++ q("roundOk", jb(ok)) ++ "," ++ q("flippedAtRounding", U32.show(inv)) ++ "," ++ q("predicates", st_json(st)) ++ "}"

def res_json(r: Q.Res) -> String:
  Q.Res{fs, st, ok, n, fr} = r
  q("pieces", U32.show(n)) ++ "," ++ q("freeTris", U32.show(M.count(&2, S.TriI, fr))) ++ "," ++ q("keptCutPieces", U32.show(M.count(&2, X.KF, fs))) ++ "," ++ q("classified", jb(ok)) ++ "," ++ q("arrangement", st_json(st))

def gs_json(g: W.GS) -> String:
  W.GS{W.FR{fs, st, ok}, n, m} = g
  q("freeGroups", U32.show(n)) ++ "," ++ q("freeKept", U32.show(M.count(&2, X.KF, fs))) ++ "," ++ q("freeClassified", jb(ok)) ++ "," ++ q("freeRays", st_json(st))

def inp_err(i: S.Input) -> F32:
  S.Input{_, _, e, _, _} = i
  e

def inp_ok(i: S.Input) -> Bool:
  S.Input{_, _, _, ok, _} = i
  ok

def go(job: M.Job) -> IO(Unit):
  M.Job{id, _, +tree, _, _, meshes} = job
  do IO<Unit>:
    +t0 : Nat <- IO.now()
    +inp : S.Input = S.input(meshes)
    +ts : List<&2, S.TriI> = Q.inp_tris(inp)
    +n : U32 = M.count(&2, S.TriI, ts)
    +t1 : Nat <- stamp(n)
    +bvh : S.BVH = S.bvh(ts)
    +t2 : Nat <- stamp(bvh_n(bvh))
    +pp : Q.PP = Q.pre.par(Q.fork_depth(n), Q.halve(ts, Nil{}, Nil{}), bvh)
    +t2b : Nat <- stamp(pp_n(pp))
    +fr : D.FR = D.dmap(pp_dt(pp))
    +t2c : Nat <- stamp(Q.fr_np(fr))
    +res : Q.Res = Q.post.par(pp_tt(pp), fr, bvh, tree)
    +t3 : Nat <- stamp(res_n(res))
    +gs : W.GS = W.free_faces(Q.res_free(res), n, Q.inp_nv(inp), bvh, tree)
    +t4 : Nat <- stamp(gs_n(gs))
    +fs : List<&2, X.KF> = M.rev_onto(X.KF, gs_fs(gs), Q.res_fs(res))
    +u : X.Uniq = X.uniq(Z.psort(~X.Pt, ~X.pt_le, X.kf_pts(fs, Nil{})))
    +ups : List<&2, X.Pt> = X.number(List.reverse(&2, X.Pt, uniq_ps(u)), 0, Nil{})
    +t5 : Nat <- stamp(M.count(&2, X.Pt, ups))
    +pb : X.PB = X.pb(ups)
    +fm : X.FM = X.frags.par(Q.fork_depth(M.count(&2, X.KF, fs)), X.kf_halve(fs, Nil{}, Nil{}), pb)
    +t6 : Nat <- stamp((fm_n(fm) + pb_n(pb) : U32))
    +f0 : F.Fin = F.finish(ups, Q.fm_ts(fm))
    +t7 : Nat <- stamp(fin_n(f0))
    +lv : String = fin_json(f0, 0) ++ "," ++ q("exportRoundingMaxBits", U32.show(F32.bits(X.max_disp(ups, 0.0))))
    IO.print("{" ++ q("case", "\"" ++ id ++ "\"") ++ "," ++ q("inputTris", U32.show(n)) ++ "," ++ q("devicePairs", U32.show(Q.fr_np(fr))) ++ "," ++ q("deviceDisjoint", U32.show(Q.fr_nd(fr))) ++ "," ++ q("inputInBox", jb(inp_ok(inp))) ++ "," ++ q("quantErrBits", U32.show(F32.bits(inp_err(inp)))) ++ "," ++ res_json(res) ++ "," ++ gs_json(gs) ++ "," ++ q("points", U32.show(M.count(&2, X.Pt, ups))) ++ "," ++ q("roundingCollisions", U32.show(uniq_coll(u))) ++ "," ++ q("assembly", fm_json(fm)) ++ "," ++ q("widthsBits", wd_json(wd_kfs(fs, WD{0, 0, 0, 0}))) ++ "," ++ q("export", "{" ++ lv ++ "}") ++ "," ++ q("phasesMs", "{" ++ q("input", ms(t1, t0)) ++ "," ++ q("bvh", ms(t2, t1)) ++ "," ++ q("candidates", ms(t2b, t2)) ++ "," ++ q("devicePairFilter", ms(t2c, t2b)) ++ "," ++ q("arrangeClassify", ms(t3, t2c)) ++ "," ++ q("freeComponents", ms(t4, t3)) ++ "," ++ q("pointsUniq", ms(t5, t4)) ++ "," ++ q("assembleFaces", ms(t6, t5)) ++ "," ++ q("finishChecks", ms(t7, t6)) ++ "}") ++ "}")

def launch.p(p: M.JobParse) -> IO(Unit):
  match p:
    case M.Malformed{r}:
      IO.print("{\"malformed\":\"" ++ r ++ "\"}")
    case M.Parsed{job}:
      go(job)

def launch.read(r: File & Result<&1, &1, U32 & String, String>) -> IO(Unit):
  (file, res) = r
  do IO<Unit>:
    text : String <- IO.pass(String, res)
    u : Unit <- File.close(file)
    launch.p(MIO.parse_job(text))

def launch.sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(Unit):
  (file, res) = r
  do IO<Unit>:
    size : U32 <- IO.pass(U32, res)
    r2 : File & Result<&1, &1, U32 & String, String> <- File.read(file, (size + 1 : U32))
    launch.read(r2)

def launch(args: List<String>) -> IO(Unit):
  match args:
    case path <> Nil{}:
      do IO<Unit>:
        f : File <- IO.try(File, File.open(path, "r"))
        r : File & Result<&1, &1, U32 & String, U32> <- File.size(f)
        launch.sized(r)
    case _:
      IO.die(Unit, 2, "usage: stats -- <job-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
