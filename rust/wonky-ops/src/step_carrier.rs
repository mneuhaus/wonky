//! Generic AP214 writer for audited spline carriers (`curve_source::Sourced`):
//! `CurveGeometry::BSpline` edges as `B_SPLINE_CURVE_WITH_KNOTS`,
//! `SurfaceGeometry::LinearExtrusion` faces as `SURFACE_OF_LINEAR_EXTRUSION`,
//! planes and lines as in the planar writer. Nothing is converted to a polygon,
//! and a linear extrusion is never written as a `B_SPLINE_SURFACE_WITH_KNOTS`:
//! readers (OCCT, FreeCAD) keep the extrusion type only for the native entity.
//!
//! Export budget. Every written coordinate is the correct rounding of the exact
//! world image of a source coordinate. A non-rational B-spline is a convex
//! combination of its controls, `C(t) = sum N_i(t) P_i` with `N_i >= 0` and
//! `sum N_i = 1` (partition of unity). If control `i` moves by at most `e_i`,
//! the curve moves at most `sum N_i e_i <= max e_i` at every parameter. The
//! budget states exactly that bound for the curves, in millimetres:
//!
//! - `e_i` is the distance between a rounded world control and its exact image,
//!   bounded per coordinate by half the gap to the neighbouring binary64 on the
//!   side of the exact value (round to nearest);
//! - a cap curve is compared with the swept curve translated along the written
//!   direction, so it carries the rounding of both controls (`2 max e_i`) plus
//!   the extent of the extrusion times the direction's rounding error
//!   (`EXTRUSION_DIRECTION_ERROR`, in unit-vector length);
//! - the planar vertex bound `2 ulp(max coordinate)` of `step::write` applies as
//!   well, and the declared budget is the larger of the two.
//!
//! Rational splines are refused: the weighted bound needs the weight ratio and
//! is not written here. The frame must be near-rigid (orthonormality defect at
//! most 1e-9, not reflecting); affine invariance makes the written B-spline the
//! exact image of the source spline under it.
use crate::curve_source::Sourced;
use crate::placement::Placement;
use crate::polyhedron::Refused;
use crate::step::{begin, finish, normalized, real, text, Writer};
use std::collections::BTreeMap;
use wonky_contract::*;

type R<T> = std::result::Result<T, Refused>;
fn no<T>(what: &str) -> R<T> {
    Err(Refused(format!("step-carrier/{what}")))
}
fn range<T, E>(r: std::result::Result<T, E>) -> R<T> {
    r.map_err(|_| Refused("export/range".into()))
}

/// Error of the written extrusion direction from the exact unit image, as a
/// length: the mapped columns, the normalisation and the printing each cost at
/// most a couple of ulps of 1 per component.
pub const EXTRUSION_DIRECTION_ERROR: f64 = 8.0 * f64::EPSILON;

const MM: f64 = 1000.0;

fn v3(v: &Vector3) -> [f64; 3] {
    v.map(|x| x.get())
}

/// Half the binary64 gap on the wider side of `r`: a bound for `|round(x) - x|`.
fn half_gap(r: f64) -> f64 {
    let gap = (r.next_up() - r).max(r - r.next_down());
    (0.5 * gap).max(f64::MIN_POSITIVE)
}

/// The world image of every vertex and every spline control, with the bounds.
struct Plan {
    vertices: Vec<[f64; 3]>,
    controls: BTreeMap<usize, Vec<[f64; 3]>>,
    budget: f64,
}

fn plan(s: &Sourced) -> R<Plan> {
    plan_of(s.body(), s.frame())
}

/// The plan of any body in one frame: arithmetic on its caches only, so the
/// budget of a body whose other carriers this writer does not take (arcs) is
/// still an observation bound.
fn plan_of(body: &Body, frame: &Placement) -> R<Plan> {
    if range(frame.reversed())? {
        return no("frame-orientation");
    }
    // Affine invariance: the image of a non-rational B-spline under an affine
    // map is the B-spline of the mapped controls, a line stays the line through
    // its mapped ends and a plane stays a plane, so a near-rigid frame (a
    // binary64 rotation, say) is written exactly up to the rounding below. A
    // circle would become an ellipse; this writer takes none.
    let defect = range(frame.orthonormality_defect())?;
    if defect > 1e-9 {
        return no("frame-not-near-rigid");
    }
    let vertices = body
        .vertices
        .iter()
        .map(|v| range(frame.apply(v3(&v.point), MM, true)))
        .collect::<R<Vec<_>>>()?;
    let mut controls = BTreeMap::new();
    let mut spread = 0.0f64;
    let mut extent = 0.0f64;
    for (i, c) in body.curves.iter().enumerate() {
        let CurveGeometry::BSpline { controls: source, weights, .. } = &c.geometry else { continue };
        if !weights.is_empty() {
            return no("rational-spline-unsupported");
        }
        let world = source.iter().map(|p| range(frame.apply(v3(p), MM, true))).collect::<R<Vec<_>>>()?;
        for p in &world {
            spread = spread.max(p.iter().map(|&x| half_gap(x)).fold(0.0f64, f64::hypot));
        }
        controls.insert(i, world);
    }
    for p in &body.pcurves {
        if let (SurfaceGeometry::LinearExtrusion { .. }, PcurveGeometry::Line { a, b }) =
            (&body.surfaces[p.surface.0 as usize].geometry, &p.geometry)
        {
            extent = extent.max(a[1].get().abs()).max(b[1].get().abs());
        }
    }
    let reach = vertices.iter().flatten().chain(controls.values().flatten().flatten()).fold(0.0f64, |m, c| m.max(c.abs()));
    let planar = 2.0 * (reach.next_up() - reach).max(f64::MIN_POSITIVE);
    // The extrusion's world length is |F z| times the source extent, at most
    // 1 + 3 defect of it (Gershgorin on F^T F).
    let spline = 2.0 * spread + extent * MM * (1. + 3. * defect) * EXTRUSION_DIRECTION_ERROR;
    let cache = crate::curve_source::fit_cache_error(body)? * MM * (1. + 3. * defect);
    let budget = planar.max(spline + 2. * cache);
    if !budget.is_finite() {
        return no("budget-range");
    }
    Ok(Plan { vertices, controls, budget })
}

/// `(multiplicity, value)` runs of a non-decreasing knot vector.
fn runs(knots: &[Binary64]) -> (Vec<usize>, Vec<f64>) {
    let mut mults: Vec<usize> = Vec::new();
    let mut values: Vec<f64> = Vec::new();
    for k in knots.iter().map(|k| k.get()) {
        if values.last() == Some(&k) {
            *mults.last_mut().expect("a run exists") += 1;
        } else {
            values.push(k);
            mults.push(1);
        }
    }
    (mults, values)
}

fn list<T: ToString>(items: &[T]) -> String {
    items.iter().map(T::to_string).collect::<Vec<_>>().join(",")
}

/// The world image of a unit vector: mapped and normalised.
fn world_direction(s: &Sourced, d: [f64; 3]) -> R<[f64; 3]> {
    normalized(range(s.frame().apply(d, 1.0, false))?)
}

/// Shared spline serializer for replay-audited boundaries, including mixed
/// line/circle/spline stacks. Coordinates are bounded observation caches.
pub(crate) fn emit_spline(w: &mut Writer, geometry: &CurveGeometry, controls: &[[f64; 3]]) -> R<String> {
    let CurveGeometry::BSpline { degree, knots, weights, .. } = geometry else { return no("swept-curve-not-spline") };
    if !weights.is_empty() { return no("rational-spline-unsupported"); }
    let points = controls.iter().map(|&p| w.point(p)).collect::<Vec<_>>();
    let (mults, values) = runs(knots);
    Ok(w.entity(format!(
        "B_SPLINE_CURVE_WITH_KNOTS('',{degree},({}),.UNSPECIFIED.,.F.,.F.,({}),({}),.UNSPECIFIED.)",
        points.join(","), list(&mults), values.iter().map(|&k| real(k)).collect::<Vec<_>>().join(",")
    )))
}

struct Emitter<'a> {
    w: &'a mut Writer,
    s: &'a Sourced,
    plan: &'a Plan,
    points: Vec<String>,
    vertices: Vec<String>,
    /// The written curve entity per curve id (a swept curve is shared).
    curves: BTreeMap<usize, String>,
}
impl Emitter<'_> {
    fn spline(&mut self, i: usize) -> R<String> {
        if let Some(c) = self.curves.get(&i) {
            return Ok(c.clone());
        }
        let CurveGeometry::BSpline { .. } = &self.s.body().curves[i].geometry else {
            return no("swept-curve-not-spline");
        };
        let entity = emit_spline(self.w, &self.s.body().curves[i].geometry, &self.plan.controls[&i])?;
        self.curves.insert(i, entity.clone());
        Ok(entity)
    }
    fn line(&mut self, s: usize, t: usize) -> R<String> {
        let (a, b) = (self.plan.vertices[s], self.plan.vertices[t]);
        if a == b {
            return no("edge-below-binary64-resolution");
        }
        let d = normalized([b[0] - a[0], b[1] - a[1], b[2] - a[2]])?;
        let dir = self.w.direction(d);
        let vector = self.w.entity(format!("VECTOR('',{dir},1.)"));
        Ok(self.w.entity(format!("LINE('',{},{vector})", self.points[s])))
    }
    fn plane(&mut self, origin: &Vector3, normal: &Vector3, x: &Vector3) -> R<String> {
        let frame = self.s.frame();
        let map = |d: [f64; 3], t: bool| range(frame.apply(d, if t { MM } else { 1.0 }, t));
        let (n, xs) = (v3(normal), v3(x));
        // The image of the normal is the cross product of the images of two
        // in-plane directions, x and n cross x.
        let ys = [n[1] * xs[2] - n[2] * xs[1], n[2] * xs[0] - n[0] * xs[2], n[0] * xs[1] - n[1] * xs[0]];
        let (wx, wy) = (map(xs, false)?, map(ys, false)?);
        let wn = normalized([wx[1] * wy[2] - wx[2] * wy[1], wx[2] * wy[0] - wx[0] * wy[2], wx[0] * wy[1] - wx[1] * wy[0]])?;
        let placement = self.w.placement(map(v3(origin), true)?, wn, normalized(wx)?);
        Ok(self.w.entity(format!("PLANE('',{placement})")))
    }
    fn extrusion(&mut self, curve: CurveId, direction: &Vector3, face: &Face) -> R<String> {
        let swept = self.spline(curve.0 as usize)?;
        let d = world_direction(self.s, v3(direction))?;
        #[cfg(feature = "plant_step_bspline_surface")]
        {
            return self.planted_surface(curve.0 as usize, d, face);
        }
        #[cfg(not(feature = "plant_step_bspline_surface"))]
        {
            let _ = face;
            let dir = self.w.direction(d);
            let vector = self.w.entity(format!("VECTOR('',{dir},1.)"));
            Ok(self.w.entity(format!("SURFACE_OF_LINEAR_EXTRUSION('',{swept},{vector})")))
        }
    }
    /// Planted negative: the same surface as a `B_SPLINE_SURFACE_WITH_KNOTS`
    /// (degree n by 1). Geometrically equal, but a reader no longer sees an
    /// extrusion, which the FreeCAD type assertion must catch.
    #[cfg(feature = "plant_step_bspline_surface")]
    fn planted_surface(&mut self, curve: usize, d: [f64; 3], face: &Face) -> R<String> {
        let body = self.s.body();
        let CurveGeometry::BSpline { degree, knots, .. } = &body.curves[curve].geometry else { return no("swept-curve-not-spline") };
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for l in &face.loops {
            for c in &body.loops[l.0 as usize].coedges {
                if let PcurveGeometry::Line { a, b } = &body.pcurves[body.coedges[c.0 as usize].pcurve.0 as usize].geometry {
                    for v in [a[1].get(), b[1].get()] {
                        lo = lo.min(v);
                        hi = hi.max(v);
                    }
                }
            }
        }
        let rows: Vec<String> = self.plan.controls[&curve]
            .clone()
            .iter()
            .map(|p| {
                let at = |v: f64| [p[0] + v * MM * d[0], p[1] + v * MM * d[1], p[2] + v * MM * d[2]];
                let (a, b) = (self.w.point(at(lo)), self.w.point(at(hi)));
                format!("({a},{b})")
            })
            .collect();
        let (mults, values) = runs(knots);
        Ok(self.w.entity(format!(
            "B_SPLINE_SURFACE_WITH_KNOTS('',{degree},1,({}),.UNSPECIFIED.,.F.,.F.,.F.,({}),(2,2),({}),({},{}),.UNSPECIFIED.)",
            rows.join(","),
            list(&mults),
            values.iter().map(|&k| real(k)).collect::<Vec<_>>().join(","),
            real(lo * MM),
            real(hi * MM)
        )))
    }
}

fn append(w: &mut Writer, id: &str, s: &Sourced, plan: &Plan) -> R<String> {
    let body = s.body();
    if body.shells.len() != 1 {
        return no("shells");
    }
    let points: Vec<String> = plan.vertices.iter().map(|&q| w.point(q)).collect();
    let vertices: Vec<String> = points.iter().map(|q| w.entity(format!("VERTEX_POINT('',{q})"))).collect();
    let mut e = Emitter { w, s, plan, points, vertices, curves: BTreeMap::new() };
    let mut edges = Vec::with_capacity(body.edges.len());
    for edge in &body.edges {
        let [sv, tv] = edge.vertices[..] else { return no("edge-vertices") };
        let (si, ti) = (sv.0 as usize, tv.0 as usize);
        let curve = match &body.curves[edge.curve.0 as usize].geometry {
            CurveGeometry::BSpline { .. } => e.spline(edge.curve.0 as usize)?,
            CurveGeometry::Line { .. } => e.line(si, ti)?,
            CurveGeometry::ConstructionCurve { .. }
                | CurveGeometry::ConstructionLine { .. }
            | CurveGeometry::CylinderIntersection { .. }
            | CurveGeometry::VectorEllipse { .. }
            | CurveGeometry::Circle { .. }
            | CurveGeometry::Ellipse { .. }
            | CurveGeometry::Parabola { .. }
            | CurveGeometry::Hyperbola { .. }
            | CurveGeometry::Trace { .. }
            | CurveGeometry::SphereCircle { .. } => return no("curve-kind"),
        };
        edges.push(e.w.entity(format!("EDGE_CURVE('',{},{},{curve},.T.)", e.vertices[si], e.vertices[ti])));
    }
    let mut faces = Vec::with_capacity(body.faces.len());
    for face in &body.faces {
        let surface = match &body.surfaces[face.surface.0 as usize].geometry {
            SurfaceGeometry::Plane { origin, normal, x } => e.plane(origin, normal, x)?,
            SurfaceGeometry::LinearExtrusion { curve, direction } => e.extrusion(*curve, direction, face)?,
            SurfaceGeometry::ConeMeridian { .. }
            | SurfaceGeometry::Cylinder { .. }
            | SurfaceGeometry::Cone { .. }
            | SurfaceGeometry::Sphere { .. }
            | SurfaceGeometry::Torus { .. }
            | SurfaceGeometry::ConeSlope { .. } => return no("surface-kind"),
        };
        let [lp] = face.loops[..] else { return no("face-loops") };
        let lp = &body.loops[lp.0 as usize];
        if !lp.outer {
            return no("face-loops");
        }
        let uses: Vec<(&str, bool)> = lp
            .coedges
            .iter()
            .map(|c| {
                let co = &body.coedges[c.0 as usize];
                (edges[co.edge.0 as usize].as_str(), co.forward)
            })
            .collect();
        faces.push(e.w.face(&surface, &uses, face.forward));
    }
    let shell = &body.shells[0];
    let shell = w.entity(format!(
        "CLOSED_SHELL('',({}))",
        shell.faces.iter().map(|f| faces[f.0 as usize].clone()).collect::<Vec<_>>().join(",")
    ));
    Ok(w.entity(format!("MANIFOLD_SOLID_BREP('{}',{shell})", text(id))))
}

/// The export budget (mm) the writer declares for a body in the frame `frame`
/// (see `plan_of`).
pub(crate) fn budget_of(body: &Body, frame: &Placement) -> R<f64> {
    Ok(plan_of(body, frame)?.budget)
}

/// Appends an audited curve-profile prism (`curve_profile`) to a shared AP214
/// file: its spline carriers are replayed by `curve_source::audit` (never read
/// from caches) and written as in [`write`]. The caller's declared budget must
/// cover [`budget_of`]; `Audited::export_tolerance_mm` of such a body does.
pub(crate) fn append_audited(w: &mut Writer, id: &str, a: &crate::polyhedron::Audited) -> R<String> {
    let checked = a.body.clone().check().map_err(|_| Refused("step-carrier/contract".into()))?;
    let s = crate::curve_source::audit(&checked)?;
    let plan = plan(&s)?;
    append(w, id, &s, &plan)
}

/// The AP214 file for named audited spline bodies.
pub fn write(bodies: &[(String, &Sourced)], name: &str) -> R<String> {
    let plans = bodies.iter().map(|(_, s)| plan(s)).collect::<R<Vec<_>>>()?;
    let budget = plans.iter().fold(0.0f64, |m, p| m.max(p.budget));
    let (mut w, head) = begin(
        name,
        budget,
        "export rounding of exact source-frame geometry; B-spline curves by the partition-of-unity bound (max control rounding, doubled for caps, plus extrusion extent times direction error)",
    );
    let mut solids = Vec::new();
    for ((id, s), p) in bodies.iter().zip(&plans) {
        solids.push(append(&mut w, id, s, p)?);
    }
    let description = format!(
        "wonky-kernel Rust spline-carrier B-rep; exact source-frame geometry, B-spline controls and vertices correctly rounded; export budget {} mm (partition-of-unity bound for B_SPLINE_CURVE_WITH_KNOTS)",
        real(budget)
    );
    Ok(finish(w, head, name, &description, solids))
}
