import Base
import ./mesh.bend as M
import ./mesh-io.bend as MIO
import ./main.bend as H
import ./corefine/main.bend as C
import ./recover/topo.bend as K
import ./recover/util.bend as U

# Native driver of the production hybrid Boolean (docs/hybrid-boolean-plan.md
# step 11a): the subprocess `wonky-hybrid` that WONKY_BACKEND=native|diff runs
# for loadKernel().hybrid (src/native/hybrid-process.mjs spawns it;
# scripts/native-bridge/build-native.mjs --set planar builds it with the addon).
# Two modes:
#
#   bin [--threads N] [--gpu off] -- boolean <job-file> <answer-file> <mesh-file>
#
#     The answer of H.boolean(job) (exact / mesh / unresolved, format in
#     main.bend) into <answer-file>, and corefine's result text
#     (C.run(job): `ok` + the tagged mesh, or corefine's `unresolved`) into
#     <mesh-file>: exactly what the JS host gets from the entry's stages
#     (src/hybrid.mjs runHybrid: corefine/main.run, then rjob, mid.go, map,
#     finish, show). Prints one JSON line with the phase times in ms.
#
#   bin [--threads N] [--gpu off] -- classes <job-file> <n> <out-file>
#
#     recover's carrier classes of the job's face table (src/hybrid.mjs
#     carrierClasses: mesh-io.parse_job, then recover/topo.surfs.go and
#     recover/topo.cls.go with n faces) as `classes c0 c1 ...` on one line, or
#     `malformed <reason>` when the job does not parse.
#
# The stages are those of H.solve and of the bake-off driver
# kernel/proto/hybrid/native.bend: corefine's decisions and recover's
# per-triangle map carry their own device-call marks (`!`), each in its own IO
# step; with --gpu off they run on the CPU pool. corefine's result text is
# shown once and handed to recover (H.mid.of shows the same outcome itself).
#
# No budget lives here: the host bounds each process by wall time and names
# the refusal (src/native/hybrid-process.mjs).

# --- forcing checksums -------------------------------------------------------

def sum_text(+s: String, acc: U32) -> U32:
  match s:
    case SNil{}:
      acc
    case SCon{Chr{c}, t}:
      sum_text(t, (acc + c : U32))

def sum_parse(+p: M.JobParse) -> U32:
  match p:
    case M.Malformed{_}:
      1
    case M.Parsed{job}:
      M.Job{_, _, _, _, fs, _} = job
      U.count(M.FaceTag, fs, 2)

def sum_rjob(+r: H.RJob) -> U32:
  H.RJob{p, _} = r
  sum_parse(p)

def sum_outcome(+o: M.Outcome) -> U32:
  match o:
    case M.Unresolved{_}:
      2
    case M.Solved{m}:
      M.Mesh{vs, ts} = m
      U.count(M.Tri, ts, 3)

def sum_mid(+m: H.Mid) -> U32:
  match m:
    case H.MDone{_}:
      1
    case H.MGo{_, _, _}:
      2

def sum_hout(+h: H.HOut) -> U32:
  match h:
    case H.HExact{_}:
      2
    case H.HMesh{_, _, _}:
      3
    case H.HNo{_}:
      4

# Waits for `forced` before reading the clock.
def stamp(forced: U32) -> IO(Nat):
  match forced:
    case 0:
      IO.now()
    case _:
      IO.now()

# --- the two modes -------------------------------------------------------------

# H.mid.of(o, rj) with corefine's result text shown once: a refusal is the
# answer as is, a solved mesh goes to recover as text.
def mid(+o: M.Outcome, +mesh: String, rj: H.RJob) -> H.Mid:
  match o:
    case M.Unresolved{_}:
      H.MDone{H.HNo{mesh}}
    case M.Solved{_}:
      H.mid.go(mesh, rj)

# " c0 c1 ... cn" + acc, from the classes in reverse order.
def put_classes(rev: List<&2, U32>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case c <> t:
      put_classes(t, MIO.sp(MIO.put_u32(c, acc)))

def classes(p: M.JobParse, +n: U32) -> String:
  match p:
    case M.Malformed{why}:
      MIO.put("malformed ", MIO.put(why, "\n"))
    case M.Parsed{job}:
      M.Job{_, _, _, _, fs, _} = job
      MIO.put("classes", put_classes(U.rev(U32, K.cls.go(K.surfs.go(fs, Nil{}), n)), "\n"))

# --- file IO (as kernel/proto/hybrid/native.bend) -------------------------------

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

# --- driver --------------------------------------------------------------------

def ms(t1: Nat, t0: Nat) -> String:
  Nat.show(Nat.sub(t1, t0))

def run_boolean(job_path: String, answer_path: String, mesh_path: String) -> IO(Unit):
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
    +mesh : String = C.show(o)
    +m : H.Mid = mid(o, mesh, rj)
    +t4 : Nat <- stamp(sum_mid(m))
    +os : List<&2, K.TOne> = H.map(m)
    +t5 : Nat <- stamp(U.count(K.TOne, os, 0))
    +h : H.HOut = H.finish(m, os)
    +t6 : Nat <- stamp(sum_hout(h))
    +out : String = H.show(h)
    +t7 : Nat <- stamp(sum_text(out, 0))
    w1 : Unit <- write_file(answer_path, out)
    w2 : Unit <- write_file(mesh_path, mesh)
    t8 : Nat <- IO.now()
    IO.print("{\"readMs\":" ++ ms(t1, t0) ++ ",\"parseMs\":" ++ ms(t2, t1) ++ ",\"meshMs\":" ++ ms(t3, t2) ++ ",\"prepMs\":" ++ ms(t4, t3) ++ ",\"mapMs\":" ++ ms(t5, t4) ++ ",\"finishMs\":" ++ ms(t6, t5) ++ ",\"serializeMs\":" ++ ms(t7, t6) ++ ",\"writeMs\":" ++ ms(t8, t7) ++ "}")

def run_classes.n(job_path: String, n: Maybe<&2, U32>, out_path: String) -> IO(Unit):
  match n:
    case None{}:
      IO.die(Unit, 2, "classes: <n> is not a U32")
    case Some{k}:
      do IO<Unit>:
        +t0 : Nat <- IO.now()
        text : String <- read_file(job_path)
        +out : String = classes(MIO.parse_job(text), k)
        +t1 : Nat <- stamp(sum_text(out, 0))
        w : Unit <- write_file(out_path, out)
        t2 : Nat <- IO.now()
        IO.print("{\"classesMs\":" ++ ms(t1, t0) ++ ",\"writeMs\":" ++ ms(t2, t1) ++ "}")

def usage() -> IO(Unit):
  IO.die(Unit, 2, "usage: <bin> -- boolean <job-file> <answer-file> <mesh-file> | classes <job-file> <n> <out-file>")

# Both modes take three arguments after the mode word.
def launch.mode(is_boolean: Bool, is_classes: Bool, a: String, b: String, c: String) -> IO(Unit):
  match is_boolean is_classes:
    case True{} _:
      run_boolean(a, b, c)
    case False{} True{}:
      run_classes.n(a, U32.read(b), c)
    case False{} False{}:
      usage()

def launch.args(+mode: String, a: String, b: String, c: String) -> IO(Unit):
  launch.mode(String.eq(mode, "boolean"), String.eq(mode, "classes"), a, b, c)

def launch(args: List<String>) -> IO(Unit):
  match args:
    case mode <> a <> b <> c <> Nil{}:
      launch.args(mode, a, b, c)
    case _:
      usage()

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
