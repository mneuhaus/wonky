//! C1 parallel-body and exact mitred-polygon integrals/support functions. No mesh or
//! libm angle is used for an exact topology/sign decision.
use crate::{
    arc_profile::{dot, enclose, finite, q, ArcPrism, Profile, R},
    fillet_rim::{no, Rim},
    polyhedron::{Audited, Probe},
    source_frame::{inverse, SourceMetric},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};
fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn sum(xs: &[Iv]) -> Iv {
    xs.iter().copied().fold(i(0.), |a, b| a + b)
}
fn inner(s: &ArcPrism, r: &Rim) -> ArcPrism {
    ArcPrism {
        regularization: s.regularization.clone(),
        profile: r.inner.clone(),
        levels: s.levels,
        rim: None,
    }
}
impl Rim {
    /// Exact polygon section at homotopy parameter t. Shoelace area is
    /// quadratic, first moments cubic; no quadrature error or mesh is involved.
    fn miter_section(&self, s: &ArcPrism, t: &Q) -> R<(Q, [Q; 2])> {
        let points: Vec<wc::P> = s.profile.segments().iter()
            .zip(self.inner.segments()).map(|(a, b)| {
                let a = a.ends()[0].rat()?;
                let b = b.ends()[0].rat()?;
                Ok(std::array::from_fn(|k| &a[k] + t * (&b[k] - &a[k])))
            }).collect::<R<_>>()?;
        let mut area = q(0.);
        let mut moment = [q(0.), q(0.)];
        for (j, (a, b)) in points.iter().zip(points.iter().cycle().skip(1)).take(points.len()).enumerate() {
            let mut cross = wc::numeric::cross(a, b);
            if cfg!(feature = "plant_rim_miter_linear_area") {
                let delta = |k: usize| -> R<wc::P> { Ok(wc::numeric::sub(
                    self.inner.segments()[k].ends()[0].rat()?,
                    s.profile.segments()[k].ends()[0].rat()?,
                )) };
                cross -= t * t * wc::numeric::cross(&delta(j)?, &delta((j + 1) % points.len())?);
            }
            area += &cross / q(2.);
            for k in 0..2 { moment[k] += (&a[k] + &b[k]) * &cross / q(6.); }
        }
        Ok((area, moment))
    }
    fn miter_integrals(&self, s: &ArcPrism) -> R<(Q, [Q; 3])> {
        let (a0, m0) = self.miter_section(s, &q(0.))?;
        let mut area = q(0.);
        let mut ta = q(0.);
        let mut moment = [q(0.), q(0.)];
        // Simpson 3/8 is an algebraic identity for polynomials of degree <=3.
        // Vertex coordinates are linear in t, so all these integrands qualify.
        for j in 0..4 {
            let t = q(j as f64) / q(3.);
            let w = q(if j == 0 || j == 3 { 1. } else { 3. }) / q(8.);
            let (a, m) = self.miter_section(s, &t)?;
            area += &w * &a;
            ta += &w * &t * &a;
            for k in 0..2 { moment[k] += &w * &m[k]; }
        }
        let (z0, zc) = if self.bottom {
            (-q(s.levels[1]), -q(self.center_z))
        } else { (q(s.levels[0]), q(self.center_z)) };
        let h = &zc - &z0;
        let r = q(self.radius);
        let volume = &a0 * &h + &r * &area;
        let mz = a0 * (&zc * &zc - &z0 * &z0) / q(2.)
            + &r * (&zc * area + &r * ta);
        Ok((volume, [
            &m0[0] * &h + &r * &moment[0],
            &m0[1] * &h + &r * &moment[1],
            if self.bottom { -mz } else { mz },
        ]))
    }
    /// The section polynomial is evaluated at exact rational parameters.
    /// A fillet uses t=1-cos(theta), dz=r*cos(theta)dtheta. The four
    /// weights below integrate that polynomial analytically, including its
    /// cubic first moments; this is not numerical quadrature.
    fn miter_fillet_integrals(&self, s: &ArcPrism) -> R<(Iv, [Iv; 3])> {
        let values: Vec<_> = (0..4).map(|j| self.miter_section(s, &q(j as f64))).collect::<R<_>>()?;
        let coefficients = |v: [Q; 4]| {
            let c3 = (&v[3] - q(3.) * &v[2] + q(3.) * &v[1] - &v[0]) / q(6.);
            let c2 = (&v[2] - q(2.) * &v[1] + &v[0]) / q(2.) - q(3.) * &c3;
            let c1 = &v[1] - &v[0] - &c2 - &c3;
            [v[0].clone(), c1, c2, c3]
        };
        let pi = crate::analytic_pi::pi();
        let weights = [i(1.), i(1.) - pi/i(4.), i(5.)/i(3.) - pi/i(2.), i(3.) - i(15.)*pi/i(16.)];
        let integrate = |coeff: &[Q; 4], vertical: bool| -> R<Iv> {
            let mut value = i(0.);
            for j in 0..4 { value = value + enclose(&coeff[j])? * if vertical {
                i(1.) / i(((j+1)*(j+2)) as f64)
            } else { weights[j] }; }
            finite(value)
        };
        let area = coefficients(std::array::from_fn(|j| values[j].0.clone()));
        let r = i(self.radius);
        let zc = i(if self.bottom { -self.center_z } else { self.center_z });
        let z0 = i(if self.bottom { -s.levels[1] } else { s.levels[0] });
        let volume = enclose(&area[0])? * (zc-z0) + r * integrate(&area, false)?;
        let mut moments = [i(0.); 3];
        for k in 0..2 {
            let m = coefficients(std::array::from_fn(|j| values[j].1[k].clone()));
            moments[k] = enclose(&m[0])? * (zc-z0) + r * integrate(&m, false)?;
        }
        moments[2] = (enclose(&area[0])? * (zc*zc-z0*z0)/i(2.)
            + r * (zc * integrate(&area, false)? + r * integrate(&area, true)?))
            * i(if self.bottom { -1. } else { 1. });
        Ok((finite(volume)?, moments))
    }
    /// Quarter-ellipse joint length with certified integration. The inputs
    /// are exact squared vector lengths; observation bounds never decide geometry.
    pub(crate) fn joint_length(&self, s: &ArcPrism, k: usize) -> R<Iv> {
        let delta = wc::numeric::sub(self.inner.segments()[k].ends()[0].rat()?, s.profile.segments()[k].ends()[0].rat()?);
        let horizontal = dot(&delta, &delta);
        let r2 = q(self.radius)*q(self.radius);
        if self.chamfer { return Ok(enclose(&(horizontal+r2))?.sqrt()); }
        use wonky_validated::{integrate, pi, Expr};
        let tau = Expr::Bound(pi(1e-14).map_err(|_| no("pi"))?) * Expr::Constant(2.);
        let angle = tau.clone()*Expr::Variable;
        let a = self.inner.segments()[k].cache()[0];
        let b = s.profile.segments()[k].cache()[0];
        let horizontal_expr = (Expr::Constant(a[0])-Expr::Constant(b[0])).square()
            + (Expr::Constant(a[1])-Expr::Constant(b[1])).square();
        let radial = Expr::Constant(self.radius).square();
        // This identity keeps a strictly positive lower bound even on a
        // whole quarter-turn panel; sin^2+cos^2 interval dependency must not
        // invent a zero-speed point at the initial quadrature panel.
        let speed2 = if horizontal >= r2 {
            radial.clone() + (horizontal_expr-radial)*angle.sin().square()
        } else {
            horizontal_expr.clone() + (radial-horizontal_expr)*angle.cos().square()
        };
        let speed = tau * speed2.sqrt();
        Ok(integrate(&speed, 0., 0.25, 1e-10*self.radius.max(1.), 65536)
            .map_err(|_| no("ellipse-length-budget"))?.enclosure.ball())
    }
    fn integrals(&self, s: &ArcPrism) -> [Iv; 3] {
        let r = i(self.radius);
        let h = i(s.levels[1]) - i(s.levels[0]);
        let pi = crate::analytic_pi::pi();
        let sign = if self.outward { -1. } else { 1. };
        if self.chamfer {
            [
                h,
                i(sign) * (r * (h - r) + r * r / i(2.)),
                r * r * (h - r) + r * r * r / i(3.),
            ]
        } else {
            [
                h,
                i(sign) * (r * (h - r) + pi * r * r / i(4.)),
                r * r * (h - r) + i(2.) * r * r * r / i(3.),
            ]
        }
    }
    fn volume_si(&self, s: &ArcPrism) -> R<Iv> {
        if self.mitred { return if self.chamfer { enclose(&self.miter_integrals(s)?.0) } else { Ok(self.miter_fillet_integrals(s)?.0) }; }
        let t = self.integrals(s);
        let p = sum(&inner(s, self).lengths()?);
        finite(self.inner.area()? * t[0] + p * t[1] + crate::analytic_pi::pi() * t[2])
    }
    pub(crate) fn volume(&self, s: &ArcPrism, a: &Audited) -> R<Iv> {
        SourceMetric::new(&a.frame)?.volume(self.volume_si(s)? * i(1e9))
    }
    pub(crate) fn areas(&self, s: &ArcPrism, a: &Audited) -> R<Vec<Iv>> {
        let metric = SourceMetric::new(&a.frame)?;
        let height = if self.bottom {
            i(s.levels[1]) - i(self.center_z)
        } else {
            i(self.center_z) - i(s.levels[0])
        };
        let r = i(self.radius);
        let pi = crate::analytic_pi::pi();
        let lens = s.lengths()?;
        let inset_lens = if self.mitred { inner(s, self).lengths()? } else { vec![] };
        let mut out = vec![s.profile.area()?, self.inner.area()?];
        out.extend(lens.iter().map(|&l| l * height));
        for (k, seg) in self.inner.segments().iter().enumerate() {
            out.push(match seg.chart() {
                wc::Chart::Circle(c) if self.chamfer => {
                    c.angle
                        * (enclose(&c.r2)?.sqrt()
                            + i(if self.outward { -1. } else { 1. }) * r / i(2.))
                        * r
                        * i(2.).sqrt()
                }
                wc::Chart::Line if self.chamfer => {
                    let len = if self.mitred {
                        (lens[k] + inset_lens[k]) / i(2.)
                    } else { lens[k] };
                    len * r * i(2.).sqrt()
                },
                wc::Chart::Circle(c) => {
                    c.angle
                        * (enclose(&c.r2)?.sqrt() * pi * r / i(2.)
                            + i(if self.outward { -1. } else { 1. }) * r * r)
                }
                wc::Chart::Line => if self.mitred {
                    r * (inset_lens[k]*pi/i(2.) + lens[k] - inset_lens[k])
                } else { lens[k] * pi * r / i(2.) },
                wc::Chart::BSpline(_) => return Err(wc::Refusal::SplineArrangement.into()),
            });
        }
        out.into_iter().map(|v| metric.area(v * i(1e6))).collect()
    }
    pub(crate) fn perimeters(&self, s: &ArcPrism, a: &Audited) -> R<Vec<f64>> {
        let metric = SourceMetric::new(&a.frame)?;
        let outer = s.lengths()?;
        let inset = inner(s, self).lengths()?;
        let mut out = vec![sum(&outer), sum(&inset)];
        let h = if self.bottom {
            i(s.levels[1]) - i(self.center_z)
        } else {
            i(self.center_z) - i(s.levels[0])
        };
        out.extend(outer.iter().map(|&l| i(2.) * (l + h)));
        if self.mitred {
            let joints = (0..s.profile.segments().len()).map(|k| self.joint_length(s, k)).collect::<R<Vec<_>>>()?;
            out.extend(outer.iter().zip(inset).enumerate().map(|(k, (&l, m))| {
                l + m + joints[k] + joints[(k + 1) % joints.len()]
            }));
            return out.into_iter().map(|v| metric.length(v * i(1000.)).map(|x| x.mid())).collect();
        }
        out.extend(outer.iter().zip(inset).map(|(&l, m)| {
            l + m
                + if self.chamfer {
                    i(2.) * i(self.radius) * i(2.).sqrt()
                } else {
                    crate::analytic_pi::pi() * i(self.radius)
                }
        }));
        out.into_iter()
            .map(|v| metric.length(v * i(1000.)).map(|x| x.mid()))
            .collect()
    }
    pub(crate) fn centroid(&self, s: &ArcPrism, a: &Audited) -> R<([f64; 3], [f64; 3])> {
        if self.mitred && !self.chamfer {
            SourceMetric::new(&a.frame)?;
            let (volume, moments) = self.miter_fillet_integrals(s)?;
            if volume.lo() <= 0. { return Err(no("volume-unresolved")); }
            let local = moments.map(|m| m/volume);
            let (origin, cols) = crate::arc_profile_observe::exact_map(a)?;
            let mut world = [i(0.); 3];
            for k in 0..3 {
                world[k] = enclose(&origin[k])?;
                for j in 0..3 { world[k] = world[k] + enclose(&cols[j][k])?*local[j]; }
                world[k] = finite(world[k]*i(1000.))?;
            }
            return Ok((world.map(|v| v.m), world.map(|v| v.r)));
        }
        if self.mitred {
            SourceMetric::new(&a.frame)?;
            let (volume, moments) = self.miter_integrals(s)?;
            if volume <= q(0.) { return Err(no("volume-unresolved")); }
            let local = moments.map(|m| m / &volume);
            let (origin, cols) = crate::arc_profile_observe::exact_map(a)?;
            let world = (0..3).map(|k| {
                enclose(&((&origin[k] + (0..3).map(|j| &cols[j][k] * &local[j]).sum::<Q>()) * q(1000.)))
            }).collect::<R<Vec<_>>>()?;
            return Ok((std::array::from_fn(|k| world[k].mid()), std::array::from_fn(|k| world[k].r)));
        }
        let r = i(self.radius);
        let pi = crate::analytic_pi::pi();
        let t = self.integrals(s);
        let lengths = inner(s, self).lengths()?;
        let m0 = self.inner.cycle().moments()?;
        let mut boundary = [i(0.); 2];
        let mut curvature = [i(0.); 2];
        for (k, seg) in self.inner.segments().iter().enumerate() {
            let [a, b] = *seg.cache();
            match seg.chart() {
                wc::Chart::Circle(c) => {
                    let rr = enclose(&c.r2)?.sqrt();
                    let normal_integral = [q(b[1]) - q(a[1]), q(a[0]) - q(b[0])];
                    for j in 0..2 {
                        boundary[j] = boundary[j]
                            + c.c.enclosure()?[j] * lengths[k]
                            + rr * enclose(&normal_integral[j])?;
                        curvature[j] = curvature[j]
                            + c.c.enclosure()?[j] * c.angle
                            + enclose(&normal_integral[j])?;
                    }
                }
                wc::Chart::Line => {
                    for j in 0..2 {
                        boundary[j] = boundary[j] + (i(a[j]) + i(b[j])) * lengths[k] / i(2.);
                    }
                }
                wc::Chart::BSpline(_) => return Err(wc::Refusal::SplineArrangement.into()),
            }
        }
        let volume = self.volume_si(s)?;
        if volume.lo() <= 0. {
            return Err(no("volume-unresolved"));
        }
        let sign = if self.bottom { -1. } else { 1. };
        let zc = i(sign * self.center_z);
        let z0 = i(if self.bottom {
            -s.levels[1]
        } else {
            s.levels[0]
        });
        let zt = i(if self.bottom {
            -s.levels[0]
        } else {
            s.levels[1]
        });
        let j1 = i(if self.outward { -1. } else { 1. })
            * (r * (zc * zc - z0 * z0) / i(2.)
                + if self.chamfer {
                    zc * r * r / i(2.) + r * r * r / i(6.)
                } else {
                    zc * pi * r * r / i(4.) + r * r * r / i(3.)
                });
        let j2 = r * r * (zc * zc - z0 * z0) / i(2.)
            + if self.chamfer {
                zc * r * r * r / i(3.) + r * r * r * r / i(12.)
            } else {
                zc * i(2.) * r * r * r / i(3.) + r * r * r * r / i(4.)
            };
        let local = [
            (m0[0] * t[0] + boundary[0] * t[1] + curvature[0] * t[2] / i(2.)) / volume,
            (m0[1] * t[0] + boundary[1] * t[1] + curvature[1] * t[2] / i(2.)) / volume,
            i(sign)
                * (self.inner.area()? * (zt * zt - z0 * z0) / i(2.) + sum(&lengths) * j1 + pi * j2)
                / volume,
        ];
        let cols = a.frame.enclosed_columns();
        let origin = a
            .frame
            .apply_exact([0.; 3], 1., true)
            .map_err(|_| no("frame"))?;
        let mut world = [i(0.); 3];
        for k in 0..3 {
            world[k] = origin[k].iter().fold(i(0.), |s, &x| s + i(x));
            for j in 0..3 {
                world[k] = world[k] + cols[j][k] * local[j];
            }
            world[k] = finite(world[k] * i(1000.))?;
        }
        Ok((world.map(|v| v.mid()), world.map(|v| v.r)))
    }
    pub(crate) fn bbox(
        &self,
        s: &ArcPrism,
        a: &Audited,
        map: Option<[[f64; 4]; 3]>,
    ) -> R<([f64; 3], [f64; 3])> {
        let map = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        if map.iter().flatten().any(|v| !v.is_finite()) {
            return Err(no("bbox-range"));
        }
        let (origin, cols) = crate::arc_profile_observe::exact_map(a)?;
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for k in 0..3 {
            let offset = q(map[k][3])
                + (0..3)
                    .map(|j| q(map[k][j]) * &origin[j] * q(1000.))
                    .sum::<Q>();
            let c: [Q; 3] = std::array::from_fn(|u| {
                (0..3).map(|j| q(map[k][j]) * &cols[u][j] * q(1000.)).sum()
            });
            let support = |sign: f64| -> R<Iv> {
                let mut c = c.each_ref().map(|v| v * q(sign));
                if self.bottom {
                    c[2] = -c[2].clone();
                }
                let z0 = if self.bottom {
                    -s.levels[1]
                } else {
                    s.levels[0]
                };
                let zc = if self.bottom {
                    -self.center_z
                } else {
                    self.center_z
                };
                let d = [c[0].clone(), c[1].clone()];
                if self.mitred {
                    let zt = if self.bottom { -s.levels[0] } else { s.levels[1] };
                    let plain = profile_support(&s.profile, &d)?;
                    let mut bound = (plain + enclose(&(&c[2] * q(z0)))?)
                        .max(plain + enclose(&(&c[2] * q(zc)))?)
                        .max(profile_support(&self.inner, &d)? + enclose(&(&c[2] * q(zt)))?);
                    if !self.chamfer {
                        for (old, inner) in s.profile.segments().iter().zip(self.inner.segments()) {
                            let p = inner.ends()[0].rat()?;
                            let delta = wc::numeric::sub(old.ends()[0].rat()?, p);
                            let horizontal = dot(&d, &delta);
                            let vertical = &c[2]*q(self.radius);
                            if horizontal > q(0.) && vertical > q(0.) {
                                bound = bound.max(enclose(&(dot(&d, p)+&c[2]*q(zc)))?
                                    + enclose(&(&horizontal*&horizontal+&vertical*&vertical))?.sqrt());
                            }
                        }
                    }
                    return finite(bound);
                }
                if c[2] <= Q::zero() {
                    finite(profile_support(&s.profile, &d)? + enclose(&(&c[2] * q(z0)))?)
                } else {
                    let radial = enclose(&dot(&d, &d))?.sqrt();
                    let vertical = enclose(&c[2])?;
                    finite(
                        profile_support(&self.inner, &d)?
                            + enclose(&(&c[2] * q(zc)))?
                            + i(self.radius)
                                * if self.chamfer {
                                    radial.max(vertical)
                                } else {
                                    enclose(&(dot(&d, &d) + &c[2] * &c[2]))?.sqrt()
                                },
                    )
                }
            };
            lo[k] = finite(enclose(&offset)? - support(-1.)?)?.lo();
            hi[k] = finite(enclose(&offset)? + support(1.)?)?.hi();
        }
        Ok((lo, hi))
    }
    pub(crate) fn probe(&self, s: &ArcPrism, a: &Audited, world: [f64; 3]) -> Probe {
        let run = || -> R<Probe> {
            if self.chamfer { return Err(no("chamfer-distance-unimplemented")); }
            if self.mitred { return Err(no("mitred-fillet-distance-unimplemented")); }
            let metric = SourceMetric::new(&a.frame)?;
            let mut p = inverse(&a.frame, world, 1000.)?;
            let sign = if self.bottom { -1. } else { 1. };
            if self.bottom {
                p[2] = -p[2].clone();
            }
            let z0 = if self.bottom {
                -s.levels[1]
            } else {
                s.levels[0]
            };
            let zt = if self.bottom {
                -s.levels[0]
            } else {
                s.levels[1]
            };
            let zc = sign * self.center_z;
            let xy = wc::ExactPoint::from_rational([p[0].clone(), p[1].clone()]);
            let base = inner(s, self);
            let in_q = base.contains(&xy)?;
            let dist_q = if in_q {
                i(0.)
            } else {
                profile_distance(&self.inner, &xy)?
            };
            let (distance, inside) = if p[2] < q(z0) {
                let outside = if s.contains(&xy)? {
                    i(0.)
                } else {
                    profile_distance(&s.profile, &xy)?
                };
                (outside.norm3(enclose(&(q(z0) - &p[2]))?, i(0.)), false)
            } else if p[2] <= q(zc) {
                let inside = s.contains(&xy)?;
                (
                    if inside {
                        i(0.)
                    } else {
                        profile_distance(&s.profile, &xy)?
                    },
                    inside,
                )
            } else if in_q {
                let above = (&p[2] - q(zt)).max(Q::zero());
                (enclose(&above)?, above.is_zero())
            } else {
                let d = finite(dist_q.norm3(enclose(&(&p[2] - q(zc)))?, i(0.)) - i(self.radius))?;
                if d.lo() > 0. {
                    (d, false)
                } else if d.hi() < 0. {
                    (i(0.), true)
                } else {
                    return Err(no("probe-boundary-unresolved"));
                }
            };
            let d = metric.length(distance * i(1000.))?;
            Ok(Probe::Measured {
                distance_mm: if inside { 0. } else { d.mid() },
                inside,
                bound_mm: if inside { 0. } else { d.r },
            })
        };
        run().unwrap_or_else(|e| Probe::Refused(e.0))
    }
}
fn profile_distance(profile: &Profile, p: &wc::ExactPoint) -> R<Iv> {
    let mut result = None;
    for s in profile.segments() {
        let d = s.distance(p)?;
        result = Some(result.map_or(d, |v: Iv| v.min(d)));
    }
    result.ok_or_else(|| no("empty-profile"))
}
fn profile_support(profile: &Profile, d: &wc::P) -> R<Iv> {
    let mut out = None;
    for s in profile.segments() {
        out = s.support_fold([&d[0], &d[1]], out)?;
    }
    out.ok_or_else(|| no("empty-profile"))
}

#[cfg(test)]
mod miter_tests {
    use super::*;
    fn rectangle(points: [[f64; 2]; 4], height: f64) -> ArcPrism {
        ArcPrism {
            profile: Profile::from_pieces((0..4).map(|k| {
                wc::Trimmed::line(points[k], points[(k + 1) % 4])
            }).collect()),
            levels: [0., height], rim: None, regularization: None,
        }
    }
    #[test]
    fn fillet_polynomial_integrals_include_corner_overlap_and_reflection() {
        let s = rectangle([[2.,-1.],[8.,-1.],[8.,3.],[2.,3.]],8.);
        for bottom in [false,true] { for outward in [false,true] {
            let rim = Rim::offset_band(&s,0.5,false,bottom,outward).unwrap();
            let (v,m) = rim.miter_fillet_integrals(&s).unwrap();
            let sign = if outward {1.} else {-1.};
            let pi = std::f64::consts::PI;
            let increment = sign*20.*0.25*(1.-pi/4.)+4.*0.125*(5./3.-pi/2.);
            let expected = 24.*8.+increment;
            assert!(v.lo() <= expected && expected <= v.hi(), "{v:?} vs {expected}");
            for (j,center) in [5.,1.].into_iter().enumerate() {
                assert!((m[j]/v).lo() <= center && center <= (m[j]/v).hi());
            }
            let moment = sign*20.*0.125*(5./6.-pi/4.)+4.*0.0625*(19./12.-pi/2.);
            let expected_z = 24.*32.+if bottom {moment} else {8.*increment-moment};
            assert!(m[2].lo() <= expected_z && expected_z <= m[2].hi(), "{:?} vs {expected_z}",m[2]);
        }}
    }
    #[test]
    fn mitres_and_section_integrals_are_exact_in_translated_and_rotated_charts() {
        for (points, size, width, center) in [
            ([[2., -1.], [8., -1.], [8., 3.], [2., 3.]], [6., 4.], 0.5, [5., 1.]),
            ([[0., 0.], [0., 10.], [-5., 10.], [-5., 0.]], [10., 5.], 1.25, [-2.5, 5.]),
        ] {
            let s = rectangle(points, 8.);
            for outward in [false, true] {
                for bottom in [false, true] {
                    let rim = Rim::offset_band(&s, width, true, bottom, outward).unwrap();
                    assert!(rim.mitred);
                    let r = q(width);
                    let sign = q(if outward { 1. } else { -1. });
                    let area = q(size[0]) * q(size[1]);
                    let perimeter = q(2.) * (q(size[0]) + q(size[1]));
                    // A distinct route: sum rectangular edge wedges and their
                    // four overlaps; no section sampling or replay here.
                    let increment = &sign * &perimeter * &r * &r / q(2.)
                        + q(4.) * &r * &r * &r / q(3.);
                    let expected = &area * q(8.) + &increment;
                    let (volume, moments) = rim.miter_integrals(&s).unwrap();
                    assert_eq!(volume, expected);
                    for k in 0..2 { assert_eq!(moments[k], &volume * q(center[k])); }
                    let first_from_end = &sign * perimeter * &r * &r * &r / q(6.)
                        + &r * &r * &r * &r / q(3.);
                    let added_z = if bottom { first_from_end } else {
                        q(8.) * increment - first_from_end
                    };
                    assert_eq!(moments[2], area * q(32.) + added_z);
                    // Each inset line stays on the exact shifted support.
                    for (k, seg) in rim.inner.segments().iter().enumerate() {
                        let n = rim.normals[k].map(q);
                        let old = s.profile.segments()[k].ends()[0].rat().unwrap();
                        for p in seg.ends() {
                            assert_eq!(dot(&wc::numeric::sub(p.rat().unwrap(), old), &n), &sign * &r);
                        }
                    }
                }
            }
        }
    }
}
