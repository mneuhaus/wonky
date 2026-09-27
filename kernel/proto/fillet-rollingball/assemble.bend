import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as S
import ./contact.bend as C
import ./solve2.bend as V
import ./obrep.bend as O
import ./fit.bend as F
import ./brep.bend as B

# Stage C2 of prototype C (docs/fillet/proto-rollingball.md): the whole
# blended body. Shared by both output variants (0 "tori", 1 "spline"); only
# the blend surface differs (fit.bend).
#
#   build(job, variant) -> Out
#     1. solve every selected edge (solve2.bend: 65 stations, fork-join);
#     2. fit springs, sections and the blend surface of every edge
#        (brep.bend blend.of, fork-join over the edges);
#     3. the first refusal in selection order names the result; seam edges
#        are ignored with a note;
#     4. admission (stage-C2 scope) and overflow checks (brep.bend);
#     5. surgery (below): the full body with every face tagged.
#
# Surgery, per blend of edge e between face A (runs e forward) and face B
# (runs it reversed), open edge vs -> ve:
#   - vertices: vs and ve keep their index and move to the contact points on
#     A (a_s, a_e); b_s and b_e (contact points on B) are appended;
#   - edges: e becomes spring B (b_s -> b_e); every other edge at vs/ve keeps
#     the vertex when it lies on A and moves to b when it lies on B only.
#     A moved line is rebuilt between its new end points; a moved circle or
#     ellipse keeps its curve and loses its stated range (the interval is then
#     the one between its vertices, as for any unranged edge). Appended per
#     blend: spring A (a_s -> a_e), section XS (b_s -> a_s), section XE
#     (a_e -> b_e);
#   - faces: face A uses spring A where it used e; a loop that no longer
#     chains at a moved vertex (the caps) gets the section edge that joins the
#     two ends, in the direction that closes it; the blend face is
#     [-SA, -XS, +SB, -XE];
#   - a closed edge (rim) vs = ve: one b, spring A a -> a, one section X
#     (a -> b) used twice by the blend face [-SA, +X, +SB, -X];
#   - the sphere cap (spring A degenerates to the pole): face A is dropped, no
#     spring A, blend face [+X, +SB, -X].
# Roles: blend faces `blend` with the stated tolerance of fit.bend; faces
# that received a section `cap`; all others `support`, exact (tol 0).

type Alloc is Data:
  # vbs/vbe: indices of b_s and b_e (rims: both the one b); esa: spring A
  # (none() for the sphere cap); xs/xe: sections XS and XE (rims: both X)
  Alloc{vbs: U32, vbe: U32, esa: U32, xs: U32, xe: U32}

type BA is Data:
  BA{b: B.Blend, a: Alloc}

type Out is Data:
  OOk{body: O.OBody}
  ORef{cls: String, why: String}

def ba_b(+x: BA) -> B.Blend:
  BA{+b, _} = x
  b

def ba_a(+x: BA) -> Alloc:
  BA{_, +a} = x
  a

def al_vbs(+a: Alloc) -> U32:
  Alloc{+x, _, _, _, _} = a
  x

def al_vbe(+a: Alloc) -> U32:
  Alloc{_, +x, _, _, _} = a
  x

def al_esa(+a: Alloc) -> U32:
  Alloc{_, _, +x, _, _} = a
  x

def al_exs(+a: Alloc) -> U32:
  Alloc{_, _, _, +x, _} = a
  x

def al_exe(+a: Alloc) -> U32:
  Alloc{_, _, _, _, +x} = a
  x

# ---------------------------------------------------------------------------
# Index allocation (vertices and edges appended in blend order)
#
# Style note: the native backend limits a def or continuation to 255 words.
# A generic Bool.pick over records whose arguments include a recursive call
# exceeded it, so the list walks below select with a match in a helper
# (kind codes: 0 open edge, 1 rim, 2 sphere cap).

def kind_of(+b: B.Blend) -> U32:
  Bool.pick(U32, B.b_closed(b), Bool.pick(U32, B.b_dega(b), 2, 1), 0)

def alloc.one(+k: U32, +nv: U32, +ne: U32) -> Alloc:
  match k:
    case 0:
      Alloc{nv, (nv + 1 : U32), ne, (ne + 1 : U32), (ne + 2 : U32)}
    case 1:
      Alloc{nv, nv, ne, (ne + 1 : U32), (ne + 1 : U32)}
    case _:
      Alloc{nv, nv, B.none(), ne, ne}

def alloc.dv(+k: U32) -> U32:
  match k:
    case 0:
      2
    case _:
      1

def alloc.de(+k: U32) -> U32:
  match k:
    case 0:
      3
    case 1:
      2
    case _:
      1

def alloc(bs: List<&2, B.Blend>, +nv: U32, +ne: U32) -> List<&2, BA>:
  match bs:
    case Nil{}:
      Nil{}
    case +b <> t:
      +k = kind_of(b)
      BA{b, alloc.one(k, nv, ne)} <> alloc(t, (nv + alloc.dv(k) : U32), (ne + alloc.de(k) : U32))

# ---------------------------------------------------------------------------
# Moved vertices

type MV is Data:
  MNone{}
  MSome{a: G.Vec3, bi: U32, bp: G.Vec3, fa: U32, fb: U32}

# 1: v is the start vertex of the blend, 2: its end vertex, 0: neither.
def mv.which(+x: BA, +v: U32) -> U32:
  +b = ba_b(x)
  Bool.pick(U32, U32.is_eq(B.b_vs(b), v), 1, Bool.pick(U32, U32.is_eq(B.b_ve(b), v), 2, 0))

def mv.sel(+w: U32, +x: BA, +rest: MV) -> MV:
  match w:
    case 1:
      +b = ba_b(x)
      MSome{B.b_pas(b), al_vbs(ba_a(x)), B.b_pbs(b), B.b_fa(b), B.b_fb(b)}
    case 2:
      +b = ba_b(x)
      MSome{B.b_pae(b), al_vbe(ba_a(x)), B.b_pbe(b), B.b_fa(b), B.b_fb(b)}
    case _:
      rest

def mv_of(bas: List<&2, BA>, +v: U32) -> MV:
  match bas:
    case Nil{}:
      MNone{}
    case +x <> t:
      mv.sel(mv.which(x, v), x, mv_of(t, v))

def mv_some(+m: MV) -> Bool:
  match m:
    case MNone{}:
      False{}
    case MSome{_, _, _, _, _}:
      True{}

def mv_pos(+m: MV, +p: G.Vec3) -> G.Vec3:
  match m:
    case MNone{}:
      p
    case MSome{+a, _, _, _, _}:
      a

# New index and position of end vertex v of the (non-blend) edge g.
type VP is Data:
  VP{i: U32, p: G.Vec3}

def remap.side(+to_b: Bool, +v: U32, +a: G.Vec3, +bi: U32, +bp: G.Vec3) -> VP:
  match to_b:
    case True{}:
      VP{bi, bp}
    case False{}:
      VP{v, a}

def remap(+m: MV, +v: U32, +p: G.Vec3, +ef: List<&2, B.FP>, +g: U32) -> VP:
  match m:
    case MNone{}:
      VP{v, p}
    case MSome{+a, +bi, +bp, +fa, +fb}:
      remap.side(Bool.and(B.on_face(ef, g, fb), Bool.not(B.on_face(ef, g, fa))), v, a, bi, bp)

def verts.go(vs: List<&2, G.Vec3>, +bas: List<&2, BA>, +i: U32) -> List<&2, G.Vec3>:
  match vs:
    case Nil{}:
      Nil{}
    case +p <> t:
      mv_pos(mv_of(bas, i), p) <> verts.go(t, bas, (i + 1 : U32))

def new_verts.own(+k: U32, +b: B.Blend, +rest: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match k:
    case 0:
      B.b_pbs(b) <> B.b_pbe(b) <> rest
    case _:
      B.b_pbs(b) <> rest

def new_verts(bas: List<&2, BA>) -> List<&2, G.Vec3>:
  match bas:
    case Nil{}:
      Nil{}
    case +x <> t:
      +b = ba_b(x)
      new_verts.own(kind_of(b), b, new_verts(t))

# ---------------------------------------------------------------------------
# Edges

def ba.sel(+hit: Bool, +x: BA, +rest: Maybe<&2, BA>) -> Maybe<&2, BA>:
  match hit:
    case True{}:
      Some{x}
    case False{}:
      rest

def ba_of_edge(bas: List<&2, BA>, +e: U32) -> Maybe<&2, BA>:
  match bas:
    case Nil{}:
      None{}
    case +x <> t:
      ba.sel(U32.is_eq(B.b_e(ba_b(x)), e), x, ba_of_edge(t, e))

def edge.moved.k(+line: Bool, +si: U32, +ps: G.Vec3, +ei: U32, +pe: G.Vec3, +c: J.Curve, +same: U32) -> O.OEdge:
  match line:
    case True{}:
      F.shape_edge(si, ei, F.line_shape(ps, pe))
    case False{}:
      O.OEdge{si, ei, c, same, 0, F.zero(), F.zero()}

def edge.moved(+s: VP, +e: VP, +ed: J.Edge) -> O.OEdge:
  VP{+si, +ps} = s
  VP{+ei, +pe} = e
  J.Edge{_, _, +c, +same, _, _, _} = ed
  edge.moved.k(S.is_line(c), si, ps, ei, pe, c, same)

def edge.plain.k(+moved: Bool, +ed: J.Edge, +vs: List<&2, G.Vec3>, +ef: List<&2, B.FP>, +bas: List<&2, BA>, +i: U32) -> O.OEdge:
  match moved:
    case True{}:
      J.Edge{+s, +e, _, _, _, _, _} = ed
      edge.moved(remap(mv_of(bas, s), s, S.nth_v(vs, s), ef, i), remap(mv_of(bas, e), e, S.nth_v(vs, e), ef, i), ed)
    case False{}:
      J.Edge{+s, +e, +c, +same, +ranged, +first, +last} = ed
      O.OEdge{s, e, c, same, ranged, first, last}

def edge.plain(+ed: J.Edge, +vs: List<&2, G.Vec3>, +ef: List<&2, B.FP>, +bas: List<&2, BA>, +i: U32) -> O.OEdge:
  J.Edge{+s, +e, _, _, _, _, _} = ed
  edge.plain.k(Bool.or(mv_some(mv_of(bas, s)), mv_some(mv_of(bas, e))), ed, vs, ef, bas, i)

def edge.out(+m: Maybe<&2, BA>, +ed: J.Edge, +vs: List<&2, G.Vec3>, +ef: List<&2, B.FP>, +bas: List<&2, BA>, +i: U32) -> O.OEdge:
  match m:
    case Some{+x}:
      +a = ba_a(x)
      F.shape_edge(al_vbs(a), al_vbe(a), B.b_spb(ba_b(x)))
    case None{}:
      edge.plain(ed, vs, ef, bas, i)

def edges.go(es: List<&2, J.Edge>, +vs: List<&2, G.Vec3>, +ef: List<&2, B.FP>, +bas: List<&2, BA>, +i: U32) -> List<&2, O.OEdge>:
  match es:
    case Nil{}:
      Nil{}
    case +ed <> t:
      edge.out(ba_of_edge(bas, i), ed, vs, ef, bas, i) <> edges.go(t, vs, ef, bas, (i + 1 : U32))

# Spring A, then the sections (index order of alloc).
def extra.own(+k: U32, +x: BA, +rest: List<&2, O.OEdge>) -> List<&2, O.OEdge>:
  match k:
    case 0:
      +b = ba_b(x)
      +a = ba_a(x)
      F.shape_edge(B.b_vs(b), B.b_ve(b), B.b_spa(b)) <> F.shape_edge(al_vbs(a), B.b_vs(b), B.b_xs(b)) <> F.shape_edge(B.b_ve(b), al_vbe(a), B.b_xe(b)) <> rest
    case 1:
      +b = ba_b(x)
      +a = ba_a(x)
      F.shape_edge(B.b_vs(b), B.b_ve(b), B.b_spa(b)) <> F.shape_edge(B.b_vs(b), al_vbs(a), B.b_xs(b)) <> rest
    case _:
      +b = ba_b(x)
      +a = ba_a(x)
      F.shape_edge(B.b_vs(b), al_vbs(a), B.b_xs(b)) <> rest

def extra_edges(bas: List<&2, BA>) -> List<&2, O.OEdge>:
  match bas:
    case Nil{}:
      Nil{}
    case +x <> t:
      extra.own(kind_of(ba_b(x)), x, extra_edges(t))

# ---------------------------------------------------------------------------
# Faces

type Sec is Data:
  Sec{idx: U32, from: U32, to: U32}

def secs.own(+k: U32, +x: BA, +rest: List<&2, Sec>) -> List<&2, Sec>:
  match k:
    case 0:
      +b = ba_b(x)
      +a = ba_a(x)
      Sec{al_exs(a), al_vbs(a), B.b_vs(b)} <> Sec{al_exe(a), B.b_ve(b), al_vbe(a)} <> rest
    case _:
      +b = ba_b(x)
      +a = ba_a(x)
      Sec{al_exs(a), B.b_vs(b), al_vbs(a)} <> rest

def secs(bas: List<&2, BA>) -> List<&2, Sec>:
  match bas:
    case Nil{}:
      Nil{}
    case +x <> t:
      secs.own(kind_of(ba_b(x)), x, secs(t))

def oe.or(m: Maybe<&2, O.OEdge>) -> O.OEdge:
  match m:
    case Some{e}:
      e
    case None{}:
      O.OEdge{B.none(), B.none(), J.BadCurve{}, 0, 0, F.zero(), F.zero()}

def oe_at(+es: List<&2, O.OEdge>, +i: U32) -> O.OEdge:
  oe.or(List.get(&2, O.OEdge, es, U32.to_nat(i)))

def oe_start(+e: O.OEdge) -> U32:
  O.OEdge{+s, _, _, _, _, _, _} = e
  s

def oe_end(+e: O.OEdge) -> U32:
  O.OEdge{_, +x, _, _, _, _, _} = e
  x

def use_from(+es: List<&2, O.OEdge>, +u: J.Use) -> U32:
  J.Use{+e, +f} = u
  +ed = oe_at(es, e)
  Bool.pick(U32, U32.is_eq(f, 1), oe_start(ed), oe_end(ed))

def use_to(+es: List<&2, O.OEdge>, +u: J.Use) -> U32:
  J.Use{+e, +f} = u
  +ed = oe_at(es, e)
  Bool.pick(U32, U32.is_eq(f, 1), oe_end(ed), oe_start(ed))

# 1: the section runs x -> y, 2: y -> x, 0: neither.
def sec.dir(+s: Sec, +x: U32, +y: U32) -> U32:
  Sec{_, +f, +to} = s
  Bool.pick(U32, Bool.and(U32.is_eq(f, x), U32.is_eq(to, y)), 1, Bool.pick(U32, Bool.and(U32.is_eq(f, y), U32.is_eq(to, x)), 2, 0))

def sec_idx(+s: Sec) -> U32:
  Sec{+i, _, _} = s
  i

def sec.sel(+d: U32, +s: Sec, +rest: List<&2, J.Use>) -> List<&2, J.Use>:
  match d:
    case 1:
      J.Use{sec_idx(s), 1} <> Nil{}
    case 2:
      J.Use{sec_idx(s), 0} <> Nil{}
    case _:
      rest

def sec_use(ss: List<&2, Sec>, +x: U32, +y: U32) -> List<&2, J.Use>:
  match ss:
    case Nil{}:
      Nil{}
    case +s <> t:
      sec.sel(sec.dir(s, x, y), s, sec_use(t, x, y))

def gap.k(+same: Bool, +ss: List<&2, Sec>, +x: U32, +y: U32) -> List<&2, J.Use>:
  match same:
    case True{}:
      Nil{}
    case False{}:
      sec_use(ss, x, y)

def gap(+es: List<&2, O.OEdge>, +ss: List<&2, Sec>, +u: J.Use, +nxt: J.Use) -> List<&2, J.Use>:
  +x = use_to(es, u)
  +y = use_from(es, nxt)
  gap.k(U32.is_eq(x, y), ss, x, y)

def head_or(+xs: List<&2, J.Use>, +d: J.Use) -> J.Use:
  match xs:
    case Nil{}:
      d
    case +h <> _:
      h

# Walk a loop; after every use insert the section that joins it to the next
# one when they no longer meet (cyclic: the last use joins the first).
def fill(us: List<&2, J.Use>, +first: J.Use, +es: List<&2, O.OEdge>, +ss: List<&2, Sec>) -> List<&2, J.Use>:
  match us:
    case Nil{}:
      Nil{}
    case +u <> +t:
      u <> List.append(&2, J.Use, gap(es, ss, u, head_or(t, first)), fill(t, first, es, ss))

def fill_loop(+us: List<&2, J.Use>, +es: List<&2, O.OEdge>, +ss: List<&2, Sec>) -> List<&2, J.Use>:
  match us:
    case Nil{}:
      Nil{}
    case +h <> +t:
      fill(h <> t, h, es, ss)

def swap.k(+hit: Bool, +x: BA, +e: U32, +f: U32) -> J.Use:
  match hit:
    case True{}:
      J.Use{al_esa(ba_a(x)), f}
    case False{}:
      J.Use{e, f}

def swap_edge(+m: Maybe<&2, BA>, +fi: U32, +e: U32, +f: U32) -> J.Use:
  match m:
    case Some{+x}:
      swap.k(U32.is_eq(B.b_fa(ba_b(x)), fi), x, e, f)
    case None{}:
      J.Use{e, f}

# Face A uses spring A where it used the blend edge.
def swap_uses(us: List<&2, J.Use>, +fi: U32, +bas: List<&2, BA>) -> List<&2, J.Use>:
  match us:
    case Nil{}:
      Nil{}
    case +u <> t:
      J.Use{+e, +f} = u
      swap_edge(ba_of_edge(bas, e), fi, e, f) <> swap_uses(t, fi, bas)

def out_loops(ls: List<&2, J.Loop>, +fi: U32, +bas: List<&2, BA>, +es: List<&2, O.OEdge>, +ss: List<&2, Sec>) -> List<&2, O.OLoop>:
  match ls:
    case Nil{}:
      Nil{}
    case +l <> t:
      J.Loop{+outer, +us} = l
      O.OLoop{outer, fill_loop(swap_uses(us, fi, bas), es, ss)} <> out_loops(t, fi, bas, es, ss)

def loop_len(+l: O.OLoop) -> Nat:
  O.OLoop{_, +us} = l
  List.length(&2, J.Use, us)

def uses_count(ls: List<&2, O.OLoop>) -> Nat:
  match ls:
    case Nil{}:
      0n
    case +h <> t:
      Nat.add(loop_len(h), uses_count(t))

def out_face(+f: J.Face, +fi: U32, +bas: List<&2, BA>, +es: List<&2, O.OEdge>, +ss: List<&2, Sec>) -> O.OFace:
  J.Face{+same, +surf, +us, +ls} = f
  +ol = out_loops(ls, fi, bas, es, ss)
  +grew = Nat.is_gt(uses_count(ol), List.length(&2, J.Use, us))
  O.OFace{same, O.OAn{surf}, Bool.pick(String, grew, "cap", "support"), F.zero(), ol}

# Face A of a sphere cap disappears.
def dropped(bas: List<&2, BA>, +fi: U32) -> Bool:
  match bas:
    case Nil{}:
      False{}
    case +x <> t:
      +b = ba_b(x)
      Bool.or(Bool.and(B.b_dega(b), U32.is_eq(B.b_fa(b), fi)), dropped(t, fi))

def faces.sel(+drop: Bool, +f: J.Face, +fi: U32, +bas: List<&2, BA>, +es: List<&2, O.OEdge>, +ss: List<&2, Sec>, +rest: List<&2, O.OFace>) -> List<&2, O.OFace>:
  match drop:
    case True{}:
      rest
    case False{}:
      out_face(f, fi, bas, es, ss) <> rest

def faces.go(fs: List<&2, J.Face>, +fi: U32, +bas: List<&2, BA>, +es: List<&2, O.OEdge>, +ss: List<&2, Sec>) -> List<&2, O.OFace>:
  match fs:
    case Nil{}:
      Nil{}
    case +f <> t:
      faces.sel(dropped(bas, fi), f, fi, bas, es, ss, faces.go(t, (fi + 1 : U32), bas, es, ss))

def blend_face.uses(+k: U32, +a: Alloc, +e: U32) -> List<&2, J.Use>:
  match k:
    case 0:
      J.Use{al_esa(a), 0} <> J.Use{al_exs(a), 0} <> J.Use{e, 1} <> J.Use{al_exe(a), 0} <> Nil{}
    case 1:
      J.Use{al_esa(a), 0} <> J.Use{al_exs(a), 1} <> J.Use{e, 1} <> J.Use{al_exs(a), 0} <> Nil{}
    case _:
      J.Use{al_exs(a), 1} <> J.Use{e, 1} <> J.Use{al_exs(a), 0} <> Nil{}

def blend_face(+x: BA) -> O.OFace:
  +b = ba_b(x)
  O.OFace{B.b_same(b), B.b_surf(b), "blend", B.b_tol(b), O.OLoop{1, blend_face.uses(kind_of(b), ba_a(x), B.b_e(b))} <> Nil{}}

def blend_faces(bas: List<&2, BA>) -> List<&2, O.OFace>:
  match bas:
    case Nil{}:
      Nil{}
    case +x <> t:
      blend_face(x) <> blend_faces(t)

def surgery(+job: J.Job, +ef: List<&2, B.FP>, +bl: List<&2, B.Blend>) -> O.OBody:
  +vs = B.job_verts(job)
  +es0 = B.job_edges(job)
  +bas = alloc(bl, U32.from_nat(List.length(&2, G.Vec3, vs)), U32.from_nat(List.length(&2, J.Edge, es0)))
  +verts = List.append(&2, G.Vec3, verts.go(vs, bas, 0), new_verts(bas))
  +es = List.append(&2, O.OEdge, edges.go(es0, vs, ef, bas, 0), extra_edges(bas))
  +fs = List.append(&2, O.OFace, faces.go(B.job_faces(job), 0, bas, es, secs(bas)), blend_faces(bas))
  O.OBody{verts, es, fs}

# ---------------------------------------------------------------------------
# Driver

# Fits of every solved edge, fork-join (halving; fuel = number of edges).
def fits.par(+fuel: Nat, +job: J.Job, +variant: U32, os: List<&2, V.Edge2>) -> List<&2, B.Built>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+f:
      match os:
        case Nil{}:
          Nil{}
        case +x <> +rest:
          match rest:
            case Nil{}:
              B.blend.of(job, variant, x) <> Nil{}
            case +y <> +t:
              +all = {x <> y <> t : List<&2, V.Edge2>}
              +h = Nat.div(List.length(&2, V.Edge2, all), 2n)
              a b = fits.par(f, job, variant, List.take(&2, V.Edge2, all, h)) fits.par(f, job, variant, List.drop(&2, V.Edge2, all, h))
              List.append(&2, B.Built, a, b)

type Coll is Data:
  Coll{blends: List<&2, B.Blend>, chk: B.Chk, seams: String}

def coll_add(+c: Coll, +b: B.Blend) -> Coll:
  Coll{+bl, +chk, +seams} = c
  Coll{List.append(&2, B.Blend, bl, b <> Nil{}), chk, seams}

def coll_ref(+c: Coll, +r: B.Chk) -> Coll:
  Coll{+bl, +chk, +seams} = c
  Coll{bl, B.chk_then(chk, r), seams}

def coll_seam(+c: Coll, +e: U32) -> Coll:
  Coll{+bl, +chk, +seams} = c
  Coll{bl, chk, seams ++ " " ++ U32.show(e)}

def collect.one(+x: B.Built, +c: Coll) -> Coll:
  match x:
    case B.BOk{+b}:
      coll_add(c, b)
    case B.BRef{+e, +cls, +why}:
      coll_ref(c, B.CRef{cls, "edge " ++ U32.show(e) ++ ": " ++ why})
    case B.BSeam{+e}:
      coll_seam(c, e)

def collect(xs: List<&2, B.Built>, +c: Coll) -> Coll:
  match xs:
    case Nil{}:
      c
    case +h <> t:
      collect(t, collect.one(h, c))

def blend_edges(bl: List<&2, B.Blend>) -> List<&2, U32>:
  match bl:
    case Nil{}:
      Nil{}
    case +b <> t:
      B.b_e(b) <> blend_edges(t)

def prefix(+e: U32, +c: B.Chk) -> B.Chk:
  match c:
    case B.COk{}:
      B.COk{}
    case B.CRef{+cls, +why}:
      B.CRef{cls, "edge " ++ U32.show(e) ++ ": " ++ why}

def admit_all(xs: List<&2, B.Blend>, +job: J.Job, +ef: List<&2, B.FP>, +sel: List<&2, U32>) -> B.Chk:
  match xs:
    case Nil{}:
      B.COk{}
    case +b <> t:
      B.chk_then(prefix(B.b_e(b), B.admit(job, ef, sel, b)), admit_all(t, job, ef, sel))

# Overflow checks of every blend against its faces, caps and the other
# blends: fork-join over the blends (halving; fuel = number of blends). The
# first refusal in selection order wins (chk_then keeps the left one).
def overflow_all(+fuel: Nat, xs: List<&2, B.Blend>, +job: J.Job, +ef: List<&2, B.FP>, +bl: List<&2, B.Blend>) -> B.Chk:
  match fuel:
    case 0n:
      B.COk{}
    case 1n+f:
      match xs:
        case Nil{}:
          B.COk{}
        case +x <> +rest:
          match rest:
            case Nil{}:
              prefix(B.b_e(x), B.overflow(job, ef, bl, x))
            case +y <> +t:
              +all = {x <> y <> t : List<&2, B.Blend>}
              +h = Nat.div(List.length(&2, B.Blend, all), 2n)
              a b = overflow_all(f, List.take(&2, B.Blend, all, h), job, ef, bl) overflow_all(f, List.drop(&2, B.Blend, all, h), job, ef, bl)
              B.chk_then(a, b)

def seam_note(+seams: String) -> String:
  Bool.pick(String, String.is_empty(seams), "", "; seam edges ignored:" ++ seams)

def build.overflow(+c: B.Chk, +job: J.Job, +ef: List<&2, B.FP>, +bl: List<&2, B.Blend>, +note: String) -> Out:
  match c:
    case B.COk{}:
      OOk{surgery(job, ef, bl)}
    case B.CRef{+cls, +why}:
      ORef{cls, why ++ note}

def build.admit(+c: B.Chk, +job: J.Job, +ef: List<&2, B.FP>, +bl: List<&2, B.Blend>, +note: String) -> Out:
  match c:
    case B.COk{}:
      build.overflow(overflow_all(List.length(&2, B.Blend, bl), bl, job, ef, bl), job, ef, bl, note)
    case B.CRef{+cls, +why}:
      ORef{cls, why ++ note}

def build.blends(+job: J.Job, +bl: List<&2, B.Blend>, +note: String) -> Out:
  +ef = B.efaces(job)
  build.admit(admit_all(bl, job, ef, blend_edges(bl)), job, ef, bl, note)

def build.chk(+chk: B.Chk, +job: J.Job, +bl: List<&2, B.Blend>, +note: String) -> Out:
  match chk:
    case B.COk{}:
      Bool.pick(Out, List.is_empty(&2, B.Blend, bl), ORef{"invalid-input", "the selection holds only seam edges" ++ note}, build.blends(job, bl, note))
    case B.CRef{+cls, +why}:
      ORef{cls, why ++ note}

def build.coll(+job: J.Job, +c: Coll) -> Out:
  Coll{+bl, +chk, +seams} = c
  build.chk(chk, job, bl, seam_note(seams))

def build.solved(+variant: U32, +s: V.Solved2) -> Out:
  match s:
    case V.S2Ok{+job, +outs}:
      build.coll(job, collect(fits.par(List.length(&2, V.Edge2, outs), job, variant, outs), Coll{Nil{}, B.COk{}, ""}))
    case V.S2Bad{+why}:
      ORef{"invalid-input", why}

def build(+p: J.Parse, +variant: U32) -> Out:
  build.solved(variant, V.solve(p))

def show(+o: Out) -> String:
  match o:
    case OOk{+b}:
      O.show(b)
    case ORef{+cls, +why}:
      "unresolved " ++ cls ++ " " ++ why ++ "\nend\n"
