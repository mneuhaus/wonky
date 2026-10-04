//! WC0 rule-6 replay and G7 live planar Boolean admission.
//! Construction inputs are authority; every wire observation is rebuilt and
//! compared, including on cache hits. Cache keys retain full structural equality
//! behind their hash, so a hash collision cannot establish geometric identity.
use crate::{
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use std::{cell::RefCell, collections::HashMap};
use wonky_contract::*;
use wonky_geom::model::{Bounds, Model};
type R<T> = std::result::Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("boolean/contract-violation:{s}"))
}
pub(crate) fn blend_node(n: &Construction) -> bool {
    n.operation == (Operation::Intersection {}) && (n.rule_version == 11 || n.rule_version == 12)
        && n.parents.len() == 1 && n.parameters.len() >= 2
}
/// Placement closure (boolean3d G13): one exact map applied to a replayed
/// Model. Its frame is an image frame whose base is the parent's frame; the
/// replayed Model is the parent's, moved by the exact map between the two.
pub(crate) fn placement_node(n: &Construction) -> bool {
    n.operation == (Operation::AffineTransform {}) && n.rule_version == 6
        && n.parents.len() == 1 && n.parameters.is_empty()
}
/// A general Boolean source leaf (rule 7): one operand's own source DAG.
pub(crate) fn source_node(n: &Construction) -> bool {
    n.operation == (Operation::Boolean {}) && n.rule_version == 7 && n.parents.len() == 1 && n.parameters.len() == 4
}
/// Kind of a perforated box leaf in the rule-7 source grammar; every other
/// kind is the prism-stack source grammar (`prism_stack::source_kind`).
const PERFORATED: u32 = 1024;
/// Kind of a sphere leaf (G14).
const SPHERICAL: u32 = 1025;
/// The source leaf of any audited operand that is not a planar leaf.
pub(crate) fn source_leaf(s: &crate::analytic::Solid) -> R<(u32, Body)> {
    match s {
        crate::analytic::Solid::Perforated(p) => Ok((PERFORATED, p.body.clone())),
        crate::analytic::Solid::Spherical(p) => Ok((SPHERICAL, p.body().clone())),
        _ => crate::prism_stack::source_kind(s),
    }
}
/// Rebuild the operand of source leaf `r` of `b` from its frames and nodes
/// alone, audit it and return its exact Model (provenance local to the
/// operand) and the index of its first node in `b`.
fn source_model(b: &Body, r: usize) -> R<(Model, usize)> {
    let n = &b.constructions[r];
    let p = n.parameters.iter().map(|v| v.get() as usize).collect::<Vec<_>>();
    let (kind, back, count, nodes) = (p[0] as u32, p[1], p[2], p[3]);
    let first = (n.frame.0 as usize).checked_sub(back).ok_or_else(|| no("source-layout"))?;
    if nodes == 0 || nodes > r || n.parents[0].0 as usize + 1 != r || first + count > b.frames.len() || count == 0 {
        return Err(no("source-layout"));
    }
    let start = r - nodes;
    let mut frames = b.frames[first..first + count].to_vec();
    for f in &mut frames {
        match f {
            Frame::Interpreter { parent, .. } | Frame::Rigid { parent, .. } =>
                parent.0 = parent.0.checked_sub(first as u32).ok_or_else(|| no("source-layout"))?,
            Frame::AffineImage { base, .. } | Frame::InterpreterImage { base, .. } | Frame::RationalImage { base, .. } =>
                base.0 = base.0.checked_sub(first as u32).ok_or_else(|| no("source-layout"))?,
            Frame::Source { .. } => {}
        }
    }
    let mut constructions = b.constructions[start..r].to_vec();
    for c in &mut constructions {
        c.frame.0 = c.frame.0.checked_sub(first as u32).ok_or_else(|| no("source-layout"))?;
        for q in &mut c.parents {
            q.0 = q.0.checked_sub(start as u32).ok_or_else(|| no("source-layout"))?;
        }
    }
    let solid = if kind == PERFORATED {
        crate::analytic::Solid::Perforated(crate::perforated::replay(b.key.clone(), &frames, &constructions)?)
    } else if kind == SPHERICAL {
        crate::analytic::Solid::Spherical(crate::sphere::replay(b.key.clone(), &frames, &constructions)?)
    } else {
        crate::prism_stack::source_solid(b.key.clone(), kind, frames, constructions)?
    };
    // An operand family without a Model adapter is a missing row of the
    // general path, named like any other operand it cannot take yet. A
    // capability gap of an existing adapter (a semicircle on the extrusion
    // chart's pole) is the same kind of missing row and keeps its own name.
    let model = solid.model().map_err(|e| if e.0 == "model/family-unsupported" {
        Refused(format!("boolean/ssi-row-unavailable:operand/{}", family(&solid)))
    } else if e.0.starts_with("model/") && e.is_capability() {
        Refused(format!("boolean/ssi-row-unavailable:operand/{}:{}", family(&solid), e.0))
    } else { e })?;
    Ok((model, start))
}
pub(crate) fn node(n: &Construction) -> bool {
    n.operation == (Operation::Boolean {})
        && n.rule_version == 6
        && (n.parameters.len() == 2 || n.parameters.len() == 3)
        && n.parameters[1].get() == -6.
}
/// The rule-6 root of a body: the provenance of its first vertex, or of its
/// first curve or surface when it has no vertex (a ring-only result such as a
/// sphere ∪ coaxial cylinder). The writer stamps all three with the root.
fn root(b: &Body) -> Option<usize> {
    let provenance = b.vertices.first().map(|v| &v.provenance)
        .or_else(|| b.curves.first().map(|c| &c.provenance))
        .or_else(|| b.surfaces.first().map(|s| &s.provenance))?;
    match provenance {
        Provenance::Construction { node } => Some(node.0 as usize),
        _ => None,
    }
}
pub fn candidate(b: &Body) -> bool {
    root(b)
        .and_then(|r| b.constructions.get(r))
        .is_some_and(|n| node(n) || blend_node(n) || placement_node(n))
}
#[derive(Default)]
pub struct ReplayCache {
    // HashMap compares the full structural key on collisions. Interned parent
    // identities keep each key bounded: a chain does not expand ancestor text.
    identities: HashMap<String, usize>,
    nodes: HashMap<usize, Model>,
    computed: usize,
}
impl ReplayCache {
    pub fn computed(&self) -> usize {
        self.computed
    }
    fn keys(&mut self, b: &Body, r: usize) -> R<Vec<usize>> {
        if r >= 4096 {
            return Err(Refused("boolean/budget-exceeded:replay(4096)".into()));
        }
        let mut ids = Vec::with_capacity(r + 1);
        for n in b.constructions.iter().take(r + 1) {
            let frame = Placement::from_frames(b, n.frame)
                .map_err(|_| Refused("boolean/cross-frame-unproved".into()))?
                .exact_frame()?;
            let mut k = format!(
                "{:?}/{}/{:?}/{:?}",
                n.operation, n.rule_version, n.parameters, frame
            );
            for p in &n.parents {
                let id = ids.get(p.0 as usize).ok_or_else(|| no("replay-parent"))?;
                k.push_str(&format!("[{id}]"));
            }
            if self.identities.len() >= 8192 && !self.identities.contains_key(&k) {
                return Err(Refused("boolean/budget-exceeded:replay-cache(8192)".into()));
            }
            let next = self.identities.len();
            ids.push(*self.identities.entry(k).or_insert(next));
        }
        Ok(ids)
    }
    fn replay(&mut self, b: &Body, r: usize, ids: &[usize], budget: &mut usize) -> R<Model> {
        if *budget == 0 {
            return Err(Refused("boolean/budget-exceeded:replay(512)".into()));
        }
        *budget -= 1;
        let key = ids[r];
        if let Some(m) = self.nodes.get(&key) {
            return Ok(m.clone());
        }
        let n = &b.constructions[r];
        let model = if placement_node(n) {
            let parent = n.parents[0].0 as usize;
            // CheckedBody admits the node only on an image frame of `base`.
            let base = b.constructions.get(parent).ok_or_else(|| no("replay-parent"))?.frame;
            let model = self.replay(b, parent, ids, budget)?;
            let map = crate::model_curved::frame_map(b, base, n.frame)?;
            // Planted negative: the composed placement rounded to binary64,
            // as an f64 matrix product of the two placements would leave it.
            #[cfg(feature = "plant_placement_f64_compose")]
            let map = {
                let p = model.draft().placement.clone();
                let after = |f: &wonky_geom::frame::Frame, p: &wonky_geom::frame::Frame| wonky_geom::frame::Frame::new(
                    f.point(p.origin()), p.columns().clone().map(|c| f.vector(&c))).map_err(|e| Refused(e.0.into()));
                after(&rounded(&after(&map, &p)?)?, &p.inverse())?
            };
            // A singular map refuses in `frame_map`, a reflection in `moved`.
            model.moved(&map).map_err(|e| Refused(e.0.into()))?
        } else if blend_node(n) {
            let parent = self.replay(b, n.parents[0].0 as usize, ids, budget)?;
            let first=if n.rule_version==12 {2} else {1};
            if n.rule_version==12 && ![0.,1.].contains(&n.parameters[1].get()) {return Err(no("chamfer-propagation"));}
            let selected = n.parameters[first..].iter().map(|v| wonky_geom::model::EdgeId(v.get() as u32)).collect::<Vec<_>>();
            let width = wonky_geom::binary64(n.parameters[0].get()).map_err(|e| Refused(e.0.into()))?;
            // A selection with a curved edge is a closed G1 cap loop (F2c):
            // planes and cone patches with exact rational setbacks of the width.
            let d = parent.draft();
            let curved = selected.iter().any(|e| d.edges.get(e.index())
                .is_some_and(|e| !matches!(d.curves[e.curve.index()].geometry, wonky_geom::model::Curve3::Line { .. })));
            if n.rule_version == 11 && curved {
                wonky_blend::chain::chain_chamfer(&parent, &selected, &width, key as u32).map_err(|e| Refused(e.0))?
            } else {
                let request = wonky_blend::Request {
                    section: wonky_blend::Section::EqualOffsets { width },
                    tangent_propagation: n.rule_version==12 && n.parameters[1].get()==1.,
                };
                wonky_blend::chamfer::equal_offsets(&parent, &selected, request, key as u32)
                    .and_then(|boundary| boundary.model(&parent, key as u32))
                    .map_err(|e| Refused(e.0))?
            }
        } else if node(n) {
            let op = match n.parameters[0].get() {
                0. => wonky_bool::Op::Union,
                1. => wonky_bool::Op::Subtraction,
                2. => wonky_bool::Op::Intersection,
                _ => return Err(no("operation")),
            };
            let operands: Vec<Model> = n
                .parents
                .iter()
                .map(|p| self.replay(b, p.0 as usize, ids, budget))
                .collect::<R<_>>()?;
            let refs = operands.iter().collect::<Vec<_>>();
            let verdict = |e: wonky_geom::Refused| match e.0 {
                wonky_bool::contract::EMPTY_RESULT
                | wonky_bool::contract::NON_MANIFOLD_RESULT =>
                    Refused::geometric_verdict(e.0.into()),
                _ => Refused(e.0.into()),
            };
            // Curved operands (G12) take the carrier-fragment pipeline; planar
            // nodes keep the A0 fold, unchanged.
            if operands.iter().any(crate::model_wire::curved) {
                let mut solids = wonky_bool::fold_models(op, &refs, key as u32).map_err(verdict)?;
                let model = if n.parameters.len() == 3 {
                    let index = n.parameters[2].get();
                    if index < 0. || index.fract() != 0. || index as usize >= solids.len() { return Err(no("solid-selection")); }
                    solids.swap_remove(index as usize)
                } else if solids.len() == 1 {
                    solids.remove(0)
                } else {
                    wonky_bool::combine_models(&solids).map_err(|e| Refused(e.0.into()))?
                };
                self.computed += 1;
                self.nodes.insert(key, model.clone());
                return Ok(model);
            }
            let output = wonky_bool::fold(op, &refs, key as u32)
                .map_err(|e| match e.0 {
                    // These exported assembly contracts are proved outcomes,
                    // not missing capabilities. Preserve them across replay so
                    // the dispatcher cannot replace them with another owner's
                    // refusal (and contact queries retain the empty proof).
                    wonky_bool::contract::EMPTY_RESULT
                    | wonky_bool::contract::NON_MANIFOLD_RESULT =>
                        Refused::geometric_verdict(e.0.into()),
                    _ => Refused(e.0.into()),
                })?;
            if n.parameters.len() == 3 {
                let index = n.parameters[2].get();
                if index < 0. || index.fract() != 0. { return Err(no("solid-selection")); }
                output.solids().map_err(|e| Refused(e.0.into()))?
                    .get(index as usize).cloned().ok_or_else(|| no("solid-selection"))?
            } else { output.model }
        } else if source_node(n) {
            let (leaf, start) = source_model(b, r)?;
            rebind(leaf, |old| ((old as usize) < r - start).then(|| ids[start + old as usize] as u32))?
        } else {
            let leaf = crate::planar_boolean::model_at(
                b,
                r,
                Placement::from_frames(b, n.frame)
                    .map_err(|_| Refused("boolean/cross-frame-unproved".into()))?
                    .exact_frame()?,
            )?;
            rebind(leaf, |old| ids.get(old as usize).map(|id| *id as u32))?
        };
        self.computed += 1;
        self.nodes.insert(key, model.clone());
        Ok(model)
    }
    pub fn audit(&mut self, checked: &CheckedBody) -> R<(Audited, Model)> {
        let body = checked.body();
        let r = root(body)
            .filter(|&r| { let n = &body.constructions[r]; node(n) || blend_node(n) || placement_node(n) })
            .ok_or_else(|| no("model-rule"))?;
        let ids = self.keys(body, r)?;
        let model = self.replay(body, r, &ids, &mut 512)?;
        let (rebuilt, planar) = emit(body.clone(), r, &model)?;
        if rebuilt != *body && !cfg!(feature = "plant_model_cache_trusted") {
            return Err(no("observation-cache"));
        }
        let mut local = HashMap::new();
        for (index, id) in ids.iter().enumerate() {
            local.entry(*id as u32).or_insert(index as u32);
        }
        Ok((planar, rebind(model, |id| local.get(&id).copied())?))
    }
}
fn rebind(model: Model, map: impl Fn(u32) -> Option<u32>) -> R<Model> {
    let mut d = model.into_draft();
    macro_rules! bind {
        ($entities:expr) => {
            for entity in $entities {
                entity.provenance.node =
                    map(entity.provenance.node).ok_or_else(|| no("replay-provenance"))?;
            }
        };
    }
    bind!(&mut d.surfaces);
    bind!(&mut d.curves);
    bind!(&mut d.vertices);
    bind!(&mut d.edges);
    bind!(&mut d.coedges);
    bind!(&mut d.loops);
    bind!(&mut d.faces);
    bind!(&mut d.shells);
    bind!(&mut d.solids);
    d.check().map_err(|e| Refused(e.0.into()))
}
thread_local! { static CACHE: RefCell<ReplayCache> = RefCell::new(ReplayCache::default()); }
pub fn audit(checked: &CheckedBody) -> R<(Audited, Model)> {
    CACHE.with(|c| c.borrow_mut().audit(checked))
}
fn emit(body: Body,r:usize,model:&Model) -> R<(Body,Audited)> {
    wonky_curve::radical::guard(|| if crate::model_wire::curved(model) { emit_curved(body, r, model) } else { emit_exact(body, r, model) })
        .map_err(|_|no("radical-budget:export"))?
}
/// A curved Model's consumer view carries no planar arrangement: its
/// consumers read the Model (`Solid::Model`), never a planar cache.
fn emit_curved(body: Body, r: usize, model: &Model) -> R<(Body, Audited)> {
    // A body the Model writers cannot state (measure, STEP, STL share this
    // plan) is refused here, never built and left unmeasurable.
    crate::model_export::budget_mm(model)?;
    let body = crate::model_wire::emit(crate::planar_boolean::empty(body), r, model)?;
    let frame = Placement::from_frames(&body, body.constructions[r].frame)
        .map_err(|_| Refused("boolean/cross-frame-unproved".into()))?;
    let view = Audited {
        body: body.clone(),
        frame,
        axis: 2,
        levels: [0.; 2],
        cap: vec![],
        face_loops: vec![],
        bound_to_construction: true,
        orthogonal: None,
        arcs: None,
        rounded: None,
        corner: None,
        chamfer: None,
        arrangement: None,
    };
    Ok((body, view))
}
fn emit_exact(body: Body, r: usize, model: &Model) -> R<(Body, Audited)> {
    let d = model.draft();
    let mut faces = Vec::new();
    for face in &d.faces {
        let mut cycles = Vec::new();
        for l in &face.loops {
            let mut points = Vec::new();
            for c in &d.loops[l.index()].coedges {
                let co = &d.coedges[c.index()];
                let v = match d.edges[co.edge.index()].bounds {
                    Bounds::Segment(v) => v[usize::from(!co.forward)],
                    Bounds::Ring => {
                        return Err(Refused("boolean/ssi-row-unavailable:ring/export".into()))
                    }
                };
                points.push(model.key(v).coordinates());
            }
            cycles.push(points);
        }
        faces.push(cycles);
    }
    let shells = d
        .shells
        .iter()
        .map(|s| Shell {
            faces: s.faces.iter().map(|f| FaceId(f.0)).collect(),
        })
        .collect();
    let solids = d
        .solids
        .iter()
        .map(|s| Solid {
            shells: s.shells.iter().map(|s| ShellId(s.0)).collect(),
        })
        .collect();
    let (body, points) = crate::planar_boolean::build_radical_with_topology(
        crate::planar_boolean::empty(body),
        r,
        &faces,
        Some((shells, solids)),
    )?;
    let frame = Placement::from_frames(&body, body.constructions[r].frame)
        .map_err(|_| Refused("boolean/cross-frame-unproved".into()))?;
    let face_loops = body
        .loops
        .iter()
        .map(|l| {
            l.coedges
                .iter()
                .map(|c| {
                    let co = &body.coedges[c.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    let planar = Audited {
        body: body.clone(),
        frame: frame.clone(),
        axis: 2,
        levels: [0.; 2],
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        orthogonal: None,
        arcs: None,
        rounded: None,
        corner: None,
        chamfer: None,
        arrangement: Some(crate::planar_geometry::Arrangement::new_radical(points, &frame)?),
    };
    Ok((body, planar))
}
/// Every coefficient of `map` rounded to binary64 (planted negative only).
#[cfg(feature = "plant_placement_f64_compose")]
fn rounded(map: &wonky_geom::frame::Frame) -> R<wonky_geom::frame::Frame> {
    use num_traits::ToPrimitive;
    let r = |v: &[num_rational::BigRational; 3]| -> R<[num_rational::BigRational; 3]> {
        let f = |x: &num_rational::BigRational| num_rational::BigRational::from_float(x.to_f64().unwrap_or(f64::NAN)).ok_or_else(|| no("plant-range"));
        Ok([f(&v[0])?, f(&v[1])?, f(&v[2])?])
    };
    let [x, y, z] = map.columns();
    wonky_geom::frame::Frame::new(r(map.origin())?, [r(x)?, r(y)?, r(z)?]).map_err(|e| Refused(e.0.into()))
}
/// Place a replay-owned Model body by one more exact map (boolean3d G13):
/// one placement node over the body's root, whose frame is `post` applied
/// after the root's frame. Composition is exact in Q; repeated placements
/// chain nodes and never round an intermediate map. The observation is
/// re-emitted from the moved Model, like every rule-6 body.
pub fn place(a: &Audited, key: BodyKey, post: &crate::placement::Post) -> R<Body> {
    let mut body = a.body.clone();
    let r = root(&body).filter(|&r| candidate(&body) && r + 1 == body.constructions.len())
        .ok_or_else(|| no("placement-root"))?;
    // Resource ceiling only, as for every placed body (`pattern::place_body`).
    if body.frames.len() >= 256 { return Err(Refused("pattern/frame-depth".into())); }
    let frame = FrameId(body.frames.len() as u32);
    body.frames.push(post.frame(body.constructions[r].frame)?);
    // The same metric gate as every other placement: the accepted map is
    // still its exact coefficient matrix, defect included (E9).
    let map = Placement::from_frames(&body, frame).map_err(|_| Refused("pattern/numeric-range".into()))?;
    if map.orthonormality_defect().map_err(|_| Refused("pattern/numeric-range".into()))? > 1e-9 {
        return Err(Refused("pattern/metric-not-near-isometric".into()));
    }
    body.key = key;
    let root = body.constructions.len();
    body.constructions.push(Construction { operation: Operation::AffineTransform {}, rule_version: 6, parents: vec![NodeId(r as u32)], parameters: vec![], frame });
    CACHE.with(|c| {
        let mut cache = c.borrow_mut();
        let ids = cache.keys(&body, root)?;
        let model = cache.replay(&body, root, &ids, &mut 512)?;
        Ok(emit(body, root, &model)?.0)
    })
}
/// Chamfer a replayable planar operand. Wire edge indices are resolved using
/// exact source authority, then stored as the replayed Model's edge ids.
pub fn chamfer(a: &Audited, edges: &[usize], width: f64) -> R<Body> {
    chamfer_with_propagation(a,edges,width,false)
}
pub fn chamfer_with_propagation(a: &Audited,edges: &[usize],width:f64,tangent:bool) -> R<Body> {
    use wonky_geom::model::{EdgeId, VertexKey};
    if !width.is_finite() || width <= 0. { return Err(Refused("chamfer/invalid-width".into())); }
    if edges.is_empty() { return Err(Refused("chamfer/empty-selection".into())); }
    let (mut body, r) = crate::planar_boolean::source_dag(a.body.key.clone(), 0, &[a.clone()])?;
    let parent = body.constructions[r].parents[0];
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let ids = cache.keys(&body, r)?;
        let m = cache.replay(&body, parent.0 as usize, &ids, &mut 512)?;
        let world = crate::planar_geometry::world_points(a, 1.)?;
        let inverse = m.draft().placement.inverse();
        let mut selected = Vec::new();
        for &index in edges {
            let e = a.body.edges.get(index).ok_or_else(|| Refused("chamfer/edge-index".into()))?;
            if e.vertices.len() != 2 { return Err(Refused("chamfer/requires-line-edges".into())); }
            let points = e.vertices.iter().map(|v| VertexKey::Rational(inverse.point(&world[v.0 as usize]))).collect::<Vec<_>>();
            let found = m.draft().edges.iter().enumerate().find_map(|(i,e)| match e.bounds {
                Bounds::Segment([a,b]) if (m.key(a)==&points[0] && m.key(b)==&points[1]) || (m.key(a)==&points[1] && m.key(b)==&points[0]) => Some(EdgeId(i as u32)),
                Bounds::Segment(_) | Bounds::Ring => None,
            }).ok_or_else(|| Refused("chamfer/selection-not-in-model".into()))?;
            selected.push(found);
        }
        selected.sort(); selected.dedup();
        body.constructions[r] = Construction {
            operation: Operation::Intersection {}, rule_version: if tangent {12} else {11}, parents: vec![parent],
            parameters: std::iter::once(width).chain(if tangent {Some(1.)} else {None}).chain(selected.iter().map(|e|e.0 as f64))
                .map(|v| Binary64::new(v).map_err(|_| no("chamfer-header"))).collect::<R<_>>()?,
            frame: body.constructions[r].frame,
        };
        body.key.revision = body.key.revision.checked_add(1).ok_or_else(|| no("revision"))?;
        let ids = cache.keys(&body, r)?;
        let m = cache.replay(&body, r, &ids, &mut 512)?;
        Ok(emit(body, r, &m)?.0)
    })
}

/// Equal-offset chamfer of a prism stack whose binary64 family refuses
/// (`stack_blend`: rim-offset-not-representable). The stack's own rule-5
/// expression is rebuilt as the general Boolean (rule 6) over the same source
/// leaves, each selected edge maps onto the one Model edge with the exact
/// images of its trim ends and the same carrier class, and a rule-11 node
/// chamfers that Model: every offset is an exact rational of the width, and
/// only the emission rounds.
pub(crate) fn chamfer_stack(s: &crate::prism_stack::PrismStack, edges: &[usize], width: f64) -> R<Body> {
    use wonky_geom::model::{Curve3, EdgeId};
    if !width.is_finite() || width <= 0. { return Err(Refused("chamfer/invalid-width".into())); }
    if edges.is_empty() { return Err(Refused("chamfer/empty-selection".into())); }
    let (op, sources) = crate::prism_stack::source_operands(s)?;
    let leaves = sources.iter().map(|(kind, body)| crate::planar_boolean::DagLeaf::Source { kind: *kind, body }).collect::<Vec<_>>();
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let (mut body, r) = crate::planar_boolean::source_dag_leaves(s.body.key.clone(), op, &leaves)?;
        body.constructions[r].rule_version = 6;
        body.constructions[r].parameters[1] = Binary64::new(-6.).map_err(|_| no("header"))?;
        let ids = cache.keys(&body, r)?;
        let m = cache.replay(&body, r, &ids, &mut 512)?;
        let d = m.draft();
        if d.solids.len() != 1 { return Err(Refused("chamfer/stack-model-multiple-solids".into())); }
        let world = s.frame.exact_frame()?;
        let inverse = d.placement.inverse();
        let key = |v: wonky_geom::model::VertexId| m.key(v).rational().ok().cloned();
        let mut selected = Vec::new();
        for &index in edges {
            let (ends, circle) = s.edge_ends(index).map_err(|e| Refused(format!("chamfer/stack-selection:{}", e.0)))?;
            let ends = ends.map(|p| inverse.point(&world.point(&p)));
            let found = d.edges.iter().enumerate().filter(|(_, e)| {
                let Bounds::Segment([u, v]) = e.bounds else { return false };
                let class = matches!(d.curves[e.curve.index()].geometry, Curve3::Circle(_));
                let (Some(u), Some(v)) = (key(u), key(v)) else { return false };
                class == circle && ((u == ends[0] && v == ends[1]) || (u == ends[1] && v == ends[0]))
            }).map(|(i, _)| EdgeId(i as u32)).collect::<Vec<_>>();
            match found[..] {
                [one] => selected.push(one),
                [] => return Err(Refused("chamfer/selection-not-in-model".into())),
                _ => return Err(Refused("chamfer/selection-ambiguous".into())),
            }
        }
        selected.sort(); selected.dedup();
        let frame = body.constructions[r].frame;
        body.constructions.push(Construction {
            operation: Operation::Intersection {}, rule_version: 11, parents: vec![NodeId(r as u32)],
            parameters: std::iter::once(width).chain(selected.iter().map(|e| e.0 as f64))
                .map(|v| Binary64::new(v).map_err(|_| no("chamfer-header"))).collect::<R<_>>()?,
            frame,
        });
        let b = body.constructions.len() - 1;
        let ids = cache.keys(&body, b)?;
        let m = cache.replay(&body, b, &ids, &mut 512)?;
        Ok(emit(body, b, &m)?.0)
    })
}

/// Construct a replay-owned rule-6 planar Boolean.
pub fn boolean(key: BodyKey, op: u8, operands: &[Audited], cache: &mut ReplayCache) -> R<Body> {
    let leaves = operands.iter().map(crate::planar_boolean::DagLeaf::Planar).collect::<Vec<_>>();
    boolean_leaves(key, op, &leaves, cache)
}
fn boolean_leaves(key: BodyKey, op: u8, operands: &[crate::planar_boolean::DagLeaf], cache: &mut ReplayCache) -> R<Body> {
    if operands.len() < 2 || operands.len() > 64 || op > 2 {
        return Err(no("operands"));
    }
    let (mut body, r) = crate::planar_boolean::source_dag_leaves(key, op, operands)?;
    body.constructions[r].rule_version = 6;
    body.constructions[r].parameters[1] = Binary64::new(-6.).map_err(|_| no("header"))?;
    let ids = cache.keys(&body, r)?;
    let model = cache.replay(&body, r, &ids, &mut 512)?;
    Ok(emit(body, r, &model)?.0)
}

/// Export triangulation proposes diagonals in rounded chart coordinates, then
/// authenticates the complete oriented 2-chain over the exact rational plane.
/// Positive exact triangle orientation plus equality of its oriented boundary
/// to the face cycles proves coverage (including holes) and no overlaps.
/// No triangulation sign or topology fact is accepted from rounded coordinates.
pub(crate) fn tessellate(a: &Audited, deviation_mm: f64) -> R<crate::mesh::Mesh> {
    use wonky_geom::model::algebraic::{cross, dot, observe as point, sub};
    use wonky_curve::radical::Radical;
    use crate::planar_geometry::q;
    use std::collections::BTreeMap;
    let arrangement = a.arrangement.as_ref().ok_or_else(|| no("mesh-authority"))?;
    let exact = arrangement.exact_world();
    let mut mesh = crate::mesh::Mesh {
        vertices: arrangement.vertices_mm()?,
        brep_vertices: exact.len(),
        ..Default::default()
    };
    let budget2 = q(deviation_mm) * q(deviation_mm);
    for (p, observed) in exact.iter().zip(&mesh.vertices) {
        let delta = std::array::from_fn(|i| &p[i] * q(1000.) - q(observed[i]));
        if dot(&delta, &delta) > Radical::from(budget2.clone()) {
            return Err(Refused("export/stl/model-observation-budget".into()));
        }
    }
    fn add(chain: &mut BTreeMap<(usize, usize), i64>, a: usize, b: usize) {
        *chain.entry((a.min(b), a.max(b))).or_default() += if a < b { 1 } else { -1 };
    }
    for (fi, face) in a.body.faces.iter().enumerate() {
        let loops: Vec<_> = face
            .loops
            .iter()
            .map(|l| a.face_loops[l.0 as usize].clone())
            .collect();
        let outer = &loops[0];
        let mut n = std::array::from_fn(|_| Radical::default());
        for k in 1..outer.len() - 1 {
            let v = cross(
                &sub(&exact[outer[k]], &exact[outer[0]]),
                &sub(&exact[outer[k + 1]], &exact[outer[0]]),
            );
            for i in 0..3 {
                n[i] = &n[i]+&v[i];
            }
        }
        let axis = (0..3)
            .find(|&i| !n[i].is_zero())
            .ok_or_else(|| no("mesh-plane"))?;
        let ij = [(axis + 1) % 3, (axis + 2) % 3];
        let projected: Vec<_> = exact
            .iter()
            .map(|p| point(p).map(|p| [p[ij[0]], p[ij[1]]]).map_err(|e|no(e.0)))
            .collect::<R<_>>()?;
        let mut triangles = crate::mesh::triangulate_loops(&projected, &loops)?;
        let mut boundary = BTreeMap::new();
        for lp in &loops {
            for k in 0..lp.len() {
                add(&mut boundary, lp[k], lp[(k + 1) % lp.len()]);
            }
        }
        for t in &mut triangles {
            if n[axis].is_negative() {
                t.swap(1, 2);
            }
            let tn = cross(
                &sub(&exact[t[1]], &exact[t[0]]),
                &sub(&exact[t[2]], &exact[t[0]]),
            );
            if !(dot(&tn, &n)>Radical::default()) {
                return Err(no("mesh-triangle-orientation"));
            }
            for k in 0..3 {
                add(&mut boundary, t[(k + 1) % 3], t[k]);
            }
        }
        if boundary.values().any(|&v| v != 0) {
            return Err(no("mesh-boundary"));
        }
        if a.frame
            .reversed()
            .map_err(|_| Refused("boolean/cross-frame-unproved".into()))?
        {
            for t in &mut triangles {
                t.swap(1, 2);
            }
        }
        mesh.faces
            .extend(std::iter::repeat(fi as u32).take(triangles.len()));
        mesh.triangles.extend(triangles);
    }
    mesh.edges = a
        .body
        .edges
        .iter()
        .map(|e| crate::mesh::MeshEdge {
            vertices: e.vertices.iter().map(|v| v.0 as usize).collect(),
            closed: false,
        })
        .collect();
    crate::mesh::check_watertight(&mesh)?;
    Ok(mesh)
}

/// Only the owning planar limits and rule-6 continuations admit a Model.
/// Curved operands cannot become rounded planar leaves.
pub(crate) fn live(key: BodyKey, op: u8, bodies: &[crate::analytic::Solid]) -> R<Vec<Body>> {
    let operands = planar_operands(bodies)?;
    let leaves = operands.iter().map(crate::planar_boolean::DagLeaf::Planar).collect::<Vec<_>>();
    run(key, op, &leaves)
}
/// G12 routing: the general Boolean of any operands with an exact Model.
/// Planar operands stay plane-arrangement leaves; every other operand enters
/// as its source DAG (rule 7). The result is built only if every stage
/// proves it; otherwise the general path's own refusal is returned.
pub(crate) fn general(key: BodyKey, op: u8, bodies: &[crate::analytic::Solid]) -> R<Vec<Body>> {
    use crate::analytic::Solid as S;
    let mut sources = Vec::new();
    for b in bodies {
        sources.push(match b {
            S::Planar(a) | S::Model(a, _) if planar_leaf(a) => None,
            S::Model(_, _) => None,
            _ => Some(source_leaf(b).map_err(|_| Refused(format!("boolean/ssi-row-unavailable:operand/{}", family(b))))?),
        });
    }
    let leaves = bodies.iter().zip(&sources).map(|(b, s)| match (b, s) {
        (_, Some((kind, body))) => crate::planar_boolean::DagLeaf::Source { kind: *kind, body },
        (S::Planar(a) | S::Model(a, _), None) => crate::planar_boolean::DagLeaf::Planar(a),
        (_, None) => unreachable!("every non-planar operand has a source leaf"),
    }).collect::<Vec<_>>();
    run(key, op, &leaves)
}
/// The family of an operand without a source leaf, for its refusal.
fn family(s: &crate::analytic::Solid) -> &'static str {
    use crate::analytic::Solid as S;
    match s {
        S::Columns(_) => "columns",
        S::PrismHoles(_) => "prism-holes",
        S::PrismStack(_) => "prism-stack",
        S::Revolved(_) => "revolve",
        S::Planar(_) => "profile",
        S::Model(_, _) => "model",
        S::Placed(_) => "placed",
        S::Cylinder(_) => "cylinder",
        S::Conical(_) => "conical",
        S::Coaxial(_) => "coaxial",
        S::Bicylinder(_) => "bicylinder",
        S::CylinderTee(_) => "cylinder-tee",
        S::Spherical(_) => "sphere",
        S::Axial(_) => "axial",
        S::Lens(_) => "lens",
        S::Perforated(_) => "perforated",
        S::PerforatedChamfer(_) => "perforated-chamfer",
    }
}
fn planar_leaf(a: &Audited) -> bool {
    a.arcs.is_none() && a.rounded.is_none() && a.corner.is_none() && a.chamfer.is_none()
}
fn run(key: BodyKey, op: u8, leaves: &[crate::planar_boolean::DagLeaf]) -> R<Vec<Body>> {
    CACHE.with(|c| {
        let mut cache = c.borrow_mut();
        let body = boolean_leaves(key, op, leaves, &mut cache)?;
        if body.solids.len() == 1 { return Ok(vec![body]); }
        let r = root(&body).ok_or_else(|| no("root"))?;
        (0..body.solids.len()).map(|i| {
            let mut selected = body.clone();
            selected.constructions[r].parameters.push(Binary64::new(i as f64).map_err(|_| no("solid-selection"))?);
            let ids = cache.keys(&selected, r)?;
            let model = cache.replay(&selected, r, &ids, &mut 512)?;
            Ok(emit(selected, r, &model)?.0)
        }).collect()
    })
}
fn planar_operands(bodies: &[crate::analytic::Solid]) -> R<Vec<Audited>> {
    bodies.iter().map(|b| match b {
        crate::analytic::Solid::Planar(a) | crate::analytic::Solid::Model(a, _) => {
            if a.arcs.is_some() || a.rounded.is_some() || a.corner.is_some() || a.chamfer.is_some() {
                Err(Refused("boolean/ssi-row-unavailable:plane×curved/A0".into()))
            } else { Ok(a.clone()) }
        }
        crate::analytic::Solid::Columns(_)
        | crate::analytic::Solid::PrismHoles(_)
        | crate::analytic::Solid::PrismStack(_)
        | crate::analytic::Solid::Revolved(_)
        | crate::analytic::Solid::Placed(_)
        | crate::analytic::Solid::Cylinder(_)
        | crate::analytic::Solid::Conical(_)
        | crate::analytic::Solid::Coaxial(_)
        | crate::analytic::Solid::Bicylinder(_)
        | crate::analytic::Solid::CylinderTee(_)
        | crate::analytic::Solid::Spherical(_)
        | crate::analytic::Solid::Axial(_)
        | crate::analytic::Solid::Lens(_)
        | crate::analytic::Solid::Perforated(_)
        | crate::analytic::Solid::PerforatedChamfer(_) =>
            Err(Refused("boolean/ssi-row-unavailable:plane×curved/A0".into())),
    }).collect()
}

/// Exact source adapter used by output identity tracking as well as replay.
pub(crate) fn operand_model(a: &Audited) -> R<Model> {
    if candidate(&a.body) { return audit(&a.body.clone().check().map_err(|_| no("operand-check"))?).map(|(_,m)|m); }
    let (body, root) = crate::planar_boolean::source_dag(a.body.key.clone(), 0, &[a.clone()])?;
    crate::planar_boolean::model_at(&body, body.constructions[root].parents[0].0 as usize, a.frame.exact_frame()?)
}

pub(crate) fn replay_at(body:&Body, root:usize)->R<Model> { CACHE.with(|c| {let mut c=c.borrow_mut();let ids=c.keys(body,root)?;c.replay(body,root,&ids,&mut 512)}) }
