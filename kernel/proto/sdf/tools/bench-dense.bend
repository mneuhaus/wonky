import Base

# Micro-benchmark (docs/proto-sdf.md, "Parallel structure"): 2^27 samples of
# a CSG field (sphere minus box) on a 512^3 grid, as a fork tree of 8^5 = 32768
# bricks (two lanes' worth) ending in one flat loop of 16^3 samples per brick.

def sph(+x: F32, +y: F32, +z: F32) -> F32:
  (F32.sqrt((x * x + y * y + z * z : F32)) - 10.0 : F32)

def boxf(+x: F32, +y: F32, +z: F32) -> F32:
  F32.max(F32.max(F32.max((x - 5.0 : F32), F32.neg((x + 5.0 : F32))), F32.max((y - 5.0 : F32), F32.neg((y + 5.0 : F32)))), F32.max((z - 5.0 : F32), F32.neg((z + 5.0 : F32))))

def field(+x: F32, +y: F32, +z: F32) -> F32:
  F32.max(sph(x, y, z), F32.neg(boxf((x - 3.0 : F32), y, z)))

def inside(c: Bool) -> U32:
  match c:
    case True{}:
      1
    case False{}:
      0

# Flat loop over the 4096 samples of a brick (i = x + 16 y + 256 z).
def brick(n: Nat, +j: U32, +x0: F32, +y0: F32, +z0: F32, +h: F32, +acc: U32) -> U32:
  match n:
    case 0n:
      acc
    case 1n+k:
      +x = (x0 + U32.to_f32(U32.and(j, 15)) * h : F32)
      +y = (y0 + U32.to_f32(U32.and(U32.shr(U32.shr(U32.shr(U32.shr(j)))), 15)) * h : F32)
      +z = (z0 + U32.to_f32(U32.shr(U32.shr(U32.shr(U32.shr(U32.shr(U32.shr(U32.shr(U32.shr(j))))))))) * h : F32)
      brick(k, (j + 1 : U32), x0, y0, z0, h, (acc + inside((field(x, y, z) < 0.0 : F32)) : U32))

def grid(+d: Nat, +x: F32, +y: F32, +z: F32, +s: F32, +h: F32) -> U32:
  match d:
    case 0n:
      brick(4096n, 0, x, y, z, h, 0)
    case 1n+p:
      +m = (s * 0.5 : F32)
      a b c e f g i j = grid(p, x, y, z, m, h) grid(p, (x + m : F32), y, z, m, h) grid(p, x, (y + m : F32), z, m, h) grid(p, (x + m : F32), (y + m : F32), z, m, h) grid(p, x, y, (z + m : F32), m, h) grid(p, (x + m : F32), y, (z + m : F32), m, h) grid(p, x, (y + m : F32), (z + m : F32), m, h) grid(p, (x + m : F32), (y + m : F32), (z + m : F32), m, h)
      (a + b + c + e + f + g + i + j : U32)

def count() -> U32:
  grid(5n, F32.neg(12.0), F32.neg(12.0), F32.neg(12.0), 24.0, (24.0 / 512.0 : F32))

def main() -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    +r : U32 = count!()
    t1 : Nat <- IO.now()
    IO.print(U32.show(r) ++ " ms=" ++ Nat.show(Nat.sub(t1, t0)))
