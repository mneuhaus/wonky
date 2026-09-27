//! Enclosed analytic measurements of the exact rounded-prism certificate.
use crate::{
    fillet_prism::{no, RoundedPrism},
    polyhedron::{Audited, Probe, Refused},
    rounding::finite_ball,
    source_frame::{inverse, SourceMetric},
};
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use wonky_num::ball::{Iv, Scalar};
type R<T> = Result<T, Refused>;
fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn finite(x: Iv) -> R<Iv> {
    finite_ball(x).map_err(|_| no("observation-range"))
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn enclosed(x: &Q) -> R<Iv> {
    let m = x.to_f64().ok_or_else(|| no("observation-range"))?;
    if !m.is_finite() {
        return Err(no("observation-range"));
    }
    let mut l = m;
    let mut h = m;
    if q(l) > *x {
        l = l.next_down();
    }
    if q(h) < *x {
        h = h.next_up();
    }
    finite(if l == h {
        Iv::point(l)
    } else {
        Iv {
            m: l,
            r: (h - l).next_up(),
        }
    })
}
impl RoundedPrism {
    fn cap_area(&self) -> R<Iv> {
        let [u, v, _] = self.axes();
        let w = i(self.bounds[1][u]) - i(self.bounds[0][u]);
        let h = i(self.bounds[1][v]) - i(self.bounds[0][v]);
        let corner = i(1.) - crate::analytic_pi::pi() / i(4.);
        let mut area = w * h;
        for r in self.radii {
            area = area - i(r) * i(r) * corner;
        }
        let area = finite(area)?;
        if area.lo() <= 0. {
            return Err(no("area-not-positive"));
        }
        Ok(area)
    }
    pub(crate) fn volume(&self, a: &Audited) -> R<Iv> {
        SourceMetric::new(&a.frame)?.volume(
            self.cap_area()?
                * (i(self.bounds[1][self.axis]) - i(self.bounds[0][self.axis]))
                * i(1e9),
        )
    }
    fn lengths(&self) -> R<Vec<Iv>> {
        self.segments()?
            .iter()
            .map(|s| {
                finite(if s.center.is_some() {
                    crate::analytic_pi::pi() * i(s.radius) / i(2.)
                } else {
                    (i(s.b[0]) - i(s.a[0])).norm3(i(s.b[1]) - i(s.a[1]), i(0.))
                })
            })
            .collect()
    }
    pub(crate) fn areas(&self, body: &Audited) -> R<Vec<Iv>> {
        let a = finite(self.cap_area()? * i(1e6))?;
        let mut out = vec![a, a];
        let h = i(self.bounds[1][self.axis]) - i(self.bounds[0][self.axis]);
        for l in self.lengths()? {
            out.push(finite(l * h * i(1e6))?);
        }
        let metric = SourceMetric::new(&body.frame)?;
        out.into_iter().map(|v| metric.area(v)).collect()
    }
    pub(crate) fn perimeters(&self, body: &Audited) -> R<Vec<f64>> {
        let metric = SourceMetric::new(&body.frame)?;
        let ls = self.lengths()?;
        let p = metric.length(ls.iter().fold(i(0.), |s, &l| s + l) * i(1000.))?;
        let mut out = vec![p.mid(), p.mid()];
        let h = i(self.bounds[1][self.axis]) - i(self.bounds[0][self.axis]);
        for l in ls {
            out.push(metric.length(i(2.) * (l + h) * i(1000.))?.mid());
        }
        Ok(out)
    }
    pub(crate) fn centroid(&self, a: &Audited) -> R<([f64; 3], [f64; 3])> {
        let frame = a.frame.as_affine()?;
        let [u, v, w] = self.axes();
        let lo = self.bounds[0];
        let hi = self.bounds[1];
        let rect = (i(hi[u]) - i(lo[u])) * (i(hi[v]) - i(lo[v]));
        let mut moment = [
            rect * (i(lo[u]) + i(hi[u])) / i(2.),
            rect * (i(lo[v]) + i(hi[v])) / i(2.),
        ];
        let corners = [
            [lo[u], lo[v]],
            [hi[u], lo[v]],
            [hi[u], hi[v]],
            [lo[u], hi[v]],
        ];
        let inward = [[1., 1.], [-1., 1.], [-1., -1.], [1., -1.]];
        for j in 0..4 {
            let r = i(self.radii[j]);
            let removed = r * r * (i(1.) - crate::analytic_pi::pi() / i(4.));
            for k in 0..2 {
                let c = i(corners[j][k]) + i(inward[j][k]) * r;
                moment[k] = moment[k] - (removed * c - i(inward[j][k]) * r * r * r / i(6.));
            }
        }
        let mut local = [i(0.); 3];
        local[u] = moment[0] / self.cap_area()?;
        local[v] = moment[1] / self.cap_area()?;
        local[w] = (i(lo[w]) + i(hi[w])) / i(2.);
        let cols = a.frame.enclosed_columns();
        let world: [Iv; 3] = std::array::from_fn(|k| {
            let mut p = i(frame.origin[k]);
            for j in 0..3 {
                p = p + cols[j][k] * local[j];
            }
            p * i(1000.)
        });
        let world = world.map(finite);
        let world = [world[0].clone()?, world[1].clone()?, world[2].clone()?];
        Ok((world.map(|x| x.mid()), world.map(|x| x.r)))
    }
    pub(crate) fn bbox(&self, a: &Audited, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        let frame = a.frame.as_affine()?;
        let cols = a.frame.enclosed_columns();
        let [u, v, w] = self.axes();
        let mapping = map.unwrap_or([[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.]]);
        let origin = mapping.map(|row| {
            (0..3).fold(i(row[3]), |s, k| {
                s + i(row[k]) * i(frame.origin[k]) * i(1000.)
            })
        });
        let linear: [[Iv; 3]; 3] = mapping.map(|row| {
            std::array::from_fn(|j| {
                (0..3).fold(i(0.), |s, k| s + i(row[k]) * cols[j][k] * i(1000.))
            })
        });
        let segs = self.segments()?;
        let mut low = [f64::INFINITY; 3];
        let mut high = [f64::NEG_INFINITY; 3];
        for z in [self.bounds[0][w], self.bounds[1][w]] {
            for seg in &segs {
                for k in 0..3 {
                    let base = origin[k] + linear[k][w] * i(z);
                    for p in [seg.a, seg.b] {
                        let x = finite(base + linear[k][u] * i(p[0]) + linear[k][v] * i(p[1]))?;
                        low[k] = low[k].min(x.lo());
                        high[k] = high[k].max(x.hi());
                    }
                    if let Some(c) = seg.center {
                        let center = base + linear[k][u] * i(c[0]) + linear[k][v] * i(c[1]);
                        let alpha =
                            linear[k][u] * i(seg.radial[0]) + linear[k][v] * i(seg.radial[1]);
                        let beta =
                            linear[k][u] * i(-seg.radial[1]) + linear[k][v] * i(seg.radial[0]);
                        let reach = i(seg.radius) * alpha.norm3(beta, i(0.));
                        if alpha.hi() >= 0. && beta.hi() >= 0. {
                            high[k] = high[k].max(finite(center + reach)?.hi());
                        }
                        if alpha.lo() <= 0. && beta.lo() <= 0. {
                            low[k] = low[k].min(finite(center - reach)?.lo());
                        }
                    }
                }
            }
        }
        Ok((low, high))
    }
    pub(crate) fn probe(&self, a: &Audited, world: [f64; 3]) -> Probe {
        let result = || -> R<Probe> {
            let metric = SourceMetric::new(&a.frame)?;
            let local = inverse(&a.frame, world, 1000.)?;
            let iv = local.each_ref().map(enclosed);
            let iv = [iv[0].clone()?, iv[1].clone()?, iv[2].clone()?];
            let [u, v, w] = self.axes();
            let p = [&local[u], &local[v]];
            let pi = [iv[u], iv[v]];
            let mut inside = (0..3)
                .all(|k| local[k] >= q(self.bounds[0][k]) && local[k] <= q(self.bounds[1][k]));
            let mut best: Option<Iv> = None;
            for s in self.segments()? {
                let delta = [pi[0] - i(s.a[0]), pi[1] - i(s.a[1])];
                let endpoint = |x: [f64; 2]| (pi[0] - i(x[0])).norm3(pi[1] - i(x[1]), i(0.));
                let d = if let Some(c) = s.center {
                    let dx = p[0] - q(c[0]);
                    let dy = p[1] - q(c[1]);
                    let alpha = &dx * q(s.radial[0]) + &dy * q(s.radial[1]);
                    let beta = &dx * q(-s.radial[1]) + &dy * q(s.radial[0]);
                    if alpha >= Q::zero() && beta >= Q::zero() {
                        if &dx * &dx + &dy * &dy > q(s.radius) * q(s.radius) {
                            inside = false;
                        }
                        ((pi[0] - i(c[0])).norm3(pi[1] - i(c[1]), i(0.)) - i(s.radius)).abs()
                    } else {
                        endpoint(s.a).min(endpoint(s.b))
                    }
                } else {
                    let k = if s.a[0] != s.b[0] { 0 } else { 1 };
                    let j = 1 - k;
                    let low = s.a[k].min(s.b[k]);
                    let high = s.a[k].max(s.b[k]);
                    if p[k] < &q(low) {
                        endpoint(if s.a[k] == low { s.a } else { s.b })
                    } else if p[k] > &q(high) {
                        endpoint(if s.a[k] == high { s.a } else { s.b })
                    } else {
                        delta[j].abs()
                    }
                };
                let d = finite(d)?;
                best = Some(match best {
                    Some(x) => x.min(d),
                    None => d,
                });
            }
            let radial_inside = {
                let mut in_cap = local[u] >= q(self.bounds[0][u])
                    && local[u] <= q(self.bounds[1][u])
                    && local[v] >= q(self.bounds[0][v])
                    && local[v] <= q(self.bounds[1][v]);
                for s in self.segments()? {
                    if let Some(c) = s.center {
                        let dx = p[0] - q(c[0]);
                        let dy = p[1] - q(c[1]);
                        let alpha = &dx * q(s.radial[0]) + &dy * q(s.radial[1]);
                        let beta = &dx * q(-s.radial[1]) + &dy * q(s.radial[0]);
                        if alpha >= Q::zero()
                            && beta >= Q::zero()
                            && &dx * &dx + &dy * &dy > q(s.radius) * q(s.radius)
                        {
                            in_cap = false;
                        }
                    }
                }
                in_cap
            };
            let planar = if radial_inside {
                i(0.)
            } else {
                best.ok_or_else(|| no("probe-empty"))?
            };
            let axial = (i(self.bounds[0][w]) - iv[w])
                .max(iv[w] - i(self.bounds[1][w]))
                .max(i(0.));
            let distance = metric.length(planar.norm3(axial, i(0.)) * i(1000.))?;
            Ok(Probe::Measured {
                distance_mm: if inside { 0. } else { distance.mid() },
                inside,
                bound_mm: distance.r,
            })
        };
        match result() {
            Ok(x) => x,
            Err(e) => Probe::Refused(e.0),
        }
    }
}
