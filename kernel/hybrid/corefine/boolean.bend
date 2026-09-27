import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./util.bend as U
import ./shadow.bend as S
import ./prep.bend as P
import ./inter.bend as I
import ./assemble.bend as A
import ./earclip.bend as E
import ./weld.bend as W
import ./zip.bend as Z
import ./gate.bend as X
import ./unify.bend as Y
import ./membrane.bend as MB

# corefine: one Boolean of two closed, consistently oriented triangle meshes
# (Manifold Boolean3 + Boolean3::Result), tags carried from input triangles
# to the output triangles cut from them.

type BOut is Data:
  BOk{mesh: M.Mesh}
  BBad{reason: String}

# Statistics of one Boolean's repair and triangulation (reported by the
# diagnostic entry stats.bend, not part of the result text):
#   rounds: repair rounds run (0: no T-junction or zero-width face was found);
#   recol: rounds whose short-edge collapse renamed a vertex;
#   dm: the largest corner-to-chord distance that only the delta term of the
#       triangulator's flatness accepted, in units of the job scale S
#       (earclip.bend Sc / Fl; at most delta / S = 2^-42 by construction).
type CSt is Data:
  CSt{rounds: U32, recol: U32, dm: F32}

type BRes is Data:
  BRes{out: BOut, st: CSt}

def bres_out(r: BRes) -> BOut:
  BRes{o, _} = r
  o

def refuse(+r: String, +k: U32, +c: U32) -> BRes:
  BRes{BBad{r}, CSt{k, c, 0.0}}

# The triangulator's flatness distance factor: delta = 2^-42 * S (earclip.bend
# Sc, docs/hybrid-robust.md X4).
def delta_k() -> F32:
  0.000000000000227373675

# --- faces --------------------------------------------------------------------------

type FL is Data:
  FL{face: U32, loops: List<&2, List<&2, U32>>}

type FLG is Data:
  FLG{face: U32, cur: List<&2, List<&2, U32>>, acc: List<&2, FL>}

def flg.close(+face: U32, +cur: List<&2, List<&2, U32>>, acc: List<&2, FL>) -> List<&2, FL>:
  U.cons_if(FL, U.nonzero(U.len(List<&2, U32>, cur)), FL{face, U.rev(List<&2, U32>, cur)}, acc)

def flg.if(same: Bool, +f: U32, +vs: List<&2, U32>, g: FLG) -> FLG:
  match same:
    case True{}:
      FLG{face, cur, acc} = g
      FLG{face, vs <> cur, acc}
    case False{}:
      FLG{face, cur, acc} = g
      FLG{f, [vs], flg.close(face, cur, acc)}

def flg.step(l: A.Loop, +g: FLG) -> FLG:
  A.Loop{+f, +vs} = l
  FLG{+face, _, _} = g
  flg.if(U32.is_eq(f, face), f, vs, g)

def flg.go(ls: List<&2, A.Loop>, g: FLG) -> FLG:
  match ls:
    case Nil{}:
      g
    case l <> t:
      flg.go(t, flg.step(l, g))

def flg.fin(g: FLG) -> List<&2, FL>:
  FLG{face, cur, acc} = g
  U.rev(FL, flg.close(face, cur, acc))

def face_groups(ls: List<&2, A.Loop>) -> List<&2, FL>:
  flg.fin(flg.go(ls, FLG{4294967295, Nil{}, Nil{}}))

# Everything a face needs for triangulation, read from both operands; pc:
# the plane class of every tag (membrane.bend).
type FCtx is Data:
  FCtx{pos: U.Table<G.Vec3>, ntP: U32, fnP: U.Table<U.N3>, fnQ: U.Table<U.N3>, tagP: U.Table<U32>, tagQ: U.Table<U32>, flipQ: Bool, pc: U.Table<U32>}

def proj_loop(vs: List<&2, U32>, +pj: E.Proj, +pos: U.Table<G.Vec3>, acc: List<&2, E.V2>) -> List<&2, E.V2>:
  match vs:
    case Nil{}:
      U.rev(E.V2, acc)
    case +v <> t:
      proj_loop(t, pj, pos, E.project(pj, v, U.tget(G.Vec3, pos, v, G.v3(0.0, 0.0, 0.0))) <> acc)

def proj_loops(ls: List<&2, List<&2, U32>>, +pj: E.Proj, +pos: U.Table<G.Vec3>, acc: List<&2, List<&2, E.V2>>) -> List<&2, List<&2, E.V2>>:
  match ls:
    case Nil{}:
      U.rev(List<&2, E.V2>, acc)
    case vs <> t:
      proj_loops(t, pj, pos, proj_loop(vs, pj, pos, Nil{}) <> acc)

# dm: the largest delta-only flatness distance of the faces (see CSt).
type TR is Data:
  TR{bad: Bool, tris: List<&2, M.Tri>, dm: F32}

def tr_merge(a: TR, b: TR) -> TR:
  TR{ab, at, am} = a
  TR{bb, bt, bm} = b
  TR{Bool.or(ab, bb), U.cat(M.Tri, at, bt), F32.max(am, bm)}

def tag_tris(ts: List<&2, E.T3>, +tag: U32, acc: List<&2, M.Tri>) -> List<&2, M.Tri>:
  match ts:
    case Nil{}:
      acc
    case E.T3{a, b, c} <> t:
      tag_tris(t, tag, M.Tri{a, b, c, tag} <> acc)

def face_tr(ft: E.FT, +tag: U32, acc: TR) -> TR:
  E.FT{fb, ts, fm} = ft
  TR{b, xs, dm} = acc
  TR{Bool.or(b, fb), tag_tris(ts, tag, xs), F32.max(dm, fm)}

# sc: the job's flatness scale (earclip.bend Sc).
def face_tris(fl: FL, +cx: FCtx, +sc: E.Sc, acc: TR) -> TR:
  FL{+f, ls} = fl
  FCtx{+pos, +ntP, +fnP, +fnQ, +tagP, +tagQ, +flipQ, _} = cx
  +isP = U32.is_lt(f, ntP)
  +fq = (f - ntP : U32)
  +n = Bool.pick(U.N3, isP, U.tget(U.N3, fnP, f, U.n3zero()), Bool.pick(U.N3, flipQ, U.nneg(U.tget(U.N3, fnQ, fq, U.n3zero())), U.tget(U.N3, fnQ, fq, U.n3zero())))
  +tag = Bool.pick(U32, isP, U.tget(U32, tagP, f, 0), U.tget(U32, tagQ, fq, 0))
  face_tr(E.tri_face(proj_loops(Z.split_loops(ls, Nil{}), E.proj_of(n), pos, Nil{}), sc), tag, acc)

def faces_seq(fs: List<&2, FL>, +cx: FCtx, +sc: E.Sc, acc: TR) -> TR:
  match fs:
    case Nil{}:
      acc
    case f <> t:
      faces_seq(t, cx, sc, face_tris(f, cx, sc, acc))

def faces_par(c: I.CTree<FL>, +cx: FCtx, +sc: E.Sc) -> TR:
  match c:
    case I.CtNil{}:
      TR{False{}, Nil{}, 0.0}
    case I.CtLeaf{xs}:
      faces_seq(xs, cx, sc, TR{False{}, Nil{}, 0.0})
    case I.CtNode{l, r}:
      a b = faces_par(l, cx, sc) faces_par(r, cx, sc)
      tr_merge(a, b)

# --- the Boolean ------------------------------------------------------------------------

def is_union(op: M.Op) -> Bool:
  match op:
    case M.Union{}:
      True{}
    case _:
      False{}

def is_subtract(op: M.Op) -> Bool:
  match op:
    case M.Subtract{}:
      True{}
    case _:
      False{}

def mark_used(ts: List<&2, M.Tri>, a: Array<U32>) -> Array<U32>:
  match ts:
    case Nil{}:
      a
    case M.Tri{x, y, z, _} <> t:
      mark_used(t, Array.set(U32, Array.set(U32, Array.set(U32, a, x, 1), y, 1), z, 1))

type Cpt is Data:
  Cpt{idx: List<&2, U32>, vs: List<&2, G.Vec3>, next: U32}

def compact.go(us: List<&2, U32>, ps: List<&2, G.Vec3>, st: Cpt) -> Cpt:
  match us ps:
    case +u <> ut +p <> pt:
      Cpt{idx, vs, +next} = st
      +keep = U.nonzero(u)
      compact.go(ut, pt, Cpt{Bool.pick(U32, keep, next, 4294967295) <> idx, U.cons_if(G.Vec3, keep, p, vs), (next + U.b2u(keep) : U32)})
    case _ _:
      Cpt{idx, vs, n} = st
      Cpt{U.rev(U32, idx), U.rev(G.Vec3, vs), n}

def retag(ts: List<&2, M.Tri>, +m: U.Table<U32>, acc: List<&2, M.Tri>) -> List<&2, M.Tri>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{x, y, z, g} <> t:
      retag(t, m, M.Tri{U.tget(U32, m, x, 0), U.tget(U32, m, y, 0), U.tget(U32, m, z, 0), g} <> acc)

def compact.fin(c: Cpt, +n: U32, tris: List<&2, M.Tri>) -> M.Mesh:
  Cpt{idx, vs, _} = c
  M.Mesh{vs, U.rev(M.Tri, retag(tris, U.table(U32, n, idx), Nil{}))}

# Drop unreferenced vertices and renumber.
def compact(+tris: List<&2, M.Tri>, +vs: List<&2, G.Vec3>) -> M.Mesh:
  +n = U.len(G.Vec3, vs)
  compact.fin(compact.go(U.list_of(~U32, n, mark_used(tris, Array.new(U32, U.depth(n), 0))), vs, Cpt{Nil{}, Nil{}, 0}), n, tris)

def tri_fh(ts: List<&2, M.Tri>, acc: List<&2, A.FH>) -> List<&2, A.FH>:
  match ts:
    case Nil{}:
      acc
    case M.Tri{+a, +b, +c, _} <> t:
      tri_fh(t, A.FH{0, a, b} <> A.FH{0, b, c} <> A.FH{0, c, a} <> acc)

def fin.gate(g: X.GateR, m: M.Mesh) -> BOut:
  match g:
    case X.GOk{}:
      BOk{m}
    case X.GBad{r}:
      BBad{r}

# Output gate (gate.bend): vertex links and exact self-intersection. An
# accepted mesh is returned unchanged.
def fin.gated(+m: M.Mesh) -> BOut:
  fin.gate(X.check(m), m)

def fin.manifold(ok: Bool, tris: List<&2, M.Tri>, vs: List<&2, G.Vec3>) -> BOut:
  match ok:
    case True{}:
      fin.gated(compact(tris, vs))
    case False{}:
      BBad{"triangulated result is not 2-manifold (a face diagonal duplicates an edge: touching contact)"}

# Final guarantee: every directed edge of the triangles is paired once.
def fin.tr.out(bad: Bool, +tris: List<&2, M.Tri>, vs: List<&2, G.Vec3>) -> BOut:
  match bad:
    case True{}:
      BBad{"face triangulation failed (no valid ear or hole bridge)"}
    case False{}:
      fin.manifold(W.paired(tri_fh(tris, Nil{})), tris, vs)

# k, c: the repair rounds run and the rounds whose collapse renamed a vertex.
def fin.tr(t: TR, vs: List<&2, G.Vec3>, +k: U32, +c: U32) -> BRes:
  TR{bad, tris, dm} = t
  BRes{fin.tr.out(bad, tris, vs), CSt{k, c, dm}}

def fin.loops(l: A.Loops, +vs: List<&2, G.Vec3>, +cx: FCtx, +sc: E.Sc, +k: U32, +c: U32, +leaves: U32) -> BRes:
  A.Loops{bad, ls} = l
  match bad:
    case True{}:
      refuse("output face halfedges do not close into loops", k, c)
    case False{}:
      fin.tr(faces_par(I.ctree(FL, face_groups(ls), leaves), cx, sc), vs, k, c)

# Stage results (each stage can refuse with a reason).
type Mid is Data:
  MidBad{reason: String}
  Mid{fh: List<&2, A.FH>, vs: List<&2, G.Vec3>, cx: FCtx, nf: U32}

type Fin is Data:
  FinBad{reason: String}
  Fin{changed: Bool, fh: List<&2, A.FH>, vs: List<&2, G.Vec3>, cx: FCtx, nf: U32}

def fin.weld(w: W.Welded, +vs: List<&2, G.Vec3>, +cx: FCtx, +nf: U32) -> Fin:
  W.Welded{changed, fh} = w
  Fin{changed, fh, vs, cx, nf}

# Stage 4: exact weld and short-edge collapse.
def finish1(m: Mid) -> Fin:
  match m:
    case MidBad{r}:
      FinBad{r}
    case Mid{fh, +vs, +cx, +nf}:
      fin.weld(W.weld2(fh, vs), vs, cx, nf)

def defects(fls: List<&2, FL>, +pos: U.Table<G.Vec3>, +eps2: F32, +tol: F32, acc: Z.Defects) -> Z.Defects:
  match fls:
    case Nil{}:
      acc
    case FL{f, ls} <> t:
      defects(t, pos, eps2, tol, Z.defects.face(f, ls, pos, eps2, tol, acc))

def defects_merge(a: Z.Defects, b: Z.Defects) -> Z.Defects:
  Z.Defects{sa, na} = a
  Z.Defects{sb, nb} = b
  Z.Defects{U.cat(A.FH, sa, sb), (na + nb : U32)}

# The per-face defect scan over a balanced fork tree of face chunks.
def defects_par(c: I.CTree<FL>, +pos: U.Table<G.Vec3>, +eps2: F32, +tol: F32) -> Z.Defects:
  match c:
    case I.CtNil{}:
      Z.Defects{Nil{}, 0}
    case I.CtLeaf{xs}:
      defects(xs, pos, eps2, tol, Z.Defects{Nil{}, 0})
    case I.CtNode{l, r}:
      a b = defects_par(l, pos, eps2, tol) defects_par(r, pos, eps2, tol)
      defects_merge(a, b)

def fin.checked(ok: Bool, +fls: List<&2, FL>, +vs: List<&2, G.Vec3>, +cx: FCtx, +sc: E.Sc, +leaves: U32) -> BRes:
  match ok:
    case False{}:
      refuse("weld of coincident or nearly coincident output vertices is not 2-manifold (touching geometry)", 0, 0)
    case True{}:
      fin.tr(faces_par(I.ctree(FL, fls, leaves), cx, sc), vs, 0, 0)

# --- repair rounds ---------------------------------------------------------------------
# T-junction splits and zipping insert every vertex within eps of an edge's
# line strictly inside the edge, also one within eps of an edge's END (a
# second rounding of that end: an exact crossing and a step-1 corner 8e-14 mm
# apart). The edge this leaves is shorter than eps, but the short-edge
# collapse (weld2) ran before (docs/hybrid-robust.md R1: kt6 turned by 1e-4,
# 45, 60, 89.9 degrees or 37 degrees about (1, 2, 3)). So the invariant "no
# edge shorter than eps reaches the triangulation" is enforced after the last
# stage that can create one: a round is split + zip + short-edge collapse; it
# repeats while the collapse renamed a vertex and new T-junctions, zero-width
# faces or short edges appear, at most 3 rounds (same eps = 2^-36 * S, the
# collapse renames to the lower index, so input vertices never move). Then a
# census: an edge shorter than eps or an unpaired edge that survives is
# refused by name here, not later by the ear clipper or recover with an
# unrelated message.

# What the repair rounds read: output vertices, face context, face-id bound,
# positions, eps^2, the T-junction prefilter tolerance, the flatness scale
# and the fork width.
type RCx is Data:
  RCx{vs: List<&2, G.Vec3>, cx: FCtx, nf: U32, pos: U.Table<G.Vec3>, eps2: F32, tol: F32, sc: E.Sc, leaves: U32}

def rep.max_rounds() -> U32:
  3

def rep.after(+k: U32, s: String) -> String:
  s ++ MIO.put_u32(k, " repair round(s))")

# After a round: the answer, or round k of the repair (c: earlier rounds
# whose collapse renamed a vertex) on the halfedges fh with the splits sps.
type RSt is Data:
  RsDone{r: BRes}
  RsMore{k: U32, c: U32, fh: List<&2, A.FH>, sps: List<&2, A.FH>}

# The census after the last round (pairing is checked after every collapse).
def rep.census(short: Bool, +k: U32, +c: U32, +fls: List<&2, FL>, +rc: RCx) -> RSt:
  match short:
    case True{}:
      RsDone{refuse(rep.after(k, "an edge shorter than the short-edge tolerance (2^-36 * scale) survives repair (after "), k, c)}
    case False{}:
      RCx{+vs, +cx, _, _, _, _, +sc, +leaves} = rc
      RsDone{fin.tr(faces_par(I.ctree(FL, fls, leaves), cx, sc), vs, k, c)}

def rep.more(more: Bool, +short: Bool, +k: U32, +c: U32, sps: List<&2, A.FH>, +fls: List<&2, FL>, +fh: List<&2, A.FH>, +rc: RCx) -> RSt:
  match more:
    case True{}:
      RsMore{(k + 1 : U32), c, fh, sps}
    case False{}:
      rep.census(short, k, c, fls, rc)

def rep.next(d: Z.Defects, +short: Bool, +k: U32, +c: U32, +fls: List<&2, FL>, +fh: List<&2, A.FH>, +rc: RCx) -> RSt:
  Z.Defects{+sps, +nflat} = d
  +defect = Bool.or(U.nonzero(U.len(A.FH, sps)), U.nonzero(nflat))
  rep.more(Bool.and(Bool.or(defect, short), U32.is_lt(k, rep.max_rounds())), short, k, c, sps, fls, fh, rc)

def rep.faces(l: A.Loops, +k: U32, +c: U32, +fh: List<&2, A.FH>, +rc: RCx) -> RSt:
  A.Loops{bad, ls} = l
  match bad:
    case True{}:
      RsDone{refuse("output face halfedges do not close into loops", k, c)}
    case False{}:
      RCx{_, _, _, +pos, +eps2, +tol, _, +leaves} = rc
      +fls = face_groups(ls)
      rep.next(defects_par(I.ctree(FL, fls, leaves), pos, eps2, tol), W.has_short(fh, pos, eps2), k, c, fls, fh, rc)

def rep.again(ok: Bool, +k: U32, +c: U32, +fh: List<&2, A.FH>, +rc: RCx) -> RSt:
  match ok:
    case False{}:
      RsDone{refuse(rep.after(k, "an unpaired edge survives the short-edge collapse (repaired output is not 2-manifold after "), k, c)}
    case True{}:
      rep.faces(A.loops(fh), k, c, fh, rc)

# Nothing was shorter than eps: the repaired halfedges as they are (the
# single repair of earlier versions, same result and message).
def rep.plain(ok: Bool, +k: U32, +c: U32, +fh: List<&2, A.FH>, +rc: RCx) -> RSt:
  match ok:
    case False{}:
      RsDone{refuse("welded / repaired output is not 2-manifold (touching or overlapping geometry)", k, c)}
    case True{}:
      RCx{+vs, +cx, _, _, _, _, +sc, +leaves} = rc
      RsDone{fin.loops(A.loops(fh), vs, cx, sc, k, c, leaves)}

def rep.collapsed(w: W.Welded, +k: U32, +c: U32, +rc: RCx) -> RSt:
  W.Welded{changed, +fh} = w
  match changed:
    case False{}:
      rep.plain(W.paired(fh), k, c, fh, rc)
    case True{}:
      rep.again(W.paired(fh), k, (c + 1 : U32), fh, rc)

# Round k: split the T-junctions, zip the zero-width faces, collapse the
# edges shorter than eps (before the pairing check: an insertion on only one
# of an edge's two halfedges is undone by the collapse).
def rep.round(+k: U32, +c: U32, +fh: List<&2, A.FH>, sps: List<&2, A.FH>, +rc: RCx) -> RSt:
  RCx{+vs, _, +nf, +pos, +eps2, _, _, _} = rc
  rep.collapsed(W.collapse(Z.zip(Z.apply_splits(fh, sps, pos), pos, eps2, nf), vs, pos, eps2), k, c, rc)

# The rounds (at most rep.max_rounds(): rep.more stops them; the fuel only
# makes the recursion structural).
def rep.go(fuel: Nat, s: RSt, +rc: RCx) -> BRes:
  match fuel s:
    case _ RsDone{r}:
      r
    case 0n RsMore{+k, +c, _, _}:
      refuse("internal: repair rounds exhausted", k, c)
    case 1n+p RsMore{+k, +c, +fh, sps}:
      rep.go(p, rep.round(k, c, fh, sps, rc), rc)

def fin.clean(clean: Bool, +changed: Bool, +sps: List<&2, A.FH>, +fls: List<&2, FL>, +fh: List<&2, A.FH>, +rc: RCx) -> BRes:
  match clean:
    case True{}:
      RCx{+vs, +cx, _, _, _, _, +sc, +leaves} = rc
      fin.checked(Bool.or(Bool.not(changed), W.paired(fh)), fls, vs, cx, sc, leaves)
    case False{}:
      rep.go(4n, RsMore{1, 0, fh, sps}, rc)

def fin.defects(d: Z.Defects, +changed: Bool, +fls: List<&2, FL>, +fh: List<&2, A.FH>, +rc: RCx) -> BRes:
  Z.Defects{+sps, +nflat} = d
  fin.clean(Bool.and(U.is_zero(U.len(A.FH, sps)), U.is_zero(nflat)), changed, sps, fls, fh, rc)

# dk: the flatness factor (delta = dk * S; delta_k() in production).
def fin.faces(l: A.Loops, +changed: Bool, +fh: List<&2, A.FH>, +vs: List<&2, G.Vec3>, +cx: FCtx, +nf: U32, +dk: F32, +leaves: U32) -> BRes:
  A.Loops{bad, ls} = l
  match bad:
    case True{}:
      refuse("output face halfedges do not close into loops", 0, 0)
    case False{}:
      FCtx{+pos, _, _, _, _, _, _, _} = cx
      +e2 = W.eps2_of(vs)
      +s = W.maxabs(vs, 1.0)
      +tol = (s * 0.00001 : F32)
      +fls = face_groups(ls)
      fin.defects(defects_par(I.ctree(FL, fls, leaves), pos, e2, tol), changed, fls, fh, RCx{vs, cx, nf, pos, e2, tol, E.scale(s, dk), leaves})

def mb_ctx(+cx: FCtx, +nf: U32, +eps: F32) -> MB.Ctx:
  FCtx{+pos, +ntP, +fnP, +fnQ, +tagP, +tagQ, +flipQ, +pc} = cx
  MB.Ctx{pos, ntP, nf, fnP, fnQ, tagP, tagQ, flipQ, pc, eps}

def fin.mem(m: MB.Out, +changed: Bool, +vs: List<&2, G.Vec3>, +cx: FCtx, +nf: U32, +dk: F32, +leaves: U32) -> BRes:
  match m:
    case MB.MbBad{r}:
      refuse(r, 0, 0)
    case MB.MbOk{any, _, +fh}:
      fin.faces(A.loops(fh), Bool.or(changed, any), fh, vs, cx, nf, dk, leaves)

# Stage 5: coplanar membranes cancelled (membrane.bend; only when found),
# face loops, T-junction / zero-width-face repair (only when found),
# triangulation, compaction.
def finish2(f: Fin, +dk: F32, +leaves: U32) -> BRes:
  match f:
    case FinBad{r}:
      refuse(r, 0, 0)
    case Fin{+changed, +fh, +vs, +cx, +nf}:
      fin.mem(MB.cancel(fh, mb_ctx(cx, nf, (W.maxabs(vs, 1.0) * 0.0000000000145519152 : F32))), changed, vs, cx, nf, dk, leaves)

def fin.pairs(pr: A.Pairs, wh: List<&2, A.FH>, vs: List<&2, G.Vec3>, cx: FCtx, nf: U32) -> Mid:
  A.Pairs{bad, fh} = pr
  match bad:
    case True{}:
      MidBad{"unequal segment starts and ends on an edge (PairUp)"}
    case False{}:
      Mid{U.cat(A.FH, fh, wh), vs, cx, nf}

# Operand data the assembly reads (the parts of P.Prep plus its side).
type Opd is Data:
  Opd{nv: U32, nt: U32, pos: U.Table<G.Vec3>, tv: U.Table<U32>, pair: U.Table<U32>, tag: U.Table<U32>, fn: U.Table<U.N3>, es: List<&2, P.EItem>, hits: List<&2, I.Hit>, w: U.Table<U32>}

def opd(p: P.Prep, s: I.Side) -> Opd:
  P.Prep{nv, nt, pos, tv, pair, tag, fn, _, es, _, _} = p
  I.Side{_, hits, w} = s
  Opd{nv, nt, pos, tv, pair, tag, fn, es, hits, w}

def asm.check(bad: Bool, pr: A.Pairs, wh: List<&2, A.FH>, vs: List<&2, G.Vec3>, cx: FCtx, nf: U32) -> Mid:
  match bad:
    case True{}:
      MidBad{"inclusion number outside [-1, 1] (self-overlapping operand?)"}
    case False{}:
      fin.pairs(pr, wh, vs, cx, nf)

def asm.x(x12: A.XS, x21: A.XS, rp: A.Remap, rq: A.Remap, +a: Opd, +b: Opd, +flipQ: Bool, +pc: U.Table<U32>) -> Mid:
  A.XS{+xs12, ps12, _, b12} = x12
  A.XS{+xs21, ps21, _, b21} = x21
  A.Remap{incP, idxP, psP, _, bP} = rp
  A.Remap{incQ, idxQ, psQ, _, bQ} = rq
  Opd{+nvP, +ntP, +posP, +tvP, +pairP, +tagP, +fnP, +esP, +hP, _} = a
  Opd{+nvQ, +ntQ, +posQ, +tvQ, +pairQ, +tagQ, +fnQ, +esQ, +hQ, _} = b
  +sP = {A.Side{posP, tvP, pairP, U.table(U32, nvP, incP), U.table(U32, nvP, idxP), 0} : A.Side}
  +sQ = {A.Side{posQ, tvQ, pairQ, U.table(U32, nvQ, incQ), U.table(U32, nvQ, idxQ), ntP} : A.Side}
  +vs = U.cat(G.Vec3, psP, U.cat(G.Vec3, psQ, U.cat(G.Vec3, ps12, ps21)))
  +nout = U.len(G.Vec3, vs)
  +cx = {FCtx{U.table(G.Vec3, nout, vs), ntP, fnP, fnQ, tagP, tagQ, flipQ, pc} : FCtx}
  pr1 = A.partial_edges(A.groups(xs12), sP, A.Pairs{False{}, Nil{}})
  pr2 = A.partial_edges(A.groups(xs21), sQ, pr1)
  pr3 = A.new_edges(A.new_groups(A.ne_of(xs12, True{}, pairP, A.ne_of(xs21, False{}, pairQ, Nil{}))), ntP, pr2)
  wh = U.cat(A.FH, A.whole(esP, hP, (ntP * 3 : U32), sP), A.whole(esQ, hQ, (ntQ * 3 : U32), sQ))
  asm.check(Bool.or(Bool.or(b12, b21), Bool.or(bP, bQ)), pr3, wh, vs, cx, (ntP + ntQ : U32))

def side_bad(s: I.Side) -> Bool:
  I.Side{b, _, _} = s
  b

def bool.go2(bad: Bool, +a: Opd, +b: Opd, ops: A.Ops, +flipQ: Bool, +pc: U.Table<U32>) -> Mid:
  match bad:
    case True{}:
      MidBad{"symbolic predicate inconsistency (no bracketing pair)"}
    case False{}:
      Opd{+nvP, _, +posP, _, _, _, _, _, +hP, +wP} = a
      Opd{+nvQ, _, +posQ, _, _, _, _, _, +hQ, +wQ} = b
      A.Ops{+c1, +c2, +neg} = ops
      +rp = A.remap(nvP, 0, c1, neg, wP, posP)
      +rq = A.remap(nvQ, A.remap_next(rp), c2, neg, wQ, posQ)
      +x12 = A.xhs(hP, neg, A.remap_next(rq), 0)
      +x21 = A.xhs(hQ, neg, A.xs_next(x12), U.len(I.Hit, hP))
      asm.x(x12, x21, rp, rq, a, b, flipQ, pc)

# Stage 3: inclusion numbers and the output halfedges of every output face.
def assemble(+sp: I.Side, +sq: I.Side, p: P.Prep, q: P.Prep, +op: M.Op, +pc: U.Table<U32>) -> Mid:
  bool.go2(Bool.or(side_bad(sp), side_bad(sq)), opd(p, sp), opd(q, sq), A.ops(op), is_subtract(op), pc)

def bool.sides(+sp: I.Side, +sq: I.Side, p: P.Prep, q: P.Prep, +op: M.Op, +dk: F32, +leaves: U32, +pc: U.Table<U32>) -> BRes:
  finish2(finish1(assemble(sp, sq, p, q, op, pc)), dk, leaves)

# --- stepwise API: before the decisions, decisions, after -------------------------------

# tz: the tie tolerance of carrier unification (unify.bend); pc: the plane
# class of every tag (membrane.bend).
type Pre is Data:
  PreBad{reason: String}
  Pre{op: M.Op, p: P.Prep, q: P.Prep, sp: I.SPre, sq: I.SPre, tz: F32, pc: U.Table<U32>}

def pre.q(qq: P.PrepR, +p: P.Prep, +op: M.Op, +leaves: U32, +tz: F32, +pc: U.Table<U32>) -> Pre:
  match qq:
    case P.PrepBad{r}:
      PreBad{"right operand: " ++ r}
    case P.PrepOk{+q}:
      sa sb = I.side_pre(p, q, leaves) I.side_pre(q, p, leaves)
      Pre{op, p, q, sa, sb, tz, pc}

def pre.p(pp: P.PrepR, qq: P.PrepR, +op: M.Op, +leaves: U32, +tz: F32, +pc: U.Table<U32>) -> Pre:
  match pp:
    case P.PrepBad{r}:
      PreBad{"left operand: " ++ r}
    case P.PrepOk{p}:
      pre.q(qq, p, op, leaves, tz, pc)

# Stages 1-2a: operand preparation (both in parallel) and the broad phase.
# uc: the job's unified plane classes (unify.bend).
def pre(+op: M.Op, pm: M.Mesh, qm: M.Mesh, +leaves: U32, uc: Y.Uc) -> Pre:
  Y.Uc{+on, +cm, +tz, _, +pc} = uc
  pa pb = P.prep(pm, on, cm) P.prep(qm, on, cm)
  pre.p(pa, pb, op, leaves, tz, pc)

def pre_tz(r: Pre) -> F32:
  match r:
    case PreBad{_}:
      0.0
    case Pre{_, _, _, _, _, tz, _}:
      tz

def pre_pairs_p(r: Pre) -> List<&2, I.PairC>:
  match r:
    case PreBad{_}:
      Nil{}
    case Pre{_, _, _, sp, _, _, _}:
      I.spre_pairs(sp)

def pre_pairs_q(r: Pre) -> List<&2, I.PairC>:
  match r:
    case PreBad{_}:
      Nil{}
    case Pre{_, _, _, _, sq, _, _}:
      I.spre_pairs(sq)

def pre_union(r: Pre) -> Bool:
  match r:
    case PreBad{_}:
      False{}
    case Pre{op, _, _, _, _, _, _}:
      is_union(op)

# Stages 2c-5, given the decisions of both sides (hp: edges of P against
# faces of Q; hq: edges of Q against faces of P), with the statistics (CSt).
# dk: the triangulator's flatness factor, delta_k() in production (the
# diagnostic entry stats.bend can vary it to measure what a job would need).
def post_stats(r: Pre, hp: I.Hits, hq: I.Hits, +leaves: U32, +dk: F32) -> BRes:
  match r:
    case PreBad{m}:
      refuse(m, 0, 0)
    case Pre{+op, +p, +q, +sa, +sb, +tz, +pc}:
      +eP = is_union(op)
      sp sq = I.side_post(hp, sa, p, eP, True{}, leaves, tz) I.side_post(hq, sb, q, eP, False{}, leaves, tz)
      bool.sides(sp, sq, p, q, op, dk, leaves, pc)

def post(r: Pre, hp: I.Hits, hq: I.Hits, +leaves: U32) -> BOut:
  bres_out(post_stats(r, hp, hq, leaves, delta_k()))

# The Boolean `op` of P and Q (closed, consistently oriented, non-empty).
# `leaves` sets the width of the CPU fork trees; uc carries the job's unified
# plane classes.
def boolean(+op: M.Op, pm: M.Mesh, qm: M.Mesh, +leaves: U32, uc: Y.Uc) -> BOut:
  +r = pre(op, pm, qm, leaves, uc)
  +eP = pre_union(r)
  +tz = pre_tz(r)
  hp hq = I.decide(pre_pairs_p(r), eP, True{}, tz) I.decide(pre_pairs_q(r), eP, False{}, tz)
  post(r, hp, hq, leaves)
