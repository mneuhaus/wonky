//! Audit of spline carriers: `CurveGeometry::BSpline` and
//! `SurfaceGeometry::LinearExtrusion` (WC0 wire v3 schema 6).
//!
//! Nothing here reads a binary64 cache to decide geometry (plan X1). The exact
//! source is the rule 3 sketch node (`wonky_contract::sketch3`) that a spline
//! curve names as its provenance. For a `bezier` or `bspline` entity the binary64
//! degree, knots, controls and weights of the entity ARE the source, so the audit
//! rebuilds the exact rational spline (`wonky_curve::bspline::BSpline`), certifies
//! it (clamped knots, positive weights, no cusp, no self-intersection) and
//! compares every cached number with it. A tampered control, weight or knot is
//! refused as `curve-source/spline-cache-mismatch`. A `fit` entity is replayed
//! with the exact OM1/D1 solve and checks every interpolation residual; its
//! pole caches are observations, never sources.
//!
//! Every other decision is exact expansion arithmetic on the binary64 inputs:
//! vertex and pcurve incidence, points on planes, the swept curve of an
//! extrusion (`Q_i = P_i + v * d` for every control), and generator endpoints.
//!
//! The extrusion chart is (u, v): `u` the parameter of the swept curve, `v` the
//! length (source units) along the exact unit direction `d`. Cap edges are the
//! lines `v = const` in that chart, generators the lines `u = const`.
use crate::{placement::Placement, polyhedron::Refused};
use wonky_contract::sketch3::{self, Entity};
use wonky_contract::*;
use wonky_curve::bspline::BSpline;
use wonky_curve::numeric::{pt, q};
use wonky_num::expansion::{mul, neg, sign, sum, Exp, Guard};

type R<T> = std::result::Result<T, Refused>;
/// Degree, knots, planar controls and optional weights of one sketch entity.
pub(crate) type SplineParts<'a> = (usize, Vec<f64>, &'a [[f64; 2]], Option<&'a Vec<f64>>);
fn no<T>(what: &str) -> R<T> {
    Err(Refused(format!("curve-source/{what}")))
}
fn v3(v: &Vector3) -> [f64; 3] {
    v.map(|x| x.get())
}
fn v2(v: &Vector2) -> [f64; 2] {
    v.map(|x| x.get())
}
fn finite(l: &Limit) -> Option<f64> {
    match l {
        Limit::Finite { value, closed: true } => Some(value.get()),
        _ => None,
    }
}
fn closed(d: &Domain) -> Option<(f64, f64)> {
    Some((finite(&d.lower)?, finite(&d.upper)?))
}

/// Exact scalar arithmetic on binary64 inputs; a failed guard is a refusal.
struct Exact {
    g: Guard,
}
impl Exact {
    fn new() -> Self {
        Self { g: Guard::new() }
    }
    fn dot(&mut self, a: [&Exp; 3], b: [&Exp; 3]) -> Exp {
        let mut e = Exp::new();
        for k in 0..3 {
            let t = mul(a[k], b[k], &mut self.g);
            e = sum(&e, &t, &mut self.g);
        }
        e
    }
    fn lit(v: f64) -> Exp {
        vec![v]
    }
    fn lits(p: [f64; 3]) -> [Exp; 3] {
        p.map(Self::lit)
    }
    /// The exact sign of `a - b`.
    fn cmp(&mut self, a: &Exp, b: &Exp) -> R<i32> {
        let d = sum(a, &neg(b), &mut self.g);
        self.verdict(sign(&d))
    }
    fn verdict<T>(&self, v: T) -> R<T> {
        if self.g.exact() {
            Ok(v)
        } else {
            no("exact-arithmetic-range")
        }
    }
    /// Whether `d` is exactly a unit vector.
    fn unit(&mut self, d: [f64; 3]) -> R<bool> {
        let e = Self::lits(d);
        let n = self.dot([&e[0], &e[1], &e[2]], [&e[0], &e[1], &e[2]]);
        Ok(self.cmp(&n, &Self::lit(1.))? == 0)
    }
    /// `base + v * d` per coordinate, exactly.
    fn along(&mut self, base: [f64; 3], v: f64, d: [f64; 3]) -> [Exp; 3] {
        [0, 1, 2].map(|k| sum(&[base[k]], &mul(&[v], &[d[k]], &mut self.g), &mut self.g))
    }
    fn equal(&mut self, e: &[Exp; 3], p: [f64; 3]) -> R<bool> {
        for k in 0..3 {
            if self.cmp(&e[k], &Self::lit(p[k]))? != 0 {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

/// Coordinates of a chart plane: `(s, t)` of `p` is `((p - o).x, (p - o).y^)`, with
/// `y^ = n x x^`. Exact for unit `x` and `n` (checked by the caller).
struct PlaneChart {
    o: [f64; 3],
    x: [f64; 3],
    y: [Exp; 3],
    n: [f64; 3],
}
impl PlaneChart {
    fn new(e: &mut Exact, o: [f64; 3], n: [f64; 3], x: [f64; 3]) -> R<Self> {
        if !(e.unit(n)? && e.unit(x)?) {
            return no("plane-chart-not-exact");
        }
        let cross = |a: [f64; 3], b: [f64; 3], e: &mut Exact| {
            [(1, 2), (2, 0), (0, 1)].map(|(i, j)| {
                let (p, m) = (mul(&[a[i]], &[b[j]], &mut e.g), mul(&[a[j]], &[b[i]], &mut e.g));
                sum(&p, &neg(&m), &mut e.g)
            })
        };
        let y = cross(n, x, e);
        Ok(Self { o, x, y, n })
    }
    fn offset(&self, e: &mut Exact, p: [f64; 3]) -> [Exp; 3] {
        [0, 1, 2].map(|k| sum(&[p[k]], &[-self.o[k]], &mut e.g))
    }
    fn contains(&self, e: &mut Exact, p: [f64; 3]) -> R<bool> {
        let d = self.offset(e, p);
        let h = e.dot([&d[0], &d[1], &d[2]], [&Exact::lit(self.n[0]), &Exact::lit(self.n[1]), &Exact::lit(self.n[2])]);
        Ok(e.verdict(sign(&h))? == 0)
    }
    fn is(&self, e: &mut Exact, p: [f64; 3], st: [f64; 2]) -> R<bool> {
        let d = self.offset(e, p);
        let s = e.dot([&d[0], &d[1], &d[2]], [&Exact::lit(self.x[0]), &Exact::lit(self.x[1]), &Exact::lit(self.x[2])]);
        let t = e.dot([&d[0], &d[1], &d[2]], [&self.y[0], &self.y[1], &self.y[2]]);
        Ok(e.cmp(&s, &Exact::lit(st[0]))? == 0 && e.cmp(&t, &Exact::lit(st[1]))? == 0)
    }
}

/// A body whose spline carriers were audited. Only [`audit`] builds one, so the
/// STEP writer cannot be handed an unaudited spline body.
#[derive(Debug)]
pub struct Sourced {
    body: Body,
    frame: Placement,
}
impl Sourced {
    pub fn body(&self) -> &Body {
        &self.body
    }
    pub fn frame(&self) -> &Placement {
        &self.frame
    }
}

/// The body's one geometry frame. Vertices, curves and surfaces share it.
fn shared_frame(body: &Body) -> R<FrameId> {
    let frames = body
        .vertices
        .iter()
        .map(|v| v.frame)
        .chain(body.curves.iter().map(|c| c.frame))
        .chain(body.surfaces.iter().map(|s| s.frame));
    let mut found = None;
    for f in frames {
        if *found.get_or_insert(f) != f {
            return no("mixed-frames");
        }
    }
    found.ok_or(Refused("curve-source/empty-body".into()))
}

/// The parts of a B-spline curve cache.
struct Cache<'a> {
    degree: u32,
    knots: &'a [Binary64],
    controls: &'a [Vector3],
    weights: &'a [Binary64],
}
fn cache(c: &Curve) -> Option<Cache<'_>> {
    match &c.geometry {
        CurveGeometry::BSpline { degree, knots, controls, weights, .. } => {
            Some(Cache { degree: *degree, knots, controls, weights })
        }
        CurveGeometry::Line { .. }
        | CurveGeometry::ConstructionCurve { .. }
                | CurveGeometry::ConstructionLine { .. }
        | CurveGeometry::CylinderIntersection { .. }
        | CurveGeometry::VectorEllipse { .. }
        | CurveGeometry::Circle { .. }
        | CurveGeometry::Ellipse { .. }
        | CurveGeometry::Parabola { .. }
        | CurveGeometry::Hyperbola { .. }
        | CurveGeometry::Trace { .. }
        | CurveGeometry::SphereCircle { .. } => None,
    }
}

/// The rule 3 sketch node behind a spline curve, and the plane offset (extrusion
/// coordinate) its controls must sit on: 0 for the sketch itself, one of the two
/// cap levels for a curve made by the extrusion.
fn source_sketch(body: &Body, curve: &Curve, c: &Cache<'_>) -> R<(usize, f64)> {
    let Provenance::Construction { node } = curve.provenance else {
        return no("spline-without-provenance");
    };
    let n = &body.constructions[node.0 as usize];
    let sketch3 = |n: &Construction| n.operation == (Operation::Sketch {}) && n.rule_version == 3;
    let level = c.controls[0][2].get();
    if sketch3(n) {
        if level != 0. {
            return no("spline-off-sketch-plane");
        }
        return Ok((node.0 as usize, 0.));
    }
    if n.operation == (Operation::Extrude {}) && n.rule_version == 1 && n.parameters.len() == 2 {
        let parent = &body.constructions[n.parents[0].0 as usize];
        if sketch3(parent) && n.parameters.iter().any(|p| p.get() == level) {
            return Ok((n.parents[0].0 as usize, level));
        }
    }
    no("spline-provenance")
}

/// The spline parts of a `bezier` or `bspline` sketch entity (a Bezier is the
/// clamped spline on [0, 1] of its degree); `None` for every other entity.
pub(crate) fn spline_parts(e: &Entity) -> Option<SplineParts<'_>> {
    match e {
        Entity::Bezier { controls } => {
            let d = controls.len() - 1;
            let knots = (0..2 * (d + 1)).map(|i| if i <= d { 0. } else { 1. }).collect();
            Some((d, knots, controls, None))
        }
        Entity::BSpline { degree, knots, controls, weights } => Some((*degree, knots.clone(), controls, weights.as_ref())),
        Entity::Line { .. } | Entity::Arc3 { .. } | Entity::Circle { .. } | Entity::Fit { .. } => None,
    }
}

/// Rebuild exact geometry from authoritative sketch inputs, including fit
/// points and D1 parameters. Observation poles never become geometry.
pub(crate) fn exact_spline(e: &Entity) -> R<Option<BSpline>> {
    if let Entity::Fit { points, parameters, start, end, closed, end_rule } = e {
        if *closed { return Err(wonky_curve::refusal::Refusal::ClosedFitSpline.into()); }
        // Legacy rule 0 carries no measured FitRule. Do not reinterpret it.
        if *end_rule != 1 { return Err(Refused("curve-profile/fit-spline-unsupported".into())); }
        let ts = parameters.as_ref().ok_or_else(|| Refused("curve2/fit-parameters-required".into()))?;
        if !points.iter().flatten().chain(ts).all(|x| x.is_finite()) { return no("nonfinite-source"); }
        let derivative = |d: &sketch3::Derivative| -> R<Option<wonky_curve::numeric::P>> {
            match d {
                sketch3::Derivative::Free => Ok(None),
                sketch3::Derivative::Given(v) if v.iter().all(|x| x.is_finite()) => Ok(Some(pt(*v))),
                sketch3::Derivative::Given(_) => no("nonfinite-source"),
            }
        };
        return Ok(Some(wonky_curve::bspline::fit::interpolate(&points.iter().map(|&p| pt(p)).collect::<Vec<_>>(),
            &ts.iter().map(|&t| q(t)).collect::<Vec<_>>(), derivative(start)?, derivative(end)?)?));
    }
    let Some((degree, knots, controls, weights)) = spline_parts(e) else { return Ok(None) };
    if !knots.iter().chain(controls.iter().flatten()).chain(weights.into_iter().flatten()).all(|v| v.is_finite()) { return no("nonfinite-source"); }
    Ok(Some(BSpline::new(degree,knots.iter().map(|&x|q(x)).collect(),controls.iter().map(|&p|pt(p)).collect(),
        weights.map(|w|w.iter().map(|&x|q(x)).collect()))?))
}

/// Partition-of-unity bound for exact rational poles to binary64 observation
/// caches, in source metres. Called only after source replay has matched them.
pub(crate) fn fit_cache_error(body: &Body) -> R<f64> {
    let mut bound = 0.0f64;
    for node in &body.constructions {
        if node.operation != (Operation::Sketch {}) || node.rule_version != 3 { continue; }
        let values = node.parameters.iter().map(|p|p.get()).collect::<Vec<_>>();
        let (_,entities) = sketch3::parse(&values).map_err(|_| Refused("curve-source/sketch-parameters".into()))?;
        for e in &entities {
            if !matches!(e,Entity::Fit {..}) { continue; }
            let s = exact_spline(e)?.unwrap();
            for p in s.poles() {
                let a = wonky_curve::numeric::enclose(&p[0])?;
                let b = wonky_curve::numeric::enclose(&p[1])?;
                bound = bound.max(a.r.hypot(b.r).next_up());
            }
        }
    }
    Ok(bound)
}

/// Replay one spline curve against the sketch entities of its source node.
fn replay_spline(body: &Body, curve: &Curve, sources: &mut [Option<Vec<BSpline>>]) -> R<()> {
    let c = cache(curve).expect("caller selects spline curves");
    let (node, level) = source_sketch(body, curve, &c)?;
    if sources[node].is_none() {
        let params: Vec<f64> = body.constructions[node].parameters.iter().map(|p| p.get()).collect();
        let Ok((_, entities)) = sketch3::parse(&params) else { return no("sketch-parameters") };
        if entities.iter().any(|e| matches!(e, Entity::Fit { end_rule, .. } if *end_rule != 1)) {
            return no("spline-fit-replay-unsupported");
        }
        // Validate every source before matching any carrier. Keep exact sources
        // for this audit: cap carriers share the same authoritative sketch.
        sources[node] = Some(entities.iter().map(exact_spline).collect::<R<Vec<_>>>()?
            .into_iter().flatten().collect());
    }
    for exact in sources[node].as_ref().unwrap() {
        let number = |x: &wonky_curve::numeric::Q| -> R<f64> { Ok(wonky_curve::numeric::enclose(x)?.m) };
        if c.degree as usize != exact.degree() || c.knots.len() != exact.knots().len()
            || c.controls.len() != exact.poles().len() { continue; }
        let mut same = true;
        for (cached,k) in c.knots.iter().zip(exact.knots()) { same &= cached.get() == number(k)?; }
        for (cached,p) in c.controls.iter().zip(exact.poles()) {
            same &= cached[0].get() == number(&p[0])? && cached[1].get() == number(&p[1])? && cached[2].get() == level;
        }
        same &= match exact.weights() {
            None => c.weights.is_empty(),
            Some(w) => c.weights.len() == w.len() && c.weights.iter().zip(w).all(|(a,b)| q(a.get()) == *b),
        };
        if same { return Ok(exact.regular()?); }
    }
    no("spline-cache-mismatch")
}

/// The endpoint of edge `e`'s curve at its two ends, when the edge runs over the
/// whole closed domain of a line or clamped B-spline. For a B-spline that is the
/// whole knot interval: only there are the end controls the curve's end points
/// (a WC0 curve domain may be any closed sub-interval of the knot span).
fn ends(body: &Body, e: &Edge) -> R<[[f64; 3]; 2]> {
    let curve = &body.curves[e.curve.0 as usize];
    let whole = closed(&e.domain).is_some() && e.domain == curve.domain;
    match &curve.geometry {
        CurveGeometry::Line { a, b } if whole && closed(&e.domain) == Some((0., 1.)) => Ok([v3(a), v3(b)]),
        CurveGeometry::BSpline { knots, controls, .. }
            if whole && closed(&e.domain) == Some((knots[0].get(), knots[knots.len() - 1].get())) =>
        {
            let last = controls.len() - 1;
            Ok([v3(&controls[0]), v3(&controls[last])])
        }
        CurveGeometry::Line { .. } | CurveGeometry::BSpline { .. } => no("edge-domain-unsupported"),
        CurveGeometry::ConstructionCurve { .. }
                | CurveGeometry::ConstructionLine { .. }
        | CurveGeometry::CylinderIntersection { .. }
        | CurveGeometry::VectorEllipse { .. }
        | CurveGeometry::Circle { .. }
        | CurveGeometry::Ellipse { .. }
        | CurveGeometry::Parabola { .. }
        | CurveGeometry::Hyperbola { .. }
        | CurveGeometry::Trace { .. }
        | CurveGeometry::SphereCircle { .. } => no("curve-kind-unsupported"),
    }
}

/// A pcurve that is a straight chart segment.
fn segment(g: &PcurveGeometry) -> R<[[f64; 2]; 2]> {
    match g {
        PcurveGeometry::Line { a, b } => Ok([v2(a), v2(b)]),
        PcurveGeometry::CylinderIntersection {}
        | PcurveGeometry::Harmonic { .. }
        | PcurveGeometry::SphereLatitude { .. }
        | PcurveGeometry::CircularArc { .. }
        | PcurveGeometry::Circle { .. }
        | PcurveGeometry::RationalBezier { .. }
        | PcurveGeometry::BSpline { .. }
        | PcurveGeometry::Samples { .. } => no("pcurve-unsupported"),
    }
}

fn audit_plane(body: &Body, e: &mut Exact, chart: &PlaneChart, face: &Face) -> R<()> {
    for l in &face.loops {
        for c in &body.loops[l.0 as usize].coedges {
            let coedge = &body.coedges[c.0 as usize];
            let edge = &body.edges[coedge.edge.0 as usize];
            let pcurve = &body.pcurves[coedge.pcurve.0 as usize];
            let curve = &body.curves[edge.curve.0 as usize];
            let [start, end] = ends(body, edge)?;
            match &curve.geometry {
                CurveGeometry::Line { .. } => {
                    let [a, b] = segment(&pcurve.geometry)?;
                    if !(chart.is(e, start, a)? && chart.is(e, end, b)?) {
                        return no("pcurve-chart-mismatch");
                    }
                }
                CurveGeometry::BSpline { degree, knots, controls, weights, .. } => match &pcurve.geometry {
                    PcurveGeometry::BSpline { degree: pd, knots: pk, controls: pc, weights: pw } => {
                        if degree != pd || knots != pk || weights != pw || controls.len() != pc.len() {
                            return no("pcurve-chart-mismatch");
                        }
                        for (p, st) in controls.iter().zip(pc) {
                            if !chart.is(e, v3(p), v2(st))? {
                                return no("pcurve-chart-mismatch");
                            }
                        }
                    }
                    PcurveGeometry::CylinderIntersection {}
                    | PcurveGeometry::Harmonic { .. }
                    | PcurveGeometry::SphereLatitude { .. }
                    | PcurveGeometry::CircularArc { .. }
                    | PcurveGeometry::Circle { .. }
                    | PcurveGeometry::Line { .. }
                    | PcurveGeometry::RationalBezier { .. }
                    | PcurveGeometry::Samples { .. } => return no("pcurve-unsupported"),
                },
                // `ends` admits only lines and B-splines.
                CurveGeometry::ConstructionCurve { .. }
                | CurveGeometry::ConstructionLine { .. }
                | CurveGeometry::CylinderIntersection { .. }
                | CurveGeometry::VectorEllipse { .. }
                | CurveGeometry::Circle { .. }
                | CurveGeometry::Ellipse { .. }
                | CurveGeometry::Parabola { .. }
                | CurveGeometry::Hyperbola { .. }
                | CurveGeometry::Trace { .. }
                | CurveGeometry::SphereCircle { .. } => return no("curve-kind-unsupported"),
            }
            // Convex hull: a curve whose controls all lie on the plane lies on it.
            let points: Vec<[f64; 3]> = match &curve.geometry {
                CurveGeometry::BSpline { controls, .. } => controls.iter().map(v3).collect(),
                _ => vec![start, end],
            };
            for p in points {
                if !chart.contains(e, p)? {
                    return no("curve-off-plane");
                }
            }
        }
    }
    Ok(())
}

fn audit_extrusion(body: &Body, e: &mut Exact, swept: &Curve, d: [f64; 3], face: &Face) -> R<()> {
    let base = cache(swept).ok_or(Refused("curve-source/extrusion-of-non-spline".into()))?;
    if !e.unit(d)? {
        return no("extrusion-direction-not-unit");
    }
    let (u0, u1) = (base.knots[0].get(), base.knots[base.knots.len() - 1].get());
    let bottom = v3(&base.controls[0]);
    let top = v3(&base.controls[base.controls.len() - 1]);
    for l in &face.loops {
        for c in &body.loops[l.0 as usize].coedges {
            let coedge = &body.coedges[c.0 as usize];
            let edge = &body.edges[coedge.edge.0 as usize];
            let [a, b] = segment(&body.pcurves[coedge.pcurve.0 as usize].geometry)?;
            let curve = &body.curves[edge.curve.0 as usize];
            match &curve.geometry {
                CurveGeometry::BSpline { degree, knots, controls, weights, .. } => {
                    // A cap: the swept curve translated by v along d.
                    if !(a[1] == b[1] && a[0] == u0 && b[0] == u1) {
                        return no("pcurve-chart-mismatch");
                    }
                    if *degree != base.degree || knots != base.knots || weights != base.weights || controls.len() != base.controls.len() {
                        return no("cap-not-swept-curve");
                    }
                    for (q, p) in controls.iter().zip(base.controls) {
                        let image = e.along(v3(p), a[1], d);
                        if !e.equal(&image, v3(q))? {
                            return no("cap-not-swept-curve");
                        }
                    }
                }
                CurveGeometry::Line { .. } => {
                    // A generator: u = const at one end of the swept curve.
                    let [start, end] = ends(body, edge)?;
                    let foot = if a[0] == u0 { bottom } else if a[0] == u1 { top } else { return no("generator-off-curve-end") };
                    if a[0] != b[0] {
                        return no("pcurve-chart-mismatch");
                    }
                    for (p, v) in [(start, a[1]), (end, b[1])] {
                        let image = e.along(foot, v, d);
                        if !e.equal(&image, p)? {
                            return no("generator-not-on-surface");
                        }
                    }
                }
                CurveGeometry::ConstructionCurve { .. }
                | CurveGeometry::ConstructionLine { .. }
                | CurveGeometry::CylinderIntersection { .. }
                | CurveGeometry::VectorEllipse { .. }
                | CurveGeometry::Circle { .. }
                | CurveGeometry::Ellipse { .. }
                | CurveGeometry::Parabola { .. }
                | CurveGeometry::Hyperbola { .. }
                | CurveGeometry::Trace { .. }
                | CurveGeometry::SphereCircle { .. } => return no("curve-kind-unsupported"),
            }
        }
    }
    Ok(())
}

/// Audit a checked body that carries spline curves and/or linear extrusions.
/// Bodies without any spline carrier are accepted too (the checks that remain
/// are the plane, line and incidence ones).
pub fn audit(checked: &CheckedBody) -> R<Sourced> {
    let body = checked.body();
    let frame_id = shared_frame(body)?;
    let frame = Placement::from_frames(body, frame_id).map_err(|_| Refused("curve-source/frame-unsupported-or-range".into()))?;
    let mut sources = vec![None; body.constructions.len()];
    for curve in body.curves.iter().filter(|c| cache(c).is_some()) {
        replay_spline(body, curve, &mut sources)?;
    }
    let mut e = Exact::new();
    for edge in &body.edges {
        let [start, end] = ends(body, edge)?;
        for (vertex, p) in edge.vertices.iter().zip([start, end]) {
            let q = v3(&body.vertices[vertex.0 as usize].point);
            if q != p {
                return no("vertex-off-curve-end");
            }
        }
        if edge.vertices.len() != 2 {
            return no("edge-vertices");
        }
    }
    for face in &body.faces {
        let surface = &body.surfaces[face.surface.0 as usize];
        for l in &face.loops {
            for c in &body.loops[l.0 as usize].coedges {
                let coedge = &body.coedges[c.0 as usize];
                let pcurve = &body.pcurves[coedge.pcurve.0 as usize];
                if pcurve.surface != face.surface || pcurve.curve != body.edges[coedge.edge.0 as usize].curve {
                    return no("pcurve-support");
                }
            }
        }
        match &surface.geometry {
            SurfaceGeometry::Plane { origin, normal, x } => {
                let chart = PlaneChart::new(&mut e, v3(origin), v3(normal), v3(x))?;
                audit_plane(body, &mut e, &chart, face)?;
            }
            SurfaceGeometry::LinearExtrusion { curve, direction } => {
                audit_extrusion(body, &mut e, &body.curves[curve.0 as usize], v3(direction), face)?;
            }
            SurfaceGeometry::ConeMeridian { .. }
            | SurfaceGeometry::Cylinder { .. }
            | SurfaceGeometry::Cone { .. }
            | SurfaceGeometry::Sphere { .. }
            | SurfaceGeometry::Torus { .. }
            | SurfaceGeometry::ConeSlope { .. } => return no("surface-kind-unsupported"),
        }
    }
    Ok(Sourced { body: body.clone(), frame })
}
