//! Export-only tessellation of WC0 bodies. Never feeds approximate coordinates
//! back into modelling. Straight planar contours use only their own vertices;
//! triangulation signs use exact source predicates (binary64 or replayed rationals).
use crate::{placement::Placement, polyhedron::Refused};
use num_rational::BigRational;
use num_traits::{FromPrimitive, Zero};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use wonky_contract::{Body, CheckedBody, CurveGeometry, SurfaceGeometry};
use wonky_num::{orient2d, p2, Sign};

pub(crate) type R<T> = Result<T, Refused>;
pub(crate) fn no(reason: &str) -> Refused {
    Refused(format!("export/stl/{reason}"))
}

#[derive(Clone, Debug, Default)]
pub struct Mesh {
    /// World millimetres. Shared boundaries share vertex indices.
    pub vertices: Vec<[f64; 3]>,
    pub triangles: Vec<[usize; 3]>,
    /// WC0 face id of each triangle, or empty when the producer cannot
    /// attribute its triangles to WC0 faces (never a partial list).
    pub faces: Vec<u32>,
    /// One sampled polyline per WC0 edge, in WC0 edge order; empty when the
    /// producer does not sample edges.
    pub edges: Vec<MeshEdge>,
    /// The first `brep_vertices` mesh vertices are the WC0 vertices in order.
    pub brep_vertices: usize,
}

/// A WC0 edge sampled into mesh vertex ids (`closed`: the last sample joins
/// the first, which is not repeated).
#[derive(Clone, Debug)]
pub struct MeshEdge {
    pub vertices: Vec<usize>,
    pub closed: bool,
}

fn orientation(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> R<Sign> {
    orient2d(
        p2(a[0], a[1]),
        p2(b[0], b[1]),
        p2(c[0], c[1]),
        "STL triangulation",
    )
    .map_err(|e| {
        e.into_refusal();
        no("numeric-decision")
    })
}
fn on_segment(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> R<bool> {
    Ok(c[0] >= a[0].min(b[0])
        && c[0] <= a[0].max(b[0])
        && c[1] >= a[1].min(b[1])
        && c[1] <= a[1].max(b[1])
        && orientation(a, b, c)? == Sign::Zero)
}
/// Whether a candidate diagonal meets an edge anywhere but a shared endpoint.
fn obstructs(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> R<bool> {
    if a == c || a == d || b == c || b == d {
        for p in [c, d] {
            if p != a && p != b && on_segment(a, b, p)? {
                return Ok(true);
            }
        }
        for p in [a, b] {
            if p != c && p != d && on_segment(c, d, p)? {
                return Ok(true);
            }
        }
        return Ok((a == c && b == d) || (a == d && b == c));
    }
    let (ac, ad, ca, cb) = (
        orientation(a, b, c)?,
        orientation(a, b, d)?,
        orientation(c, d, a)?,
        orientation(c, d, b)?,
    );
    Ok((ac != Sign::Zero
        && ad != Sign::Zero
        && ac != ad
        && ca != Sign::Zero
        && cb != Sign::Zero
        && ca != cb)
        || (ac == Sign::Zero && on_segment(a, b, c)?)
        || (ad == Sign::Zero && on_segment(a, b, d)?)
        || (ca == Sign::Zero && on_segment(c, d, a)?)
        || (cb == Sign::Zero && on_segment(c, d, b)?))
}
fn area_sign(points: &[[f64; 2]], cycle: &[usize]) -> R<i32> {
    let polygon: Vec<_> = cycle
        .iter()
        .map(|&k| p2(points[k][0], points[k][1]))
        .collect();
    let area = wonky_sketch::region::signed_area2(&polygon).map_err(|_| no("numeric-decision"))?;
    Ok(wonky_num::expansion::sign(&area))
}
/// Exact rational midpoint location avoids rounding a short bridge onto an edge.
fn midpoint_inside(points: &[[f64; 2]], cycle: &[usize], a: usize, b: usize) -> R<bool> {
    let q = |x| BigRational::from_f64(x).ok_or_else(|| no("non-finite-coordinate"));
    let two = BigRational::from_integer(2.into());
    let x = (q(points[a][0])? + q(points[b][0])?) / &two;
    let y = (q(points[a][1])? + q(points[b][1])?) / &two;
    let mut winding = 0;
    for i in 0..cycle.len() {
        let p = points[cycle[i]];
        let r = points[cycle[(i + 1) % cycle.len()]];
        let (px, py, rx, ry) = (q(p[0])?, q(p[1])?, q(r[0])?, q(r[1])?);
        let side = (&rx - &px) * (&y - &py) - (&ry - &py) * (&x - &px);
        if side.is_zero()
            && x >= px.clone().min(rx.clone())
            && x <= px.max(rx)
            && y >= py.clone().min(ry.clone())
            && y <= py.clone().max(ry.clone())
        {
            return Ok(false);
        }
        if py <= y && ry > y && side > BigRational::zero() {
            winding += 1;
        }
        if py > y && ry <= y && side < BigRational::zero() {
            winding -= 1;
        }
    }
    Ok(winding != 0)
}

/// Sign of det[a-d, b-d, c-d] with squared-norm lifts, exactly: positive iff d
/// lies strictly inside the circumcircle of the counterclockwise triangle abc.
fn in_circle(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> R<Sign> {
    use wonky_num::expansion::{difference, mul, neg, sign, sum, Guard};
    let mut g = Guard::new();
    let [a, b, c] = [a, b, c].map(|p| [difference(p[0], d[0], &mut g), difference(p[1], d[1], &mut g)]);
    let lift = |p: &[Vec<f64>; 2], g: &mut Guard| sum(&mul(&p[0], &p[0], g), &mul(&p[1], &p[1], g), g);
    let cross = |p: &[Vec<f64>; 2], q: &[Vec<f64>; 2], g: &mut Guard| {
        sum(&mul(&p[0], &q[1], g), &neg(&mul(&p[1], &q[0], g)), g)
    };
    let mut det = Vec::new();
    for (p, q, r) in [(&a, &b, &c), (&b, &c, &a), (&c, &a, &b)] {
        let term = mul(&lift(p, &mut g), &cross(q, r, &mut g), &mut g);
        det = sum(&det, &term, &mut g);
    }
    if !g.exact() {
        return Err(no("numeric-decision"));
    }
    Ok(match sign(&det) {
        1 => Sign::Positive,
        -1 => Sign::Negative,
        _ => Sign::Zero,
    })
}

impl crate::mesh_triangulate::PlanarPoint for [f64; 2] {
    fn orientation(a: &Self, b: &Self, c: &Self) -> R<Sign> {
        orientation(*a, *b, *c)
    }
    fn obstructs(a: &Self, b: &Self, c: &Self, d: &Self) -> R<bool> {
        obstructs(*a, *b, *c, *d)
    }
    fn area_sign(p: &[Self], c: &[usize]) -> R<i32> {
        area_sign(p, c)
    }
    fn midpoint_inside(p: &[Self], c: &[usize], a: usize, b: usize) -> R<bool> {
        midpoint_inside(p, c, a, b)
    }
    fn in_circle(a: &Self, b: &Self, c: &Self, d: &Self) -> R<Sign> {
        in_circle(*a, *b, *c, *d)
    }
    fn simple(p: &[Self], c: &[usize]) -> R<()> {
        let polygon: Vec<_> = c.iter().map(|&k| p2(p[k][0], p[k][1])).collect();
        wonky_sketch::region::simple_polygon(&polygon).map_err(|_| no("non-simple-contour"))
    }
    fn locate(p: &[Self], c: &[usize], point: &Self) -> R<bool> {
        let polygon: Vec<_> = c.iter().map(|&k| p2(p[k][0], p[k][1])).collect();
        match wonky_sketch::region::locate(&polygon, p2(point[0], point[1]))
            .map_err(|_| no("numeric-decision"))?
        {
            wonky_sketch::region::Location::Inside => Ok(true),
            wonky_sketch::region::Location::Outside => Ok(false),
            _ => Err(no("invalid-hole-nesting")),
        }
    }
}
pub fn triangulate_loops(points: &[[f64; 2]], loops: &[Vec<usize>]) -> R<Vec<[usize; 3]>> {
    crate::mesh_triangulate::triangulate_loops(points, loops)
}

/// Distinct exact chart coordinates get distinct ordered mesh witnesses.
/// The exact order is preserved; the displacement is checked in the source
/// metric before any witness is used. This is tessellation, never modelling.
pub(crate) fn ordered_witnesses<T: Ord + Clone + Into<wonky_curve::radical::Radical>>(
    values: &[T], step: f64, budget: f64,
) -> R<BTreeMap<T, f64>> {
    use wonky_curve::radical::{self, Radical};
    radical::guard(|| {
        use num_traits::ToPrimitive;
        let quantum = BigRational::from_f64(step).filter(|q| q > &BigRational::zero()).ok_or_else(|| no("witness-grid-range"))?;
        let tolerance = Radical::from(BigRational::from_f64(budget).ok_or_else(|| no("witness-budget-range"))?);
        let mut out = BTreeMap::new();
        let mut previous: Option<BigRational> = None;
        for key in values.iter().collect::<BTreeSet<_>>() {
            let value: Radical = key.clone().into();
            let target = previous.as_ref().map_or_else(|| value.clone(), |p| value.clone().max(Radical::from(p + &quantum)));
            let witness = match target.rational() {
                Some(q) => q.to_f64().filter(|x| x.is_finite()).ok_or_else(|| no("witness-grid-range"))?,
                None => target.enclosure()?.mid(),
            };
            let literal = BigRational::from_f64(witness).ok_or_else(|| no("witness-grid-range"))?;
            if (Radical::from(literal.clone()) - &value).abs() > tolerance || previous.as_ref().is_some_and(|p| &literal <= p) {
                return Err(no("witness-displacement-budget"));
            }
            previous = Some(literal);
            out.insert(key.clone(), witness);
        }
        Ok(out)
    })?
}

/// Triangulate a planar observation in the coordinates that are actually
/// emitted. A source-chart ear can become collinear after world placement;
/// exact predicates on the placed projection avoid creating that ear while
/// preserving every boundary segment. No vertices or facets are discarded.
pub(crate) fn triangulate_planar_cap(
    points: &[[f64; 3]], loops: &[Vec<usize>],
    normal: &[wonky_num::expansion::Exp; 3],
) -> R<Vec<[usize; 3]>> {
    use wonky_num::expansion::sign;
    let magnitude = |e: &wonky_num::expansion::Exp| e.iter().rev().find(|v| **v != 0.).map_or(0., |v| v.abs());
    let axis = (0..3).filter(|&k| sign(&normal[k]) != 0)
        .max_by(|&i, &j| magnitude(&normal[i]).total_cmp(&magnitude(&normal[j])))
        .ok_or_else(|| no("singular-cap-plane"))?;
    let direction = sign(&normal[axis]) as f64;
    let projected: Vec<_> = points.iter().map(|p| [p[(axis + 1) % 3], direction * p[(axis + 2) % 3]]).collect();
    triangulate_loops(&projected, loops)
}

fn planar(body: &Body, deviation_mm: f64) -> R<Mesh> {
    let source: Vec<[f64; 3]> = body
        .vertices
        .iter()
        .map(|v| v.point.map(|x| x.get()))
        .collect();
    let vertices = body
        .vertices
        .iter()
        .map(|v| {
            let frame = Placement::from_frames(body, v.frame).map_err(|_| no("vertex-frame-range"))?;
            let enclosed = frame.apply_enclosed(v.point.map(|x| x.get()), 1000., true)
                .map_err(|_| no("vertex-frame-range"))?;
            let out = enclosed.map(|b| b.m);
            let error = enclosed.iter().fold(wonky_num::Iv::point(0.), |e, b| e + wonky_num::Iv::point(b.r));
            if !error.hi().is_finite() || error.hi() > deviation_mm * 0.5 {
                return Err(no("vertex-precision-budget"));
            }
            Ok(out)
        })
        .collect::<R<Vec<_>>>()?;
    let mut triangles = Vec::new();
    let mut tagged = Vec::new();
    for (face_id, face) in body.faces.iter().enumerate() {
        let surface = &body.surfaces[face.surface.0 as usize];
        let SurfaceGeometry::Plane { normal, .. } = &surface.geometry else {
            return Err(no("non-plane"));
        };
        if body.vertices.iter().any(|v| v.frame != surface.frame) {
            return Err(no("mixed-source-frames"));
        }
        let mut drop = 0;
        for k in 1..3 {
            if normal[k].get().abs() > normal[drop].get().abs() {
                drop = k;
            }
        }
        if normal[drop].get() == 0. {
            return Err(no("zero-plane-normal"));
        }
        let points: Vec<[f64; 2]> = source
            .iter()
            .map(|p| [p[(drop + 1) % 3], p[(drop + 2) % 3]])
            .collect();
        let mut loops = Vec::new();
        let mut outer = 0;
        for lp in &face.loops {
            let lp = &body.loops[lp.0 as usize];
            let mut cycle = Vec::new();
            let mut ends = Vec::new();
            for co in &lp.coedges {
                let co = &body.coedges[co.0 as usize];
                let e = &body.edges[co.edge.0 as usize];
                if e.vertices.len() != 2 {
                    return Err(no("line-endpoints"));
                }
                let a = e.vertices[usize::from(!co.forward)].0 as usize;
                let b = e.vertices[usize::from(co.forward)].0 as usize;
                cycle.push(a);
                ends.push(b);
            }
            if cycle.is_empty()
                || ends
                    .iter()
                    .enumerate()
                    .any(|(i, &b)| b != cycle[(i + 1) % cycle.len()])
            {
                return Err(no("loop-gap"));
            }
            if lp.outer {
                outer += 1;
                loops.insert(0, cycle);
            } else {
                loops.push(cycle);
            }
        }
        if outer != 1 {
            return Err(no("one-outer-loop-required"));
        }
        // WC0 coedges already wind outward. Restore their projected winding
        // after the triangulator's CCW normalization, then map frame handedness.
        let reverse = (area_sign(&points, &loops[0])? < 0)
            ^ Placement::from_frames(body, surface.frame)
                .and_then(|f| f.reversed())
                .map_err(|_| no("frame-orientation"))?;
        for mut t in triangulate_loops(&points, &loops)? {
            if reverse {
                t.swap(1, 2);
            }
            triangles.push(t);
            tagged.push(face_id as u32);
        }
    }
    // A planar-only body has only Line curves: each edge is the straight
    // segment between its two vertices.
    let edges = body
        .edges
        .iter()
        .map(|e| {
            if e.vertices.len() != 2 {
                return Err(no("line-endpoints"));
            }
            Ok(MeshEdge {
                vertices: e.vertices.iter().map(|v| v.0 as usize).collect(),
                closed: false,
            })
        })
        .collect::<R<Vec<_>>>()?;
    let brep_vertices = vertices.len();
    let mesh = Mesh {
        vertices,
        triangles,
        faces: tagged,
        edges,
        brep_vertices,
    };
    let source_mesh = Mesh {
        vertices: source,
        triangles: mesh.triangles.clone(),
        ..Default::default()
    };
    let frame = body.vertices.first().ok_or_else(|| no("empty-mesh"))?.frame;
    let reversed = Placement::from_frames(body, frame)
        .and_then(|f| f.reversed())
        .map_err(|_| no("frame-orientation"))?;
    preserve_shell_orientation(&source_mesh, &mesh, reversed)?;
    Ok(mesh)
}

/// Rounded coordinates propose a triangulation; rational geometry certifies it.
/// A positive oriented triangle chain with exactly the face's boundary has
/// winding one inside and zero outside, so no cached-coordinate decision can
/// change the exact face topology. Failed proposals are named refusals.
fn arrangement_mesh(a: &crate::polyhedron::Audited, deviation: f64) -> R<Mesh> {
    use crate::planar_geometry::{sub, cross};
    // Use the rational triangulator for every replay-owned planar boundary.
    // Retain the independent triangle-chain certificate from the Model path.
    let mesh = crate::mesh_planar_exact::tessellate(a, deviation)?;
    let exact = crate::planar_geometry::world_points(a, 1000.)?;
    let reversed = a.frame.reversed().map_err(|_| no("frame-orientation"))?;
    for (face_id, face) in a.body.faces.iter().enumerate() {
        let mut loops = Vec::new();
        for id in &face.loops {
            let lp = &a.body.loops[id.0 as usize];
            let mut cycle = a.face_loops[id.0 as usize].clone();
            if reversed { cycle.reverse(); }
            if lp.outer { loops.insert(0, cycle); } else { loops.push(cycle); }
        }
        if loops.is_empty() || loops[0].len() < 3 { return Err(no("invalid-contour")); }
        let mut n = [BigRational::zero(), BigRational::zero(), BigRational::zero()];
        let outer = &loops[0];
        for i in 1..outer.len()-1 {
            let c = cross(&sub(&exact[outer[i]], &exact[outer[0]]), &sub(&exact[outer[i+1]], &exact[outer[0]]));
            for k in 0..3 { n[k] += &c[k]; }
        }
        let triangles = mesh.triangles.iter().zip(&mesh.faces)
            .filter_map(|(t, f)| (*f == face_id as u32).then_some(*t)).collect::<Vec<_>>();
        certify_arrangement_face(&exact, &mesh.vertices, &loops, &triangles, &n)?;
    }
    Ok(mesh)
}

fn certify_arrangement_face(
    exact: &[crate::planar_geometry::P], vertices: &[[f64;3]],
    loops: &[Vec<usize>], triangles: &[[usize;3]], n: &crate::planar_geometry::P,
) -> R<()> {
    use crate::planar_geometry::{q, sub, cross, dot};
    use num_traits::Signed;
    let mut boundary = BTreeMap::<(usize,usize), i64>::new();
    let mut edge = |u: usize, v: usize, weight: i64| {
        *boundary.entry((u.min(v),u.max(v))).or_default() += if u < v { weight } else { -weight };
    };
    for cycle in loops {
        for i in 0..cycle.len() { edge(cycle[i],cycle[(i+1)%cycle.len()],-1); }
    }
    for &t in triangles {
        let normal = cross(&sub(&exact[t[1]],&exact[t[0]]),&sub(&exact[t[2]],&exact[t[0]]));
        if !dot(&normal,n).is_positive() { return Err(no("arrangement-triangle-orientation")); }
        let rounded = t.map(|i| vertices[i].map(q));
        let observed = cross(&sub(&rounded[1],&rounded[0]),&sub(&rounded[2],&rounded[0]));
        if !dot(&normal,&observed).is_positive() { return Err(no("arrangement-triangle-rounding")); }
        for i in 0..3 { edge(t[i],t[(i+1)%3],1); }
    }
    if boundary.values().any(|&v| v != 0) { return Err(no("arrangement-triangle-boundary")); }
    Ok(())
}

fn key(p: [f64; 3]) -> [u64; 3] {
    p.map(|v| if v == 0. { 0 } else { v.to_bits() })
}
/// A production guard, also used after STL float32 rounding. Every edge must
/// occur twice in opposite senses; degenerate and duplicate facets are refused.
/// Canonical coordinates (not just indices) detect disconnected coincident seams.
pub fn check_watertight(mesh: &Mesh) -> R<()> {
    if mesh.triangles.is_empty() {
        return Err(no("empty-mesh"));
    }
    let mut ids = HashMap::with_capacity(mesh.vertices.len());
    let mut canonical = Vec::new();
    for &p in &mesh.vertices {
        if p.iter().any(|x| !x.is_finite()) {
            return Err(no("non-finite-coordinate"));
        }
        let next = ids.len();
        canonical.push(*ids.entry(key(p)).or_insert(next));
    }
    let mut edges: HashMap<(usize, usize), (usize, i32)> = HashMap::with_capacity(mesh.triangles.len() * 3 / 2);
    let mut facets = HashSet::with_capacity(mesh.triangles.len());
    // (vertex, a, b): the edge a-b of the vertex link, one per triangle corner.
    let mut links: Vec<(usize, usize, usize)> = Vec::with_capacity(mesh.triangles.len() * 3);
    for t in &mesh.triangles {
        if t.iter().any(|&i| i >= mesh.vertices.len()) {
            return Err(no("triangle-index"));
        }
        let pts = t.map(|i| mesh.vertices[i]);
        let mut nonzero = false;
        for d in 0..3 {
            let p = pts.map(|p| [p[(d + 1) % 3], p[(d + 2) % 3]]);
            if orientation(p[0], p[1], p[2])? != Sign::Zero {
                nonzero = true;
                break;
            }
        }
        if !nonzero {
            return Err(no("degenerate-triangle"));
        }
        let c = t.map(|i| canonical[i]);
        let mut sorted = c;
        sorted.sort_unstable();
        if !facets.insert(sorted) {
            return Err(no("duplicate-triangle"));
        }
        for i in 0..3 {
            links.push((c[i], c[(i + 1) % 3], c[(i + 2) % 3]));
            let (a, b) = (c[i], c[(i + 1) % 3]);
            let e = edges.entry((a.min(b), a.max(b))).or_default();
            e.0 += 1;
            e.1 += if a < b { 1 } else { -1 };
        }
    }
    if edges.values().any(|&(n, dir)| n != 2 || dir != 0) {
        return Err(no("not-watertight-oriented"));
    }
    // Two closed shells touching at just a vertex pass edge incidence. The
    // link around every used vertex must additionally be one connected cycle.
    // The link edges bucketed per vertex (counting sort), then checked in
    // small reused buffers instead of a map per vertex: every link node needs
    // exactly two directed entries, and a walk from the first node must reach
    // all of them.
    let mut start = vec![0usize; ids.len() + 1];
    for &(v, _, _) in &links {
        start[v + 1] += 1;
    }
    for v in 0..ids.len() {
        start[v + 1] += start[v];
    }
    let mut fill = start.clone();
    let mut bucketed = vec![(0usize, 0usize); links.len()];
    for &(v, a, b) in &links {
        bucketed[fill[v]] = (a, b);
        fill[v] += 1;
    }
    let (mut ends, mut nodes, mut visited, mut pending) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for v in 0..ids.len() {
        let pairs = &bucketed[start[v]..start[v + 1]];
        if pairs.is_empty() {
            continue;
        }
        ends.clear();
        ends.extend(pairs.iter().flat_map(|&(a, b)| [(a, b), (b, a)]));
        ends.sort_unstable();
        nodes.clear();
        for n in ends.chunk_by(|x, y| x.0 == y.0) {
            if n.len() != 2 {
                return Err(no("nonmanifold-vertex"));
            }
            nodes.push(n[0].0);
        }
        visited.clear();
        visited.resize(nodes.len(), false);
        pending.clear();
        pending.push(0);
        let mut reached = 0;
        while let Some(i) = pending.pop() {
            if !std::mem::replace(&mut visited[i], true) {
                reached += 1;
                // Node i owns ends[2 i] and ends[2 i + 1] (two entries per node).
                for e in &ends[2 * i..2 * i + 2] {
                    pending.push(nodes.binary_search(&e.1).expect("link neighbour is a node"));
                }
            }
        }
        if reached != nodes.len() {
            return Err(no("nonmanifold-vertex"));
        }
    }
    Ok(())
}

/// Source profiles retain rational carriers through authenticated placements.
/// Their WC0 coordinates remain observations after a lineage wrapper is added.
pub(crate) fn replayed_profile(checked: &CheckedBody) -> R<Option<crate::polyhedron::Audited>> {
    let body = checked.body();
    if !(crate::arc_profile::candidate(body)
        || crate::curve_profile::candidate(body)
        || crate::profile_blend::candidate(body)
        || crate::pattern::unplace(body).is_some())
    {
        return Ok(None);
    }
    use crate::analytic::Solid;
    match crate::analytic::audit(checked)? {
        Solid::Planar(a) => Ok(a.arcs.as_ref().is_some_and(|s| s.rim.is_none()).then_some(a)),
        Solid::Model(_, _) | Solid::Columns(_) | Solid::PrismHoles(_) | Solid::PrismStack(_)
        | Solid::Revolved(_) | Solid::Placed(_) | Solid::Cylinder(_) | Solid::Conical(_)
        | Solid::Coaxial(_) | Solid::Bicylinder(_) | Solid::CylinderTee(_)
        | Solid::Spherical(_) | Solid::Axial(_) | Solid::Lens(_)
        | Solid::Perforated(_) | Solid::PerforatedChamfer(_) => Ok(None),
    }
}

pub fn tessellate(checked: &CheckedBody, deviation_mm: f64) -> R<Mesh> {
    if !deviation_mm.is_finite() || deviation_mm <= 0. {
        return Err(no("invalid-deviation"));
    }
    let body = checked.body();
    if crate::model_boolean::candidate(body) {
        let (a, model) = crate::model_boolean::audit(checked)?;
        if crate::model_wire::curved(&model) {
            return crate::model_export::tessellate(&model, deviation_mm);
        }
        return crate::model_boolean::tessellate(&a, deviation_mm);
    }
    // A placed body without a family placement owner meshes from its Model.
    if crate::pattern::unplace(body).is_some() {
        if let crate::analytic::Solid::Placed(p) = crate::analytic::audit(checked)? {
            return crate::model_export::tessellate(&p.model, deviation_mm);
        }
    }
    crate::mesh_curved::validate_circle_inputs(body)?;
    // Replayed plane arrangements carry rational endpoints, encoded as
    // ConstructionLine rather than ordinary binary64 Line geometry.
    if crate::planar_boolean::candidate(body) {
        let audited = crate::polyhedron::audit(checked)?;
        if audited.arrangement.is_some() {
            let mesh = arrangement_mesh(&audited, deviation_mm)?;
            check_watertight(&mesh)?;
            return Ok(mesh);
        }
    }
    // Stacked-prism caches are rounded witnesses of a rational arrangement;
    // mesh the replayed exact arrangement with its own sampling budget.
    if crate::prism_stack::candidate(body) {
        let mesh = crate::prism_stack::audit(checked)?.tessellate(deviation_mm * 0.5)?;
        check_watertight(&mesh)?;
        return Ok(mesh);
    }
    // Source-profile extrusion sampling works for lines, arcs and splines,
    // including rational generator offsets and non-cardinal fillet angles.
    // The generic WC0 sampler cannot treat their rounded ends as authority.
    if let Some(audited) = replayed_profile(checked)? {
        return Ok(crate::curve_profile_mesh::tessellate(&audited, deviation_mm * 0.5)?.mesh);
    }
    // A replayed planar arrangement owns rational vertices, including shells
    // and clipping results. Authenticate first; never triangulate WC0 caches.
    if body
        .surfaces
        .iter()
        .all(|s| matches!(s.geometry, SurfaceGeometry::Plane { .. }))
        && body.curves.iter().all(|c| {
            matches!(
                c.geometry,
                CurveGeometry::Line { .. } | CurveGeometry::ConstructionLine { .. }
            )
        })
        && body
            .curves
            .iter()
            .any(|c| matches!(c.geometry, CurveGeometry::ConstructionLine { .. }))
    {
        let audited = crate::polyhedron::audit(checked)?;
        if audited.arrangement.is_none() {
            return Err(no("rational-source-required"));
        }
        return arrangement_mesh(&audited, deviation_mm);
    }
    // Chamfer WC0 vertices are rounded witnesses of exact rational clipping.
    // The planar triangulator cannot use them as exact source geometry or
    // certify their displacement against its requested deviation yet.
    if crate::chamfer::candidate(body) {
        return Err(no("chamfer-witness-metric-unimplemented"));
    }
    // Perforated chamfers certify their rounded planar witnesses: the audited
    // displacement bound is reserved from the requested deviation.
    let mut deviation_mm = deviation_mm;
    if crate::perforated_chamfer::candidate(body) {
        let witness = crate::perforated_chamfer::audit(checked)?.witness_mm()?;
        if !(witness <= deviation_mm / 8.) {
            return Err(no("chamfer-witness-budget"));
        }
        deviation_mm = (deviation_mm - witness).next_down();
    }
    let planar_only = body
        .surfaces
        .iter()
        .all(|s| matches!(s.geometry, SurfaceGeometry::Plane { .. }))
        && body
            .curves
            .iter()
            .all(|c| matches!(c.geometry, CurveGeometry::Line { .. }));
    let mesh = if planar_only {
        planar(body, deviation_mm)?
    } else {
        crate::mesh_curved::tessellate(body, deviation_mm * 0.5)?
    };
    check_watertight(&mesh)?;
    Ok(mesh)
}

/// Certified interval filter of a mesh sign test: `Some(sign)` only when the
/// outward-rounded ball decides it (an exact zero included), else the caller
/// falls back to its exact expansion route.
fn filtered_sign(v: wonky_num::Iv) -> Option<i32> {
    match wonky_num::ball::decide(v, "mesh-filter") {
        Ok(Sign::Positive) => Some(1),
        Ok(Sign::Negative) => Some(-1),
        Ok(Sign::Zero) => Some(0),
        Err(undecided) => {
            // Not a refusal: the caller's exact route decides instead.
            undecided.into_refusal();
            None
        }
    }
}

/// Interval cross product of `b - a` and `c - a`.
fn cross_iv(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [wonky_num::Iv; 3] {
    let iv = wonky_num::Iv::point;
    let u = [0, 1, 2].map(|k| iv(b[k]) - iv(a[k]));
    let v = [0, 1, 2].map(|k| iv(c[k]) - iv(a[k]));
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| u[i] * v[j] - u[j] * v[i])
}

fn normals_agree(before: [[f64; 3]; 3], after: [[f64; 3]; 3]) -> R<bool> {
    let (a, b) = (cross_iv(before[0], before[1], before[2]), cross_iv(after[0], after[1], after[2]));
    if let Some(s) = filtered_sign(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) {
        return Ok(s > 0);
    }
    normals_agree_exact(before, after)
}

fn normals_agree_exact(before: [[f64; 3]; 3], after: [[f64; 3]; 3]) -> R<bool> {
    use wonky_num::expansion::{difference, mul, neg, sign, sum, Guard};
    let mut g = Guard::new();
    let normal = |p: [[f64; 3]; 3], g: &mut Guard| {
        let a = [0, 1, 2].map(|k| difference(p[1][k], p[0][k], g));
        let b = [0, 1, 2].map(|k| difference(p[2][k], p[0][k], g));
        [(1, 2), (2, 0), (0, 1)]
            .map(|(i, j)| sum(&mul(&a[i], &b[j], g), &neg(&mul(&a[j], &b[i], g)), g))
    };
    let a = normal(before, &mut g);
    let b = normal(after, &mut g);
    let mut dot = Vec::new();
    for k in 0..3 {
        dot = sum(&dot, &mul(&a[k], &b[k], &mut g), &mut g);
    }
    if !g.exact() {
        return Err(no("normal-predicate-range"));
    }
    Ok(sign(&dot) > 0)
}

/// Float32 conversion must preserve each shell's oriented volume sign. Facet
/// normal agreement alone is insufficient: a thin tetrahedron can turn inside
/// out while every old/new normal still has positive dot product.
pub(crate) fn preserve_shell_orientation(before: &Mesh, after: &Mesh, reversed: bool) -> R<()> {
    use wonky_num::expansion::{difference, mul, neg, sign, sum, Exp, Guard};
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let mut parent: Vec<_> = (0..before.triangles.len()).collect();
    let mut owner = HashMap::new();
    for (i, t) in before.triangles.iter().enumerate() {
        for &v in t {
            if let Some(j) = owner.insert(key(before.vertices[v]), i) {
                let a = root(&mut parent, i);
                let b = root(&mut parent, j);
                parent[a] = b;
            }
        }
    }
    let mut shells: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..parent.len() {
        let p = root(&mut parent, i);
        shells.entry(p).or_default().push(i);
    }
    for triangles in shells.values() {
        let mut signs = Vec::new();
        for mesh in [before, after] {
            let origin = mesh.vertices[mesh.triangles[triangles[0]][0]];
            // Interval filter first; the exact sum only when it cannot decide.
            let iv = wonky_num::Iv::point;
            let mut filtered = iv(0.);
            for &i in triangles {
                let [a, b, c] = mesh.triangles[i].map(|v| mesh.vertices[v]);
                let cross = cross_iv(origin, b, c);
                for k in 0..3 {
                    filtered = filtered + (iv(a[k]) - iv(origin[k])) * cross[k];
                }
            }
            if let Some(s) = filtered_sign(filtered) {
                signs.push(s);
                continue;
            }
            let mut g = Guard::new();
            let mut total: Exp = Vec::new();
            for &i in triangles {
                let [a, b, c] = mesh.triangles[i]
                    .map(|v| [0, 1, 2].map(|k| difference(mesh.vertices[v][k], origin[k], &mut g)));
                let cross = [(1, 2), (2, 0), (0, 1)].map(|(i, j)| {
                    sum(
                        &mul(&b[i], &c[j], &mut g),
                        &neg(&mul(&b[j], &c[i], &mut g)),
                        &mut g,
                    )
                });
                for k in 0..3 {
                    total = sum(&total, &mul(&a[k], &cross[k], &mut g), &mut g);
                }
            }
            if !g.exact() {
                return Err(no("volume-predicate-range"));
            }
            signs.push(sign(&total));
        }
        if signs[0] == 0 || signs[0] * if reversed { -1 } else { 1 } != signs[1] {
            return Err(no("rounded-shell-inversion"));
        }
    }
    Ok(())
}

/// Binary STL in millimetres. Quantize each vertex ONCE before writing facets,
/// bound this additional displacement, and recheck the actual serialized mesh.
/// The header and host metadata explicitly label even planar STL as a mesh.
pub fn binary_stl(meshes: &[Mesh], deviation_mm: f64) -> R<Vec<u8>> {
    if !deviation_mm.is_finite() || deviation_mm <= 0. {
        return Err(no("invalid-deviation"));
    }
    let count = meshes.iter().try_fold(0usize, |n, m| {
        n.checked_add(m.triangles.len())
            .ok_or_else(|| no("triangle-limit"))
    })?;
    if count == 0 || count > 2_000_000 {
        return Err(no("triangle-limit"));
    }
    let mut out = vec![0u8; 80];
    let header = format!("wonky; approximation: tessellated mesh; deviationMm={deviation_mm}");
    let n = header.len().min(80);
    out[..n].copy_from_slice(&header.as_bytes()[..n]);
    out.extend_from_slice(&(count as u32).to_le_bytes());
    let mut combined = Mesh {
        vertices: Vec::new(),
        triangles: Vec::with_capacity(count),
        ..Default::default()
    };
    let mut quantized = HashMap::new();
    for mesh in meshes {
        let vertices: Vec<_> = mesh
            .vertices
            .iter()
            .map(|p| p.map(|x| (x as f32) as f64))
            .collect();
        for (&p, &q) in mesh.vertices.iter().zip(&vertices) {
            // Outward L1 bound dominates Euclidean displacement, including
            // rounding in the subtraction and accumulation themselves.
            let mut displacement = wonky_num::Iv::point(0.);
            for k in 0..3 {
                let d = wonky_num::Iv::point(p[k]) - wonky_num::Iv::point(q[k]);
                displacement = displacement + wonky_num::Iv::point(d.lo().abs().max(d.hi().abs()));
            }
            if !displacement.hi().is_finite() || displacement.hi() > deviation_mm * 0.5 {
                return Err(no("float32-deviation-exceeded"));
            }
            if quantized
                .insert(key(q), key(p))
                .is_some_and(|previous| previous != key(p))
            {
                return Err(no("float32-vertex-collision"));
            }
        }
        let rounded = Mesh {
            vertices,
            triangles: mesh.triangles.clone(),
            ..Default::default()
        };
        check_watertight(&rounded)?;
        preserve_shell_orientation(mesh, &rounded, false)?;
        for t in &rounded.triangles {
            let original = t.map(|i| mesh.vertices[i]);
            let [a, b, c] = t.map(|i| rounded.vertices[i]);
            if !normals_agree(original, [a, b, c])? {
                return Err(no("float32-triangle-inversion"));
            }
            let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            let len = n[0].hypot(n[1]).hypot(n[2]);
            if !len.is_finite() || len == 0. {
                return Err(no("normal-range"));
            }
            for x in n.map(|x| x / len).into_iter().chain(a).chain(b).chain(c) {
                out.extend_from_slice(&(x as f32).to_le_bytes());
            }
            out.extend_from_slice(&0u16.to_le_bytes());
        }
        let offset = combined.vertices.len();
        combined.vertices.extend(rounded.vertices);
        combined
            .triangles
            .extend(rounded.triangles.into_iter().map(|t| t.map(|i| i + offset)));
    }
    check_watertight(&combined)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn arrangement_certificate_rejects_planted_bad_triangle_chains() {
        use crate::planar_geometry::q;
        let vertices = [[0.,0.,0.],[1.,0.,0.],[1.,1.,0.],[0.,1.,0.]];
        let exact = vertices.map(|p| p.map(q));
        let normal = [q(0.),q(0.),q(1.)];
        let loops = [vec![0,1,2,3]];
        let check = |t: &[[usize;3]], v: &[[f64;3]]| super::certify_arrangement_face(&exact,v,&loops,t,&normal);
        check(&[[0,1,2],[0,2,3]],&vertices).unwrap();
        for t in [vec![[0,2,1],[0,2,3]],vec![[0,1,2]],vec![[0,1,2],[0,2,3],[0,1,2]],vec![[0,0,2],[0,2,3]]] {
            assert!(check(&t,&vertices).is_err(), "planted chain accepted: {t:?}");
        }
        let mut rounded = vertices;
        rounded[1] = [0.,2.,0.];
        assert_eq!(check(&[[0,1,2],[0,2,3]],&rounded).unwrap_err().0,"export/stl/arrangement-triangle-rounding");
    }

    use super::*;
    #[test]
    fn source_arc_caches_cannot_enter_the_generic_sweep_predicates() {
        let body = crate::arc_profile::build(
            wonky_contract::BodyKey { id: [0; 4], revision: 0 }, crate::affine::Affine::IDENTITY,
            &[[2., 1., 1., 0.], [1., 0., 0., 1.]],
            &[[0., 1., 1.0000000000000002, 2., 2., 1.]], 0.01, false,
        ).unwrap();
        assert_eq!(crate::mesh_curved::tessellate(&body, 0.02).unwrap_err().0,
                   "mesh/curved/exact-source-profile-required");
        let mesh = tessellate(&body.check().unwrap(), 0.02).unwrap();
        check_watertight(&mesh).unwrap();
        assert!(mesh.triangles.len() < 8196);
    }
    #[test]
    fn regularized_arc_profile_exports_its_replayed_horn() {
        let body = crate::arc_profile::build_regularized_region(
            wonky_contract::BodyKey { id: [0; 4], revision: 0 }, crate::affine::Affine::IDENTITY,
            &[[0., -0.005, 0., 0.], [-0.005, -0.005, -0.005, -0.01],
              [-0.005, -0.01, 0.005, -0.01], [0.005, -0.01, 0.005, -0.005],
              [0.005, -0.005, 0., -0.005], [0., -0.01, 0., -0.005]],
            &[[0., 0., -0.002, -0.0040000000000001, -0.005, -0.005]],
            0.002, false, 0, 1e-9,
        ).unwrap();
        let checked = body.check().unwrap();
        let mesh = tessellate(&checked, 0.02).unwrap();
        check_watertight(&mesh).unwrap();
        assert!(!mesh.triangles.is_empty());
        // The exact replay refits this arc to centre (-5,0), radius 5 mm.
        // Its displayed circular boundary remains on that source carrier.
        for &id in &mesh.edges[1].vertices {
            let p = mesh.vertices[id];
            assert!(((p[0] + 5.).hypot(p[1]) - 5.).abs() < 1e-12);
        }
        binary_stl(&[mesh], 0.02).unwrap();
    }
    // Contract: holes and collinear boundary vertices survive exact triangulation.
    // Existing B-rep tests never check export diagonals or doubled hole bridges.
    #[test]
    fn holes_and_collinear_segments_are_preserved() {
        let points = [
            [0., 0.],
            [4., 0.],
            [10., 0.],
            [10., 10.],
            [0., 10.],
            [2., 2.],
            [2., 4.],
            [4., 4.],
            [4., 2.],
            [6., 6.],
            [6., 8.],
            [8., 8.],
            [8., 6.],
        ];
        let loops = vec![vec![0, 1, 2, 3, 4], vec![5, 6, 7, 8], vec![9, 10, 11, 12]];
        let triangles = triangulate_loops(&points, &loops).unwrap();
        let mut area = 0.;
        let mut edges = BTreeMap::new();
        for t in triangles {
            let [a, b, c] = t.map(|i| points[i]);
            area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2.;
            for i in 0..3 {
                let (a, b) = (t[i], t[(i + 1) % 3]);
                *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
            }
        }
        assert_eq!(area, 92.);
        for lp in loops {
            for i in 0..lp.len() {
                let (a, b) = (lp[i], lp[(i + 1) % lp.len()]);
                assert_eq!(edges[&(a.min(b), a.max(b))], 1);
            }
        }
        assert!(edges.values().all(|&n| n == 1 || n == 2));
    }
    #[test]
    fn concave_polygon_and_near_collinearity_use_exact_signs() {
        let points = [[0., 0.], [4., 0.], [4., 1.], [1., 1.], [1., 4.], [0., 4.]];
        let t = triangulate_loops(&points, &[vec![0, 1, 2, 3, 4, 5]]).unwrap();
        assert_eq!(t.len(), 4);
        let eps = f64::EPSILON;
        // Rounded products cancel to zero; the exact determinant is -eps².
        assert_eq!(
            orientation([0., 0.], [1. + eps, 1.], [1., 1. - eps]).unwrap(),
            Sign::Negative
        );
        assert!(triangulate_loops(
            &[[0., 0.], [2., 2.], [0., 2.], [2., 0.]],
            &[vec![0, 1, 2, 3]]
        )
        .is_err());
    }
    fn tetrahedron() -> Mesh {
        Mesh {
            vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            triangles: vec![[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]],
            ..Default::default()
        }
    }
    // The production serialization guard must reject actual missing/reversed
    // facets, not trust a B-rep certificate that says nothing about triangles.
    #[test]
    fn watertight_checker_rejects_open_reversed_and_duplicate_facets() {
        let mesh = tetrahedron();
        check_watertight(&mesh).unwrap();
        let bytes = binary_stl(&[mesh.clone()], 0.02).unwrap();
        assert_eq!(bytes.len(), 284);
        let mut open = mesh.clone();
        open.triangles.pop();
        assert!(check_watertight(&open).is_err());
        let mut flipped = mesh.clone();
        flipped.triangles[0].swap(1, 2);
        assert!(check_watertight(&flipped).is_err());
        let mut duplicate = mesh;
        duplicate.triangles.push(duplicate.triangles[0]);
        assert!(check_watertight(&duplicate).is_err());
    }
    #[test]
    fn combined_stl_rejects_duplicate_and_vertex_pinched_shells() {
        let a = tetrahedron();
        assert_eq!(
            binary_stl(&[a.clone(), a.clone()], 0.02).unwrap_err().0,
            "export/stl/duplicate-triangle"
        );
        let mut b = tetrahedron();
        for v in &mut b.vertices {
            for x in v {
                *x = -*x;
            }
        }
        for t in &mut b.triangles {
            t.swap(1, 2);
        }
        assert_eq!(
            binary_stl(&[a, b], 0.02).unwrap_err().0,
            "export/stl/nonmanifold-vertex"
        );
    }
    #[test]
    fn quantization_cannot_turn_a_thin_shell_inside_out() {
        // Independent review counterexample: all old/new face normals have
        // positive dot products, but the exact signed volume changes sign.
        let mut mesh = tetrahedron();
        mesh.vertices = vec![
            [0.9999998802635416, 1.00000031624263, 1.000000306383219],
            [0.9999998826799692, 0.999999588551262, 0.9999997748432635],
            [1.0000001108748628, 0.9999997531862745, 1.000000172947956],
            [1.0000001681355009, 0.99999986990593, 1.0000002520965],
        ];
        assert_eq!(
            binary_stl(&[mesh], 0.02).unwrap_err().0,
            "export/stl/rounded-shell-inversion"
        );
    }
    #[test]
    fn filtered_normal_agreement_matches_the_exact_route() {
        let t = |p: [[f64; 3]; 3], q: [[f64; 3]; 3]| (p, q);
        let one_up = 1f64.next_up();
        let cases = [
            t([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]], [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]]),
            t([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]], [[0., 0., 0.], [0., 1., 0.], [1., 0., 0.]]),
            // Perpendicular normals: the dot is exactly zero, so not agreeing.
            t([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]], [[0., 0., 0.], [1., 0., 0.], [0., 0., 1.]]),
            // Inexact differences around a zero dot: the ball straddles zero and
            // the exact expansions decide.
            t([[0.1, 0.2, 0.3], [1.1, 0.2, 0.3], [0.1, 1.2, 0.3]], [[0.1, 0.2, 0.3], [1.1, 0.2, 0.3], [0.1, 0.2, 1.3]]),
            t([[1., 1., 1.], [one_up, 1., 1.], [1., one_up, 1.]], [[1., 1., 1.], [one_up, 1., 1.], [1., 1., one_up]]),
            t([[0.9999998802635416, 1.00000031624263, 1.000000306383219], [0.9999998826799692, 0.999999588551262, 0.9999997748432635], [1.0000001108748628, 0.9999997531862745, 1.000000172947956]],
              [[0.99999988, 1.0000003, 1.0000003], [0.9999999, 0.9999996, 0.9999998], [1.0000001, 0.9999997, 1.0000002]]),
        ];
        let mut undecided = 0;
        for (before, after) in cases {
            assert_eq!(normals_agree(before, after).unwrap(), normals_agree_exact(before, after).unwrap(), "{before:?} {after:?}");
            let (a, b) = (cross_iv(before[0], before[1], before[2]), cross_iv(after[0], after[1], after[2]));
            undecided += usize::from(filtered_sign(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).is_none());
        }
        assert!(undecided > 0, "no case reached the exact fallback");
    }
    #[test]
    fn quantization_cannot_flip_a_facet_in_three_dimensions() {
        let mut mesh = tetrahedron();
        mesh.vertices = vec![
            [0.9999998262078776, 1.0000003012689302, 0.9999998846394726],
            [0.9999997240790854, 1.0000003213043225, 0.9999999207089444],
            [1.0000000396785604, 1.0000000472258581, 0.9999999654857258],
            [1.0000002411916529, 1.0000002821376357, 0.9999996526123891],
        ];
        assert!(binary_stl(&[mesh], 0.02).is_err());
    }
    // Planted negative: a sliver no retriangulation can remove. The bottom
    // face of a closed tetrahedron is split at M, 2^-40 mm inside the edge CB
    // (x + y = 64). Float32 rounds M to x + y = 64 + 2^-19: facet (C, B, M)
    // turns inside out while the shell volume keeps its sign.
    #[test]
    fn a_facet_that_float32_turns_inside_out_refuses_by_name() {
        let mx = 32. + 5. * 2f64.powi(-21);
        let my = 64. - 2f64.powi(-40) - mx;
        assert!(mx + my < 64. && (mx as f32) as f64 + (my as f32) as f64 > 64.);
        let mesh = Mesh {
            vertices: vec![[0., 0., 0.], [64., 0., 0.], [0., 64., 0.], [0., 0., 64.], [mx, my, 0.]],
            triangles: vec![[0, 2, 4], [2, 1, 4], [1, 0, 4], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
            ..Default::default()
        };
        check_watertight(&mesh).unwrap();
        assert_eq!(
            binary_stl(&[mesh], 0.02).unwrap_err().0,
            "export/stl/float32-triangle-inversion"
        );
    }
    #[test]
    fn ordered_witnesses_preserve_micro_edges_or_refuse_the_budget() {
        let q = |x| BigRational::from_f64(x).unwrap();
        let values = [q(-0.0101), q(-0.0101) + q(2_f64.powi(-65)), q(0.)];
        let out = ordered_witnesses(&values, 2_f64.powi(-26), 1e-6).unwrap();
        assert!(out[&values[0]] < out[&values[1]]);
        assert!(out[&values[1]] < out[&values[2]]);
        assert_eq!(ordered_witnesses(&values, 2_f64.powi(-26), 1e-20).unwrap_err().0, "export/stl/witness-displacement-budget");
    }

    #[test]
    fn ordered_witnesses_preserve_quadratic_micro_edges_or_refuse_the_budget() {
        use wonky_curve::radical::Radical;
        let q = |x| BigRational::from_f64(x).unwrap();
        let root = Radical::quadratic(q(0.), q(1.), q(2.)).unwrap();
        let values = [root.clone(), root + Radical::from(q(2_f64.powi(-65)))];
        assert_eq!(values[0].enclosure().unwrap().mid(), values[1].enclosure().unwrap().mid());
        let out = ordered_witnesses(&values, 2_f64.powi(-26), 1e-6).unwrap();
        assert!(out[&values[0]] < out[&values[1]]);
        for value in &values {
            assert!((Radical::from(q(out[value])) - value).abs() <= Radical::from(q(1e-6)));
        }
        assert_eq!(ordered_witnesses(&values, 2_f64.powi(-26), 1e-20).unwrap_err().0, "export/stl/witness-displacement-budget");
    }

    // A tiny chart-space bend rounds onto a straight world edge. Cap
    // triangulation must preserve that vertex and select different diagonals,
    // rather than create a source-chart ear that collapses in the output.
    #[test]
    fn placed_cap_preserves_collinear_boundary_without_zero_area_facets() {
        let points = [[0., 0., 0.], [1., 0., 0.], [2., 0., 0.], [2., 2., 0.], [0., 2., 0.]];
        let loops = [vec![0, 1, 2, 3, 4]];
        let triangles = triangulate_planar_cap(&points, &loops, &[vec![0.], vec![0.], vec![1.]]).unwrap();
        assert_eq!(triangles.len(), 3);
        let mut edges = BTreeMap::new();
        for t in triangles {
            let p = t.map(|i| [points[i][0], points[i][1]]);
            assert_eq!(orientation(p[0], p[1], p[2]).unwrap(), Sign::Positive);
            for j in 0..3 { *edges.entry((t[j].min(t[(j + 1) % 3]), t[j].max(t[(j + 1) % 3]))).or_insert(0) += 1; }
        }
        for i in 0..5 { let (a, b) = (i, (i + 1) % 5); assert_eq!(edges[&(a.min(b), a.max(b))], 1); }
    }

    // Contract: holes are triangulated by the constrained Delaunay criterion
    // (exact incircle), not left as ear-clipping needles: no triangle's
    // circumcircle strictly contains a vertex visible across a non-contour
    // edge, and every triangle stays strictly counterclockwise. The holes'
    // extreme samples share the line y = 30 and several bridges leave one
    // outer vertex; inserting them out of wedge order left no ear
    // (export/stl/triangulation-undecided before the wedge test).
    #[test]
    fn hole_triangulation_is_locally_delaunay() {
        let mut points = vec![[0., 0.], [120., 0.], [120., 60.], [0., 60.]];
        let mut loops = vec![vec![0, 1, 2, 3]];
        for (i, r) in [2.75, 3.75, 4.75].into_iter().enumerate() {
            let start = points.len();
            for j in 0..64 {
                let a = std::f64::consts::TAU * j as f64 / 64.;
                points.push([20. + 40. * i as f64 + r * a.cos(), 30. + r * a.sin()]);
            }
            loops.push((start..start + 64).rev().collect());
        }
        let triangles = triangulate_loops(&points, &loops).unwrap();
        assert_eq!(triangles.len(), points.len() + 2 * 3 - 2);
        let mut owner = BTreeMap::new();
        for (i, t) in triangles.iter().enumerate() {
            let [a, b, c] = t.map(|k| points[k]);
            assert_eq!(orientation(a, b, c).unwrap(), Sign::Positive);
            for k in 0..3 {
                owner.insert((t[k], t[(k + 1) % 3]), i);
            }
        }
        for (&(u, v), &i) in &owner {
            let Some(&j) = owner.get(&(v, u)) else { continue };
            let w = triangles[i].into_iter().find(|&k| k != u && k != v).unwrap();
            let x = triangles[j].into_iter().find(|&k| k != u && k != v).unwrap();
            assert_ne!(
                in_circle(points[u], points[v], points[w], points[x]).unwrap(),
                Sign::Positive
            );
        }
    }
    #[test]
    fn float32_collision_is_refused_not_silently_welded() {
        let mut mesh = tetrahedron();
        mesh.vertices[1] = [1e8, 0., 0.];
        mesh.vertices[0] = [1e8 + 1., 0., 0.];
        assert_eq!(binary_stl(&[mesh], 10.).unwrap_err().0, "export/stl/float32-vertex-collision");
    }
}
