//! Port of the parts of kernel/halfspace.bend and kernel/boundary.bend that the
//! planar Boolean reaches: vertex sides, polygon clipping with a shared cut
//! cache, polygon -> edge/face building, open uses, stitching, volumes.

use crate::exact;
use crate::model::*;
use crate::num::*;

#[derive(Clone, Debug, PartialEq)]
pub struct Polygon {
    pub surface: Surface,
    pub sense: bool,
    pub vertices: Vec<u32>,
}

#[inline]
pub fn vertex(vertices: &[P3], i: u32) -> P3 {
    vertices.get(i as usize).copied().unwrap_or(v3(0.0, 0.0, 0.0))
}

pub fn default_edge() -> Edge {
    Edge { start: 0, end: 0, curve: Curve::Line { origin: v3(0.0, 0.0, 0.0), direction: v3(1.0, 0.0, 0.0) }, same_sense: true }
}

#[inline]
pub fn edge_at(edges: &[Edge], i: u32) -> Edge {
    edges.get(i as usize).copied().unwrap_or_else(default_edge)
}

#[inline]
pub fn oriented_start(e: &Edge, forward: bool) -> u32 {
    if forward {
        e.start
    } else {
        e.end
    }
}

#[inline]
pub fn use_start(u: Use, edges: &[Edge]) -> u32 {
    oriented_start(&edge_at(edges, u.edge), u.forward)
}
#[inline]
pub fn use_end(u: Use, edges: &[Edge]) -> u32 {
    oriented_start(&edge_at(edges, u.edge), !u.forward)
}

pub fn ring_vertices(uses: &[Use], edges: &[Edge]) -> Vec<u32> {
    uses.iter().map(|u| use_start(*u, edges)).collect()
}

pub fn only_ring(loops: &[Loop], edges: &[Edge]) -> Vec<u32> {
    match loops {
        [Loop { outer: true, uses }] => ring_vertices(uses, edges),
        _ => Vec::new(),
    }
}

pub fn polygons(faces: &[Face], edges: &[Edge]) -> Vec<Polygon> {
    faces.iter().map(|f| Polygon { surface: f.surface, sense: f.same_sense, vertices: only_ring(&f.loops, edges) }).collect()
}

// ---------------------------------------------------------------- sides

/// kind 0 on the plane (exact), 1 negative, 2 positive, 3 within margin (ambiguous)
#[derive(Clone, Copy, Debug)]
pub struct Side {
    pub kind: u32,
    pub distance: f64,
}

pub fn side(point: P3, origin: P3, normal: P3, margin: Iv) -> Side {
    let distance = point.sub(origin).dot(normal.normalize());
    if exact::coincident(normal, point, origin, "halfspace.side exact") {
        return Side { kind: 0, distance };
    }
    let d = point.iv().sub(origin.iv()).dot(normal.iv().normalize());
    let clear = lt(margin, d.abs(), "halfspace.side clear");
    let kind = if clear {
        if lt(d, Iv::point(0.0), "halfspace.side sign") {
            1
        } else {
            2
        }
    } else {
        3
    };
    Side { kind, distance }
}

pub struct Sides {
    pub valid: bool,
    pub values: Vec<Side>,
}

pub fn sides(vertices: &[P3], origin: P3, normal: P3, margin: Iv) -> Sides {
    let mut valid = true;
    let values: Vec<Side> = vertices
        .iter()
        .map(|p| {
            let s = side(*p, origin, normal, margin);
            if s.kind == 3 {
                valid = false;
            }
            s
        })
        .collect();
    Sides { valid, values }
}

// ---------------------------------------------------------------- clipping

pub struct ClipState {
    pub vertices: Vec<P3>,
    /// (a, b) -> cut vertex; the cache is shared by all cells of one pass.
    pub cuts: Vec<(u32, u32, u32)>,
}

fn find_cut(cuts: &[(u32, u32, u32)], a: u32, b: u32) -> Option<u32> {
    // Bend conses new cuts in front and scans from the front; pairs are unique, so order is irrelevant.
    cuts.iter().find(|(x, y, _)| (a == *x && b == *y) || (a == *y && b == *x)).map(|c| c.2)
}

fn cut_vertex(a: u32, b: u32, values: &[Side], state: &mut ClipState) -> u32 {
    if let Some(v) = find_cut(&state.cuts, a, b) {
        return v;
    }
    let da = values[a as usize].distance;
    let db = values[b as usize].distance;
    let start = vertex(&state.vertices, a);
    let t = da / (da - db);
    let point = start.add(vertex(&state.vertices, b).sub(start).scale(t));
    let index = state.vertices.len() as u32;
    state.vertices.push(point);
    state.cuts.push((a, b, index));
    index
}

/// flip = true reads kinds 1 <-> 2 swapped (Bend flip_sides; the cut point is the same).
fn clip_ring(ids: &[u32], values: &[Side], flip: bool, state: &mut ClipState) -> Vec<u32> {
    let kind = |i: u32| -> u32 {
        let k = values.get(i as usize).map(|s| s.kind).unwrap_or(3);
        if flip && k != 0 && k != 3 {
            3 - k
        } else {
            k
        }
    };
    let n = ids.len();
    let mut out = Vec::with_capacity(n + 2);
    for i in 0..n {
        let a = ids[i];
        let b = if i + 1 < n { ids[i + 1] } else { ids[0] };
        let (ka, kb) = (kind(a), kind(b));
        let cross = (ka == 1 && kb == 2) || (ka == 2 && kb == 1);
        if ka != 2 {
            out.push(a);
        }
        if cross {
            out.push(cut_vertex(a, b, values, state));
        }
    }
    out
}

pub fn clip_polygons(polys: &[Polygon], values: &[Side], flip: bool, state: &mut ClipState) -> Vec<Polygon> {
    let mut out = Vec::with_capacity(polys.len());
    for p in polys {
        let ids = clip_ring(&p.vertices, values, flip, state);
        let inside_kind = if flip { 2 } else { 1 };
        let has_inside = p.vertices.iter().any(|i| values.get(*i as usize).map(|s| s.kind) == Some(inside_kind));
        if has_inside && ids.len() > 2 {
            out.push(Polygon { surface: p.surface, sense: p.sense, vertices: ids });
        }
    }
    out
}

// ---------------------------------------------------------------- building

#[derive(Default, Clone, Debug)]
pub struct Built {
    pub edges: Vec<Edge>,
    pub faces: Vec<Face>,
}

fn find_edge(edges: &[Edge], a: u32, b: u32) -> Option<Use> {
    edges.iter().enumerate().find_map(|(i, e)| {
        let forward = a == e.start && b == e.end;
        let reverse = a == e.end && b == e.start;
        if forward || reverse {
            Some(Use { edge: i as u32, forward })
        } else {
            None
        }
    })
}

pub fn build_polygons(polys: &[Polygon], vertices: &[P3], state: &mut Built) {
    for p in polys {
        let ids = &p.vertices;
        let n = ids.len();
        let mut uses = Vec::with_capacity(n);
        for i in 0..n {
            let a = ids[i];
            let b = if i + 1 < n { ids[i + 1] } else { ids[0] };
            let u = match find_edge(&state.edges, a, b) {
                Some(u) => u,
                None => {
                    let start = vertex(vertices, a);
                    let direction = vertex(vertices, b).sub(start).normalize();
                    let index = state.edges.len() as u32;
                    state.edges.push(Edge { start: a, end: b, curve: Curve::Line { origin: start, direction }, same_sense: true });
                    Use { edge: index, forward: true }
                }
            };
            uses.push(u);
        }
        state.faces.push(Face { surface: p.surface, same_sense: p.sense, loops: vec![Loop { outer: true, uses }] });
    }
}

/// (forward, backward) use counts per edge id 0..n (S.edge_counts with index 0).
pub fn edge_counts(faces: &[Face], n: usize) -> Vec<(u32, u32)> {
    let mut counts = vec![(0u32, 0u32); n];
    for f in faces {
        for l in &f.loops {
            for u in &l.uses {
                if let Some(c) = counts.get_mut(u.edge as usize) {
                    if u.forward {
                        c.0 += 1;
                    } else {
                        c.1 += 1;
                    }
                }
            }
        }
    }
    counts
}

/// S.edges_closed(edges, faces, 0): every edge has exactly one forward and one backward use.
pub fn edges_closed(edges: &[Edge], faces: &[Face]) -> bool {
    edge_counts(faces, edges.len()).iter().all(|c| *c == (1, 1))
}

/// H.open_uses: the reversed use of every edge with exactly one use, in edge order.
pub fn open_uses(edges: &[Edge], faces: &[Face]) -> Vec<Use> {
    edge_counts(faces, edges.len())
        .iter()
        .enumerate()
        .filter(|(_, c)| c.0 + c.1 == 1)
        .map(|(i, c)| Use { edge: i as u32, forward: c.1 == 1 })
        .collect()
}

// ---------------------------------------------------------------- boundary.bend stitch

/// B.stitch: rings of directed uses by vertex identity; Err on any reason.
pub fn stitch(edges: &[Edge], vertex_count: u32, uses: &[Use]) -> Result<Vec<Vec<Use>>, ()> {
    let mut arcs: Vec<(Use, u32, u32)> = Vec::with_capacity(uses.len());
    for u in uses {
        let e = edges.get(u.edge as usize).ok_or(())?;
        if e.start >= vertex_count || e.end >= vertex_count {
            return Err(());
        }
        let (s, t) = if u.forward { (e.start, e.end) } else { (e.end, e.start) };
        arcs.push((*u, s, t));
    }
    for (_, s, t) in &arcs {
        for v in [*s, *t] {
            let incoming = arcs.iter().filter(|a| a.2 == v).count();
            let outgoing = arcs.iter().filter(|a| a.1 == v).count();
            if incoming == 0 || outgoing == 0 || incoming != 1 || outgoing != 1 {
                return Err(());
            }
        }
    }
    let mut rings = Vec::new();
    let mut rest = arcs;
    let mut fuel = rest.len();
    while !rest.is_empty() {
        if fuel == 0 {
            return Err(());
        }
        fuel -= 1;
        let (use0, first, mut at) = rest.remove(0);
        let mut ring = vec![use0];
        let mut left = fuel;
        loop {
            if at == first {
                break;
            }
            if left == 0 {
                return Err(());
            }
            left -= 1;
            let k = rest.iter().position(|a| a.1 == at).ok_or(())?;
            let (u, _, end) = rest.remove(k);
            ring.push(u);
            at = end;
        }
        rings.push(ring);
    }
    Ok(rings)
}

// ---------------------------------------------------------------- measures

/// H.volume(polys, vertices, reference) (six times the signed volume), interval.
pub fn volume6(polys: &[Polygon], vertices: &[P3], reference: P3) -> Iv {
    let r = reference.iv();
    let mut total = Iv::point(0.0);
    for p in polys {
        let ids = &p.vertices;
        if ids.is_empty() {
            continue;
        }
        let first = vertex(vertices, ids[0]).iv();
        for w in ids.windows(2) {
            let a = vertex(vertices, w[0]).iv();
            let b = vertex(vertices, w[1]).iv();
            total = total + first.sub(r).dot(a.sub(r).cross(b.sub(r)));
        }
    }
    total
}

/// H.ring_area(ids, vertices, first, normal), interval.
pub fn ring_area(ids: &[u32], vertices: &[P3], normal: I3) -> Iv {
    let mut total = Iv::point(0.0);
    if ids.is_empty() {
        return total;
    }
    let origin = vertex(vertices, ids[0]).iv();
    let n = ids.len();
    for i in 0..n {
        let a = vertex(vertices, ids[i]).iv();
        let b = vertex(vertices, if i + 1 < n { ids[i + 1] } else { ids[0] }).iv();
        total = total + a.sub(origin).cross(b.sub(origin)).dot(normal);
    }
    total
}

/// H.vertex_scale
pub fn vertex_scale(vertices: &[P3], scale: f64) -> f64 {
    vertices.iter().fold(scale, |s, v| s.max(v.magnitude()))
}

/// H.all_used(vertices, edges, 0)
pub fn all_used(n: usize, edges: &[Edge]) -> bool {
    let mut used = vec![false; n];
    for e in edges {
        for v in [e.start, e.end] {
            if let Some(u) = used.get_mut(v as usize) {
                *u = true;
            }
        }
    }
    used.iter().all(|u| *u)
}

/// H.unique_vertices: pairwise distance > resolution.
pub fn unique_vertices(vertices: &[P3], resolution: Iv) -> bool {
    for i in 0..vertices.len() {
        for j in i + 1..vertices.len() {
            if !lt(resolution, vertices[j].iv().sub(vertices[i].iv()).length(), "unique_vertices") {
                return false;
            }
        }
    }
    true
}

/// H.unique_edges
pub fn unique_edges(edges: &[Edge]) -> bool {
    for i in 0..edges.len() {
        for j in i + 1..edges.len() {
            let (a, b, x, y) = (edges[i].start, edges[i].end, edges[j].start, edges[j].end);
            if (a == x && b == y) || (a == y && b == x) {
                return false;
            }
        }
    }
    true
}

/// H.connected(faces): every face reachable from face 0 through shared edge ids.
pub fn connected(faces: &[Face]) -> bool {
    if faces.is_empty() {
        return true;
    }
    let top = faces.iter().flat_map(|f| f.loops.iter().flat_map(|l| l.uses.iter().map(|u| u.edge))).max().unwrap_or(0) as usize;
    let mut by_edge: Vec<Vec<usize>> = vec![Vec::new(); top + 1];
    for (i, f) in faces.iter().enumerate() {
        for l in &f.loops {
            for u in &l.uses {
                by_edge[u.edge as usize].push(i);
            }
        }
    }
    let mut reached = vec![false; faces.len()];
    reached[0] = true;
    let mut stack = vec![0usize];
    while let Some(f) = stack.pop() {
        for l in &faces[f].loops {
            for u in &l.uses {
                for &g in &by_edge[u.edge as usize] {
                    if !reached[g] {
                        reached[g] = true;
                        stack.push(g);
                    }
                }
            }
        }
    }
    reached.iter().all(|r| *r)
}

/// H.line_valid for a line edge between a and b.
pub fn line_valid(curve: &Curve, a: P3, b: P3, resolution: Iv) -> bool {
    match curve {
        Curve::Line { origin, direction } => {
            let valid = vec_valid(*origin) && vec_valid(*direction) && direction_valid(*direction);
            if !valid {
                return false;
            }
            let unit = direction.iv().normalize();
            let o = origin.iv();
            let ia = le(a.iv().sub(o).cross(unit).length(), resolution, "line_valid incidence");
            let ib = le(b.iv().sub(o).cross(unit).length(), resolution, "line_valid incidence");
            ia && ib && lt(resolution, a.iv().sub(b.iv()).length(), "line_valid length")
        }
        Curve::Round => false,
    }
}

pub fn lines_valid(edges: &[Edge], vertices: &[P3], resolution: Iv) -> bool {
    let n = vertices.len() as u32;
    edges.iter().all(|e| {
        e.start < n && e.end < n && e.start != e.end && line_valid(&e.curve, vertex(vertices, e.start), vertex(vertices, e.end), resolution)
    })
}

/// C.frame_valid(normalize(normal), normalize(x)) after H.frame_valid's input checks.
pub fn frame_valid(normal: P3, x: P3) -> bool {
    if !(vec_valid(normal) && vec_valid(x) && direction_valid(normal) && direction_valid(x)) {
        return false;
    }
    let n = normal.iv().normalize();
    let u = x.iv().normalize();
    let budget = Iv::point(angular_guard()) * Iv::point(10.0);
    let one = Iv::point(1.0);
    le((n.dot(n) - one).abs(), budget, "frame_valid n") && le((u.dot(u) - one).abs(), budget, "frame_valid x") && le(n.dot(u).abs(), budget, "frame_valid nx")
}
