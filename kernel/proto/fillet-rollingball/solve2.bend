import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./geom.bend as S
import ./contact.bend as C
import ./main.bend as P

# Stage C2 of prototype C (docs/fillet/proto-rollingball.md): the station
# solve of stage C1, kept whole for the B-rep builders. Stage C1's `classify`
# keeps only the 33 even stations; the output variants need all 65 (the even
# ones build the blend, the odd ones certify it) and the two faces of the
# edge in a fixed order: face A uses the edge forward, face B reversed.
#
# Every station is still solved on its own (contact.bend), fork-join over the
# stations (P.tree) and over the selected edges (halving).

type Edge2 is Data:
  # fa/fb: face indices (A uses the edge forward); sts: all 2^(D+1)+1
  # stations in edge order (station 0 at the start vertex)
  EOk{edge: U32, convex: U32, fa: U32, fb: U32, sts: List<&2, C.St>, res: R.Real}
  ERef{edge: U32, cls: String, why: String}
  ESeam{edge: U32}

def ok_or_ref(+e: U32, +fa: U32, +fb: U32, +sts: List<&2, C.St>, o: P.EdgeOut) -> Edge2:
  match o:
    case P.EDone{_, +cv, _, +res, _, _}:
      EOk{e, cv, fa, fb, sts, res}
    case P.ERefused{_, +cls, +why}:
      ERef{e, cls, why}
    case P.ESeam{_}:
      ESeam{e}

def edge.run(+e: U32, +op: U32, +size: R.Real, +curve: J.Curve, iv: R.Real & R.Real, +ua: P.Use3, +ub: P.Use3) -> Edge2:
  (+t0, +t1) = iv
  P.Use3{+fa, +sa, +ga, _} = ua
  P.Use3{+fb, +sb, +gb, _} = ub
  +dt = R.sub(t1, t0)
  +dsgn = Bool.pick(R.Real, R.less(dt, R.from_f32(0.0)), R.neg(P.one()), P.one())
  +m = U32.from_nat(Nat.pow(2n, 1n+P.depth()))
  +ctx = {C.Ctx{curve, t0, dt, dsgn, S.prep(sa), P.sign_of(ga), P.one(), S.prep(sb), P.sign_of(gb), R.neg(P.one()), op, size, m} : C.Ctx}
  +sts = List.append(&2, C.St, P.tree(1n+P.depth(), ctx, 0), C.station(ctx, m) <> Nil{})
  ok_or_ref(e, fa, fb, sts, P.classify(e, op, sts))

# Order the two uses: A = the forward use.
def edge.ordered(+e: U32, +op: U32, +size: R.Real, +ed: J.Edge, +vs: List<&2, G.Vec3>, +ua: P.Use3, +ub: P.Use3) -> Edge2:
  J.Edge{_, _, +curve, _, _, _, _} = ed
  P.Use3{_, _, _, +fwda} = ua
  Bool.pick(Edge2, U32.is_eq(fwda, 1), edge.run(e, op, size, curve, S.interval(ed, vs), ua, ub), edge.run(e, op, size, curve, S.interval(ed, vs), ub, ua))

def edge.pair(+e: U32, +op: U32, +size: R.Real, +ed: J.Edge, +vs: List<&2, G.Vec3>, +ua: P.Use3, +ub: P.Use3) -> Edge2:
  P.Use3{_, _, _, +fwda} = ua
  P.Use3{_, _, _, +fwdb} = ub
  +good = Bool.not(U32.is_eq(fwda, fwdb))
  Bool.pick(Edge2, good, edge.ordered(e, op, size, ed, vs, ua, ub), ERef{e, "invalid-input", "the two faces of the edge run it in the same direction (inconsistent orientation)"})

def edge.uses(+e: U32, +op: U32, +size: R.Real, +ed: J.Edge, +vs: List<&2, G.Vec3>, us: List<&2, P.Use3>) -> Edge2:
  match us:
    case +ua <> +rest:
      match rest:
        case +ub <> +rest2:
          match rest2:
            case Nil{}:
              Bool.pick(Edge2, U32.is_eq(P.use_face(ua), P.use_face(ub)), ESeam{e}, edge.pair(e, op, size, ed, vs, ua, ub))
            case _:
              ERef{e, "invalid-input", "the edge is used by more than two faces"}
        case Nil{}:
          ERef{e, "invalid-input", "the edge is used by one face only"}
    case Nil{}:
      ERef{e, "invalid-input", "the edge is used by no face"}

def edge.found(+e: U32, +op: U32, +size: R.Real, m: Maybe<&2, J.Edge>, +vs: List<&2, G.Vec3>, +fs: List<&2, J.Face>) -> Edge2:
  match m:
    case Some{+ed}:
      edge.uses(e, op, size, ed, vs, P.uses_of(fs, e, 0, Nil{}))
    case None{}:
      ERef{e, "invalid-input", "the selected edge index is out of range"}

def edge.solve(+job: J.Job, +e: U32) -> Edge2:
  J.Job{_, +op, +size, +vs, +es, +fs, _} = job
  edge.found(e, op, size, List.get(&2, J.Edge, es, U32.to_nat(e)), vs, fs)

# Fork-join over the selected edges (halving; fuel = number of edges).
def edges.par(+fuel: Nat, +job: J.Job, sel: List<&2, U32>) -> List<&2, Edge2>:
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
              List.append(&2, Edge2, a, b)

type Solved2 is Data:
  S2Ok{job: J.Job, outs: List<&2, Edge2>}
  S2Bad{why: String}

def solve.job(+job: J.Job) -> Solved2:
  J.Job{_, _, _, _, _, _, +sel} = job
  S2Ok{job, edges.par(List.length(&2, U32, sel), job, sel)}

def solve(p: J.Parse) -> Solved2:
  match p:
    case J.Parsed{+job}:
      solve.job(job)
    case J.Malformed{why}:
      S2Bad{why}
