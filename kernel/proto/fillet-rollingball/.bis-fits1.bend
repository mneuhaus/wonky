import Base
import ./job.bend as J
import ./solve2.bend as V
import ./brep.bend as B
import ./fit.bend as F
import ./assemble.bend as A

def m(+s: V.Solved2) -> String:
  match s:
    case V.S2Ok{+job, +outs}:
      Nat.show(List.length(&2, B.Built, A.fits.par(List.length(&2, V.Edge2, outs), job, 1, outs)))
    case V.S2Bad{w}:
      w

def go(args: List<String>) -> IO(Unit):
  match args:
    case a <> _:
      IO.print(m(V.solve(J.parse(a))))
    case Nil{}:
      IO.print("-")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    go(args)
