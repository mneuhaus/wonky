//! Symbolic rotated carriers and circle vertices. No cache is an identity.
use crate::model::{Carrier3, Circle3};
use crate::{cross, dot, sub, Point, Refused, Result, Turn, Q};
use num_traits::Zero;
use std::cmp::Ordering;
use wonky_alg::Sign;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Line3 {
    pub p: Point,
    pub d: Point,
}
/// A linear expression c + a cos(turn) + b sin(turn).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Coordinate {
    pub a: Q,
    pub b: Q,
    pub c: Q,
}
impl Coordinate {
    pub fn cmp(&self, other: &Self, turn: &Turn) -> Result<Ordering> {
        Ok(
            match turn.sign(
                &(&self.a - &other.a),
                &(&self.b - &other.b),
                &(&self.c - &other.c),
            )? {
                Sign::Negative => Ordering::Less,
                Sign::Zero => Ordering::Equal,
                Sign::Positive => Ordering::Greater,
            },
        )
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OnCurve {
    pub circle: Circle3,
    pub t: Turn,
}
impl OnCurve {
    /// A radical-centre circle has no rational coordinate and refuses by name.
    pub fn coordinates(&self) -> Result<[Coordinate; 3]> {
        let frame = self.circle.frame()?;
        let o = frame.origin();
        let axes = frame.columns();
        let r = wonky_curve::numeric::exact_root(&self.circle.radius2())
            .expect("circle rational radius invariant");
        Ok(std::array::from_fn(|i| Coordinate {
            a: &r * &axes[0][i],
            b: &r * &axes[1][i],
            c: o[i].clone(),
        }))
    }
    pub fn rational(&self) -> Result<Point> {
        let (sin, cos) = self.t.rational_sin_cos()?;
        Ok(self.coordinates()?.map(|v| v.c + v.a * &cos + v.b * &sin))
    }
    /// Round only for observation, refining exact enclosures until nearest-even is decided.
    pub fn rounded(&self) -> Result<[f64; 3]> {
        let coordinates = self.coordinates()?;
        let mut result = [0.; 3];
        for (i, v) in coordinates.iter().enumerate() {
            let mut decided = false;
            for bits in [64, 128, 256, 512] {
                let (lo, hi) = self.t.enclosure(&v.a, &v.b, &v.c, bits)?;
                let a = crate::model::nearest(&lo)?;
                let b = crate::model::nearest(&hi)?;
                if a.to_bits() == b.to_bits() {
                    result[i] = a;
                    decided = true;
                    break;
                }
                let candidate = crate::model::nearest(&((&lo + &hi) / Q::from_integer(2.into())))?;
                if self
                    .t
                    .sign(&v.a, &v.b, &(&v.c - crate::binary64(candidate)?))?
                    == Sign::Zero
                {
                    result[i] = candidate;
                    decided = true;
                    break;
                }
                // A tie requires adjacent words; broad intervals must refine.
                if a.next_up().to_bits() == b.to_bits() {
                    let midpoint =
                        (crate::binary64(a)? + crate::binary64(b)?) / Q::from_integer(2.into());
                    if self.t.sign(&v.a, &v.b, &(&v.c - midpoint))? == Sign::Zero {
                        result[i] = if a.to_bits() & 1 == 0 { a } else { b };
                        decided = true;
                        break;
                    }
                }
            }
            if !decided {
                return Err(Refused("turn/rounding-budget"));
            }
        }
        Ok(result)
    }
    /// Lexicographic exact coordinates, never a rounded observation cache.
    pub fn cmp(&self, other: &Self) -> Result<Ordering> {
        #[cfg(feature = "plant_oncurve_cache_order")]
        {
            let a = self.rounded()?;
            let b = other.rounded()?;
            for i in 0..3 {
                let order = a[i].total_cmp(&b[i]);
                if order != Ordering::Equal {
                    return Ok(order);
                }
            }
            return Ok(Ordering::Equal);
        }
        #[cfg(not(feature = "plant_oncurve_cache_order"))]
        {
            let a = self.coordinates()?;
            let b = other.coordinates()?;
            for i in 0..3 {
                let sign = self.t.coordinate_difference_sign(
                    &[a[i].a.clone(), a[i].b.clone(), a[i].c.clone()],
                    &other.t,
                    &[b[i].a.clone(), b[i].b.clone(), b[i].c.clone()],
                )?;
                let order = match sign {
                    Sign::Negative => Ordering::Less,
                    Sign::Zero => Ordering::Equal,
                    Sign::Positive => Ordering::Greater,
                };
                if order != Ordering::Equal {
                    return Ok(order);
                }
            }
            Ok(Ordering::Equal)
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rotated {
    pub base: Box<Carrier3>,
    pub axis: Line3,
    pub turn: Turn,
}
impl Rotated {
    pub fn point(&self, p: &Point) -> Result<[Coordinate; 3]> {
        let length = wonky_curve::numeric::exact_root(&dot(&self.axis.d, &self.axis.d))
            .ok_or(Refused("turn/axis-field-tower"))?;
        if length.is_zero() {
            return Err(Refused("turn/zero-axis"));
        }
        let u = self.axis.d.clone().map(|x| x / &length);
        let v = sub(p, &self.axis.p);
        let along = dot(&v, &u);
        let tangent = cross(&u, &v);
        Ok(std::array::from_fn(|i| Coordinate {
            a: &v[i] - &along * &u[i],
            b: tangent[i].clone(),
            c: &self.axis.p[i] + &along * &u[i],
        }))
    }
    /// Exact implicit predicate by inverse rotation; all analytic quadrics share it.
    pub fn contains_point(&self, p: &Point) -> Result<bool> {
        let mut coordinates = self.point(p)?;
        for v in &mut coordinates {
            v.b = -v.b.clone()
        }
        let implicit = self.base.implicit()?.coefficients();
        let mut coefficients: [Q; 6] = std::array::from_fn(|_| Q::zero());
        coefficients[0] = implicit[0].clone();
        for i in 0..3 {
            coefficients[0] += &implicit[i + 1] * &coordinates[i].c;
            coefficients[1] += &implicit[i + 1] * &coordinates[i].a;
            coefficients[2] += &implicit[i + 1] * &coordinates[i].b
        }
        for (slot, (i, j)) in [(0, 0), (0, 1), (0, 2), (1, 1), (1, 2), (2, 2)]
            .iter()
            .enumerate()
        {
            let (x, y) = (&coordinates[*i], &coordinates[*j]);
            let c = &implicit[4 + slot];
            let product = [
                &x.c * &y.c,
                &x.c * &y.a + &x.a * &y.c,
                &x.c * &y.b + &x.b * &y.c,
                &x.a * &y.a,
                &x.a * &y.b + &x.b * &y.a,
                &x.b * &y.b,
            ];
            for k in 0..6 {
                coefficients[k] += c * &product[k]
            }
        }
        Ok(self.turn.quadratic_sign(&coefficients)? == Sign::Zero)
    }
    /// Rational rotations eagerly rewrite the carrier frame (planes and all quadrics).
    /// Other construction classes retain this symbolic carrier.
    pub fn rational_carrier(&self) -> Result<Carrier3> {
        let (sin, cos) = self.turn.rational_sin_cos()?;
        let point = |p: &Point| -> Result<Point> {
            Ok(self.point(p)?.map(|v| v.c + v.a * &cos + v.b * &sin))
        };
        let origin = point(&crate::zero())?;
        let vector = |v: &Point| -> Result<Point> { Ok(sub(&point(v)?, &origin)) };
        let frame = |f: &crate::frame::Frame| -> Result<crate::frame::Frame> {
            crate::frame::Frame::new(
                point(f.origin())?,
                [
                    vector(&f.columns()[0])?,
                    vector(&f.columns()[1])?,
                    vector(&f.columns()[2])?,
                ],
            )
        };
        Ok(match self.base.as_ref() {
            Carrier3::Plane(p) => Carrier3::Plane(crate::model::Plane3 {
                o: point(&p.o)?,
                x: vector(&p.x)?,
                n: vector(&p.n)?,
            }),
            Carrier3::Cylinder(c) => {
                Carrier3::Cylinder(crate::model::Cylinder3::new(frame(c.frame()?)?, c.radius2())?)
            }
            Carrier3::Cone(c) => Carrier3::Cone(crate::model::Cone3::quadratic(
                frame(&c.frame)?,
                c.radical_rings().clone(),
            )?),
            Carrier3::Sphere(s) => {
                Carrier3::Sphere(crate::model::Sphere3::new(frame(&s.frame)?, s.radius2())?)
            }
            Carrier3::TranslatedCylinder(_) => {
                return Err(Refused("model/rotated/translated-cylinder-base"))
            }
            Carrier3::Torus(t) => {
                let mut t = t.clone();
                t.frame = frame(&t.frame)?;
                Carrier3::Torus(t)
            }
            Carrier3::Rotated(r) => {
                return r.rational_carrier().and_then(|base| {
                    Rotated {
                        base: Box::new(base),
                        axis: self.axis.clone(),
                        turn: self.turn.clone(),
                    }
                    .rational_carrier()
                })
            }
            Carrier3::RadicalPlane(p) => {
                let columns: [Point; 3] = std::array::from_fn(|i| {
                    let mut e = crate::zero();
                    e[i] = Q::from_integer(1.into());
                    vector(&e).expect("validated rational axis")
                });
                let mapped = |v: &crate::model::RPoint, translate: bool| -> crate::model::RPoint {
                    std::array::from_fn(|i| {
                        let mut result = wonky_curve::radical::Radical::from(if translate {
                            origin[i].clone()
                        } else {
                            Q::zero()
                        });
                        for j in 0..3 {
                            result = result + &v[j] * &columns[j][i]
                        }
                        result
                    })
                };
                Carrier3::RadicalPlane(crate::model::RadicalPlane3 {
                    o: mapped(&p.o, true),
                    x: mapped(&p.x, false),
                    n: mapped(&p.n, false),
                })
            }
        })
    }
}
