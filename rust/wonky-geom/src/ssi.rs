//! Plane x curved carrier SSI, always in the curved construction frame.
//! Supports are untrimmed: a two-ring cone defines the complete algebraic
//! double cone, not a finite band. Ring heights and branch signs must be used
//! by the future trimmer; this API never claims a sewn Boolean result.
use crate::{dot, frame::Frame, zero, Point, Real, Refused, Result, Q};
use num_traits::{One, Signed, Zero};

#[derive(Clone, Debug)]
pub struct Plane {
    pub frame: Frame,
    normal: Point,
    offset: Q,
}
impl Plane {
    /// n . p = offset in `frame`; n is not normalized or rounded.
    pub fn new(frame: Frame, normal: Point, offset: Q) -> Result<Self> {
        if normal.iter().all(Q::is_zero) {
            return Err(Refused("carrier/zero-plane-normal"));
        }
        Ok(Self {
            frame,
            normal,
            offset,
        })
    }
    fn pullback(&self, curved: &Frame) -> (Point, Q, Frame) {
        let map = self.frame.relation_from(curved).map;
        let n = map.columns().each_ref().map(|c| dot(&self.normal, c));
        let d = &self.offset - dot(&self.normal, map.origin());
        (n, d, map)
    }
    pub fn chart_axes(&self) -> [usize; 2] {
        let pivot = self.normal.iter().position(|v| !v.is_zero()).unwrap();
        [(pivot + 1) % 3, (pivot + 2) % 3]
    }
}
#[derive(Clone, Debug)]
pub struct Cylinder {
    pub frame: Frame,
    radius: Q,
}
impl Cylinder {
    /// Axis is local Z. Arbitrary axis placements belong in `frame`.
    pub fn new(frame: Frame, radius: Q) -> Result<Self> {
        if radius <= Q::zero() {
            return Err(Refused("carrier/non-positive-radius"));
        }
        Ok(Self { frame, radius })
    }
}
#[derive(Clone, Debug)]
pub struct ConeRings {
    pub frame: Frame,
    rings: [(Q, Q); 2], // (height, radius)
    slope: Q,
    intercept: Q,
}
impl ConeRings {
    pub fn rings(&self) -> &[(Q, Q); 2] {
        &self.rings
    }
    pub fn new(frame: Frame, rings: [(Q, Q); 2]) -> Result<Self> {
        let [(h0, r0), (h1, r1)] = &rings;
        if h0 == h1 {
            return Err(Refused("carrier/coincident-ring-heights"));
        }
        if r0.is_negative() || r1.is_negative() || (r0.is_zero() && r1.is_zero()) {
            return Err(Refused("carrier/invalid-cone-radii"));
        }
        let slope = (r1 - r0) / (h1 - h0);
        let intercept = r0 - &slope * h0;
        Ok(Self {
            frame,
            rings,
            slope,
            intercept,
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conic {
    Circle,
    Ellipse,
    Parabola,
    Hyperbola,
}
#[derive(Clone, Debug)]
pub struct Line {
    pub origin: [Real; 3],
    pub direction: [Real; 3],
}
impl Line {
    pub fn point(&self, t: &Q) -> Result<[Real; 3]> {
        let mut out = self.origin.clone();
        for (i, value) in out.iter_mut().enumerate() {
            *value = value
                .plus(&self.direction[i].shifted_scaled(&Q::zero(), t))
                .ok_or(Refused("real/root-class-exceeded"))?;
        }
        Ok(out)
    }
}
#[derive(Clone, Debug)]
pub enum Curve {
    Empty,
    Point(Point),
    Lines(Vec<Line>),
    /// (r cos(u), r sin(u), a + b cos(u) + c sin(u)).
    Harmonic {
        kind: Conic,
        radius: Q,
        height: [Q; 3],
    },
    /// z = (d - b*A(u))/(nz + k*A(u)); r = k*z+b.
    /// Stored as numerator/denominator harmonics; no atan/sqrt observation
    /// enters the exact chart. Poles are exact refusals on point evaluation.
    RationalHarmonic {
        kind: Conic,
        numerator: [Q; 3],
        denominator: [Q; 3],
        slope: Q,
        intercept: Q,
    },
}
#[derive(Clone, Debug)]
pub struct Section {
    pub frame: Frame,
    pub curve: Curve,
    to_plane: Frame,
    plane_axes: [usize; 2],
}
fn harmonic(h: &[Q; 3], c: &Q, s: &Q) -> Q {
    &h[0] + &h[1] * c + &h[2] * s
}
impl Section {
    /// Exact half-angle parameter t: cos=(1-t²)/(1+t²), sin=2t/(1+t²).
    /// None is the projective t=infinity seam (-1,0), not a rounded angle.
    pub fn point(&self, t: Option<&Q>) -> Result<Point> {
        let (c, s) = match t {
            None => (-Q::one(), Q::zero()),
            Some(t) => {
                let t2 = t * t;
                (
                    (Q::one() - &t2) / (Q::one() + &t2),
                    (t + t) / (Q::one() + t2),
                )
            }
        };
        let (r, z) = match &self.curve {
            Curve::Harmonic { radius, height, .. } => (radius.clone(), harmonic(height, &c, &s)),
            Curve::RationalHarmonic {
                numerator,
                denominator,
                slope,
                intercept,
                ..
            } => {
                let den = harmonic(denominator, &c, &s);
                if den.is_zero() {
                    return Err(Refused("ssi/cone/parameter-pole"));
                }
                let z = harmonic(numerator, &c, &s) / den;
                (slope * &z + intercept, z)
            }
            Curve::Point(p) => return Ok(p.clone()),
            _ => return Err(Refused("ssi/not-a-periodic-chart")),
        };
        Ok([&r * c, &r * s, z])
    }
    /// Exact line pullback into the plane chart. Roots remain symbolic under
    /// affine combinations, including tangent generators.
    pub fn line_plane_pcurve(&self, index: usize, t: &Q) -> Result<[Real; 2]> {
        let Curve::Lines(lines) = &self.curve else {
            return Err(Refused("ssi/not-a-line-chart"));
        };
        let line = lines.get(index).ok_or(Refused("ssi/line-index"))?;
        let p = line.point(t)?;
        let mut out = [Real::rational(Q::zero()), Real::rational(Q::zero())];
        for (j, axis) in self.plane_axes.iter().copied().enumerate() {
            let mut value = Real::rational(self.to_plane.origin()[axis].clone());
            for (i, coordinate) in p.iter().enumerate() {
                value = value
                    .plus(&coordinate.shifted_scaled(&Q::zero(), &self.to_plane.columns()[i][axis]))
                    .ok_or(Refused("real/root-class-exceeded"))?;
            }
            out[j] = value;
        }
        Ok(out)
    }
    /// Plane chart coordinates, with exact affine pullback; the omitted
    /// coordinate is recovered from the nonzero pivot of the plane equation.
    pub fn plane_pcurve(&self, t: Option<&Q>) -> Result<[Q; 2]> {
        let p = self.to_plane.point(&self.point(t)?);
        Ok(self.plane_axes.map(|i| p[i].clone()))
    }
}
fn section(plane: &Plane, frame: &Frame, map: Frame, curve: Curve) -> Section {
    Section {
        frame: frame.clone(),
        curve,
        to_plane: map,
        plane_axes: plane.chart_axes(),
    }
}
// n.x*x+n.y*y=d on x²+y²=r². The discriminant is rational even
// where its principal square root is not. No approximate root count.
fn circle_line(nx: &Q, ny: &Q, d: &Q, r: &Q) -> Vec<[Real; 2]> {
    let n2 = nx * nx + ny * ny;
    let delta = r * r * &n2 - d * d;
    if delta.is_negative() {
        return vec![];
    }
    let count = if delta.is_zero() { 1 } else { 2 };
    (0..count)
        .map(|i| {
            let sign = if i == 0 { Q::one() } else { -Q::one() };
            [
                Real::new(nx * d / &n2, -ny * &sign / &n2, delta.clone()).unwrap(),
                Real::new(ny * d / &n2, nx * sign / &n2, delta.clone()).unwrap(),
            ]
        })
        .collect()
}
pub fn plane_cylinder(plane: &Plane, cylinder: &Cylinder) -> Result<Section> {
    let (n, d, map) = plane.pullback(&cylinder.frame);
    let r = &cylinder.radius;
    let curve = if n[2].is_zero() {
        let lines = circle_line(&n[0], &n[1], &d, r)
            .into_iter()
            .map(|p| Line {
                origin: [p[0].clone(), p[1].clone(), Real::rational(Q::zero())],
                direction: [Q::zero(), Q::zero(), Q::one()].map(Real::rational),
            })
            .collect::<Vec<_>>();
        if lines.is_empty() {
            Curve::Empty
        } else {
            Curve::Lines(lines)
        }
    } else {
        Curve::Harmonic {
            kind: if n[0].is_zero() && n[1].is_zero() {
                Conic::Circle
            } else {
                Conic::Ellipse
            },
            radius: r.clone(),
            height: [&d / &n[2], -&n[0] * r / &n[2], -&n[1] * r / &n[2]],
        }
    };
    Ok(section(plane, &cylinder.frame, map, curve))
}
pub fn plane_cone(plane: &Plane, cone: &ConeRings) -> Result<Section> {
    if cone.slope.is_zero() {
        return plane_cylinder(
            plane,
            &Cylinder::new(cone.frame.clone(), cone.intercept.clone())?,
        );
    }
    let (n, d, map) = plane.pullback(&cone.frame);
    let k = &cone.slope;
    let b = &cone.intercept;
    let apex = -b / k;
    let radial2 = &n[0] * &n[0] + &n[1] * &n[1];
    let curve = if d == &n[2] * &apex {
        let mut point = zero();
        point[2] = apex;
        let directions = if radial2.is_zero() {
            vec![]
        } else {
            circle_line(&n[0], &n[1], &(-&n[2] / k), &Q::one())
        };
        if directions.is_empty() {
            Curve::Point(point)
        } else {
            Curve::Lines(
                directions
                    .into_iter()
                    .map(|p| Line {
                        origin: point.clone().map(Real::rational),
                        direction: [
                            p[0].shifted_scaled(&Q::zero(), k),
                            p[1].shifted_scaled(&Q::zero(), k),
                            Real::rational(Q::one()),
                        ],
                    })
                    .collect(),
            )
        }
    } else {
        let discriminant = &n[2] * &n[2] - k * k * &radial2;
        let kind = if radial2.is_zero() {
            Conic::Circle
        } else if discriminant.is_positive() {
            Conic::Ellipse
        } else if discriminant.is_zero() {
            Conic::Parabola
        } else {
            Conic::Hyperbola
        };
        Curve::RationalHarmonic {
            kind,
            numerator: [d, -b * &n[0], -b * &n[1]],
            denominator: [n[2].clone(), k * &n[0], k * &n[1]],
            slope: k.clone(),
            intercept: b.clone(),
        }
    };
    Ok(section(plane, &cone.frame, map, curve))
}
