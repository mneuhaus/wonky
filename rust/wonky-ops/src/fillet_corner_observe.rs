//! Enclosed integrals and exact point classification of three-edge blends.
use crate::{
    fillet_corner::Corner,
    fillet_prism::no,
    polyhedron::{Audited, Probe, Refused},
    source_frame::{inverse, SourceMetric},
};
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use wonky_num::ball::{Iv, Scalar};
type R<T> = Result<T, Refused>;
fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn finite(x: Iv) -> R<Iv> {
    crate::rounding::finite_ball(x).map_err(|_| no("corner-observation-range"))
}
fn enclosed(x: &Q) -> R<Iv> {
    let m = x
        .to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("corner-observation-range"))?;
    let lo = if q(m) > *x { m.next_down() } else { m };
    let hi = if q(m) < *x { m.next_up() } else { m };
    finite(if lo == hi {
        i(lo)
    } else {
        Iv {
            m: lo,
            r: (hi - lo).next_up(),
        }
    })
}
impl Corner {
    fn removed_area(&self) -> Iv {
        i(self.radius) * i(self.radius) * (i(1.) - crate::analytic_pi::pi() / i(4.))
    }
    fn volume_si(&self) -> R<Iv> {
        let [a, b, c] = self.lengths.map(i);
        let r = i(self.radius);
        let pi = crate::analytic_pi::pi();
        finite(
            a * b * c
                - self.removed_area() * (a + b + c - i(3.) * r)
                - r * r * r * (i(1.) - pi / i(6.)),
        )
    }
    pub(crate) fn volume(&self, a: &Audited) -> R<Iv> {
        SourceMetric::new(&a.frame)?.volume(self.volume_si()? * i(1e9))
    }
    pub(crate) fn areas(&self, body: &Audited) -> R<Vec<Iv>> {
        let metric = SourceMetric::new(&body.frame)?;
        let r = i(self.radius);
        let l = self.lengths.map(i);
        let pi = crate::analytic_pi::pi();
        let mut a = vec![];
        for k in 0..3 {
            a.push((l[(k + 1) % 3] - r) * (l[(k + 2) % 3] - r));
        }
        for k in 0..3 {
            a.push(l[(k + 1) % 3] * l[(k + 2) % 3] - self.removed_area());
        }
        for k in 0..3 {
            a.push(pi * r * (l[k] - r) / i(2.));
        }
        a.push(pi * r * r / i(2.));
        a.into_iter()
            .enumerate()
            .filter(|(face, _)| self.face_active(*face))
            .map(|(_, x)| metric.area(x * i(1e6)))
            .collect()
    }
    pub(crate) fn perimeters(&self, body: &Audited) -> R<Vec<f64>> {
        let metric = SourceMetric::new(&body.frame)?;
        let r = i(self.radius);
        let l = self.lengths.map(i);
        let arc = crate::analytic_pi::pi() * r / i(2.);
        let mut a = vec![];
        for k in 0..3 {
            a.push(i(2.) * (l[(k + 1) % 3] + l[(k + 2) % 3] - i(2.) * r));
        }
        for k in 0..3 {
            a.push(i(2.) * (l[(k + 1) % 3] + l[(k + 2) % 3] - r) + arc);
        }
        for k in 0..3 {
            a.push(i(2.) * (l[k] - r + arc));
        }
        a.push(i(3.) * arc);
        a.into_iter()
            .enumerate()
            .filter(|(face, _)| self.face_active(*face))
            .map(|(_, x)| metric.length(x * i(1000.)).map(|x| x.mid()))
            .collect()
    }
    pub(crate) fn centroid(&self, a: &Audited) -> R<([f64; 3], [f64; 3])> {
        let frame = a.frame.as_affine()?;
        let l = self.lengths.map(i);
        let r = i(self.radius);
        let pi = crate::analytic_pi::pi();
        let area = self.removed_area();
        let cross_moment = area * r - r * r * r / i(6.);
        let corner_moment = r * r * r * r * (i(0.5) - i(5.) * pi / i(48.));
        let volume = self.volume_si()?;
        if volume.lo() <= 0. {
            return Err(no("corner-volume-not-positive"));
        }
        let mut source = [i(0.); 3];
        for j in 0..3 {
            let mut moment = l[0] * l[1] * l[2] * l[j] / i(2.) - corner_moment;
            for k in 0..3 {
                moment = moment
                    - if j == k {
                        area * (l[k] * l[k] - r * r) / i(2.)
                    } else {
                        cross_moment * (l[k] - r)
                    };
            }
            source[j] = i(self.origin[j]) + i(self.signs[j]) * moment / volume;
        }
        let cols = a.frame.enclosed_columns();
        let world: [R<Iv>; 3] = std::array::from_fn(|k| {
            finite(
                (i(frame.origin[k])
                    + (0..3).fold(i(0.), |sum, j| sum + cols[j][k] * source[j]))
                    * i(1000.),
            )
        });
        let world = [world[0].clone()?, world[1].clone()?, world[2].clone()?];
        Ok((world.map(|x| x.mid()), world.map(|x| x.r)))
    }
    pub(crate) fn bbox(&self, a: &Audited, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let frame = a.frame.as_affine()?;
        let mut cols: [[Q; 3]; 3] = std::array::from_fn(|_| std::array::from_fn(|_| Q::zero()));
        for j in 0..3 {
            let mut axis = [0.; 3];
            axis[j] = 1.;
            cols[j] = a.frame.apply_exact(axis, 1., false)
                .map_err(|_| no("corner-observation-frame"))?
                .map(|e| e.into_iter().map(q).sum());
        }
        let mapping = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        if mapping.iter().flatten().any(|x| !x.is_finite()) {
            return Err(no("corner-bbox-range"));
        }
        let mut lo = [0.; 3];
        let mut hi = [0.; 3];
        for k in 0..3 {
            let c: [Q; 3] = std::array::from_fn(|j| {
                (0..3)
                    .map(|t| q(mapping[k][t]) * &cols[j][t] * q(1000.))
                    .sum::<Q>()
            });
            let base = q(mapping[k][3])
                + (0..3)
                    .map(|t| q(mapping[k][t]) * q(frame.origin[t]) * q(1000.))
                    .sum::<Q>()
                + (0..3).map(|j| &c[j] * q(self.origin[j])).sum::<Q>();
            let c: [Q; 3] = std::array::from_fn(|j| &c[j] * q(self.signs[j]));
            let support = |sign: f64| -> R<Iv> {
                let c = c.each_ref().map(|x| x * q(sign));
                let mut sum = Q::zero();
                let mut norm = Q::zero();
                for j in 0..3 {
                    if c[j] < Q::zero() {
                        sum += &c[j] * q(self.radius);
                        norm += &c[j] * &c[j];
                    } else {
                        sum += &c[j] * q(self.lengths[j]);
                    }
                }
                finite(enclosed(&sum)? + i(self.radius) * enclosed(&norm)?.sqrt())
            };
            let base = enclosed(&base)?;
            lo[k] = finite(base - support(-1.)?)?.lo();
            hi[k] = finite(base + support(1.)?)?.hi();
        }
        Ok((lo, hi))
    }
    pub(crate) fn probe(&self, a: &Audited, world: [f64; 3]) -> Probe {
        let result = || -> R<Probe> {
            let metric = SourceMetric::new(&a.frame)?;
            let local = inverse(&a.frame, world, 1000.)?;
            let p: [Q; 3] = std::array::from_fn(|j| {
                (&local[j] - q(self.origin[j])) * q(self.signs[j])
            });
            let mut lower2 = Q::zero();
            let mut upper2 = Q::zero();
            for k in 0..3 {
                let lower = (q(self.radius) - &p[k]).max(Q::zero());
                let upper = (&p[k] - q(self.lengths[k])).max(Q::zero());
                lower2 += &lower * &lower;
                upper2 += &upper * &upper;
            }
            let inside = upper2.is_zero() && lower2 <= q(self.radius) * q(self.radius);
            let lower = (enclosed(&lower2)?.sqrt() - i(self.radius)).max(i(0.));
            let distance = metric.length(lower.norm3(enclosed(&upper2)?.sqrt(), i(0.)) * i(1000.))?;
            Ok(Probe::Measured {
                distance_mm: if inside { 0. } else { distance.mid() },
                inside,
                bound_mm: distance.r,
            })
        };
        match result() {
            Ok(v) => v,
            Err(e) => Probe::Refused(e.0),
        }
    }
}
