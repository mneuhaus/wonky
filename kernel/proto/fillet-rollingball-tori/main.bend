import Base
import ../fillet-rollingball/job.bend as J
import ../fillet-rollingball/solve2.bend as V
import ../fillet-rollingball/assemble.bend as A

# Fillet prototype C "rollingball", stage C2, variant C1 "tori": the spine (ball centres) fitted by arcs, so every blend is an exact cylinder, torus or sphere (fillet) or plane or cone (chamfer), with the measured deviation from the rolling-ball blend stated as its tolerance
# (docs/fillet/proto-rollingball.md). The solver, the fits and the B-rep
# surgery live in ../fillet-rollingball/; this directory only selects the
# output variant (0). Every blend face is labelled approximate (tol > 0),
# never exact.
#
#   parse(job) -> J.Parse; solve(p) = finish(stations(p)) -> A.Out;
#   show(o) -> result text; run(job) = show(solve(parse(job))).
# stations(p) is the contact-circle solve of every selected edge (fork-join
# over edges and stations; the Metal device call); finish(s) fits the blends
# and assembles the body on the CPU (its deep list walks overflow the GPU
# stack: "memory fault (machine stack overflow?)" on 68 of 70 cases when the
# whole build was the device call).

def variant() -> U32:
  0

def parse(job: String) -> J.Parse:
  J.parse(job)

def stations(+p: J.Parse) -> V.Solved2:
  V.solve(p)

def finish(+s: V.Solved2) -> A.Out:
  A.build.solved(variant(), s)

def solve(+p: J.Parse) -> A.Out:
  finish(stations(p))

def show(+o: A.Out) -> String:
  A.show(o)

def run(job: String) -> String:
  show(solve(parse(job)))
