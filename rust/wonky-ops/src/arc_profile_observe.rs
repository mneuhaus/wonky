//! Enclosed Green integrals, analytic extrema and exact point membership for
//! the source-witness arc prism. No polygonization or libm angle decisions.
use crate::{
    arc_profile::{enclose, finite, no, q, ArcPrism, R},
    polyhedron::{Audited, Probe},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};
fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn stretch(a: &Audited, power: f64) -> R<Iv> {
    let d = a.frame.orthonormality_defect().map_err(|_| no("frame"))?;
    if d > 1e-9 {
        return Err(no("non-near-rigid-frame"));
    }
    Ok(Iv {
        m: 1.,
        r: (power * d).next_up(),
    })
}
impl ArcPrism {
    fn height(&self) -> Iv {
        i(self.levels[1]) - i(self.levels[0])
    }
    pub(crate) fn volume(&self, a: &Audited) -> R<Iv> {
        if let Some(rim) = &self.rim {
            return rim.volume(self, a);
        }
        // A curve profile of lines and polynomial splines has an exact rational
        // Green area, so its volume is one exact rational rounded once. (Rule 1
        // arc profiles keep their enclosed route below, byte for byte.)
        if crate::curve_profile::candidate(&a.body) {
            if let Some(area) = self.profile.cycle().area_exact()? {
                let det: Q = a.frame.det_exact().map_err(|_| no("frame"))?.iter().map(|&v| q(v)).sum();
                let height = q(self.levels[1]) - q(self.levels[0]);
                return finite(enclose(&(area * height * det * q(1e9)))?);
            }
        }
        let det = a
            .frame
            .det_exact()
            .map_err(|_| no("frame"))?
            .iter()
            .fold(i(0.), |s, &v| s + i(v));
        finite(self.profile.area()? * self.height() * det * i(1e9))
    }
    pub(crate) fn lengths(&self) -> R<Vec<Iv>> {
        Ok(self.profile.segments().iter().map(wc::Trimmed::length).collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub(crate) fn areas(&self, a: &Audited) -> R<Vec<Iv>> {
        if let Some(rim) = &self.rim {
            return rim.areas(self, a);
        }
        let scale = stretch(a, 3.)?;
        let exact = if crate::curve_profile::candidate(&a.body) { self.profile.cycle().area_exact()? } else { None };
        let area = match exact {
            Some(exact) => enclose(&exact)?,
            None => self.profile.area()?,
        };
        let cap = finite(area * scale * i(1e6))?;
        let mut out = vec![cap, cap];
        for l in self.lengths()? {
            out.push(finite(l * self.height() * scale * i(1e6))?);
        }
        Ok(out)
    }
    pub(crate) fn perimeters(&self, a: &Audited) -> R<Vec<f64>> {
        if let Some(rim) = &self.rim {
            return rim.perimeters(self, a);
        }
        let scale = stretch(a, 2.)? * i(1000.);
        let ls = self.lengths()?;
        let cap = finite(ls.iter().fold(i(0.), |s, &l| s + l) * scale)?.mid();
        let mut out = vec![cap, cap];
        for l in ls {
            out.push(finite(i(2.) * (l + self.height()) * scale)?.mid());
        }
        Ok(out)
    }
    pub(crate) fn centroid(&self, a: &Audited) -> R<([f64; 3], [f64; 3])> {
        if let Some(rim) = &self.rim {
            return rim.centroid(self, a);
        }
        let m = self.profile.cycle().moments()?;
        let area = self.profile.area()?;
        let local = [
            m[0] / area,
            m[1] / area,
            (i(self.levels[0]) + i(self.levels[1])) / i(2.),
        ];
        let cols = a.frame.enclosed_columns();
        let origin = a
            .frame
            .apply_exact([0.; 3], 1., true)
            .map_err(|_| no("frame"))?;
        let mut out = [i(0.); 3];
        for k in 0..3 {
            out[k] = origin[k].iter().fold(i(0.), |s, &x| s + i(x));
            for j in 0..3 {
                out[k] = out[k] + cols[j][k] * local[j];
            }
            out[k] = finite(out[k] * i(1000.))?;
        }
        Ok((out.map(|x| x.mid()), out.map(|x| x.r)))
    }
    pub(crate) fn bbox(&self, a: &Audited, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        if let Some(rim) = &self.rim {
            return rim.bbox(self, a, map);
        }
        let mapping = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let (origin, cols) = exact_map(a)?;
        let mut lo = [f64::INFINITY; 3];
        let mut hi = [f64::NEG_INFINITY; 3];
        for k in 0..3 {
            let mut offset = q(mapping[k][3]);
            let mut linear = [Q::zero(), Q::zero(), Q::zero()];
            for j in 0..3 {
                offset += q(mapping[k][j]) * &origin[j] * q(1000.);
                for u in 0..3 {
                    linear[u] += q(mapping[k][j]) * &cols[u][j] * q(1000.);
                }
            }
            for z in self.levels {
                let base = &offset + &linear[2] * q(z);
                for s in self.profile.segments() {
                    for p in s.ends() {
                        let v = p.linear_form(&base, [&linear[0], &linear[1]])?;
                        lo[k] = lo[k].min(v.lo());
                        hi[k] = hi[k].max(v.hi());
                    }
                    let reach = s.extrema(&base, [&linear[0], &linear[1]])?;
                    if let Some(h) = reach.hi {
                        hi[k] = hi[k].max(h);
                    }
                    if let Some(l) = reach.lo {
                        lo[k] = lo[k].min(l);
                    }
                }
            }
        }
        Ok((lo, hi))
    }
    pub(crate) fn tolerance(&self, a: &Audited) -> R<f64> {
        let (lo, hi) = self.bbox(a, None)?;
        let mut magnitude = lo.into_iter().chain(hi).fold(0.0f64, |m, v| m.max(v.abs()));
        let mut cache_error = 0.0f64;
        for s in self.profile.segments() {
            for p in s.ends() {
                cache_error = cache_error.max(p.rounding()? * 1000.);
            }
            let extent = s.extent()?;
            magnitude = magnitude.max(extent.magnitude * 1000.);
            cache_error = cache_error.max(extent.rounding * 1000.);
        }
        let defect = a.frame.orthonormality_defect().map_err(|_| no("frame"))?;
        let mut error =
            finite(i(128. * f64::EPSILON + 16. * defect) * i(magnitude) + i(8.) * i(cache_error))?
                .hi();
        if let Some(rim) = &self.rim {
            // A toroidal carrier normalizes two angular directions. Reuse the
            // source-metric export bound, including its core and minor radii.
            let mut reach = a
                .body
                .vertices
                .iter()
                .map(|v| v.point.iter().fold(i(0.), |s, x| s + i(x.get().abs())))
                .fold(i(0.), |s, x| s.max(x));
            for segment in self.profile.segments() {
                if let Some(carrier) = segment.reach()? {
                    reach = reach.max(carrier + i(rim.center_z.abs()) + i(rim.radius));
                }
            }
            error = error.max(
                crate::source_frame::SourceMetric::new(&a.frame)?
                    .export_budget(finite(reach * i(1000.))?.hi(), magnitude)?,
            );
        }
        if crate::curve_profile::candidate(&a.body) {
            // The STEP writer of spline carriers declares the partition-of-unity
            // bound of its rounded controls; the published tolerance covers it.
            error = error.max(crate::step_carrier::budget_of(&a.body, &a.frame)?);
        }
        if error <= 0. || !error.is_finite() {
            return Err(no("export-budget-range"));
        }
        Ok(error)
    }
    pub(crate) fn probe(&self, a: &Audited, world: [f64; 3]) -> Probe {
        if let Some(rim) = &self.rim {
            return rim.probe(self, a, world);
        }
        let run = || -> R<Probe> {
            if !world.iter().all(|v| v.is_finite()) {
                return Err(no("probe-range"));
            }
            let (origin, cols) = exact_map(a)?;
            let delta = std::array::from_fn(|k| q(world[k]) / q(1000.) - &origin[k]);
            let cofactor = [
                cross3(&cols[1], &cols[2]),
                cross3(&cols[2], &cols[0]),
                cross3(&cols[0], &cols[1]),
            ];
            let det = dot3(&cols[0], &cofactor[0]);
            if det <= Q::zero() {
                return Err(no("probe-frame"));
            }
            let p = cofactor.map(|v| dot3(&delta, &v) / &det);
            let planar = [p[0].clone(), p[1].clone()];
            let planar = wc::ExactPoint::from_rational(planar);
            let inside_planar = self.contains(&planar)?;
            let dz = (q(self.levels[0]) - &p[2])
                .max(&p[2] - q(self.levels[1]))
                .max(Q::zero());
            if inside_planar && dz.is_zero() {
                return Ok(Probe::Measured {
                    distance_mm: 0.,
                    inside: true,
                    bound_mm: 0.,
                });
            }
            let mut dist = None;
            if !inside_planar {
                for s in self.profile.segments() {
                    let d = s.distance(&planar)?;
                    dist = Some(dist.map_or(d, |old: Iv| old.min(d)));
                }
            }
            let radial = dist.unwrap_or(i(0.));
            let local = finite(radial.norm3(enclose(&dz)?, i(0.)) * i(1000.) * stretch(a, 2.)?)?;
            if local.lo() <= 0. {
                return Err(no("probe-distance-unresolved"));
            }
            Ok(Probe::Measured {
                distance_mm: local.mid(),
                inside: false,
                bound_mm: local.r,
            })
        };
        run().unwrap_or_else(|e| Probe::Refused(e.0))
    }
    pub(crate) fn contains(&self, p: &wc::ExactPoint) -> R<bool> {
        Ok(self.profile.cycle().contains(p)?)
    }
}
type P3 = [Q; 3];
fn cross3(a: &P3, b: &P3) -> P3 {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
fn dot3(a: &P3, b: &P3) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
pub(crate) fn exact_map(a: &Audited) -> R<(P3, [P3; 3])> {
    let map = |p, translate| -> R<P3> {
        let e = a
            .frame
            .apply_exact(p, 1., translate)
            .map_err(|_| no("frame"))?;
        Ok(e.map(|e| e.into_iter().map(q).sum()))
    };
    Ok((
        map([0.; 3], true)?,
        [
            map([1., 0., 0.], false)?,
            map([0., 1., 0.], false)?,
            map([0., 0., 1.], false)?,
        ],
    ))
}
