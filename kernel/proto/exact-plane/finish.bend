import Base
import ../mesh.bend as M
import ./assemble.bend as X

# Final output step: exact checks of the rounded mesh.
#
# The Boolean itself is exact; only the output format is not (F32x2 on the
# 2^-36 mm export grid, see geom.round_vertex). Distinct exact points are
# kept distinct unless they round onto one grid point (X.uniq counts those
# collisions); a triangle whose corners collapse onto fewer than three points
# is dropped and counted; every other triangle's orientation was checked
# exactly on the rounded coordinates when it was made (X.TT good). The mesh
# must then pass the closed, consistently oriented 2-manifold self-check.
# Nothing is merged or moved beyond the export rounding: when a check fails,
# the caller refuses the job (an earlier version clustered points within
# 2^-26 / 2^-20 mm first; no corpus case needs it, and its displacement was
# not visible in the output, so it was removed).

type Fin is Data:
  Fin{mesh: M.Mesh, merged: U32, dropped: U32, inverted: U32, ok: Bool}

type F0 is Data:
  F0{ts: List<&2, M.Tri>, dropped: U32, inv: U32}

def fin0.put(distinct: Bool, t: X.TT, acc: F0) -> F0:
  match distinct:
    case True{}:
      X.TT{a, b, c, tag, _, _, good} = t
      F0{ts, d, inv} = acc
      F0{M.Tri{a, b, c, tag} <> ts, d, (inv + Bool.to_u32(Bool.not(good)) : U32)}
    case False{}:
      F0{ts, d, inv} = acc
      F0{ts, (d + 1 : U32), inv}

def fin0.distinct(t: X.TT) -> Bool:
  X.TT{+a, +b, +c, _, _, _, _} = t
  Bool.and(U32.is_ne(a, b), Bool.and(U32.is_ne(b, c), U32.is_ne(c, a)))

def fin0.go(ts: List<&2, X.TT>, acc: F0) -> F0:
  match ts:
    case Nil{}:
      acc
    case +t <> rest:
      fin0.go(rest, fin0.put(fin0.distinct(t), t, acc))

def finish.k(f: F0, +ups: List<&2, X.Pt>) -> Fin:
  F0{+tris, dropped, +inv} = f
  Fin{M.Mesh{X.positions(ups, Nil{}), tris}, 0, dropped, inv, Bool.and(U32.is_eq(inv, 0), X.self_check(tris))}

# ups: distinct output points in id order; ts: triangles on their ids.
def finish(+ups: List<&2, X.Pt>, ts: List<&2, X.TT>) -> Fin:
  finish.k(fin0.go(ts, F0{Nil{}, 0, 0}), ups)
