//! Builder for polyhedral drafts: plane faces bounded by straight edges, given
//! as exact vertex cycles. Used by the planar family adapters (P1, P2) and by
//! tests; later strands that emit planar pieces use it too.
//!
//! Vertices are shared by exact key, edges by their unordered vertex pair
//! (between two vertices of a polyhedron there is at most one straight edge).
//! Each coedge gets the exact line piece between its end points in its face's
//! chart. Shells are the edge-connected face components; all shells form one
//! solid. Nothing is decided here: `Draft::check` audits the result.
use super::{
    Bounds, Coedge, CoedgeId, Curve, CurveId, Draft, Edge, EdgeId, Face, FaceId, Label, Loop,
    LoopId, Plane3, Provenance, Shell, ShellId, Solid, Surface, SurfaceId, Vertex, VertexDef,
    VertexId, VertexKey,
};
use crate::frame::Frame;
use crate::{Refused, Result};
use std::collections::BTreeMap;
use wonky_curve::{Carrier, Trimmed};

/// One plane face: its carrier and orientation, and its vertex cycles (outer
/// first, then holes), each in loop order.
#[derive(Clone, Debug)]
pub struct PolyFace {
    pub carrier: Plane3,
    pub forward: bool,
    pub loops: Vec<Vec<VertexDef>>,
    /// Provenance of the carrier (the operand node that defines the plane).
    pub provenance: Provenance,
}

/// A draft of the faces, with topology created by construction node `node`.
pub fn polyhedron(
    placement: Frame,
    label: Label,
    node: u32,
    faces: Vec<PolyFace>,
) -> Result<Draft> {
    build(
        placement,
        label,
        node,
        faces
            .into_iter()
            .map(|f| super::algebraic::RadicalPolyFace {
                carrier: super::algebraic::RadicalPlane3::from(&f.carrier),
                forward: f.forward,
                loops: f.loops,
                provenance: f.provenance,
            })
            .collect(),
    )
}
pub(super) fn build(
    placement: Frame,
    label: Label,
    node: u32,
    faces: Vec<super::algebraic::RadicalPolyFace>,
) -> Result<Draft> {
    let mut d = Draft {
        placement,
        label,
        surfaces: vec![],
        curves: vec![],
        vertices: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
    };
    let created = |slot: usize| Provenance {
        node,
        slot: slot as u32,
    };
    let mut keys: Vec<VertexKey> = vec![];
    let mut vertex_ids: BTreeMap<VertexKey, VertexId> = BTreeMap::new();
    let mut edge_ids: BTreeMap<(VertexId, VertexId), EdgeId> = BTreeMap::new();
    let mut edge_faces: Vec<Vec<usize>> = vec![];
    for (fi, face) in faces.into_iter().enumerate() {
        let surface = SurfaceId(d.surfaces.len() as u32);
        let plane = face.carrier.clone();
        d.surfaces.push(Surface {
            carrier: face.carrier.carrier(),
            provenance: face.provenance,
        });
        let mut loops = vec![];
        for cycle in face.loops {
            let mut ids = vec![];
            for v in cycle {
                let key = v.key()?;
                let id = match vertex_ids.get(&key) {
                    Some(id) => *id,
                    None => {
                        let id = VertexId(d.vertices.len() as u32);
                        d.vertices.push(Vertex {
                            def: v,
                            provenance: created(id.index()),
                        });
                        vertex_ids.insert(key.clone(), id);
                        keys.push(key);
                        id
                    }
                };
                ids.push(id);
            }
            let mut coedges = vec![];
            for k in 0..ids.len() {
                let (a, b) = (ids[k], ids[(k + 1) % ids.len()]);
                let pair = (a.min(b), a.max(b));
                let edge = match edge_ids.get(&pair) {
                    Some(e) => *e,
                    None => {
                        let e = EdgeId(d.edges.len() as u32);
                        let curve = CurveId(d.curves.len() as u32);
                        let (p, q) = (
                            keys[pair.0.index()].coordinates(),
                            keys[pair.1.index()].coordinates(),
                        );
                        d.curves.push(Curve {
                            geometry: super::algebraic::line(
                                p.clone(),
                                super::algebraic::sub(&q, &p),
                            ),
                            provenance: created(curve.index()),
                        });
                        d.edges.push(Edge {
                            curve,
                            bounds: Bounds::Segment([pair.0, pair.1]),
                            provenance: created(e.index()),
                        });
                        edge_ids.insert(pair, e);
                        edge_faces.push(vec![]);
                        e
                    }
                };
                edge_faces[edge.index()].push(fi);
                let chart = |v: VertexId| plane.chart(&keys[v.index()].coordinates());
                let pcurve = Trimmed::new([chart(a)?, chart(b)?], Carrier::Line)
                    .map_err(|r| Refused(r.name()))?;
                let id = CoedgeId(d.coedges.len() as u32);
                d.coedges.push(Coedge {
                    edge,
                    forward: a == pair.0,
                    pcurve,
                    atlas: None,
                    provenance: created(id.index()),
                });
                coedges.push(id);
            }
            let id = LoopId(d.loops.len() as u32);
            d.loops.push(Loop {
                coedges,
                provenance: created(id.index()),
            });
            loops.push(id);
        }
        let id = FaceId(d.faces.len() as u32);
        d.faces.push(Face {
            surface,
            forward: face.forward,
            loops,
            provenance: created(id.index()),
        });
    }
    // Shells: edge-connected face components, in order of their first face.
    let mut shell_of: Vec<Option<usize>> = vec![None; d.faces.len()];
    for seed in 0..d.faces.len() {
        if shell_of[seed].is_some() {
            continue;
        }
        let shell = d.shells.len();
        shell_of[seed] = Some(shell);
        let mut todo = vec![seed];
        let mut members = vec![];
        while let Some(f) = todo.pop() {
            members.push(f);
            for owners in edge_faces.iter().filter(|o| o.contains(&f)) {
                for &g in owners {
                    if shell_of[g].is_none() {
                        shell_of[g] = Some(shell);
                        todo.push(g);
                    }
                }
            }
        }
        members.sort_unstable();
        d.shells.push(Shell {
            faces: members.into_iter().map(|f| FaceId(f as u32)).collect(),
            provenance: created(shell),
        });
    }
    d.solids.push(Solid {
        shells: (0..d.shells.len()).map(|s| ShellId(s as u32)).collect(),
        provenance: created(0),
    });
    Ok(d)
}
