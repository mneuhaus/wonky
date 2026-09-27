import Base
import ./main.bend as P
import ../fillet-rollingball/job.bend as J
import ../fillet-rollingball/solve2.bend as V
import ../fillet-rollingball/assemble.bend as A
import ../fillet-rollingball/obrep.bend as O
import ../../real.bend as R
import ../../precise.bend as G

# Native driver of fillet prototype C "rollingball", stage C2, variant
# "spline" (copied from scripts/fillet/proto/null/native.bend;
# docs/fillet/proto-rollingball.md).
#
#   bin [--threads N] [--gpu off|1GB] -- <job-file> <result-file>
#
# Reads the job, runs parse / stations + finish / show (the compute phase is
# the station solve, the device call on Metal, plus the B-rep build on the
# CPU), writes the result text and prints
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

def sum_vec(+v: G.Vec3) -> U32:
  G.V3{x, y, z} = v
  (sum_real(x) + sum_real(y) + sum_real(z) : U32)

def sum_verts(vs: List<&2, G.Vec3>, acc: U32) -> U32:
  match vs:
    case Nil{}:
      acc
    case v <> t:
      sum_verts(t, (acc + sum_vec(v) : U32))

def sum_edges(es: List<&2, O.OEdge>, acc: U32) -> U32:
  match es:
    case Nil{}:
      acc
    case e <> t:
      O.OEdge{s, x, _, _, _, first, last} = e
      sum_edges(t, (acc + s + x + sum_real(first) + sum_real(last) : U32))

def sum_faces(fs: List<&2, O.OFace>, acc: U32) -> U32:
  match fs:
    case Nil{}:
      acc
    case f <> t:
      O.OFace{same, _, _, tol, ls} = f
      sum_faces(t, (acc + same + sum_real(tol) + U32.from_nat(List.length(&2, O.OLoop, ls)) : U32))

# Every vertex, edge range and face tolerance enters the checksum, so the
# whole build is forced.
def sum_out(+o: A.Out) -> U32:
  match o:
    case A.OOk{b}:
      O.OBody{vs, es, fs} = b
      sum_faces(fs, sum_edges(es, sum_verts(vs, 1)))
    case A.ORef{cls, why}:
      sum_text(why, sum_text(cls, 2))

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
    +s2 : V.Solved2 = P.stations(p) # @bakeoff-device-call
    +o : A.Out = P.finish(s2)
    +t3 : Nat <- stamp(sum_out(o))
    +out : String = P.show(o)
    +t4 : Nat <- stamp(sum_text(out, 0))
    u : Unit <- write_file(out_path, out)
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
