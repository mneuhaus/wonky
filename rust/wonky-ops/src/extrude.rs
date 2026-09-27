//! Perpendicular BLIND extrusion of one sketch region into a WC0 v3 body.
//!
//! The body lives in the sketch's `Frame::Interpreter` (source coordinates
//! (u, v, w), w along the sketch normal), so every coordinate is an input value
//! and nothing is computed: a vertex is (u, v, w) with (u, v) a region vertex
//! exactly as the interpreter passed it and w in {0, +-depth} exactly. The side
//! faces are therefore exactly planar (vertical quads) in every variant frame,
//! including a skew one whose axes are not exactly orthonormal in binary64.
//!
//! One face per profile edge, no merging of collinear edges (a merge needs a
//! construction proof). Face loops run counterclockwise about the outward
//! normal; `Face::forward` is true, so the carrier normal is the outward one.
use crate::affine::Affine;
use wonky_contract::*;
use std::result::Result;
use wonky_num::P2;
use wonky_sketch::region::RegionLoop;

/// A named refusal of the extrusion (never a silent approximation).
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    /// A side face's carrier normal (dv, -du, 0) is not representable exactly:
    /// the edge is neither axis-parallel in the sketch nor has exact binary64
    /// coordinate differences. Sloped edges between such coordinates need a
    /// carrier representation WC0 does not have yet.
    LateralNormalNotExact { edge: usize },
    /// The depth is not a positive finite length.
    Depth,
    /// A value is outside the transport contract (NaN, range) or the contract
    /// check failed.
    Contract(String),
}

fn b(x: f64) -> Result<Binary64, Refusal> {
    Binary64::new(x).map_err(|e| Refusal::Contract(format!("{e:?}")))
}
fn v(p: [f64; 3]) -> Result<Vector3, Refusal> {
    Ok([b(p[0])?, b(p[1])?, b(p[2])?])
}
fn unit_domain() -> Result<Domain, Refusal> {
    Ok(Domain {
        lower: Limit::Finite { value: b(0.0)?, closed: true },
        upper: Limit::Finite { value: b(1.0)?, closed: true },
    })
}

/// Exact difference a - b, if representable (TwoSum error term zero; inputs
/// are finite, so the difference is too, or the guard reports it).
fn exact_difference(a: f64, b: f64) -> Option<f64> {
    let mut g = wonky_num::expansion::Guard::new();
    let (s, e) = wonky_num::expansion::two_sum(a, -b, &mut g);
    (e == 0.0 && g.exact()).then_some(s)
}

/// The side face over edge p -> q: exact outward normal (dv, -du, 0) and in-plane
/// x (du, dv, 0), both scaled freely (only directions matter), and the chart
/// length |q - p| when it is an exact binary64 value.
fn side_axes(p: P2, q: P2, edge: usize) -> Result<([f64; 3], [f64; 3], Option<f64>), Refusal> {
    let du = exact_difference(q.x, p.x);
    let dv = exact_difference(q.y, p.y);
    // Distinct binary64 values have a nonzero rounded difference (gradual
    // underflow), so its sign is the exact direction.
    let sign = |a: f64, b: f64| (a - b).signum();
    if p.y == q.y {
        // Parallel to u: the direction is the sign of du, exact regardless of du.
        let s = sign(q.x, p.x);
        return Ok(([0.0, -s, 0.0], [s, 0.0, 0.0], du.map(f64::abs)));
    }
    if p.x == q.x {
        let s = sign(q.y, p.y);
        return Ok(([s, 0.0, 0.0], [0.0, s, 0.0], dv.map(f64::abs)));
    }
    match (du, dv) {
        (Some(du), Some(dv)) => Ok(([dv, -du, 0.0], [du, dv, 0.0], None)),
        _ => Err(Refusal::LateralNormalNotExact { edge }),
    }
}

/// Inputs of one extrusion, all as the interpreter passed them.
pub struct Prism<'a> {
    pub key: BodyKey,
    /// Source id of the interpreter coordinate system (the world root frame).
    pub source: [u32; 4],
    /// The sketch plane as an interpreter frame: origin (m), x axis, normal z.
    pub frame: Affine,
    /// The sketch's line segments [u0, v0, u1, v1] (m), in input order.
    pub segments: &'a [[f64; 4]],
    /// The region to extrude (a loop of `wonky_sketch::region::lines_region`).
    pub region: &'a RegionLoop,
    /// BLIND depth (m), > 0.
    pub depth: f64,
    /// Extrude against the sketch normal (w in [-depth, 0]) instead of along it.
    pub reverse: bool,
}

pub fn blind_prism(p: &Prism<'_>) -> Result<Body, Refusal> {
    if !(p.depth.is_finite() && p.depth > 0.0) {
        return Err(Refusal::Depth);
    }
    let points = &p.region.points;
    let n = points.len();
    #[cfg(feature = "plant_depth_ulp")]
    let depth = p.depth.next_up();
    #[cfg(not(feature = "plant_depth_ulp"))]
    let depth = p.depth;
    let (lo, hi) = if p.reverse { (-depth, 0.0) } else { (0.0, depth) };
    let mut body = Body {
        key: p.key.clone(),
        frames: vec![
            Frame::Source { source: p.source },
            Frame::Interpreter { parent: FrameId(0), origin: v(p.frame.origin)?, x: v(p.frame.x)?, z: v(p.frame.z)? },
        ],
        constructions: Vec::new(),
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
    // Provenance (lineage only; WC0 rules 1-3 cannot certify an extrusion, so
    // no facts are claimed; the prism audit certifies incidence exactly).
    let node = |operation, parents: Vec<NodeId>, parameters: Vec<f64>, frame| -> Result<Construction, Refusal> {
        Ok(Construction { operation, rule_version: 1, parents, parameters: parameters.into_iter().map(b).collect::<Result<_, _>>()?, frame: FrameId(frame) })
    };
    let plane: Vec<f64> = p.frame.origin.iter().chain(&p.frame.x).chain(&p.frame.z).copied().collect();
    body.constructions.push(node(Operation::Interpreter {}, vec![], plane, 0)?);
    body.constructions.push(node(Operation::Interpreter {}, vec![], p.segments.iter().flatten().copied().collect(), 0)?);
    body.constructions.push(node(Operation::Interpreter {}, vec![], vec![depth, if p.reverse { -1.0 } else { 1.0 }], 0)?);
    let region: Vec<f64> = points.iter().flat_map(|q| [q.x, q.y]).collect();
    body.constructions.push(node(Operation::Sketch {}, vec![NodeId(0), NodeId(1)], region, 1)?);
    body.constructions.push(node(Operation::Extrude {}, vec![NodeId(3), NodeId(2)], vec![lo, hi], 1)?);
    let origin = Provenance::Construction { node: NodeId(4) };
    let frame = FrameId(1);
    // Vertices: bottom ring 0..n at w = lo, top ring n..2n at w = hi.
    for w in [lo, hi] {
        for q in points {
            body.vertices.push(Vertex { point: v([q.x, q.y, w])?, frame, provenance: origin.clone() });
        }
    }
    let at = |k: usize, top: bool| (k % n) + if top { n } else { 0 };
    let pt = |k: usize, top: bool| {
        let q = points[k % n];
        [q.x, q.y, if top { hi } else { lo }]
    };
    // Surfaces: 0 bottom (outward -w), 1 top (+w), 2 + i side over edge i.
    let plane_surface = |o: [f64; 3], normal: [f64; 3], x: [f64; 3]| -> Result<Surface, Refusal> {
        Ok(Surface { frame, provenance: origin.clone(), geometry: SurfaceGeometry::Plane { origin: v(o)?, normal: v(normal)?, x: v(x)? } })
    };
    body.surfaces.push(plane_surface([0.0, 0.0, lo], [0.0, 0.0, -1.0], [1.0, 0.0, 0.0])?);
    body.surfaces.push(plane_surface([0.0, 0.0, hi], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0])?);
    let mut chart_lengths = Vec::with_capacity(n);
    for i in 0..n {
        let (normal, x, length) = side_axes(points[i], points[(i + 1) % n], i)?;
        chart_lengths.push(length);
        body.surfaces.push(plane_surface(pt(i, false), normal, x)?);
    }
    // Edges: bottom B_i = 0..n (p_i -> p_i+1 at lo), top T_i = n..2n, vertical
    // V_i = 2n..3n (p_i lo -> p_i hi). Each curve is the line through its ends.
    let mut edge_ends = Vec::with_capacity(3 * n);
    for i in 0..n {
        edge_ends.push((at(i, false), at(i + 1, false), pt(i, false), pt(i + 1, false)));
    }
    for i in 0..n {
        edge_ends.push((at(i, true), at(i + 1, true), pt(i, true), pt(i + 1, true)));
    }
    for i in 0..n {
        edge_ends.push((at(i, false), at(i, true), pt(i, false), pt(i, true)));
    }
    for (k, &(a, bv, pa, pb)) in edge_ends.iter().enumerate() {
        body.curves.push(Curve { frame, provenance: origin.clone(), geometry: CurveGeometry::Line { a: v(pa)?, b: v(pb)? }, domain: unit_domain()?, supports: Vec::new() });
        body.edges.push(Edge { curve: CurveId(k as u32), domain: unit_domain()?, vertices: vec![VertexId(a as u32), VertexId(bv as u32)] });
    }
    // Chart coordinates (s, t) of a point on each carrier (docs/rust-wire-v3.md:
    // origin + s*x^ + t*y^, y^ = n^ x x^). Caps: bottom (u, -v), top (u, v).
    // Side i: (distance along the edge from p_i, w - lo); exact only when the
    // edge length is an exact binary64 (axis-parallel with an exact difference).
    // w - lo is 0 or depth exactly.
    let chart = |surface: usize, q: [f64; 3], far: bool| -> ([f64; 2], bool) {
        match surface {
            0 => ([q[0], -q[1]], true),
            1 => ([q[0], q[1]], true),
            s => {
                let i = s - 2;
                match chart_lengths[i] {
                    Some(l) => ([if far { l } else { 0.0 }, q[2] - lo], true),
                    None => {
                        let (du, dv) = (points[(i + 1) % n].x - points[i].x, points[(i + 1) % n].y - points[i].y);
                        ([if far { du.hypot(dv) } else { 0.0 }, q[2] - lo], false)
                    }
                }
            }
        }
    };
    // Faces with their coedges (edge, forward, which end of the edge is the
    // "far" chart point on a side face).
    let mut face_uses: Vec<(usize, Vec<(usize, bool)>)> = Vec::with_capacity(n + 2);
    face_uses.push((0, (0..n).rev().map(|i| (i, false)).collect()));
    face_uses.push((1, (0..n).map(|i| (n + i, true)).collect()));
    for i in 0..n {
        face_uses.push((2 + i, vec![(i, true), (2 * n + (i + 1) % n, true), (n + i, false), (2 * n + i, false)]));
    }
    #[cfg(feature = "plant_reverse_face")]
    {
        let side = &mut face_uses[2].1;
        side.reverse();
        for u in side.iter_mut() {
            u.1 = !u.1;
        }
    }
    let mut supports: Vec<Vec<Support>> = vec![Vec::new(); 3 * n];
    for (surface, uses) in &face_uses {
        let mut coedges = Vec::with_capacity(uses.len());
        for &(edge, forward) in uses {
            let (_, _, pa, pb) = edge_ends[edge];
            // On side i the far end is at p_{i+1}; the vertical edge V_{i+1} lies
            // entirely at the far end, V_i entirely at the near end.
            let far = |q: [f64; 3]| *surface >= 2 && q[0] == points[(*surface - 2 + 1) % n].x && q[1] == points[(*surface - 2 + 1) % n].y;
            let (ca, exact_a) = chart(*surface, pa, far(pa));
            let (cb, exact_b) = chart(*surface, pb, far(pb));
            let geometry = if exact_a && exact_b {
                PcurveGeometry::Line { a: [b(ca[0])?, b(ca[1])?], b: [b(cb[0])?, b(cb[1])?] }
            } else {
                // The side chart of a sloped edge has an irrational coordinate
                // (the edge length): transported as a sampled chart line with
                // its rounding error stated, never as an exact Line.
                let error = f64::EPSILON * ca[0].abs().max(cb[0].abs());
                PcurveGeometry::Samples {
                    parameters: vec![b(0.0)?, b(1.0)?],
                    points: vec![[b(ca[0])?, b(ca[1])?], [b(cb[0])?, b(cb[1])?]],
                    error: Bound::Estimated { estimate: Estimate { magnitude: b(error)? } },
                }
            };
            let pcurve = PcurveId(body.pcurves.len() as u32);
            body.pcurves.push(Pcurve { curve: CurveId(edge as u32), surface: SurfaceId(*surface as u32), domain: unit_domain()?, geometry });
            supports[edge].push(Support { surface: SurfaceId(*surface as u32), pcurve });
            coedges.push(CoedgeId(body.coedges.len() as u32));
            body.coedges.push(Coedge { edge: EdgeId(edge as u32), forward, pcurve });
        }
        body.loops.push(Loop { outer: true, coedges });
        body.faces.push(Face { surface: SurfaceId(*surface as u32), forward: true, loops: vec![LoopId(body.loops.len() as u32 - 1)] });
    }
    for (curve, s) in body.curves.iter_mut().zip(supports) {
        curve.supports = s;
    }
    body.shells.push(Shell { faces: (0..n + 2).map(|f| FaceId(f as u32)).collect() });
    body.solids.push(Solid { shells: vec![ShellId(0)] });
    body.clone().check().map_err(|e| Refusal::Contract(format!("{e:?}")))?;
    Ok(body)
}
