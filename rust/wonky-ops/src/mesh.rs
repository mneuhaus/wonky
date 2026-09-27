//! Export-only tessellation of WC0 bodies. Never feeds approximate coordinates
//! back into modelling. Straight planar contours use only their own vertices;
//! all triangulation signs are exact predicates on the source binary64 values.
use crate::{placement::Placement, polyhedron::Refused};
use num_rational::BigRational;
use num_traits::{FromPrimitive, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_contract::{Body, CheckedBody, CurveGeometry, SurfaceGeometry};
use wonky_num::{orient2d, p2, Sign};

type R<T> = Result<T, Refused>;
fn no(reason: &str) -> Refused {
    Refused(format!("export/stl/{reason}"))
}

#[derive(Clone, Debug)]
pub struct Mesh {
    /// World millimetres. Shared boundaries share vertex indices.
    pub vertices: Vec<[f64; 3]>,
    pub triangles: Vec<[usize; 3]>,
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

/// One outer contour followed by holes. Returns CCW triangles, preserving every
/// input contour segment, including collinear vertices. No Steiner points.
/// Bridges are visible vertex-to-vertex diagonals, chosen by exact intersection
/// and rational midpoint tests; the doubled bridge is then ear-clipped.
pub fn triangulate_loops(points: &[[f64; 2]], loops: &[Vec<usize>]) -> R<Vec<[usize; 3]>> {
    if loops.is_empty() || loops.iter().map(Vec::len).sum::<usize>() > 8192 {
        return Err(no("contour-resource-limit"));
    }
    let mut contours = loops.to_vec();
    for (i, c) in contours.iter_mut().enumerate() {
        if c.len() < 3 || c.iter().any(|&k| k >= points.len()) {
            return Err(no("invalid-contour"));
        }
        let polygon: Vec<_> = c.iter().map(|&k| p2(points[k][0], points[k][1])).collect();
        wonky_sketch::region::simple_polygon(&polygon).map_err(|_| no("non-simple-contour"))?;
        let sign = area_sign(points, c)?;
        if sign == 0 {
            return Err(no("zero-area-contour"));
        }
        if (sign > 0) != (i == 0) {
            c.reverse();
        }
    }
    // Distinct contours may not touch or cross. Such a face is not a polygon
    // with disjoint holes and requires a different exact arrangement.
    for i in 0..contours.len() {
        for j in i + 1..contours.len() {
            for a in 0..contours[i].len() {
                for b in 0..contours[j].len() {
                    let (p, q) = (
                        points[contours[i][a]],
                        points[contours[i][(a + 1) % contours[i].len()]],
                    );
                    let (r, s) = (
                        points[contours[j][b]],
                        points[contours[j][(b + 1) % contours[j].len()]],
                    );
                    if p == r || p == s || q == r || q == s || obstructs(p, q, r, s)? {
                        return Err(no("intersecting-contours"));
                    }
                }
            }
        }
    }
    for i in 1..contours.len() {
        let point = points[contours[i][0]];
        for (j, contour) in contours.iter().enumerate() {
            if i == j {
                continue;
            }
            let polygon: Vec<_> = contour
                .iter()
                .map(|&k| p2(points[k][0], points[k][1]))
                .collect();
            let location = wonky_sketch::region::locate(&polygon, p2(point[0], point[1]))
                .map_err(|_| no("numeric-decision"))?;
            let expected = if j == 0 {
                wonky_sketch::region::Location::Inside
            } else {
                wonky_sketch::region::Location::Outside
            };
            if location != expected {
                return Err(no("invalid-hole-nesting"));
            }
        }
    }
    let mut polygon = contours[0].clone();
    for hole in contours.iter().skip(1) {
        let mut bridge = None;
        'candidate: for (i, &a) in polygon.iter().enumerate() {
            for (j, &b) in hole.iter().enumerate() {
                let mut blocked = false;
                for contour in contours.iter().chain(std::iter::once(&polygon)) {
                    for k in 0..contour.len() {
                        if obstructs(
                            points[a],
                            points[b],
                            points[contour[k]],
                            points[contour[(k + 1) % contour.len()]],
                        )? {
                            blocked = true;
                            break;
                        }
                    }
                    if blocked {
                        break;
                    }
                }
                if blocked || !midpoint_inside(points, &contours[0], a, b)? {
                    continue;
                }
                for h in contours.iter().skip(1) {
                    if midpoint_inside(points, h, a, b)? {
                        blocked = true;
                        break;
                    }
                }
                if !blocked {
                    bridge = Some((i, j));
                    break 'candidate;
                }
            }
        }
        let (i, j) = bridge.ok_or_else(|| no("hole-bridge-undecided"))?;
        let mut joined = polygon[..=i].to_vec();
        joined.extend((0..hole.len()).map(|k| hole[(j + k) % hole.len()]));
        joined.extend([hole[j], polygon[i]]);
        joined.extend_from_slice(&polygon[i + 1..]);
        polygon = joined;
    }
    let mut triangles = Vec::with_capacity(polygon.len() - 2);
    while polygon.len() > 3 {
        let n = polygon.len();
        let mut ear = None;
        for i in 0..n {
            let ids = [polygon[(i + n - 1) % n], polygon[i], polygon[(i + 1) % n]];
            let [a, b, c] = ids.map(|k| points[k]);
            if orientation(a, b, c)? != Sign::Positive {
                continue;
            }
            let mut blocked = false;
            for &k in &polygon {
                let p = points[k];
                if p == a || p == b || p == c {
                    continue;
                }
                if orientation(a, b, p)? != Sign::Negative
                    && orientation(b, c, p)? != Sign::Negative
                    && orientation(c, a, p)? != Sign::Negative
                {
                    blocked = true;
                    break;
                }
            }
            if blocked {
                continue;
            }
            for j in 0..n {
                let (p, q) = (points[polygon[j]], points[polygon[(j + 1) % n]]);
                // Edges incident on an ear's diagonal endpoints are admissible
                // except for overlap, tested above by the inclusive point test.
                if p == a || p == c || q == a || q == c {
                    continue;
                }
                if obstructs(a, c, p, q)? {
                    blocked = true;
                    break;
                }
            }
            if !blocked {
                ear = Some((i, ids));
                break;
            }
        }
        let (i, t) = ear.ok_or_else(|| no("triangulation-undecided"))?;
        triangles.push(t);
        polygon.remove(i);
    }
    let t = [polygon[0], polygon[1], polygon[2]];
    if orientation(points[t[0]], points[t[1]], points[t[2]])? != Sign::Positive {
        return Err(no("degenerate-final-triangle"));
    }
    triangles.push(t);
    Ok(triangles)
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
            use wonky_num::expansion::{sum, Guard};
            use wonky_num::Iv;
            let frame =
                Placement::from_frames(body, v.frame).map_err(|_| no("vertex-frame-range"))?;
            let exact = frame
                .apply_exact(v.point.map(|x| x.get()), 1000., true)
                .map_err(|_| no("vertex-frame-range"))?;
            let mut out = [0.; 3];
            let mut error = Iv::point(0.);
            let mut g = Guard::new();
            for k in 0..3 {
                out[k] = crate::rounding::round(&exact[k]).map_err(|_| no("vertex-frame-range"))?;
                let residual = sum(&exact[k], &[-out[k]], &mut g);
                for term in residual {
                    error = error + Iv::point(term.abs());
                }
            }
            if !g.exact() || !error.hi().is_finite() || error.hi() > deviation_mm * 0.5 {
                return Err(no("vertex-precision-budget"));
            }
            Ok(out)
        })
        .collect::<R<Vec<_>>>()?;
    let mut triangles = Vec::new();
    for face in &body.faces {
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
        }
    }
    let mesh = Mesh {
        vertices,
        triangles,
    };
    let source_mesh = Mesh {
        vertices: source,
        triangles: mesh.triangles.clone(),
    };
    let frame = body.vertices.first().ok_or_else(|| no("empty-mesh"))?.frame;
    let reversed = Placement::from_frames(body, frame)
        .and_then(|f| f.reversed())
        .map_err(|_| no("frame-orientation"))?;
    preserve_shell_orientation(&source_mesh, &mesh, reversed)?;
    Ok(mesh)
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
    let mut ids = BTreeMap::new();
    let mut canonical = Vec::new();
    for &p in &mesh.vertices {
        if p.iter().any(|x| !x.is_finite()) {
            return Err(no("non-finite-coordinate"));
        }
        let next = ids.len();
        canonical.push(*ids.entry(key(p)).or_insert(next));
    }
    let mut edges: BTreeMap<(usize, usize), (usize, i32)> = BTreeMap::new();
    let mut facets = BTreeSet::new();
    let mut links = vec![Vec::new(); ids.len()];
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
            links[c[i]].push((c[(i + 1) % 3], c[(i + 2) % 3]));
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
    for pairs in links.into_iter().filter(|p| !p.is_empty()) {
        let mut adjacency: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (a, b) in pairs {
            adjacency.entry(a).or_default().push(b);
            adjacency.entry(b).or_default().push(a);
        }
        if adjacency.values().any(|n| n.len() != 2) {
            return Err(no("nonmanifold-vertex"));
        }
        let mut pending = vec![*adjacency.keys().next().unwrap()];
        let mut visited = BTreeSet::new();
        while let Some(v) = pending.pop() {
            if visited.insert(v) {
                pending.extend(&adjacency[&v]);
            }
        }
        if visited.len() != adjacency.len() {
            return Err(no("nonmanifold-vertex"));
        }
    }
    Ok(())
}

pub fn tessellate(checked: &CheckedBody, deviation_mm: f64) -> R<Mesh> {
    if !deviation_mm.is_finite() || deviation_mm <= 0. {
        return Err(no("invalid-deviation"));
    }
    let body = checked.body();
    // Chamfer WC0 vertices are rounded witnesses of exact rational clipping.
    // The planar triangulator cannot use them as exact source geometry or
    // certify their displacement against its requested deviation yet.
    if crate::chamfer::candidate(body) {
        return Err(no("chamfer-witness-metric-unimplemented"));
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

fn normals_agree(before: [[f64; 3]; 3], after: [[f64; 3]; 3]) -> R<bool> {
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
fn preserve_shell_orientation(before: &Mesh, after: &Mesh, reversed: bool) -> R<()> {
    use wonky_num::expansion::{difference, mul, neg, sign, sum, Exp, Guard};
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let mut parent: Vec<_> = (0..before.triangles.len()).collect();
    let mut owner = BTreeMap::new();
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
    };
    let mut quantized = BTreeMap::new();
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
    use super::*;
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
    #[test]
    fn float32_collision_is_refused_not_silently_welded() {
        let mut mesh = tetrahedron();
        mesh.vertices[1] = [1e8, 0., 0.];
        mesh.vertices[0] = [1e8 + 1., 0., 0.];
        assert!(binary_stl(&[mesh], 10.).is_err());
    }
}
