import Base
import ./native.bend as N
import ../mesh-io.bend as MIO
import ./fdm.bend as FD

# Native driver of the sdf FDM analyses (fdm.bend):
#
#   bin [--threads N] [--gpu off|1GB] -- <op> <param-um> <job-file> <out-file>
#
# op: offset | shell | interference | thickness. Prints one JSON line of phase
# times (IO.now ms). For thickness the meshing (prepMs, CPU) and the ray
# kernel (traceMs, a `!` call: the GPU in the Metal build) are timed apart.

def launch.thick(+pm: String, +job: String, +out_path: String) -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    +text : String <- N.read_file(job)
    +t1 : Nat <- N.stamp(N.sum_text(text, 0))
    +pr : FD.Prep = FD.prep(FD.ctx(MIO.parse_job(text)))
    +t2 : Nat <- N.stamp(FD.prep_sum(pr))
    +th : FD.TH = FD.trace_th(pr, FD.param(pm))
    +t3 : Nat <- N.stamp(FD.th_sum(th))
    +out : String = FD.thick_out(pr, th, FD.param(pm))
    +t4 : Nat <- N.stamp(N.sum_text(out, 0))
    u : Unit <- N.write_file(out_path, out)
    IO.print("{\"readMs\":" ++ N.ms(t1, t0) ++ ",\"prepMs\":" ++ N.ms(t2, t1) ++ ",\"traceMs\":" ++ N.ms(t3, t2) ++ ",\"serializeMs\":" ++ N.ms(t4, t3) ++ "}")

def launch.op(+op: String, +pm: String, +job: String, +out_path: String) -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    +text : String <- N.read_file(job)
    +t1 : Nat <- N.stamp(N.sum_text(text, 0))
    +out : String = FD.run(op, pm, text)
    +t2 : Nat <- N.stamp(N.sum_text(out, 0))
    u : Unit <- N.write_file(out_path, out)
    IO.print("{\"readMs\":" ++ N.ms(t1, t0) ++ ",\"computeMs\":" ++ N.ms(t2, t1) ++ "}")

def launch.k(thick: Bool, +op: String, +pm: String, +job: String, +out_path: String) -> IO(Unit):
  match thick:
    case True{}:
      launch.thick(pm, job, out_path)
    case False{}:
      launch.op(op, pm, job, out_path)

def launch(args: List<String>) -> IO(Unit):
  match args:
    case +op <> pm <> job <> out_path <> Nil{}:
      launch.k(String.eq(op, "thickness"), op, pm, job, out_path)
    case _:
      IO.die(Unit, 2, "usage: <bin> -- <offset|shell|interference|thickness> <param-um> <job-file> <out-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    launch(args)
