//! Geometry authority for replayed plane arrangements. The dyadic construction
//! inputs and exact frame maps define rationals; WC0's binary64 entity fields
//! are reproducible observation caches only. All consumers use this authority
//! or refuse before inspecting those caches for a geometric decision.
use crate::{
    placement::Placement,
    polyhedron::{Audited, Refused},
    rounding::finite_ball,
};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
use wonky_num::ball::{Iv, Scalar};

type R<T> = Result<T, Refused>;
pub(crate) type P = [Q; 3];
fn no(s: &str) -> Refused {
    Refused(format!("planar-boolean/{s}"))
}
pub(crate) fn q(x: f64) -> Q {
    Q::from_float(x).expect("finite checked input")
}
pub(crate) fn sub(a: &P, b: &P) -> P {
    std::array::from_fn(|k| &a[k] - &b[k])
}
pub(crate) fn dot(a: &P, b: &P) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
pub(crate) fn cross(a: &P, b: &P) -> P {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| &a[i] * &b[j] - &a[j] * &b[i])
}
fn normal(cycle: &[usize], points: &[P]) -> P {
    let mut n = std::array::from_fn(|_| Q::zero());
    for k in 1..cycle.len() - 1 {
        let a = cross(
            &sub(&points[cycle[k]], &points[cycle[0]]),
            &sub(&points[cycle[k + 1]], &points[cycle[0]]),
        );
        for j in 0..3 {
            n[j] += &a[j];
        }
    }
    n
}
fn nearest(x: &Q) -> R<f64> {
    x.to_f64()
        .filter(|x| x.is_finite())
        .ok_or_else(|| no("observation-range"))
}
/// Prove an enclosure, rather than presuming a library conversion error bound.
fn enclosed(x: &Q) -> R<Iv> {
    let m = nearest(x)?;
    let f = q(m);
    if f == *x {
        return Ok(Iv::point(m));
    }
    let neighbor = if f < *x { m.next_up() } else { m.next_down() };
    if !neighbor.is_finite() || (f < *x && q(neighbor) < *x) || (f > *x && q(neighbor) > *x) {
        return Err(no("observation-enclosure"));
    }
    finite_ball(Iv {
        m,
        r: (neighbor - m).abs().next_up(),
    })
    .map_err(|_| no("observation-range"))
}
pub(crate) fn point(p: &P) -> R<[f64; 3]> {
    Ok([nearest(&p[0])?, nearest(&p[1])?, nearest(&p[2])?])
}
/// A projective observation, never a plane or parallelism predicate input.
pub(crate) fn direction(p: &P) -> R<[f64; 3]> {
    let scale = p.iter().map(Q::abs).max().unwrap();
    if scale.is_zero() {
        return Err(no("zero-direction"));
    }
    point(&p.clone().map(|x| x / &scale))
}
fn map_points(points: &[P], frame: &Placement) -> R<Vec<P>> {
    let image = |p, t| -> R<P> {
        Ok(frame
            .apply_exact(p, 1., t)
            .map_err(|_| no("frame-range"))?
            .map(|e| e.into_iter().map(q).sum()))
    };
    let origin = image([0.; 3], true)?;
    let columns = [
        image([1., 0., 0.], false)?,
        image([0., 1., 0.], false)?,
        image([0., 0., 1.], false)?,
    ];
    Ok(points
        .iter()
        .map(|p| {
            std::array::from_fn(|k| &origin[k] + (0..3).map(|j| &columns[j][k] * &p[j]).sum::<Q>())
        })
        .collect())
}
/// Exact world coordinates, shared by distance and closest-edge predicates.
pub(crate) fn world_points(a: &Audited, scale: f64) -> R<Vec<P>> {
    let points = if let Some(g) = &a.arrangement {
        g.world.clone()
    } else {
        map_points(
            &a.body
                .vertices
                .iter()
                .map(|v| v.point.map(|x| q(x.get())))
                .collect::<Vec<_>>(),
            &a.frame,
        )?
    };
    let scale = q(scale);
    Ok(points.into_iter().map(|p| p.map(|x| x * &scale)).collect())
}
fn volume6(points: &[P], loops: &[Vec<usize>]) -> Q {
    loops
        .iter()
        .map(|cycle| {
            (1..cycle.len() - 1)
                .map(|k| {
                    dot(
                        &points[cycle[0]],
                        &cross(&points[cycle[k]], &points[cycle[k + 1]]),
                    )
                })
                .sum::<Q>()
        })
        .sum()
}
fn sqrt(x: &Q) -> R<Iv> {
    if x.is_negative() {
        return Err(no("negative-squared-length"));
    }
    if x.is_zero() {
        return Ok(Iv::point(0.));
    }
    let m = nearest(x)?.sqrt();
    let (mut lo, mut hi) = (m, m);
    for _ in 0..4 {
        if lo.is_finite() && hi.is_finite() && q(lo) * q(lo) <= *x && q(hi) * q(hi) >= *x {
            return finite_ball(Iv {
                m,
                r: (m - lo).max(hi - m).next_up(),
            })
            .map_err(|_| no("sqrt-range"));
        }
        lo = lo.next_down().max(0.);
        hi = hi.next_up();
    }
    Err(no("sqrt-enclosure"))
}
#[derive(Clone, Debug)]
pub(crate) struct Arrangement {
    pub(crate) source: Vec<P>,
    pub(crate) world: Vec<P>,
}
impl Arrangement {
    pub(crate) fn new(source: Vec<P>, frame: &Placement) -> R<Self> {
        let world = map_points(&source, frame)?;
        Ok(Self { source, world })
    }
    pub(crate) fn volume6(&self, loops: &[Vec<usize>]) -> Q {
        volume6(&self.source, loops)
    }
    pub(crate) fn volume_mm3(&self, loops: &[Vec<usize>]) -> R<f64> {
        let v = volume6(&self.world, loops).abs() * q(1e9) / q(6.);
        let out = enclosed(&v)?;
        if !out.m.is_normal() || out.lo() <= 0. || out.r / out.lo() > 2. * f64::EPSILON {
            return Err(no("volume-range"));
        }
        Ok(out.m)
    }
    pub(crate) fn vertices_mm(&self) -> R<Vec<[f64; 3]>> {
        self.world
            .iter()
            .map(|p| point(&p.clone().map(|x| x * q(1000.))))
            .collect()
    }
    pub(crate) fn areas_mm2(&self, loops: &[Vec<usize>]) -> R<Vec<f64>> {
        loops
            .iter()
            .map(|c| {
                let n = normal(c, &self.world);
                let a = sqrt(&dot(&n, &n))? * Iv::point(500000.);
                let a = finite_ball(a).map_err(|_| no("area-range"))?;
                if a.lo() <= 0. || !a.m.is_normal() || a.r / a.m > 48. * f64::EPSILON {
                    return Err(no("area-range"));
                }
                Ok(a.m)
            })
            .collect()
    }
    pub(crate) fn perimeters_mm(&self, loops: &[Vec<usize>]) -> R<Vec<f64>> {
        loops
            .iter()
            .map(|c| {
                let mut total = Iv::point(0.);
                for k in 0..c.len() {
                    let d = sub(&self.world[c[k]], &self.world[c[(k + 1) % c.len()]]);
                    total = total + sqrt(&dot(&d, &d))?;
                }
                finite_ball(total * Iv::point(1000.))
                    .map(|v| v.m)
                    .map_err(|_| no("perimeter-range"))
            })
            .collect()
    }
    pub(crate) fn bbox_mm(&self, map: Option<[[f64; 4]; 3]>) -> R<([f64; 3], [f64; 3])> {
        if map.is_some_and(|a| a.iter().flatten().any(|x| !x.is_finite())) {
            return Err(no("bbox-range"));
        }
        let ps: Vec<P> = self
            .world
            .iter()
            .map(|p| {
                let p = p.clone().map(|x| x * q(1000.));
                match map {
                    None => p,
                    Some(a) => std::array::from_fn(|k| {
                        q(a[k][3]) + (0..3).map(|j| q(a[k][j]) * &p[j]).sum::<Q>()
                    }),
                }
            })
            .collect();
        let lo = std::array::from_fn(|k| ps.iter().map(|p| &p[k]).min().unwrap().clone());
        let hi = std::array::from_fn(|k| ps.iter().map(|p| &p[k]).max().unwrap().clone());
        Ok((point(&lo)?, point(&hi)?))
    }
    pub(crate) fn centroid_mm(&self, loops: &[Vec<usize>]) -> R<([f64; 3], [f64; 3])> {
        let mut v = Q::zero();
        let mut m: P = std::array::from_fn(|_| Q::zero());
        for c in loops {
            for k in 1..c.len() - 1 {
                let (a, b, d) = (&self.world[c[0]], &self.world[c[k]], &self.world[c[k + 1]]);
                let t = dot(a, &cross(b, d));
                for j in 0..3 {
                    m[j] += (&a[j] + &b[j] + &d[j]) * &t;
                }
                v += t;
            }
        }
        if v.is_zero() {
            return Err(no("zero-volume"));
        }
        let mut mid = [0.; 3];
        let mut bound = [0.; 3];
        for k in 0..3 {
            let x = enclosed(&(&m[k] * q(250.) / &v))?;
            mid[k] = x.m;
            bound[k] = x.r;
        }
        Ok((mid, bound))
    }
    /// World STEP carrier observations derived from exact polygon geometry,
    /// not from the already rounded WC0 carrier. STEP normalizes DIRECTIONs.
    pub(crate) fn carrier(&self, cycle: &[usize]) -> R<([f64; 3], [f64; 3], [f64; 3])> {
        let n = normal(cycle, &self.world);
        let axis = (0..3).min_by_key(|&k| n[k].abs()).unwrap();
        let e = std::array::from_fn(|k| q(if k == axis { 1. } else { 0. }));
        let x = cross(&e, &n);
        Ok((
            point(&self.world[cycle[0]].clone().map(|x| x * q(1000.)))?,
            direction(&n)?,
            direction(&x)?,
        ))
    }
    pub(crate) fn export_tolerance_mm(&self, loops: &[Vec<usize>]) -> R<f64> {
        let w = self.vertices_mm()?;
        let max = w.iter().flatten().fold(0f64, |a, x| a.max(x.abs()));
        // The ordinary line writer normalizes differences of rounded endpoints.
        // A stable scale-relative allowance covers that normalization; exact
        // plane residuals below additionally cover carrier displacement.
        let mut budget =
            Iv::point(max) * Iv::point(512. * f64::EPSILON) + Iv::point(f64::MIN_POSITIVE);
        for c in loops {
            let (o, n, _) = self.carrier(c)?;
            let (o, n) = (o.map(q), n.map(q));
            let length = sqrt(&dot(&n, &n))?;
            for &i in c {
                let p = self.world[i].clone().map(|x| x * q(1000.));
                let residual = enclosed(&dot(&n, &sub(&p, &o)).abs())? / length;
                budget = budget.max(residual + Iv::point(max) * Iv::point(8. * f64::EPSILON));
            }
        }
        finite_ball(budget)
            .map(|v| v.hi())
            .map_err(|_| no("export-range"))
    }
}

// Query refusal bands preserve the existing interface: exact equality is
// accepted; an unrelated almost-parallel/incident query is never snapped.
fn parallel(a: &P, b: &P) -> R<bool> {
    let aa = dot(a, a);
    let bb = dot(b, b);
    if aa.is_zero() || bb.is_zero() {
        return Err(no("query-zero-direction"));
    }
    let c = cross(a, b);
    let cc = dot(&c, &c);
    if cc.is_zero() {
        return Ok(true);
    }
    if cc / (aa * bb) <= q(1e-16) {
        return Err(no("query-near-parallel-unproved"));
    }
    Ok(false)
}
fn incident(p: &P, o: &P, n: &P) -> R<bool> {
    let d = dot(&sub(p, o), n);
    if d.is_zero() {
        return Ok(true);
    }
    if &d * &d / dot(n, n) <= q(1e-16) {
        return Err(no("query-near-plane-unproved"));
    }
    Ok(false)
}
pub(crate) fn parallel_edges(
    a: &Audited,
    entities: &[crate::query::Entity],
    direction: [f64; 3],
) -> R<Vec<crate::query::Entity>> {
    use crate::query::EDGE;
    let d = direction.map(q);
    parallel(&d, &d)?;
    let g = a.arrangement.as_ref().unwrap();
    let mut out = Vec::new();
    for &e in entities {
        if e.kind != EDGE {
            continue;
        }
        let edge = a
            .body
            .edges
            .get(e.index as usize)
            .ok_or_else(|| no("query-edge-index"))?;
        if parallel(
            &sub(
                &g.world[edge.vertices[1].0 as usize],
                &g.world[edge.vertices[0].0 as usize],
            ),
            &d,
        )? {
            out.push(e);
        }
    }
    Ok(out)
}
pub(crate) fn coincides(
    a: &Audited,
    entities: &[crate::query::Entity],
    origin: [f64; 3],
    normal_direction: [f64; 3],
    source: bool,
) -> R<Vec<crate::query::Entity>> {
    use crate::query::{FACE, VERTEX};
    let (o, n) = (origin.map(q), normal_direction.map(q));
    parallel(&n, &n)?;
    let g = a.arrangement.as_ref().unwrap();
    let ps = if source { &g.source } else { &g.world };
    let mut out = Vec::new();
    for &e in entities {
        let yes = match e.kind {
            FACE => {
                let c = a
                    .face_loops
                    .get(e.index as usize)
                    .ok_or_else(|| no("query-face-index"))?;
                parallel(&normal(c, ps), &n)? && incident(&ps[c[0]], &o, &n)?
            }
            VERTEX => incident(
                ps.get(e.index as usize)
                    .ok_or_else(|| no("query-vertex-index"))?,
                &o,
                &n,
            )?,
            _ => return Err(no("query-plane-entity")),
        };
        if yes {
            out.push(e);
        }
    }
    Ok(out)
}
