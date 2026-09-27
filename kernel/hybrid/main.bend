import Base
import ../real.bend as R
import ./mesh.bend as M
import ./mesh-io.bend as MIO
import ./corefine/main.bend as C
import ./recover/main.bend as V
import ./recover/topo.bend as K

# The hybrid Boolean (docs/hybrid-boolean-plan.md): one entry for the
# production Boolean dispatch, the bake-off harness (prototype "hybrid",
# driver kernel/proto/hybrid) and a later native path.
#
#   boolean(job: String) -> String
#
# Input: a bake-off job (docs/bakeoff.md, "Job and result format"): the CSG
# tree, the face table of exact carriers and one tagged leaf mesh per leaf,
# tessellated at the job's deviation.
#
# Output, one of three canonical texts:
#
#   exact
#   brep <bodies> <V> <E> <F>          the recovered exact B-rep: recover's
#   ...                                output after its `ok` line (format in
#   end                                kernel/hybrid/recover/main.bend)
#
#   mesh <dev> <reason>                a certified-mesh approximation, never
#   mesh <V> <T>                       exact: corefine's tagged result mesh
#   ...                                (the bake-off result body after `ok`);
#   end                                <dev> is the job's deviation (two F32
#                                      bit words, an F32x2 Real), <reason>
#                                      recover's refusal of the exact B-rep
#
#   unresolved <reason>                a named refusal
#   end
#
# Stages. corefine (kernel/hybrid/corefine) decides the topology on the tagged
# meshes; its refusals are the answer. recover (kernel/hybrid/recover) then
# runs on the job and corefine's result text, exactly the bake-off's recover
# mode input, so this entry is the two prototypes run in sequence, byte for
# byte (scripts/bakeoff/hybrid-check.mjs verifies it on the harness runs).
#
# Which recover refusal keeps the mesh (kernel/hybrid/recover/topo.bend, Out):
# - BCert, answered Unresolved: the stage-1 pre-certificate (tangent.bend:
#   undecided near contacts of leaf faces, plan section 2.3), and recover's own
#   checks that the tagged mesh is the Boolean's solid (each tagged vertex
#   within dev * 1.000001 + 1e-9 mm of its carrier, closed oriented
#   2-manifold, vertex links, nested solid shells, clearance), and a mesh
#   boundary or corner farther from the exact curve or vertex than its
#   certified bound (the mesh would not be within its stated deviation there);
# - BNo, answered `mesh`: the exact recovery alone is refused (a curve or
#   face type, a seam split, a degenerate or two-carrier corner, a sliver, the
#   Euler check). Such a mesh passed corefine's output gate, the
#   pre-certificate and the input checks above; <dev> states that every mesh
#   vertex lies within it of its tagged exact carrier (not a Hausdorff bound to
#   the exact CSG, docs/hybrid-boolean-plan.md section 2.3). The checks of
#   later recovery stages (boundary distances, shell nesting, clearance) are
#   only evaluated when recovery reaches them; a refusal before them keeps the
#   mesh without them (plan section 8, step 8 decides whether that suffices).

# The job as corefine and as recover read it, with the job's deviation.
type RJob is Data:
  RJob{p: M.JobParse, dev: R.Real}

type HIn is Data:
  HIn{c: M.JobParse, rj: RJob}

type HOut is Data:
  HExact{r: V.Res}
  HMesh{dev: R.Real, why: String, mesh: String}
  HNo{text: String}

# After the mesh stage: the answer already, or recover's stage 1 with
# corefine's result text.
type Mid is Data:
  MDone{o: HOut}
  MGo{s: V.Staged, mesh: String, dev: R.Real}

def rjob.of(p: M.JobParse) -> RJob:
  match p:
    case M.Malformed{why}:
      RJob{M.Malformed{why}, R.from_f32(0.0)}
    case M.Parsed{job}:
      M.Job{id, +dev, csg, ps, fs, ms} = job
      RJob{M.Parsed{M.Job{id, dev, csg, ps, fs, ms}}, dev}

# recover's parse of the job (its own copy: corefine moves the leaf meshes
# into its tree, recover's pre-certificate reads them again).
def rjob(job: String) -> RJob:
  rjob.of(MIO.parse_job(job))

def parse(+job: String) -> HIn:
  HIn{C.parse(job), rjob(job)}

def mid.go(+ctext: String, rj: RJob) -> Mid:
  RJob{p, +dev} = rj
  MGo{V.stage1(V.RIn{p, MIO.parse_result(ctext)}), ctext, dev}

# corefine's outcome o; corefine's own refusal is the answer.
def mid.of(o: M.Outcome, rj: RJob) -> Mid:
  match o:
    case M.Unresolved{why}:
      MDone{HNo{MIO.show_outcome(M.Unresolved{why})}}
    case M.Solved{m}:
      mid.go(MIO.show_outcome(M.Solved{m}), rj)

# recover's per-triangle map (its device kernel).
def map(+m: Mid) -> List<&2, K.TOne>:
  match m:
    case MDone{_}:
      Nil{}
    case MGo{s, _, _}:
      V.stage2(s)

def classify(r: V.Res, mesh: String, +dev: R.Real) -> HOut:
  V.Res{o, +u} = r
  match o:
    case K.BOk{b}:
      HExact{V.Res{K.BOk{b}, u}}
    case K.BCert{why}:
      HNo{V.show(V.Res{K.BCert{why}, u})}
    case K.BNo{why}:
      HMesh{dev, String.append(why, V.un_note(u)), mesh}

def finish(+m: Mid, os: List<&2, K.TOne>) -> HOut:
  match m:
    case MDone{o}:
      o
    case MGo{s, mesh, dev}:
      classify(V.stage3(s, os), mesh, dev)

def solve(h: HIn) -> HOut:
  HIn{c, rj} = h
  +m = mid.of(C.solve(c), rj)
  finish(m, map(m))

# "ok\n" + rest -> rest (corefine's and recover's `ok` line).
def after_ok(s: String) -> String:
  match s:
    case SCon{_, SCon{_, SCon{_, rest}}}:
      rest
    case _:
      s

def show(h: HOut) -> String:
  match h:
    case HExact{r}:
      MIO.put("exact\n", after_ok(V.show(r)))
    case HMesh{dev, why, mesh}:
      MIO.put("mesh ", MIO.put_real(dev, MIO.sp(MIO.put(why, MIO.nl(after_ok(mesh))))))
    case HNo{text}:
      text

def run(job: String) -> String:
  show(solve(parse(job)))

def boolean(job: String) -> String:
  run(job)
