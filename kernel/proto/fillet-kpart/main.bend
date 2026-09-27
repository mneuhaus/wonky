import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as K
import ./ladder.bend as L
import ./bounds.bend as B
import ./corners.bend as C
import ./notch.bend as N
import ./surgery.bend as S

# Prototype A "fillet-kpart" (docs/fillet/proto-kpart.md), stage 1 (the
# per-edge ladder), stage 2 (the corner network, corners.bend) and stage 3
# (the B-rep surgery, surgery.bend). Harness contract
# (docs/fillet/harness.md):
#   run(job) -> result text: `ok` and the result B-rep when the ladder, the
#   network and the surgery admit the case; otherwise the first typed
#   refusal (`unresolved <class> <reason>`), never a wrong `ok`.
#   ladder(job) -> the stripes as data ("wonky-fillet-ladder 1").
#   network(job) -> the corner network as data ("wonky-fillet-network 1").
#   parse / solve / show time the phases on the JS target; solve is
#   solve0 (ladder and network, the native Metal device call) then finish
#   (the surgery, on the CPU).
#
# Order of work: resolve the selection (seams ignored with a note, duplicate
# indices dropped, G1 chains added when tangentPropagation is on), then the
# per-edge rungs in a fork-join tree, then bounds and vertex census per stripe
# (fork-join again), then corners, full-round merges and the verdict. The
# stripe order is ascending edge index and is recorded in the data.

# ---------------------------------------------------------------------------
# Selection

type Res is Data:
  Res{sel: List<&2, U32>, notes: List<&2, String>}
  ResNo{cls: String, why: String}

def all_lt(+xs: List<&2, U32>, +n: U32) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case x <> t:
      Bool.and(U32.is_lt(x, n), all_lt(t, n))

def keep_seams(+xs: List<&2, U32>, +b: J.Body, +want: Bool, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case x <> t:
      +xx = x
      keep_seams(t, b, want, K.push_if(Bool.not(Bool.xor(L.cls_is_seam(L.classify(b, xx)), want)), xx, acc))

def diff(+xs: List<&2, U32>, +ys: List<&2, U32>, +acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      List.reverse(&2, U32, acc)
    case x <> t:
      +xx = x
      diff(t, ys, K.push_if(Bool.not(K.mem(ys, xx)), xx, acc))

def notes_of(+xs: List<&2, U32>, +word: String, +acc: List<&2, String>) -> List<&2, String>:
  match xs:
    case Nil{}:
      acc
    case x <> t:
      notes_of(t, word, (word ++ " " ++ K.show_u32(x)) <> acc)

def res.full(+empty: Bool, +full: List<&2, U32>, +notes: List<&2, String>) -> Res:
  match empty:
    case True{}:
      ResNo{"invalid-input", "no blendable edge selected (after ignoring seam edges)"}
    case False{}:
      Res{full, List.reverse(&2, String, notes)}

def res.prop(+prop: Bool, +b: J.Body, +base: List<&2, U32>, +notes: List<&2, String>) -> Res:
  match prop:
    case True{}:
      +full = L.propagate(b, base)
      res.full(U32.is_eq(K.count(U32, full), 0), full, notes_of(diff(full, base, Nil{}), "propagated", notes))
    case False{}:
      res.full(U32.is_eq(K.count(U32, base), 0), base, notes)

def res.valid(+ok: Bool, +b: J.Body, +raw: List<&2, U32>, +sorted: List<&2, U32>, +prop: Bool) -> Res:
  match ok:
    case False{}:
      ResNo{"invalid-input", "a selected edge index is out of range"}
    case True{}:
      +seams = keep_seams(sorted, b, True{}, Nil{})
      +base = keep_seams(sorted, b, False{}, Nil{})
      +ndup = U32.sub(K.count(U32, raw), K.count(U32, sorted))
      +n0 = Bool.pick(List<&2, String>, U32.is_eq(ndup, 0), Nil{}, [("duplicate-ignored " ++ K.show_u32(ndup))])
      res.prop(prop, b, base, notes_of(seams, "seam-ignored", n0))

def resolve(+b: J.Body, +raw: List<&2, U32>, +prop: Bool) -> Res:
  +sorted = K.sort_uniq(raw)
  res.valid(all_lt(sorted, K.count(J.Edge, K.body_es(b))), b, raw, sorted, prop)

# ---------------------------------------------------------------------------
# Fork-join over the stripes (balanced halves; `fuel` bounds the depth)

def solve_seq(+xs: List<&2, U32>, +t: L.Task) -> List<&2, L.Stripe>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> r:
      L.stripe(t, x) <> solve_seq(r, t)

def solve_all(+fuel: Nat, +t: L.Task, +xs: List<&2, U32>, +n: Nat) -> List<&2, L.Stripe>:
  match fuel:
    case 0n:
      solve_seq(xs, t)
    case 1n+f:
      match xs:
        case Nil{}:
          Nil{}
        case x <> Nil{}:
          [L.stripe(t, x)]
        case x <> y <> rest:
          +all = {x <> y <> rest : List<&2, U32>}
          +h = Nat.div(n, 2n)
          a b = solve_all(f, t, List.take(&2, U32, all, h), h) solve_all(f, t, List.drop(&2, U32, all, h), Nat.sub(n, h))
          List.append(&2, L.Stripe, a, b)

def post_seq(+xs: List<&2, L.Stripe>, +b: J.Body, +ss: List<&2, L.Stripe>, +sel: List<&2, U32>) -> List<&2, B.Post>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> r:
      B.post(b, ss, sel, x) <> post_seq(r, b, ss, sel)

def post_all(+fuel: Nat, +b: J.Body, +ss: List<&2, L.Stripe>, +sel: List<&2, U32>, +xs: List<&2, L.Stripe>, +n: Nat) -> List<&2, B.Post>:
  match fuel:
    case 0n:
      post_seq(xs, b, ss, sel)
    case 1n+f:
      match xs:
        case Nil{}:
          Nil{}
        case x <> Nil{}:
          [B.post(b, ss, sel, x)]
        case x <> y <> rest:
          +all = {x <> y <> rest : List<&2, L.Stripe>}
          +h = Nat.div(n, 2n)
          a c = post_all(f, b, ss, sel, List.take(&2, L.Stripe, all, h), h) post_all(f, b, ss, sel, List.drop(&2, L.Stripe, all, h), Nat.sub(n, h))
          List.append(&2, B.Post, a, c)

# ---------------------------------------------------------------------------
# Corners and merges

def corner_vs.ends(+es: List<&2, B.End>, +acc: List<&2, U32>) -> List<&2, U32>:
  match es:
    case Nil{}:
      acc
    case B.ECorner{v} <> t:
      corner_vs.ends(t, v <> acc)
    case _ <> t:
      corner_vs.ends(t, acc)

def corner_vs(+ps: List<&2, B.Post>, +acc: List<&2, U32>) -> List<&2, U32>:
  match ps:
    case Nil{}:
      K.sort_uniq(acc)
    case B.Post{_, _, ends} <> t:
      corner_vs(t, corner_vs.ends(ends, acc))
    case B.PostNo{} <> t:
      corner_vs(t, acc)

def stripe_surf(+ss: List<&2, L.Stripe>, +e: U32) -> Maybe<&2, J.Surf>:
  match ss:
    case Nil{}:
      None{}
    case L.St{k, _, _, _, _, _, _, _, _, _, _, _, surf, _} <> t:
      Bool.pick(Maybe<&2, J.Surf>, U32.is_eq(k, e), Some{surf}, stripe_surf(t, e))
    case L.NoSt{_, _, _} <> t:
      stripe_surf(t, e)

def merge_of.m(+m: Maybe<&2, J.Surf>, +surf: J.Surf) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{s2}:
      C.same_surf(surf, s2)

# "merge k j" when side bound of k is consumed by the spring of j (k < j)
# and both carriers coincide.
def merge_bnd(+bd: B.Bnd, +k: U32, +surf: J.Surf, +ss: List<&2, L.Stripe>, +acc: List<&2, String>) -> List<&2, String>:
  match bd:
    case B.Bnd{_, lim, st}:
      match lim:
        case B.Lim{_, _, by, id, _}:
          +hit = Bool.and(Bool.and(U32.is_eq(st, 1), U32.is_eq(by, 2)), U32.is_lt(k, id))
          +same = Bool.and(hit, merge_of.m(stripe_surf(ss, id), surf))
          Bool.pick(List<&2, String>, same, ("merge " ++ K.show_u32(k) ++ " " ++ K.show_u32(id) ++ " full-round") <> acc, acc)

def merges(+xs: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +ss: List<&2, L.Stripe>, +acc: List<&2, String>) -> List<&2, String>:
  match xs:
    case Nil{}:
      List.reverse(&2, String, acc)
    case L.St{k, _, _, _, _, _, _, _, _, _, _, _, surf, _} <> t:
      match ps:
        case B.Post{b1, b2, _} <> pt:
          merges(t, pt, ss, merge_bnd(b2, k, surf, ss, merge_bnd(b1, k, surf, ss, acc)))
        case _ <> pt:
          merges(t, pt, ss, acc)
        case Nil{}:
          List.reverse(&2, String, acc)
    case L.NoSt{_, _, _} <> t:
      match ps:
        case _ <> pt:
          merges(t, pt, ss, acc)
        case Nil{}:
          List.reverse(&2, String, acc)

# ---------------------------------------------------------------------------
# Verdict: the first refusal in a fixed order (stripes, width bounds, vertex
# census, corners; each by ascending edge or vertex), else admit.

type Vd is Data:
  Admit{}
  Refuse{cls: String, why: String}

def by_name(+by: U32, +id: U32) -> String:
  match by:
    case 1:
      "edge " ++ K.show_u32(id)
    case 2:
      "the spring of edge " ++ K.show_u32(id)
    case 3:
      "the axis"
    case _:
      "nothing"

# w: the width the contact needs; v: the width the face or the other
# spring leaves; the reason names both and w - v.
def bnd_vd.over(+spring: Bool, +lead: String, +by: U32, +id: U32, +w: R.Real, +v: R.Real) -> Vd:
  match spring:
    case True{}:
      Refuse{"blend-overlap", lead ++ by_name(by, id) ++ " lies at " ++ K.show_sci(v) ++ " (short by " ++ K.show_gap(R.sub(w, v)) ++ "; blends overlap)"}
    case False{}:
      Refuse{"overflow", lead ++ by_name(by, id) ++ " limits the face to " ++ K.show_sci(v) ++ " (short by " ++ K.show_gap(R.sub(w, v)) ++ ")"}

# An overflowing side is admitted when stage 3 makes it a notch
# (notch.bend); otherwise the stage-1 refusal, with the notch's reason.
def bnd_vd.nt(+m: Maybe<&2, N.Nt>, +old: Vd) -> Vd:
  match m:
    case Some{N.NtFace{_, _, _, _, _, _}}:
      Admit{}
    case Some{N.NtMeet{_, _, _, _, _}}:
      Admit{}
    case Some{N.NtNo{_, _, cls, why}}:
      match old:
        case Refuse{_, ow}:
          Refuse{cls, ow ++ "; no notch: " ++ why}
        case Admit{}:
          Refuse{cls, why}
    case _:
      old

def bnd_vd.st(+st: U32, +k: U32, +f: U32, +w: R.Real, +v: R.Real, +by: U32, +id: U32, +m: Maybe<&2, N.Nt>) -> Vd:
  match st:
    case 2:
      bnd_vd.nt(m, bnd_vd.over(U32.is_eq(by, 2), "the contact of edge " ++ K.show_u32(k) ++ " on face " ++ K.show_u32(f) ++ " needs width " ++ K.show_sci(w) ++ " but ", by, id, w, v))
    case 3:
      Refuse{"not-implemented", "width bound of edge " ++ K.show_u32(k) ++ " on face " ++ K.show_u32(f) ++ ": an obstacle curve of this face has no exact bound yet"}
    case _:
      Admit{}

def bnd_vd(+bd: B.Bnd, +k: U32, +f: U32, +m: Maybe<&2, N.Nt>) -> Vd:
  match bd:
    case B.Bnd{w, lim, st}:
      match lim:
        case B.Lim{_, v, by, id, _}:
          bnd_vd.st(st, k, f, w, v, by, id, m)

def vd_first(+a: Vd, +b: Vd) -> Vd:
  match a:
    case Admit{}:
      b
    case Refuse{c, w}:
      Refuse{c, w}

def ends_vd(+es: List<&2, B.End>) -> Vd:
  match es:
    case Nil{}:
      Admit{}
    case B.ENo{_, cls, why} <> _:
      Refuse{cls, why}
    case _ <> t:
      ends_vd(t)

def stripes_vd(+ss: List<&2, L.Stripe>) -> Vd:
  match ss:
    case Nil{}:
      Admit{}
    case L.NoSt{_, cls, why} <> _:
      Refuse{cls, why}
    case _ <> t:
      stripes_vd(t)

def bounds_vd(+ss: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +nts: List<&2, N.Nt>) -> Vd:
  match ss:
    case Nil{}:
      Admit{}
    case L.St{k, _, _, _, _, _, _, _, s1, s2, _, _, _, _} <> t:
      match ps:
        case B.Post{b1, b2, _} <> pt:
          vd_first(vd_first(bnd_vd(b1, k, L.side_face(s1), N.find(nts, k, 1)), bnd_vd(b2, k, L.side_face(s2), N.find(nts, k, 2))), bounds_vd(t, pt, nts))
        case _ <> pt:
          bounds_vd(t, pt, nts)
        case Nil{}:
          Admit{}
    case L.NoSt{_, _, _} <> t:
      match ps:
        case _ <> pt:
          bounds_vd(t, pt, nts)
        case Nil{}:
          Admit{}

def census_vd(+ps: List<&2, B.Post>) -> Vd:
  match ps:
    case Nil{}:
      Admit{}
    case B.Post{_, _, ends} <> t:
      vd_first(ends_vd(ends), census_vd(t))
    case B.PostNo{} <> t:
      census_vd(t)

def corners_vd(+cs: List<&2, C.Cor>) -> Vd:
  match cs:
    case Nil{}:
      Admit{}
    case C.CorNo{_, cls, why} <> _:
      Refuse{cls, why}
    case _ <> t:
      corners_vd(t)

# ---------------------------------------------------------------------------
# The ladder of a job

type Out is Data:
  Out{id: String, chamfer: Bool, size: R.Real, prop: Bool, notes: List<&2, String>, order: List<&2, U32>, ss: List<&2, L.Stripe>, ps: List<&2, B.Post>, cs: List<&2, C.Cor>, ms: List<&2, String>, vd: Vd, net: C.Net, sin: S.Sin, srg: S.Srg}
  OutNo{id: String, cls: String, why: String}

def fuel() -> Nat:
  12n

# Notched sides for the cap tips, and the faces the notches consume
# (kind 3: face notch, with = the bound edge; kind 4: meet, with = the other
# stripe, once per pair).
def nks_of(+ts: List<&2, N.Nt>, +acc: List<&2, C.Nk>) -> List<&2, C.Nk>:
  match ts:
    case Nil{}:
      List.reverse(&2, C.Nk, acc)
    case N.NtFace{k, i, _, _, _, _} <> t:
      nks_of(t, C.Nk{k, i, 1} <> acc)
    case N.NtMeet{k, i, _, _, _} <> t:
      nks_of(t, C.Nk{k, i, 2} <> acc)
    case _ <> t:
      nks_of(t, acc)

def nt_eats(+ts: List<&2, N.Nt>, +acc: List<&2, C.Eat>) -> List<&2, C.Eat>:
  match ts:
    case Nil{}:
      List.reverse(&2, C.Eat, acc)
    case N.NtFace{k, _, s, b, _, _} <> t:
      nt_eats(t, C.Eat{s, k, 3, b} <> acc)
    case N.NtMeet{k, _, s, j, _} <> t:
      nt_eats(t, Bool.pick(List<&2, C.Eat>, U32.is_lt(k, j), C.Eat{s, k, 4, j} <> acc, acc))
    case _ <> t:
      nt_eats(t, acc)

# The corner network, once the ladder admits the case (on the stripes with
# their notch points, ssn).
def net_if(+vd: Vd, +b: J.Body, +ch: Bool, +size: R.Real, +ssn: List<&2, L.Stripe>, +ps: List<&2, B.Post>, +cs: List<&2, C.Cor>, +nts: List<&2, N.Nt>) -> C.Net:
  match vd:
    case Admit{}:
      +ts = C.tips(ssn, ps, b, ssn, cs, ch, size, nks_of(nts, Nil{}))
      C.Net{ts, cs, List.append(&2, C.Eat, C.eats(ssn, ps, b, ssn, ts), nt_eats(nts, Nil{}))}
    case Refuse{_, _}:
      C.Net{Nil{}, Nil{}, Nil{}}

def solve.res(+r: Res, +id: String, +b: J.Body, +ch: Bool, +size: R.Real, +prop: Bool) -> Out:
  match r:
    case ResNo{cls, why}:
      OutNo{id, cls, why}
    case Res{sel, notes}:
      +n = List.length(&2, U32, sel)
      +ss = solve_all(fuel(), L.Task{b, ch, size}, sel, n)
      +ps = post_all(fuel(), b, ss, sel, ss, n)
      +nts = N.notches(ss, ps, b, ss, size, ch, Nil{})
      +ssn = N.apply(ss, nts, Nil{})
      +cs = C.corner_list(corner_vs(ps, Nil{}), b, ssn, sel, ch, size)
      +vd = vd_first(vd_first(stripes_vd(ss), bounds_vd(ss, ps, nts)), vd_first(census_vd(ps), corners_vd(cs)))
      Out{id, ch, size, prop, notes, sel, ss, ps, cs, merges(ss, ps, ss, Nil{}), vd, net_if(vd, b, ch, size, ssn, ps, cs, nts), S.Sin{b, ssn, nts}, S.SrgNo{"not-implemented", "surgery not run"}}

def solve0(+j: J.Job) -> Out:
  match j:
    case J.Bad{why}:
      OutNo{"?", "invalid-input", why}
    case J.Job{id, ch, size, prop, b, sel}:
      solve.res(resolve(b, sel, prop), id, b, ch, size, prop)

# Stage 3: the surgery, once the ladder and the network admit the case.
def finish.nv(+nv: C.Nv, +o: Out) -> Out:
  match nv:
    case C.NvNo{_, _}:
      o
    case C.NvOk{}:
      match o:
        case Out{id, ch, size, prop, notes, order, ss, ps, cs, ms, vd, net, sin, _}:
          Out{id, ch, size, prop, notes, order, ss, ps, cs, ms, vd, net, sin, S.surgery(sin, ch, size, net)}
        case OutNo{id, cls, why}:
          OutNo{id, cls, why}

def finish.vd(+vd: Vd, +o: Out, +net: C.Net) -> Out:
  match vd:
    case Refuse{_, _}:
      o
    case Admit{}:
      finish.nv(C.net_nv(net), o)

def finish(+o: Out) -> Out:
  match o:
    case Out{_, _, _, _, _, _, _, _, _, _, vd, net, _, _}:
      finish.vd(vd, o, net)
    case OutNo{id, cls, why}:
      OutNo{id, cls, why}

def solve(+j: J.Job) -> Out:
  finish(solve0(j))

def parse(+text: String) -> J.Job:
  J.parse(text)

# ---------------------------------------------------------------------------
# Text

def w_u32(+n: U32) -> String:
  K.show_u32(n)

def w_real(+r: R.Real) -> String:
  R.Real{hi, lo} = r
  K.show_u32(F32.bits(hi)) ++ " " ++ K.show_u32(F32.bits(lo))

def w_vec(+v: G.Vec3) -> String:
  G.V3{x, y, z} = v
  w_real(x) ++ " " ++ w_real(y) ++ " " ++ w_real(z)

def w_p2(+p: K.P2) -> String:
  w_real(K.p2_x(p)) ++ " " ++ w_real(K.p2_y(p))

def w_bool(+b: Bool) -> String:
  Bool.pick(String, b, "1", "0")

def w_surf(+s: J.Surf) -> String:
  match s:
    case J.SPlane{o, n, x}:
      "plane " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " " ++ w_vec(x)
    case J.SCyl{o, a, x, r}:
      "cylinder " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(r)
    case J.SCone{o, a, x, r, ang}:
      "cone " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(r) ++ " " ++ w_real(ang)
    case J.SSphere{o, a, x, r}:
      "sphere " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(r)
    case J.STorus{o, a, x, big, small}:
      "torus " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(x) ++ " " ++ w_real(big) ++ " " ++ w_real(small)

# A spring (contact curve) or the spine through the section point p.
def w_track(+sec: K.Sec, +p: K.P2) -> String:
  match sec:
    case K.Tra{_, d, _, _, len}:
      "line " ++ w_vec(K.sec_lift(sec, p)) ++ " " ++ w_vec(d) ++ " " ++ w_real(len)
    case K.Rot{o, a, r, _}:
      "circle " ++ w_vec(K.axpy(o, K.p2_y(p), a)) ++ " " ++ w_vec(a) ++ " " ++ w_vec(r) ++ " " ++ w_real(K.p2_x(p))

def w_sec(+sec: K.Sec) -> String:
  match sec:
    case K.Tra{e, d, u, w, len}:
      "translation " ++ w_vec(e) ++ " " ++ w_vec(d) ++ " " ++ w_vec(u) ++ " " ++ w_vec(w) ++ " " ++ w_real(len)
    case K.Rot{o, a, r, closed}:
      "rotation " ++ w_vec(o) ++ " " ++ w_vec(a) ++ " " ++ w_vec(r) ++ " " ++ w_bool(closed)

def st_name(+st: U32) -> String:
  match st:
    case 0:
      "inside"
    case 1:
      "consumed"
    case 2:
      "overflow"
    case _:
      "unknown"

def by_word(+by: U32) -> String:
  match by:
    case 1:
      "edge"
    case 2:
      "spring"
    case 3:
      "axis"
    case _:
      "none"

def w_side(+i: String, +sec: K.Sec, +sd: L.Side, +bd: B.Bnd) -> String:
  match bd:
    case B.Bnd{w, lim, st}:
      match lim:
        case B.Lim{has, v, by, id, _}:
          "side " ++ i ++ " face " ++ w_u32(L.side_face(sd)) ++ " support " ++ K.surf_name(L.side_kind(sd)) ++ " contact " ++ w_vec(K.sec_lift(sec, L.side_p(sd))) ++ " width " ++ w_real(w) ++ " bound " ++ st_name(st) ++ " limit " ++ w_bool(has) ++ " " ++ w_real(v) ++ " by " ++ by_word(by) ++ " " ++ w_u32(id) ++ "\n" ++ "spring " ++ i ++ " " ++ w_track(sec, L.side_p(sd)) ++ "\n"

def w_end(+e: B.End) -> String:
  match e:
    case B.EClosed{}:
      "end closed\n"
    case B.ECap{v}:
      "end cap " ++ w_u32(v) ++ "\n"
    case B.EMitre{v, o, ext}:
      "end mitre " ++ w_u32(v) ++ " " ++ w_u32(o) ++ " " ++ Bool.pick(String, ext, "extended", "trimmed") ++ "\n"
    case B.EChain{v, o}:
      "end chain " ++ w_u32(v) ++ " " ++ w_u32(o) ++ "\n"
    case B.ECorner{v}:
      "end corner " ++ w_u32(v) ++ "\n"
    case B.ENo{v, cls, why}:
      "end refused " ++ w_u32(v) ++ " " ++ cls ++ " " ++ why ++ "\n"

def w_ends(+es: List<&2, B.End>) -> String:
  match es:
    case Nil{}:
      ""
    case e <> t:
      w_end(e) ++ w_ends(t)

def w_spine(+ch: Bool, +sec: K.Sec, +c: K.P2) -> String:
  match ch:
    case True{}:
      "spine none\n"
    case False{}:
      "spine " ++ w_track(sec, c) ++ "\n"

def w_post(+p: B.Post, +sec: K.Sec, +s1: L.Side, +s2: L.Side) -> String:
  match p:
    case B.Post{b1, b2, ends}:
      w_side("1", sec, s1, b1) ++ w_side("2", sec, s2, b2) ++ w_ends(ends)
    case B.PostNo{}:
      ""

def w_stripe(+ch: Bool, +st: L.Stripe, +p: B.Post) -> String:
  match st:
    case L.NoSt{k, cls, why}:
      "stripe " ++ w_u32(k) ++ " refused " ++ cls ++ " " ++ why ++ "\n"
    case L.St{k, f1, f2, convex, sin, cos, sec, e2, s1, s2, c2, kind, surf, same}:
      +head = "stripe " ++ w_u32(k) ++ " ok faces " ++ w_u32(f1) ++ " " ++ w_u32(f2) ++ " " ++ Bool.pick(String, convex, "convex", "concave") ++ " sin " ++ w_real(sin) ++ " cos " ++ w_real(cos) ++ " carrier " ++ L.kind_name(kind) ++ " sense " ++ w_bool(same) ++ "\n"
      +body = "section " ++ w_sec(sec) ++ "\n" ++ "corner2 " ++ w_p2(e2) ++ " centre2 " ++ w_p2(c2) ++ "\n" ++ "surface " ++ w_surf(surf) ++ "\n" ++ w_spine(ch, sec, c2)
      head ++ body ++ w_post(p, sec, s1, s2)

def w_stripes(+ch: Bool, +ss: List<&2, L.Stripe>, +ps: List<&2, B.Post>) -> String:
  match ss:
    case Nil{}:
      ""
    case s <> t:
      match ps:
        case p <> pt:
          w_stripe(ch, s, p) ++ w_stripes(ch, t, pt)
        case Nil{}:
          w_stripe(ch, s, B.PostNo{}) ++ w_stripes(ch, t, Nil{})

def w_vecs(+ps: List<&2, G.Vec3>) -> String:
  match ps:
    case Nil{}:
      ""
    case p <> t:
      " " ++ w_vec(p) ++ w_vecs(t)

def w_corner(+c: C.Cor) -> String:
  match c:
    case C.CorSph{v, ctr, r, _, _}:
      "corner " ++ w_u32(v) ++ " sphere " ++ w_vec(ctr) ++ " " ++ w_real(r) ++ "\n"
    case C.CorTri{v, _, _, qs}:
      "corner " ++ w_u32(v) ++ " triangle" ++ w_vecs(qs) ++ "\n"
    case C.CorNo{v, cls, why}:
      "corner " ++ w_u32(v) ++ " refused " ++ cls ++ " " ++ why ++ "\n"

def w_lines(+xs: List<&2, String>, +pre: String) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> t:
      pre ++ x ++ "\n" ++ w_lines(t, pre)

def w_u32s(+xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> t:
      " " ++ w_u32(x) ++ w_u32s(t)

def w_corners(+cs: List<&2, C.Cor>) -> String:
  match cs:
    case Nil{}:
      ""
    case c <> t:
      w_corner(c) ++ w_corners(t)

def w_vd(+vd: Vd, +n: U32) -> String:
  match vd:
    case Admit{}:
      "verdict admit " ++ w_u32(n) ++ "\n"
    case Refuse{cls, why}:
      "verdict refuse " ++ cls ++ " " ++ why ++ "\n"

# The ladder as data.
def show_ladder(+o: Out) -> String:
  match o:
    case OutNo{id, cls, why}:
      "wonky-fillet-ladder 1\ncase " ++ id ++ "\nverdict refuse " ++ cls ++ " " ++ why ++ "\nend\n"
    case Out{id, ch, size, prop, notes, order, ss, ps, cs, ms, vd, _, _, _}:
      +head = "wonky-fillet-ladder 1\ncase " ++ id ++ "\nop " ++ Bool.pick(String, ch, "chamfer", "fillet") ++ "\nsize " ++ w_real(size) ++ "\nchamfer-def " ++ Bool.pick(String, ch, "setback-along-faces", "none") ++ "\npropagate " ++ w_bool(prop) ++ "\n"
      head ++ w_lines(notes, "note ") ++ "order " ++ w_u32(K.count(U32, order)) ++ w_u32s(order) ++ "\n" ++ w_stripes(ch, ss, ps) ++ w_corners(cs) ++ w_lines(ms, "") ++ w_vd(vd, K.count(U32, order)) ++ "end\n"

def carriers(+ss: List<&2, L.Stripe>) -> String:
  match ss:
    case Nil{}:
      ""
    case L.St{k, _, _, _, _, _, _, _, _, _, _, kind, _, _} <> t:
      " " ++ w_u32(k) ++ ":" ++ L.kind_name(kind) ++ carriers(t)
    case L.NoSt{_, _, _} <> t:
      carriers(t)

# ---------------------------------------------------------------------------
# The corner network as data ("wonky-fillet-network 1")

def w_curve(+c: J.Curve) -> String:
  match c:
    case J.CLine{o, d}:
      "line " ++ w_vec(o) ++ " " ++ w_vec(d)
    case J.CCircle{o, n, x, r}:
      "circle " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " " ++ w_vec(x) ++ " " ++ w_real(r)
    case J.CEllipse{o, n, x, a, b}:
      "ellipse " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " " ++ w_vec(x) ++ " " ++ w_real(a) ++ " " ++ w_real(b)

def w_at(+a: C.At) -> String:
  match a:
    case C.AtEdge{e}:
      "edge " ++ w_u32(e)
    case C.AtFace{f}:
      "face " ++ w_u32(f)

def tip_word(+k: U32) -> String:
  match k:
    case 0:
      "cap"
    case 1:
      "mitre"
    case 2:
      "chain"
    case 3:
      "corner-sphere"
    case _:
      "corner-triangle"

# A setback mitre's second piece: " trim <side> face <f> pm <vec> cut <o> <n>
# curve <c> range <t0> <t1>" (side 2: the tip curve runs p1 -> pm, the trim
# pm -> p2; side 1: the trim p1 -> pm, the tip curve pm -> p2).
def w_trim(+tr: C.Tr) -> String:
  match tr:
    case C.TrNo{}:
      ""
    case C.Tr{f, side, pm, cut, arc}:
      C.Pl{o, n} = cut
      C.Arc{c, t0, t1} = arc
      " trim " ++ w_u32(side) ++ " face " ++ w_u32(f) ++ " pm " ++ w_vec(pm) ++ " cut " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " curve " ++ w_curve(c) ++ " range " ++ w_real(t0) ++ " " ++ w_real(t1)

def w_tip(+t: C.Tip) -> String:
  match t:
    case C.Tip{e, v, kind, with, cut, p1, a1, p2, a2, arc, tr}:
      C.Pl{o, n} = cut
      C.Arc{c, t0, t1} = arc
      "tip " ++ w_u32(e) ++ " " ++ w_u32(v) ++ " " ++ tip_word(kind) ++ " " ++ w_u32(with) ++ " cut " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " p1 " ++ w_vec(p1) ++ " " ++ w_at(a1) ++ " p2 " ++ w_vec(p2) ++ " " ++ w_at(a2) ++ " curve " ++ w_curve(c) ++ " range " ++ w_real(t0) ++ " " ++ w_real(t1) ++ w_trim(tr) ++ "\n"
    case C.TipClosed{e}:
      "tip " ++ w_u32(e) ++ " closed\n"
    case C.TipNo{e, v, cls, why}:
      "tip " ++ w_u32(e) ++ " " ++ w_u32(v) ++ " refused " ++ cls ++ " " ++ why ++ "\n"

def w_tips(+ts: List<&2, C.Tip>) -> String:
  match ts:
    case Nil{}:
      ""
    case t <> r:
      w_tip(t) ++ w_tips(r)

def w_ncorner(+c: C.Cor) -> String:
  match c:
    case C.CorSph{v, ctr, r, fs, ts}:
      "corner " ++ w_u32(v) ++ " sphere " ++ w_vec(ctr) ++ " " ++ w_real(r) ++ " faces" ++ w_u32s(fs) ++ " feet" ++ w_vecs(ts) ++ "\n"
    case C.CorTri{v, pl, fs, qs}:
      C.Pl{o, n} = pl
      "corner " ++ w_u32(v) ++ " triangle " ++ w_vec(o) ++ " " ++ w_vec(n) ++ " faces" ++ w_u32s(fs) ++ " feet" ++ w_vecs(qs) ++ "\n"
    case C.CorNo{v, cls, why}:
      "corner " ++ w_u32(v) ++ " refused " ++ cls ++ " " ++ why ++ "\n"

def w_ncorners(+cs: List<&2, C.Cor>) -> String:
  match cs:
    case Nil{}:
      ""
    case c <> t:
      w_ncorner(c) ++ w_ncorners(t)

def w_eat(+e: C.Eat) -> String:
  match e:
    case C.Eat{f, k, kind, with}:
      match kind:
        case 0:
          "consumed " ++ w_u32(f) ++ " merge " ++ w_u32(k) ++ " " ++ w_u32(with) ++ "\n"
        case 1:
          "consumed " ++ w_u32(f) ++ " edge " ++ w_u32(k) ++ " " ++ w_u32(with) ++ "\n"
        case 2:
          "consumed " ++ w_u32(f) ++ " axis " ++ w_u32(k) ++ "\n"
        case 3:
          "consumed " ++ w_u32(f) ++ " notch " ++ w_u32(k) ++ " " ++ w_u32(with) ++ "\n"
        case _:
          "consumed " ++ w_u32(f) ++ " meet " ++ w_u32(k) ++ " " ++ w_u32(with) ++ "\n"
    case C.EatNo{f, cls, why}:
      "consumed " ++ w_u32(f) ++ " refused " ++ cls ++ " " ++ why ++ "\n"

def w_eats(+es: List<&2, C.Eat>) -> String:
  match es:
    case Nil{}:
      ""
    case e <> t:
      w_eat(e) ++ w_eats(t)

def count_tips(+ts: List<&2, C.Tip>) -> U32:
  match ts:
    case Nil{}:
      0
    case C.Tip{_, _, _, _, _, _, _, _, _, _, _} <> t:
      (1 + count_tips(t) : U32)
    case _ <> t:
      count_tips(t)

def net_counts(+n: C.Net, +order: List<&2, U32>) -> String:
  C.Net{ts, cs, es} = n
  w_u32(K.count(U32, order)) ++ " stripes, " ++ w_u32(count_tips(ts)) ++ " tips, " ++ w_u32(K.count(C.Cor, cs)) ++ " corners, " ++ w_u32(K.count(C.Eat, es)) ++ " consumed faces"

def w_nv(+nv: C.Nv, +n: C.Net, +order: List<&2, U32>) -> String:
  match nv:
    case C.NvNo{cls, why}:
      "verdict refuse " ++ cls ++ " " ++ why ++ "\n"
    case C.NvOk{}:
      "verdict admit " ++ net_counts(n, order) ++ "\n"

def w_nverdict(+vd: Vd, +n: C.Net, +order: List<&2, U32>) -> String:
  match vd:
    case Refuse{cls, why}:
      "verdict refuse " ++ cls ++ " " ++ why ++ "\n"
    case Admit{}:
      w_nv(C.net_nv(n), n, order)

def show_network(+o: Out) -> String:
  match o:
    case OutNo{id, cls, why}:
      "wonky-fillet-network 1\ncase " ++ id ++ "\nverdict refuse " ++ cls ++ " " ++ why ++ "\nend\n"
    case Out{id, ch, size, _, _, order, _, _, _, _, vd, net, _, _}:
      C.Net{ts, cs, es} = net
      +head = "wonky-fillet-network 1\ncase " ++ id ++ "\nop " ++ Bool.pick(String, ch, "chamfer", "fillet") ++ "\nsize " ++ w_real(size) ++ "\n"
      head ++ w_tips(ts) ++ w_ncorners(cs) ++ w_eats(es) ++ w_nverdict(vd, net, order) ++ "end\n"

def show.srg(+r: S.Srg) -> String:
  match r:
    case S.SrgOk{text, _, _, _}:
      text
    case S.SrgNo{cls, why}:
      "unresolved " ++ cls ++ " " ++ why ++ "\nend\n"

# The harness result: the surgery's B-rep, or the first refusal.
def show.net(+nv: C.Nv, +o: Out) -> String:
  match nv:
    case C.NvNo{cls, why}:
      "unresolved " ++ cls ++ " " ++ why ++ "\nend\n"
    case C.NvOk{}:
      match o:
        case Out{_, _, _, _, _, _, _, _, _, _, _, _, _, srg}:
          show.srg(srg)
        case OutNo{_, cls, why}:
          "unresolved " ++ cls ++ " " ++ why ++ "\nend\n"

def show(+o: Out) -> String:
  match o:
    case OutNo{_, cls, why}:
      "unresolved " ++ cls ++ " " ++ why ++ "\nend\n"
    case Out{_, _, _, _, _, _, _, _, _, _, vd, net, _, _}:
      match vd:
        case Refuse{cls, why}:
          "unresolved " ++ cls ++ " " ++ why ++ "\nend\n"
        case Admit{}:
          show.net(C.net_nv(net), o)

def run(+job: String) -> String:
  show(solve(parse(job)))

def ladder(+job: String) -> String:
  show_ladder(solve(parse(job)))

def network(+job: String) -> String:
  show_network(solve(parse(job)))
