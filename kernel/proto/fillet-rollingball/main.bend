import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./io.bend as T
import ./job.bend as J
import ./geom.bend as S
import ./contact.bend as C

# Fillet prototype C "rollingball", stage 1: the contact-circle solver
# (docs/fillet/proto-rollingball.md). For every selected edge it solves the
# rolling-ball contact circles (chamfer: the setback contact pairs) at fixed
# edge parameters, each station independently (contact.bend), certifies each
# by its maximum ball residual and reports the sampled blend.
#
#   parse(job)   -> J.Parse                  (job.bend)
#   solve(p)     -> Solved                   stations of every selected edge,
#                                            fork-join over edges and stations
#   show(s)      -> result text              stage 1 builds no B-rep: a typed
#                                            refusal (`unresolved <class> ...`)
#   samples(s)   -> sample text              "wonky-fillet-samples 1", below
#   run(job) = show(solve(parse(job)));  sample(job) = samples(solve(parse(job)))
#
# Per edge 2^(DEPTH+1)+1 stations are solved at t0 + (t1−t0)·k/2^(DEPTH+1).
# The even ones are the sampled blend; the odd ones are midpoint checks that
# measure how far the sampled polyline (centre and both contact curves) is
# from the solved curve between two samples.
#
# Refusals, in this order per edge: a seam edge (used twice by one face) is
# ignored with a note; tangent-edge (|(n_A × n_B)·T| < 1e-7 at a station);
# mixed-convexity (the sign changes along the edge); radius-too-large (the
# ball centre crosses the axis or tube centre of a curved support);
# unsupported-surface (a chamfer setback that is not straight in its face);
# not-implemented (a station fails the 1e-9 mm certificate). The job's first
# refusing edge in selection order names the result.

type EdgeOut is Data:
  EDone{edge: U32, convex: U32, sts: List<&2, C.St>, res: R.Real, dev: R.Real, solved: Nat}
  ERefused{edge: U32, cls: String, why: String}
  ESeam{edge: U32}

type Solved is Data:
  SOk{id: String, op: U32, size: R.Real, outs: List<&2, EdgeOut>}
  SBad{why: String}

type Use3 is Data:
  Use3{face: U32, surf: J.Surf, same: U32, fwd: U32}

def depth() -> Nat:
  5n

def cert_tol() -> R.Real:
  R.from_f32(0.000000001)

def tangent_tol() -> R.Real:
  R.from_f32(0.0000001)

def one() -> R.Real:
  R.from_f32(1.0)

def sign_of(+b: U32) -> R.Real:
  Bool.pick(R.Real, U32.is_eq(b, 1), one(), R.neg(one()))

# ---------------------------------------------------------------------------
# Face uses of an edge

def use_face(+u: Use3) -> U32:
  Use3{f, _, _, _} = u
  f

def uses_in(+e: U32, +fi: U32, +surf: J.Surf, +same: U32, us: List<&2, J.Use>, +acc: List<&2, Use3>) -> List<&2, Use3>:
  match us:
    case Nil{}:
      acc
    case J.Use{+ed, +fwd} <> t:
      uses_in(e, fi, surf, same, t, Bool.pick(List<&2, Use3>, U32.is_eq(ed, e), Use3{fi, surf, same, fwd} <> acc, acc))

def uses_of(fs: List<&2, J.Face>, +e: U32, +fi: U32, acc: List<&2, Use3>) -> List<&2, Use3>:
  match fs:
    case Nil{}:
      List.reverse(&2, Use3, acc)
    case J.Face{same, surf, us, _} <> t:
      uses_of(t, e, (fi + 1 : U32), uses_in(e, fi, surf, same, us, acc))

# ---------------------------------------------------------------------------
# Stations: a fork-join tree over the station index

def tree(+d: Nat, +ctx: C.Ctx, +k0: U32) -> List<&2, C.St>:
  match d:
    case 0n:
      C.station(ctx, k0) <> Nil{}
    case 1n+p:
      +half = U32.from_nat(Nat.pow(2n, p))
      a b = tree(p, ctx, k0) tree(p, ctx, (k0 + half : U32))
      List.append(&2, C.St, a, b)

def st_res(+s: C.St) -> R.Real:
  C.St{_, _, _, _, _, _, res, _, _} = s
  res

def st_s(+s: C.St) -> R.Real:
  C.St{_, _, _, _, _, _, _, x, _} = s
  x

def st_kmin(+s: C.St) -> R.Real:
  C.St{_, _, _, _, _, _, _, _, k} = s
  k

def mid_dev(+a: G.Vec3, +m: G.Vec3, +b: G.Vec3) -> R.Real:
  S.norm(G.sub(m, G.scale(G.add(a, b), R.from_f32(0.5))))

def triple_dev(+a: C.St, +m: C.St, +b: C.St) -> R.Real:
  C.St{_, _, _, +ca, +pa, +qa, _, _, _} = a
  C.St{_, _, _, +cm, +pm, +qm, _, _, _} = m
  C.St{_, _, _, +cb, +pb, +qb, _, _, _} = b
  R.max(mid_dev(ca, cm, cb), R.max(mid_dev(pa, pm, pb), mid_dev(qa, qm, qb)))

# Stats over the solved stations: (max res, min |s|, min s, max s, min k).
type Stats is Data:
  EStats{res: R.Real, sabs: R.Real, smin: R.Real, smax: R.Real, kmin: R.Real}

def stats(sts: List<&2, C.St>, +acc: Stats) -> Stats:
  match sts:
    case Nil{}:
      acc
    case +h <> t:
      EStats{+res, +sabs, +smin, +smax, +kmin} = acc
      +s = st_s(h)
      stats(t, EStats{R.max(res, st_res(h)), R.min(sabs, R.abs(s)), R.min(smin, s), R.max(smax, s), R.min(kmin, st_kmin(h))})

# Max midpoint deviation over (even, odd, even) triples, and the even stations.
def walk(sts: List<&2, C.St>, +dev: R.Real, acc: List<&2, C.St>) -> R.Real & List<&2, C.St>:
  match sts:
    case +a <> +rest:
      match rest:
        case +m <> +rest2:
          match rest2:
            case +b <> _:
              walk(rest2, R.max(dev, triple_dev(a, m, b)), a <> acc)
            case Nil{}:
              (dev, List.reverse(&2, C.St, a <> acc))
        case Nil{}:
          (dev, List.reverse(&2, C.St, a <> acc))
    case Nil{}:
      (dev, List.reverse(&2, C.St, acc))

def classify.done(e: U32, +op: U32, +st: Stats, w: R.Real & List<&2, C.St>, n: Nat) -> EdgeOut:
  EStats{+res, _, +smin, _, _} = st
  (dev, evens) = w
  EDone{e, Bool.to_u32(R.less(R.from_f32(0.0), smin)), evens, res, dev, n}

def classify.k(+e: U32, +op: U32, +sts: List<&2, C.St>, +st: Stats) -> EdgeOut:
  EStats{+res, +sabs, +smin, +smax, +kmin} = st
  +zero = R.from_f32(0.0)
  +tangent = R.less(sabs, tangent_tol())
  +mixed = Bool.and(R.less(smin, zero), R.less(zero, smax))
  +flipped = Bool.and(U32.is_eq(op, 0), R.less(kmin, R.neg(cert_tol())))
  +uncertified = Bool.not(R.less(res, cert_tol()))
  +cham = U32.is_eq(op, 1)
  +bad = {ERefused{e, Bool.pick(String, cham, "unsupported-surface", "not-implemented"), Bool.pick(String, cham, "the equal-offset setback is not a straight line in a support face (certificate above 1e-9 mm)", "a contact circle does not certify to 1e-9 mm")} : EdgeOut}
  +ok = Bool.pick(EdgeOut, uncertified, bad, classify.done(e, op, st, walk(sts, zero, Nil{}), List.length(&2, C.St, sts)))
  +big = Bool.pick(EdgeOut, flipped, ERefused{e, "radius-too-large", "the ball centre crosses the axis of a curved support (radius above its curvature radius)"}, ok)
  +mix = Bool.pick(EdgeOut, mixed, ERefused{e, "mixed-convexity", "the edge changes from convex to concave along its length"}, big)
  Bool.pick(EdgeOut, tangent, ERefused{e, "tangent-edge", "the faces meet tangentially (|sin dihedral| < 1e-7); nothing to round"}, mix)

def classify(+e: U32, +op: U32, +sts: List<&2, C.St>) -> EdgeOut:
  classify.k(e, op, sts, stats(sts, EStats{R.from_f32(0.0), S.huge(), S.huge(), R.neg(S.huge()), S.huge()}))

# ---------------------------------------------------------------------------
# One edge

def edge.run(+e: U32, +op: U32, +size: R.Real, +curve: J.Curve, iv: R.Real & R.Real, +sa: S.PSurf, +ga: R.Real, +fa: R.Real, +sb: S.PSurf, +gb: R.Real, +fb: R.Real) -> EdgeOut:
  (+t0, +t1) = iv
  +dt = R.sub(t1, t0)
  +dsgn = Bool.pick(R.Real, R.less(dt, R.from_f32(0.0)), R.neg(one()), one())
  +m = U32.from_nat(Nat.pow(2n, 1n+depth()))
  +ctx = {C.Ctx{curve, t0, dt, dsgn, sa, ga, fa, sb, gb, fb, op, size, m} : C.Ctx}
  classify(e, op, List.append(&2, C.St, tree(1n+depth(), ctx, 0), C.station(ctx, m) <> Nil{}))

def edge.ctx(+e: U32, +op: U32, +size: R.Real, +ed: J.Edge, +vs: List<&2, G.Vec3>, +ua: Use3, +ub: Use3) -> EdgeOut:
  J.Edge{_, _, +curve, _, _, _, _} = ed
  Use3{_, +sa, +ga, +fa} = ua
  Use3{_, +sb, +gb, +fb} = ub
  edge.run(e, op, size, curve, S.interval(ed, vs), S.prep(sa), sign_of(ga), sign_of(fa), S.prep(sb), sign_of(gb), sign_of(fb))

def edge.uses(+e: U32, +op: U32, +size: R.Real, +ed: J.Edge, +vs: List<&2, G.Vec3>, us: List<&2, Use3>) -> EdgeOut:
  match us:
    case +ua <> +rest:
      match rest:
        case +ub <> +rest2:
          match rest2:
            case Nil{}:
              Bool.pick(EdgeOut, U32.is_eq(use_face(ua), use_face(ub)), ESeam{e}, edge.ctx(e, op, size, ed, vs, ua, ub))
            case _:
              ERefused{e, "invalid-input", "the edge is used by more than two faces"}
        case Nil{}:
          ERefused{e, "invalid-input", "the edge is used by one face only"}
    case Nil{}:
      ERefused{e, "invalid-input", "the edge is used by no face"}

def edge.found(+e: U32, +op: U32, +size: R.Real, m: Maybe<&2, J.Edge>, +vs: List<&2, G.Vec3>, +fs: List<&2, J.Face>) -> EdgeOut:
  match m:
    case Some{+ed}:
      edge.uses(e, op, size, ed, vs, uses_of(fs, e, 0, Nil{}))
    case None{}:
      ERefused{e, "invalid-input", "the selected edge index is out of range"}

def edge.solve(+job: J.Job, +e: U32) -> EdgeOut:
  J.Job{_, +op, +size, +vs, +es, +fs, _} = job
  edge.found(e, op, size, List.get(&2, J.Edge, es, U32.to_nat(e)), vs, fs)

# Fork-join over the selected edges (halving; fuel = number of edges).
def edges.par(+fuel: Nat, +job: J.Job, sel: List<&2, U32>) -> List<&2, EdgeOut>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+f:
      match sel:
        case Nil{}:
          Nil{}
        case +x <> +rest:
          match rest:
            case Nil{}:
              edge.solve(job, x) <> Nil{}
            case +y <> +t:
              +all = {x <> y <> t : List<&2, U32>}
              +h = Nat.div(List.length(&2, U32, all), 2n)
              a b = edges.par(f, job, List.take(&2, U32, all, h)) edges.par(f, job, List.drop(&2, U32, all, h))
              List.append(&2, EdgeOut, a, b)

# ---------------------------------------------------------------------------
# Entry points

def parse(job: String) -> J.Parse:
  J.parse(job)

def solve.job(+job: J.Job) -> Solved:
  J.Job{+id, +op, +size, _, _, _, +sel} = job
  SOk{id, op, size, edges.par(List.length(&2, U32, sel), job, sel)}

def solve(p: J.Parse) -> Solved:
  match p:
    case J.Parsed{+job}:
      solve.job(job)
    case J.Malformed{why}:
      SBad{why}

# ---------------------------------------------------------------------------
# Result text (stage 1: always a typed refusal)

type Tally is Data:
  ETally{edges: Nat, stations: Nat, seams: String, refusal: Maybe<&2, String>}

def tally.first(+cur: Maybe<&2, String>, +line: String) -> Maybe<&2, String>:
  match cur:
    case Some{+x}:
      Some{x}
    case None{}:
      Some{line}

def tally.done(+acc: Tally, +n: Nat) -> Tally:
  ETally{+ne, +ns, +seams, +ref} = acc
  ETally{1n+ne, Nat.add(ns, n), seams, ref}

def tally.refused(+acc: Tally, +line: String) -> Tally:
  ETally{+ne, +ns, +seams, +ref} = acc
  ETally{ne, ns, seams, tally.first(ref, line)}

def tally.seam(+acc: Tally, +e: U32) -> Tally:
  ETally{+ne, +ns, +seams, +ref} = acc
  ETally{ne, ns, seams ++ " " ++ U32.show(e), ref}

def tally.one(+o: EdgeOut, +acc: Tally) -> Tally:
  match o:
    case EDone{_, _, _, _, _, +n}:
      tally.done(acc, n)
    case ERefused{+e, +cls, +why}:
      tally.refused(acc, cls ++ " edge " ++ U32.show(e) ++ ": " ++ why)
    case ESeam{+e}:
      tally.seam(acc, e)

def tally(outs: List<&2, EdgeOut>, +acc: Tally) -> Tally:
  match outs:
    case Nil{}:
      acc
    case +o <> t:
      tally(t, tally.one(o, acc))

def show.text(+ref: Maybe<&2, String>, +ne: Nat, +ns: Nat, +note: String) -> String:
  match ref:
    case Some{+line}:
      "unresolved " ++ line ++ note ++ "\nend\n"
    case None{}:
      match ne:
        case 0n:
          "unresolved invalid-input the selection holds only seam edges" ++ note ++ "\nend\n"
        case 1n+_:
          "unresolved not-implemented rolling-ball stage 1 solves contact circles only (no B-rep yet): " ++ Nat.show(ne) ++ " edges, " ++ Nat.show(ns) ++ " stations, every contact circle certified to 1e-9 mm (residuals and the sampled blend in the .samples output)" ++ note ++ "\nend\n"

def show.tally(+t: Tally) -> String:
  ETally{+ne, +ns, +seams, +ref} = t
  show.text(ref, ne, ns, Bool.pick(String, String.is_empty(seams), "", "; seam edges ignored:" ++ seams))

def show(s: Solved) -> String:
  match s:
    case SOk{_, _, _, outs}:
      show.tally(tally(outs, ETally{0n, 0n, "", None{}}))
    case SBad{why}:
      "unresolved invalid-input " ++ why ++ "\nend\n"

def run(job: String) -> String:
  show(solve(parse(job)))

# ---------------------------------------------------------------------------
# Sample text
#
#   wonky-fillet-samples 1
#   case <id>
#   op fillet|chamfer
#   size <real>
#   intervals <n>                         (samples per edge = n + 1)
#   edges <k>
#   edge <index> ok convex|concave <samples>
#   s <k> <t> <P> <c> <pA> <pB> <res> <s>  (k: index among the solved stations)
#   cert <max res> <midpoint deviation>
#   edge <index> unresolved <class> <reason words>
#   edge <index> seam ignored
#   end
#   (reals: two U32 words, the F32 bits of hi and lo)

def put_st(+s: C.St, rest: String) -> String:
  C.St{+k, +t, +p, +c, +pa, +pb, +res, +sv, _} = s
  T.put("s ", T.put_u32(k, T.sp(T.put_real(t, T.sp(T.put_vec3(p, T.sp(T.put_vec3(c, T.sp(T.put_vec3(pa, T.sp(T.put_vec3(pb, T.sp(T.put_real(res, T.sp(T.put_real(sv, T.nl(rest)))))))))))))))))

def put_sts(sts: List<&2, C.St>, rest: String) -> String:
  match sts:
    case Nil{}:
      rest
    case +h <> t:
      put_st(h, put_sts(t, rest))

def put_out(+o: EdgeOut, rest: String) -> String:
  match o:
    case EDone{+e, +cv, +sts, +res, +dev, _}:
      T.put("edge ", T.put_u32(e, T.put(Bool.pick(String, U32.is_eq(cv, 1), " ok convex ", " ok concave "), T.put(Nat.show(List.length(&2, C.St, sts)), T.nl(put_sts(sts, T.put("cert ", T.put_real(res, T.sp(T.put_real(dev, T.nl(rest)))))))))))
    case ERefused{+e, +cls, +why}:
      T.put("edge ", T.put_u32(e, T.put(" unresolved " ++ cls ++ " " ++ why, T.nl(rest))))
    case ESeam{+e}:
      T.put("edge ", T.put_u32(e, T.put(" seam ignored", T.nl(rest))))

def put_outs(outs: List<&2, EdgeOut>, rest: String) -> String:
  match outs:
    case Nil{}:
      rest
    case +h <> t:
      put_out(h, put_outs(t, rest))

def samples(s: Solved) -> String:
  match s:
    case SOk{+id, +op, +size, +outs}:
      +n = U32.from_nat(Nat.pow(2n, depth()))
      "wonky-fillet-samples 1\ncase " ++ id ++ "\nop " ++ Bool.pick(String, U32.is_eq(op, 0), "fillet", "chamfer") ++ "\nsize " ++ T.put_real(size, "\nintervals " ++ U32.show(n) ++ "\nedges " ++ Nat.show(List.length(&2, EdgeOut, outs)) ++ "\n" ++ put_outs(outs, "end\n"))
    case SBad{why}:
      "wonky-fillet-samples 1\ninvalid " ++ why ++ "\nend\n"

def sample(job: String) -> String:
  samples(solve(parse(job)))
