import Base
import ../../geometry.bend as G
import ../../topology.bend as T
import ./topology-spec.bend as W
import ../../precise.bend as PG
import ../../robust-predicates.bend as RP
import ./arith-spec.bend as A
import ./wire/wire.bend as X
import ./wire-spec.bend as WS

# Spike laws (kernel/laws/spike). NOT the project's LAWS.bend: that one is
# Marc's spec at the repository root. These laws measure what proving real
# kernel properties costs; see docs/laws/spike.md.
#
# (a) Topology. W.solid_ok is the combinatorial half of src/brep.mjs
# validateSolid (see topology-spec.bend for exactly what it checks and what it
# does not). None of these laws says anything about F32 coordinates.

# Every triangular / quadrilateral profile (any coordinates, any sweep vector)
# extrudes to a combinatorially valid closed solid. Fixed n only: the proof is
# evaluation, so the law covers exactly these profile sizes.
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

# For a profile of ANY length n (not just 3 or 4): V + F == E + 2 with
# V = 2n, E = 3n, F = n + 2. Counts only; says nothing about indices.
law extrude_euler_every_profile:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  {Nat.add(W.nv(T.extrude(points, delta)), W.nf(T.extrude(points, delta))) == Nat.add(W.ne(T.extrude(points, delta)), 2n) : Nat}

# Rigid transforms keep every solid exactly as well-formed as it was: for all
# solids, not just extrusions (the transform never touches edges or loops).
law transform_preserves_well_formed:
  for +s: T.Solid
  for +r: G.Rotation
  for +o: G.Vec3
  {W.solid_ok(T.transform(s, r, o)) == W.solid_ok(s) : Bool}

# Reversing a loop (extrude's bottom face) turns each forward use of an edge
# into a backward use and vice versa, for every loop and every edge index.
law reverse_uses_swaps_use_counts:
  for +cs: List<&2, T.Coedge>
  for +k: Nat
  for +dir: Bool
  {W.use_count(T.reverse_uses(cs, Nil{}), k, dir) == W.use_count(cs, k, Bool.not(dir)) : Nat}

# Reversing a loop keeps it closed exactly when it was closed, for every loop
# and every edge table (the loop may reference missing edges: then both sides
# are open).
law reverse_uses_preserves_closure:
  for +cs: List<&2, T.Coedge>
  for +edges: List<&2, T.Edge>
  {W.closed(T.reverse_uses(cs, Nil{}), edges) == W.closed(cs, edges) : Bool}

# (b) Exact arithmetic (kernel/robust-predicates.bend). Base defines U32 as 32
# Bools, so U32 arithmetic is provable; F32 operations are Base postulates
# (laws without defs) and are opaque to the checker, even on literals.

# The exact fallback: x - x is exactly zero for every Big (normalized or not),
# hence a point on its own plane origin is classified ExactlyZero.
law exact_self_difference_is_zero:
  for +x: RP.Big
  {RP.sign(RP.sub(x, x)) == RP.ExactlyZero{} : RP.Sign}

law exact_decision_on_plane_origin:
  for +n: PG.Vec3
  for +a: PG.Vec3
  {RP.exact_decision(n, a, a) == RP.Decision{RP.ExactlyZero{}, RP.ExactDyadic{}} : RP.Decision}

# Exact differences are always in normal form: never a negative zero. (Added
# after the mutant `make-keeps-negative-zero` survived the other laws.)
law exact_difference_normal:
  for +a: RP.Big
  for +b: RP.Big
  {A.negative_zero(RP.sub(a, b)) == False{} : Bool}

# Magnitude comparison of digit lists is antisymmetric.
law mag_cmp_antisymmetric:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  {A.cmp_flip(RP.mag_cmp(b, a)) == RP.mag_cmp(a, b) : Cmp}

# The multi-limb adder of the exact predicates is exact: for base-4096 digit
# lists (every digit <= 4095) and a carry-in <= 1, RP.mag_add computes
# value(a) + value(b) + carry, where value(d0, d1, ..) = d0 + 4096 * (d1 + ..).
law mag_add_exact:
  for +a: List<&2, U32>
  for +b: List<&2, U32>
  for +c: U32
  for da: {A.digits_ok(a) == True{} : Bool}
  for db: {A.digits_ok(b) == True{} : Bool}
  for dc: {A.le(U32.to_nat(c), 1n) == True{} : Bool}
  {A.value(RP.mag_add(a, b, c)) == Nat.add(Nat.add(A.value(a), A.value(b)), U32.to_nat(c)) : Nat}

# U32.add (the checker's 32-step ripple-carry adder) is Nat addition with the
# dropped carry weighted 2^32.
law u32_add_exact:
  for +a: U32
  for +b: U32
  {Nat.add(U32.to_nat(a), U32.to_nat(b)) == Nat.add(U32.to_nat(U32.add(a, b)), A.scaled(32n, A.carry32(a, b))) : Nat}

# Below 2^n an n-bit Word sum is exact. Stated for every width n because the
# checker strongly normalizes law parameter types: writing the U32 bound
# A.pow2(32n) (or any Nat near 2^32) there expands 2^32 unary Succ nodes and
# overflows its stack. U32.add is Word.add(32n, ..) under the U32 wrapper.
law word_add_no_overflow:
  for +n: Nat
  for +a: Word(n)
  for +b: Word(n)
  for lt: {Nat.is_lt(Nat.add(Word.to_nat(n, a), Word.to_nat(n, b)), A.pow2(n)) == True{} : Bool}
  {Word.to_nat(n, Word.add(n, a, b)) == Nat.add(Word.to_nat(n, a), Word.to_nat(n, b)) : Nat}

# (c) Wire codec round trips (codec generated by scripts/native-bridge/gen-wire.mjs
# into kernel/laws/spike/wire; regenerate, never edit).

law wire_coedge_roundtrip:
  for +c: T.Coedge
  {X.decode_topology_Coedge(X.encode_topology_Coedge(c)) == Some{c} : Maybe<&2, T.Coedge>}

law wire_edge_roundtrip:
  for +e: T.Edge
  {X.decode_topology_Edge(X.encode_topology_Edge(e)) == Some{e} : Maybe<&2, T.Edge>}

# A trailing word makes decoding fail instead of being ignored.
law wire_coedge_rejects_trailing:
  for +c: T.Coedge
  for +w: U32
  {X.decode_topology_Coedge(X.enc_topology_Coedge(c, [w])) == None{} : Maybe<&2, T.Coedge>}

# Faces carry F32 frames and a coedge list. Assumed, not proven: each frame
# vector's F32 bits decode back to it (ho, hn, hx), and the loop length
# survives its U32 count word (pre; true below 2^32, a bound no law can spell).
law wire_face_roundtrip:
  for +o: G.Vec3
  for +n: G.Vec3
  for +x: G.Vec3
  for +b: List<&2, T.Coedge>
  for ho: {WS.bits_id(o) == o : G.Vec3}
  for hn: {WS.bits_id(n) == n : G.Vec3}
  for hx: {WS.bits_id(x) == x : G.Vec3}
  for pre: {U32.to_nat(U32.from_nat(List.length(&2, T.Coedge, b))) == List.length(&2, T.Coedge, b) : Nat}
  {X.decode_topology_Face(X.encode_topology_Face(T.Face{o, n, x, b})) == Some{T.Face{o, n, x, b}} : Maybe<&2, T.Face>}
