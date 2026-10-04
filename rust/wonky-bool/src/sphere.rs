//! G14: the split of one sphere face in G8's stereographic two-patch atlas
//! (`wonky_geom::model::stereo`). Every circle on the sphere is a plane
//! section `l_axis = h` of its own frame (old ring trims and A1 cuts alike),
//! so each patch is one `wonky-curve` arrangement of the seam and the circle
//! images restricted to the closed unit disc. Cells are classified at exact
//! rational witnesses; cells with the same decision are joined across the
//! virtual seam and across section pieces that bound nothing, and each kept
//! region's boundary is walked in 3D (seam crossings are not vertices) and
//! grouped into edges by source circle. No distance decides anything.
use num_traits::{Signed, Zero};
use std::collections::BTreeMap;
use wonky_curve::{
    arrange_pieces_exact,
    radical::{self, Radical},
    Arrangement, Budget, Carrier, ExactPoint, Trimmed, UNBOUNDED,
};
use wonky_geom::{
    model::{curved::Patch, stereo, Bounds, Curve3, FaceId, Model, RPoint, Sphere3},
    Point, Refused, Result, Q,
};

fn fail(check: &'static str) -> Refused {
    Refused(check)
}
fn curve<T>(v: std::result::Result<T, wonky_curve::Refusal>) -> Result<T> {
    v.map_err(|e| Refused(e.name()))
}
fn arithmetic<T>(f: impl FnOnce() -> T) -> Result<T> {
    radical::guard(f).map_err(|_| fail("boolean/budget-exceeded:sphere-arithmetic"))
}

/// A circle on the sphere: own coordinate `axis` equals `h`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Latitude {
    pub axis: usize,
    pub h: Radical,
}
/// One edge of a kept region, in traversal order.
#[derive(Clone, Debug)]
pub struct Edge {
    pub circle: Latitude,
    /// Model-frame ends; `None` for a ring.
    pub ends: Option<[RPoint; 2]>,
    /// The traversal runs counter-clockwise about the frame column `axis`.
    pub ccw: bool,
    /// Chart pieces in traversal order (the coedge's atlas trim).
    pub pieces: Vec<(Patch, Trimmed)>,
}
/// A kept region: its loops run with the region on their left seen from
/// outside the sphere; `flip` is the selection's orientation flip.
#[derive(Clone, Debug)]
pub struct Region {
    pub flip: bool,
    pub loops: Vec<Vec<Edge>>,
}

/// The latitude of an A1 section circle (frame `f`, centre `height` along
/// its third column) on sphere `s`: the frame column it is perpendicular to
/// and its centre's own coordinate there. A branch of another sphere's
/// frame (a lens) is re-read in this sphere's frame.
pub fn latitude(s: &Sphere3, f: &wonky_geom::frame::Frame, height: &Radical) -> Result<Latitude> {
    let z = &f.columns()[2];
    let axis = (0..3)
        .find(|&k| wonky_geom::cross(&s.frame.columns()[k], z).iter().all(Zero::is_zero))
        .ok_or(fail("boolean/sphere-chart-conflict"))?;
    let centre: RPoint = arithmetic(|| std::array::from_fn(|i| Radical::from(f.origin()[i].clone()) + height * &z[i]))?;
    let l = stereo::local(s, &centre)?;
    if !l[(axis + 1) % 3].is_zero() || !l[(axis + 2) % 3].is_zero() {
        return Err(fail("boolean/sphere-chart-conflict"));
    }
    Ok(Latitude { axis, h: l[axis].clone() })
}
/// An old ring trim of the face: its latitude and the side of its plane the
/// face lies on (`true`: `l_axis > h`).
fn old_ring(m: &Model, s: &Sphere3, forward_face: bool, co: &wonky_geom::model::Coedge) -> Result<(Latitude, bool)> {
    let d = m.draft();
    let e = &d.edges[co.edge.index()];
    if !matches!(e.bounds, Bounds::Ring) {
        return Err(fail("boolean/ssi-row-unavailable:sphere/retrim-arc-loop"));
    }
    let (centre, cols): (RPoint, [Point; 3]) = match &d.curves[e.curve.index()].geometry {
        Curve3::Circle(c) => (c.origin(), c.columns().clone()),
        Curve3::RadicalCircle(c) => {
            let f = &c.frame;
            let centre = arithmetic(|| {
                std::array::from_fn(|i| Radical::from(f.origin()[i].clone()) + c.height() * &f.columns()[2][i])
            })?;
            (centre, f.columns().clone())
        }
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(fail("model/g4-ring-on-open-curve")),
        Curve3::TranslatedCircle(_) => return Err(fail("boolean/ssi-row-unavailable:translated-circle/sphere-retrim")),
    };
    let n = wonky_geom::cross(&cols[0], &cols[1]);
    let inv = s.frame.inverse();
    let nl: Point = std::array::from_fn(|i| (0..3).fold(Q::zero(), |v, j| v + &n[j] * &inv.columns()[j][i]));
    let nonzero = (0..3).filter(|&i| !nl[i].is_zero()).collect::<Vec<_>>();
    let [axis] = nonzero[..] else {
        return Err(fail("boolean/sphere-chart-conflict"));
    };
    let l = stereo::local(s, &centre)?;
    if !l[(axis + 1) % 3].is_zero() || !l[(axis + 2) % 3].is_zero() {
        return Err(fail("boolean/sphere-chart-conflict"));
    }
    let ccw = co.forward != nl[axis].is_negative();
    Ok((Latitude { axis, h: l[axis].clone() }, ccw == forward_face))
}

struct Chart {
    arr: Arrangement,
    /// Source of each arrangement piece: `None` the virtual seam.
    source: Vec<Option<usize>>,
    seam_is: Option<usize>,
}
fn arrange(a: &Q, circles: &[Latitude], patch: Patch, budget: Budget) -> Result<Chart> {
    let mut pieces = vec![stereo::seam()?];
    let mut ids = vec![None];
    let mut seam_is = None;
    for (i, c) in circles.iter().enumerate() {
        match stereo::disc_pieces(a, c.axis, &c.h, patch)? {
            None => seam_is = Some(i),
            Some(ps) => {
                for p in ps {
                    pieces.push(p);
                    ids.push(Some(i));
                }
            }
        }
    }
    if seam_is.is_some() {
        ids[0] = seam_is;
    }
    let arr = curve(arrange_pieces_exact(&[&pieces], budget))?;
    let source = arr
        .pieces
        .iter()
        .map(|p| match p.owners[..] {
            [(_, k, _)] => Ok(ids[k]),
            _ => Err(fail("boolean/contract-violation:sphere/piece-owners")),
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Chart { arr, source, seam_is })
}
fn is_seam(c: &Chart, piece: usize) -> bool {
    // The seam piece is owned by input 0; when the equator is a real circle
    // the source id is that circle's, so test the owner index instead.
    c.arr.pieces[piece].owners[0].1 == 0
}
fn witness(arr: &Arrangement, cell: usize, avoid: &[ExactPoint]) -> Result<[Q; 2]> {
    for exact in [false, true] {
        let w = if exact { arr.witness_exact(cell, &[], avoid) } else { arr.witness(cell, &[], avoid) };
        if let Ok(w) = w {
            if let Ok(p) = w.rat() {
                return Ok(p.clone());
            }
        }
    }
    Err(fail("boolean/budget-exceeded:sphere-witness"))
}
fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}
/// The bounded cell on the inner side of a seam piece.
fn seam_cell(arr: &Arrangement, piece: usize) -> Result<usize> {
    match (arr.face[2 * piece], arr.face[2 * piece + 1]) {
        (c, UNBOUNDED) | (UNBOUNDED, c) if c != UNBOUNDED => Ok(c),
        _ => Err(fail("boolean/contract-violation:sphere/seam-side")),
    }
}
fn mirror(p: &ExactPoint) -> Result<ExactPoint> {
    let [u, v] = p.coordinates();
    curve(ExactPoint::from_coordinates([u, arithmetic(|| -v)?]))
}

/// Split sphere face `fi` of `m` by the latitudes `cuts`, classify each cell
/// with `decide` (the kept orientation flip, or `None`), and return the kept
/// regions. Old trims must be rings (latitudes of the carrier frame); a face
/// with arc loops (an earlier stereographic split) refuses by name.
pub fn split(
    m: &Model,
    fi: FaceId,
    cuts: &[Latitude],
    budget: Budget,
    decide: &mut dyn FnMut(&Point) -> Result<Option<bool>>,
    touch: &[(usize, RPoint)],
    kept: &mut dyn FnMut(usize),
) -> Result<Vec<Region>> {
    let d = m.draft();
    let f = &d.faces[fi.index()];
    let wonky_geom::model::Carrier3::Sphere(s) = &d.surfaces[f.surface.index()].carrier else {
        return Err(fail("boolean/contract-violation:sphere/carrier"));
    };
    let a = s.radius().clone();
    let mut circles: Vec<Latitude> = vec![];
    let mut sides = vec![];
    for lp in &f.loops {
        let lp = &d.loops[lp.index()];
        if lp.coedges.len() != 1 {
            return Err(fail("boolean/ssi-row-unavailable:sphere/retrim-arc-loop"));
        }
        let (lat, side) = old_ring(m, s, f.forward, &d.coedges[lp.coedges[0].index()])?;
        sides.push((lat.clone(), side));
        circles.push(lat);
    }
    for c in cuts {
        if c.axis > 2 {
            return Err(fail("boolean/contract-violation:sphere/axis"));
        }
        if stereo::circle_radius(&a, &c.h)?.is_some() && !circles.contains(c) {
            circles.push(c.clone());
        }
    }
    if circles.len() > budget.segments {
        return Err(fail("boolean/budget-exceeded:sphere-circles"));
    }
    let patches = [Patch::First, Patch::Second];
    let charts = [arrange(&a, &circles, Patch::First, budget)?, arrange(&a, &circles, Patch::Second, budget)?];
    if charts[0].seam_is != charts[1].seam_is {
        return Err(fail("boolean/contract-violation:sphere/seam-identity"));
    }
    let offset = charts[0].arr.cells.len();
    let gid = |p: usize, c: usize| if p == 0 { c } else { offset + c };
    let total = offset + charts[1].arr.cells.len();
    // Touch points in each patch: no witness may sit on one.
    let mut avoid = [vec![], vec![]];
    for (_, x) in touch {
        let l = stereo::local(s, x)?;
        for (p, patch) in patches.iter().enumerate() {
            if let Ok(uv) = stereo::chart_local(&a, *patch, &l) {
                avoid[p].push(curve(ExactPoint::from_coordinates(uv))?);
            }
        }
    }
    // Decision per cell: None outside the old face or dropped.
    let mut decision = vec![None; total];
    for (p, chart) in charts.iter().enumerate() {
        for ci in 0..chart.arr.cells.len() {
            let uv = witness(&chart.arr, ci, &avoid[p])?;
            let l = stereo::lift_local(&a, patches[p], &uv.clone().map(Radical::from))?;
            let inside = sides.iter().all(|(lat, above)| {
                let v = &l[lat.axis];
                if *above { v > &lat.h } else { v < &lat.h }
            });
            if !inside {
                continue;
            }
            let at = s.frame.point(&uv_point(&a, patches[p], &uv));
            decision[gid(p, ci)] = decide(&at)?;
        }
    }
    // Isolated touch points in the closure of a kept cell.
    for (k, x) in touch {
        let l = stereo::local(s, x)?;
        let patch = stereo::patch_of(&l);
        let p = usize::from(patch == Patch::Second);
        let uv = curve(ExactPoint::from_coordinates(stereo::chart_local(&a, patch, &l)?))?;
        for ci in 0..charts[p].arr.cells.len() {
            if decision[gid(p, ci)].is_some() && crate::curved::closure_contains(&charts[p].arr, ci, &uv)? {
                kept(*k);
            }
        }
    }
    let mut parent = (0..total).collect::<Vec<_>>();
    // Seam pieces of the two patches meet in mirrored chart points.
    let mut across = BTreeMap::new();
    let seam_pieces = |c: &Chart| (0..c.arr.pieces.len()).filter(|&i| is_seam(c, i)).collect::<Vec<_>>();
    // Ends of a seam piece counter-clockwise; the mirror reverses the sense,
    // so a First arc from e0 to e1 is the Second arc from e1' to e0' (two
    // seam arcs can share both ends, so the order decides).
    let ccw_ends = |c: &Chart, i: usize| -> [ExactPoint; 2] {
        let seg = &c.arr.pieces[i].seg;
        let e = seg.ends().clone();
        match seg.carrier() {
            Carrier::Circle(k) if !k.ccw => [e[1].clone(), e[0].clone()],
            _ => e,
        }
    };
    let second = seam_pieces(&charts[1]);
    for i in seam_pieces(&charts[0]) {
        let e = ccw_ends(&charts[0], i);
        let key = [mirror(&e[1])?, mirror(&e[0])?];
        let j = *second
            .iter()
            .find(|&&j| ccw_ends(&charts[1], j) == key)
            .ok_or(fail("boolean/contract-violation:sphere/seam-match"))?;
        let (ca, cb) = (gid(0, seam_cell(&charts[0].arr, i)?), gid(1, seam_cell(&charts[1].arr, j)?));
        across.insert((0, i), cb);
        across.insert((1, j), ca);
        if charts[0].source[i].is_none() && decision[ca] != decision[cb] {
            return Err(fail("boolean/contract-violation:sphere/seam-class"));
        }
        if decision[ca] == decision[cb] {
            let (x, y) = (root(&mut parent, ca), root(&mut parent, cb));
            parent[y] = x;
        }
    }
    for (p, chart) in charts.iter().enumerate() {
        for i in 0..chart.arr.pieces.len() {
            if is_seam(chart, i) {
                continue;
            }
            let (l, r) = (chart.arr.face[2 * i], chart.arr.face[2 * i + 1]);
            if l == UNBOUNDED || r == UNBOUNDED {
                return Err(fail("boolean/contract-violation:sphere/piece-outside-disc"));
            }
            let (l, r) = (gid(p, l), gid(p, r));
            if decision[l] == decision[r] {
                let (x, y) = (root(&mut parent, l), root(&mut parent, r));
                parent[y] = x;
            }
        }
    }
    let mut regions = BTreeMap::<usize, Vec<(usize, usize)>>::new();
    for (p, chart) in charts.iter().enumerate() {
        for ci in 0..chart.arr.cells.len() {
            if decision[gid(p, ci)].is_some() {
                regions.entry(root(&mut parent, gid(p, ci))).or_default().push((p, ci));
            }
        }
    }
    let mut out = vec![];
    for (rid, cells) in regions {
        let flip = decision[gid(cells[0].0, cells[0].1)].expect("kept cell");
        // Boundary half-edges with the region on their left.
        let mut boundary = vec![];
        for &(p, ci) in &cells {
            let arr = &charts[p].arr;
            for cycle in &arr.cells[ci].cycles {
                for &h in cycle {
                    let piece = h / 2;
                    let other = if is_seam(&charts[p], piece) {
                        *across.get(&(p, piece)).ok_or(fail("boolean/contract-violation:sphere/seam-match"))?
                    } else {
                        gid(p, arr.face[h ^ 1])
                    };
                    if root(&mut parent, other) == rid {
                        continue;
                    }
                    let source = charts[p].source[piece].ok_or(fail("boolean/contract-violation:sphere/virtual-boundary"))?;
                    let seg = arr.oriented(h);
                    let ends = seg.ends();
                    let from = stereo::lift_local(&a, patches[p], &ends[0].coordinates())?;
                    let to = stereo::lift_local(&a, patches[p], &ends[1].coordinates())?;
                    boundary.push((source, patches[p], seg, from, to));
                }
            }
        }
        let mut loops = vec![];
        let mut used = vec![false; boundary.len()];
        for start in 0..boundary.len() {
            if used[start] {
                continue;
            }
            let mut lp = vec![start];
            used[start] = true;
            while boundary[*lp.last().unwrap()].4 != boundary[start].3 {
                let tail = &boundary[*lp.last().unwrap()].4;
                let next = (0..boundary.len()).filter(|&k| !used[k] && &boundary[k].3 == tail).collect::<Vec<_>>();
                let [k] = next[..] else {
                    return Err(fail(if next.is_empty() {
                        "boolean/contract-violation:sphere/open-boundary"
                    } else {
                        "boolean/ssi-row-unavailable:sphere/pinched-region"
                    }));
                };
                used[k] = true;
                lp.push(k);
            }
            // Edges change where the source circle changes.
            let n = lp.len();
            let first = (0..n).find(|&i| boundary[lp[i]].0 != boundary[lp[(i + n - 1) % n]].0);
            let mut edges = vec![];
            match first {
                None => edges.push(lp.clone()),
                Some(i0) => {
                    let mut cur: Vec<usize> = vec![];
                    for k in 0..n {
                        let b = lp[(i0 + k) % n];
                        if cur.last().is_some_and(|&c| boundary[c].0 != boundary[b].0) {
                            edges.push(std::mem::take(&mut cur));
                        }
                        cur.push(b);
                    }
                    edges.push(cur);
                }
            }
            let mut out_loop = vec![];
            for e in edges {
                let lat = circles[boundary[e[0]].0].clone();
                let ring = first.is_none();
                let pieces = e.iter().map(|&k| (boundary[k].1, boundary[k].2.clone())).collect::<Vec<_>>();
                let ccw = orientation(&a, &lat, &boundary[e[0]])?;
                let ends = if ring {
                    None
                } else {
                    Some([stereo::model(s, &boundary[e[0]].3)?, stereo::model(s, &boundary[*e.last().unwrap()].4)?])
                };
                out_loop.push(Edge { circle: lat, ends, ccw, pieces });
            }
            loops.push(out_loop);
        }
        out.push(Region { flip, loops });
    }
    Ok(out)
}
fn uv_point(a: &Q, patch: Patch, uv: &[Q; 2]) -> Point {
    let sg = match patch {
        Patch::First => Q::from_integer(1.into()),
        Patch::Second => Q::from_integer((-1).into()),
    };
    let two = Q::from_integer(2.into());
    let s = &uv[0] * &uv[0] + &uv[1] * &uv[1];
    let d = Q::from_integer(1.into()) + &s;
    [&two * a * &uv[0] / &d, &two * a * &sg * &uv[1] / &d, a * &sg * (Q::from_integer(1.into()) - s) / d]
}
/// Whether a boundary piece runs counter-clockwise about its circle's axis
/// column: three distinct points in traversal order turn the traversal's
/// way; a full chart ring keeps its chart sense in First and reverses it in
/// Second (the mirrored chart).
fn orientation(a: &Q, lat: &Latitude, b: &(usize, Patch, Trimmed, RPoint, RPoint)) -> Result<bool> {
    let (_, patch, seg, from, to) = b;
    if seg.is_ring() {
        let Carrier::Circle(c) = seg.carrier() else {
            return Err(fail("boolean/contract-violation:sphere/ring-carrier"));
        };
        if lat.axis != 2 {
            return Err(fail("boolean/contract-violation:sphere/ring-axis"));
        }
        return Ok(c.ccw != (*patch == Patch::Second));
    }
    let m = stereo::lift_local(a, *patch, &curve(seg.exact_interior_point())?.coordinates())?;
    let turn = arithmetic(|| {
        let u: RPoint = std::array::from_fn(|i| &m[i] - &from[i]);
        let v: RPoint = std::array::from_fn(|i| &to[i] - &m[i]);
        let k = lat.axis;
        let (i, j) = ((k + 1) % 3, (k + 2) % 3);
        &u[i] * &v[j] - &u[j] * &v[i]
    })?;
    if turn.is_zero() {
        return Err(fail("boolean/contract-violation:sphere/collinear-arc"));
    }
    Ok(turn.is_positive())
}

