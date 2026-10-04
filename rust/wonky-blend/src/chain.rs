//! G1 chain fillets and equal-offset chain chamfers of a planar cap loop on
//! `Model` (fillets3d design §2.4 row "G1 junction inside a chain", §3 rows
//! 1-2 and 5, stage F2): the top or bottom loop of an obround, a rounded
//! rectangle or a slot, after tangent propagation has closed the selection.
//!
//! **Admission.** The selected edges are exactly one loop of a planar face
//! (the cap). Every loop edge is a line with a perpendicular planar wall, or
//! an arc whose wall is a coaxial cylinder perpendicular to the cap.
//! Consecutive edges meet with equal unit tangents (exact; a corner is F4
//! work and refuses `blend/chain-junction-not-tangent`), and each junction
//! owns one wall edge, a line along the cap normal. Every unit vector used
//! below is a rational vector divided by an exact rational length; an
//! irrational length refuses by name.
//!
//! **Construction.** With outward unit normals `n_P` (cap) and `n_W` (wall)
//! and σ = −1 for a convex rim, +1 for a concave one, the ball centre over an
//! edge point `p` is `p + σr(n_P + n_W)`. A line edge gets a cylinder of
//! radius r about the centre line; an arc edge gets a torus with major
//! `ρ0 + σεr` (ε = +1 when the wall faces away from the arc's axis), minor r,
//! a sphere being refused (`blend/partial-sphere-cap-unavailable`). Spring
//! curves are the cap offsets (lines, concentric arcs) and the lowered wall
//! curves; at each junction `V` the blends of both edges share the exact
//! meridian quarter circle of centre `V + σr(n_P + n_W)` in the plane normal
//! to the common tangent. Nothing is rounded; every point is rational. The
//! result passes the full Model audit (charts, senses, orientation, outward
//! ray parity) or the surgery refuses.
//!
//! **Chamfer.** The same springs at offset w (cap offset `p + σw n_W`, wall
//! offset `p + σw n_P`) bound a plane per line edge (normal `n_P + n_W`,
//! the outward side for either convexity) and a partial cone patch per arc
//! edge (rings `ρ0 + σεw` at the cap and `ρ0` at the lowered wall height;
//! slope −ε, so its away-from-axis normal is outward exactly when ε = +1).
//! Neighbouring stripes share the straight generator from the wall spring
//! end to the cap spring end at each junction; a cone patch reaching its
//! apex refuses `blend/partial-cone-apex-unavailable`.
use crate::{refuse, Refusal, Result};
use num_traits::{One, Signed, Zero};
use wonky_curve::{numeric::exact_root, Carrier, ExactPoint, Trimmed};
use wonky_geom::frame::Frame;
use crate::rim::Section;
use wonky_geom::model::{
    curved::Patch, plane_ring_pcurve, Bounds, Carrier3, Circle3, Coedge, CoedgeId, Cone3, Curve, Curve3,
    CurveId, Cylinder3, Edge, EdgeId, Face, FaceId, Loop, LoopId, Model, Plane3, Profile,
    Provenance, Surface, SurfaceId, Torus3, Vertex, VertexDef, VertexId,
};
use wonky_geom::{cross, dot, Point, Q};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn no(s: impl Into<String>) -> Refusal {
    Refusal(s.into())
}
fn add(a: &Point, b: &Point) -> Point {
    std::array::from_fn(|i| &a[i] + &b[i])
}
fn sub(a: &Point, b: &Point) -> Point {
    std::array::from_fn(|i| &a[i] - &b[i])
}
fn scale(a: &Point, k: &Q) -> Point {
    std::array::from_fn(|i| &a[i] * k)
}
fn unit(v: &Point) -> Result<Point> {
    let n = exact_root(&dot(v, v)).ok_or_else(|| no("blend/number-class-exceeded:irrational-unit-length"))?;
    if n.is_zero() {
        return refuse("blend/contract-violation:chain/zero-vector");
    }
    Ok(scale(v, &(Q::one() / n)))
}
fn ep(p: [Q; 2]) -> ExactPoint {
    ExactPoint::from_rational(p)
}
fn line(a: [Q; 2], b: [Q; 2]) -> Result<Trimmed> {
    Trimmed::new([ep(a), ep(b)], Carrier::Line).map_err(|e| no(e.name()))
}

/// Direction of a straight edge with a rational carrier (a rational
/// `RadicalLine` counts); `None` for a circle or an irrational line.
fn line_dir(c: &Curve3) -> Option<Point> {
    match c {
        Curve3::Line { d, .. } => Some(d.clone()),
        Curve3::RadicalLine { d, .. } => wonky_geom::model::algebraic::rational(d),
        Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => None,
    }
}

enum Kind {
    Line { t: Point },
    /// Arc: centre at cap height, radius, wall side ε, azimuth sense about
    /// `n_P` (±1), circle frame columns, unit radial at the start.
    Arc { o: Point, rho: Q, eps: Q, s_dir: Q, columns: [Point; 3], r2: Q, radial: Point },
}
struct Span {
    edge: EdgeId,
    cap_coedge: CoedgeId,
    cap_forward: bool,
    wall: FaceId,
    start: VertexId,
    end: VertexId,
    kind: Kind,
}

/// The carrier chart of a wall or cap face, for re-trimmed pcurves.
fn wall_chart(carrier: &Carrier3, p: &Point) -> Result<[Q; 2]> {
    match carrier {
        Carrier3::Plane(pl) => Ok(pl.chart(p)?),
        Carrier3::Cylinder(c) => {
            let radius = exact_root(&c.radius2()).ok_or_else(|| no("blend/contract-violation:chain/cylinder-radius"))?;
            Profile::Cylinder { radius }
                .chart(Patch::First, Patch::First, &c.frame()?.inverse().point(p))
                .ok_or_else(|| no("blend/contract-violation:chain/wall-chart-pole"))
        }
        _ => refuse("blend/contract-violation:chain/wall-carrier"),
    }
}

/// Constant-radius fillet of a closed G1 cap loop. `node` owns the new
/// entities' provenance.
pub fn chain_fillet(m: &Model, edges: &[EdgeId], radius: &Q, node: u32) -> Result<Model> {
    if !radius.is_positive() {
        return refuse("fillet/invalid-radius");
    }
    chain_blend(m, edges, radius, Section::Fillet, node)
}

/// Equal-offset chamfer of a closed G1 cap loop: both setbacks are `width`,
/// along the cap and along the walls.
pub fn chain_chamfer(m: &Model, edges: &[EdgeId], width: &Q, node: u32) -> Result<Model> {
    if !width.is_positive() {
        return refuse("chamfer/invalid-width");
    }
    chain_blend(m, edges, width, Section::Chamfer, node)
}

/// The chart a blend stripe's pcurves use.
enum Chart {
    Plane(Plane3),
    Revolution { profile: Profile, frame: Frame, pv: Patch },
}

fn chain_blend(m: &Model, edges: &[EdgeId], radius: &Q, section: Section, node: u32) -> Result<Model> {
    let r = radius.clone();
    let d = m.draft();
    let mut selected: Vec<EdgeId> = edges.to_vec();
    selected.sort();
    selected.dedup();
    let loop_edges = |l: LoopId| -> Vec<EdgeId> {
        let mut v: Vec<EdgeId> = d.loops[l.index()].coedges.iter().map(|c| d.coedges[c.index()].edge).collect();
        v.sort();
        v
    };
    // The cap: the one planar face loop made of exactly the selection.
    let mut caps = vec![];
    for (fi, f) in d.faces.iter().enumerate() {
        if !matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Plane(_)) {
            continue;
        }
        for &l in &f.loops {
            if loop_edges(l) == selected {
                caps.push((FaceId(fi as u32), l));
            }
        }
    }
    let (cap, cap_loop) = match caps[..] {
        [one] => one,
        [] => return refuse("blend/chain-not-a-face-loop"),
        _ => return refuse("blend/chain-ambiguous-cap"),
    };
    let coedges = d.loops[cap_loop.index()].coedges.clone();
    if coedges.len() < 2 {
        return refuse("blend/chain-requires-two-edges");
    }
    let cap_face = &d.faces[cap.index()];
    let Carrier3::Plane(plane) = &d.surfaces[cap_face.surface.index()].carrier else { unreachable!() };
    let n_p = scale(&unit(&plane.n)?, &if cap_face.forward { q(1) } else { q(-1) });
    let point = |v: VertexId| -> Result<Point> { Ok(d.vertices[v.index()].def.key()?.rational()?.clone()) };
    let parallel = |a: &Point, b: &Point| cross(a, b).iter().all(Q::is_zero);

    // Spans in cap traversal order, with the convexity sign σ.
    let mut spans = vec![];
    let mut sigma: Option<Q> = None;
    for &c in &coedges {
        let co = &d.coedges[c.index()];
        let e = co.edge;
        let Bounds::Segment([a, b]) = d.edges[e.index()].bounds else {
            return refuse("blend/chain-ring-edge");
        };
        let (start, end) = if co.forward { (a, b) } else { (b, a) };
        let mut walls = vec![];
        for (fi, f) in d.faces.iter().enumerate() {
            for &l in &f.loops {
                for &c2 in &d.loops[l.index()].coedges {
                    if c2 != c && d.coedges[c2.index()].edge == e {
                        walls.push(FaceId(fi as u32));
                    }
                }
            }
        }
        let [wall] = walls[..] else { return refuse("blend/contract-violation:chain/edge-uses") };
        let wf = &d.faces[wall.index()];
        let wall_sign = if wf.forward { q(1) } else { q(-1) };
        let (ps, pe) = (point(start)?, point(end)?);
        let curve = &d.curves[d.edges[e.index()].curve.index()].geometry;
        let (kind, n_w_start, t_start) = match (curve, line_dir(curve), &d.surfaces[wf.surface.index()].carrier) {
            (_, Some(dir), Carrier3::Plane(wp)) => {
                let dir = &dir;
                let t = unit(&sub(&pe, &ps))?;
                let n_w = scale(&unit(&wp.n)?, &wall_sign);
                if !parallel(&t, dir) || !dot(&n_w, &n_p).is_zero() || !dot(&n_w, &t).is_zero() {
                    return refuse("blend/spine-not-analytic:plane-oblique×plane/chain");
                }
                (Kind::Line { t: t.clone() }, n_w, t)
            }
            (Curve3::Circle(circle), _, Carrier3::Cylinder(cy)) => {
                if !circle.frame()?.is_isometry() {
                    return refuse("blend/rim-frame-not-isometric");
                }
                let cols = circle.frame()?.columns().clone();
                let n_c = cross(&cols[0], &cols[1]);
                if !parallel(&n_c, &n_p) || !parallel(&cy.frame()?.columns()[2], &n_p) {
                    return refuse("blend/spine-not-analytic:plane-oblique×cylinder/chain");
                }
                let o = circle.frame()?.origin().clone();
                let axis_offset = sub(&o, cy.frame()?.origin());
                if !parallel(&axis_offset, &n_p) {
                    return refuse("blend/contract-violation:chain/arc-not-coaxial");
                }
                let rho = exact_root(&circle.radius2()).ok_or_else(|| no("blend/contract-violation:chain/arc-radius"))?;
                if circle.radius2() != cy.radius2() * dot(&cy.frame()?.columns()[0], &cy.frame()?.columns()[0]) {
                    return refuse("blend/contract-violation:chain/arc-not-on-wall");
                }
                let radial = scale(&sub(&ps, &o), &(Q::one() / &rho));
                let along = if co.forward { q(1) } else { q(-1) };
                let t = scale(&cross(&n_c, &radial), &along);
                let s_dir = if (dot(&n_c, &n_p) * &along).is_positive() { q(1) } else { q(-1) };
                let n_w = scale(&radial, &wall_sign);
                (
                    Kind::Arc { o, rho, eps: wall_sign, s_dir, columns: cols, r2: circle.radius2(), radial },
                    n_w,
                    t,
                )
            }
            _ => {
                return refuse("blend/spine-not-analytic:chain-edge");
            }
        };
        let left = cross(&n_p, &t_start);
        let s = if left == scale(&n_w_start, &q(-1)) {
            q(-1)
        } else if left == n_w_start {
            q(1)
        } else {
            return refuse("blend/spine-not-analytic:non-perpendicular-wall/chain");
        };
        match &sigma {
            None => sigma = Some(s),
            Some(x) if *x != s => return refuse("blend/chain-mixed-convexity"),
            Some(_) => {}
        }
        if wf.loops.len() != 1 || d.loops[wf.loops[0].index()].coedges.len() != 4 {
            return refuse("blend/chain-wall-not-a-strip");
        }
        spans.push(Span { edge: e, cap_coedge: c, cap_forward: co.forward, wall, start, end, kind });
    }
    let sigma = sigma.expect("non-empty chain");
    let n = spans.len();
    // Unit tangent and wall normal of a span at one of its ends.
    let frame_at = |s: &Span, v: &Point| -> (Point, Point) {
        match &s.kind {
            Kind::Line { t } => {
                let wf = &d.faces[s.wall.index()];
                let Carrier3::Plane(wp) = &d.surfaces[wf.surface.index()].carrier else { unreachable!() };
                let sign = if wf.forward { q(1) } else { q(-1) };
                (t.clone(), scale(&unit(&wp.n).expect("checked unit"), &sign))
            }
            Kind::Arc { o, rho, eps, s_dir, .. } => {
                let radial = scale(&sub(v, o), &(Q::one() / rho));
                (scale(&cross(&n_p, &radial), s_dir), scale(&radial, eps))
            }
        }
    };
    // Junctions: V_k is the start of span k and the end of span k-1.
    struct Junction {
        v: VertexId,
        n_w: Point,
        at_cap: Point,
        at_wall: Point,
        centre: Point,
    }
    let mut junctions = vec![];
    for k in 0..n {
        let prev = &spans[(k + n - 1) % n];
        let s = &spans[k];
        if prev.end != s.start {
            return refuse("blend/contract-violation:chain/loop-order");
        }
        let v = point(s.start)?;
        let (t_in, n_in) = frame_at(prev, &v);
        let (t_out, n_out) = frame_at(s, &v);
        if t_in != t_out {
            return refuse("blend/chain-junction-not-tangent");
        }
        if n_in != n_out {
            return refuse("blend/contract-violation:chain/wall-normals");
        }
        // The one wall edge at the junction: a line along n_P whose far end
        // stays beyond the lowered spring.
        let mut others = vec![];
        for (ei, e) in d.edges.iter().enumerate() {
            let id = EdgeId(ei as u32);
            if id == prev.edge || id == s.edge {
                continue;
            }
            if let Bounds::Segment([a, b]) = e.bounds {
                if a == s.start || b == s.start {
                    others.push((id, if a == s.start { b } else { a }));
                }
            }
        }
        let [(wall_edge, far)] = others[..] else { return refuse("blend/chain-junction-without-wall-edge") };
        let Some(dir) = line_dir(&d.curves[d.edges[wall_edge.index()].curve.index()].geometry) else {
            return refuse("blend/chain-junction-wall-edge-not-a-line");
        };
        if !parallel(&dir, &n_p) {
            return refuse("blend/chain-junction-wall-edge-oblique");
        }
        if dot(&sub(&point(far)?, &v), &scale(&n_p, &sigma)) <= r {
            return refuse(&format!("blend/overflow:wall-consumed(edge{})", wall_edge.0));
        }
        junctions.push(Junction {
            v: s.start,
            at_cap: add(&v, &scale(&n_out, &(&sigma * &r))),
            at_wall: add(&v, &scale(&n_p, &(&sigma * &r))),
            centre: add(&v, &scale(&add(&n_p, &n_out), &(&sigma * &r))),
            n_w: n_out,
        });
    }
    // Planted F2c negative: the chamfer offsets rounded to binary64 before
    // the spring incidence (the family path's carrier rule).
    #[cfg(feature = "plant_chamfer_offset_binary64")]
    if matches!(section, Section::Chamfer) {
        let round = |p: &Point| -> Point { p.clone().map(|x| Q::from_float(num_traits::ToPrimitive::to_f64(&x).expect("finite")).expect("finite")) };
        for j in &mut junctions {
            j.at_cap = round(&j.at_cap);
            j.at_wall = round(&j.at_wall);
        }
    }

    let mut out = m.clone().into_draft();
    let mut slot = 0u32;
    let mut prov = || {
        slot += 1;
        Provenance { node, slot: slot - 1 }
    };
    // Vertices: the junction slot becomes the wall spring end; the cap end
    // is appended.
    let mut cap_v = vec![];
    for j in &junctions {
        out.vertices[j.v.index()] = Vertex { def: VertexDef::Rational(j.at_wall.clone()), provenance: prov() };
        cap_v.push(VertexId(out.vertices.len() as u32));
        out.vertices.push(Vertex { def: VertexDef::Rational(j.at_cap.clone()), provenance: prov() });
    }
    // Junction meridians from the wall end to the cap end: quarter circles
    // of a fillet, straight generators of a chamfer.
    let mut meridians = vec![];
    for (k, j) in junctions.iter().enumerate() {
        let geometry = match section {
            Section::Fillet => {
                let x = scale(&j.n_w, &-sigma.clone());
                let y = scale(&n_p, &-sigma.clone());
                let frame = Frame::new(j.centre.clone(), [x.clone(), y.clone(), cross(&x, &y)])?;
                Curve3::Circle(Circle3::new(frame, &r * &r)?)
            }
            Section::Chamfer => Curve3::Line { p: j.at_wall.clone(), d: sub(&j.at_cap, &j.at_wall) },
        };
        let curve = CurveId(out.curves.len() as u32);
        out.curves.push(Curve { geometry, provenance: prov() });
        meridians.push(EdgeId(out.edges.len() as u32));
        out.edges.push(Edge { curve, bounds: Bounds::Segment([j.v, cap_v[k]]), provenance: prov() });
    }
    let shell = out
        .shells
        .iter()
        .position(|s| s.faces.contains(&cap))
        .ok_or_else(|| no("blend/contract-violation:chain/shell"))?;
    for (k, s) in spans.iter().enumerate() {
        let (j0, j1) = (&junctions[k], &junctions[(k + 1) % n]);
        let (c0, c1) = (cap_v[k], cap_v[(k + 1) % n]);
        // Cap spring and wall spring curves; blend carrier and chart.
        let (cap_curve, wall_curve, carrier, chart_of) = match (&s.kind, section) {
            (Kind::Line { t }, Section::Chamfer) => {
                let normal = add(&n_p, &j0.n_w);
                (
                    Curve3::Line { p: j0.at_cap.clone(), d: t.clone() },
                    Curve3::Line { p: j0.at_wall.clone(), d: t.clone() },
                    Carrier3::Plane(Plane3 { o: j0.at_cap.clone(), x: t.clone(), n: normal.clone() }),
                    Chart::Plane(Plane3 { o: j0.at_cap.clone(), x: t.clone(), n: normal }),
                )
            }
            (Kind::Arc { o, rho, eps, s_dir, columns, r2, radial }, Section::Chamfer) => {
                let cap_rho = rho + &sigma * eps * &r;
                if cap_rho.is_zero() {
                    return refuse("blend/partial-cone-apex-unavailable");
                }
                if cap_rho.is_negative() {
                    return Err(no(format!("blend/width-exceeds-rim({},{})", r, rho)));
                }
                let nd = scale(&n_p, s_dir);
                let cap_frame = Frame::new(o.clone(), [radial.clone(), cross(&nd, radial), nd])?;
                let wall_frame = Frame::new(add(o, &scale(&n_p, &(&sigma * &r))), columns.clone())?;
                let x = scale(&cross(&n_p, radial), s_dir);
                let frame = Frame::new(o.clone(), [x.clone(), cross(&n_p, &x), n_p.clone()])?;
                // Rings (local height, radius), lower first.
                let mut rings = [(Q::zero(), cap_rho.clone()), (&sigma * &r, rho.clone())];
                if rings[1].0 < rings[0].0 {
                    rings.swap(0, 1);
                }
                let cone = Cone3::new(frame.clone(), rings)?;
                let [radius, slope] = cone.meridian()?;
                (
                    Curve3::Circle(Circle3::new(cap_frame, &cap_rho * &cap_rho)?),
                    Curve3::Circle(Circle3::new(wall_frame, r2.clone())?),
                    Carrier3::Cone(cone),
                    Chart::Revolution { profile: Profile::Cone { radius, slope }, frame, pv: Patch::First },
                )
            }
            (Kind::Line { t }, Section::Fillet) => {
                let x = scale(&j0.n_w, &-sigma.clone());
                let frame = Frame::new(j0.centre.clone(), [x.clone(), cross(t, &x), t.clone()])?;
                (
                    Curve3::Line { p: j0.at_cap.clone(), d: t.clone() },
                    Curve3::Line { p: j0.at_wall.clone(), d: t.clone() },
                    Carrier3::Cylinder(Cylinder3::new(frame.clone(), &r * &r)?),
                    Chart::Revolution { profile: Profile::Cylinder { radius: r.clone() }, frame, pv: Patch::First },
                )
            }
            (Kind::Arc { o, rho, eps, s_dir, columns, r2, radial }, Section::Fillet) => {
                let major = rho + &sigma * eps * &r;
                if major.is_zero() {
                    return refuse("blend/partial-sphere-cap-unavailable");
                }
                if major.is_negative() {
                    return Err(no(format!("blend/radius-exceeds-rim({},{})", r, rho)));
                }
                let nd = scale(&n_p, s_dir);
                let cap_frame = Frame::new(o.clone(), [radial.clone(), cross(&nd, radial), nd])?;
                let wall_frame = Frame::new(add(o, &scale(&n_p, &(&sigma * &r))), columns.clone())?;
                let x = scale(&cross(&n_p, radial), s_dir);
                let frame = Frame::new(add(o, &scale(&n_p, &(&sigma * &r))), [x.clone(), cross(&n_p, &x), n_p.clone()])?;
                let pv = if (&sigma * eps) == q(-1) { Patch::First } else { Patch::Second };
                (
                    Curve3::Circle(Circle3::new(cap_frame, &major * &major)?),
                    Curve3::Circle(Circle3::new(wall_frame, r2.clone())?),
                    Carrier3::Torus(Torus3::new(frame.clone(), major.clone(), r.clone())?),
                    Chart::Revolution { profile: Profile::Torus { major, minor: r.clone() }, frame, pv },
                )
            }
        };
        // Cap: the spring replaces the selected edge in the cap loop.
        let cap_edge = EdgeId(out.edges.len() as u32);
        let cc = CurveId(out.curves.len() as u32);
        let cap_pcurve = {
            let (a, b) = (plane.chart(&j0.at_cap)?, plane.chart(&j1.at_cap)?);
            match &cap_curve {
                Curve3::Circle(circle) => plane_ring_pcurve(circle, plane, true)?
                    .trim(ep(a), ep(b))
                    .map_err(|e| no(e.name()))?,
                _ => line(a, b)?,
            }
        };
        out.curves.push(Curve { geometry: cap_curve, provenance: prov() });
        out.edges.push(Edge { curve: cc, bounds: Bounds::Segment([c0, c1]), provenance: prov() });
        out.coedges[s.cap_coedge.index()] =
            Coedge { edge: cap_edge, forward: true, pcurve: cap_pcurve, atlas: None, provenance: prov() };
        // Wall: the selected edge slot becomes the lowered spring.
        let ec = d.edges[s.edge.index()].curve;
        out.curves[ec.index()] = Curve { geometry: wall_curve, provenance: prov() };
        // Re-trim every wall pcurve whose vertices moved.
        for wall in [s.wall] {
            let wf = &d.faces[wall.index()];
            let carrier = d.surfaces[wf.surface.index()].carrier.clone();
            for &c in &d.loops[wf.loops[0].index()].coedges {
                let co = &out.coedges[c.index()];
                let Bounds::Segment(v) = out.edges[co.edge.index()].bounds else {
                    return refuse("blend/chain-wall-not-a-strip");
                };
                let [a, b] = if co.forward { v } else { [v[1], v[0]] };
                let pa = out.vertices[a.index()].def.key()?.rational()?.clone();
                let pb = out.vertices[b.index()].def.key()?.rational()?.clone();
                let pcurve = line(wall_chart(&carrier, &pa)?, wall_chart(&carrier, &pb)?)?;
                out.coedges[c.index()].pcurve = pcurve;
            }
        }
        // The blend face: cap spring back, meridian down, wall spring
        // forward (the cap's old sense), next meridian up.
        let chart = |p: &Point| -> Result<[Q; 2]> {
            match &chart_of {
                Chart::Plane(plane) => Ok(plane.chart(p)?),
                Chart::Revolution { profile, frame, pv } => profile
                    .chart(Patch::First, *pv, &frame.inverse().point(p))
                    .ok_or_else(|| no("blend/contract-violation:chain/blend-chart")),
            }
        };
        let corners = [
            (cap_edge, false, &j1.at_cap, &j0.at_cap),
            (meridians[k], false, &j0.at_cap, &j0.at_wall),
            (s.edge, s.cap_forward, &j0.at_wall, &j1.at_wall),
            (meridians[(k + 1) % n], true, &j1.at_wall, &j1.at_cap),
        ];
        let mut ids = vec![];
        for (edge, forward, a, b) in corners {
            let pcurve = line(chart(a)?, chart(b)?)?;
            ids.push(CoedgeId(out.coedges.len() as u32));
            out.coedges.push(Coedge { edge, forward, pcurve, atlas: None, provenance: prov() });
        }
        let lp = LoopId(out.loops.len() as u32);
        out.loops.push(Loop { coedges: ids, provenance: prov() });
        let surface = SurfaceId(out.surfaces.len() as u32);
        out.surfaces.push(Surface { carrier, provenance: prov() });
        let face = FaceId(out.faces.len() as u32);
        // A tube's normal points out of the ball (outward when convex); a
        // chamfer plane's is outward; a chamfer cone's points off the axis.
        let forward = match (&s.kind, section) {
            (_, Section::Fillet) => sigma.is_negative(),
            (Kind::Line { .. }, Section::Chamfer) => true,
            (Kind::Arc { eps, .. }, Section::Chamfer) => eps.is_positive(),
        };
        out.faces.push(Face { surface, forward, loops: vec![lp], provenance: prov() });
        out.shells[shell].faces.push(face);
    }
    out.check().map_err(|e| {
        if e.0.starts_with("model/g6") || e.0.starts_with("model/g7") {
            no(format!("blend/overflow:cap-face({})", e.0))
        } else {
            no(format!("blend/contract-violation:chain/{}", e.0))
        }
    })
}
