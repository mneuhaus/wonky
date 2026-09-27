import Base
import ../../../scripts/hardware-workload.bend as W

# Independent reference driver for op 5 (kernel) of service.bend. Built to the
# JS target by scripts/native-bridge/build-baseline.mjs; one JSON evidence row
# per requested case, so the out-of-process native answer can be compared
# with a different compiler target of the same production kernel sources.
# Arguments: kind depth count seed, repeated (kind 1 = boolean, 0 = comparison).

def rows(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case kind <> depth <> count <> seed <> rest:
      do IO<Unit>:
        result : W.Evidence = W.batch(W.number(Nat.read(depth)), W.number(Nat.read(count)), String.eq(kind, "1"), U32.from_nat(W.number(Nat.read(seed))))
        IO.print("{" ++ W.evidence_json(result) ++ "}")
        rows(rest)
    case _:
      IO.die(Unit, 2, "expected: (kind depth count seed)*")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    rows(args)
