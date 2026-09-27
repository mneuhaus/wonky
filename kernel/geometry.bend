import Base

# All geometric coordinates crossing this module's boundary are millimetres.
type Vec3 is Data:
  V3{x: F32, y: F32, z: F32}

type Frame is Data:
  Frame{origin: Vec3, normal: Vec3, x: Vec3, y: Vec3}

def add(a: Vec3, b: Vec3) -> Vec3:
  V3{ax, ay, az} = a
  V3{bx, by, bz} = b
  V3{(ax + bx : F32), (ay + by : F32), (az + bz : F32)}

def sub(a: Vec3, b: Vec3) -> Vec3:
  V3{ax, ay, az} = a
  V3{bx, by, bz} = b
  V3{(ax - bx : F32), (ay - by : F32), (az - bz : F32)}

def scale(a: Vec3, +s: F32) -> Vec3:
  V3{ax, ay, az} = a
  V3{(ax * s : F32), (ay * s : F32), (az * s : F32)}

def dot(a: Vec3, b: Vec3) -> F32:
  V3{ax, ay, az} = a
  V3{bx, by, bz} = b
  (ax * bx + ay * by + az * bz : F32)

def cross(a: Vec3, b: Vec3) -> Vec3:
  V3{+ax, +ay, +az} = a
  V3{+bx, +by, +bz} = b
  V3{(ay * bz - az * by : F32), (az * bx - ax * bz : F32), (ax * by - ay * bx : F32)}

# Caller must reject zero-length vectors before normalization.
def normalize(+a: Vec3) -> Vec3:
  scale(a, (1.0 / F32.sqrt(dot(a, a)) : F32))

def distance(a: Vec3, b: Vec3) -> F32:
  +d = sub(a, b)
  F32.sqrt(dot(d, d))

def frame(origin: Vec3, normal: Vec3, x: Vec3) -> Frame:
  +n = normalize(normal)
  +u = normalize(x)
  Frame{origin, n, u, cross(n, u)}

def lift(point: Vec3, frame: Frame) -> Vec3:
  V3{a, b, _} = point
  Frame{origin, _, x, y} = frame
  add(origin, add(scale(x, a), scale(y, b)))

def lift_points(points: List<&2, Vec3>, +frame: Frame) -> List<&2, Vec3>:
  match points:
    case Nil{}:
      Nil{}
    case p <> tail:
      lift(p, frame) <> lift_points(tail, frame)

def translate(points: List<&2, Vec3>, +delta: Vec3) -> List<&2, Vec3>:
  match points:
    case Nil{}:
      Nil{}
    case p <> tail:
      add(p, delta) <> translate(tail, delta)

def first_or(points: List<&2, Vec3>, fallback: Vec3) -> Vec3:
  match points:
    case Nil{}:
      fallback
    case p <> tail:
      p

def area_vector(points: List<&2, Vec3>, +first: Vec3) -> Vec3:
  match points:
    case Nil{}:
      V3{0.0, 0.0, 0.0}
    case p <> +tail:
      add(cross(p, first_or(tail, first)), area_vector(tail, first))

type Rotation is Data:
  Rotation{x: Vec3, y: Vec3, z: Vec3}

def rotate(point: Vec3, rotation: Rotation) -> Vec3:
  V3{a, b, c} = point
  Rotation{x, y, z} = rotation
  add(add(scale(x, a), scale(y, b)), scale(z, c))

def transform_points(points: List<&2, Vec3>, +rotation: Rotation, +offset: Vec3) -> List<&2, Vec3>:
  match points:
    case Nil{}:
      Nil{}
    case p <> tail:
      add(rotate(p, rotation), offset) <> transform_points(tail, rotation, offset)
