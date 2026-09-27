import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../../analytic.bend as A
import ../../topology.bend as T
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./util.bend as U
import ./topo.bend as P
import ./tangent.bend as TG
import ../unify.bend as UN

# The hybrid Boolean's recovery stage (kernel/hybrid/main.bend; bake-off
# prototype "recover", driver kernel/proto/recover): exact analytic B-rep
# recovery from a tagged Boolean mesh (docs/proto-recover.md).
#
# Input (recover mode, docs/bakeoff.md): the job text immediately followed by
# a result text whose triangles carry face tags. Output: `unresolved <reason>`
# or `ok` followed by the recovered B-rep in the kernel's body conventions
# (kernel/analytic.bend Surface/Curve, T.Coedge loops), every real as the two
# F32 bit patterns of an F32x2 Real:
#
#   ok
#   brep <bodies> <V> <E> <F>
#   v <x> <y> <z>                                        V times, exact vertices
#   e <start> <end> <curve> <reals> <seam> <dev> <bound> <ranged> <t0> <t1>
#       curve: line o d | circle o n x r | ellipse o n x major minor
#       seam 1 marks a periodic seam, not a mesh boundary: a generator line
#       (cylinder, cone band), a meridian arc (sphere or torus band between
#       latitude rims; pole to pole on a full sphere), an outer-equator arc
#       (torus band between meridian rims), or the two closed seams of a
#       full torus (start = end vertex); dev is the
#       largest distance of the mesh boundary polyline from the exact curve,
#       bound the certified tolerance it was checked against (mm); ranged 1:
#       an open arc with parameter range [t0, t1] (A.curve_parameter)
#   f <body> <shell> <sense> <surface> <reals> <tag> <loops>  F times, then per loop
#   l <outer> <n> (<edge> <forward>) * n
#       surface: plane o n x | cylinder o a x r | cone o a x r angle |
#                sphere o a x r | torus o a x major minor (not in the kernel
#                body format yet: axis a and seam direction x of the STEP frame)
#       sense 1: outward normal = surface normal; tag: the face-table tag whose
#       carrier the face lies on; body: component id (faces with equal body
#       form one solid); shell: the closed shell the face belongs to (the
#       body id for the outer shell, another id for an inner void shell)
#   stats <tris> <mesh verts> <patches> <corners> <closed edges> <seams>
#         <loops> <bodies> <max dev> <max dev/bound> <max vertex drift>
#         <max drift/bound> <max vertex residual> <max tag residual> <min det>
#         <slivers absorbed>
#   unified <classes> <tolerance> [<over>]             only when classes > 0
#       carrier unification (plan step 4, kernel/hybrid/unify.bend): plane
#       carriers of different leaves whose normals agree within 2^-44 and
#       offsets within tolerance = 2^-44*scale (exact test on the face table)
#       form <classes> unified classes; the mesh engine decided them as
#       coplanar, and a recovered face lies on its class's first carrier;
#       over (only when > 0): classes past the 32-bit class limit, which the
#       mesh engine decided without unification (from the rounding)
#   end
#
# A refusal of a job with unified classes ends with "; coplanar plane
# carriers unified within 2^-44*scale (<classes> classes)".
#
# Edges are oriented along their curve (same_sense true). Every edge of a face
# loop is used by exactly two faces in opposite directions.

type RIn is Data:
  RIn{job: M.JobParse, res: M.Outcome}

def rin(p: M.JobParse & M.Outcome) -> RIn:
  (j, r) = p
  RIn{j, r}

def parse(s: String) -> RIn:
  rin(MIO.parse_recover(s))

# The job's carrier unification (kernel/hybrid/unify.bend), stated in the
# output: the number of unified plane classes and their tolerance.
type Un is Data:
  Un{n: U32, over: U32, tau: F32}

def un.of(u: UN.Unified) -> Un:
  UN.Unified{_, _, n, over, _, tau, _} = u
  Un{n, over, tau}

def un.scan(x: UN.MxL, faces: List<&2, M.FaceTag>) -> Un:
  UN.MxL{_, +mx} = x
  un.of(UN.decide(faces, mx))

def un.job(+job: M.Job) -> Un:
  M.Job{_, _, _, _, faces, meshes} = job
  un.scan(UN.scan(meshes), faces)

# Staged solve (the native driver runs the three stages as separate IO steps
# so the banged per-triangle map reaches the device; see topo.bend tri.map).
type Staged is Data:
  SNo{o: P.Out, u: Un}
  SGo{p: P.Prep, u: Un}

# Undecided near contacts of leaf faces (tangent.bend) are refused before any
# recovery work.
def stage1.tan(+w: String, job: M.Job, mesh: M.Mesh, +u: Un) -> Staged:
  match w:
    case SNil{}:
      SGo{P.prep(job, mesh), u}
    case SCon{_, _}:
      SNo{P.BCert{w}, u}

# A source refusal already names its tolerance (corefine states it).
def stage1.mesh(+job: M.Job, r: M.Outcome) -> Staged:
  match r:
    case M.Unresolved{why}:
      SNo{P.BCert{"source mesh unresolved: " ++ why}, Un{0, 0, 0.0}}
    case M.Solved{+mesh}:
      stage1.tan(TG.check(job, mesh), job, mesh, un.job(job))

def stage1(p: RIn) -> Staged:
  RIn{j, r} = p
  match j:
    case M.Malformed{why}:
      SNo{P.BCert{"malformed-job " ++ why}, Un{0, 0, 0.0}}
    case M.Parsed{job}:
      stage1.mesh(job, r)

def stage2(+s: Staged) -> List<&2, P.TOne>:
  match s:
    case SNo{_, _}:
      Nil{}
    case SGo{p, _}:
      P.prep.map(p)

# The outcome with the job's carrier unification.
type Res is Data:
  Res{o: P.Out, u: Un}

def stage3(+s: Staged, os: List<&2, P.TOne>) -> Res:
  match s:
    case SNo{o, u}:
      Res{o, u}
    case SGo{p, u}:
      Res{P.finish(p, os), u}

def solve(p: RIn) -> Res:
  +s = stage1(p)
  stage3(s, stage2(s))

# --- printing (back to front, tail-recursive over reversed lists) ------------

def sp(acc: String) -> String:
  MIO.sp(acc)

def put_b(b: Bool, acc: String) -> String:
  MIO.put_u32(Bool.pick(U32, b, 1, 0), acc)

def put_f(x: F32, acc: String) -> String:
  MIO.put_real(R.from_f32(x), acc)

def put_curve(c: A.Curve, acc: String) -> String:
  match c:
    case A.Line{o, d}:
      MIO.put("line ", MIO.put_vec3(o, sp(MIO.put_vec3(d, acc))))
    case A.Circle{o, n, x, r}:
      MIO.put("circle ", MIO.put_vec3(o, sp(MIO.put_vec3(n, sp(MIO.put_vec3(x, sp(MIO.put_real(r, acc))))))))
    case A.Ellipse{o, n, x, a, b}:
      MIO.put("ellipse ", MIO.put_vec3(o, sp(MIO.put_vec3(n, sp(MIO.put_vec3(x, sp(MIO.put_real(a, sp(MIO.put_real(b, acc))))))))))

def put_body_surface(s: A.Surface, acc: String) -> String:
  match s:
    case A.Plane{o, n, x}:
      MIO.put("plane ", MIO.put_vec3(o, sp(MIO.put_vec3(n, sp(MIO.put_vec3(x, acc))))))
    case A.Cylinder{o, a, x, r}:
      MIO.put("cylinder ", MIO.put_vec3(o, sp(MIO.put_vec3(a, sp(MIO.put_vec3(x, sp(MIO.put_real(r, acc))))))))
    case A.Cone{o, a, x, r, ang}:
      MIO.put("cone ", MIO.put_vec3(o, sp(MIO.put_vec3(a, sp(MIO.put_vec3(x, sp(MIO.put_real(r, sp(MIO.put_real(ang, acc))))))))))
    case A.Sphere{o, a, x, r}:
      MIO.put("sphere ", MIO.put_vec3(o, sp(MIO.put_vec3(a, sp(MIO.put_vec3(x, sp(MIO.put_real(r, acc))))))))
    case A.Torus{o, a, x, big, small}:
      MIO.put("torus ", MIO.put_vec3(o, sp(MIO.put_vec3(a, sp(MIO.put_vec3(x, sp(MIO.put_real(big, sp(MIO.put_real(small, acc))))))))))

def put_surface(s: P.OSurf, acc: String) -> String:
  match s:
    case P.OA{b}:
      put_body_surface(b, acc)
    case P.OSphere{o, a, x, r}:
      MIO.put("sphere ", MIO.put_vec3(o, sp(MIO.put_vec3(a, sp(MIO.put_vec3(x, sp(MIO.put_real(r, acc))))))))
    case P.OTorus{o, a, x, big, small}:
      MIO.put("torus ", MIO.put_vec3(o, sp(MIO.put_vec3(a, sp(MIO.put_vec3(x, sp(MIO.put_real(big, sp(MIO.put_real(small, acc))))))))))

def put_vs(rev: List<&2, G.Vec3>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case v <> t:
      put_vs(t, MIO.put("v ", MIO.put_vec3(v, MIO.nl(acc))))

def put_es(rev: List<&2, P.EOut>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case P.EOut{a, b, c, seam, d, bound, ranged, first, last} <> t:
      put_es(t, MIO.put("e ", MIO.put_u32(a, sp(MIO.put_u32(b, sp(put_curve(c, sp(put_b(seam, sp(put_f(d, sp(put_f(bound, sp(put_b(ranged, sp(MIO.put_real(first, sp(MIO.put_real(last, MIO.nl(acc))))))))))))))))))))

def put_uses(rev: List<&2, T.Coedge>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case T.Use{e, f} <> t:
      put_uses(t, sp(MIO.put_u32(e, sp(put_b(f, acc)))))

def put_loops(rev: List<&2, P.LoopOut>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case P.LoopOut{outer, +uses} <> t:
      put_loops(t, MIO.put("l ", put_b(outer, sp(MIO.put_u32(U.count(T.Coedge, uses, 0), put_uses(List.reverse(&2, T.Coedge, uses), MIO.nl(acc)))))))

def put_fs(rev: List<&2, P.FOut>, acc: String) -> String:
  match rev:
    case Nil{}:
      acc
    case P.FOut{body, shell, sense, s, tag, +loops} <> t:
      put_fs(t, MIO.put("f ", MIO.put_u32(body, sp(MIO.put_u32(shell, sp(put_b(sense, sp(put_surface(s, sp(MIO.put_u32(tag, sp(MIO.put_u32(U.count(P.LoopOut, loops, 0),
        MIO.nl(put_loops(List.reverse(&2, P.LoopOut, loops), acc)))))))))))))))

def put_stats(s: P.Stats, acc: String) -> String:
  P.Stats{tris, verts, patches, corners, closed, seams, loops, bodies, maxd, ratio, drift, dratio, cres, tagres, mindet, slivers} = s
  MIO.put("stats ", MIO.put_u32(tris, sp(MIO.put_u32(verts, sp(MIO.put_u32(patches, sp(MIO.put_u32(corners, sp(MIO.put_u32(closed, sp(
    MIO.put_u32(seams, sp(MIO.put_u32(loops, sp(MIO.put_u32(bodies, sp(put_f(maxd, sp(put_f(ratio, sp(put_f(drift, sp(put_f(dratio, sp(
    put_f(cres, sp(put_f(tagres, sp(put_f(mindet, sp(MIO.put_u32(slivers, MIO.nl(acc)))))))))))))))))))))))))))))))))

# The classes past the 32-bit limit, when there are any.
def put_over.if(some: Bool, +over: U32, acc: String) -> String:
  match some:
    case True{}:
      sp(MIO.put_u32(over, acc))
    case False{}:
      acc

def put_over(+over: U32, acc: String) -> String:
  put_over.if(U32.is_ne(over, 0), over, acc)

def put_un.if(on: Bool, +n: U32, +over: U32, +tau: F32, acc: String) -> String:
  match on:
    case True{}:
      MIO.put("unified ", MIO.put_u32(n, sp(put_f(tau, put_over(over, MIO.nl(acc))))))
    case False{}:
      acc

def put_un(+u: Un, acc: String) -> String:
  Un{+n, +over, +tau} = u
  put_un.if(U32.is_ne(n, 0), n, over, tau, acc)

def show_brep(b: P.Brep, +u: Un) -> String:
  P.Brep{+vs, +es, +fs, +st} = b
  +tail = put_vs(List.reverse(&2, G.Vec3, vs), put_es(List.reverse(&2, P.EOut, es), put_fs(List.reverse(&2, P.FOut, fs), put_stats(st, put_un(u, "end\n")))))
  MIO.put("ok\nbrep ", MIO.put_u32(P.nbodies(st), sp(MIO.put_u32(U.count(G.Vec3, vs, 0), sp(MIO.put_u32(U.count(P.EOut, es, 0), sp(MIO.put_u32(U.count(P.FOut, fs, 0), MIO.nl(tail)))))))))

def un_note(+u: Un) -> String:
  Un{+n, _, _} = u
  UN.note(n, MIO.put_u32(n, ""))

def show(r: Res) -> String:
  Res{o, +u} = r
  match o:
    case P.BOk{b}:
      show_brep(b, u)
    case P.BNo{why}:
      MIO.put("unresolved ", MIO.put(why, MIO.put(un_note(u), "\nend\n")))
    case P.BCert{why}:
      MIO.put("unresolved ", MIO.put(why, MIO.put(un_note(u), "\nend\n")))

def run(job: String) -> String:
  show(solve(parse(job)))
