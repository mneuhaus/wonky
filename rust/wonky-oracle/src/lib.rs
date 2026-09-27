//! Test-only oracle: operations are exact on the *literal binary64 inputs*.
//! No rounding, geometric tolerances, or production fallback are used here.
//! A zero denominator, open mesh, or invalid input is a named error.
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Signed, Zero};
use std::collections::BTreeMap;

pub type R = BigRational;
pub type P2 = [R; 2];
pub type P3 = [R; 3];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OracleError {
    NonFinite,
    Degenerate,
    OpenMesh,
    RootNotIsolated,
}

/// Exact binary decomposition, including signed zero and subnormals.
pub fn binary64(x: f64) -> Result<R, OracleError> {
    if !x.is_finite() {
        return Err(OracleError::NonFinite);
    }
    let bits = x.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = bits & ((1u64 << 52) - 1);
    let (coefficient, power) = if exponent == 0 {
        (mantissa, -1074)
    } else {
        (mantissa | (1u64 << 52), exponent - 1023 - 52)
    };
    let mut numerator = BigInt::from(coefficient);
    if bits >> 63 != 0 {
        numerator = -numerator;
    }
    Ok(if power >= 0 {
        R::from_integer(numerator << power as usize)
    } else {
        R::new(numerator, BigInt::one() << (-power) as usize)
    })
}

pub fn point2(p: [f64; 2]) -> Result<P2, OracleError> {
    Ok([binary64(p[0])?, binary64(p[1])?])
}
pub fn point3(p: [f64; 3]) -> Result<P3, OracleError> {
    Ok([binary64(p[0])?, binary64(p[1])?, binary64(p[2])?])
}

pub fn sign(x: &R) -> i8 {
    if x.is_positive() {
        1
    } else if x.is_negative() {
        -1
    } else {
        0
    }
}
fn sub3(a: &P3, b: &P3) -> P3 {
    std::array::from_fn(|i| &a[i] - &b[i])
}
fn dot3(a: &P3, b: &P3) -> R {
    (0..3).map(|i| &a[i] * &b[i]).sum()
}
fn cross(a: &P3, b: &P3) -> P3 {
    [
        &a[1] * &b[2] - &a[2] * &b[1],
        &a[2] * &b[0] - &a[0] * &b[2],
        &a[0] * &b[1] - &a[1] * &b[0],
    ]
}
fn det(a: &P3, b: &P3, c: &P3) -> R {
    dot3(a, &cross(b, c))
}

pub fn orientation2d(a: &P2, b: &P2, c: &P2) -> i8 {
    sign(&((&b[0] - &a[0]) * (&c[1] - &a[1]) - (&b[1] - &a[1]) * (&c[0] - &a[0])))
}
pub fn orientation3d(a: &P3, b: &P3, c: &P3, d: &P3) -> i8 {
    sign(&det(&sub3(b, a), &sub3(c, a), &sub3(d, a)))
}
pub fn plane_side(normal: &P3, point: &P3, origin: &P3) -> i8 {
    sign(&dot3(normal, &sub3(point, origin)))
}
pub fn line_point_side(normal: &P3, direction: &P3, origin: &P3, point: &P3, t: &R) -> i8 {
    sign(&(dot3(normal, &sub3(origin, point)) + t * dot3(normal, direction)))
}
pub fn dot_sign(a: &P3, b: &P3) -> i8 {
    sign(&dot3(a, b))
}
pub fn parallel(a: &P3, b: &P3) -> bool {
    cross(a, b).iter().all(Zero::is_zero)
}

/// Exact line parameter and intersection point. Parallel or coincident => Degenerate.
pub fn plane_line_intersection(
    normal: &P3,
    plane_point: &P3,
    line_origin: &P3,
    direction: &P3,
) -> Result<(R, P3), OracleError> {
    let denominator = dot3(normal, direction);
    if denominator.is_zero() {
        return Err(OracleError::Degenerate);
    }
    let t = dot3(normal, &sub3(plane_point, line_origin)) / denominator;
    let p = std::array::from_fn(|i| &line_origin[i] + &t * &direction[i]);
    Ok((t, p))
}

/// Three planes in point-normal form, solved by exact Cramer's rule.
pub fn three_plane_intersection(planes: [(&P3, &P3); 3]) -> Result<P3, OracleError> {
    let [n0, n1, n2] = planes.map(|(n, _)| n);
    let denominator = det(n0, n1, n2);
    if denominator.is_zero() {
        return Err(OracleError::Degenerate);
    }
    let rhs: P3 = std::array::from_fn(|i| dot3(planes[i].0, planes[i].1));
    Ok(std::array::from_fn(|j| {
        let mut rows = [n0.clone(), n1.clone(), n2.clone()];
        for k in 0..3 {
            rows[k][j] = rhs[k].clone();
        }
        det(&rows[0], &rows[1], &rows[2]) / &denominator
    }))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Containment {
    Outside,
    Boundary,
    Inside,
}

/// Even-odd rule; a point on any edge is Boundary. Empty polygons are invalid.
pub fn point_in_polygon(p: &P2, vertices: &[P2]) -> Result<Containment, OracleError> {
    if vertices.len() < 3 {
        return Err(OracleError::Degenerate);
    }
    let mut inside = false;
    for i in 0..vertices.len() {
        let a = &vertices[i];
        let b = &vertices[(i + 1) % vertices.len()];
        let turn = orientation2d(a, b, p);
        if turn == 0
            && &p[0] >= std::cmp::min(&a[0], &b[0])
            && &p[0] <= std::cmp::max(&a[0], &b[0])
            && &p[1] >= std::cmp::min(&a[1], &b[1])
            && &p[1] <= std::cmp::max(&a[1], &b[1])
        {
            return Ok(Containment::Boundary);
        }
        if (a[1] > p[1]) != (b[1] > p[1]) {
            // Intersection's X lies right of p iff orientation sign matches edge Y direction.
            if turn == if b[1] > a[1] { 1 } else { -1 } {
                inside = !inside;
            }
        }
    }
    Ok(if inside {
        Containment::Inside
    } else {
        Containment::Outside
    })
}

/// Signed area, with CCW positive.
pub fn polygon_area(vertices: &[P2]) -> Result<R, OracleError> {
    if vertices.len() < 3 {
        return Err(OracleError::Degenerate);
    }
    let twice: R = (0..vertices.len())
        .map(|i| {
            let a = &vertices[i];
            let b = &vertices[(i + 1) % vertices.len()];
            &a[0] * &b[1] - &a[1] * &b[0]
        })
        .sum();
    Ok(twice / BigInt::from(2))
}

/// Oriented volume from a watertight, consistently outward triangular surface.
/// Every undirected edge must have exactly one edge in each direction.
pub fn polyhedron_volume(faces: &[[P3; 3]]) -> Result<R, OracleError> {
    if faces.len() < 4 {
        return Err(OracleError::OpenMesh);
    }
    let mut edges: BTreeMap<(P3, P3), (u32, u32)> = BTreeMap::new();
    let mut sixth = R::zero();
    for face in faces {
        if cross(&sub3(&face[1], &face[0]), &sub3(&face[2], &face[0]))
            .iter()
            .all(Zero::is_zero)
        {
            return Err(OracleError::Degenerate);
        }
        for i in 0..3 {
            let a = &face[i];
            let b = &face[(i + 1) % 3];
            if a == b {
                return Err(OracleError::Degenerate);
            }
            let (key, forward) = if a < b {
                ((a.clone(), b.clone()), true)
            } else {
                ((b.clone(), a.clone()), false)
            };
            let count = edges.entry(key).or_default();
            if forward {
                count.0 += 1;
            } else {
                count.1 += 1;
            }
        }
        sixth += det(&face[0], &face[1], &face[2]);
    }
    if edges.values().any(|counts| *counts != (1, 1)) {
        return Err(OracleError::OpenMesh);
    }
    #[cfg(feature = "plant_volume")]
    let denominator = 3;
    #[cfg(not(feature = "plant_volume"))]
    let denominator = 6;
    Ok(sixth / BigInt::from(denominator))
}

pub fn distance_squared(a: &P3, b: &P3) -> R {
    (0..3)
        .map(|i| {
            let delta = &a[i] - &b[i];
            &delta * &delta
        })
        .sum()
}
pub fn compare_distance_squared(a: &P3, b: &P3, c: &P3, d: &P3) -> i8 {
    sign(&(distance_squared(a, b) - distance_squared(c, d)))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QuadraticRoots {
    None,
    One(R),
    /// Two disjoint rational intervals, each containing exactly one real root.
    Two([(R, R); 2]),
}

/// Exact discriminant; dyadic rational root brackets (not floating approximations).
/// Refuses a=0; non-square discriminants are isolated with up to 8192 bits.
pub fn isolate_quadratic(a: &R, b: &R, c: &R) -> Result<QuadraticRoots, OracleError> {
    if a.is_zero() {
        return Err(OracleError::Degenerate);
    }
    let four = R::from_integer(4.into());
    let disc = b * b - four * a * c;
    if disc.is_negative() {
        return Ok(QuadraticRoots::None);
    }
    let center = -b / (a * BigInt::from(2));
    if disc.is_zero() {
        return Ok(QuadraticRoots::One(center));
    }
    let scale = a.abs() * BigInt::from(2);
    for bits in [64usize, 128, 256, 512, 1024, 2048, 4096, 8192] {
        let unit = BigInt::one() << bits;
        let numerator = (disc.numer() << (2 * bits)) / disc.denom();
        let floor = numerator.sqrt();
        let lower = R::new(floor.clone(), unit.clone());
        let upper = if &lower * &lower == disc {
            lower.clone()
        } else {
            R::new(floor + 1, unit)
        };
        let left = (
            center.clone() - &upper / &scale,
            center.clone() - &lower / &scale,
        );
        let right = (
            center.clone() + &lower / &scale,
            center.clone() + &upper / &scale,
        );
        if left.1 < right.0 {
            return Ok(QuadraticRoots::Two([left, right]));
        }
    }
    Err(OracleError::RootNotIsolated)
}

/// Deterministic adversarial inputs for property tests; no RNG dependency.
pub mod adversarial {
    #[derive(Clone, Debug)]
    pub struct Generator(u64);
    impl Generator {
        pub fn new(seed: u64) -> Self {
            Self(seed)
        }
        pub fn next_u64(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        /// All finite binary64 exponents, including subnormals and both signs.
        pub fn full_range(&mut self) -> f64 {
            let bits = self.next_u64();
            f64::from_bits(
                (bits & (1u64 << 63)) | (((bits >> 52) % 2047) << 52) | (bits & ((1u64 << 52) - 1)),
            )
        }
        /// Powers of two from 2^-1074 (smallest subnormal) to 2^1023.
        pub fn full_power(&mut self) -> f64 {
            let exponent = (self.next_u64() % 2098) as i32 - 1074;
            let bits = if exponent < -1022 {
                1u64 << (exponent + 1074)
            } else {
                ((exponent + 1023) as u64) << 52
            };
            f64::from_bits(bits | ((self.next_u64() & 1) << 63))
        }
        /// Normal powers-of-two in wonky-num's admitted range (~2^-498..2^498).
        pub fn kernel_power(&mut self) -> f64 {
            let exp = self.next_u64() % 997;
            let sign = (self.next_u64() & 1) << 63;
            f64::from_bits(sign | ((exp + 525) << 52))
        }
        /// Collinear by construction; 1-ulp mutation yields a near-degeneracy.
        pub fn near_collinear(&mut self) -> ([[f64; 2]; 3], [[f64; 2]; 3]) {
            let x = ((self.next_u64() % 1024) as f64) + 1.0;
            let exact = [[0.0, 0.0], [x, x], [2.0 * x, 2.0 * x]];
            let mut perturbed = exact;
            perturbed[2][1] = f64::from_bits(perturbed[2][1].to_bits() + 1);
            (exact, perturbed)
        }
    }
}

/// Intersect two nonparallel planes in point-normal form. Returns a point on
/// their line and a nonzero exact direction; coincident/parallel is refused.
pub fn plane_plane_intersection(
    n0: &P3,
    p0: &P3,
    n1: &P3,
    p1: &P3,
) -> Result<(P3, P3), OracleError> {
    let direction = cross(n0, n1);
    let axis = direction
        .iter()
        .position(|component| !component.is_zero())
        .ok_or(OracleError::Degenerate)?;
    let mut axis_normal: P3 = std::array::from_fn(|_| R::zero());
    axis_normal[axis] = R::one();
    let origin: P3 = std::array::from_fn(|_| R::zero());
    let point = three_plane_intersection([(n0, p0), (n1, p1), (&axis_normal, &origin)])?;
    Ok((point, direction))
}
