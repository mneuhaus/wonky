//! AC100 as a hand-assembled WC0 body. This is a WRITER TEST FIXTURE, not the
//! result of any kernel operation: the extrusion of a cubic Bezier arch over its
//! chord, put together face by face from the WC0 records so the spline carriers
//! (`CurveGeometry::BSpline`, `SurfaceGeometry::LinearExtrusion`,
//! `PcurveGeometry::BSpline`, sketch rule 3) and their STEP export can be tested
//! before an operation produces them. Metres.
//!
//! Sketch (plane z = 0): Bezier (0,0) (8,6) (18,6) (26,0) mm and the chord back
//! to the start; area 79.2 mm2; extruded 4 mm along +z: volume 316.8 mm3.
//!
//! Ids: vertices V0 (0,0,0), V1 (26,0,0), V2 (0,0,d), V3 (26,0,d); curve k is the
//! carrier of edge k: 0 bottom chord, 1 top chord, 2 generator V0-V2, 3 generator
//! V1-V3, 4 base spline, 5 top spline. Surfaces: 0 bottom plane, 1 top plane, 2
//! chord wall, 3 the linear extrusion of curve 4.
#![allow(dead_code)]
use wonky_contract::sketch3::{self, Entity};
use wonky_contract::*;

/// Face surface index, its orientation and its outer loop as (edge, forward) coedges.
type FaceUse = (usize, bool, &'static [(usize, bool)]);

pub const WIDTH: f64 = 26e-3;
pub const DEPTH: f64 = 4e-3;
pub const ARCH: [[f64; 2]; 4] = [[0., 0.], [8e-3, 6e-3], [18e-3, 6e-3], [26e-3, 0.]];
pub const KNOTS: [f64; 8] = [0., 0., 0., 0., 1., 1., 1., 1.];
/// Curve ids of the two splines and the id of the extrusion surface.
pub const BASE_SPLINE: usize = 4;
pub const TOP_SPLINE: usize = 5;
pub const EXTRUSION_SURFACE: usize = 3;
/// The sketch and extrusion construction nodes.
pub const SKETCH_NODE: usize = 2;
pub const EXTRUDE_NODE: usize = 3;

pub fn b(x: f64) -> Binary64 {
    Binary64::new(x).unwrap()
}
pub fn v3(p: [f64; 3]) -> Vector3 {
    p.map(b)
}
pub fn v2(p: [f64; 2]) -> Vector2 {
    p.map(b)
}
pub fn domain(lo: f64, hi: f64) -> Domain {
    Domain { lower: Limit::Finite { value: b(lo), closed: true }, upper: Limit::Finite { value: b(hi), closed: true } }
}

fn node(operation: Operation, rule_version: u32, parents: &[u32], parameters: Vec<f64>, frame: u32) -> Construction {
    Construction {
        operation,
        rule_version,
        parents: parents.iter().map(|&n| NodeId(n)).collect(),
        parameters: parameters.into_iter().map(b).collect(),
        frame: FrameId(frame),
    }
}

/// The sketch of AC100: the arch and its chord (rule 3 entity list).
pub fn sketch_parameters() -> Vec<f64> {
    sketch3::encode(0, &[Entity::Bezier { controls: ARCH.to_vec() }, Entity::Line { a: [WIDTH, 0.], b: [0., 0.] }])
}

pub fn ac100() -> Body {
    let frame = FrameId(1);
    let at = |node: usize| Provenance::Construction { node: NodeId(node as u32) };
    let mut body = Body {
        key: BodyKey { id: [7, 100, 0, 0], revision: 1 },
        frames: vec![
            Frame::Source { source: [7, 100, 0, 0] },
            Frame::Interpreter { parent: FrameId(0), origin: v3([0., 0., 0.]), x: v3([1., 0., 0.]), z: v3([0., 0., 1.]) },
        ],
        constructions: vec![
            node(Operation::Interpreter {}, 1, &[], vec![0., 0., 0., 1., 0., 0., 0., 0., 1.], 0),
            node(Operation::Interpreter {}, 1, &[], vec![DEPTH, 1.], 0),
            node(Operation::Sketch {}, 3, &[0], sketch_parameters(), 1),
            node(Operation::Extrude {}, 1, &[SKETCH_NODE as u32, 1], vec![0., DEPTH], 1),
        ],
        vertices: Vec::new(),
        curves: Vec::new(),
        surfaces: Vec::new(),
        pcurves: Vec::new(),
        edges: Vec::new(),
        coedges: Vec::new(),
        loops: Vec::new(),
        faces: Vec::new(),
        shells: Vec::new(),
        solids: Vec::new(),
        facts: Vec::new(),
        budgets: Vec::new(),
    };
    let corners = [[0., 0., 0.], [WIDTH, 0., 0.], [0., 0., DEPTH], [WIDTH, 0., DEPTH]];
    for p in corners {
        body.vertices.push(Vertex { point: v3(p), frame, provenance: at(EXTRUDE_NODE) });
    }
    // Curves and edges. Line k runs between the vertices of edge k.
    let ends: [[usize; 2]; 6] = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 1], [2, 3]];
    let spline = |z: f64| CurveGeometry::BSpline {
        degree: 3,
        knots: KNOTS.map(b).to_vec(),
        controls: ARCH.iter().map(|p| v3([p[0], p[1], z])).collect(),
        weights: Vec::new(),
        periodic: false,
    };
    for (k, [s, t]) in ends.into_iter().enumerate() {
        let (geometry, provenance) = match k {
            BASE_SPLINE => (spline(0.), at(SKETCH_NODE)),
            TOP_SPLINE => (spline(DEPTH), at(EXTRUDE_NODE)),
            _ => (CurveGeometry::Line { a: v3(corners[s]), b: v3(corners[t]) }, at(EXTRUDE_NODE)),
        };
        body.curves.push(Curve { frame, provenance, geometry, domain: domain(0., 1.), supports: Vec::new() });
        body.edges.push(Edge { curve: CurveId(k as u32), domain: domain(0., 1.), vertices: vec![VertexId(s as u32), VertexId(t as u32)] });
    }
    let plane = |origin: [f64; 3], normal: [f64; 3]| Surface {
        frame,
        provenance: at(EXTRUDE_NODE),
        geometry: SurfaceGeometry::Plane { origin: v3(origin), normal: v3(normal), x: v3([1., 0., 0.]) },
    };
    body.surfaces.push(plane([0., 0., 0.], [0., 0., -1.]));
    body.surfaces.push(plane([0., 0., DEPTH], [0., 0., 1.]));
    body.surfaces.push(plane([0., 0., 0.], [0., -1., 0.]));
    body.surfaces.push(Surface {
        frame,
        provenance: at(EXTRUDE_NODE),
        geometry: SurfaceGeometry::LinearExtrusion { curve: CurveId(BASE_SPLINE as u32), direction: v3([0., 0., 1.]) },
    });
    // Chart of a point on each plane: bottom (x, -y), top (x, y), chord wall (x, z).
    // `0. - y` keeps +0 where -y would be -0.
    let chart = |surface: usize, p: [f64; 3]| -> [f64; 2] {
        match surface {
            0 => [p[0], 0. - p[1]],
            1 => [p[0], p[1]],
            _ => [p[0], p[2]],
        }
    };
    // Coedge lists (edge, forward) per face, all outward-counterclockwise.
    let faces: [FaceUse; 4] = [
        (0, true, &[(4, true), (0, false)]),
        (1, true, &[(1, true), (5, false)]),
        (2, true, &[(0, true), (3, true), (1, false), (2, false)]),
        (3, false, &[(4, false), (2, true), (5, true), (3, false)]),
    ];
    for (surface, forward, uses) in faces {
        let mut coedges = Vec::new();
        for &(edge, edge_forward) in uses {
            let [s, t] = ends[edge];
            let geometry = if surface == EXTRUSION_SURFACE {
                // Chart (u, v): u the spline parameter, v metres along +z.
                if edge == BASE_SPLINE || edge == TOP_SPLINE {
                    let v = if edge == BASE_SPLINE { 0. } else { DEPTH };
                    PcurveGeometry::Line { a: v2([0., v]), b: v2([1., v]) }
                } else {
                    let u = if edge == 2 { 0. } else { 1. };
                    PcurveGeometry::Line { a: v2([u, 0.]), b: v2([u, DEPTH]) }
                }
            } else if edge == BASE_SPLINE || edge == TOP_SPLINE {
                let z = if edge == BASE_SPLINE { 0. } else { DEPTH };
                PcurveGeometry::BSpline {
                    degree: 3,
                    knots: KNOTS.map(b).to_vec(),
                    controls: ARCH.iter().map(|p| v2(chart(surface, [p[0], p[1], z]))).collect(),
                    weights: Vec::new(),
                }
            } else {
                PcurveGeometry::Line { a: v2(chart(surface, corners[s])), b: v2(chart(surface, corners[t])) }
            };
            let pcurve = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve { curve: CurveId(edge as u32), surface: SurfaceId(surface as u32), domain: domain(0., 1.), geometry });
            body.curves[edge].supports.push(Support { surface: SurfaceId(surface as u32), pcurve });
            coedges.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge { edge: EdgeId(edge as u32), forward: edge_forward, pcurve });
        }
        body.loops.push(Loop { outer: true, coedges });
        body.faces.push(Face { surface: SurfaceId(surface as u32), forward, loops: vec![LoopId(body.loops.len() as u32 - 1)] });
    }
    body.shells.push(Shell { faces: (0..4).map(FaceId).collect() });
    body.solids.push(Solid { shells: vec![ShellId(0)] });
    body
}
