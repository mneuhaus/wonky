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

def mv.which(+x: A.BA, +v: U32) -> U32:
  +b = A.ba_b(x)
  Bool.pick(U32, U32.is_eq(B.b_vs(b), v), 1, Bool.pick(U32, U32.is_eq(B.b_ve(b), v), 2, 0))

def mv.sel(+w: U32, +x: A.BA, +rest: A.MV) -> A.MV:
  match w:
    case 1:
      +b = A.ba_b(x)
      A.MSome{B.b_pas(b), A.al_vbs(A.ba_a(x)), B.b_pbs(b), B.b_fa(b), B.b_fb(b)}
    case 2:
      +b = A.ba_b(x)
      A.MSome{B.b_pae(b), A.al_vbe(A.ba_a(x)), B.b_pbe(b), B.b_fa(b), B.b_fb(b)}
    case _:
      rest

def mv2(bas: List<&2, A.BA>, +v: U32) -> A.MV:
  match bas:
    case Nil{}:
      A.MNone{}
    case +x <> t:
      mv.sel(mv.which(x, v), x, mv2(t, v))

def m(+s: V.Solved2) -> String:
  match s:
    case V.S2Ok{+job, +outs}:
      +sts = first(outs)
      Bool.show(A.mv_some(mv2(Nil{}, 3)))
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
