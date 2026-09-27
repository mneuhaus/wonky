import Base
import ./real.bend as R

type Vec3 is Data:
  V3{x: R.Real, y: R.Real, z: R.Real}

type Rotation is Data:
  Rotation{x: Vec3, y: Vec3, z: Vec3}

type Frame is Data:
  Frame{origin: Vec3, normal: Vec3, x: Vec3, y: Vec3}

def v3(x: F32, y: F32, z: F32) -> Vec3:
  V3{R.from_f32(x), R.from_f32(y), R.from_f32(z)}

def add(a: Vec3, b: Vec3) -> Vec3:
  V3{ax, ay, az} = a
  V3{bx, by, bz} = b
  V3{R.add(ax, bx), R.add(ay, by), R.add(az, bz)}

def sub(a: Vec3, b: Vec3) -> Vec3:
  V3{ax, ay, az} = a
  V3{bx, by, bz} = b
  V3{R.sub(ax, bx), R.sub(ay, by), R.sub(az, bz)}

def scale(a: Vec3, +s: R.Real) -> Vec3:
  V3{ax, ay, az} = a
  V3{R.mul(ax, s), R.mul(ay, s), R.mul(az, s)}

def dot(a: Vec3, b: Vec3) -> R.Real:
  V3{ax, ay, az} = a
  V3{bx, by, bz} = b
  R.add(R.add(R.mul(ax, bx), R.mul(ay, by)), R.mul(az, bz))

def cross(a: Vec3, b: Vec3) -> Vec3:
  V3{+ax, +ay, +az} = a
  V3{+bx, +by, +bz} = b
  V3{R.sub(R.mul(ay, bz), R.mul(az, by)), R.sub(R.mul(az, bx), R.mul(ax, bz)), R.sub(R.mul(ax, by), R.mul(ay, bx))}

def normalize(+a: Vec3) -> Vec3:
  scale(a, R.div(R.from_f32(1.0), R.sqrt(dot(a, a))))

def distance(a: Vec3, b: Vec3) -> F32:
  +d = sub(a, b)
  R.approx(R.sqrt(dot(d, d)))

def rotate(point: Vec3, rotation: Rotation) -> Vec3:
  V3{a, b, c} = point
  Rotation{x, y, z} = rotation
  add(add(scale(x, a), scale(y, b)), scale(z, c))

def frame(origin: Vec3, normal: Vec3, x: Vec3) -> Frame:
  +n = normalize(normal)
  +u = normalize(x)
  Frame{origin, n, u, cross(n, u)}

def lift(point: Vec3, frame: Frame) -> Vec3:
  V3{a, b, _} = point
  Frame{origin, _, x, y} = frame
  add(origin, add(scale(x, a), scale(y, b)))

def transform_points(points: List<&2, Vec3>, +rotation: Rotation, +offset: Vec3) -> List<&2, Vec3>:
  match points:
    case Nil{}:
      Nil{}
    case p <> tail:
      add(rotate(p, rotation), offset) <> transform_points(tail, rotation, offset)
