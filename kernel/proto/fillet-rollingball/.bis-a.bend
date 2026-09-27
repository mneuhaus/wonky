import Base
import ./job.bend as J
import ./solve2.bend as V

def n(+s: V.Solved2) -> String:
  match s:
    case V.S2Ok{_, outs}:
      Nat.show(List.length(&2, V.Edge2, outs))
    case V.S2Bad{w}:
      w

def go(args: List<String>) -> IO(Unit):
  match args:
    case a <> _:
      IO.print(n(V.solve(J.parse(a))))
    case Nil{}:
      IO.print("-")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    go(args)
