//! Identity-preserving reference decoding. This type has no conversion to the
//! checked exact Model, and no Boolean entrypoint. Decimal observations remain
//! dyadic rationals; STEP axis normalization is a semantic operation, not an
//! exact affine map made from rounded unit vectors.
use super::{
    part21::{arg, Document, Value},
    *,
};
use num_traits::{Signed, ToPrimitive};
mod certificate;
pub use certificate::{
    BodySupportBounds, CoordinateExtrema, EdgeExtents, EdgePolyline, EdgeSample, FaceSupportBounds,
    HomogeneousSpan, ResidualBound, FaceChartDomain, FaceExtents, TrimEnclosure,
};
mod spline_surface;
pub use spline_surface::SplineSurface;
mod admission;
pub use admission::{ReferenceBody, ModellingOperation};
mod placement;
pub use placement::CoordinateBound;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug)]
pub struct Axis {
    pub origin: Point,
    pub axis: Point,
    pub reference: Point,
}
/// Bounds in one STEP chart coordinate: radians for angular coordinates,
/// source length units for axial/slant/planar coordinates.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParameterBound {
    pub lower: Q,
    pub upper: Q,
}
#[derive(Clone, Debug)]
pub enum Carrier {
    Spline(Axis, SplineSurface),
    Plane(Axis),
    Cylinder(Axis, Q),
    Cone(Axis, Q, Q), // radius at origin, semi-angle (radians)
    Sphere(Axis, Q),
    Torus(Axis, Q, Q), // major, minor radius; reference only, no SSI row
}
#[derive(Clone, Debug)]
pub enum Curve {
    Line {
        origin: Vec<Q>,
        direction: Vec<Q>,
    },
    Circle {
        axis: Axis,
        radius: Q,
        dimension: usize,
    },
    Spline {
        degree: usize,
        points: Vec<Vec<Q>>,
        weights: Vec<Q>,
        knots: Vec<Q>,
    },
}
#[derive(Clone, Debug)]
pub struct Pcurve {
    pub id: u32,
    pub surface: u32,
    pub curve: Curve,
}
#[derive(Clone, Debug)]
pub struct Edge {
    pub id: u32,
    pub vertices: [u32; 2],
    pub same_sense: bool,
    pub curve: Curve,
    pub pcurves: Vec<Pcurve>,
}
#[derive(Clone, Debug)]
pub struct Loop {
    pub id: u32,
    pub outer: bool,
    pub uses: Vec<(u32, bool)>,
}
#[derive(Clone, Debug)]
pub struct Face {
    pub id: u32,
    pub name: String,
    pub surface: u32,
    pub same_sense: bool,
    pub loops: Vec<Loop>,
}
#[derive(Clone, Debug)]
pub struct Body {
    pub id: u32,
    pub name: String,
    pub representation: u32,
    pub unit_to_mm: Q,
    pub uncertainty: Uncertainty,
    pub instance_path: Vec<u32>,
    /// Child-to-parent item placements, innermost first. Ratios are retained;
    /// a floating point rigid matrix is only a display observation.
    pub placements: Vec<(Axis, Axis)>,
    pub vertices: BTreeMap<u32, Point>,
    pub edges: BTreeMap<u32, Edge>,
    pub surfaces: BTreeMap<u32, Carrier>,
    pub faces: Vec<Face>,
}
#[derive(Clone, Debug)]
pub struct ReferenceDraft {
    pub state: ImportState,
    pub bodies: Vec<Body>,
}
fn fail<T>(name: &str) -> Result<T> {
    Err(Error::new(name))
}
fn reference(v: &Value) -> Result<u32> {
    v.reference()
}
fn refs(v: &Value) -> Result<Vec<u32>> {
    v.list()?.iter().map(reference).collect()
}
fn number_q(v: &Value, state: &mut ImportState) -> Result<Q> {
    let Value::Number(s) = v else {
        return fail("import/number-invalid");
    };
    let f = super::number(s)?;
    state.numeric_observations.push((s.clone(), f.to_bits()));
    Ok(binary64(f)?)
}
fn name(a: &[Value]) -> Result<String> {
    match arg(a, 0)? {
        Value::String(s) => Ok(s.clone()),
        _ => fail("import/name-invalid"),
    }
}
fn component<'a>(doc: &'a Document, id: u32, kinds: &[&str]) -> Result<(&'a str, &'a [Value])> {
    let e = doc
        .entities
        .get(&id)
        .ok_or_else(|| Error::new("import/missing-id"))?;
    for (k, a) in &e.components {
        if kinds.contains(&k.as_str()) {
            return Ok((k, a));
        }
    }
    fail(&format!("import/entity-unsupported:{}", e.components[0].0))
}
fn vector(
    doc: &Document,
    id: u32,
    kind: &str,
    dim: usize,
    scale: &Q,
    state: &mut ImportState,
) -> Result<Vec<Q>> {
    let a = doc.component(id, kind)?;
    let v = arg(a, 1)?.list()?;
    if v.len() != dim {
        return fail("import/dimension-unsupported");
    }
    v.iter()
        .map(|x| {
            let coordinate = number_q(x, state)? * scale;
            if coordinate.abs() > binary64(f64::MAX)? {
                return fail("import/coordinate-range");
            }
            Ok(coordinate)
        })
        .collect()
}
fn axis(doc: &Document, id: u32, scale: &Q, state: &mut ImportState) -> Result<Axis> {
    let (kind, a) = component(doc, id, &["AXIS2_PLACEMENT_3D", "AXIS2_PLACEMENT_2D"])?;
    let dim = if kind == "AXIS2_PLACEMENT_3D" { 3 } else { 2 };
    let v = vector(
        doc,
        reference(arg(a, 1)?)?,
        "CARTESIAN_POINT",
        dim,
        scale,
        state,
    )?;
    let origin = std::array::from_fn(|i| v.get(i).cloned().unwrap_or_else(|| q(0)));
    let direction = |v: &Value, state: &mut ImportState| -> Result<Point> {
        let v = vector(doc, reference(v)?, "DIRECTION", dim, &q(1), state)?;
        Ok(std::array::from_fn(|i| {
            v.get(i).cloned().unwrap_or_else(|| q(0))
        }))
    };
    let n = if dim == 2 || matches!(arg(a, 2)?, Value::Null) {
        [q(0), q(0), q(1)]
    } else {
        direction(arg(a, 2)?, state)?
    };
    let x = if matches!(arg(a, if dim == 2 { 2 } else { 3 })?, Value::Null) {
        let x = [q(1), q(0), q(0)];
        // STEP first_proj_axis chooses Y when the default X is parallel to
        // the supplied axis. This is an exact parallel decision, not an angle
        // threshold. An explicitly supplied parallel reference still refuses.
        if cross(&n, &x) == [q(0), q(0), q(0)] {
            [q(0), q(1), q(0)]
        } else {
            x
        }
    } else {
        direction(arg(a, if dim == 2 { 2 } else { 3 })?, state)?
    };
    if dot(&n, &n).is_zero() || dot(&cross(&n, &x), &cross(&n, &x)).is_zero() {
        return fail("import/placement-degenerate");
    }
    Ok(Axis {
        origin,
        axis: n,
        reference: x,
    })
}
fn carrier(doc: &Document, id: u32, scale: &Q, state: &mut ImportState) -> Result<Carrier> {
    if doc.entities.get(&id).is_some_and(|e| e.components.iter().any(|(k,_)| k == "B_SPLINE_SURFACE" || k == "B_SPLINE_SURFACE_WITH_KNOTS")) {
        return spline_surface::decode(doc, id, scale, state);
    }
    let (kind, a) = component(
        doc,
        id,
        &[
            "PLANE",
            "CYLINDRICAL_SURFACE",
            "CONICAL_SURFACE",
            "SPHERICAL_SURFACE",
            "TOROIDAL_SURFACE",
        ],
    )?;
    let axis = axis(doc, reference(arg(a, 1)?)?, scale, state)?;
    if kind == "PLANE" {
        return Ok(Carrier::Plane(axis));
    }
    let r = number_q(arg(a, 2)?, state)? * scale;
    if r <= q(0) {
        return fail("import/carrier-radius-invalid");
    }
    Ok(match kind {
        "CYLINDRICAL_SURFACE" => Carrier::Cylinder(axis, r),
        "SPHERICAL_SURFACE" => Carrier::Sphere(axis, r),
        "CONICAL_SURFACE" => {
            let angle = number_q(arg(a, 3)?, state)?;
            certificate::check_cone_angle(&angle)?;
            Carrier::Cone(axis, r, angle)
        }
        "TOROIDAL_SURFACE" => {
            let minor = number_q(arg(a, 3)?, state)? * scale;
            if minor <= q(0) || minor >= r {
                return fail("import/torus-domain-unsupported");
            }
            Carrier::Torus(axis, r, minor)
        }
        _ => unreachable!(),
    })
}
fn curve(doc: &Document, id: u32, dim: usize, scale: &Q, state: &mut ImportState) -> Result<Curve> {
    let (kind, a) = component(
        doc,
        id,
        &[
            "LINE",
            "CIRCLE",
            "B_SPLINE_CURVE",
            "B_SPLINE_CURVE_WITH_KNOTS",
        ],
    )?;
    if kind == "LINE" {
        let origin = vector(
            doc,
            reference(arg(a, 1)?)?,
            "CARTESIAN_POINT",
            dim,
            scale,
            state,
        )?;
        let v = doc.component(reference(arg(a, 2)?)?, "VECTOR")?;
        let direction = vector(doc, reference(arg(v, 1)?)?, "DIRECTION", dim, &q(1), state)?;
        if direction.iter().all(Zero::is_zero) || number_q(arg(v, 2)?, state)? <= q(0) {
            return fail("import/vector-magnitude");
        }
        // STEP vector direction normalization/magnitude does not affect the
        // curve's point set. Preserve direction; parameter mapping is separate.
        return Ok(Curve::Line { origin, direction });
    }
    if kind == "CIRCLE" {
        let axis = axis(doc, reference(arg(a, 1)?)?, scale, state)?;
        let radius = number_q(arg(a, 2)?, state)? * scale;
        if radius <= q(0) {
            return fail("import/curve-radius-invalid");
        }
        return Ok(Curve::Circle {
            axis,
            radius,
            dimension: dim,
        });
    }
    let e = &doc.entities[&id];
    let complex = e.components.iter().any(|(k, _)| k == "B_SPLINE_CURVE");
    let base = if complex {
        doc.component(id, "B_SPLINE_CURVE")?
    } else {
        a
    };
    let offset = usize::from(!complex);
    let degree_q = number_q(arg(base, offset)?, state)?;
    if !degree_q.is_integer() {
        return fail("import/spline-degree-invalid");
    }
    let degree = degree_q
        .to_usize()
        .ok_or_else(|| Error::new("import/spline-degree-invalid"))?;
    if degree == 0 || degree > wonky_curve::bspline::MAX_DEGREE {
        return fail("import/spline-degree-unsupported");
    }
    let points = refs(arg(base, offset + 1)?)?
        .into_iter()
        .map(|p| vector(doc, p, "CARTESIAN_POINT", dim, scale, state))
        .collect::<Result<Vec<_>>>()?;
    if points.len() <= degree || points.len() > 4096 {
        return fail("import/spline-control-count");
    }
    let knots_a = doc.component(id, "B_SPLINE_CURVE_WITH_KNOTS")?;
    let start = if complex { 0 } else { 6 };
    let mult = arg(knots_a, start)?.list()?;
    let knots = arg(knots_a, start + 1)?.list()?;
    if mult.len() != knots.len() || knots.len() < 2 {
        return fail("import/spline-knots-invalid");
    }
    let mut expanded = Vec::new();
    let mut previous = None;
    for (m, k) in mult.iter().zip(knots) {
        let mq = number_q(m, state)?;
        if !mq.is_integer() {
            return fail("import/spline-knots-invalid");
        }
        let m = mq
            .to_usize()
            .ok_or_else(|| Error::new("import/spline-knots-invalid"))?;
        let k = number_q(k, state)?;
        if m == 0 || m > degree + 1 || previous.as_ref().is_some_and(|p| p >= &k) {
            return fail("import/spline-knots-invalid");
        }
        expanded.extend(std::iter::repeat_n(k.clone(), m));
        previous = Some(k);
    }
    if expanded.len() != points.len() + degree + 1 || expanded[degree] >= expanded[points.len()] {
        return fail("import/spline-knots-invalid");
    }
    let weights = if let Ok(a) = doc.component(id, "RATIONAL_B_SPLINE_CURVE") {
        arg(a, 0)?
            .list()?
            .iter()
            .map(|v| number_q(v, state))
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![q(1); points.len()]
    };
    if weights.len() != points.len() || weights.iter().any(|w| w <= &q(0)) {
        return fail("import/spline-weight-invalid");
    }
    Ok(Curve::Spline {
        degree,
        points,
        weights,
        knots: expanded,
    })
}
fn edge(
    doc: &Document,
    id: u32,
    scale: &Q,
    state: &mut ImportState,
    vertices: &mut BTreeMap<u32, Point>,
) -> Result<Edge> {
    let a = doc.component(id, "EDGE_CURVE")?;
    let ends = [reference(arg(a, 1)?)?, reference(arg(a, 2)?)?];
    for v in ends {
        if let std::collections::btree_map::Entry::Vacant(entry) = vertices.entry(v) {
            let a = doc.component(v, "VERTEX_POINT")?;
            let p = vector(
                doc,
                reference(arg(a, 1)?)?,
                "CARTESIAN_POINT",
                3,
                scale,
                state,
            )?;
            entry.insert(
                p.try_into()
                    .map_err(|_| Error::new("import/dimension-unsupported"))?,
            );
        }
    }
    let mut cid = reference(arg(a, 3)?)?;
    let mut pcurves = Vec::new();
    if let Ok((_, sc)) = component(doc, cid, &["SURFACE_CURVE", "SEAM_CURVE"]) {
        cid = reference(arg(sc, 1)?)?;
        for pcid in refs(arg(sc, 2)?)? {
            let p = doc.component(pcid, "PCURVE")?;
            let surface = reference(arg(p, 1)?)?;
            let rep = doc.component(reference(arg(p, 2)?)?, "DEFINITIONAL_REPRESENTATION")?;
            let items = refs(arg(rep, 1)?)?;
            if items.len() != 1 {
                return fail("import/pcurve-representation-invalid");
            }
            let context =
                doc.component(reference(arg(rep, 2)?)?, "GEOMETRIC_REPRESENTATION_CONTEXT")?;
            if !matches!(arg(context,0)?,Value::Number(n) if n=="2") {
                return fail("import/pcurve-dimension-invalid");
            }
            // UV units depend on the carrier (angular versus length). Retain
            // source chart words here; lift applies the representation scale.
            pcurves.push(Pcurve {
                id: pcid,
                surface,
                curve: curve(doc, items[0], 2, &q(1), state)?,
            });
        }
    }
    Ok(Edge {
        id,
        vertices: ends,
        same_sense: arg(a, 4)?.boolean()?,
        curve: curve(doc, cid, 3, scale, state)?,
        pcurves,
    })
}
fn context(
    doc: &Document,
    id: u32,
    limits: Limits,
    state: &mut ImportState,
) -> Result<(Q, Uncertainty)> {
    let geo = doc.component(id, "GEOMETRIC_REPRESENTATION_CONTEXT")?;
    if !matches!(arg(geo,0)?,Value::Number(n) if n=="3") {
        return fail("import/dimension-unsupported");
    }
    let units = doc
        .component(id, "GLOBAL_UNIT_ASSIGNED_CONTEXT")
        .map_err(|_| Error::new("import/missing-unit"))?;
    let lengths = refs(arg(units, 0)?)?
        .into_iter()
        .filter(|u| {
            doc.entities[u]
                .components
                .iter()
                .any(|(k, _)| k == "LENGTH_UNIT")
        })
        .collect::<Vec<_>>();
    if lengths.len() != 1 {
        return fail("import/unit-conflict");
    }
    let scale = super::step::unit(doc, lengths[0], &mut BTreeSet::new(), 0, limits)?;
    let uncertainty = if let Ok(a) = doc.component(id, "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT") {
        let entries = refs(arg(a, 0)?)?;
        if entries.len() != 1 {
            return fail("import/uncertainty-unsupported");
        }
        let a = doc.component(entries[0], "UNCERTAINTY_MEASURE_WITH_UNIT")?;
        let Value::Typed(t, v) = arg(a, 0)? else {
            return fail("import/uncertainty-unsupported");
        };
        if t != "LENGTH_MEASURE" || v.len() != 1 {
            return fail("import/uncertainty-unsupported");
        }
        let us = super::step::unit(doc, reference(arg(a, 1)?)?, &mut BTreeSet::new(), 0, limits)?;
        let mm = number_q(&v[0], state)? * us;
        if mm < q(0) {
            return fail("import/uncertainty-invalid");
        }
        Uncertainty::Declared { mm }
    } else {
        Uncertainty::Unknown
    };
    Ok((scale, uncertainty))
}
impl ReferenceDraft {
    pub fn step(bytes: &[u8], source: Source, limits: Limits) -> Result<Self> {
        let draft = ImportDraft::new(bytes, source, limits, Decoder::Part21)?;
        let mut state = draft.state;
        let doc = Document::parse(bytes, limits)?;
        state.source_entity_ids = doc.entities.keys().map(|id| format!("#{id}")).collect();
        let mut reps = BTreeMap::new();
        for (id, e) in &doc.entities {
            if let Some((_, a)) = e.components.iter().find(|(k, _)| {
                matches!(
                    k.as_str(),
                    "SHAPE_REPRESENTATION"
                        | "ADVANCED_BREP_SHAPE_REPRESENTATION"
                        | "MANIFOLD_SURFACE_SHAPE_REPRESENTATION"
                )
            }) {
                reps.insert(*id, a);
            }
        }
        if reps.is_empty() {
            return fail("import/representation-missing");
        }
        let mut contexts = BTreeMap::new();
        for (id, a) in &reps {
            contexts.insert(
                *id,
                context(&doc, reference(arg(a, 2)?)?, limits, &mut state)?,
            );
        }
        let mut parents: BTreeMap<u32, Vec<(u32, u32, Axis, Axis)>> = BTreeMap::new();
        for (rid, e) in &doc.entities {
            let rel = e
                .components
                .iter()
                .find(|(k, _)| k == "REPRESENTATION_RELATIONSHIP");
            let tr = e
                .components
                .iter()
                .find(|(k, _)| k == "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION");
            if let (Some((_, r)), Some((_, t))) = (rel, tr) {
                let child = reference(arg(r, 2)?)?;
                let parent = reference(arg(r, 3)?)?;
                if !reps.contains_key(&child) || !reps.contains_key(&parent) {
                    return fail("import/representation-relationship-unsupported");
                }
                let t = doc.component(reference(arg(t, 0)?)?, "ITEM_DEFINED_TRANSFORMATION")?;
                let from = axis(
                    &doc,
                    reference(arg(t, 2)?)?,
                    &contexts[&child].0,
                    &mut state,
                )?;
                let to = axis(
                    &doc,
                    reference(arg(t, 3)?)?,
                    &contexts[&parent].0,
                    &mut state,
                )?;
                // Each origin and source geometry is already in canonical mm.
                // Different representation units do not imply an affine scale
                // in the rigid map; applying a second scale would corrupt it.
                parents
                    .entry(child)
                    .or_default()
                    .push((parent, *rid, from, to));
            }
        }
        let mut bodies = Vec::new();
        // Bound the unfolded assembly, not just the size/depth of its source
        // graph. A small acyclic graph can have exponentially many paths.
        let mut expansion_budget = limits.values;
        let mut accounted = BTreeSet::new();
        let mut accounted_faces = BTreeSet::new();
        for (rep, a) in &reps {
            let (scale, uncertainty) = &contexts[rep];
            for item in refs(arg(a, 1)?)? {
                let (kind, solid) =
                    component(&doc, item, &["MANIFOLD_SOLID_BREP", "AXIS2_PLACEMENT_3D"])?;
                if kind == "AXIS2_PLACEMENT_3D" {
                    axis(&doc, item, scale, &mut state)?;
                    continue;
                }
                if !accounted.insert(item) {
                    return fail("import/solid-multiple-definitions");
                }
                let shell = doc.component(reference(arg(solid, 1)?)?, "CLOSED_SHELL")?;
                let face_ids = refs(arg(shell, 1)?)?;
                if face_ids.is_empty() {
                    return fail("import/shell-empty");
                }
                let mut body = Body {
                    id: item,
                    name: product_name(&doc, *rep)?.unwrap_or(name(solid)?),
                    representation: *rep,
                    unit_to_mm: scale.clone(),
                    uncertainty: uncertainty.clone(),
                    instance_path: vec![*rep],
                    placements: Vec::new(),
                    vertices: BTreeMap::new(),
                    edges: BTreeMap::new(),
                    surfaces: BTreeMap::new(),
                    faces: Vec::new(),
                };
                let mut unique = BTreeSet::new();
                for fid in face_ids {
                    accounted_faces.insert(fid);
                    if !unique.insert(fid) {
                        return fail("import/topology-duplicate-use");
                    }
                    let f = doc.component(fid, "ADVANCED_FACE")?;
                    let surface = reference(arg(f, 2)?)?;
                    if !body.surfaces.contains_key(&surface) {
                        body.surfaces
                            .insert(surface, carrier(&doc, surface, scale, &mut state)?);
                    }
                    let mut loops = Vec::new();
                    for bid in refs(arg(f, 1)?)? {
                        let (kind, b) = component(&doc, bid, &["FACE_BOUND", "FACE_OUTER_BOUND"])?;
                        let lp = doc.component(reference(arg(b, 1)?)?, "EDGE_LOOP")?;
                        let mut uses = Vec::new();
                        for oid in refs(arg(lp, 1)?)? {
                            let oe = doc.component(oid, "ORIENTED_EDGE")?;
                            if !matches!(arg(oe, 1)?, Value::Derived)
                                || !matches!(arg(oe, 2)?, Value::Derived)
                            {
                                return fail("import/oriented-edge-invalid");
                            }
                            let eid = reference(arg(oe, 3)?)?;
                            if !body.edges.contains_key(&eid) {
                                body.edges.insert(
                                    eid,
                                    edge(&doc, eid, scale, &mut state, &mut body.vertices)?,
                                );
                            }
                            uses.push((eid, arg(oe, 4)?.boolean()?));
                        }
                        if !arg(b, 2)?.boolean()? {
                            uses.reverse();
                            for (_, f) in &mut uses {
                                *f = !*f;
                            }
                        }
                        loops.push(Loop {
                            id: bid,
                            outer: kind == "FACE_OUTER_BOUND",
                            uses,
                        });
                    }
                    body.faces.push(Face {
                        id: fid,
                        name: name(f)?,
                        surface,
                        same_sense: arg(f, 3)?.boolean()?,
                        loops,
                    });
                }
                let paths = placement_paths(
                    *rep,
                    &parents,
                    &mut BTreeSet::new(),
                    limits.depth,
                    &mut expansion_budget,
                )?;
                for (path, placements) in paths {
                    spend_expansion(&mut expansion_budget, body.observation_cost())?;
                    let mut instance = body.clone();
                    instance.instance_path = path;
                    instance.placements = placements;
                    bodies.push(instance);
                }
            }
        }
        let source_solids = doc
            .entities
            .iter()
            .filter(|(_, e)| e.components.iter().any(|(k, _)| k == "MANIFOLD_SOLID_BREP"))
            .map(|(id, _)| *id)
            .collect::<BTreeSet<_>>();
        let source_faces = doc
            .entities
            .iter()
            .filter(|(_, e)| e.components.iter().any(|(k, _)| k == "ADVANCED_FACE"))
            .map(|(id, _)| *id)
            .collect::<BTreeSet<_>>();
        if source_faces != accounted_faces {
            return fail("import/source-face-unaccounted");
        }
        if source_solids != accounted {
            return fail("import/source-solid-unaccounted");
        }
        if bodies.is_empty() {
            return fail("import/solid-missing");
        }
        Ok(Self { state, bodies })
    }
    /// Structural validation is necessary but does not certify geometry or a
    /// solid interior. It intentionally retains Validation::Decoded.
    pub fn check_topology(&self) -> Result<()> {
        for b in &self.bodies {
            let mut incidence: BTreeMap<u32, Vec<bool>> = BTreeMap::new();
            for f in &b.faces {
                if f.loops.is_empty() {
                    return fail("import/face-unbounded");
                }
                for lp in &f.loops {
                    if lp.uses.is_empty() {
                        return fail("import/loop-empty");
                    }
                    for i in 0..lp.uses.len() {
                        let (e, forward) = lp.uses[i];
                        let (next, nf) = lp.uses[(i + 1) % lp.uses.len()];
                        if b.edges[&e].vertices[usize::from(forward)]
                            != b.edges[&next].vertices[usize::from(!nf)]
                        {
                            return fail("import/coedge-disconnected");
                        }
                        incidence.entry(e).or_default().push(forward);
                        let pcs = &b.edges[&e].pcurves;
                        if !pcs.is_empty() && !pcs.iter().any(|p| p.surface == f.surface) {
                            return fail("import/pcurve-surface-missing");
                        }
                    }
                }
            }
            for uses in incidence.values() {
                if uses.len() != 2 {
                    return fail("import/shell-edge-incidence");
                }
                if uses[0] == uses[1] {
                    return fail("import/coedge-orientation-mismatch");
                }
            }
        }
        Ok(())
    }
}
fn placement_paths(
    rep: u32,
    parents: &BTreeMap<u32, Vec<(u32, u32, Axis, Axis)>>,
    seen: &mut BTreeSet<u32>,
    budget: usize,
    expansion: &mut usize,
) -> Result<Vec<(Vec<u32>, Vec<(Axis, Axis)>)>> {
    if budget == 0 {
        return fail("import/depth-limit");
    }
    if !seen.insert(rep) {
        return fail("import/placement-cycle");
    }
    spend_expansion(expansion, 1)?;
    let mut result = Vec::new();
    if let Some(entries) = parents.get(&rep) {
        for (parent, rid, from, to) in entries {
            for (mut path, mut placements) in
                placement_paths(*parent, parents, seen, budget - 1, expansion)?
            {
                spend_expansion(
                    expansion,
                    path.len()
                        .saturating_add(2)
                        .saturating_add(placements.len().saturating_add(1).saturating_mul(18)),
                )?;
                path.insert(0, *rid);
                path.insert(0, rep);
                placements.insert(0, (from.clone(), to.clone()));
                result.push((path, placements));
            }
        }
    } else {
        result.push((vec![rep], Vec::new()));
    }
    seen.remove(&rep);
    Ok(result)
}

fn spend_expansion(budget: &mut usize, cost: usize) -> Result<()> {
    *budget = budget
        .checked_sub(cost)
        .ok_or_else(|| Error::new("import/placement-expansion-limit"))?;
    Ok(())
}

impl Body {
    fn observation_cost(&self) -> usize {
        fn curve_cost(curve: &Curve) -> usize {
            match curve {
                Curve::Line { origin, direction } => origin.len().saturating_add(direction.len()),
                Curve::Circle { .. } => 11,
                Curve::Spline {
                    points,
                    weights,
                    knots,
                    ..
                } => points.iter().map(Vec::len).fold(
                    weights.len().saturating_add(knots.len()),
                    usize::saturating_add,
                ),
            }
        }
        let mut cost = self
            .vertices
            .len()
            .saturating_mul(3)
            .saturating_add(self.surfaces.len().saturating_mul(11))
            .saturating_add(self.name.len());
        for edge in self.edges.values() {
            cost = cost
                .saturating_add(curve_cost(&edge.curve))
                .saturating_add(4);
            for pc in &edge.pcurves {
                cost = cost.saturating_add(curve_cost(&pc.curve)).saturating_add(2);
            }
        }
        for face in &self.faces {
            cost = cost.saturating_add(4).saturating_add(face.name.len());
            for boundary in &face.loops {
                cost = cost
                    .saturating_add(boundary.uses.len().saturating_mul(2))
                    .saturating_add(2);
            }
        }
        cost
    }
}

fn product_name(doc: &Document, rep: u32) -> Result<Option<String>> {
    for e in doc.entities.values() {
        if let Some((_, a)) = e
            .components
            .iter()
            .find(|(k, _)| k == "SHAPE_DEFINITION_REPRESENTATION")
        {
            if reference(arg(a, 1)?)? != rep {
                continue;
            }
            let pds = doc.component(reference(arg(a, 0)?)?, "PRODUCT_DEFINITION_SHAPE")?;
            let pd = doc.component(reference(arg(pds, 2)?)?, "PRODUCT_DEFINITION")?;
            let formation =
                doc.component(reference(arg(pd, 2)?)?, "PRODUCT_DEFINITION_FORMATION")?;
            let product = doc.component(reference(arg(formation, 2)?)?, "PRODUCT")?;
            let Value::String(label) = arg(product, 1)? else {
                return fail("import/name-invalid");
            };
            return Ok(Some(label.clone()));
        }
    }
    Ok(None)
}
impl Axis {
    /// Onshape/STEP semantic orthonormalization, only when every required
    /// square root is rational. G8's Frame/curved carriers then remain exact.
    pub fn rational_frame(&self) -> Result<crate::frame::Frame> {
        let norm = wonky_curve::numeric::exact_root(&dot(&self.axis, &self.axis))
            .ok_or_else(|| Error::new("import/placement-algebraic-frame-unavailable"))?;
        let z = self.axis.clone().map(|v| v / &norm);
        let projection = dot(&self.reference, &z);
        let x: Point = std::array::from_fn(|i| &self.reference[i] - &projection * &z[i]);
        let norm = wonky_curve::numeric::exact_root(&dot(&x, &x))
            .ok_or_else(|| Error::new("import/placement-algebraic-frame-unavailable"))?;
        let x = x.map(|v| v / &norm);
        let y = cross(&z, &x);
        Ok(crate::frame::Frame::new(self.origin.clone(), [x, y, z])?)
    }
}
/// An exact rational enclosure, used for semantic normalization only. These
/// intervals bound the mathematical source frame; their centres do not replace
/// the stored STEP axis ratios and never enter the exact Model admission.
#[derive(Clone, Debug)]
struct Interval(Q, Q);
impl Interval {
    fn point(x: Q) -> Self {
        Self(x.clone(), x)
    }
    fn sub(&self, b: &Self) -> Self {
        Self(&self.0 - &b.1, &self.1 - &b.0)
    }
    fn mul(&self, b: &Self) -> Self {
        let v = [
            &self.0 * &b.0,
            &self.0 * &b.1,
            &self.1 * &b.0,
            &self.1 * &b.1,
        ];
        Self(
            v.iter().min().unwrap().clone(),
            v.iter().max().unwrap().clone(),
        )
    }
    fn div(&self, b: &Self) -> Result<Self> {
        if b.0 <= q(0) && b.1 >= q(0) {
            return fail("import/normalization-domain-unproved");
        }
        Ok(self.mul(&Self(q(1) / &b.1, q(1) / &b.0)))
    }
    fn sqrt(x: &Q) -> Result<Self> {
        if x < &q(0) {
            return fail("import/normalization-domain-unproved");
        }
        if let Some(r) = wonky_curve::numeric::exact_root(x) {
            return Ok(Self::point(r));
        }
        // Integer floor supplies a certified dyadic root enclosure. Precision
        // is a proof budget, never a topology tolerance or a rounded sign.
        let denominator: wonky_alg::BigInt = wonky_alg::BigInt::from(1) << 80_usize;
        let scaled: wonky_alg::BigInt = (x.numer() << 160_usize) / x.denom();
        let floor = scaled.sqrt();
        Ok(Self(
            Q::new(floor.clone(), denominator.clone()),
            Q::new(floor + 1, denominator),
        ))
    }
    fn mid(&self) -> Q {
        (&self.0 + &self.1) / q(2)
    }
    fn radius(&self) -> Q {
        (&self.1 - &self.0) / q(2)
    }
}
impl Axis {
    fn semantic_columns(&self) -> Result<[Vec<Interval>; 3]> {
        let n2 = dot(&self.axis, &self.axis);
        if n2.is_zero() {
            return fail("import/placement-degenerate");
        }
        let projection = dot(&self.reference, &self.axis) / &n2;
        let xp: Point = std::array::from_fn(|i| &self.reference[i] - &projection * &self.axis[i]);
        let n = Interval::sqrt(&n2)?;
        let xn = Interval::sqrt(&dot(&xp, &xp))?;
        let z = self
            .axis
            .clone()
            .map(|v| Interval::point(v).div(&n))
            .into_iter()
            .collect::<Result<Vec<_>>>()?;
        let x = xp
            .map(|v| Interval::point(v).div(&xn))
            .into_iter()
            .collect::<Result<Vec<_>>>()?;
        let y = (0..3)
            .map(|i| {
                z[(i + 1) % 3]
                    .mul(&x[(i + 2) % 3])
                    .sub(&z[(i + 2) % 3].mul(&x[(i + 1) % 3]))
            })
            .collect::<Vec<_>>();
        Ok([x, y, z])
    }
    pub fn enclosed_frame(&self) -> Result<(crate::frame::Frame, Q)> {
        let [x, y, z] = self.semantic_columns()?;
        // Covers every column, including the axial component used by lifts
        // and placements. Circle-only consumers need fewer columns, but this
        // shared bound must also be sound for a general three-dimensional map.
        let error = x.iter().chain(&y).chain(&z).map(Interval::radius).sum();
        let columns = [
            std::array::from_fn(|i| x[i].mid()),
            std::array::from_fn(|i| y[i].mid()),
            std::array::from_fn(|i| z[i].mid()),
        ];
        Ok((
            crate::frame::Frame::new(self.origin.clone(), columns)?,
            error,
        ))
    }
}
