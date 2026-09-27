import Base
import ./LAWS.bend as Laws
import ../../geometry.bend as G
import ../../topology.bend as T
import ../../robust-predicates.bend as RP
import ../../ports/planar-boolean-selection.bend as Q
import ../../ports/planar-boolean-types.bend as PT
import ../../curve-band.bend as CB
import ../../face-bounds.bend as FB
import ../../identity.bend as Id
import ../../intersections.bend as I
import ../spike/topology-spec.bend as W
import ../spike/arith-spec.bend as AS
import ../spike/base-lemmas.bend as N
import ../spike/topology-lemmas.bend as TL
import ../spike/exact-lemmas.bend as XL
import ../spike/mag-lemmas.bend as XM

# Proofs of the pilot draft. Lemmas are reused from kernel/laws/spike; on
# approval they move to kernel/laws/lib (agent-owned). No @unsafe, no ?holes.

# ------------------------------------------- group 1

def Laws.boolean_selected_union(a, b):
  match a:
    case True{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}

def Laws.boolean_selected_intersection(a, b):
  match a:
    case True{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}

def Laws.boolean_selected_difference(a, b):
  match a:
    case True{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match b:
        case True{}:
          {==}
        case False{}:
          {==}

def Laws.coedge_flip_toggles_direction(edge, forward):
  {==}

# ------------------------------------------- group 2

def Laws.extrude_triangle_well_formed(a, b, c, delta):
  {==}

def Laws.extrude_quad_well_formed(a, b, c, d, delta):
  {==}

def Laws.extrude_euler_every_profile(points, delta):
  TL.extrude_euler(points, delta)

def Laws.transform_preserves_well_formed(s, r, o):
  match s:
    case T.Solid{vs, es, fs}:
      %TL.transform_points_length(vs, r, o) :
        {W.topo_ok(List.length(&2, G.Vec3, G.transform_points(vs, r, o)), es, W.loops(T.transform_faces(fs, r, o)))
          == W.topo_ok(_, es, W.loops(fs)) : Bool}
      %TL.transform_faces_loops(fs, r, o) :
        {W.topo_ok(List.length(&2, G.Vec3, G.transform_points(vs, r, o)), es, W.loops(T.transform_faces(fs, r, o)))
          == W.topo_ok(List.length(&2, G.Vec3, G.transform_points(vs, r, o)), es, _) : Bool}
      {==}

def Laws.reverse_uses_swaps_use_counts(cs, k, dir):
  Equal.trans(Nat, W.use_count(T.reverse_uses(cs, Nil{}), k, dir),
    Nat.add(W.use_count(cs, k, Bool.not(dir)), 0n), W.use_count(cs, k, Bool.not(dir)),
    TL.reverse_use_count(cs, Nil{}, k, dir), N.add_zero(W.use_count(cs, k, Bool.not(dir))))

def Laws.reverse_uses_preserves_closure(cs, edges):
  TL.reverse_closed(cs, edges)

def Laws.frustum_edges_closed(bottom, top, x, r0, r1):
  {==}

def Laws.frustum_vertex_links(bottom, top, x, r0, r1):
  {==}

def Laws.frustum_euler_poincare(bottom, top, x, r0, r1):
  {==}

def Laws.revolve_triangle_edges_closed(ra, ha, rb, hb, rc, hc, o, axis, x):
  {==}

def Laws.revolve_quad_genus_one(r0, h0, r1, h1, r2, h2, r3, h3, o, axis, x):
  {==}

def Laws.revolve_refuses_empty(t, o, axis, x):
  {==}

def Laws.revolve_refuses_two_points(ra, ha, rb, hb, t, o, axis, x):
  {==}

# ------------------------------------------- group 3

def Laws.exact_self_difference_is_zero(x):
  XL.sub_self_zero(x)

def Laws.exact_decision_on_plane_origin(n, a):
  Equal.cong(RP.Sign, RP.Decision, s => RP.Decision{s, RP.ExactDyadic{}},
    RP.sign(RP.sub(RP.dot(n, a), RP.dot(n, a))), RP.ExactlyZero{}, XL.sub_self_zero(RP.dot(n, a)))

def Laws.exact_difference_normal(a, b):
  XL.add_normal(a, RP.neg(b))

def Laws.big_sign_neg(a):
  match a:
    case RP.Big{n, ds}:
      match n:
        case True{}:
          match ds:
            case Nil{}:
              {==}
            case d <> t:
              {==}
        case False{}:
          match ds:
            case Nil{}:
              {==}
            case d <> t:
              {==}

def Laws.mag_cmp_antisymmetric(a, b):
  XL.mag_cmp_anti(a, b)

def Laws.mag_add_exact(a, b, c, da, db, dc):
  Equal.sym(Nat, Nat.add(Nat.add(AS.value(a), AS.value(b)), U32.to_nat(c)), AS.value(RP.mag_add(a, b, c)),
    XM.mag_add_value(a, b, c, da, db, dc))

def Laws.point_plane_invalid_normal(n, p, o, h):
  %Equal.sym(Bool, RP.vec_valid(n), False{}, h) :
    {RP.point_plane_valid(Bool.and(_, Bool.and(RP.vec_valid(p), RP.vec_valid(o))), n, p, o) == RP.Decision{RP.Undefined{}, RP.Invalid{}} : RP.Decision}
  {==}

def Laws.expansion_zero_needs_safe(words):
  {==}

# ------------------------------------------- group 4

def Laws.planar_choose_rejects_invalid_first(x, b, polys, prior, index, sub):
  match b:
    case Q.Membership{bv, bi}:
      match prior:
        case Q.Selection{ps, c}:
          {==}
        case Q.Failed{r, s, i}:
          {==}

def Laws.planar_choose_subtraction(ai, bi, polys, before, count, index):
  match ai:
    case True{}:
      match bi:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match bi:
        case True{}:
          {==}
        case False{}:
          {==}

def Laws.planar_choose_union(ai, bi, polys, before, count, index):
  match ai:
    case True{}:
      match bi:
        case True{}:
          {==}
        case False{}:
          {==}
    case False{}:
      match bi:
        case True{}:
          {==}
        case False{}:
          {==}

def Laws.planar_add_body_unresolved_left(reason, stage, detail, budget, stats, rest):
  match rest:
    case PT.Bodies{b, bb, bs}:
      {==}
    case PT.Unresolved{r, s, d, bb, bs}:
      {==}

def Laws.planar_add_body_unresolved_right(bodies, b0, s0, reason, stage, detail, budget, stats):
  {==}

def Laws.hybrid_undefined_sign_invalidates(contact, valid):
  {==}

def Laws.hybrid_invalid_contact_route(planar, contact):
  {==}

def Laws.bounds_join_unknown_left(b):
  match b:
    case FB.EmptyBounds{}:
      {==}
    case FB.UnknownBounds{}:
      {==}
    case FB.Finite{l, u, s}:
      {==}

def Laws.bounds_join_unknown_right(a):
  match a:
    case FB.EmptyBounds{}:
      {==}
    case FB.UnknownBounds{}:
      {==}
    case FB.Finite{l, u, s}:
      {==}

def Laws.threshold_never_exact(within, exceeds, ev):
  match within:
    case True{}:
      {==}
    case False{}:
      match exceeds:
        case True{}:
          {==}
        case False{}:
          {==}

# ------------------------------------------- group 5

def Laws.transformed_keeps_origin(e, op, occ, rev):
  match e:
    case Id.EntityIdentity{o, i, r, k, ro, st, oo, rel, m, ps}:
      {==}

def Laws.semantic_origin_ignores_revision(ns, op, occ, r1, r2, kind, role, parents):
  {==}
