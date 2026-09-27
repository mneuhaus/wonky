//! Minimum distance of disjoint convex planar solids. Input geometry remains
//! binary64 + exact frame composition. Transient rationals decide the minimum
//! feature pair, including projection domains, with no epsilon. sqrt is rounded
//! only after the exact minimum squared distance is known, with a checked
//! enclosing pair of binary64 endpoints (never an exact transcendental claim).
use crate::polyhedron::{Audited, Refused};
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
type P = [Q; 3];
fn sub(a: &P, b: &P) -> P { std::array::from_fn(|k| &a[k] - &b[k]) }
fn dot(a: &P, b: &P) -> Q { (0..3).map(|k| &a[k] * &b[k]).sum() }
fn cross(a: &P, b: &P) -> P {
    [(1,2),(2,0),(0,1)].map(|(i,j)| &a[i]*&b[j] - &a[j]*&b[i])
}
fn at(a: &P, u: &P, t: &Q) -> P { std::array::from_fn(|k| &a[k] + &u[k]*t) }
fn rational(x: f64) -> Q { Q::from_float(x).expect("finite checked geometry") }
fn points(a: &Audited) -> Result<Vec<P>, Refused> {
    crate::planar_geometry::world_points(a, 1000.)
}
fn point_segment(p: &P, a: &P, b: &P) -> Q {
    let u = sub(b,a); let d = dot(&u,&u);
    let t = (dot(&sub(p,a),&u)/d).max(Q::zero()).min(rational(1.));
    let delta = sub(p,&at(a,&u,&t)); dot(&delta,&delta)
}
fn point_triangle(p: &P, a: &P, b: &P, c: &P) -> Q {
    let u = sub(b,a); let v = sub(c,a); let w = sub(p,a);
    let uu = dot(&u,&u); let uv = dot(&u,&v); let vv = dot(&v,&v);
    let wu = dot(&w,&u); let wv = dot(&w,&v);
    let denominator = &uu*&vv - &uv*&uv;
    if denominator > Q::zero() {
        let s = (&wu*&vv - &wv*&uv)/&denominator;
        let t = (&wv*&uu - &wu*&uv)/&denominator;
        if s >= Q::zero() && t >= Q::zero() && &s+&t <= rational(1.) {
            let delta = sub(p,&at(&at(a,&u,&s),&v,&t));
            return dot(&delta,&delta);
        }
    }
    point_segment(p,a,b).min(point_segment(p,b,c)).min(point_segment(p,c,a))
}
fn segments(a: &P, b: &P, c: &P, d: &P) -> Q {
    let u = sub(b,a); let v = sub(d,c); let w = sub(a,c);
    let aa = dot(&u,&u); let bb = dot(&u,&v); let cc = dot(&v,&v);
    let dd = dot(&u,&w); let ee = dot(&v,&w);
    let denominator = &aa*&cc - &bb*&bb;
    let mut best = point_segment(a,c,d).min(point_segment(b,c,d)).min(point_segment(c,a,b)).min(point_segment(d,a,b));
    if denominator > Q::zero() {
        let s = (&bb*&ee - &cc*&dd)/&denominator;
        let t = (&aa*&ee - &bb*&dd)/&denominator;
        if s >= Q::zero() && s <= rational(1.) && t >= Q::zero() && t <= rational(1.) {
            let delta = sub(&at(a,&u,&s),&at(c,&v,&t));
            best = best.min(dot(&delta,&delta));
        }
    }
    best
}
fn face_normal(cycle: &[usize], p: &[P]) -> P {
    let mut normal = std::array::from_fn(|_| Q::zero());
    for k in 1..cycle.len()-1 {
        let n = cross(&sub(&p[cycle[k]],&p[cycle[0]]), &sub(&p[cycle[k+1]],&p[cycle[0]]));
        for j in 0..3 { normal[j] += &n[j]; }
    }
    normal
}
fn convex(a: &Audited, p: &[P]) -> Result<(), Refused> {
    let reversed = a.frame.reversed().map_err(|_| Refused("distance/frame".into()))?;
    for face in &a.face_loops {
        let n = face_normal(face,p);
        if p.iter().any(|v| { let side = dot(&n,&sub(v,&p[face[0]])); if reversed { side < Q::zero() } else { side > Q::zero() } }) {
            return Err(Refused("distance/nonconvex-solid".into()));
        }
    }
    Ok(())
}
fn separated(axis: &P, a: &[P], b: &[P]) -> bool {
    let interval = |points: &[P]| {
        let values: Vec<_> = points.iter().map(|p| dot(axis,p)).collect();
        (values.iter().min().unwrap().clone(), values.into_iter().max().unwrap())
    };
    let (al,ah) = interval(a); let (bl,bh) = interval(b);
    ah < bl || bh < al
}
#[derive(Clone, Debug)]
pub struct Distance {
    pub distance_mm: f64,
    pub lower_mm: f64,
    pub upper_mm: f64,
}
pub fn between(a: &Audited, b: &Audited) -> Result<Distance, Refused> {
    if a.chamfer.is_some() || b.chamfer.is_some() { return Err(Refused("distance/chamfer-unimplemented".into())); }
    // Audited also admits exact blends. Their trim vertices and chords do not
    // define the solid, so planar triangulation cannot certify their distance.
    if a.body.curves.iter().chain(&b.body.curves).any(|c| !matches!(c.geometry, wonky_contract::CurveGeometry::Line { .. } | wonky_contract::CurveGeometry::ConstructionLine { .. }))
        || a.body.surfaces.iter().chain(&b.body.surfaces).any(|s| !matches!(s.geometry, wonky_contract::SurfaceGeometry::Plane { .. })) {
        return Err(Refused("distance/curved-carrier-unimplemented".into()));
    }
    if a.body.faces.iter().chain(&b.body.faces).any(|f| f.loops.len() != 1) { return Err(Refused("distance/multiply-connected-face".into())); }
    if a.body.vertices.len() > 128 || b.body.vertices.len() > 128 { return Err(Refused("distance/resource-limit".into())); }
    let pa = points(a)?; let pb = points(b)?;
    convex(a,&pa)?; convex(b,&pb)?;
    // SAT: strict disjointness proven by a face or an edge-cross-edge axis.
    let mut apart = a.face_loops.iter().any(|f| separated(&face_normal(f,&pa),&pa,&pb))
        || b.face_loops.iter().any(|f| separated(&face_normal(f,&pb),&pa,&pb));
    let edge = |p: &[P], e: &wonky_contract::Edge| sub(&p[e.vertices[1].0 as usize],&p[e.vertices[0].0 as usize]);
    if !apart { 'outer: for ea in &a.body.edges { for eb in &b.body.edges {
        if separated(&cross(&edge(&pa,ea),&edge(&pb,eb)),&pa,&pb) { apart = true; break 'outer; }
    } } }
    if !apart { return Err(Refused("distance/solids-not-strictly-separated".into())); }
    let mut best = dot(&sub(&pa[0],&pb[0]),&sub(&pa[0],&pb[0]));
    for (vertices, faces, points) in [(&pa,&b.face_loops,&pb), (&pb,&a.face_loops,&pa)] {
        for p in vertices { for f in faces { for k in 1..f.len()-1 {
            best = best.min(point_triangle(p,&points[f[0]],&points[f[k]],&points[f[k+1]]));
        } } }
    }
    for ea in &a.body.edges { for eb in &b.body.edges {
        best = best.min(segments(&pa[ea.vertices[0].0 as usize],&pa[ea.vertices[1].0 as usize],&pb[eb.vertices[0].0 as usize],&pb[eb.vertices[1].0 as usize]));
    } }
    let estimate = best.to_f64().filter(|x| x.is_finite() && *x > 0.).ok_or_else(|| Refused("distance/observation-range".into()))?.sqrt();
    let (mut lower, mut upper) = (estimate, estimate);
    // Conversion and sqrt each round once. Four neighbouring floats are ample;
    // prove the bracket rather than presuming the bound.
    for _ in 0..4 {
        if &rational(lower)*rational(lower) <= best && &rational(upper)*rational(upper) >= best {
            return Ok(Distance { distance_mm: estimate, lower_mm: lower, upper_mm: upper });
        }
        lower = lower.next_down(); upper = upper.next_up();
    }
    Err(Refused("distance/sqrt-enclosure".into()))
}
