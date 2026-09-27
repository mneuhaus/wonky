//! Enclosed Green integrals, analytic extrema and exact point membership for
//! the source-witness arc prism. No polygonization or libm angle decisions.
use crate::{
    arc_profile::{cross, dot, enclose, finite, no, pt, q, sub, ArcPrism, Segment, P, R},
    polyhedron::{Audited, Probe},
};
use num_rational::BigRational as Q;
use num_traits::Zero;
use wonky_num::{Iv, Scalar};
fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn norm(v: &P) -> R<Iv> {
    finite(enclose(&dot(v, v))?.sqrt())
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
        let det = a
            .frame
            .det_exact()
            .map_err(|_| no("frame"))?
            .iter()
            .fold(i(0.), |s, &v| s + i(v));
        finite(self.profile.area()? * self.height() * det * i(1e9))
    }
    fn lengths(&self) -> R<Vec<Iv>> {
        self.profile
            .segments
            .iter()
            .map(|s| {
                if let Some(c) = &s.circle {
                    finite(enclose(&c.r2)?.sqrt() * c.angle.abs())
                } else {
                    norm(&sub(&pt(s.b), &pt(s.a)))
                }
            })
            .collect()
    }
    pub(crate) fn areas(&self, a: &Audited) -> R<Vec<Iv>> {
        let scale = stretch(a, 3.)?;
        let cap = finite(self.profile.area()? * scale * i(1e6))?;
        let mut out = vec![cap, cap];
        for l in self.lengths()? {
            out.push(finite(l * self.height() * scale * i(1e6))?);
        }
        Ok(out)
    }
    pub(crate) fn perimeters(&self, a: &Audited) -> R<Vec<f64>> {
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
        let mut m = [i(0.); 2];
        for s in &self.profile.segments {
            let (ap, bp) = (pt(s.a), pt(s.b));
            let wedge = cross(&ap, &bp);
            for k in 0..2 {
                m[k] = m[k] + enclose(&(&wedge * (&ap[k] + &bp[k]) / q(6.)))?;
            }
            if let Some(c) = &s.circle {
                let (u, v) = (sub(&ap, &c.c), sub(&bp, &c.c));
                let uv = cross(&u, &v);
                let area = (enclose(&c.r2)? * c.angle - enclose(&uv)?) / i(2.);
                let sector = [&v[1] - &u[1], &u[0] - &v[0]];
                for k in 0..2 {
                    m[k] = m[k]
                        + enclose(&c.c[k])? * area
                        + enclose(&(&c.r2 * &sector[k] / q(3.) - &uv * (&u[k] + &v[k]) / q(6.)))?;
                }
            }
        }
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
                for s in &self.profile.segments {
                    for p in [s.a, s.b] {
                        let v = enclose(&(&base + &linear[0] * q(p[0]) + &linear[1] * q(p[1])))?;
                        lo[k] = lo[k].min(v.lo());
                        hi[k] = hi[k].max(v.hi());
                    }
                    if let Some(c) = &s.circle {
                        let direction = [linear[0].clone(), linear[1].clone()];
                        let center =
                            enclose(&(&base + &linear[0] * &c.c[0] + &linear[1] * &c.c[1]))?;
                        let reach =
                            finite(enclose(&(&c.r2 * dot(&direction, &direction)))?.sqrt())?;
                        if s.angular(&direction, false) {
                            hi[k] = hi[k].max(finite(center + reach)?.hi());
                        }
                        let negative = direction.map(|x| -x);
                        if s.angular(&negative, false) {
                            lo[k] = lo[k].min(finite(center - reach)?.lo());
                        }
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
        for s in &self.profile.segments {
            if let Some(c) = &s.circle {
                let radius = finite(enclose(&c.r2)?.sqrt())?;
                magnitude = magnitude.max(radius.hi() * 1000.);
                for k in 0..2 {
                    let center = enclose(&c.c[k])?;
                    magnitude = magnitude.max(center.abs().hi() * 1000.);
                    cache_error = cache_error.max((center.r + radius.r) * 1000.);
                }
            }
        }
        let defect = a.frame.orthonormality_defect().map_err(|_| no("frame"))?;
        let error =
            finite(i(128. * f64::EPSILON + 16. * defect) * i(magnitude) + i(8.) * i(cache_error))?
                .hi();
        if error <= 0. || !error.is_finite() {
            return Err(no("export-budget-range"));
        }
        Ok(error)
    }
    pub(crate) fn probe(&self, a: &Audited, world: [f64; 3]) -> Probe {
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
            let inside_planar = self.contains(&planar);
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
                for s in &self.profile.segments {
                    let d = segment_distance(s, &planar)?;
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
    fn contains(&self, p: &P) -> bool {
        let mut winding = 0i32;
        let mut chord_boundary = false;
        let mut chord_area = Q::zero();
        for s in &self.profile.segments {
            let (a, b) = (pt(s.a), pt(s.b));
            chord_area += cross(&a, &b);
            let d = sub(&b, &a);
            let v = sub(p, &a);
            let sign = cross(&d, &v);
            if sign.is_zero() && dot(&v, &d) >= Q::zero() && dot(&sub(p, &b), &d) <= Q::zero() {
                chord_boundary = true;
                if s.circle.is_none() {
                    return true;
                }
            }
            if a[1] <= p[1] && b[1] > p[1] && sign > Q::zero() {
                winding += 1;
            }
            if b[1] <= p[1] && a[1] > p[1] && sign < Q::zero() {
                winding -= 1;
            }
        }
        if chord_boundary && winding == 0 {
            winding = if chord_area > Q::zero() { 1 } else { -1 };
        }
        for s in &self.profile.segments {
            if let Some(c) = &s.circle {
                let v = sub(p, &c.c);
                let radial = dot(&v, &v) - &c.r2;
                if radial.is_zero() && s.angular(&v, false) {
                    return true;
                }
                let side = cross(&sub(&pt(s.b), &pt(s.a)), &sub(p, &pt(s.a)));
                if radial <= Q::zero() {
                    if c.ccw && side <= Q::zero() {
                        winding += 1;
                    } else if !c.ccw && side >= Q::zero() {
                        winding -= 1;
                    }
                }
            }
        }
        winding != 0
    }
}
fn segment_distance(s: &Segment, p: &P) -> R<Iv> {
    let (a, b) = (pt(s.a), pt(s.b));
    if let Some(c) = &s.circle {
        let v = sub(p, &c.c);
        if s.angular(&v, false) {
            return finite((norm(&v)? - finite(enclose(&c.r2)?.sqrt())?).abs());
        }
        return Ok(norm(&sub(p, &a))?.min(norm(&sub(p, &b))?));
    }
    let d = sub(&b, &a);
    let t = (dot(&sub(p, &a), &d) / dot(&d, &d))
        .max(Q::zero())
        .min(q(1.));
    norm(&[&p[0] - &a[0] - &t * &d[0], &p[1] - &a[1] - &t * &d[1]])
}
type P3 = [Q; 3];
fn cross3(a: &P3, b: &P3) -> P3 {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
fn dot3(a: &P3, b: &P3) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn exact_map(a: &Audited) -> R<(P3, [P3; 3])> {
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
