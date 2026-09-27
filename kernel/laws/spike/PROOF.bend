import Base
import ./LAWS.bend as Laws
import ../../geometry.bend as G
import ../../topology.bend as T
import ./topology-spec.bend as W
import ./base-lemmas.bend as N
import ./topology-lemmas.bend as TL
import ../../precise.bend as PG
import ../../robust-predicates.bend as RP
import ./arith-spec.bend as A
import ./exact-lemmas.bend as XL
import ./arith-lemmas.bend as AL
import ./wire/wire.bend as X
import ./mag-lemmas.bend as XM
import ./wire-lemmas.bend as XW

# (a) Topology

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

# (b) Exact arithmetic

def Laws.exact_self_difference_is_zero(x):
  XL.sub_self_zero(x)

def Laws.exact_decision_on_plane_origin(n, a):
  Equal.cong(RP.Sign, RP.Decision, s => RP.Decision{s, RP.ExactDyadic{}},
    RP.sign(RP.sub(RP.dot(n, a), RP.dot(n, a))), RP.ExactlyZero{}, XL.sub_self_zero(RP.dot(n, a)))

def Laws.exact_difference_normal(a, b):
  XL.add_normal(a, RP.neg(b))

def Laws.mag_cmp_antisymmetric(a, b):
  XL.mag_cmp_anti(a, b)

def Laws.mag_add_exact(a, b, c, da, db, dc):
  Equal.sym(Nat, Nat.add(Nat.add(A.value(a), A.value(b)), U32.to_nat(c)), A.value(RP.mag_add(a, b, c)),
    XM.mag_add_value(a, b, c, da, db, dc))

def Laws.u32_add_exact(a, b):
  AL.u32_add_value(a, b)

def Laws.word_add_no_overflow(n, a, b, lt):
  +s = Nat.add(Word.to_nat(n, a), Word.to_nat(n, b))
  -r = Word.to_nat(n, Word.adc(n, a, b, False{}, False{}))
  -co = A.carry_out(n, a, b, False{})
  AL.no_carry(n, A.carry_out(n, a, b, False{}), Word.to_nat(n, Word.adc(n, a, b, False{}, False{})), s,
    Equal.trans(Nat, s, Nat.add(s, 0n), Nat.add(r, A.scaled(n, co)),
      Equal.sym(Nat, Nat.add(s, 0n), s, N.add_zero(s)), AL.adc_value(n, a, b, False{})), lt)

# (c) Wire codec

def Laws.wire_coedge_roundtrip(c):
  %XW.coedge_step(c, True{}, Nil{}) : {X.decode_topology_Coedge_s(_) == Some{c} : Maybe<&2, T.Coedge>}
  {==}

def Laws.wire_edge_roundtrip(e):
  %XW.edge_step(e, True{}, Nil{}) : {X.decode_topology_Edge_s(_) == Some{e} : Maybe<&2, T.Edge>}
  {==}

def Laws.wire_coedge_rejects_trailing(c, w):
  %XW.coedge_step(c, True{}, [w]) : {X.decode_topology_Coedge_s(_) == None{} : Maybe<&2, T.Coedge>}
  {==}

def Laws.wire_face_roundtrip(o, n, x, b, ho, hn, hx, pre):
  +r3 = X.enc_L_topology_Coedge(b, Nil{})
  +r2 = X.enc_geometry_Vec3(x, r3)
  +r1 = X.enc_geometry_Vec3(n, r2)
  -f = {T.Face{o, n, x, b} : T.Face}
  %XW.vec3_step(o, ho, True{}, r1) : {X.decode_topology_Face_s(X.dec_topology_Face_s0(_)) == Some{f} : Maybe<&2, T.Face>}
  %XW.vec3_step(n, hn, True{}, r2) : {X.decode_topology_Face_s(X.dec_topology_Face_s1(o, _)) == Some{f} : Maybe<&2, T.Face>}
  %XW.vec3_step(x, hx, True{}, r3) : {X.decode_topology_Face_s(X.dec_topology_Face_s2(o, n, _)) == Some{f} : Maybe<&2, T.Face>}
  %XW.coedges_list(b, True{}, Nil{}, pre) : {X.decode_topology_Face_s(X.dec_topology_Face_s3(o, n, x, _)) == Some{f} : Maybe<&2, T.Face>}
  {==}
