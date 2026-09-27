import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../hybrid/mesh.bend as M
import ../../hybrid/main.bend as H
import ../../hybrid/corefine/main.bend as C
import ../../hybrid/recover/main.bend as V
import ../../hybrid/recover/topo.bend as K
import ../../hybrid/recover/util.bend as U

# Native driver of the "hybrid" bake-off prototype (kernel/hybrid/main.bend:
# corefine, then recover). Built from the corefine and recover drivers.
#
#   bin [--threads N] [--gpu off|1GB] -- <job-file> <result-file>
#
# Reads the job, runs the hybrid's stages, writes the result text and prints
# one JSON line with the phase times in ms (IO.now, whole milliseconds):
#   {"readMs":..,"parseMs":..,"computeMs":..,"serializeMs":..,"writeMs":..,
#    "meshMs":..,"recoverMs":..,"prepMs":..,"mapMs":..,"finishMs":..}
# computeMs = meshMs (corefine) + recoverMs (corefine's result text, recover's
# parse of it, stage 1 = prepMs, the per-triangle map = mapMs, the rest of
# recovery = finishMs). Each phase ends with a checksum over its value,
# matched before the next stamp, so no work leaks into a later phase.
#
# No line carries the device-call mark: corefine places its `!` on its
# decisions (inter.bend decide) and recover on its per-triangle map (topo.bend
# tri.map). Each runs in its own IO step, as in the two prototypes' drivers (a
# device call that follows host forks in the same evaluation would fall back
# to the CPU pool). The stages compute exactly what H.solve computes (the JS
# target runs H.solve).

# --- forcing checksums -------------------------------------------------------

def sum_tris(ts: List<&2, M.Tri>, acc: U32) -> U32:
  match ts:
    case Nil{}:
      acc
    case M.Tri{a, b, c, tag} <> t:
      sum_tris(t, (acc + a + b + c + tag : U32))

def sum_verts(vs: List<&2, G.Vec3>, acc: U32) -> U32:
  match vs:
    case Nil{}:
      acc
    case G.V3{x, y, z} <> t:
      sum_verts(t, (acc + F32.bits(R.approx(x)) + F32.bits(R.approx(y)) + F32.bits(R.approx(z)) : U32))

def sum_mesh(m: M.Mesh) -> U32:
  M.Mesh{vs, ts} = m
  sum_verts(vs, sum_tris(ts, 0))

def sum_meshes(ms: List<&2, M.LeafMesh>, acc: U32) -> U32:
  match ms:
    case Nil{}:
      acc
    case M.LeafMesh{l, m} <> t:
      sum_meshes(t, (acc + l + sum_mesh(m) : U32))

def sum_parse(+p: M.JobParse) -> U32:
  match p:
    case M.Malformed{_}:
      1
    case M.Parsed{job}:
      M.Job{_, _, _, _, _, meshes} = job
      sum_meshes(meshes, 0)

def sum_outcome(+o: M.Outcome) -> U32:
  match o:
    case M.Unresolved{_}:
      2
    case M.Solved{m}:
      sum_mesh(m)

def sum_text(+s: String, acc: U32) -> U32:
  match s:
    case SNil{}:
      acc
    case SCon{Chr{c}, t}:
      sum_text(t, (acc + c : U32))

# Waits for `forced` before reading the clock.
def stamp(forced: U32) -> IO(Nat):
  match forced:
    case 0:
      IO.now()
    case _:
      IO.now()

# --- file IO -------------------------------------------------------------------

# One read of the whole file (File.size bytes), then a read that must hit end
# of file: a short read is reported, never silently truncated.
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

def sum_rjob(+r: H.RJob) -> U32:
  H.RJob{p, _} = r
  sum_parse(p)

def sum_staged(+s: V.Staged) -> U32:
  match s:
    case V.SNo{_, _}:
      1
    case V.SGo{p, _}:
      K.Prep{_, w, nt, _, _} = p
      U.Two{_, _, nl, nr} = w
      (nt + U32.from_nat(Nat.add(nl, nr)) : U32)

def sum_mid(+m: H.Mid) -> U32:
  match m:
    case H.MDone{_}:
      1
    case H.MGo{s, _, _}:
      sum_staged(s)

def sum_brep(+o: K.Out) -> U32:
  match o:
    case K.BOk{b}:
      K.Brep{vs, es, fs, st} = b
      (sum_verts(vs, 0) + U.count(K.EOut, es, U.count(K.FOut, fs, K.nbodies(st))) : U32)
    case _:
      2

def sum_hout(+h: H.HOut) -> U32:
  match h:
    case H.HExact{r}:
      V.Res{o, _} = r
      sum_brep(o)
    case H.HMesh{_, _, _}:
      3
    case H.HNo{_}:
      4

# --- driver --------------------------------------------------------------------

def ms(t1: Nat, t0: Nat) -> String:
  Nat.show(Nat.sub(t1, t0))

def launch(args: List<String>) -> IO(Unit):
  match args:
    case job_path <> out_path <> Nil{}:
      do IO<Unit>:
        t0 : Nat <- IO.now()
        +text : String <- read_file(job_path)
        +t1 : Nat <- stamp(sum_text(text, 0))
        +p : M.JobParse = C.parse(text)
        +rj : H.RJob = H.rjob(text)
        +t2 : Nat <- stamp((sum_parse(p) + sum_rjob(rj) : U32))
        bg : C.Begun = C.begin(C.stage(p))
        u1 : Nat <- IO.now()
        dc : C.Decided = C.decide(bg)
        u2 : Nat <- IO.now()
        +o : M.Outcome = C.finish(dc)
        +t3 : Nat <- stamp(sum_outcome(o))
        +m : H.Mid = H.mid.of(o, rj)
        +t4 : Nat <- stamp(sum_mid(m))
        +os : List<&2, K.TOne> = H.map(m)
        +t5 : Nat <- stamp(U.count(K.TOne, os, 0))
        +h : H.HOut = H.finish(m, os)
        +t6 : Nat <- stamp(sum_hout(h))
        +out : String = H.show(h)
        +t7 : Nat <- stamp(sum_text(out, 0))
        u : Unit <- write_file(out_path, out)
        t8 : Nat <- IO.now()
        IO.print("{\"readMs\":" ++ ms(t1, t0) ++ ",\"parseMs\":" ++ ms(t2, t1) ++ ",\"computeMs\":" ++ ms(t6, t2) ++ ",\"serializeMs\":" ++ ms(t7, t6) ++ ",\"writeMs\":" ++ ms(t8, t7) ++ ",\"meshMs\":" ++ ms(t3, t2) ++ ",\"recoverMs\":" ++ ms(t6, t3) ++ ",\"prepMs\":" ++ ms(t4, t3) ++ ",\"mapMs\":" ++ ms(t5, t4) ++ ",\"finishMs\":" ++ ms(t6, t5) ++ "}")
    case _:
      IO.die(Unit, 2, "usage: <bin> -- <job-file> <result-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
