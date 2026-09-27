import Base
import ../kernel/real.bend as R
import ../kernel/precise.bend as G
import ../kernel/analytic.bend as A
import ../kernel/topology.bend as T
import ../kernel/boolean.bend as B
import ../kernel/comparison.bend as C

# The SAME production functions run on JS, native ARM64 and Metal. Every
# output field is consumed; this is not a scalar surrogate for a Boolean.
type Evidence is Data:
  Evidence{hash: U32, volume: R.Real, errors: U32}

def mix(a: U32, b: U32) -> U32:
  (a * 16777619 + b : U32)

def bit(b: Bool) -> U32:
  Bool.pick(U32, b, 1, 0)

def real_hash(r: R.Real) -> U32:
  R.Real{hi, lo} = r
  mix(F32.bits(hi), F32.bits(lo))

def vec_hash(v: G.Vec3) -> U32:
  G.V3{x, y, z} = v
  mix(mix(real_hash(x), real_hash(y)), real_hash(z))

def vertices(xs: List<&2, G.Vec3>) -> U32:
  match xs:
    case Nil{}:
      1
    case x <> tail:
      mix(vec_hash(x), vertices(tail))

def curve(c: A.Curve) -> U32:
  match c:
    case A.Line{o, d}:
      mix(1, mix(vec_hash(o), vec_hash(d)))
    case A.Circle{o, n, x, r}:
      mix(2, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), real_hash(r))))
    case A.Ellipse{o, n, x, a, b}:
      mix(3, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), mix(real_hash(a), real_hash(b)))))

def surface(s: A.Surface) -> U32:
  match s:
    case A.Plane{o, n, x}:
      mix(1, mix(mix(vec_hash(o), vec_hash(n)), vec_hash(x)))
    case A.Cylinder{o, n, x, r}:
      mix(2, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), real_hash(r))))
    case A.Cone{o, n, x, r, a}:
      mix(3, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), mix(real_hash(r), real_hash(a)))))
    case A.Sphere{o, n, x, r}:
      mix(4, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), real_hash(r))))
    case A.Torus{o, n, x, a, b}:
      mix(5, mix(mix(vec_hash(o), vec_hash(n)), mix(vec_hash(x), mix(real_hash(a), real_hash(b)))))

def edges(xs: List<&2, A.Edge>) -> U32:
  match xs:
    case Nil{}:
      1
    case A.Edge{a, b, c, s} <> tail:
      mix(mix(mix(a, b), mix(curve(c), bit(s))), edges(tail))

def uses(xs: List<&2, T.Coedge>) -> U32:
  match xs:
    case Nil{}:
      1
    case T.Use{e, f} <> tail:
      mix(mix(e, bit(f)), uses(tail))

def loops(xs: List<&2, A.Loop>) -> U32:
  match xs:
    case Nil{}:
      1
    case A.Loop{o, us} <> tail:
      mix(mix(bit(o), uses(us)), loops(tail))

def faces(xs: List<&2, A.Face>) -> U32:
  match xs:
    case Nil{}:
      1
    case A.Face{s, f, ls} <> tail:
      mix(mix(surface(s), mix(bit(f), loops(ls))), faces(tail))

def solid(s: A.Solid) -> U32:
  A.Solid{vs, es, fs} = s
  mix(mix(vertices(vs), edges(es)), faces(fs))

def bounds(b: A.Bounds) -> U32:
  A.Bounds{a, z} = b
  mix(vec_hash(a), vec_hash(z))

def combine(a: Evidence, b: Evidence) -> Evidence:
  Evidence{ah, av, ae} = a
  Evidence{bh, bv, be} = b
  Evidence{(ah + bh : U32), R.add(av, bv), (ae + be : U32)}

def bodies(xs: List<&2, B.Body>) -> Evidence:
  match xs:
    case Nil{}:
      Evidence{0, R.from_f32(0.0), 0}
    case B.Body{s, +v, b} <> tail:
      combine(Evidence{mix(solid(s), mix(real_hash(v), bounds(b))), v, 0}, bodies(tail))

def boolean_case(+id: U32) -> B.BooleanResult:
  +h = (8.0 + U32.to_f32((id % 17 : U32)) / 4.0 : F32)
  r = (5.0 + U32.to_f32((id % 31 : U32)) / 16.0 : F32)
  hole = (1.0 + U32.to_f32((id % 13 : U32)) / 16.0 : F32)
  B.coaxial(G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, h), R.from_f32(r),
    G.v3(0.0, 0.0, F32.neg(1.0)), G.v3(0.0, 0.0, (h + 1.0 : F32)), R.from_f32(hole), 2)

def boolean_evidence(result: B.BooleanResult) -> Evidence:
  B.BooleanResult{ok, void, bs} = result
  combine(bodies(bs), Evidence{0, R.from_f32(0.0), (bit(Bool.not(ok)) + bit(void) : U32)})

def comparison_case(+id: U32) -> C.CylinderComparison:
  +h = (8.0 + U32.to_f32((id % 17 : U32)) / 4.0 : F32)
  r = (5.0 + U32.to_f32((id % 31 : U32)) / 16.0 : F32)
  rb = (1.0 + U32.to_f32((id % 13 : U32)) / 16.0 : F32)
  +z = (U32.to_f32((id % 65 : U32)) / 4.0 : F32)
  C.coaxial(G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, h), R.from_f32(r),
    G.v3(0.0, 0.0, z), G.v3(0.0, 0.0, (z + h : F32)), R.from_f32(rb), R.from_f32(0.0000001))

def comparison_evidence(result: C.CylinderComparison) -> Evidence:
  C.CylinderComparison{+ok, rel, eq, axis, before, after, common, added, removed, +diff, gap, overlap, contact} = result
  h1 = mix(mix(bit(ok), rel), mix(bit(eq), F32.bits(axis)))
  h2 = mix(mix(real_hash(before), real_hash(after)), real_hash(common))
  h3 = mix(mix(real_hash(added), real_hash(removed)), real_hash(diff))
  h4 = mix(mix(real_hash(gap), real_hash(overlap)), real_hash(contact))
  Evidence{mix(mix(h1, h2), mix(h3, h4)), diff, bit(Bool.not(ok))}

def one(kind: Bool, id: U32) -> Evidence:
  match kind:
    case True{}:
      boolean_evidence(boolean_case(id))
    case False{}:
      comparison_evidence(comparison_case(id))

def leaf(left: Nat, +kind: Bool, +id: U32, acc: Evidence) -> Evidence:
  match left:
    case 0n:
      acc
    case 1n+p:
      leaf(p, kind, (id + 1 : U32), combine(acc, one(kind, id)))

# Coarse, balanced independent model/check batches. No change to geometry.
def batch_nodes(depth: Nat, +count: Nat, +kind: Bool, +start: U32, span: U32) -> Evidence:
  match depth:
    case 0n:
      leaf(count, kind, start, Evidence{0, R.from_f32(0.0), 0})
    case 1n+ +p:
      +stride = (span / 2 : U32)
      a b = batch_nodes(p, count, kind, start, stride) batch_nodes(p, count, kind, (start + stride : U32), stride)
      combine(a, b)

# Compute the non-tail recursive power once, before the fork tree. Keeping
# fork nodes flat lets the CPU scheduler distribute their descendants.
def batch(+depth: Nat, +count: Nat, kind: Bool, start: U32) -> Evidence:
  batch_nodes(depth, count, kind, start, (U32.from_nat(count) * U32.pow(2, depth) : U32))

def evidence_json(e: Evidence) -> String:
  Evidence{hash, R.Real{hi, lo}, errors} = e
  "\"hash\":" ++ U32.show(hash) ++ ",\"hiBits\":" ++ U32.show(F32.bits(hi)) ++ ",\"loBits\":" ++ U32.show(F32.bits(lo)) ++ ",\"errors\":" ++ U32.show(errors)

def number(m: Maybe<&2, Nat>) -> Nat:
  match m:
    case Some{n}:
      n
    case None{}:
      0n
