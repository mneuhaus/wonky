import Base
import ../../real.bend as R
import ../../precise.bend as G
import ./io.bend as T
import ./job.bend as J

# The result body of the stage-C2 builders (docs/fillet/proto-rollingball.md)
# and its printer (docs/fillet/harness.md, "Job and result format").
#
# Curves and surfaces reuse the job records (J.Curve, J.Surf), so a support
# face that the blend does not touch is printed exactly as it was read. The
# spline variant adds one surface type, the format extension of stage C2:
#
#   bspline <du> <dv> <nu> <nv> <nu+du+1 u-knots> <nv+dv+1 v-knots> <nu*nv poles>
#
# poles in u-major order (pole (i, j) at i*nv + j), clamped knot vectors,
# non-rational; natural normal Su × Sv.

type OSurf is Data:
  OAn{s: J.Surf}
  OSpline{du: U32, dv: U32, nu: U32, nv: U32, ku: List<&2, R.Real>, kv: List<&2, R.Real>, poles: List<&2, G.Vec3>}

# same: 1 when start -> end is the increasing parameter; ranged: first/last
# are stated.
type OEdge is Data:
  OEdge{start: U32, end: U32, curve: J.Curve, same: U32, ranged: U32, first: R.Real, last: R.Real}

type OLoop is Data:
  OLoop{outer: U32, uses: List<&2, J.Use>}

# role: support | blend | corner | cap; tol: 0 exact, else the stated
# approximation tolerance in mm.
type OFace is Data:
  OFace{same: U32, surf: OSurf, role: String, tol: R.Real, loops: List<&2, OLoop>}

type OBody is Data:
  OBody{verts: List<&2, G.Vec3>, edges: List<&2, OEdge>, faces: List<&2, OFace>}

# ---------------------------------------------------------------------------
# Printing (built back to front)

def put_reals(xs: List<&2, R.Real>, rest: String) -> String:
  match xs:
    case Nil{}:
      rest
    case +h <> t:
      T.sp(T.put_real(h, put_reals(t, rest)))

def put_vecs(xs: List<&2, G.Vec3>, rest: String) -> String:
  match xs:
    case Nil{}:
      rest
    case +h <> t:
      T.sp(T.put_vec3(h, put_vecs(t, rest)))

def put_curve(+c: J.Curve, rest: String) -> String:
  match c:
    case J.Line{o, d}:
      T.put("line ", T.put_vec3(o, T.sp(T.put_vec3(d, rest))))
    case J.Circle{o, n, x, r}:
      T.put("circle ", T.put_vec3(o, T.sp(T.put_vec3(n, T.sp(T.put_vec3(x, T.sp(T.put_real(r, rest))))))))
    case J.Ellipse{o, n, x, a, b}:
      T.put("ellipse ", T.put_vec3(o, T.sp(T.put_vec3(n, T.sp(T.put_vec3(x, T.sp(T.put_real(a, T.sp(T.put_real(b, rest))))))))))
    case J.BadCurve{}:
      T.put("badcurve", rest)

def put_surf(+s: J.Surf, rest: String) -> String:
  match s:
    case J.Plane{o, n, x}:
      T.put("plane ", T.put_vec3(o, T.sp(T.put_vec3(n, T.sp(T.put_vec3(x, rest))))))
    case J.Cyl{o, a, x, r}:
      T.put("cylinder ", T.put_vec3(o, T.sp(T.put_vec3(a, T.sp(T.put_vec3(x, T.sp(T.put_real(r, rest))))))))
    case J.Cone{o, a, x, r, g}:
      T.put("cone ", T.put_vec3(o, T.sp(T.put_vec3(a, T.sp(T.put_vec3(x, T.sp(T.put_real(r, T.sp(T.put_real(g, rest))))))))))
    case J.Sphere{o, a, x, r}:
      T.put("sphere ", T.put_vec3(o, T.sp(T.put_vec3(a, T.sp(T.put_vec3(x, T.sp(T.put_real(r, rest))))))))
    case J.Torus{o, a, x, big, small}:
      T.put("torus ", T.put_vec3(o, T.sp(T.put_vec3(a, T.sp(T.put_vec3(x, T.sp(T.put_real(big, T.sp(T.put_real(small, rest))))))))))
    case J.BadSurf{}:
      T.put("badsurface", rest)

def put_osurf(+s: OSurf, rest: String) -> String:
  match s:
    case OAn{a}:
      put_surf(a, rest)
    case OSpline{du, dv, nu, nv, ku, kv, poles}:
      T.put("bspline ", T.put_u32(du, T.sp(T.put_u32(dv, T.sp(T.put_u32(nu, T.sp(T.put_u32(nv, put_reals(ku, put_reals(kv, put_vecs(poles, rest)))))))))))

def put_v(vs: List<&2, G.Vec3>, rest: String) -> String:
  match vs:
    case Nil{}:
      rest
    case +h <> t:
      T.put("v ", T.put_vec3(h, T.nl(put_v(t, rest))))

def put_e(es: List<&2, OEdge>, rest: String) -> String:
  match es:
    case Nil{}:
      rest
    case +h <> t:
      OEdge{+s, +e, +c, +same, +ranged, +first, +last} = h
      T.put("e ", T.put_u32(s, T.sp(T.put_u32(e, T.sp(put_curve(c, T.sp(T.put_u32(same, T.sp(T.put_u32(ranged, T.sp(T.put_real(first, T.sp(T.put_real(last, T.nl(put_e(t, rest))))))))))))))))

def put_uses(us: List<&2, J.Use>, rest: String) -> String:
  match us:
    case Nil{}:
      rest
    case +h <> t:
      J.Use{+e, +f} = h
      T.sp(T.put_u32(e, T.sp(T.put_u32(f, put_uses(t, rest)))))

def put_loops(ls: List<&2, OLoop>, rest: String) -> String:
  match ls:
    case Nil{}:
      rest
    case +h <> t:
      OLoop{+outer, +us} = h
      T.put(" l ", T.put_u32(outer, T.sp(T.put(Nat.show(List.length(&2, J.Use, us)), put_uses(us, put_loops(t, rest))))))

def put_f(fs: List<&2, OFace>, rest: String) -> String:
  match fs:
    case Nil{}:
      rest
    case +h <> t:
      OFace{+same, +surf, +role, +tol, +ls} = h
      T.put("f ", T.put_u32(same, T.sp(put_osurf(surf, T.sp(T.put(role, T.sp(T.put_real(tol, T.sp(T.put(Nat.show(List.length(&2, OLoop, ls)), put_loops(ls, T.nl(put_f(t, rest)))))))))))))

def show(+b: OBody) -> String:
  OBody{+vs, +es, +fs} = b
  "ok\nbrep " ++ Nat.show(List.length(&2, G.Vec3, vs)) ++ " " ++ Nat.show(List.length(&2, OEdge, es)) ++ " " ++ Nat.show(List.length(&2, OFace, fs)) ++ "\n" ++ put_v(vs, put_e(es, put_f(fs, "end\n")))
