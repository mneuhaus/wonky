import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./job.bend as J
import ./contact.bend as C
import ./solve2.bend as V
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
      fk(F.FPoint{F.sec_mid(0, R.from_f32(1.0), F.nth_st(sts, 0n))})
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
