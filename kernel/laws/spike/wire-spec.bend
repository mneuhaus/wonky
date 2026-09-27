import Base
import ../../geometry.bend as G
import ./wire/wire.bend as X

# What the wire round-trip laws must assume about F32: decoding the bits of
# each coordinate gives the coordinate back. F32.bits is a Base postulate, so
# this is a statement about the C/JS runtimes, not something Bend can prove.
def bits_id(v: G.Vec3) -> G.Vec3:
  G.V3{x, y, z} = v
  G.V3{X.f32_of_bits(F32.bits(x)), X.f32_of_bits(F32.bits(y)), X.f32_of_bits(F32.bits(z))}
