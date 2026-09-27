//! Mixed three-point circular-arc/line profiles. Source points are binary64;
//! circle centres and all incidence/topology predicates are exact rationals.
//! Rounded WC0 carriers are a serialization of that construction, audited by
//! reconstruction; measurements enclose the source circles, not their caches.
use crate::{
    affine::Affine,
    polyhedron::{Audited, Refused},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_num::{Iv, Scalar};
pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) type P = [Q; 2];
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("arc-profile/{s}"))
}
pub(crate) fn q(x: f64) -> Q {
    Q::from_float(x).expect("validated finite source")
}
pub(crate) fn pt(p: [f64; 2]) -> P {
    p.map(q)
}
pub(crate) fn sub(a: &P, b: &P) -> P {
    [&a[0] - &b[0], &a[1] - &b[1]]
}
pub(crate) fn cross(a: &P, b: &P) -> Q {
    &a[0] * &b[1] - &a[1] * &b[0]
}
pub(crate) fn dot(a: &P, b: &P) -> Q {
    &a[0] * &b[0] + &a[1] * &b[1]
}
pub(crate) fn enclose(x: &Q) -> R<Iv> {
    let m = x
        .to_f64()
        .filter(|v| v.is_finite())
        .ok_or_else(|| no("numeric-range"))?;
    if q(m) == *x {
        return Ok(Iv::point(m));
    }
    let (l, h) = (m.next_down(), m.next_up());
    if !l.is_finite() || !h.is_finite() || q(l) > *x || q(h) < *x {
        return Err(no("numeric-range"));
    }
    finite(Iv {
        m,
        r: (m - l).max(h - m).next_up(),
    })
}
pub(crate) fn finite(v: Iv) -> R<Iv> {
    if v.is_nan() || !v.lo().is_finite() || !v.hi().is_finite() {
        Err(no("observation-range"))
    } else {
        Ok(v)
    }
}
pub(crate) fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}

#[derive(Clone, Debug)]
pub(crate) struct Circle {
    pub c: P,
    pub r2: Q,
    pub ccw: bool,
    pub mid: P,
    pub angle: Iv,
}
#[derive(Clone, Debug)]
pub(crate) struct Segment {
    pub a: [f64; 2],
    pub b: [f64; 2],
    pub circle: Option<Circle>,
}
impl Segment {
    pub(crate) fn angular(&self, v: &P, strict: bool) -> bool {
        let c = self.circle.as_ref().unwrap();
        if v.iter().all(Zero::is_zero) {
            return false;
        }
        let mut a = sub(&pt(self.a), &c.c);
        let mut b = sub(&pt(self.b), &c.c);
        if !c.ccw {
            std::mem::swap(&mut a, &mut b);
        }
        let av = cross(&a, v);
        let vb = cross(v, &b);
        let ab = cross(&a, &b);
        if strict
            && ((av.is_zero() && dot(&a, v) > Q::zero())
                || (vb.is_zero() && dot(v, &b) > Q::zero()))
        {
            return false;
        }
        if ab >= Q::zero() {
            av >= Q::zero() && vb >= Q::zero()
        } else {
            av >= Q::zero() || vb >= Q::zero()
        }
    }
}
// atan in [0,1], reduced by the half-angle identity to [0,sqrt(2)-1].
// The alternating-series remainder is enclosed explicitly (no libm premise).
fn atan_unit(x: Iv) -> R<Iv> {
    let one = Iv::point(1.);
    let t = finite(x / (one + (one + x * x).sqrt()))?;
    if t.lo() < 0. || t.hi() >= 0.5 {
        return Err(no("angle-range"));
    }
    let mut power = t;
    let mut sum = Iv::point(0.);
    for k in 0..48 {
        let term = power / Iv::point((2 * k + 1) as f64);
        sum = if k % 2 == 0 { sum + term } else { sum - term };
        power = power * t * t;
    }
    let rem = finite(power / Iv::point(97.))?.abs().hi();
    finite(Iv::point(2.) * (sum + Iv { m: 0., r: rem }))
}
fn positive_angle(x: &Q, y: &Q) -> R<Iv> {
    let pi = crate::analytic_pi::pi();
    if y.is_zero() {
        return Ok(if x >= &Q::zero() { Iv::point(0.) } else { pi });
    }
    if x.is_zero() {
        return Ok(if y > &Q::zero() {
            pi / Iv::point(2.)
        } else {
            pi * Iv::point(1.5)
        });
    }
    let (ax, ay) = (x.abs(), y.abs());
    let acute = if ax >= ay {
        atan_unit(enclose(&(ay / ax))?)?
    } else {
        pi / Iv::point(2.) - atan_unit(enclose(&(ax / ay))?)?
    };
    Ok(match (x.is_positive(), y.is_positive()) {
        (true, true) => acute,
        (false, true) => pi - acute,
        (false, false) => pi + acute,
        (true, false) => pi * Iv::point(2.) - acute,
    })
}
fn arc(a: [f64; 2], m: [f64; 2], b: [f64; 2]) -> R<Segment> {
    let (ap, mp, bp) = (pt(a), pt(m), pt(b));
    let u = sub(&mp, &ap);
    let v = sub(&bp, &ap);
    let d = cross(&u, &v) * q(2.);
    if d.is_zero() {
        return Err(no("collinear-three-point-arc"));
    }
    let (uu, vv) = (dot(&u, &u), dot(&v, &v));
    let c = [
        &ap[0] + (&uu * &v[1] - &vv * &u[1]) / &d,
        &ap[1] + (&u[0] * &vv - &v[0] * &uu) / &d,
    ];
    let u = sub(&ap, &c);
    let v = sub(&bp, &c);
    let r2 = dot(&u, &u);
    let ccw = d.is_positive();
    let theta = positive_angle(
        &dot(&u, &v),
        &(if ccw { cross(&u, &v) } else { -cross(&u, &v) }),
    )?;
    if theta.lo() <= 0. {
        return Err(no("zero-arc"));
    }
    Ok(Segment {
        a,
        b,
        circle: Some(Circle {
            c,
            r2,
            ccw,
            mid: mp,
            angle: if ccw { theta } else { -theta },
        }),
    })
}

#[derive(Clone, Debug)]
pub(crate) struct Profile {
    pub segments: Vec<Segment>,
}
fn key(p: [f64; 2]) -> [u64; 2] {
    p.map(|x| if x == 0. { 0 } else { x.to_bits() })
}
impl Profile {
    pub(crate) fn new(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> R<Self> {
        if arcs.is_empty() || lines.len() + arcs.len() < 3 {
            return Err(no("requires-mixed-closed-chain"));
        }
        if !lines
            .iter()
            .flatten()
            .chain(arcs.iter().flatten())
            .all(|x| x.is_finite())
        {
            return Err(no("nonfinite-source"));
        }
        let mut segs = lines
            .iter()
            .map(|s| Segment {
                a: [s[0], s[1]],
                b: [s[2], s[3]],
                circle: None,
            })
            .collect::<Vec<_>>();
        for s in arcs {
            segs.push(arc([s[0], s[1]], [s[2], s[3]], [s[4], s[5]])?);
        }
        let mut graph: BTreeMap<[u64; 2], Vec<usize>> = BTreeMap::new();
        for (i, s) in segs.iter().enumerate() {
            if s.a == s.b {
                return Err(no("zero-edge"));
            }
            for p in [s.a, s.b] {
                graph.entry(key(p)).or_default().push(i);
            }
        }
        if graph.values().any(|n| n.len() != 2) {
            return Err(no("open-or-branching-chain"));
        }
        let mut used = vec![false; segs.len()];
        let mut ordered = vec![];
        let mut at = segs[0].a;
        for _ in 0..segs.len() {
            let id = *graph[&key(at)]
                .iter()
                .find(|&&i| !used[i])
                .ok_or_else(|| no("multiple-loops"))?;
            used[id] = true;
            let mut s = segs[id].clone();
            if s.a != at {
                std::mem::swap(&mut s.a, &mut s.b);
                if let Some(c) = &mut s.circle {
                    c.ccw = !c.ccw;
                    c.angle = -c.angle;
                }
            }
            at = s.b;
            ordered.push(s);
        }
        if at != ordered[0].a {
            return Err(no("open-chain"));
        }
        let mut p = Self { segments: ordered };
        p.simple()?;
        let area = p.area()?;
        if area.hi() < 0. {
            p.segments.reverse();
            for s in &mut p.segments {
                std::mem::swap(&mut s.a, &mut s.b);
                if let Some(c) = &mut s.circle {
                    c.ccw = !c.ccw;
                    c.angle = -c.angle;
                }
            }
        }
        if p.area()?.lo() <= 0. {
            return Err(no("unresolved-profile-orientation"));
        }
        Ok(p)
    }
    fn simple(&self) -> R<()> {
        // The chord polygon and each trimmed arc have independent intersection
        // certificates. A full-circle intersection not resolved below refuses.
        let chords = self
            .segments
            .iter()
            .map(|s| [wonky_num::p2(s.a[0], s.a[1]), wonky_num::p2(s.b[0], s.b[1])])
            .collect::<Vec<_>>();
        wonky_sketch::region::lines_region(&chords).map_err(|_| no("chord-intersection"))?;
        let bounds = self
            .segments
            .iter()
            .map(segment_bounds)
            .collect::<R<Vec<_>>>()?;
        for i in 0..self.segments.len() {
            for j in i + 1..self.segments.len() {
                if (0..2)
                    .any(|k| bounds[i][1][k] < bounds[j][0][k] || bounds[j][1][k] < bounds[i][0][k])
                {
                    continue;
                }
                let (a, b) = (&self.segments[i], &self.segments[j]);
                if a.circle.is_none() && b.circle.is_none() {
                    continue;
                }
                let shared = [a.a, a.b].iter().any(|p| *p == b.a || *p == b.b);
                match (&a.circle, &b.circle) {
                    (Some(c), None) => line_circle(b, c, shared)?,
                    (None, Some(c)) => line_circle(a, c, shared)?,
                    (Some(c), Some(d)) => {
                        if c.c == d.c && c.r2 == d.r2 {
                            if a.angular(&sub(&d.mid, &c.c), true)
                                || b.angular(&sub(&c.mid, &c.c), true)
                                || [a.a, a.b]
                                    .iter()
                                    .any(|&p| b.angular(&sub(&pt(p), &d.c), true))
                                || [b.a, b.b]
                                    .iter()
                                    .any(|&p| a.angular(&sub(&pt(p), &c.c), true))
                            {
                                return Err(no("overlapping-arcs"));
                            }
                        } else {
                            let delta = sub(&c.c, &d.c);
                            let ds = dot(&delta, &delta);
                            let t = &ds - &c.r2 - &d.r2;
                            let discr = &t * &t - q(4.) * &c.r2 * &d.r2;
                            if discr < Q::zero() || (discr.is_zero() && !shared) {
                                return Err(no("circle-intersection-unresolved"));
                            }
                        }
                    }
                    _ => unreachable!(),
                }
            }
        }
        Ok(())
    }
    pub(crate) fn area(&self) -> R<Iv> {
        let mut a = Iv::point(0.);
        for s in &self.segments {
            let (ap, bp) = (pt(s.a), pt(s.b));
            a = a + enclose(&cross(&ap, &bp))?;
            if let Some(c) = &s.circle {
                let (u, v) = (sub(&ap, &c.c), sub(&bp, &c.c));
                a = a + enclose(&c.r2)? * c.angle - enclose(&cross(&u, &v))?;
            }
        }
        finite(a / Iv::point(2.))
    }
}
fn line_circle(s: &Segment, c: &Circle, shared: bool) -> R<()> {
    let a = sub(&pt(s.a), &c.c);
    let b = sub(&pt(s.b), &c.c);
    let d = sub(&b, &a);
    let dd = dot(&d, &d);
    let fa = dot(&a, &a) - &c.r2;
    let fb = dot(&b, &b) - &c.r2;
    if fa < Q::zero() && fb < Q::zero() {
        return Ok(());
    }
    let t = (-dot(&a, &d) / &dd).max(Q::zero()).min(q(1.));
    let closest = [&a[0] + &t * &d[0], &a[1] + &t * &d[1]];
    let f = dot(&closest, &closest) - &c.r2;
    if f > Q::zero() || (f.is_zero() && shared) {
        return Ok(());
    }
    if shared && (fa.is_zero() || fb.is_zero()) {
        let root = if fa.is_zero() {
            -q(2.) * dot(&a, &d) / &dd
        } else {
            -q(2.) * dot(&b, &d) / &dd + q(1.)
        };
        if root < Q::zero() || root > q(1.) {
            return Ok(());
        }
    }
    Err(no("line-circle-intersection-unresolved"))
}
fn segment_bounds(s: &Segment) -> R<[[f64; 2]; 2]> {
    let mut lo = [s.a[0].min(s.b[0]), s.a[1].min(s.b[1])];
    let mut hi = [s.a[0].max(s.b[0]), s.a[1].max(s.b[1])];
    if let Some(c) = &s.circle {
        let r = finite(enclose(&c.r2)?.sqrt())?;
        for k in 0..2 {
            for sign in [-1., 1.] {
                let mut v = pt([0., 0.]);
                v[k] = q(sign);
                if s.angular(&v, false) {
                    let p = finite(enclose(&c.c[k])? + Iv::point(sign) * r)?;
                    lo[k] = lo[k].min(p.lo());
                    hi[k] = hi[k].max(p.hi());
                }
            }
        }
    }
    Ok([lo, hi])
}

#[derive(Clone, Debug)]
pub(crate) struct ArcPrism {
    pub profile: Profile,
    pub levels: [f64; 2],
}
pub fn build(
    key: BodyKey,
    frame: Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    depth: f64,
    reverse: bool,
) -> R<Body> {
    if !depth.is_finite() || depth <= 0. {
        return Err(no("depth"));
    }
    frame.det_exact().map_err(|_| no("frame"))?;
    let profile = Profile::new(lines, arcs)?;
    let levels = if reverse { [-depth, 0.] } else { [0., depth] };
    let mut params = vec![
        depth,
        if reverse { 1. } else { 0. },
        lines.len() as f64,
        arcs.len() as f64,
    ];
    params.extend(lines.iter().flatten());
    params.extend(arcs.iter().flatten());
    let nodes = vec![
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: params.into_iter().map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Sketch {},
            rule_version: 1,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(1),
        },
        Construction {
            operation: Operation::Extrude {},
            rule_version: 1,
            parents: vec![NodeId(1)],
            parameters: vec![],
            frame: FrameId(1),
        },
    ];
    let v = |p: [f64; 3]| {
        p.into_iter()
            .map(b)
            .collect::<R<Vec<_>>>()
            .map(|p| [p[0], p[1], p[2]])
    };
    let frames = vec![
        Frame::Source { source: [0; 4] },
        Frame::Interpreter {
            parent: FrameId(0),
            origin: v(frame.origin)?,
            x: v(frame.x)?,
            z: v(frame.z)?,
        },
    ];
    crate::arc_profile_brep::construct(key, frames, nodes, &ArcPrism { profile, levels })
}
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions.len() == 3
        && body.constructions[1].operation == Operation::Sketch {}
        && body.constructions[2].operation == Operation::Extrude {}
}
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    if body.frames.len() != 2 || body.constructions.len() != 3 {
        return Err(no("construction-shape"));
    }
    let frame = match body.frames[1] {
        Frame::Interpreter {
            parent: FrameId(0),
            origin,
            x,
            z,
        } => Affine {
            origin: origin.map(|x| x.get()),
            x: x.map(|x| x.get()),
            z: z.map(|x| x.get()),
        },
        _ => return Err(no("frame")),
    };
    let p = body.constructions[0]
        .parameters
        .iter()
        .map(|x| x.get())
        .collect::<Vec<_>>();
    if p.len() < 4
        || ![0., 1.].contains(&p[1])
        || p[2] < 0.
        || p[3] < 0.
        || p[2].fract() != 0.
        || p[3].fract() != 0.
        || p[2] > p.len() as f64
        || p[3] > p.len() as f64
    {
        return Err(no("source"));
    }
    let (nl, na) = (p[2] as usize, p[3] as usize);
    if p.len() != 4 + nl * 4 + na * 6 {
        return Err(no("source"));
    }
    let lines = p[4..4 + nl * 4]
        .chunks_exact(4)
        .map(|x| [x[0], x[1], x[2], x[3]])
        .collect::<Vec<_>>();
    let arcs = p[4 + nl * 4..]
        .chunks_exact(6)
        .map(|x| [x[0], x[1], x[2], x[3], x[4], x[5]])
        .collect::<Vec<_>>();
    let rebuilt = build(body.key.clone(), frame, &lines, &arcs, p[0], p[1] == 1.)?;
    if &rebuilt != body {
        return Err(no("construction-mismatch"));
    }
    let frame =
        crate::placement::Placement::from_frames(body, FrameId(1)).map_err(|_| no("frame"))?;
    if frame.reversed().map_err(|_| no("frame"))?
        || frame.orthonormality_defect().map_err(|_| no("frame"))? > 1e-9
    {
        return Err(no("non-near-rigid-frame"));
    }
    let profile = Profile::new(&lines, &arcs)?;
    let levels = if p[1] == 1. { [-p[0], 0.] } else { [0., p[0]] };
    let face_loops = body
        .loops
        .iter()
        .map(|lp| {
            lp.coedges
                .iter()
                .map(|id| {
                    let co = &body.coedges[id.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    Ok(Audited {
        body: body.clone(),
        frame,
        axis: 2,
        levels,
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        arrangement: None,
        orthogonal: None,
        rounded: None,
        corner: None,
        arcs: Some(ArcPrism { profile, levels }),
        chamfer: None,
    })
}
