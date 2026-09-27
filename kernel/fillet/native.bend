import Base
import ./main.bend as P
import ./job.bend as J

# Native driver of the production fillet (kernel/fillet; prototype A ported;
# stages 1-3: ladder, corner
# network and B-rep surgery; same shape as scripts/fillet/proto/null/native.bend).
#
#   bin [--threads N] [--gpu off|1GB] -- <job-file> <result-file>
#
# Besides the harness result it writes the ladder data ("wonky-fillet-ladder
# 1", the stripes) to <result-file>.ladder and the corner network
# ("wonky-fillet-network 1", stage 2) to <result-file>.network, so every
# target's stripes and tips can be compared byte for byte
# (scripts/fillet/ladder.mjs, scripts/fillet/network.mjs).
#
# Reads the job, runs parse / solve / show, writes the result text and prints
# one JSON line with the phase times in ms (IO.now, whole milliseconds):
#   {"readMs":..,"parseMs":..,"computeMs":..,"serializeMs":..,"writeMs":..}
# Each phase ends with a checksum over its value, matched before the next
# stamp, so no work leaks into a later phase.
#
# No call is marked for the Metal device (@bakeoff-device-call): the whole
# fillet runs on the CPU in every build, so the Metal binary gives cpuN's
# text. Measured with the device call on solve0 (ladder and network),
# integrate and verify stages, 25 September 2026:
#   - Metal flushes subnormal F32 results to zero, the CPU and JS targets keep
#     them. The F32x2 reals (kernel/real.bend) reach subnormals on inputs with
#     near-zero words (a pocket whose floor lies at z = 1e-16): Metal wrote a
#     different, equally valid text (a lo word -7e-45 against 0; lo words of
#     1e-24 components 2e-39 apart), exit code 0;
#   - the exact escalation (exact.bend on big integers) overflowed the device
#     stack ("bend: memory fault") on plane/plane width boundaries;
#   - Metal was 100 times slower than the CPU on those jobs, and the device
#     compile took 33 min.
# Production runs fillets on the CPU pool (docs/fillet-plan.md §6).

def sum_text(+s: String, acc: U32) -> U32:
  match s:
    case SNil{}:
      acc
    case SCon{Chr{c}, t}:
      sum_text(t, (acc + c : U32))

def sum_parse(+p: J.Job) -> U32:
  match p:
    case J.Job{id, _, _, _, _, sel}:
      sum_text(id, U32.from_nat(List.length(&2, U32, sel)))
    case J.Bad{_}:
      1

def sum_out(+o: P.Out) -> U32:
  sum_text(P.show_network(o), sum_text(P.show_ladder(o), 0))

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

def launch(args: List<String>) -> IO(Unit):
  match args:
    case job_path <> +out_path <> Nil{}:
      do IO<Unit>:
        t0 : Nat <- IO.now()
        +text : String <- read_file(job_path)
        +t1 : Nat <- stamp(sum_text(text, 0))
        +p : J.Job = P.parse(text)
        +t2 : Nat <- stamp(sum_parse(p))
        +o0 : P.Out = P.solve0(p)
        +o : P.Out = P.finish(o0)
        +t3 : Nat <- stamp(sum_out(o))
        +out : String = P.show(o)
        +lad : String = P.show_ladder(o)
        +net : String = P.show_network(o)
        +t4 : Nat <- stamp(sum_text(out, 0))
        u : Unit <- write_file(out_path, out)
        u2 : Unit <- write_file(out_path ++ ".ladder", lad)
        u3 : Unit <- write_file(out_path ++ ".network", net)
        t5 : Nat <- IO.now()
        IO.print("{\"readMs\":" ++ ms(t1, t0) ++ ",\"parseMs\":" ++ ms(t2, t1) ++ ",\"computeMs\":" ++ ms(t3, t2) ++ ",\"serializeMs\":" ++ ms(t4, t3) ++ ",\"writeMs\":" ++ ms(t5, t4) ++ "}")
    case _:
      IO.die(Unit, 2, "usage: <bin> -- <job-file> <result-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
