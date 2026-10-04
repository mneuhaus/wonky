//! Exact normal sections of parallel extrusion generators (F3a).
//! Source offset and setback routines are shared with profile_blend. A rolling
//! circle can have a quadratic centre; no cache is used for incidence or order.
//! The rational Trimmed adapter remains explicitly narrower than this geometry.
use crate::{Refusal, Result};
use num_traits::{Signed, Zero};
use wc::numeric::{cross, dot, exact_root, q, sub, P, Q};
use wc::radical::{self, Radical};
use wonky_curve as wc;
use wonky_geom::model::{QuadraticPoint3, VertexDef};
type R<T> = Result<T>;
fn no(s: &str) -> Refusal {
    Refusal(format!("profile-blend/{s}"))
}
fn translated(p: &wc::ExactPoint, d: &P, t: &Q) -> R<wc::ExactPoint> {
    wc::ExactPoint::from_coordinates(std::array::from_fn(|k| {
        p.coordinates()[k].clone() + &d[k] * t
    }))
    .map_err(Into::into)
}

#[derive(Clone, Debug)]
pub enum Carrier {
    Cylinder {
        center: wc::ExactPoint,
        radius2: Q,
        convex: bool,
    },
    Plane,
}
/// Evaluated analytic normal section: springs on the two source supports and
/// the circle/chord connecting them. Extrusion gives a cylinder/plane stripe.
#[derive(Clone, Debug)]
pub struct Joint {
    pub springs: [wc::ExactPoint; 2],
    pub carrier: Carrier,
    pub convex: bool,
}
/// Actual analytic stripe face, bounded by two springs and cap sections.
#[derive(Clone, Debug)]
pub enum StripeFace {
    Cylinder(crate::fillet::Face),
    Plane(crate::chamfer::Face),
}
impl Joint {
    /// Compatibility boundary for consumers whose circle centres remain in Q.
    pub fn trimmed(&self) -> R<wc::Trimmed> {
        let [a, b] = self.springs.clone();
        Ok(match &self.carrier {
            Carrier::Plane => wc::Trimmed::new([a, b], wc::Carrier::Line)?,
            Carrier::Cylinder {
                center,
                radius2,
                convex,
            } => wc::Trimmed::ring(center.rat()?.clone(), radius2.clone(), a.clone(), *convex)?
                .trim(a, b)?,
        })
    }
    pub fn spine_vertex(&self, level: Q) -> R<VertexDef> {
        let Carrier::Cylinder { center, .. } = &self.carrier else {
            return Err(no("chamfer-has-no-rolling-spine"));
        };
        let [x, y] = center.coordinates();
        Ok(VertexDef::Quadratic(QuadraticPoint3::from_coordinates([
            x,
            y,
            Radical::from(level),
        ])?))
    }
    /// Extrude this section in its source frame. Carrier coefficients and
    /// cap arcs retain the same exact quadratic field as the spine.
    pub fn extrude(
        &self,
        levels: [Q; 2],
        provenance: wonky_geom::model::Provenance,
    ) -> R<StripeFace> {
        if levels[0] >= levels[1] {
            return Err(no("invalid-levels"));
        }
        let point = |p: &wc::ExactPoint, z: &Q| {
            let [x, y] = p.coordinates();
            [x, y, Radical::from(z.clone())]
        };
        let [a, b] = self.springs.each_ref();
        let vertices = [
            point(a, &levels[0]),
            point(b, &levels[0]),
            point(b, &levels[1]),
            point(a, &levels[1]),
        ];
        Ok(match &self.carrier {
            Carrier::Cylinder {
                center,
                radius2,
                convex,
            } => {
                let axis = [q(0.), q(0.), q(1.)];
                let arcs = [
                    Some(crate::fillet::Arc {
                        center: point(center, &levels[0]),
                        axis: axis.clone(),
                        radius2: radius2.clone(),
                    }),
                    None,
                    Some(crate::fillet::Arc {
                        center: point(center, &levels[1]),
                        axis: axis.clone().map(|x| -x),
                        radius2: radius2.clone(),
                    }),
                    None,
                ];
                StripeFace::Cylinder(crate::fillet::Face {
                    carrier: crate::fillet::Carrier::Cylinder {
                        origin: point(center, &levels[0]),
                        axis,
                        radius2: radius2.clone(),
                        convexity: if *convex {
                            crate::Convexity::Convex
                        } else {
                            crate::Convexity::Concave
                        },
                    },
                    loops: vec![(0..4)
                        .map(|i| crate::fillet::Piece {
                            start: vertices[i].clone(),
                            end: vertices[(i + 1) % 4].clone(),
                            arc: arcs[i].clone(),
                        })
                        .collect()],
                    source: None,
                })
            }
            Carrier::Plane => {
                let d = b.difference(a);
                let normal = [d[1].clone(), -d[0].clone(), Radical::default()];
                let offset = &normal[0] * &vertices[0][0] + &normal[1] * &vertices[0][1];
                StripeFace::Plane(crate::chamfer::Face {
                    plane: crate::chamfer::Plane { normal, offset },
                    loops: vec![vertices.to_vec()],
                    provenance,
                })
            }
        })
    }
    /// V3: exact incidence on the original supports and on the rolling circle.
    pub fn validate(&self, prev: &wc::Trimmed, next: &wc::Trimmed) -> R<()> {
        for (s, p) in [prev, next].into_iter().zip(&self.springs) {
            if !s.contains(p)? || s.ends().contains(p) {
                return Err(no("contract-violation:V3/contact-incidence"));
            }
        }
        if let Carrier::Cylinder {
            center,
            radius2,
            convex,
        } = &self.carrier
        {
            let a = self.springs[0].difference(center);
            let b = self.springs[1].difference(center);
            if radical::dot(&a, &a) != Radical::from(radius2.clone())
                || radical::dot(&b, &b) != Radical::from(radius2.clone())
                || Radical::from(q(if *convex { 1. } else { -1. })) * radical::cross(&a, &b)
                    <= Radical::default()
            {
                return Err(no("contract-violation:V3/rolling-circle-incidence"));
            }
        }
        Ok(())
    }
}
pub fn unit(a: &wc::Trimmed) -> R<(P, Q)> {
    if !matches!(a.chart(), wc::Chart::Line) {
        return Err(no("line-line-joint-required"));
    }
    let d = sub(a.ends()[1].rat()?, a.ends()[0].rat()?);
    let l = exact_root(&dot(&d, &d))
        .filter(|l| !l.is_zero())
        .ok_or_else(|| no("tangent-length-not-rational"))?;
    #[cfg(feature = "plant_profile_tangent_rounding")]
    let l = {
        use num_traits::ToPrimitive;
        q(l.to_f64().unwrap())
    };
    Ok(([&d[0] / &l, &d[1] / &l], l))
}
fn moved(p: &P, d: &P, t: &Q) -> wc::ExactPoint {
    wc::ExactPoint::from_rational(std::array::from_fn(|k| &p[k] + &d[k] * t))
}
pub fn tangent(seg: &wc::Trimmed, end: usize) -> R<P> {
    match seg.chart() {
        wc::Chart::Line => Ok(sub(seg.ends()[1].rat()?, seg.ends()[0].rat()?)),
        wc::Chart::Circle(circle) => {
            let radial = sub(seg.ends()[end].rat()?, circle.c.rat()?);
            let sense = q(if circle.ccw { 1. } else { -1. });
            Ok([-&sense * &radial[1], sense * &radial[0]])
        }
        wc::Chart::BSpline(_) => Err(no("spline-joint-offset-unsupported")),
    }
}
pub fn center_locus(seg: &wc::Trimmed, offset: &Q) -> R<wc::Trimmed> {
    match seg.chart() {
        wc::Chart::Line => {
            let (direction, _) = unit(seg)?;
            let normal = [-&direction[1], direction[0].clone()];
            Ok(wc::Trimmed::new(
                [
                    moved(seg.ends()[0].rat()?, &normal, offset),
                    moved(seg.ends()[1].rat()?, &normal, offset),
                ],
                wc::Carrier::Line,
            )?)
        }
        wc::Chart::Circle(circle) => {
            let radius = exact_root(&circle.r2).ok_or_else(|| no("offset-radius-not-rational"))?;
            let changed = &radius - q(if circle.ccw { 1. } else { -1. }) * offset;
            if changed <= Q::zero() {
                return Err(no("offset-curvature-consumed"));
            }
            let scale = &changed / &radius;
            let (centre, anchor) = (circle.c.rat()?, circle.mid.rat()?);
            let mut carrier = circle.clone();
            carrier.r2 = (&changed * &changed).into();
            carrier.mid = moved(centre, &sub(anchor, centre), &scale);
            let ends = [
                moved(centre, &sub(seg.ends()[0].rat()?, centre), &scale),
                moved(centre, &sub(seg.ends()[1].rat()?, centre), &scale),
            ];
            Ok(wc::Trimmed::new(ends, wc::Carrier::Circle(carrier))?)
        }
        wc::Chart::BSpline(_) => Err(no("spline-joint-offset-unsupported")),
    }
}
fn contact_point(seg: &wc::Trimmed, center: &wc::ExactPoint, offset: &Q) -> R<wc::ExactPoint> {
    match seg.chart() {
        wc::Chart::Line => {
            let (direction, _) = unit(seg)?;
            translated(center, &[-&direction[1], direction[0].clone()], &(-offset))
        }
        wc::Chart::Circle(circle) => {
            let radius = exact_root(&circle.r2).ok_or_else(|| no("offset-radius-not-rational"))?;
            let changed = &radius - q(if circle.ccw { 1. } else { -1. }) * offset;
            let (centre, radial) = (circle.c.coordinates(), center.difference(&circle.c));
            wc::ExactPoint::from_coordinates(std::array::from_fn(|k| {
                centre[k].clone() + radial[k].clone() * (&radius / &changed)
            }))
            .map_err(Into::into)
        }
        wc::Chart::BSpline(_) => Err(no("spline-joint-offset-unsupported")),
    }
}
fn setback(seg: &wc::Trimmed, end: usize, width: &Q) -> R<wc::ExactPoint> {
    let corner = seg.ends()[end].rat()?;
    let probe = wc::Trimmed::ring(
        corner.clone(),
        width * width,
        moved(corner, &[q(1.), q(0.)], width),
        true,
    )?;
    let contacts = seg.sorted_cuts(seg.contacts(&probe)?)?;
    let point = if end == 0 {
        contacts.first()
    } else {
        contacts.last()
    }
    .ok_or_else(|| no("adjacent-face-consumed"))?;
    if seg.ends().contains(point) {
        return Err(no("adjacent-face-consumed"));
    }
    Ok(point.clone())
}
fn curved_joint(prev: &wc::Trimmed, next: &wc::Trimmed, radius: &Q) -> R<Joint> {
    let turn = cross(&tangent(prev, 1)?, &tangent(next, 0)?);
    if turn.is_zero() {
        return Err(no("non-convex-or-tangent-joint"));
    }
    let convex = turn > Q::zero();
    let offset = q(if convex { 1. } else { -1. }) * radius;
    let centers = center_locus(prev, &offset)?.contacts(&center_locus(next, &offset)?)?;
    let mut result = None;
    for center in centers {
        let start = contact_point(prev, &center, &offset)?;
        let end = contact_point(next, &center, &offset)?;
        if !prev.contains(&start)?
            || !next.contains(&end)?
            || prev.ends().contains(&start)
            || next.ends().contains(&end)
        {
            continue;
        }
        let a = start.difference(&center);
        let b = end.difference(&center);
        if Radical::from(q(if convex { 1. } else { -1. })) * radical::cross(&a, &b)
            <= Radical::default()
        {
            continue;
        }
        let joint = Joint {
            springs: [start, end],
            carrier: Carrier::Cylinder {
                center,
                radius2: radius * radius,
                convex,
            },
            convex,
        };
        joint.validate(prev, next)?;
        if result.is_some() {
            return Err(no("ambiguous-offset-contact"));
        }
        result = Some(joint);
    }
    result.ok_or_else(|| no("adjacent-face-consumed"))
}

/// Fillets use support offsets; chamfers use exact distances from the corner.
/// The oriented profile has material on its left. No family tag is an input.
pub fn construct(prev: &wc::Trimmed, next: &wc::Trimmed, width: &Q, fillet: bool) -> R<Joint> {
    radical::guard(|| construct_exact(prev, next, width, fillet)).map_err(Refusal::from)?
}
fn construct_exact(prev: &wc::Trimmed, next: &wc::Trimmed, width: &Q, fillet: bool) -> R<Joint> {
    if width <= &Q::zero() {
        return Err(no("invalid-size"));
    }
    if prev.ends()[1] != next.ends()[0] {
        return Err(no("disconnected-joint"));
    }
    let joint =
        if !matches!(prev.chart(), wc::Chart::Line) || !matches!(next.chart(), wc::Chart::Line) {
            if fillet {
                return curved_joint(prev, next, width);
            }
            let turn = cross(&tangent(prev, 1)?, &tangent(next, 0)?);
            if turn.is_zero() {
                return Err(no("non-convex-or-tangent-joint"));
            }
            Joint {
                springs: [setback(prev, 1, width)?, setback(next, 0, width)?],
                carrier: Carrier::Plane,
                convex: turn > Q::zero(),
            }
        } else {
            let (u, lp) = unit(prev)?;
            let (v, ln) = unit(next)?;
            let turn = cross(&u, &v);
            if turn.is_zero() {
                return Err(no("non-convex-or-tangent-joint"));
            }
            let convex = turn > Q::zero();
            let t = if fillet {
                width * turn.abs() / (q(1.) + dot(&u, &v))
            } else {
                width.clone()
            };
            if t >= lp || t >= ln {
                return Err(no("adjacent-face-consumed"));
            }
            let p = next.ends()[0].rat()?;
            let a = moved(p, &u, &(-&t));
            let b = moved(p, &v, &t);
            let carrier = if fillet {
                let center = translated(
                    &a,
                    &[-&u[1], u[0].clone()],
                    &(q(if convex { 1. } else { -1. }) * width),
                )?;
                Carrier::Cylinder {
                    center,
                    radius2: width * width,
                    convex,
                }
            } else {
                Carrier::Plane
            };
            Joint {
                springs: [a, b],
                carrier,
                convex,
            }
        };
    joint.validate(prev, next)?;
    Ok(joint)
}
