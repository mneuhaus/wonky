//! Full-turn polygon revolutions as cutters of the prism-holes family.
//!
//! Rule P in its simplest exact form: the revolution axis must map onto the
//! target's extrusion axis through a proved isometry, so every target cap is
//! a plane perpendicular to the axis at an exact level in the tool's own
//! metric. The tool meridian is clipped to the target slab with rationals;
//! the clipped meridian's rings on the cap levels open the caps (circular
//! inner loops), its other faces become the reversed hole walls (cylinders,
//! meridian cones, annular steps, floors and drill-point apexes).
//!
//! Named refusals, never a snap: non-isometric frames, tilted axes, section
//! radii or levels that binary64 cannot store, walls touching the side of the
//! target, contact between holes, cavities, annular cap sections and point or
//! ring contact with a cap.
use crate::{
    affine::Affine,
    arc_profile::{dot, q, sub},
    construction_geom,
    polyhedron::Refused,
    prism_holes::{b, base_caps, exact_float, no, Base, RevolvedTool, R},
    revolve_full::{self, local},
    cylinder::Spec,
};
use num_rational::BigRational as Q;
use num_traits::{One, Signed, Zero};
use wonky_contract::*;
use wonky_num::{Iv, Scalar};

/// One revolved hole in target source coordinates.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MeridianHole {
    /// Target extrusion axis (also the FullRevolve mode of `points`).
    pub(crate) axis: usize,
    /// Axis position; `centre[axis]` is zero.
    pub(crate) centre: [f64; 3],
    /// Canonical clipped meridian (radius, absolute axial level), in the
    /// vertex order of the revolution builder, CCW.
    pub(crate) points: Vec<[f64; 2]>,
    /// Which target cap levels the meridian opens.
    pub(crate) open: [bool; 2],
    pub(crate) levels: [f64; 2],
}

fn segments(points: &[[f64; 2]]) -> Vec<[f64; 4]> {
    (0..points.len())
        .map(|i| {
            let (a, c) = (points[i], points[(i + 1) % points.len()]);
            [a[0], a[1], c[0], c[1]]
        })
        .collect()
}

/// Replay a plain source revolution from its own interpreter record.
pub(crate) fn rebuild_tool(
    key: BodyKey,
    frames: &[Frame],
    nodes: &[Construction],
    frame: Affine,
) -> R<Body> {
    let bad = || no("revolved-source");
    if nodes.len() != 2 || frames.len() != 2 {
        return Err(bad());
    }
    let p = nodes[0].parameters.iter().map(|v| v.get()).collect::<Vec<_>>();
    if p.len() < 16 || p.len() % 2 != 0 || ![0., 1., 2.].contains(&p[0]) {
        return Err(bad());
    }
    if [p[1], p[2], p[3]] != frame.origin || [p[4], p[5], p[6]] != frame.x || [p[7], p[8], p[9]] != frame.z {
        return Err(bad());
    }
    let Some(Frame::Source { source }) = frames.first() else {
        return Err(no("source-frame"));
    };
    let points = p[10..].chunks_exact(2).map(|c| [c[0], c[1]]).collect::<Vec<_>>();
    revolve_full::build(key, *source, frame, p[0] as usize, &segments(&points), std::f64::consts::TAU)
}

fn clip_half(poly: &[[Q; 2]], level: &Q, above: bool) -> Vec<[Q; 2]> {
    let inside = |p: &[Q; 2]| if above { p[1] >= *level } else { p[1] <= *level };
    let mut out = vec![];
    for i in 0..poly.len() {
        let (a, c) = (&poly[i], &poly[(i + 1) % poly.len()]);
        if inside(a) {
            out.push(a.clone());
        }
        if inside(a) != inside(c) {
            let t = (level - &a[1]) / (&c[1] - &a[1]);
            out.push([&a[0] + &t * (&c[0] - &a[0]), level.clone()]);
        }
    }
    out
}

/// Drop repeated vertices and straight-through collinear vertices. A
/// reversal (two clipped pieces joined along a cap line) is refused.
fn clean(mut p: Vec<[Q; 2]>) -> R<Vec<[Q; 2]>> {
    loop {
        let n = p.len();
        if n < 3 {
            return Ok(vec![]);
        }
        let mut removed = false;
        for i in 0..n {
            let (a, m, c) = (&p[(i + n - 1) % n], &p[i], &p[(i + 1) % n]);
            if a == m || m == c {
                p.remove(i);
                removed = true;
                break;
            }
            let (u, w) = (sub(m, a), sub(c, m));
            let turn = &u[0] * &w[1] - &u[1] * &w[0];
            if turn.is_zero() && dot(&u, &w) > Q::zero() {
                p.remove(i);
                removed = true;
                break;
            }
            if turn.is_zero() {
                return Err(no("revolved-tool-multiple-slab-sections"));
            }
        }
        if !removed {
            return Ok(p);
        }
    }
}

fn meridian(
    key: &BodyKey,
    tool: &RevolvedTool,
    target: &wonky_geom::frame::Frame,
    axis: usize,
    levels: [f64; 2],
) -> R<Option<MeridianHole>> {
    let relation = target.relation_from(&construction_geom::frame(&tool.placement)?);
    relation.require_isometry().map_err(|e| Refused(e.0.into()))?;
    let rev = &tool.rev;
    let geom = |p: [f64; 3]| wonky_geom::point(p).map_err(|e| Refused(e.0.into()));
    let direction = relation.map.vector(&geom(local(rev.mode, 0., 0., 1.))?);
    if (0..3).any(|k| (k == axis) == direction[k].is_zero()) || !direction[axis].abs().is_one() {
        return Err(no("non-axial-cut"));
    }
    let sigma = direction[axis].clone();
    let origin = relation.map.point(&wonky_geom::zero());
    let mut centre = [0.; 3];
    for k in (0..3).filter(|&k| k != axis) {
        centre[k] = exact_float(&origin[k])?;
    }
    let mut poly = rev
        .points
        .iter()
        .map(|p| [q(p[0]), &origin[axis] + &sigma * q(p[1])])
        .collect::<Vec<_>>();
    if sigma.is_negative() {
        // The axial reflection reverses the meridian orientation.
        poly.reverse();
    }
    let (l0, l1) = (q(levels[0]), q(levels[1]));
    let poly = clean(clip_half(&clip_half(&poly, &l0, true), &l1, false))?;
    if poly.is_empty() {
        return Ok(None);
    }
    let n = poly.len();
    if !(0..n).any(|i| poly[i][0].is_zero() && poly[(i + 1) % n][0].is_zero()) {
        return Err(no("annular-revolved-tool"));
    }
    let mut open = [false; 2];
    for (side, level) in [(0, &l0), (1, &l1)] {
        let on = (0..n)
            .filter(|&i| poly[i][1] == *level && poly[(i + 1) % n][1] == *level)
            .collect::<Vec<_>>();
        match on.as_slice() {
            [] => {}
            [i] => {
                let (a, c) = (&poly[*i][0], &poly[(i + 1) % n][0]);
                if a.is_zero() == c.is_zero() {
                    return Err(no("annular-cap-section"));
                }
                open[side] = true;
            }
            _ => return Err(no("multiple-cap-sections")),
        }
        // A vertex on a cap level that no cap-level edge owns is point or
        // ring contact with the cap: a non-manifold result, not a hole.
        if (0..n).any(|i| poly[i][1] == *level && !on.iter().any(|&e| e == i || (e + 1) % n == i)) {
            return Err(no("cap-contact"));
        }
    }
    if !open[0] && !open[1] {
        return Err(no("enclosed-cavity"));
    }
    let points = poly
        .iter()
        .map(|p| {
            let f = |x: &Q| exact_float(x).map_err(|_| no("non-binary64-meridian-section"));
            Ok([f(&p[0])?, f(&p[1])?])
        })
        .collect::<R<Vec<_>>>()?;
    // The revolution builder is the only owner of meridian topology; its
    // canonical vertex order fixes face order for sewing and observation.
    let body = revolve_full::build(key.clone(), [0; 4], Affine::IDENTITY, axis, &segments(&points), std::f64::consts::TAU)?;
    let canonical = revolve_full::audit(&body.check().map_err(|_| no("revolved-hole-contract"))?)?;
    Ok(Some(MeridianHole { axis, centre, points: canonical.points, open, levels }))
}

fn radius(h: &MeridianHole) -> f64 {
    h.points.iter().map(|p| p[0]).fold(0., f64::max)
}
fn chart_centre(axis: usize, c: [f64; 3]) -> [Q; 2] {
    [q(c[(axis + 1) % 3]), q(c[(axis + 2) % 3])]
}

pub(crate) fn classify(base: &Base, tools: &[RevolvedTool], cylinders: &[Spec]) -> R<Vec<MeridianHole>> {
    if tools.is_empty() {
        return Ok(vec![]);
    }
    if let Base::Planar(a) = base {
        if a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() > 1) {
            return Err(no("revolved-tool-cells-unimplemented"));
        }
    }
    let (axis, levels) = base.axis_levels()?;
    let profile = base.profile();
    let target = construction_geom::frame(base.frame())?;
    let mut out: Vec<MeridianHole> = vec![];
    for tool in tools {
        let Some(hole) = meridian(&base.body().key, tool, &target, axis, levels)? else {
            continue;
        };
        let c = chart_centre(axis, hole.centre);
        let r = q(radius(&hole));
        let r2 = &r * &r;
        match (base, &profile) {
            (_, Some(p)) => {
                if !p.contains(&wonky_curve::ExactPoint::from_rational(c.clone()))?
                    || !p.profile.clears_disc(&c, &r2)?
                {
                    return Err(no("side-contact-or-crossing"));
                }
            }
            (Base::Cylinder(cyl), None) => {
                let d = sub(&c, &chart_centre(axis, cyl.spec.bottom));
                let gap = q(cyl.spec.radius) - &r;
                if gap <= Q::zero() || dot(&d, &d) >= &gap * &gap {
                    return Err(no("side-contact-or-crossing"));
                }
            }
            _ => return Err(no("target-carrier")),
        }
        // Strictly separated axis discs: no shared wall, rim or floor.
        let apart = |centre: [Q; 2], other: Q| {
            let d = sub(&c, &centre);
            dot(&d, &d) > (&r + &other) * (&r + &other)
        };
        if cylinders.iter().any(|s| !apart(chart_centre(axis, s.bottom), q(s.radius)))
            || out.iter().any(|h| !apart(chart_centre(axis, h.centre), q(radius(h))))
        {
            return Err(no("holes-contact-or-overlap"));
        }
        out.push(hole);
    }
    Ok(out)
}

/// Union of connected coaxial closed discs swept along an axis. All event
/// levels and radii are source binary64 rationals: ordering and max selection
/// need no rounding or tolerance. Reuse the exact revolution owner for the
/// stepped boundary; never sew the overlapping input floors/walls.
pub(crate) fn coaxial_union(base: &Base, mut holes: Vec<Spec>) -> R<(Vec<Spec>, Vec<MeridianHole>)> {
    let (axis, levels) = base.axis_levels()?;
    let mut simple = vec![];
    let mut merged = vec![];
    while let Some(seed) = holes.pop() {
        let mut group = vec![seed];
        loop {
            let at = holes.iter().position(|s| group.iter().any(|h|
                (0..3).filter(|&k| k != axis).all(|k| s.bottom[k] == h.bottom[k])
                && s.bottom[axis] <= h.top[axis] && h.bottom[axis] <= s.top[axis]));
            let Some(at) = at else { break };
            group.push(holes.remove(at));
        }
        if group.len() == 1 {
            simple.push(seed);
            continue;
        }
        if let Base::Planar(a) = base {
            if a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() > 1) {
                return Err(no("coaxial-tool-cells-unimplemented"));
            }
        }
        let mut events = group.iter().flat_map(|s| [s.bottom[axis], s.top[axis]]).collect::<Vec<_>>();
        events.sort_by(f64::total_cmp);
        events.dedup();
        let mut points = vec![[0., events[0]]];
        let mut previous = 0.;
        for span in events.windows(2) {
            let radius = group.iter().filter(|s| s.bottom[axis] <= span[0] && s.top[axis] >= span[1])
                .map(|s| s.radius).fold(0., f64::max);
            if radius == 0. { return Err(no("coaxial-tool-section-gap")); }
            if radius != previous {
                points.push([radius, span[0]]);
            } else {
                points.pop(); // remove a straight-through event vertex
            }
            points.push([radius, span[1]]);
            previous = radius;
        }
        let last = *events.last().unwrap();
        points.push([0., last]);
        let body = revolve_full::build(base.body().key.clone(), [0; 4], Affine::IDENTITY,
            axis, &segments(&points), std::f64::consts::TAU)?;
        let canonical = revolve_full::audit(&body.check().map_err(|_| no("coaxial-hole-contract"))?)?;
        let mut centre = seed.bottom;
        centre[axis] = 0.;
        merged.push(MeridianHole { axis, centre, points: canonical.points,
            open: [events[0] == levels[0], last == levels[1]], levels });
    }
    // Preserve the old disjoint-cylinder order (including replay face order).
    simple.reverse();
    merged.reverse();
    Ok((simple, merged))
}

pub(crate) fn require_separated(a: &[MeridianHole], b: &[MeridianHole]) -> R<()> {
    for h in a {
        for other in b {
            let d = sub(&chart_centre(h.axis, h.centre), &chart_centre(other.axis, other.centre));
            let sum = q(radius(h)) + q(radius(other));
            if dot(&d, &d) <= &sum * &sum { return Err(no("holes-contact-or-overlap")); }
        }
    }
    Ok(())
}

pub(crate) fn caps(base: &Base, holes: &[MeridianHole]) -> R<Vec<[Option<usize>; 2]>> {
    if holes.is_empty() {
        return Ok(vec![]);
    }
    let c = base_caps(base)?;
    Ok(holes.iter().map(|h| [h.open[0].then_some(c[0]), h.open[1].then_some(c[1])]).collect())
}

fn plus(p: &Vector3, c: [f64; 3]) -> R<Vector3> {
    // Revolution origins have zero radial components, so each sum is exact.
    let mut out = [0.; 3];
    for k in 0..3 {
        let v = p[k].get();
        if v != 0. && c[k] != 0. {
            return Err(no("revolved-hole-origin"));
        }
        out[k] = v + c[k];
    }
    Ok([b(out[0])?, b(out[1])?, b(out[2])?])
}

/// Reversed hole walls of the clipped revolution, translated to the hole
/// axis; opening disks become circular inner loops of the target caps.
pub(crate) fn sew(body: &mut Body, hole: &MeridianHole, cap: [Option<usize>; 2], prov: &Provenance) -> R<()> {
    let h = revolve_full::build(
        body.key.clone(),
        [0; 4],
        Affine::IDENTITY,
        hole.axis,
        &segments(&hole.points),
        std::f64::consts::TAU,
    )?;
    let axis = local(hole.axis, 0., 0., 1.);
    let fo = FrameId(body.frames.len() as u32);
    body.frames.push(Frame::Rigid {
        parent: FrameId(1),
        translation: [b(hole.centre[0])?, b(hole.centre[1])?, b(hole.centre[2])?],
        axis: [b(axis[0])?, b(axis[1])?, b(axis[2])?],
        angle: b(0.)?,
    });
    let (vo, co, eo) = (body.vertices.len() as u32, body.curves.len() as u32, body.edges.len() as u32);
    // Opening faces: planar disks on an opened cap level.
    let opening = h
        .faces
        .iter()
        .map(|f| match &h.surfaces[f.surface.0 as usize].geometry {
            SurfaceGeometry::Plane { origin, .. } => {
                let level = origin[hole.axis].get();
                (0..2).find(|&s| hole.open[s] && level == hole.levels[s])
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    for v in &h.vertices {
        body.vertices.push(Vertex { point: v.point, frame: fo, provenance: Provenance::None {} });
    }
    for c in &h.curves {
        let CurveGeometry::Circle { origin, normal, x, radius, arc } = &c.geometry else {
            return Err(no("revolved-hole-curve"));
        };
        body.curves.push(Curve {
            frame: FrameId(1),
            provenance: prov.clone(),
            geometry: CurveGeometry::Circle {
                origin: plus(origin, hole.centre)?,
                normal: *normal,
                x: *x,
                radius: *radius,
                arc: arc.clone(),
            },
            domain: c.domain.clone(),
            supports: vec![],
        });
    }
    for e in &h.edges {
        body.edges.push(Edge {
            curve: CurveId(e.curve.0 + co),
            domain: e.domain.clone(),
            vertices: e.vertices.iter().map(|v| VertexId(v.0 + vo)).collect(),
        });
    }
    for (fi, f) in h.faces.iter().enumerate() {
        let target_face = match opening[fi] {
            Some(side) => Some(cap[side].ok_or_else(|| no("missing-cap"))?),
            None => None,
        };
        let surface = match target_face {
            Some(t) => body.faces[t].surface,
            None => {
                let s = &h.surfaces[f.surface.0 as usize];
                let geometry = match &s.geometry {
                    SurfaceGeometry::Plane { origin, normal, x } => SurfaceGeometry::Plane {
                        origin: plus(origin, hole.centre)?,
                        normal: *normal,
                        x: *x,
                    },
                    SurfaceGeometry::Cylinder { origin, axis, x, radius } => SurfaceGeometry::Cylinder {
                        origin: plus(origin, hole.centre)?,
                        axis: *axis,
                        x: *x,
                        radius: *radius,
                    },
                    SurfaceGeometry::ConeMeridian { origin, axis, x, start, end } => SurfaceGeometry::ConeMeridian {
                        origin: plus(origin, hole.centre)?,
                        axis: *axis,
                        x: *x,
                        start: *start,
                        end: *end,
                    },
                    _ => return Err(no("revolved-hole-surface")),
                };
                body.surfaces.push(Surface { frame: FrameId(1), provenance: prov.clone(), geometry });
                SurfaceId(body.surfaces.len() as u32 - 1)
            }
        };
        let mut loops = vec![];
        for l in &f.loops {
            let lp = &h.loops[l.0 as usize];
            let mut coedges = vec![];
            for u in lp.coedges.iter().rev() {
                let co_old = &h.coedges[u.0 as usize];
                let pc_old = &h.pcurves[co_old.pcurve.0 as usize];
                let edge = EdgeId(co_old.edge.0 + eo);
                let geometry = match target_face {
                    Some(_) => cap_circle(body, surface, hole, &pc_old.geometry)?,
                    None => pc_old.geometry.clone(),
                };
                let pk = PcurveId(body.pcurves.len() as u32);
                let curve = CurveId(pc_old.curve.0 + co);
                body.pcurves.push(Pcurve { curve, surface, domain: pc_old.domain.clone(), geometry });
                body.curves[curve.0 as usize].supports.push(Support { surface, pcurve: pk });
                body.coedges.push(Coedge { edge, forward: !co_old.forward, pcurve: pk });
                coedges.push(CoedgeId(body.coedges.len() as u32 - 1));
            }
            body.loops.push(Loop { outer: target_face.is_none() && lp.outer, coedges });
            loops.push(LoopId(body.loops.len() as u32 - 1));
        }
        match target_face {
            Some(t) => body.faces[t].loops.extend(loops),
            None => {
                body.shells[0].faces.push(FaceId(body.faces.len() as u32));
                body.faces.push(Face { surface, forward: !f.forward, loops });
            }
        }
    }
    Ok(())
}

/// The opening ring as a circle in the target cap's own chart.
fn cap_circle(body: &Body, surface: SurfaceId, hole: &MeridianHole, old: &PcurveGeometry) -> R<PcurveGeometry> {
    let PcurveGeometry::Circle { radius, .. } = old else {
        return Err(no("cap-carrier"));
    };
    let SurfaceGeometry::Plane { origin, normal, x } = &body.surfaces[surface.0 as usize].geometry else {
        return Err(no("cap-carrier"));
    };
    let g = |v: &Vector3| v.map(|c| q(c.get()));
    let (o, n, x) = (g(origin), g(normal), g(x));
    let y = wonky_geom::cross(&n, &x);
    if wonky_geom::dot(&x, &x) != q(1.) || wonky_geom::dot(&y, &y) != q(1.) {
        return Err(no("cap-chart"));
    }
    // The ring centre on the cap's own level (the cap lookup proved it).
    let mut p = hole.centre.map(q);
    p[hole.axis] = o[hole.axis].clone();
    let delta: [Q; 3] = std::array::from_fn(|k| &p[k] - &o[k]);
    let dir = local(hole.axis, 0., 0., 1.);
    Ok(PcurveGeometry::Circle {
        origin: [b(exact_float(&wonky_geom::dot(&delta, &x))?)?, b(exact_float(&wonky_geom::dot(&delta, &y))?)?],
        radius: *radius,
        clockwise: wonky_geom::dot(&n, &dir.map(q)) < Q::zero(),
    })
}

/// Source-unit measures of one hole: removed volume, its axial moment, the
/// areas and perimeters of the appended wall faces (WC0 order) and the ring
/// radius of each opened cap. Areas/perimeters in mm, mm^2 (times `scale`).
pub(crate) struct Observed {
    pub(crate) volume: Iv,
    pub(crate) axial_moment: Iv,
    pub(crate) areas: Vec<Iv>,
    pub(crate) perimeters: Vec<Iv>,
    pub(crate) cap_rings: [Option<f64>; 2],
    pub(crate) apexes: usize,
}
impl MeridianHole {
    fn edge_open(&self, i: usize) -> Option<usize> {
        let n = self.points.len();
        let (a, c) = (self.points[i], self.points[(i + 1) % n]);
        (0..2).find(|&s| self.open[s] && a[1] == self.levels[s] && c[1] == self.levels[s])
    }
    fn lateral(&self, i: usize) -> bool {
        let n = self.points.len();
        let (a, c) = (self.points[i], self.points[(i + 1) % n]);
        !(a[0] == 0. && c[0] == 0.) && self.edge_open(i).is_none()
    }
    pub(crate) fn observe(&self, pi: Iv, scale: Iv) -> R<Observed> {
        let p = Iv::point;
        let n = self.points.len();
        let (mut v, mut m) = (p(0.), p(0.));
        let mut out = Observed { volume: p(0.), axial_moment: p(0.), areas: vec![], perimeters: vec![], cap_rings: [None; 2], apexes: 0 };
        for i in 0..n {
            let (a, c) = (self.points[i].map(p), self.points[(i + 1) % n].map(p));
            let (dr, dz) = (c[0] - a[0], c[1] - a[1]);
            v = v + dz * (a[0] * a[0] + a[0] * c[0] + c[0] * c[0]) / p(3.);
            m = m + dz
                * (a[0] * a[0] * (p(3.) * a[1] + c[1])
                    + p(2.) * a[0] * c[0] * (a[1] + c[1])
                    + c[0] * c[0] * (a[1] + p(3.) * c[1]))
                / p(12.);
            let (ra, rc) = (self.points[i][0], self.points[(i + 1) % n][0]);
            if let Some(side) = self.edge_open(i) {
                out.cap_rings[side] = Some(ra.max(rc));
            } else if self.lateral(i) {
                out.areas.push(pi * (a[0] + c[0]) * dr.norm3(dz, p(0.)) * scale * p(1e6));
                let rings = [ra, rc].into_iter().filter(|&r| r > 0.).fold(p(0.), |s, r| s + p(r));
                out.perimeters.push(p(2.) * pi * rings * scale * p(1000.));
                if (ra == 0.) != (rc == 0.) && self.points[i][1] != self.points[(i + 1) % n][1] {
                    out.apexes += 1;
                }
            }
        }
        out.volume = pi * v;
        out.axial_moment = pi * m;
        Ok(out)
    }
    /// Exact membership of a target-source point in the removed region, and
    /// the enclosed distance to the hole walls when it lies in the void.
    /// Boundary points of the walls are material (inside).
    pub(crate) fn probe(&self, radial: &[Q; 2], height: &Q) -> R<Option<Iv>> {
        let c = chart_centre(self.axis, self.centre);
        let d = sub(radial, &c);
        let rho2 = dot(&d, &d);
        let n = self.points.len();
        let mut inside = false;
        let mut void_edge = false;
        for e in 0..n {
            let (a, bb) = (self.points[e].map(q), self.points[(e + 1) % n].map(q));
            let on = if a[1] == bb[1] {
                let (lo, hi) = if a[0] < bb[0] { (&a[0], &bb[0]) } else { (&bb[0], &a[0]) };
                *height == a[1] && rho2 >= lo * lo && rho2 <= hi * hi
            } else {
                let ((r0, h0), (r1, h1)) = if a[1] < bb[1] { ((&a[0], &a[1]), (&bb[0], &bb[1])) } else { ((&bb[0], &bb[1]), (&a[0], &a[1])) };
                if height < h0 || height > h1 {
                    false
                } else {
                    let crossing = r0 + (r1 - r0) * (height - h0) / (h1 - h0);
                    let square = &crossing * &crossing;
                    if height < h1 && rho2 < square {
                        inside = !inside;
                    }
                    rho2 == square
                }
            };
            if on {
                if self.lateral(e) {
                    return Ok(None);
                }
                void_edge = true;
            }
        }
        if !inside && !void_edge {
            return Ok(None);
        }
        let p = Iv::point;
        let point = [crate::arc_profile::enclose(&rho2)?.sqrt(), crate::arc_profile::enclose(height)?];
        let mut best: Option<Iv> = None;
        for e in (0..n).filter(|&e| self.lateral(e)) {
            let (a, c) = (self.points[e].map(p), self.points[(e + 1) % n].map(p));
            let (ex, ey) = (c[0] - a[0], c[1] - a[1]);
            let (px, py) = (point[0] - a[0], point[1] - a[1]);
            let da = px.norm3(py, p(0.));
            let db = (point[0] - c[0]).norm3(point[1] - c[1], p(0.));
            let length2 = ex * ex + ey * ey;
            let t = (px * ex + py * ey) / length2;
            let perp = (px * ey - py * ex).abs() / length2.sqrt();
            let segment = if t.hi() < 0. {
                da
            } else if t.lo() > 1. {
                db
            } else if t.lo() >= 0. && t.hi() <= 1. {
                perp
            } else {
                let (lo, hi) = (perp.lo(), da.hi().min(db.hi()));
                let m = 0.5 * lo + 0.5 * hi;
                Iv { m, r: ((hi - m).max(m - lo)).next_up().next_up() }
            };
            best = Some(match best {
                None => segment,
                Some(b) => b.min(segment),
            });
        }
        best.map(Some).ok_or_else(|| no("probe-range"))
    }
}
