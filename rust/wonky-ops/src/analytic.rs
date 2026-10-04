//! Dispatch by audited analytic carrier, never by caller-provided geometry tags.
use crate::{
    affine::Affine,
    cylinder::{self, Cylinder},
    polyhedron::{self, Audited, Refused},
};
use wonky_contract::{Body, BodyKey, CheckedBody};

type R<T> = Result<T, Refused>;
#[derive(Clone, Debug)]
pub enum Solid {
    Columns(crate::prism_columns::Columns),
    PrismHoles(crate::prism_holes::PrismHoles),
    PrismStack(crate::prism_stack::PrismStack),
    Revolved(crate::revolve_full::FullRevolve),
    Planar(Audited),
    /// Replayed rule-6 Model and its exact planar consumer view.
    Model(Audited, wonky_geom::model::Model),
    /// A placed body whose family owns no placement: Model consumers only.
    Placed(crate::model_curved::Placed),
    Cylinder(Cylinder),
    Conical(crate::chamfer_rim::Conical),
    Coaxial(crate::coaxial::Coaxial),
    Bicylinder(crate::bicylinder::Bicylinder),
    CylinderTee(crate::cylinder_tee::Tee),
    Spherical(crate::sphere::Spherical),
    Axial(crate::axial::Axial),
    Lens(crate::lens::Lens),
    Perforated(crate::perforated::Perforated),
    PerforatedChamfer(crate::perforated_chamfer::PerforatedChamfer),
}
pub fn audit(body: &CheckedBody) -> R<Solid> {
    // Rule-6 ownership precedes source-placement and family dispatch, even
    // when the replayed Model has the boundary of a primitive box.
    if crate::model_boolean::candidate(body.body()) && !cfg!(feature = "plant_model_shape_dispatch") {
        return crate::model_boolean::audit(body).map(|(a, m)| Solid::Model(a, m));
    }
    // Placement preserves the authenticated source carrier. A profile blend
    // contains cylinders but is still a planar-profile solid, not a cylinder.
    if let Some((inner, _)) = crate::pattern::unplace(body.body()) {
        let checked = inner.check().map_err(|_| Refused("audit/placed-source-contract".into()))?;
        match audit(&checked)? {
            Solid::Planar(_) => return polyhedron::audit(body).map(Solid::Planar),
            // Families without a placement owner keep their source and are
            // read through the exactly moved source Model.
            source @ (Solid::Revolved(_) | Solid::Placed(_)) =>
                return crate::model_curved::placed(body.body(), source).map(Solid::Placed),
            _ => {}
        }
    }
    // Source-profile placements retain their analytic carrier payload.
    if let Some(placed) = polyhedron::placed_source(body)? {
        return Ok(Solid::Planar(placed));
    }
    if crate::fillet_general::candidate(body.body()) {
        crate::fillet_general::audit(body).map(Solid::Planar)
    } else if crate::profile_blend::candidate(body.body()) {
        crate::profile_blend::audit(body).map(Solid::Planar)
    } else if crate::cylinder_tee::is_candidate(body.body()) {
        crate::cylinder_tee::audit(body).map(Solid::CylinderTee)
    } else if crate::prism_stack::candidate(body.body()) {
        crate::prism_stack::audit(body).map(Solid::PrismStack)
    } else if crate::perforated_chamfer::candidate(body.body()) {
        crate::perforated_chamfer::audit(body).map(Solid::PerforatedChamfer)
    } else if crate::prism_columns::candidate(body.body()) {
        crate::prism_columns::audit(body).map(Solid::Columns)
    } else if crate::prism_holes::candidate(body.body()) {
        crate::prism_holes::audit(body).map(Solid::PrismHoles)
    } else if crate::revolve_full::candidate(body.body()) {
        crate::revolve_full::audit(body).map(Solid::Revolved)
    } else if crate::arc_profile::candidate(body.body()) {
        polyhedron::audit(body).map(Solid::Planar)
    } else if crate::chamfer_rim::candidate(body.body()) {
        crate::chamfer_rim::audit(body).map(Solid::Conical)
    } else if crate::bicylinder::is_candidate(body.body()) {
        crate::bicylinder::audit(body).map(Solid::Bicylinder)
    } else if body.body().curves.iter().any(|c| matches!(c.geometry, wonky_contract::CurveGeometry::SphereCircle { .. })) {
        crate::lens::audit(body).map(Solid::Lens)
    } else if crate::fillet_prism::candidate(body.body()) {
        polyhedron::audit(body).map(Solid::Planar)
    } else if body.body().surfaces.iter().any(|s| matches!(s.geometry, wonky_contract::SurfaceGeometry::Sphere { .. })) {
        if cylinder::has_cylinder(body.body()) {
            crate::axial::audit(body).map(Solid::Axial)
        } else {
            crate::sphere::audit(body).map(Solid::Spherical)
        }
    } else if crate::coaxial::is_candidate(body.body()) {
        crate::coaxial::audit(body).map(Solid::Coaxial)
    } else if cylinder::has_cylinder(body.body()) && crate::perforated::is_candidate(body.body()) {
        crate::perforated::audit(body).map(Solid::Perforated)
    } else if cylinder::has_cylinder(body.body()) {
        cylinder::audit(body).map(Solid::Cylinder)
    } else {
        polyhedron::audit(body).map(Solid::Planar)
    }
}
impl Solid {
    /// A general-Boolean Model with a curved carrier or a ring edge: its
    /// consumer view has no planar arrangement; only Model-aware consumers
    /// (measure, STEP, mesh, Boolean) read it, every other refuses by name.
    pub fn curved_model(&self) -> bool {
        matches!(self, Self::Model(_, m) | Self::Placed(crate::model_curved::Placed { model: m, .. }) if crate::model_wire::curved(m))
    }
    /// The exact `wonky_geom::model::Model` of this body (boolean3d strand
    /// G1: the planar families P1 and P2; G8 adds adapters for P5-P8 and
    /// P11). Dark: no host path calls it; G4's opt-in shadow harness and then
    /// G7's routing are its first callers.
    pub fn model(&self) -> R<wonky_geom::model::Model> {
        match self {
            Self::Model(_, m) => Ok(m.clone()),
            Self::Placed(p) => Ok(p.model.clone()),
            Self::Planar(a) => a.model(),
            Self::PrismHoles(p) => crate::model_curved::prism_holes(p),
            Self::Revolved(r) => crate::model_curved::revolved(r),
            Self::Cylinder(c) => crate::model_curved::cylinder(c),
            Self::Coaxial(c) => crate::model_curved::coaxial(c),
            Self::Perforated(p) => crate::model_curved::perforated(p),
            Self::Spherical(s) => crate::model_curved::sphere(s),
            Self::Lens(l) => crate::model_curved::lens(l),
            Self::Axial(a) => crate::model_curved::axial(a),
            Self::Columns(_)
            | Self::PrismStack(_)
            | Self::Conical(_)
            | Self::Bicylinder(_)
            | Self::CylinderTee(_)
            | Self::PerforatedChamfer(_) => Err(Refused("model/family-unsupported".into())),
        }
    }
    pub fn transform(&self, frame: Affine) -> R<Body> {
        match self {
            Self::Model(a, _) => {
                let mut key = a.body.key.clone();
                key.revision = key.revision.checked_add(1).ok_or_else(|| Refused("placement/revision-range".into()))?;
                crate::model_boolean::place(a, key, &crate::placement::Post::Interpreter(frame))
            }
            Self::Columns(_) => Err(Refused("prism-columns/placement-unimplemented".into())),
            Self::PrismHoles(p) => p.transform(frame),
            Self::PrismStack(p) => p.transform(frame),
            // No owner rebuilds a revolve in a composed frame: the exact image
            // chain is appended, and the placed body is read through its Model.
            Self::Revolved(crate::revolve_full::FullRevolve { body, .. })
            | Self::Placed(crate::model_curved::Placed { body, .. }) => {
                let mut key = body.key.clone();
                key.revision = key.revision.checked_add(1).ok_or_else(|| Refused("placement/revision-range".into()))?;
                crate::pattern::place_body(body, key, &crate::placement::Post::Interpreter(frame))
            }
            Self::Planar(a) => crate::orthogonal::transform(a, frame),
            Self::Cylinder(c) => cylinder::transform(c, frame),
            Self::Conical(c) => c.transform(frame),
            Self::Coaxial(c) => c.transform(frame),
            Self::Bicylinder(c) => c.transform(frame),
            Self::CylinderTee(c) => c.transform(frame),
            Self::Spherical(s) => crate::sphere::transform(s, frame),
            Self::Axial(a) => a.transform(frame),
            Self::Lens(a) => a.transform(frame),
            Self::Perforated(p) => p.transform(frame),
            Self::PerforatedChamfer(p) => p.transform(frame),
        }
    }
    pub fn measure(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        match self {
            Self::Columns(a) => a.measure_json(map, probes),
            Self::PrismHoles(a) => a.measure_json(map, probes),
            Self::PrismStack(a) => a.measure_json(map, probes),
            Self::Revolved(a) => a.measure_json(map, probes),
            Self::Model(_, m) if crate::model_wire::curved(m) => crate::model_export::measure_json(m, map, probes),
            Self::Placed(p) => crate::model_export::measure_json(&p.model, map, probes),
            Self::Planar(a) | Self::Model(a, _) => crate::host::measure_json(a, map, probes),
            Self::Cylinder(c) => c.measure_json(map, probes),
            Self::Conical(c) => c.measure_json(map, probes),
            Self::Coaxial(c) => c.measure_json(map, probes),
            Self::Bicylinder(c) => c.measure_json(map, probes),
            Self::CylinderTee(c) => c.measure_json(map, probes),
            Self::Spherical(s) => s.measure_json(map, probes),
            Self::Axial(a) => a.measure_json(map, probes),
            Self::Lens(a) => a.measure_json(map, probes),
            Self::Perforated(p) => p.measure_json(map, probes),
            Self::PerforatedChamfer(p) => p.measure_json(map, probes),
        }
    }
    pub fn extents(&self) -> R<[f64; 3]> {
        match self {
            // Holes and pockets lie strictly inside the target's profile.
            Self::PrismHoles(p) => match &p.base {
                crate::prism_holes::Base::Planar(a) => planar_extents(a),
                crate::prism_holes::Base::Cylinder(c) => Solid::Cylinder(c.clone()).extents(),
                crate::prism_holes::Base::Revolved(_) => Err(Refused("bbox/revolved-tool-source-extents".into())),
            },
            Self::Planar(a) | Self::Model(a, _) => planar_extents(a),
            Self::PrismStack(_) => Err(Refused("bbox/profile-source-extents".into())),
            Self::Columns(_) => Err(Refused("bbox/profile-columns-source-extents".into())),
            Self::Perforated(p) => p.base.orthogonal.as_ref().ok_or_else(|| Refused("bbox/non-box".into()))?.extents_mm(),
            Self::PerforatedChamfer(_) => Err(Refused("bbox/perforated-chamfer-source-extents".into())),
            Self::Placed(_) => Err(Refused("bbox/placed-source-extents".into())),
            Self::Revolved(_) | Self::Spherical(_) | Self::Axial(_) | Self::Lens(_) => Err(Refused("bbox/spherical-source-extents".into())),
            Self::Bicylinder(c) => Ok([c.radius * 2000.; 3]),
            Self::Conical(c) => {
                let k = c.source.axis()?;
                let mut d = [c.source.radius * 2000.; 3];
                d[k] = (c.source.top[k] - c.source.bottom[k]) * 1000.;
                Ok(d)
            }
            Self::Coaxial(c) => c.extents_mm(),
            Self::CylinderTee(_) => Err(Refused("bbox/cylinder-union-source-extents".into())),
            Self::Cylinder(c) => {
                let k = c.spec.axis()?;
                let mut d = [c.spec.radius * 2000.; 3];
                d[k] = (c.spec.top[k] - c.spec.bottom[k]) * 1000.;
                Ok(d)
            }
        }
    }
}
/// Construction-frame extents of an audited planar body from its exact source
/// data: rectilinear cells, or a straight prism's exact profile points and
/// levels. A circular arc's extreme points are not binary64 data: refused.
fn planar_extents(a: &Audited) -> R<[f64; 3]> {
    if let Some(arrangement) = &a.arrangement {
        use num_traits::ToPrimitive;
        let mut result = [0.; 3];
        for k in 0..3 {
            let lo = arrangement.source()?.iter().map(|p| &p[k]).min().ok_or_else(|| Refused("bbox/empty-model".into()))?;
            let hi = arrangement.source()?.iter().map(|p| &p[k]).max().unwrap();
            result[k] = ((hi - lo) * num_rational::BigRational::from_integer(1000.into())).to_f64()
                .filter(|v| v.is_finite()).ok_or_else(|| Refused("bbox/model-range".into()))?;
        }
        return Ok(result);
    }
    if let Some(cells) = &a.orthogonal {
        return cells.extents_mm();
    }
    if let Some(s) = &a.arcs {
        if s.rim.is_some() || s.profile.segments().iter().any(wonky_curve::Trimmed::is_curved) {
            return Err(Refused("bbox/arc-profile-source-extents".into()));
        }
        // The arc-prism chart: profile (x, y), extrusion z (as its probe).
        let points = s
            .profile
            .segments()
            .iter()
            .map(|g| -> R<[f64; 2]> {
                let exact = crate::prism_holes::exact_float;
                let start = g.ends()[0].rat().map_err(|e| Refused(e.name().into()))?;
                Ok([exact(&start[0])?, exact(&start[1])?])
            })
            .collect::<R<Vec<_>>>()?;
        return profile_extents(2, s.levels, points.into_iter());
    }
    if a.cap.is_empty()
        || (a.arrangement.is_some() && !crate::prism_holes::straight_profile(a))
        || a.rounded.is_some()
        || a.chamfer.is_some()
        || a.corner.is_some()
        || crate::loft::candidate(&a.body)
    {
        return Err(Refused("bbox/non-orthogonal".into()));
    }
    profile_extents(a.axis, a.levels, a.cap.iter().map(|p| [p.x, p.y]))
}
fn profile_extents(axis: usize, levels: [f64; 2], points: impl Iterator<Item = [f64; 2]>) -> R<[f64; 3]> {
    let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    lo[axis] = levels[0].min(levels[1]);
    hi[axis] = levels[0].max(levels[1]);
    for p in points {
        lo[u] = lo[u].min(p[0]);
        hi[u] = hi[u].max(p[0]);
        lo[v] = lo[v].min(p[1]);
        hi[v] = hi[v].max(p[1]);
    }
    if !lo.iter().chain(&hi).all(|x| x.is_finite()) {
        return Err(Refused("bbox/empty-profile".into()));
    }
    crate::orthogonal::extents_mm([lo, hi])
}
/// Placements preserve the source grammar. Inspect the primitive root without
/// re-reading its display geometry; operand replay audits every wrapper.
fn polynomial_source(body: &Body) -> bool {
    let mut root = body.clone();
    while let Some((inner, _)) = crate::pattern::unplace(&root) { root = inner; }
    crate::curve_profile::candidate(&root)
}
pub fn boolean(key: BodyKey, op: u8, bodies: &[Solid]) -> R<Vec<Body>> {
    // A rule-6 Model operand (planar or, from G12, curved) or a body placed
    // without a family placement owner has no family Boolean either: the
    // general Boolean takes every operand mix it can prove.
    if bodies.iter().any(|b| matches!(b, Solid::Model(_, _) | Solid::Placed(_))) {
        return crate::model_boolean::general(key, op, bodies);
    }
    // Existing successful owners retain their canonical boundary conventions.
    // Their capability limits are not limits of the shared 2.5D arrangement.
    // Admission depends on replayable operands, never diagnostic wording.
    // Proved geometric verdicts are terminal. Only capability gaps may enter
    // the shared arrangement, which must independently prove its result.
    let result = match family_boolean(key.clone(), op, bodies) {
        Err(owner) if owner.is_capability() && crate::prism_stack::admits_boolean(op, bodies) =>
            crate::prism_stack::boolean(key.clone(), op, bodies),
        result => result,
    };
    // boolean3d G12: these family capability limits are A1 arrangements the
    // general exact Boolean owns. It builds only what it proves, else it
    // refuses with its own code (never the family's).
    match result {
        Err(owner) if owner.is_capability() && ROUTED_TO_GENERAL.contains(&owner.0.as_str()) =>
            crate::model_boolean::general(key, op, bodies),
        result => result,
    }
}
/// Family refusals routed to the general Boolean (boolean3d plan §2.2, G12).
const ROUTED_TO_GENERAL: [&str; 7] = [
    "cylinder/mixed-boolean-arrangement",
    "cylinder/parallel-overlap-arrangement",
    "prism-holes/holes-contact-or-overlap",
    "prism-holes/source-grammar-mismatch",
    "perforated/side-contact-or-crossing",
    "revolve/full/boolean-arrangement-unimplemented",
    "prism-stack/non-parallel-extrusion-axes",
];
fn family_boolean(key: BodyKey, op: u8, bodies: &[Solid]) -> R<Vec<Body>> {
    if bodies.iter().any(|b|matches!(b,Solid::PrismStack(s) if !s.blend.is_empty())) {
        return Err(Refused("prism-stack/blended-boolean-unimplemented".into()));
    }
    if bodies.iter().any(|b| matches!(b, Solid::Revolved(_))) {
        if bodies.iter().all(|b| matches!(b, Solid::Revolved(_) | Solid::Cylinder(_))) {
            return match crate::revolve_boolean::boolean(key.clone(), op, bodies) {
                // Off-axis revolve cutters in a round disc or rod: axial holes.
                Err(e) if op == 1
                    && e.0 == "revolve/boolean/non-coaxial-axes"
                    && matches!(bodies[0], Solid::Cylinder(_)) =>
                {
                    Ok(vec![crate::prism_holes::subtract_tools(key, bodies)?])
                }
                result => result,
            };
        }
        // A prism or an audited holed prism minus revolution (and cylinder)
        // cutters whose axes run along its extrusion axis: arranged once
        // from the replayed source operands, (A - B) - C = A - (B u C).
        // Curved (arc-profile) targets and prism-stack results are excluded
        // here: they fall through to the prism_stack tool path below, which
        // owns arrangement-cell-aware cuts for curved and stacked bodies.
        if op == 1
            && bodies.len() >= 2
            && bodies[1..].iter().all(|b| matches!(b, Solid::Revolved(_) | Solid::Cylinder(_)))
        {
            let flat = match &bodies[0] {
                Solid::Planar(a) if a.arcs.is_none() => Some(vec![bodies[0].clone()]),
                Solid::PrismHoles(p) if p.pocket.is_none() => Some(p.sources()),
                _ => None,
            };
            if let Some(mut flat) = flat {
                flat.extend(bodies[1..].iter().cloned());
                return Ok(vec![crate::prism_holes::subtract_tools(key, &flat)?]);
            }
        }
        // Countersinks and counterbores coaxial with a prism's extrusion axis
        // are rings, bands and plates inside one exact arrangement cell.
        if crate::prism_stack::admits_tools(op, bodies) {
            return crate::prism_stack::boolean(key, op, bodies);
        }
        return Err(Refused("revolve/full/boolean-arrangement-unimplemented".into()));
    }
    // Earlier stacked-prism results combine with further prisms in one exact
    // arrangement of all their source leaves.
    if bodies.iter().any(|b| matches!(b, Solid::PrismStack(_))) {
        return arranged(key, op, bodies, "prism-stack/operand-carrier");
    }
    // Polynomial-profile leaves belong to the shared carrier arrangement.
    // Legacy column/hole builders only certify line/circle boundaries (their
    // clearance predicates cannot prove a spline clear of a disc).
    // Audited carriers retain their classification through placement wrappers.
    if bodies.iter().any(|b| matches!(b, Solid::Planar(a) if polynomial_source(&a.body) || a.arcs.as_ref().is_some_and(|s|
        s.profile.segments().iter().any(|piece| match piece.carrier() {
            wonky_curve::Carrier::BSpline(_) => true,
            wonky_curve::Carrier::Line | wonky_curve::Carrier::Circle(_) => false,
        })
    ))) {
        return arranged(key, op, bodies, "prism-stack/operand-carrier");
    }
    // Axial columns on a profile: unions of a profile with parallel cylinders
    // and every later union or difference with such an arrangement.
    if crate::prism_columns::owns(op, bodies) {
        return match crate::prism_columns::boolean(key.clone(), op, bodies) {
            Ok(body) => Ok(vec![body]),
            Err(e) => Err(e),
        };
    }
    // A further subtraction from an audited difference is arranged once from
    // its replayed source operands: (A - B) - C = A - (B ∪ C). No rounded
    // intermediate carrier is re-read, and the recursion sees no difference.
    if op == 1
        && bodies.len() >= 2
        && bodies[1..].iter().all(|b| matches!(b, Solid::Planar(_) | Solid::Cylinder(_)))
    {
        let sources = match &bodies[0] {
            Solid::PrismHoles(p) => Some(p.sources()),
            Solid::Coaxial(c) => c
                .subtraction_sources()?
                .map(|s| s.into_iter().map(Solid::Cylinder).collect()),
            _ => None,
        };
        if let Some(mut flat) = sources {
            flat.extend(bodies[1..].iter().cloned());
            return boolean(key, 1, &flat);
        }
    }
    // A union, or a mixed sequence, of coaxial cylinders extended by further
    // cylinders: re-arranged once from its replayed sources in order.
    if op <= 1 && bodies.len() >= 2 && bodies[1..].iter().all(|b| matches!(b, Solid::Cylinder(_))) {
        if let Solid::Coaxial(c) = &bodies[0] {
            let tools = bodies[1..]
                .iter()
                .filter_map(|b| if let Solid::Cylinder(t) = b { Some(t.clone()) } else { None })
                .collect::<Vec<_>>();
            return Ok(vec![c.then(key, op, &tools)?]);
        }
    }
    // Closed polygon pockets are sewn into cylindrical or line-profile caps.
    // Rectilinear arrangements retain the more general existing cell path.
    // A profile-prism target whose tools the pocket owner does not accept keeps
    // the planar arrangement paths below, with their own results or refusals.
    if op == 1
        && bodies.len() >= 2
        && bodies[1..].iter().any(|b| matches!(b, Solid::Planar(_)))
        && bodies.iter().all(|b| matches!(b, Solid::Planar(_) | Solid::Cylinder(_)))
    {
        match &bodies[0] {
            Solid::Cylinder(_) => {
                return match crate::prism_holes::subtract_pocket(key.clone(), bodies) {
                    Ok(body) => Ok(vec![body]),
                    Err(e) => Err(e),
                }
            }
            Solid::Planar(a) if a.orthogonal.is_none() => {
                if let Ok(body) = crate::prism_holes::subtract_pocket(key.clone(), bodies) {
                    return Ok(vec![body]);
                }
            }
            _ => {}
        }
    }
    // Difference distributes over the union of tools. Resolve all planar
    // cutters first, then sew supported cylinder rings into that exact result;
    // this removes the overlap only once and preserves both source histories.
    if op == 1 && matches!(bodies.first(), Some(Solid::Planar(_)))
        && bodies[1..].iter().any(|b| matches!(b, Solid::Planar(_)))
        && bodies[1..].iter().any(|b| matches!(b, Solid::Cylinder(_)))
        && bodies.iter().all(|b| matches!(b, Solid::Planar(_) | Solid::Cylinder(_)))
    {
        let planar = bodies.iter().filter_map(|b| if let Solid::Planar(a) = b { Some(a.clone()) } else { None }).collect::<Vec<_>>();
        let tools = bodies[1..].iter().filter_map(|b| if let Solid::Cylinder(c) = b { Some(c.clone()) } else { None }).collect::<Vec<_>>();
        let mut result = crate::orthogonal::boolean(key.clone(), 1, &planar)?;
        if result.len() != 1 { return Err(Refused("prism-holes/target-components".into())); }
        let checked = result.remove(0).check().map_err(|_| Refused("prism-holes/source-contract".into()))?;
        return Ok(vec![crate::prism_holes::subtract(key, &audit(&checked)?, &tools)?]);
    }
    if bodies.iter().all(|b| matches!(b, Solid::Planar(_))) {
        let planar = bodies
            .iter()
            .filter_map(|b| if let Solid::Planar(a) = b { Some(a.clone()) } else { None })
            .collect::<Vec<_>>();
        // Motion made concave leaves build in the older arrangement. Their
        // exact half-space test still admits them to the general pipeline.
        if planar.iter().map(crate::planar_boolean::requires_general).collect::<R<Vec<_>>>()?.into_iter().any(|x| x) {
            return crate::model_boolean::live(key, op, bodies);
        }
        return match crate::orthogonal::boolean(key.clone(), op, &planar) {
            Err(e) if ["planar-boolean/non-convex-face", "planar-boolean/non-convex-leaf",
                "planar-boolean/leaf-holes-unsupported", "planar-boolean/multiple-shells-unsupported"]
                .contains(&e.0.as_str()) => crate::model_boolean::live(key, op, bodies),
            // Line/arc prisms with a common extrusion axis are one exact 2D
            // arrangement times exact levels; other curved operands keep the
            // planar arrangement's refusal.
            Err(e) if e.0 == "planar-boolean/curved-operand" && crate::prism_stack::admits(bodies) => {
                crate::prism_stack::boolean(key, op, bodies)
            }
            result => result,
        };
    }
    if op == 1 {
        if let [Solid::Spherical(s), Solid::Cylinder(c)] = bodies {
            let tool = crate::axial::from_cylinder(c)?;
            return Ok(vec![crate::axial::subtract(key, s, &tool)?]);
        }
    }
    if bodies.iter().any(|b| matches!(b, Solid::Spherical(_))) {
        if op == 2 {
            match bodies {
                [Solid::Spherical(a), Solid::Planar(b)] | [Solid::Planar(b), Solid::Spherical(a)] =>
                    return Ok(vec![crate::sphere::intersect_box(key, a, b)?]),
                [Solid::Spherical(a), Solid::Spherical(b)] =>
                    return Ok(vec![crate::lens::intersect(key, a, b)?]),
                _ => {}
            }
        }
        // G14: every other sphere pair is a general Boolean (plane, sphere
        // and coaxial rows); it builds or refuses with its own code.
        return crate::model_boolean::general(key, op, bodies);
    }
    if op == 1 && bodies.len() > 2 {
        if let Some(Solid::Cylinder(target)) = bodies.first() {
            if bodies[1..].iter().all(|b| matches!(b, Solid::Cylinder(_))) {
                let tools = bodies[1..]
                    .iter()
                    .filter_map(|b| {
                        if let Solid::Cylinder(c) = b {
                            Some(c.clone())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>();
                return match crate::coaxial::boolean(key.clone(), op, target, &tools) {
                    Ok(body) => Ok(vec![body]),
                    Err(e) => Err(e),
                };
            }
        }
    }
    if let [Solid::Cylinder(a), Solid::Cylinder(b)] = bodies {
        if op == 0 && a.frame == b.frame && a.spec.axis()? != b.spec.axis()? {
            return Ok(vec![crate::cylinder_tee::union(key, a, b)?]);
        }
        if a.spec.axis()? == b.spec.axis()?
            && (a.frame != b.frame || a.spec.radius != b.spec.radius || op == 1)
        {
            match crate::coaxial::boolean(key.clone(), op, a, std::slice::from_ref(b)) {
                Ok(body) => return Ok(vec![body]),
                // Keep the newer coaxial arrangement whenever it succeeds.
                // Its named frame/axis refusals can still reach exact separation
                // or the off-axis closed-ring arrangement below.
                Err(e) if ["coaxial/non-coaxial-operand", "coaxial/different-exact-axes", "coaxial/different-frame-basis-not-exact"].contains(&e.0.as_str()) => {},
                Err(e) => return Err(e),
            }
        }
        if op == 2 && a.frame == b.frame && a.spec.axis()? != b.spec.axis()? {
            return Ok(vec![crate::bicylinder::intersect(key, a, b)?]);
        }
        return match cylinder::boolean(key.clone(), op, a, b) {
            Err(e) if op == 1 && ["cylinder/parallel-overlap-arrangement", "cylinder/cross-frame-overlap-arrangement"].contains(&e.0.as_str()) =>
                Ok(vec![crate::prism_holes::subtract(key, &bodies[0], std::slice::from_ref(b))?]),
            result => result,
        };
    }
    if let Some(Solid::Planar(a)) = bodies.first() {
        if op == 1
            && bodies.len() > 1
            && bodies[1..].iter().all(|b| matches!(b, Solid::Cylinder(_)))
        {
            let tools = bodies[1..]
                .iter()
                .filter_map(|b| {
                    if let Solid::Cylinder(c) = b {
                        Some(c.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            return match cylinder::tangent_box_noop(a, &tools) {
                Ok(body) => Ok(vec![body]),
                Err(e) if ["cylinder/box-cylinder-cut-arrangement", "cylinder/cross-frame-cut-arrangement"].contains(&e.0.as_str()) => {
                    match crate::perforated::subtract(key.clone(), a, &tools) {
                        Err(e) if ["perforated/blind-or-partial-hole", "perforated/non-box-target", "perforated/constructed-target-frame"].contains(&e.0.as_str()) =>
                            Ok(vec![crate::prism_holes::subtract(key, &bodies[0], &tools)?]),
                        result => Ok(vec![result?]),
                    }
                },
                Err(e) if e.0 == "cylinder/non-orthogonal-target" =>
                    Ok(vec![crate::prism_holes::subtract(key, &bodies[0], &tools)?]),
                Err(e) => Err(e),
            };
        }
    }
    arranged(key, op, bodies, "cylinder/mixed-boolean-arrangement")
}
/// The shared exact arrangement of ring, line and arc prism leaves, for the
/// operand mixes no earlier family owns; anything it cannot carry keeps `refusal`.
fn arranged(key: BodyKey, op: u8, bodies: &[Solid], refusal: &str) -> R<Vec<Body>> {
    if crate::prism_stack::admits(bodies) {
        crate::prism_stack::boolean(key, op, bodies)
    } else {
        Err(Refused(refusal.into()))
    }
}
/// Source of each surviving Boolean body identity, in tool-query order.
/// Geometry construction order is not identity order: disjoint orthogonal
/// components are emitted in spatial order. Decide overlap from exact cells,
/// never from bounding boxes or rounded volumes. Other currently supported
/// multi-output unions are separated cylinders, returned unchanged.
pub(crate) fn boolean_identity_sources(op: u8, inputs: &[Solid], outputs: &[Body]) -> R<Vec<usize>> {
    if op != 0 || outputs.len() == 1 {
        return Ok(vec![0; outputs.len()]);
    }
    outputs.iter().map(|body| {
        let output = audit(&body.clone().check().map_err(|_| Refused("boolean/identity-audit".into()))?)?;
        for (i, input) in inputs.iter().enumerate() {
            let overlaps = match (&output, input) {
                (Solid::Planar(a), Solid::Planar(b)) if a.frame == b.frame => {
                    let (Some(a), Some(b)) = (&a.orthogonal, &b.orthogonal) else {
                        return Err(Refused("boolean/body-identity-untracked".into()));
                    };
                    a.boxes.iter().any(|a| b.boxes.iter().any(|b|
                        (0..3).all(|k| a[0][k] < b[1][k] && b[0][k] < a[1][k])))
                }
                (Solid::Model(_, a), Solid::Planar(b) | Solid::Model(b, _)) => {
                    let b = crate::model_boolean::operand_model(b)?;
                    match wonky_bool::boolean(a, &b, wonky_bool::Op::Intersection, wonky_bool::Lineage::Separate, 0) {
                        Ok(_) => true,
                        Err(e) if ["boolean/empty-result", "boolean/non-manifold-result"].contains(&e.0) => false,
                        Err(e) => return Err(Refused(e.0.into())),
                    }
                }
                (Solid::Cylinder(a), Solid::Cylinder(b)) => a.body.key == b.body.key,
                _ => return Err(Refused("boolean/body-identity-untracked".into())),
            };
            if overlaps { return Ok(i); }
        }
        Err(Refused("boolean/body-identity-untracked".into()))
    }).collect()
}

pub fn distance(a: &Solid, b: &Solid) -> R<(f64, f64)> {
    if a.curved_model() || b.curved_model() {
        return Err(Refused("boolean/ssi-row-unavailable:model/curved-distance".into()));
    }
    match (a, b) {
        (Solid::Cylinder(a), Solid::Cylinder(b)) => cylinder::distance_mm(a, b),
        (Solid::Planar(a) | Solid::Model(a, _), Solid::Planar(b) | Solid::Model(b, _)) => {
            if a.arcs.is_some() || b.arcs.is_some() { return Err(Refused("distance/arc-prism-pair-unimplemented".into())); }
            if a.orthogonal.is_none() || b.orthogonal.is_none() || a.arrangement.is_some() || b.arrangement.is_some() {
                let d = match crate::distance::between(a,b) { Ok(d)=>d, Err(e) if e.0=="distance/solids-not-strictly-separated" => return Ok((0.,0.)), Err(e)=>return Err(e) };
                return Ok((d.distance_mm, (d.distance_mm-d.lower_mm).max(d.upper_mm-d.distance_mm)));
            }
            if a.frame != b.frame {
                // Two placements of boxes (a moved and an unmoved body): the general
                // convex distance composes both frames exactly. It refuses solids it
                // cannot strictly separate; the separating-axis test is complete for
                // convex polyhedra, so those share a point and their distance is
                // exactly 0 (contact or overlap, never "clear").
                return match crate::distance::between(a, b) {
                    Ok(d) => Ok((d.distance_mm, (d.distance_mm - d.lower_mm).max(d.upper_mm - d.distance_mm))),
                    Err(e) if e.0 == "distance/solids-not-strictly-separated" => Ok((0., 0.)),
                    Err(e) => Err(e),
                };
            }
            let (Some(c), Some(d)) = (&a.orthogonal, &b.orthogonal) else {
                return Err(Refused("distance/non-orthogonal".into()));
            };
            c.distance_mm(d, a.frame.as_affine()?)
        }
        _ => Err(Refused("distance/mixed-carriers".into())),
    }
}
pub fn step(bodies: &[(String, Solid)], name: &str) -> R<String> {
    let named = bodies.iter().map(|(id, b)| (id.clone(), match b {
        Solid::Columns(a) => crate::step::SolidRef::Columns(a),
        Solid::PrismHoles(a) => crate::step::SolidRef::PrismHoles(a),
        Solid::PrismStack(a) => crate::step::SolidRef::PrismStack(a),
        Solid::Revolved(a) => crate::step::SolidRef::Revolved(a),
        Solid::Model(_, m) if crate::model_wire::curved(m) => crate::step::SolidRef::Model(m),
        Solid::Placed(p) => crate::step::SolidRef::Model(&p.model),
        Solid::Planar(a) | Solid::Model(a, _) => crate::step::SolidRef::Planar(a),
        Solid::Spherical(a) => crate::step::SolidRef::Spherical(a),
        Solid::Axial(a) => crate::step::SolidRef::Axial(a),
        Solid::Lens(a) => crate::step::SolidRef::Lens(a),
        Solid::Cylinder(a) => crate::step::SolidRef::Cylinder(a),
        Solid::Conical(a) => crate::step::SolidRef::Conical(a),
        Solid::Coaxial(a) => crate::step::SolidRef::Coaxial(a),
        Solid::Bicylinder(a) => crate::step::SolidRef::Bicylinder(a),
        Solid::CylinderTee(a) => crate::step::SolidRef::CylinderTee(a),
        Solid::Perforated(a) => crate::step::SolidRef::Perforated(a),
        Solid::PerforatedChamfer(a) => crate::step::SolidRef::PerforatedChamfer(a),
    })).collect::<Vec<_>>();
    crate::step::write_solids(&named, name)
}
