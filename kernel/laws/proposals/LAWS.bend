import Base
import ../../geometry.bend as G
import ../../precise.bend as PG
import ../../real.bend as R
import ../../topology.bend as T
import ../../revolve.bend as Rv
import ../spike/topology-spec.bend as W

# PROPOSALS, not part of the pilot batch and not approved. Each law here is
# proven (kernel/laws/proposals/PROOF.bend; gate: node scripts/laws/gate.mjs
# kernel/laws/proposals) and backs one recommendation in docs/laws/pilot.md.

def t_edges(s: T.Solid) -> List<&2, T.Edge>:
  T.Solid{_, es, _} = s
  es

def t_loops(s: T.Solid) -> List<&2, List<&2, T.Coedge>>:
  T.Solid{_, _, fs} = s
  W.loops(fs)

# Stronger than transform_preserves_well_formed: a rigid transform keeps the
# edge table and every face loop literally unchanged, so it also cannot reverse
# orientation (kills the transform-reverses-loops mutant at the LAW, not only
# in the proof).
law transform_keeps_edges:
  for +s: T.Solid
  for +r: G.Rotation
  for +o: G.Vec3
  {t_edges(T.transform(s, r, o)) == t_edges(s) : List<&2, T.Edge>}

law transform_keeps_loops:
  for +s: T.Solid
  for +r: G.Rotation
  for +o: G.Vec3
  {t_loops(T.transform(s, r, o)) == t_loops(s) : List<&2, List<&2, T.Coedge>>}

# The 1-point twin of revolve_refuses_two_points.
law revolve_refuses_one_point:
  for +ra: R.Real
  for +ha: R.Real
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve([Rv.Ring{ra, ha}], t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}

# FINDINGS stated as laws: T.extrude has no refusal path. A profile with fewer
# than three points yields an ill-formed solid instead of a capability error
# (the JS caller has to catch it). See docs/laws/pilot.md, proposal K-2.
law extrude_empty_is_ill_formed:
  for +delta: G.Vec3
  {W.solid_ok(T.extrude(Nil{}, delta)) == False{} : Bool}

law extrude_two_points_is_ill_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b], delta)) == False{} : Bool}

# Evidence that the bounded well-formedness laws extend past n = 4 by
# evaluation (not a spec for every n).
law extrude_pentagon_well_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +d: G.Vec3
  for +e: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b, c, d, e], delta)) == True{} : Bool}
