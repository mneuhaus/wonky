//! Exact rectilinear subfamily of planar Boolean, in one construction frame.
//!
//! Arrangement planes are operand coordinates, not rounded intersections. Cells
//! are classified by endpoint ordering, never by a sampled midpoint or a metric
//! tolerance. Coplanar tiles cancel their common edges before face loops are
//! built. The existing planar topology checker supplies the vertex-link check.
//! Non-orthogonal operands/unequal frames use the rational planar arrangement;
//! its unrepresentable constructions refuse, never snap.
use crate::rounding::{finite_ball, norm_ball};
use wonky_num::ball::{Iv, Scalar};
use crate::affine::Affine;
use crate::polyhedron::{Audited, Refused};
use crate::rounding::round;
use std::collections::{BTreeMap, BTreeSet};
use std::result::Result;
use wonky_contract::*;
use wonky_num::expansion::{mul, neg, sum, Guard};

type R<T> = Result<T, Refused>;
type I3 = [usize; 3];
type Box3 = [[f64; 3]; 2];
fn err(s: &str) -> Refused {
    Refused(format!("orthogonal/{s}"))
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| err("numeric-range"))
}
fn v(x: [f64; 3]) -> R<Vector3> {
    Ok([b(x[0])?, b(x[1])?, b(x[2])?])
}
fn get(x: &Vector3) -> [f64; 3] {
    x.each_ref().map(|c| c.get())
}
fn domain() -> Domain {
    Domain {
        lower: Limit::Finite {
            value: Binary64::new(0.).unwrap(),
            closed: true,
        },
        upper: Limit::Finite {
            value: Binary64::new(1.).unwrap(),
            closed: true,
        },
    }
}

#[derive(Clone, Debug)]
pub struct Cells {
    pub boxes: Vec<Box3>,
}

#[derive(Clone)]
enum Expr {
    Box(Box3),
    Op(u8, Vec<Expr>),
}
impl Expr {
    fn coordinates(&self, axes: &mut [Vec<f64>; 3]) {
        match self {
            Self::Box(b) => {
                for k in 0..3 {
                    axes[k].extend([b[0][k], b[1][k]]);
                }
            }
            Self::Op(_, es) => {
                for e in es {
                    e.coordinates(axes);
                }
            }
        }
    }
    fn contains(&self, b: Box3) -> bool {
        match self {
            Self::Box(a) => (0..3).all(|k| a[0][k] <= b[0][k] && b[1][k] <= a[1][k]),
            Self::Op(0, es) => es.iter().any(|e| e.contains(b)),
            Self::Op(1, es) => es[0].contains(b) && !es[1..].iter().any(|e| e.contains(b)),
            Self::Op(2, es) => es.iter().all(|e| e.contains(b)),
            _ => false,
        }
    }
}

// The construction grammar is deliberately small and replayable. An Extrude
// with no parameters and one Interpreter parent (six corner values) is a
// coordinate prism. Boolean's one parameter is 0 union, 1 difference, 2 common.
fn expression(nodes: &[Construction], root: usize, fuel: &mut usize) -> R<Expr> {
    if *fuel == 0 {
        return Err(err("construction-budget"));
    }
    *fuel -= 1;
    let n = nodes
        .get(root)
        .ok_or_else(|| err("construction-reference"))?;
    if n.rule_version != 1 {
        return Err(err("construction-version"));
    }
    if n.operation == (Operation::Extrude {}) && n.parameters.is_empty() && n.parents.len() == 1 {
        let p = nodes
            .get(n.parents[0].0 as usize)
            .ok_or_else(|| err("construction-reference"))?;
        if p.operation != (Operation::Interpreter {})
            || !p.parents.is_empty()
            || p.parameters.len() != 6
        {
            return Err(err("box-input"));
        }
        let a: Vec<_> = p.parameters.iter().map(|x| x.get()).collect();
        let box3 = [[a[0], a[1], a[2]], [a[3], a[4], a[5]]];
        if !(0..3).all(|k| box3[0][k] < box3[1][k]) {
            return Err(err("empty-prism"));
        }
        return Ok(Expr::Box(box3));
    }
    if n.operation == (Operation::Intersection {})
        && n.parents.len() == 1
        && n.parameters.len() == 1
    {
        let parent = n.parents[0].0 as usize;
        if parent >= root {
            return Err(err("construction-order"));
        }
        let e = expression(nodes, parent, fuel)?;
        let (axes, components) = arrangement(&e)?;
        let index = n.parameters[0].get();
        if index < 0. || index.fract() != 0. {
            return Err(err("component-index"));
        }
        let c = components
            .get(index as usize)
            .ok_or_else(|| err("component-index"))?;
        return Ok(Expr::Op(
            0,
            c.iter().map(|&i| Expr::Box(cell_box(&axes, i))).collect(),
        ));
    }
    if n.operation == (Operation::Shell {}) {
        if n.parents.len() != 1 || n.parameters.len() != 2 || n.parents[0].0 as usize >= root {
            return Err(err("shell-lineage"));
        }
        let Expr::Box(bounds) = expression(nodes, n.parents[0].0 as usize, fuel)? else {
            return Err(err("shell-non-box-source"));
        };
        let side = n.parameters[1].get();
        if !(0. ..6.).contains(&side) || side.fract() != 0. { return Err(err("shell-side")); }
        let inner = crate::planar_shell::cavity(bounds, n.parameters[0].get(), side as usize)?;
        return Ok(Expr::Op(1, vec![Expr::Box(bounds), Expr::Box(inner)]));
    }
    if n.operation != (Operation::Boolean {}) || n.parameters.len() != 1 || n.parents.len() < 2 {
        return Err(err("unsupported-construction"));
    }
    let op = n.parameters[0].get();
    if op != 0. && op != 1. && op != 2. {
        return Err(err("boolean-operation"));
    }
    let es = n
        .parents
        .iter()
        .map(|p| {
            if p.0 as usize >= root {
                return Err(err("construction-order"));
            }
            expression(nodes, p.0 as usize, fuel)
        })
        .collect::<R<Vec<_>>>()?;
    Ok(Expr::Op(op as u8, es))
}

pub(crate) fn root(body: &Body) -> R<usize> {
    let Some(Provenance::Construction { node }) = body.vertices.first().map(|v| &v.provenance)
    else {
        return Err(err("no-construction"));
    };
    Ok(node.0 as usize)
}

pub fn cuboid(key: BodyKey, a: [f64; 3], c: [f64; 3]) -> R<Body> {
    let lo = [0, 1, 2].map(|k| a[k].min(c[k]));
    let hi = [0, 1, 2].map(|k| a[k].max(c[k]));
    if !(0..3).all(|k| lo[k] < hi[k]) {
        return Err(err("empty-prism"));
    }
    let nodes = vec![
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: lo.into_iter().chain(hi).map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Extrude {},
            rule_version: 1,
            parents: vec![NodeId(0)],
            parameters: vec![],
            frame: FrameId(1),
        },
    ];
    let mut bodies = construct(key, Affine::IDENTITY, nodes, 1)?;
    bodies.pop().ok_or_else(|| err("empty-result"))
}

pub fn transform(body: &Audited, frame: Affine) -> R<Body> {
    if crate::planar_boolean::candidate(&body.body) { return Err(err("arranged-placement-unsupported")); }
    // A placement is symbolic: do not round world-space vertices, and do not
    // round a composed frame into another authoritative interpreter input.
    if body.frame != Affine::IDENTITY {
        return Err(err("composed-placement"));
    }
    if frame
        .orthonormality_defect()
        .map_err(|_| err("placement-range"))?
        > 1e-12
    {
        return Err(err("non-rigid-placement"));
    }
    let mut out = body.body.clone();
    let fid = out.vertices[0].frame.0 as usize;
    out.frames[fid] = Frame::Interpreter {
        parent: FrameId(0),
        origin: v(frame.origin)?,
        x: v(frame.x)?,
        z: v(frame.z)?,
    };
    out.key.revision = out
        .key
        .revision
        .checked_add(1)
        .ok_or_else(|| err("revision-range"))?;
    Ok(out)
}

pub fn boolean(key: BodyKey, op: u8, bodies: &[Audited]) -> R<Vec<Body>> {
    if bodies.len() < 2 || op > 2 {
        return Err(err("boolean-arguments"));
    }
    // Keep the coordinate-grid fast path when its exact preconditions hold.
    // Other planar operands go through rational plane arrangement, not a snap.
    if bodies.iter().any(|a| a.orthogonal.is_none())
        || bodies.iter().any(|a| a.frame != bodies[0].frame)
    {
        return crate::planar_boolean::boolean(key, op, bodies);
    }
    let frame = bodies[0].frame.as_affine()?;
    let mut nodes = Vec::new();
    let mut parents = Vec::new();
    for a in bodies {
        let offset = nodes.len() as u32;
        parents.push(NodeId(root(&a.body)? as u32 + offset));
        nodes.extend(a.body.constructions.iter().cloned().map(|mut c| {
            for p in &mut c.parents {
                p.0 += offset;
            }
            c
        }));
    }
    let root = nodes.len();
    nodes.push(Construction {
        operation: Operation::Boolean {},
        rule_version: 1,
        parents,
        parameters: vec![b(op as f64)?],
        frame: FrameId(1),
    });
    construct(key, frame, nodes, root)
}

fn arrangement(expr: &Expr) -> R<([Vec<f64>; 3], Vec<BTreeSet<I3>>)> {
    let mut axes: [Vec<f64>; 3] = Default::default();
    expr.coordinates(&mut axes);
    for a in &mut axes {
        a.sort_by(f64::total_cmp);
        a.dedup_by(|a, b| *a == *b);
    }
    if axes
        .iter()
        .map(|a| a.len().saturating_sub(1))
        .product::<usize>()
        > 4096
    {
        return Err(err("arrangement-budget"));
    }
    let mut occupied = BTreeSet::new();
    for x in 0..axes[0].len() - 1 {
        for y in 0..axes[1].len() - 1 {
            for z in 0..axes[2].len() - 1 {
                let c = [x, y, z];
                if expr.contains(cell_box(&axes, c)) {
                    occupied.insert(c);
                }
            }
        }
    }
    let mut components = Vec::new();
    while let Some(&seed) = occupied.first() {
        occupied.remove(&seed);
        let mut todo = vec![seed];
        let mut component = BTreeSet::from([seed]);
        while let Some(c) = todo.pop() {
            for axis in 0..3 {
                for delta in [-1, 1] {
                    if let Some(n) = neighbor(c, axis, delta) {
                        if occupied.remove(&n) {
                            component.insert(n);
                            todo.push(n);
                        }
                    }
                }
            }
        }
        components.push(component);
    }
    // Edge/vertex contact between components is not a manifold solid. It is
    // decided on the exact arrangement indices, even for sub-ulp world gaps.
    for i in 0..components.len() {
        for j in 0..i {
            for a in &components[i] {
                for c in &components[j] {
                    if (0..3).all(|k| a[k].abs_diff(c[k]) <= 1) {
                        return Err(err("non-manifold-result"));
                    }
                }
            }
        }
    }
    Ok((axes, components))
}
fn cell_box(axes: &[Vec<f64>; 3], c: I3) -> Box3 {
    [
        [0, 1, 2].map(|k| axes[k][c[k]]),
        [0, 1, 2].map(|k| axes[k][c[k] + 1]),
    ]
}
fn neighbor(mut c: I3, axis: usize, delta: i32) -> Option<I3> {
    c[axis] = c[axis].checked_add_signed(delta as isize)?;
    Some(c)
}

#[derive(Clone)]
struct Patch {
    axis: usize,
    level: usize,
    positive: bool,
    loops: Vec<Vec<I3>>,
}

fn patches(cells: &BTreeSet<I3>) -> R<Vec<Patch>> {
    // Group exposed tiles by their outward carrier plane.
    let mut planes: BTreeMap<(usize, usize, bool), BTreeSet<[usize; 2]>> = BTreeMap::new();
    for &c in cells {
        for axis in 0..3 {
            for positive in [false, true] {
                if neighbor(c, axis, if positive { 1 } else { -1 })
                    .is_some_and(|n| cells.contains(&n))
                {
                    continue;
                }
                planes
                    .entry((axis, c[axis] + usize::from(positive), positive))
                    .or_default()
                    .insert([c[(axis + 1) % 3], c[(axis + 2) % 3]]);
            }
        }
    }
    let mut out = Vec::new();
    for ((axis, level, positive), mut tiles) in planes {
        // Separate disconnected coplanar faces, not a multi-outer-loop face.
        while let Some(&seed) = tiles.first() {
            tiles.remove(&seed);
            let mut todo = vec![seed];
            let mut component = vec![seed];
            while let Some(c) = todo.pop() {
                for k in 0..2 {
                    for d in [-1, 1] {
                        let mut n = c;
                        if let Some(v) = n[k].checked_add_signed(d) {
                            n[k] = v;
                            if tiles.remove(&n) {
                                todo.push(n);
                                component.push(n);
                            }
                        }
                    }
                }
            }
            let mut edges = BTreeSet::new();
            for [u, w] in component {
                let p = [[u, w], [u + 1, w], [u + 1, w + 1], [u, w + 1]];
                for i in 0..4 {
                    let (a, b) = (p[i], p[(i + 1) % 4]);
                    if !edges.remove(&(b, a)) {
                        edges.insert((a, b));
                    }
                }
            }
            let mut next = BTreeMap::new();
            for (a, b) in edges {
                if next.insert(a, b).is_some() {
                    return Err(err("non-manifold-result"));
                }
            }
            let mut loops = Vec::new();
            while let Some((&seed, _)) = next.first_key_value() {
                let mut lp = Vec::new();
                let mut at = seed;
                loop {
                    lp.push(at);
                    at = next.remove(&at).ok_or_else(|| err("boundary-chain"))?;
                    if at == seed {
                        break;
                    }
                }
                if lp.len() < 4 {
                    return Err(err("boundary-loop"));
                }
                // Remove only provably collinear intermediate lattice points.
                let keep: Vec<_> = (0..lp.len())
                    .filter(|&k| {
                        let (a, b, c) = (
                            lp[(k + lp.len() - 1) % lp.len()],
                            lp[k],
                            lp[(k + 1) % lp.len()],
                        );
                        !((a[0] == b[0] && b[0] == c[0]) || (a[1] == b[1] && b[1] == c[1]))
                    })
                    .map(|k| lp[k])
                    .collect();
                let area: i128 = (0..keep.len())
                    .map(|k| {
                        let (a, b) = (keep[k], keep[(k + 1) % keep.len()]);
                        a[0] as i128 * b[1] as i128 - a[1] as i128 * b[0] as i128
                    })
                    .sum();
                let mut lp: Vec<I3> = keep
                    .into_iter()
                    .map(|q| {
                        let mut p = [0; 3];
                        p[axis] = level;
                        p[(axis + 1) % 3] = q[0];
                        p[(axis + 2) % 3] = q[1];
                        p
                    })
                    .collect();
                if !positive {
                    lp.reverse();
                }
                loops.push((area > 0, lp));
            }
            if loops.iter().filter(|(outer, _)| *outer).count() != 1 {
                return Err(err("non-manifold-result"));
            }
            loops.sort_by_key(|(outer, _)| !*outer);
            out.push(Patch {
                axis,
                level,
                positive,
                loops: loops.into_iter().map(|(_, l)| l).collect(),
            });
        }
    }
    // A third face may end on a long edge. Split at every such vertex so each
    // geometric edge is shared by the same pair of endpoint IDs.
    let vertices: BTreeSet<I3> = out
        .iter()
        .flat_map(|p| p.loops.iter().flatten().copied())
        .collect();
    for patch in &mut out {
        for lp in &mut patch.loops {
            let mut split = Vec::new();
            for k in 0..lp.len() {
                let (a, c) = (lp[k], lp[(k + 1) % lp.len()]);
                let axis = (0..3)
                    .find(|&i| a[i] != c[i])
                    .ok_or_else(|| err("zero-edge"))?;
                let mut between: Vec<_> = vertices
                    .iter()
                    .copied()
                    .filter(|p| {
                        (0..3).all(|i| {
                            if i == axis {
                                p[i] >= a[i].min(c[i]) && p[i] <= a[i].max(c[i])
                            } else {
                                p[i] == a[i]
                            }
                        })
                    })
                    .collect();
                between.sort_by_key(|p| p[axis]);
                if a[axis] > c[axis] {
                    between.reverse();
                }
                between.pop();
                split.extend(between);
            }
            *lp = split;
        }
    }
    Ok(out)
}

pub(crate) fn construct(key: BodyKey, frame: Affine, nodes: Vec<Construction>, root: usize) -> R<Vec<Body>> {
    let expr = expression(&nodes, root, &mut 2048)?;
    let (_, components) = arrangement(&expr)?;
    if components.is_empty() {
        return Err(err("empty-result"));
    }
    components
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let mut lineage = nodes.clone();
            let selected = if components.len() > 1 {
                let selected = lineage.len();
                lineage.push(Construction {
                    operation: Operation::Intersection {},
                    rule_version: 1,
                    parents: vec![NodeId(root as u32)],
                    parameters: vec![b(index as f64)?],
                    frame: FrameId(1),
                });
                selected
            } else {
                root
            };
            // Replay with the selected component's reduced grid, so serialization
            // and later Boolean operands represent this body, not all siblings.
            let e = expression(&lineage, selected, &mut 2048)?;
            let (grid, parts) = arrangement(&e)?;
            build_body(
                key.clone(),
                frame,
                lineage,
                selected,
                &grid,
                &patches(&parts[0])?,
            )
        })
        .collect()
}
fn build_body(
    key: BodyKey,
    frame: Affine,
    constructions: Vec<Construction>,
    root: usize,
    axes: &[Vec<f64>; 3],
    patches: &[Patch],
) -> R<Body> {
    let provenance = Provenance::Construction {
        node: NodeId(root as u32),
    };
    let fid = FrameId(1);
    let mut body = Body {
        key,
        frames: vec![
            Frame::Source { source: [0; 4] },
            Frame::Interpreter {
                parent: FrameId(0),
                origin: v(frame.origin)?,
                x: v(frame.x)?,
                z: v(frame.z)?,
            },
        ],
        constructions,
        vertices: vec![],
        curves: vec![],
        surfaces: vec![],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
        facts: vec![],
        budgets: vec![],
    };
    let mut vertex_ids = BTreeMap::new();
    let mut edge_ids = BTreeMap::new();
    for patch in patches {
        let normal = [0, 1, 2].map(|k| {
            if k == patch.axis {
                if patch.positive {
                    1.
                } else {
                    -1.
                }
            } else {
                0.
            }
        });
        let origin = [0, 1, 2].map(|k| {
            if k == patch.axis {
                axes[k][patch.level]
            } else {
                0.
            }
        });
        let u = (patch.axis + 1) % 3;
        let w = (patch.axis + 2) % 3;
        let x = [0, 1, 2].map(|k| if k == u { 1. } else { 0. });
        let sid = SurfaceId(body.surfaces.len() as u32);
        body.surfaces.push(Surface {
            frame: fid,
            provenance: provenance.clone(),
            geometry: SurfaceGeometry::Plane {
                origin: v(origin)?,
                normal: v(normal)?,
                x: v(x)?,
            },
        });
        let mut face_loops = Vec::new();
        for (li, lp) in patch.loops.iter().enumerate() {
            let mut vids = Vec::new();
            for p in lp {
                let id = *vertex_ids.entry(*p).or_insert_with(|| {
                    let id = body.vertices.len() as u32;
                    body.vertices.push(Vertex {
                        point: v([0, 1, 2].map(|k| axes[k][p[k]])).expect("checked coordinate"),
                        frame: fid,
                        provenance: provenance.clone(),
                    });
                    id
                });
                vids.push(id);
            }
            let mut coedges = Vec::new();
            for k in 0..vids.len() {
                let (a, c) = (vids[k], vids[(k + 1) % vids.len()]);
                let pair = (a.min(c), a.max(c));
                let eid = *edge_ids.entry(pair).or_insert_with(|| {
                    let id = body.edges.len() as u32;
                    body.curves.push(Curve {
                        frame: fid,
                        provenance: provenance.clone(),
                        geometry: CurveGeometry::Line {
                            a: body.vertices[pair.0 as usize].point,
                            b: body.vertices[pair.1 as usize].point,
                        },
                        domain: domain(),
                        supports: vec![],
                    });
                    body.edges.push(Edge {
                        curve: CurveId(id),
                        domain: domain(),
                        vertices: vec![VertexId(pair.0), VertexId(pair.1)],
                    });
                    id
                });
                let chart = |id: u32| -> R<[Binary64; 2]> {
                    let p = get(&body.vertices[id as usize].point);
                    Ok([b(p[u])?, b(if patch.positive { p[w] } else { -p[w] })?])
                };
                let pc = PcurveId(body.pcurves.len() as u32);
                body.pcurves.push(Pcurve {
                    curve: CurveId(eid),
                    surface: sid,
                    domain: domain(),
                    geometry: PcurveGeometry::Line {
                        a: chart(pair.0)?,
                        b: chart(pair.1)?,
                    },
                });
                body.curves[eid as usize].supports.push(Support {
                    surface: sid,
                    pcurve: pc,
                });
                coedges.push(CoedgeId(body.coedges.len() as u32));
                body.coedges.push(Coedge {
                    edge: EdgeId(eid),
                    forward: a == pair.0,
                    pcurve: pc,
                });
            }
            face_loops.push(LoopId(body.loops.len() as u32));
            body.loops.push(Loop {
                outer: li == 0,
                coedges,
            });
        }
        body.faces.push(Face {
            surface: sid,
            forward: true,
            loops: face_loops,
        });
    }
    // Shells are edge-connected face components; a cavity is kept as an inward
    // shell of this solid, never emitted as an independent positive body.
    let mut owners: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    for (i, f) in body.faces.iter().enumerate() {
        for l in &f.loops {
            for c in &body.loops[l.0 as usize].coedges {
                owners
                    .entry(body.coedges[c.0 as usize].edge.0)
                    .or_default()
                    .push(i);
            }
        }
    }
    if owners.values().any(|o| o.len() != 2) {
        return Err(err("non-manifold-result"));
    }
    let mut rest: BTreeSet<usize> = (0..body.faces.len()).collect();
    while let Some(&seed) = rest.first() {
        rest.remove(&seed);
        let mut todo = vec![seed];
        let mut faces = vec![FaceId(seed as u32)];
        while let Some(i) = todo.pop() {
            for os in owners.values().filter(|o| o.contains(&i)) {
                for &j in os {
                    if rest.remove(&j) {
                        todo.push(j);
                        faces.push(FaceId(j as u32));
                    }
                }
            }
        }
        body.shells.push(Shell { faces });
    }
    body.solids.push(Solid {
        shells: (0..body.shells.len()).map(|i| ShellId(i as u32)).collect(),
    });
    // Reuse K0's general closed vertex-link checker. This catches pinches
    // within a connected cell component, not just contacts between components.
    use crate::planar::model as m;
    let solid = m::Solid {
        vertices: body
            .vertices
            .iter()
            .map(|v| {
                let p = get(&v.point);
                wonky_num::v3(p[0], p[1], p[2])
            })
            .collect(),
        edges: body
            .edges
            .iter()
            .map(|e| m::Edge {
                start: e.vertices[0].0,
                end: e.vertices[1].0,
                curve: m::Curve::Round,
                same_sense: true,
            })
            .collect(),
        faces: body
            .faces
            .iter()
            .map(|f| m::Face {
                surface: m::Surface::Other,
                same_sense: f.forward,
                loops: f
                    .loops
                    .iter()
                    .map(|l| {
                        let lp = &body.loops[l.0 as usize];
                        m::Loop {
                            outer: lp.outer,
                            uses: lp
                                .coedges
                                .iter()
                                .map(|c| {
                                    let co = &body.coedges[c.0 as usize];
                                    m::Use {
                                        edge: co.edge.0,
                                        forward: co.forward,
                                    }
                                })
                                .collect(),
                        }
                    })
                    .collect(),
            })
            .collect(),
    };
    if !crate::planar::topo::contact_valid(&solid) {
        return Err(err("non-manifold-result"));
    }
    body.clone().check().map_err(|_| err("contract"))?;
    Ok(body)
}

/// A boundary is accepted only when it is exactly the reconstructed boundary
/// of one connected component of its recorded construction, including pcurves,
/// shell orientation, edge use and holes. Metadata is not a success token.
pub fn audit(body: &Body, frame: Affine) -> R<Cells> {
    let root = root(body)?;
    let expr = expression(&body.constructions, root, &mut 2048)?;
    let (axes, components) = arrangement(&expr)?;
    for c in components {
        let candidate = build_body(
            body.key.clone(),
            frame,
            body.constructions.clone(),
            root,
            &axes,
            &patches(&c)?,
        )?;
        if &candidate == body {
            return Ok(Cells {
                boxes: c.into_iter().map(|i| cell_box(&axes, i)).collect(),
            });
        }
    }
    Err(err("boundary-not-construction"))
}

pub fn is_candidate(body: &Body) -> bool {
    root(body)
        .ok()
        .and_then(|i| body.constructions.get(i))
        .is_some_and(|n| {
            n.operation == (Operation::Boolean {})
                || n.operation == (Operation::Shell {})
                || n.operation == (Operation::Intersection {})
                || (n.operation == (Operation::Extrude {}) && n.parameters.is_empty())
        })
}

impl Cells {
    pub fn source_bbox(&self) -> Box3 {
        let mut a = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for b in &self.boxes {
            for k in 0..3 {
                a[0][k] = a[0][k].min(b[0][k]);
                a[1][k] = a[1][k].max(b[1][k]);
            }
        }
        a
    }
    /// Source-frame distance to the union; membership uses exact order.
    pub(crate) fn probe(&self, p: [f64; 3]) -> R<(Iv, bool)> {
        let mut best: Option<Iv> = None;
        let mut inside = false;
        for b in &self.boxes {
            inside |= (0..3).all(|k| b[0][k] <= p[k] && p[k] <= b[1][k]);
            let d = [0, 1, 2].map(|k| (Iv::point(b[0][k]) - Iv::point(p[k]))
                .max(Iv::point(p[k]) - Iv::point(b[1][k])).max(Iv::point(0.0)));
            let n = norm_ball(d).map_err(|_| err("probe-range"))?;
            best = Some(match best { Some(a) => a.min(n), None => n });
        }
        Ok((best.ok_or_else(|| err("probe-empty"))?, inside))
    }
    /// Difference before the world placement (avoids catastrophic cancellation
    /// in distant and sub-resolution gaps). The frame defect is disclosed.
    pub fn distance_mm(&self, other: &Self, frame: Affine) -> R<(f64, f64)> {
        let defect = frame
            .orthonormality_defect()
            .map_err(|_| err("distance-frame"))?;
        if defect > 1e-12 {
            return Err(err("distance-non-rigid-frame"));
        }
        let mut best = f64::INFINITY;
        for a in &self.boxes {
            for c in &other.boxes {
                let mut g = Guard::new();
                let mut sq = vec![];
                for k in 0..3 {
                    let d = if a[1][k] < c[0][k] {
                        sum(&[c[0][k]], &[-a[1][k]], &mut g)
                    } else if c[1][k] < a[0][k] {
                        sum(&[a[0][k]], &[-c[1][k]], &mut g)
                    } else {
                        vec![]
                    };
                    sq = sum(&sq, &mul(&d, &d, &mut g), &mut g);
                }
                if !g.exact() {
                    return Err(err("distance-range"));
                }
                best = best.min(round(&sq).map_err(|_| err("distance-range"))?.sqrt() * 1000.);
            }
        }
        let bound = finite_ball(Iv::point(best) * Iv::point(3. * defect + 8. * f64::EPSILON))
            .map_err(|_| err("distance-range"))?.hi();
        if !best.is_finite() || (best != 0.0 && !best.is_normal()) {
            return Err(err("distance-range"));
        }
        Ok((best, bound))
    }
    /// Exact-coordinate bbox extent, rounded once after subtraction and units.
    pub fn extents_mm(&self) -> R<[f64; 3]> {
        let a = self.source_bbox();
        let mut out = [0.; 3];
        let mut g = Guard::new();
        for k in 0..3 {
            let d = sum(&[a[1][k]], &neg(&[a[0][k]]), &mut g);
            out[k] = round(&mul(&d, &[1000.], &mut g)).map_err(|_| err("extent-range"))?;
        }
        if !g.exact() {
            return Err(err("extent-range"));
        }
        Ok(out)
    }
}
