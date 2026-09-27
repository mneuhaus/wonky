//! Port of the parts of kernel/ports/truck-topology.bend (components of a
//! closed face set) and kernel/ports/curved-contact-topology.bend (vertex
//! links are single cycles) that the planar Boolean reaches.

use crate::halfspace;
use crate::model::*;

pub struct Component {
    pub solid: Solid,
    /// the indices of the built faces (P.SourceFace{index}) in component order
    pub sources: Vec<u32>,
}

/// L.components(fuel, records(faces, SourceFace{i}), vertices, edges, ...)
pub fn components(faces: &[Face], vertices: &[crate::num::P3], edges: &[Edge]) -> Vec<Component> {
    let mut rest: Vec<u32> = (0..faces.len() as u32).collect();
    let mut out = Vec::new();
    let mut fuel = faces.len();
    while fuel > 0 && !rest.is_empty() {
        fuel -= 1;
        let head = rest.remove(0);
        let mut known = vec![head];
        let mut used = vec![false; edges.len().max(1)];
        let mark = |used: &mut Vec<bool>, f: &Face| {
            for l in &f.loops {
                for u in &l.uses {
                    if let Some(x) = used.get_mut(u.edge as usize) {
                        *x = true;
                    }
                }
            }
        };
        mark(&mut used, &faces[head as usize]);
        // grow(left, [head], tail): `left` partition passes; a pass that adds nothing ends it early.
        for _ in 0..fuel {
            let (members, others): (Vec<u32>, Vec<u32>) = rest.iter().partition(|i| {
                let f = &faces[**i as usize];
                match f.loops.as_slice() {
                    [l] => l.uses.iter().any(|u| used.get(u.edge as usize).copied().unwrap_or(false)),
                    _ => false,
                }
            });
            if members.is_empty() {
                break;
            }
            for m in &members {
                mark(&mut used, &faces[*m as usize]);
            }
            known.extend(members);
            rest = others;
        }
        out.push(component(&known, faces, vertices, edges));
    }
    out
}

fn component(records: &[u32], faces: &[Face], vertices: &[crate::num::P3], edges: &[Edge]) -> Component {
    let comp_faces: Vec<&Face> = records.iter().map(|i| &faces[*i as usize]).collect();
    let mut edge_used = vec![false; edges.len()];
    for f in &comp_faces {
        for l in &f.loops {
            for u in &l.uses {
                if let Some(x) = edge_used.get_mut(u.edge as usize) {
                    *x = true;
                }
            }
        }
    }
    let mut edge_map = vec![u32::MAX; edges.len()];
    let mut selected = Vec::new();
    for (i, e) in edges.iter().enumerate() {
        if edge_used[i] {
            edge_map[i] = selected.len() as u32;
            selected.push(*e);
        }
    }
    let mut vertex_used = vec![false; vertices.len()];
    for e in &selected {
        for v in [e.start, e.end] {
            if let Some(x) = vertex_used.get_mut(v as usize) {
                *x = true;
            }
        }
    }
    let mut vertex_map = vec![u32::MAX; vertices.len()];
    let mut new_vertices = Vec::new();
    for (i, v) in vertices.iter().enumerate() {
        if vertex_used[i] {
            vertex_map[i] = new_vertices.len() as u32;
            // planted negative (feature "plant", PLANT=vertex): one result vertex off by 1e-8 mm
            #[cfg(feature = "plant")]
            let v = &if crate::plant::active("vertex") && new_vertices.len() == 3 && crate::plant::once() { crate::num::v3(v.x, v.y + 1.0e-8, v.z) } else { *v };
            new_vertices.push(*v);
        }
    }
    let look = |map: &[u32], i: u32| map.get(i as usize).copied().unwrap_or(u32::MAX);
    let new_edges: Vec<Edge> = selected
        .iter()
        .map(|e| Edge {
            start: look(&vertex_map, e.start),
            end: look(&vertex_map, e.end),
            curve: match e.curve {
                Curve::Line { origin, direction } => Curve::Line { origin, direction: direction.normalize() },
                c => c,
            },
            same_sense: e.same_sense,
        })
        .collect();
    let mut new_faces = Vec::with_capacity(comp_faces.len());
    for f in &comp_faces {
        // L.remap_faces stops at the first face without exactly one loop
        let [l] = f.loops.as_slice() else { break };
        let uses = l.uses.iter().map(|u| Use { edge: look(&edge_map, u.edge), forward: u.forward }).collect();
        new_faces.push(Face { surface: f.surface, same_sense: f.same_sense, loops: vec![Loop { outer: l.outer, uses }] });
    }
    Component { solid: Solid { vertices: new_vertices, edges: new_edges, faces: new_faces }, sources: records.to_vec() }
}

/// CT.valid: every vertex has a nonempty link that is exactly one cycle of edge ends.
pub fn contact_valid(solid: &Solid) -> bool {
    struct Arc {
        vertex: u32,
        first: u32,
        last: u32,
    }
    let mut arcs = Vec::new();
    for f in &solid.faces {
        for l in &f.loops {
            let n = l.uses.len();
            if n == 0 {
                return false; // Arc{0, 0, 0, False}
            }
            for i in 0..n {
                let (a, b) = (l.uses[i], l.uses[(i + 1) % n]);
                let vertex = halfspace::use_end(a, &solid.edges);
                let other = halfspace::use_start(b, &solid.edges);
                if vertex != other {
                    return false;
                }
                arcs.push(Arc { vertex, first: 2 * a.edge + a.forward as u32, last: 2 * b.edge + (!b.forward) as u32 });
            }
        }
    }
    for index in 0..solid.vertices.len() as u32 {
        let mut at: Vec<&Arc> = arcs.iter().filter(|a| a.vertex == index).collect();
        if at.is_empty() {
            return false;
        }
        let head = at.remove(0);
        let target = head.first;
        let mut next = head.last;
        let mut fuel = at.len();
        loop {
            if at.is_empty() {
                if next != target {
                    return false;
                }
                break;
            }
            if fuel == 0 || next == target {
                return false;
            }
            fuel -= 1;
            let matches: Vec<usize> = at.iter().enumerate().filter(|(_, a)| a.first == next).map(|(i, _)| i).collect();
            if matches.len() != 1 {
                return false;
            }
            let a = at.remove(matches[0]);
            next = a.last;
        }
    }
    true
}
