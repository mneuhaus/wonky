import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./contact.bend as C
import ./solve2.bend as V
import ./obrep.bend as O
import ./brep.bend as B
import ./fit.bend as F
import ./assemble.bend as A

def sts_of(+o: V.Edge2) -> List<&2, C.St>:
  match o:
    case V.EOk{_, _, _, _, +sts, _}:
      sts
    case _:
      Nil{}

def first(+os: List<&2, V.Edge2>) -> List<&2, C.St>:
  match os:
    case +h <> _:
      sts_of(h)
    case Nil{}:
      Nil{}

def fk(+f: F.Fit) -> String:
  U32.show(F.fit_kind(f))

def bk(+b: B.Built) -> String:
  match b:
    case B.BOk{+x}:
      B.b_kind(x)
    case B.BRef{_, +c, _}:
      c
    case B.BSeam{_}:
      "seam"

def sk(+s: F.Surface) -> String:
  match s:
    case F.SurfOk{_, _, _, _, +k}:
      k
    case F.SurfBad{+c, _}:
      c

def m(+s: V.Solved2) -> String:
  match s:
    case V.S2Ok{+job, +outs}:
      +sts = first(outs)
      sk(B.surf.of(0, 0, R.from_f32(1.0), J.BadCurve{}, R.from_f32(1.0), 1, False{}, sts, F.FPoint{G.v3(0.0, 0.0, 0.0)}, F.FPoint{G.v3(0.0, 0.0, 0.0)}))
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
