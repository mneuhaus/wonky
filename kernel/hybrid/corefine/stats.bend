import Base
import ../mesh-io.bend as MIO
import ./boolean.bend as B
import ./main.bend as C

# Diagnostic entry of corefine (docs/proto-corefine.md, "Statistics"); no
# production path imports it. It runs a job exactly as main.bend `run` does
# and appends one line with the statistics of the root Boolean
# (boolean.bend CSt):
#
#   <the text of main.bend run>
#   stats <rounds> <recollapsed> <dm>
#
#   rounds       repair rounds run (0: no T-junction or zero-width face);
#   recollapsed  rounds whose short-edge collapse renamed a vertex;
#   dm           the IEEE bits of an F32: the largest corner-to-chord distance
#                that only the triangulator's delta term judged flat, in units
#                of the job scale S (<= 2^-42 in production).
#
# `stats_k(job, k)` triangulates with delta = 2^-k * S instead of 2^-42 * S:
# a job refused at 2^-42 that builds with a larger delta shows the delta it
# would need (a finding about the construction error model; production's
# delta is never changed by it). Booleans below the root run as in
# production; a job whose root needs no Boolean prints `stats none`.

def halve(fuel: Nat, +x: F32) -> F32:
  match fuel:
    case 0n:
      x
    case 1n+p:
      halve(p, (x * 0.5 : F32))

# 2^-k (k <= 126).
def dk_of(+k: U32) -> F32:
  halve(U32.to_nat(k), 1.0)

def put_st(st: B.CSt, acc: String) -> String:
  B.CSt{rounds, recol, dm} = st
  MIO.put("stats ", MIO.put_u32(rounds, MIO.sp(MIO.put_u32(recol, MIO.sp(MIO.put_u32(F32.bits(dm), MIO.nl(acc)))))))

def shown(r: B.BRes, n: String) -> String:
  B.BRes{o, st} = r
  String.append(C.show(C.noted(C.bout_outcome(o), n)), put_st(st, ""))

def fin(d: C.Decided, +dk: F32) -> String:
  match d:
    case C.DcDone{e, n}:
      String.append(C.show(C.noted(C.to_outcome(e), n)), "stats none\n")
    case C.DcPost{pre, hp, hq, n}:
      shown(B.post_stats(pre, hp, hq, C.leaves(), dk), n)

def stats_k(job: String, +k: U32) -> String:
  fin(C.decide(C.begin(C.stage(C.parse(job)))), dk_of(k))

def stats(job: String) -> String:
  fin(C.decide(C.begin(C.stage(C.parse(job)))), B.delta_k())
