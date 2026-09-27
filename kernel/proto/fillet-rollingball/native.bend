import Base
import ./main.bend as P
import ./job.bend as J
import ./contact.bend as C
import ../../real.bend as R

# Native driver of fillet prototype C "rollingball", stage 1 (copied from
# scripts/fillet/proto/null/native.bend; docs/fillet/proto-rollingball.md).
#
#   bin [--threads N] [--gpu off|1GB] -- <job-file> <result-file>
#
# Reads the job, runs parse / solve / show, writes the result text, writes the
# sampled blend next to it as <result-file>.samples (serialized in the same
# phase as the result) and prints
# one JSON line with the phase times in ms (IO.now, whole milliseconds):
#   {"readMs":..,"parseMs":..,"computeMs":..,"serializeMs":..,"writeMs":..}
# Each phase ends with a checksum over its value, matched before the next
# stamp, so no work leaks into a later phase. The Metal build turns the call
# on the line marked @bakeoff-device-call into a `!` call.

def sum_text(+s: String, acc: U32) -> U32:
  match s:
    case SNil{}:
      acc
    case SCon{Chr{c}, t}:
      sum_text(t, (acc + c : U32))

def sum_parse(+p: J.Parse) -> U32:
  match p:
    case J.Parsed{j}:
      J.Job{id, _, _, _, _, _, _} = j
      sum_text(id, 0)
    case J.Malformed{_}:
      1

def sum_real(+r: R.Real) -> U32:
  R.Real{hi, lo} = r
  (F32.bits(hi) + F32.bits(lo) : U32)

# Every station certificate enters the checksum, so the whole solve is forced.
def sum_sts(sts: List<&2, C.St>, acc: U32) -> U32:
  match sts:
    case Nil{}:
      acc
    case s <> t:
      C.St{k, _, _, _, _, _, res, _, _} = s
      sum_sts(t, (acc + k + sum_real(res) : U32))

def sum_out(+o: P.EdgeOut) -> U32:
  match o:
    case P.EDone{e, _, sts, res, _, _}:
      sum_sts(sts, (e + sum_real(res) : U32))
    case P.ERefused{e, _, why}:
      sum_text(why, e)
    case P.ESeam{e}:
      (e + 1 : U32)

def sum_outs(outs: List<&2, P.EdgeOut>, acc: U32) -> U32:
  match outs:
    case Nil{}:
      acc
    case o <> t:
      sum_outs(t, (acc + sum_out(o) : U32))

def sum_solved(+s: P.Solved) -> U32:
  match s:
    case P.SOk{_, _, _, outs}:
      sum_outs(outs, 1)
    case P.SBad{why}:
      sum_text(why, 2)

def stamp(forced: U32) -> IO(Nat):
  match forced:
    case 0:
      IO.now()
    case _:
      IO.now()

def read_end.check(text: String, rest: String) -> IO(String):
  match rest:
    case SNil{}:
      IO.pure(String, text)
    case SCon{_, _}:
      IO.die(String, 3, "short read of the job file")

def read_end(text: String, r: File & Result<&1, &1, U32 & String, String>) -> IO(String):
  (file, res) = r
  do IO<String>:
    rest : String <- IO.pass(String, res)
    u : Unit <- File.close(file)
    read_end.check(text, rest)

def read_body(r: File & Result<&1, &1, U32 & String, String>) -> IO(String):
  (file, res) = r
  do IO<String>:
    text : String <- IO.pass(String, res)
    r2 : File & Result<&1, &1, U32 & String, String> <- File.read(file, 65536)
    read_end(text, r2)

def read_sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(String):
  (file, res) = r
  do IO<String>:
    size : U32 <- IO.pass(U32, res)
    r2 : File & Result<&1, &1, U32 & String, String> <- File.read(file, (size + 1 : U32))
    read_body(r2)

def read_file(path: String) -> IO(String):
  do IO<String>:
    file : File <- IO.try(File, File.open(path, "r"))
    r : File & Result<&1, &1, U32 & String, U32> <- File.size(file)
    read_sized(r)

def write_done(r: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (file, res) = r
  do IO<Unit>:
    u : Unit <- IO.pass(Unit, res)
    File.close(file)

def write_file(path: String, text: String) -> IO(Unit):
  do IO<Unit>:
    file : File <- IO.try(File, File.open(path, "w"))
    r : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
    write_done(r)

def ms(t1: Nat, t0: Nat) -> String:
  Nat.show(Nat.sub(t1, t0))

def go(job_path: String, +out_path: String) -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    +text : String <- read_file(job_path)
    +t1 : Nat <- stamp(sum_text(text, 0))
    +p : J.Parse = P.parse(text)
    +t2 : Nat <- stamp(sum_parse(p))
    +o : P.Solved = P.solve(p) # @bakeoff-device-call
    +t3 : Nat <- stamp(sum_solved(o))
    +out : String = P.show(o)
    +smp : String = P.samples(o)
    +t4 : Nat <- stamp((sum_text(out, 0) + sum_text(smp, 0) : U32))
    u : Unit <- write_file(out_path, out)
    v : Unit <- write_file(out_path ++ ".samples", smp)
    t5 : Nat <- IO.now()
    IO.print("{\"readMs\":" ++ ms(t1, t0) ++ ",\"parseMs\":" ++ ms(t2, t1) ++ ",\"computeMs\":" ++ ms(t3, t2) ++ ",\"serializeMs\":" ++ ms(t4, t3) ++ ",\"writeMs\":" ++ ms(t5, t4) ++ "}")

def launch(args: List<String>) -> IO(Unit):
  match args:
    case job_path <> out_path <> Nil{}:
      go(job_path, out_path)
    case _:
      IO.die(Unit, 2, "usage: <bin> -- <job-file> <result-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
