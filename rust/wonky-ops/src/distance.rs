//! Minimum distance of planar solids (including nonconvex regions and face holes). Input geometry remains
//! binary64 + exact frame composition. Transient rationals decide the minimum
//! feature pair, including projection domains, with no epsilon. sqrt is rounded
//! only after the exact minimum squared distance is known, with a checked
//! enclosing pair of binary64 endpoints (never an exact transcendental claim).
use crate::polyhedron::{Audited, Probe, Refused};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
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
/// Certified point distance to an audited convex polyhedron. World point and
/// frame-transformed vertices are exact rationals; only the final sqrt rounds.
/// No inverse placement or approximate inside decision enters topology.
pub fn point_to_convex(a: &Audited, point_mm: [f64;3]) -> Probe {
    let result = (|| -> Result<Probe, Refused> {
        if point_mm.iter().any(|x| !x.is_finite()) { return Err(Refused("distance/probe-range".into())); }
        let vertices=points(a)?;
        convex(a,&vertices)?;
        let point=point_mm.map(rational);
        let reflected=a.frame.reversed().map_err(|_|Refused("distance/frame-range".into()))?;
        let inside=a.face_loops.iter().all(|face| {
            let n=face_normal(face,&vertices);
            let side=dot(&n,&sub(&point,&vertices[face[0]]));
            if reflected {side>=Q::zero()} else {side<=Q::zero()}
        });
        if inside {return Ok(Probe::Measured {distance_mm:0.,inside:true,bound_mm:0.});}
        let mut best: Option<Q>=None;
        for face in &a.face_loops {
            for i in 1..face.len()-1 {
                let d=point_triangle(&point,&vertices[face[0]],&vertices[face[i]],&vertices[face[i+1]]);
                best=Some(best.map_or(d.clone(),|prev|prev.min(d)));
            }
        }
        let best=best.ok_or_else(||Refused("distance/empty-boundary".into()))?;
        if best<=Q::zero() {return Err(Refused("distance/point-on-boundary".into()));}
        let estimate=best.to_f64().filter(|x|x.is_finite()&&*x>0.).ok_or_else(||Refused("distance/observation-range".into()))?.sqrt();
        let (mut lower,mut upper)=(estimate,estimate);
        for _ in 0..8 {
            if &rational(lower)*rational(lower)<=best && &rational(upper)*rational(upper)>=best {
                return Ok(Probe::Measured {distance_mm:estimate,inside:false,bound_mm:(estimate-lower).max(upper-estimate).next_up()});
            }
            lower=lower.next_down();upper=upper.next_up();
        }
        Err(Refused("distance/sqrt-enclosure".into()))
    })();
    result.unwrap_or_else(|e| Probe::Refused(e.0))
}

pub fn between(a: &Audited, b: &Audited) -> Result<Distance, Refused> {
    if a.chamfer.is_some() || b.chamfer.is_some() { return Err(Refused("distance/chamfer-unimplemented".into())); }
    // Audited also admits exact blends. Their trim vertices and chords do not
    // define the solid, so planar triangulation cannot certify their distance.
    if a.body.curves.iter().chain(&b.body.curves).any(|c| !matches!(c.geometry, wonky_contract::CurveGeometry::Line { .. } | wonky_contract::CurveGeometry::ConstructionLine { .. }))
        || a.body.surfaces.iter().chain(&b.body.surfaces).any(|s| !matches!(s.geometry, wonky_contract::SurfaceGeometry::Plane { .. })) {
        return Err(Refused("distance/curved-carrier-unimplemented".into()));
    }
    if a.body.vertices.len() > 128 || b.body.vertices.len() > 128 { return Err(Refused("distance/resource-limit".into())); }
    let pa = points(a)?; let pb = points(b)?;
    let faces = |a: &Audited, ps: &[P]| a.body.faces.iter().map(|f| f.loops.iter().map(|l| a.face_loops[l.0 as usize].iter().map(|&v| ps[v].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()).collect::<Vec<_>>();
    let (fa,fb) = (faces(a,&pa),faces(b,&pb));
    // Convex SAT is a fast path only; an overlapping nonconvex hull is not a
    // collision. Boundary features and exact membership cover arbitrary faces.
    let both_convex = a.body.faces.iter().chain(&b.body.faces).all(|f| f.loops.len() == 1) && convex(a,&pa).is_ok() && convex(b,&pb).is_ok();
    if both_convex {
        let mut apart = a.face_loops.iter().any(|f| separated(&face_normal(f,&pa),&pa,&pb)) || b.face_loops.iter().any(|f| separated(&face_normal(f,&pb),&pa,&pb));
        if !apart { 'outer: for ea in &a.body.edges { for eb in &b.body.edges {
            let edge = |p: &[P], e: &wonky_contract::Edge| sub(&p[e.vertices[1].0 as usize], &p[e.vertices[0].0 as usize]);
            if separated(&cross(&edge(&pa,ea),&edge(&pb,eb)),&pa,&pb) { apart = true; break 'outer; }
        } } }
        if !apart { return Err(Refused("distance/solids-not-strictly-separated".into())); }
    }
    let mut best = dot(&sub(&pa[0],&pb[0]),&sub(&pa[0],&pb[0]));
    for (vertices, faces) in [(&pa,&fb),(&pb,&fa)] {
        for p in vertices { for f in faces { best = best.min(point_region(p,f)?); } }
    }
    for (a,ps,faces) in [(a,&pa,&fb),(b,&pb,&fa)] {
        for e in &a.body.edges {
            let (u,v) = (&ps[e.vertices[0].0 as usize],&ps[e.vertices[1].0 as usize]);
            for f in faces {
                let n = face_normal_loops(f);
                let (du,dv) = (dot(&n,&sub(u,&f[0][0])),dot(&n,&sub(v,&f[0][0])));
                if du != dv {
                    let t = &du/(&du-&dv);
                    if t >= Q::zero() && t <= rational(1.) && region(f,&n,&at(u,&sub(v,u),&t)) != Region::Outside { best = Q::zero(); }
                }
                for lp in f { for i in 0..lp.len() { best = best.min(segments(u,v,&lp[i],&lp[(i+1)%lp.len()])); } }
            }
        }
    }
    if best.is_zero() { return Ok(Distance {distance_mm:0.,lower_mm:0.,upper_mm:0.}); }
    if !both_convex {
        for (p,fs) in [(&pa[0],&fb),(&pb[0],&fa)] {
            if inside_faces(fs,p)? { return Ok(Distance {distance_mm:0.,lower_mm:0.,upper_mm:0.}); }
        }
    }
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

/// Where a point of a face plane lies relative to the face region.
#[derive(PartialEq)]
enum Region { Inside, Boundary, Outside }
fn face_normal_loops(loops: &[Vec<P>]) -> P {
    // Newell sum over every loop: holes run opposite, so this is the
    // area-weighted normal of the region, never zero for a nonempty face.
    let mut n: P = std::array::from_fn(|_| Q::zero());
    for lp in loops {
        for k in 1..lp.len().saturating_sub(1) {
            let c = cross(&sub(&lp[k], &lp[0]), &sub(&lp[k + 1], &lp[0]));
            for j in 0..3 { n[j] += &c[j]; }
        }
    }
    n
}
/// Exact parity over all loops in the plane that drops the normal's largest
/// coordinate; a point on a loop edge is on the boundary.
fn region(loops: &[Vec<P>], n: &P, x: &P) -> Region {
    let k = (0..3).max_by(|&i, &j| n[i].abs().cmp(&n[j].abs())).unwrap();
    let (u, v) = ((k + 1) % 3, (k + 2) % 3);
    let mut odd = false;
    for lp in loops {
        for i in 0..lp.len() {
            let (a, b) = (&lp[i], &lp[(i + 1) % lp.len()]);
            let (eu, ev) = (&b[u] - &a[u], &b[v] - &a[v]);
            let (wu, wv) = (&x[u] - &a[u], &x[v] - &a[v]);
            if (&eu * &wv - &ev * &wu).is_zero() && &wu * &eu + &wv * &ev >= Q::zero()
                && (&x[u] - &b[u]) * &eu + (&x[v] - &b[v]) * &ev <= Q::zero() {
                return Region::Boundary;
            }
            if (a[v] > x[v]) != (b[v] > x[v]) && x[u] < &a[u] + (&x[v] - &a[v]) * &eu / &ev { odd = !odd; }
        }
    }
    if odd { Region::Inside } else { Region::Outside }
}
/// Certified point distance to a closed planar polyhedron given by exact face
/// loops (outer and inner boundaries, world mm). Membership is exact ray
/// parity, retried along another rational direction whenever the ray meets an
/// edge or vertex or runs in a face plane. Outside, the exact squared minimum
/// over faces of the distance to the face region (its plane where the
/// projection falls in the region, else its nearest boundary segment) is
/// rounded once, with a checked sqrt enclosure.
pub(crate) fn point_to_faces(faces: &[Vec<Vec<P>>], point_mm: [f64; 3]) -> Probe {
    let result = (|| -> Result<Probe, Refused> {
        if point_mm.iter().any(|x| !x.is_finite()) { return Err(Refused("distance/probe-range".into())); }
        let p = point_mm.map(rational);
        let normals = faces.iter().map(|f| face_normal_loops(f)).collect::<Vec<_>>();
        if faces.is_empty() || normals.iter().any(|n| dot(n, n).is_zero()) {
            return Err(Refused("distance/degenerate-face".into()));
        }
        let q = |a: i64, b: i64| Q::new(a.into(), b.into());
        let directions: [P; 4] = [
            [q(1, 1), q(1, 3), q(1, 7)], [q(1, 5), q(1, 1), q(1, 11)],
            [q(1, 13), q(1, 17), q(1, 1)], [q(-1, 1), q(1, 19), q(-1, 23)],
        ];
        let mut inside = None;
        'rays: for d in &directions {
            let mut odd = false;
            for (f, n) in faces.iter().zip(&normals) {
                let (nd, np) = (dot(n, d), dot(n, &sub(&f[0][0], &p)));
                if nd.is_zero() {
                    if np.is_zero() { continue 'rays; }
                    continue;
                }
                let t = np / nd;
                if t < Q::zero() { continue; }
                if t.is_zero() {
                    if region(f, n, &p) != Region::Outside { return Ok(Probe::Measured { distance_mm: 0., inside: true, bound_mm: 0. }); }
                    continue;
                }
                match region(f, n, &at(&p, d, &t)) {
                    Region::Inside => odd = !odd,
                    Region::Boundary => continue 'rays,
                    Region::Outside => {}
                }
            }
            inside = Some(odd);
            break;
        }
        match inside {
            None => return Err(Refused("distance/probe-ray-degenerate".into())),
            Some(true) => return Ok(Probe::Measured { distance_mm: 0., inside: true, bound_mm: 0. }),
            Some(false) => {}
        }
        let mut best: Option<Q> = None;
        for (f, n) in faces.iter().zip(&normals) {
            let s = dot(n, &sub(&p, &f[0][0]));
            let nn = dot(n, n);
            let foot = at(&p, n, &(-&s / &nn));
            let d = if region(f, n, &foot) != Region::Outside { &s * &s / nn } else {
                let mut edge: Option<Q> = None;
                for lp in f {
                    for i in 0..lp.len() {
                        let e = point_segment(&p, &lp[i], &lp[(i + 1) % lp.len()]);
                        edge = Some(edge.map_or(e.clone(), |b: Q| b.min(e)));
                    }
                }
                edge.ok_or_else(|| Refused("distance/empty-boundary".into()))?
            };
            best = Some(best.map_or(d.clone(), |b: Q| b.min(d)));
        }
        let best = best.ok_or_else(|| Refused("distance/empty-boundary".into()))?;
        if best <= Q::zero() { return Err(Refused("distance/point-on-boundary".into())); }
        let estimate = best.to_f64().filter(|x| x.is_finite() && *x > 0.).ok_or_else(|| Refused("distance/observation-range".into()))?.sqrt();
        let (mut lower, mut upper) = (estimate, estimate);
        for _ in 0..8 {
            if &rational(lower) * rational(lower) <= best && &rational(upper) * rational(upper) >= best {
                return Ok(Probe::Measured { distance_mm: estimate, inside: false, bound_mm: (estimate - lower).max(upper - estimate).next_up() });
            }
            lower = lower.next_down(); upper = upper.next_up();
        }
        Err(Refused("distance/sqrt-enclosure".into()))
    })();
    result.unwrap_or_else(|e| Probe::Refused(e.0))
}
/// Exact plane arrangements: replayed rational world vertices, face loops as
/// audited. Rounded vertex caches never enter; without the replay it refuses.
pub fn point_to_arrangement(a: &Audited, point_mm: [f64; 3]) -> Probe {
    if a.arrangement.is_none() { return Probe::Refused("planar-boolean/point-distance-unsupported".into()); }
    let faces = points(a).map(|world| a.body.faces.iter().map(|face| face.loops.iter()
        .map(|l| a.face_loops[l.0 as usize].iter().map(|&v| world[v].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()).collect::<Vec<_>>());
    match faces { Ok(faces) => point_to_faces(&faces, point_mm), Err(e) => Probe::Refused(e.0) }
}

fn point_region(p: &P, f: &[Vec<P>]) -> Result<Q, Refused> {
    let n = face_normal_loops(f); let nn = dot(&n,&n);
    if nn.is_zero() { return Err(Refused("distance/degenerate-face".into())); }
    let s = dot(&n,&sub(p,&f[0][0]));
    let foot = at(p,&n,&(-&s/&nn));
    if region(f,&n,&foot) != Region::Outside { return Ok(&s*&s/nn); }
    f.iter().flat_map(|lp| (0..lp.len()).map(move |i| point_segment(p,&lp[i],&lp[(i+1)%lp.len()]))).min().ok_or_else(||Refused("distance/empty-boundary".into()))
}
fn inside_faces(faces: &[Vec<Vec<P>>], p: &P) -> Result<bool, Refused> {
    for k in 1..=32i64 {
        let d = [rational(1.),Q::new(k.into(),37.into()),Q::new((k*k+1).into(),101.into())];
        let mut odd = false; let mut degenerate = false;
        for f in faces {
            let n = face_normal_loops(f); let nd = dot(&n,&d); let np = dot(&n,&sub(&f[0][0],p));
            if nd.is_zero() { if np.is_zero() { degenerate=true;break; } continue; }
            let t = np/nd;
            if t < Q::zero() { continue; }
            match region(f,&n,&at(p,&d,&t)) {
                Region::Inside => { if t.is_zero() {return Ok(true);} odd=!odd; },
                Region::Boundary => {degenerate=true;break;}, Region::Outside => {}
            }
        }
        if !degenerate { return Ok(odd); }
    }
    Err(Refused("distance/probe-ray-degenerate".into()))
}
