import Base
import ../../geometry.bend as G
import ../../precise.bend as PG
import ../../real.bend as R
import ../../topology.bend as T
import ../../analytic.bend as A
import ../../revolve.bend as Rv
import ../../boolean.bend as B
import ../../face-bounds.bend as FB
import ../../identity.bend as Id
import ../../intersections.bend as I
import ../../curve-band.bend as CB
import ../../robust-predicates.bend as RP
import ../../halfspace.bend as H
import ../../solid-classification.bend as S
import ../../ports/types.bend as P
import ../../ports/hybrid.bend as Hy
import ../../ports/curved-contact-topology.bend as CT
import ../../ports/planar-boolean-types.bend as PT
import ../../ports/planar-boolean.bend as PB
import ../../ports/planar-boolean-selection.bend as Q
import ../spike/topology-spec.bend as W
import ../spike/arith-spec.bend as AS

# DRAFT for Marc's approval (docs/laws.md section 6). Not the root LAWS.bend.
# Proven by kernel/laws/pilot/PROOF.bend; gate: node scripts/laws/gate.mjs kernel/laws/pilot.
#
# Everything a claim calls is part of the spec: the helpers below and the spec
# modules W (kernel/laws/spike/topology-spec.bend) and AS (arith-spec.bend).
# On approval they move under the same human-only rule and hash lock as LAWS.bend.
# No law here says anything about the value of an F32: coordinates, radii and
# tolerances appear only as opaque, universally quantified passengers.

# ---------------------------------------------------------------- spec helpers

def a_edges(s: A.Solid) -> List<&2, A.Edge>:
  A.Solid{_, edges, _} = s
  edges

def a_faces(s: A.Solid) -> List<&2, A.Face>:
  A.Solid{_, _, faces} = s
  faces

def a_loop_count(faces: List<&2, A.Face>) -> Nat:
  match faces:
    case Nil{}:
      0n
    case A.Face{_, _, loops} <> tail:
      Nat.add(List.length(&2, A.Loop, loops), a_loop_count(tail))

# Euler-Poincare V - E + 2F - L - 2S + 2G = 0, rearranged for Nat:
# V + 2F + 2G == E + L + 2S.
def euler_holds(s: A.Solid, +shells: Nat, +genus: Nat) -> Bool:
  A.Solid{vertices, edges, +faces} = s
  +f = List.length(&2, A.Face, faces)
  Nat.is_eq(Nat.add(List.length(&2, PG.Vec3, vertices), Nat.add(Nat.add(f, f), Nat.add(genus, genus))),
    Nat.add(List.length(&2, A.Edge, edges), Nat.add(a_loop_count(faces), Nat.add(shells, shells))))

def flip_sign(s: RP.Sign) -> RP.Sign:
  match s:
    case RP.Negative{}:
      RP.Positive{}
    case RP.Positive{}:
      RP.Negative{}
    case RP.ExactlyZero{}:
      RP.ExactlyZero{}
    case RP.Undefined{}:
      RP.Undefined{}

def origin_of(e: Id.EntityIdentity) -> String:
  Id.EntityIdentity{origin, _, _, _, _, _, _, _, _, _} = e
  origin

def is_exact_in_plane(r: CB.BandResult) -> Bool:
  match r:
    case CB.Resolved{CB.ExactCurveInPlane{}, _}:
      True{}
    case _:
      False{}

# ------------------------------------------- group 1: truth table and coedge flip
# Replace the relational laws boolean_union_partition / boolean_differences_disjoint
# and coedge_flip_involution, which survive the mutants intersection=or,
# intersection=a and flip=identity (docs/laws/prior-art.md section 1.7).

law boolean_selected_union:
  for +a: Bool
  for +b: Bool
  {B.selected(0, a, b) == Bool.or(a, b) : Bool}

law boolean_selected_intersection:
  for +a: Bool
  for +b: Bool
  {B.selected(1, a, b) == Bool.and(a, b) : Bool}

law boolean_selected_difference:
  for +a: Bool
  for +b: Bool
  {B.selected(2, a, b) == Bool.and(a, Bool.not(b)) : Bool}

law coedge_flip_toggles_direction:
  for +edge: U32
  for +forward: Bool
  {T.flip(T.Use{edge, forward}) == T.Use{edge, Bool.not(forward)} : T.Coedge}

# ------------------------------------------- group 2: topology of the constructors

# Bounded: n = 3 and n = 4 only (proof by evaluation, coordinates opaque).
law extrude_triangle_well_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b, c], delta)) == True{} : Bool}

law extrude_quad_well_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +d: G.Vec3
  for +delta: G.Vec3
  {W.solid_ok(T.extrude([a, b, c, d], delta)) == True{} : Bool}

# Every profile length: V + F == E + 2 (counts only).
law extrude_euler_every_profile:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {Nat.add(W.nv(T.extrude(points, delta)), W.nf(T.extrude(points, delta))) == Nat.add(W.ne(T.extrude(points, delta)), 2n) : Nat}

law transform_preserves_well_formed:
  for +s: T.Solid
  for +r: G.Rotation
  for +o: G.Vec3
  {W.solid_ok(T.transform(s, r, o)) == W.solid_ok(s) : Bool}

law reverse_uses_swaps_use_counts:
  for +cs: List<&2, T.Coedge>
  for +k: Nat
  for +dir: Bool
  {W.use_count(T.reverse_uses(cs, Nil{}), k, dir) == W.use_count(cs, k, Bool.not(dir)) : Nat}

law reverse_uses_preserves_closure:
  for +cs: List<&2, T.Coedge>
  for +edges: List<&2, T.Edge>
  {W.closed(T.reverse_uses(cs, Nil{}), edges) == W.closed(cs, edges) : Bool}

law frustum_edges_closed:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {S.edges_closed(a_edges(A.frustum(bottom, top, x, r0, r1)), a_faces(A.frustum(bottom, top, x, r0, r1)), 0) == True{} : Bool}

law frustum_vertex_links:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {CT.valid(A.frustum(bottom, top, x, r0, r1)) == True{} : Bool}

law frustum_euler_poincare:
  for +bottom: PG.Vec3
  for +top: PG.Vec3
  for +x: PG.Vec3
  for +r0: R.Real
  for +r1: R.Real
  {euler_holds(A.frustum(bottom, top, x, r0, r1), 1n, 0n) == True{} : Bool}

# Bounded: a revolved 3-point profile (the 8b21014 defect class).
law revolve_triangle_edges_closed:
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +rc: R.Real
  for +hc: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {S.edges_closed(a_edges(Rv.shell([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}, Rv.Ring{rc, hc}], o, axis, x)), a_faces(Rv.shell([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}, Rv.Ring{rc, hc}], o, axis, x)), 0) == True{} : Bool}

# Bounded: a revolved 4-point profile is one shell of genus 1 (a solid torus).
law revolve_quad_genus_one:
  for +r0: R.Real
  for +h0: R.Real
  for +r1: R.Real
  for +h1: R.Real
  for +r2: R.Real
  for +h2: R.Real
  for +r3: R.Real
  for +h3: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {euler_holds(Rv.shell([Rv.Ring{r0, h0}, Rv.Ring{r1, h1}, Rv.Ring{r2, h2}, Rv.Ring{r3, h3}], o, axis, x), 1n, 1n) == True{} : Bool}

# The 9467cfb case: short profiles are refused before any geometry is built.
law revolve_refuses_empty:
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve(Nil{}, t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}

law revolve_refuses_two_points:
  for +ra: R.Real
  for +ha: R.Real
  for +rb: R.Real
  for +hb: R.Real
  for +t: R.Real
  for +o: PG.Vec3
  for +axis: PG.Vec3
  for +x: PG.Vec3
  {Rv.revolve([Rv.Ring{ra, ha}, Rv.Ring{rb, hb}], t, o, axis, x) == Rv.Refused{1} : Rv.Revolved}

# ------------------------------------------- group 3: exact integer arithmetic
# The integer fallback of kernel/robust-predicates.bend only. The F32 filter
# in front of it and the F32 -> Big conversion (from_word) are not covered.

law exact_self_difference_is_zero:
  for +x: RP.Big
  {RP.sign(RP.sub(x, x)) == RP.ExactlyZero{} : RP.Sign}

law exact_decision_on_plane_origin:
  for +n: PG.Vec3
  for +a: PG.Vec3
  {RP.exact_decision(n, a, a) == RP.Decision{RP.ExactlyZero{}, RP.ExactDyadic{}} : RP.Decision}

law exact_difference_normal:
  for +a: RP.Big
  for +b: RP.Big
  {AS.negative_zero(RP.sub(a, b)) == False{} : Bool}

law big_sign_neg:
  for +a: RP.Big
  {RP.sign(RP.neg(a)) == flip_sign(RP.sign(a)) : RP.Sign}

law mag_cmp_antisymmetric:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  {AS.cmp_flip(RP.mag_cmp(b, a)) == RP.mag_cmp(a, b) : Cmp}

law mag_add_exact:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  for +c: U32
  for da: {AS.digits_ok(a) == True{} : Bool}
  for db: {AS.digits_ok(b) == True{} : Bool}
  for dc: {AS.le(U32.to_nat(c), 1n) == True{} : Bool}
  {AS.value(RP.mag_add(a, b, c)) == Nat.add(Nat.add(AS.value(a), AS.value(b)), U32.to_nat(c)) : Nat}

law point_plane_invalid_normal:
  for +n: PG.Vec3
  for +p: PG.Vec3
  for +o: PG.Vec3
  for h: {RP.vec_valid(n) == False{} : Bool}
  {RP.point_plane(n, p, o) == RP.Decision{RP.Undefined{}, RP.Invalid{}} : RP.Decision}

law expansion_zero_needs_safe:
  for +words: List<&2, F32>
  {I.expansion_zero(I.Expansion{False{}, words}) == False{} : Bool}

# ------------------------------------------- group 4: control flow, no silent fallback

law planar_choose_rejects_invalid_first:
  for +x: Bool
  for +b: Q.Membership
  for +polys: List<&2, H.Polygon>
  for +prior: Q.Selection
  for +index: U32
  for +sub: Bool
  {Q.choose(Q.Membership{False{}, x}, b, polys, prior, index, sub) == Q.Failed{P.UnsupportedArrangement{}, 4, index} : Q.Selection}

law planar_choose_subtraction:
  for +ai: Bool
  for +bi: Bool
  for +polys: List<&2, H.Polygon>
  for +before: List<&2, H.Polygon>
  for +count: U32
  for +index: U32
  {Q.choose(Q.Membership{True{}, ai}, Q.Membership{True{}, bi}, polys, Q.Selection{before, count}, index, True{})
    == Q.Selection{Bool.pick(List<&2, H.Polygon>, B.selected(2, ai, bi), List.append(&2, H.Polygon, before, polys), before),
      (count + Bool.pick(U32, B.selected(2, ai, bi), 1, 0) : U32)} : Q.Selection}

law planar_choose_union:
  for +ai: Bool
  for +bi: Bool
  for +polys: List<&2, H.Polygon>
  for +before: List<&2, H.Polygon>
  for +count: U32
  for +index: U32
  {Q.choose(Q.Membership{True{}, ai}, Q.Membership{True{}, bi}, polys, Q.Selection{before, count}, index, False{})
    == Q.Selection{Bool.pick(List<&2, H.Polygon>, B.selected(0, ai, bi), List.append(&2, H.Polygon, before, polys), before),
      (count + Bool.pick(U32, B.selected(0, ai, bi), 1, 0) : U32)} : Q.Selection}

law planar_add_body_unresolved_left:
  for +reason: P.Reason
  for +stage: U32
  for +detail: U32
  for +budget: R.Real
  for +stats: PT.Stats
  for +rest: PT.Result
  {PB.add_body(PT.Unresolved{reason, stage, detail, budget, stats}, rest) == PT.Unresolved{reason, stage, detail, budget, stats} : PT.Result}

law planar_add_body_unresolved_right:
  for +bodies: List<&2, PT.Body>
  for +b0: R.Real
  for +s0: PT.Stats
  for +reason: P.Reason
  for +stage: U32
  for +detail: U32
  for +budget: R.Real
  for +stats: PT.Stats
  {PB.add_body(PT.Bodies{bodies, b0, s0}, PT.Unresolved{reason, stage, detail, budget, stats}) == PT.Unresolved{reason, stage, detail, budget, stats} : PT.Result}

law hybrid_undefined_sign_invalidates:
  for +contact: Bool
  for +valid: Bool
  {Hy.contact_sign(RP.Undefined{}, Hy.ContactState{valid, contact}) == Hy.ContactState{False{}, contact} : Hy.ContactState}

law hybrid_invalid_contact_route:
  for +planar: Bool
  for +contact: Bool
  {Hy.choose_route(planar, Hy.ContactState{False{}, contact}) == Hy.InvalidRoute{} : Hy.Route}

law bounds_join_unknown_left:
  for +b: FB.Bounds
  {FB.join(FB.UnknownBounds{}, b) == FB.UnknownBounds{} : FB.Bounds}

law bounds_join_unknown_right:
  for +a: FB.Bounds
  {FB.join(a, FB.UnknownBounds{}) == FB.UnknownBounds{} : FB.Bounds}

law threshold_never_exact:
  for +within: Bool
  for +exceeds: Bool
  for +ev: CB.Evidence
  {is_exact_in_plane(CB.classify_threshold(within, exceeds, ev)) == False{} : Bool}

# ------------------------------------------- group 5: identity

law transformed_keeps_origin:
  for +e: Id.EntityIdentity
  for +op: String
  for +occ: String
  for +rev: String
  {origin_of(Id.transformed(e, op, occ, rev)) == origin_of(e) : String}

law semantic_origin_ignores_revision:
  for +ns: String
  for +op: String
  for +occ: String
  for +r1: String
  for +r2: String
  for +kind: String
  for +role: String
  for +parents: List<&2, Id.ParentIdentity>
  {origin_of(Id.created(ns, op, occ, r1, kind, role, "semantic", parents)) == origin_of(Id.created(ns, op, occ, r2, kind, role, "semantic", parents)) : String}
