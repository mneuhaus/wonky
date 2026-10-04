//! G14: plane sections of a sphere in G8's stereographic two-patch atlas.
//!
//! A `Sphere3 { frame, radius a }` has own coordinates `l` with `|l|² = a²`.
//! Patch `First` is the stereographic chart from the south pole (the closed
//! northern hemisphere is the closed unit disc), patch `Second` the one from
//! the north pole with the second coordinate mirrored; both are
//! `Carrier3::chart_point`. Each is conformal and preserves the orientation
//! about the outward normal, so a cell on the left of a chart cycle is on the
//! left seen from outside the sphere. The equator is the virtual seam
//! `|uv| = 1` with the transition `(u, v) -> (u, -v)`; it is never an edge.
//!
//! Every circle the sphere rows produce lies in a plane `l_axis = h` (a frame
//! column; `h` rational or in one quadratic field). Its chart image is a
//! circle with exact centre and squared radius, a chord through the chart
//! origin (a meridian plane), the seam itself (the equator) or nothing (the
//! other hemisphere). No pole is ever on a chart: each patch omits the pole
//! it projects from, so a section through a pole needs no refusal here.
use super::{curved::Patch, Bounds, Carrier3, Curve3, Draft, FaceId, RPoint, Sphere3};
use crate::{Point, Refused, Result, Q};
use num_traits::{One, Signed, Zero};
use wonky_num::{Iv, Scalar};
use wonky_curve::{
    radical::{self, Radical},
    Carrier, ExactPoint, Trimmed,
};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn r(x: impl Into<Radical>) -> Radical {
    x.into()
}
fn sign(p: Patch) -> Q {
    match p {
        Patch::First => q(1),
        Patch::Second => q(-1),
    }
}
fn curve<T>(v: std::result::Result<T, wonky_curve::Refusal>) -> Result<T> {
    v.map_err(|e| Refused(e.name()))
}
fn arithmetic<T>(f: impl FnOnce() -> T) -> Result<T> {
    radical::guard(f).map_err(|_| Refused("boolean/budget-exceeded:sphere-chart"))
}

/// Own coordinates of an exact model point (the frame is rational).
pub fn local(s: &Sphere3, p: &RPoint) -> Result<RPoint> {
    let inv = s.frame.inverse();
    arithmetic(|| {
        std::array::from_fn(|i| {
            (0..3).fold(r(inv.origin()[i].clone()), |v, j| v + &p[j] * &inv.columns()[j][i])
        })
    })
}
/// The model point of own coordinates `l`.
pub fn model(s: &Sphere3, l: &RPoint) -> Result<RPoint> {
    arithmetic(|| {
        std::array::from_fn(|i| {
            (0..3).fold(r(s.frame.origin()[i].clone()), |v, j| v + &l[j] * &s.frame.columns()[j][i])
        })
    })
}
/// Own coordinates of the chart point `uv` of `patch`.
pub fn lift_local(a: &Q, patch: Patch, uv: &[Radical; 2]) -> Result<RPoint> {
    let sg = sign(patch);
    arithmetic(|| {
        let s = &uv[0] * &uv[0] + &uv[1] * &uv[1];
        let d = r(q(1)) + &s;
        [
            &uv[0] * (q(2) * a) / &d,
            &uv[1] * (q(2) * a * &sg) / &d,
            (r(q(1)) - s) * (a * &sg) / d,
        ]
    })
}
/// The model point of the chart point `uv` of `patch`.
pub fn lift(s: &Sphere3, patch: Patch, uv: &[Radical; 2]) -> Result<RPoint> {
    model(s, &lift_local(s.radius(), patch, uv)?)
}
/// Chart coordinates of own coordinates `l` (on the sphere, in the closed
/// hemisphere of `patch`).
pub fn chart_local(a: &Q, patch: Patch, l: &RPoint) -> Result<[Radical; 2]> {
    let sg = sign(patch);
    let d = arithmetic(|| r(a.clone()) + &l[2] * &sg)?;
    if d.is_zero() {
        return Err(Refused("boolean/chart-singularity:pole"));
    }
    let uv = arithmetic(|| [&l[0] / &d, &l[1] * &sg / &d])?;
    if arithmetic(|| &uv[0] * &uv[0] + &uv[1] * &uv[1])? > r(q(1)) {
        return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
    }
    Ok(uv)
}
/// Chart coordinates of an exact model point on the sphere.
pub fn chart(s: &Sphere3, patch: Patch, p: &RPoint) -> Result<[Radical; 2]> {
    let l = local(s, p)?;
    if arithmetic(|| &l[0] * &l[0] + &l[1] * &l[1] + &l[2] * &l[2])? != r(s.radius2()) {
        return Err(Refused("boolean/contract-violation:atlas/off-carrier"));
    }
    chart_local(s.radius(), patch, &l)
}
/// The patch whose closed hemisphere holds own point `l` (First on the seam).
pub fn patch_of(l: &RPoint) -> Patch {
    if l[2].is_negative() {
        Patch::Second
    } else {
        Patch::First
    }
}
/// The virtual seam: the unit circle, counter-clockwise.
pub fn seam() -> Result<Trimmed> {
    curve(Trimmed::ring([q(0), q(0)], q(1), ExactPoint::from_rational([q(1), q(0)]), true))
}
/// The exact radius `√(a² − h²)` of the circle `l_axis = h`; `None` if the
/// plane misses the sphere or touches it.
pub fn circle_radius(a: &Q, h: &Radical) -> Result<Option<Radical>> {
    let r2 = arithmetic(|| r(a * a) - h * h)?;
    if !r2.is_positive() {
        return Ok(None);
    }
    if let Some(x) = r2.rational() {
        if let Some(root) = wonky_curve::numeric::exact_root(&x) {
            return Ok(Some(root.into()));
        }
        return curve(Radical::quadratic(Q::zero(), Q::one(), x)).map(Some);
    }
    curve(r2.exact_sqrt()).map(Some).map_err(|_| Refused("boolean/ssi-row-unavailable:sphere/nested-radius"))
}
/// Own coordinates of the point at angle zero of the circle `l_axis = h`
/// (the next frame column times the radius) and of its antipode.
fn circle_point(axis: usize, h: &Radical, radius: &Radical, s: Q) -> RPoint {
    let mut l: RPoint = std::array::from_fn(|_| Radical::default());
    l[axis] = h.clone();
    l[(axis + 1) % 3] = radius * &s;
    l
}
/// The part of the circle `l_axis = h` in the closed disc of `patch`, as
/// chart pieces; `Ok(None)` when the circle is the seam itself.
pub fn disc_pieces(a: &Q, axis: usize, h: &Radical, patch: Patch) -> Result<Option<Vec<Trimmed>>> {
    let Some(radius) = circle_radius(a, h)? else {
        return Ok(Some(vec![]));
    };
    let sg = sign(patch);
    let point = |l: &RPoint| -> Result<ExactPoint> {
        let uv = chart_local(a, patch, l)?;
        curve(ExactPoint::from_coordinates(uv))
    };
    if axis == 2 {
        if h.is_zero() {
            return Ok(None);
        }
        // Concentric about the chart origin: r² = (σa − h)/(σa + h).
        let r2 = arithmetic(|| (r(a * &sg) - h) / (r(a * &sg) + h))?;
        if r2 >= r(q(1)) {
            return Ok(Some(vec![]));
        }
        let seam = point(&circle_point(2, h, &radius, q(1)))?;
        return Ok(Some(vec![curve(Trimmed::ring_about(ExactPoint::from_rational([q(0), q(0)]), r2, seam, true))?]));
    }
    // l_axis = h meets the equator at (h, ±r) in the other two columns.
    let crossing = |s: Q| -> Result<ExactPoint> {
        let mut l: RPoint = std::array::from_fn(|_| Radical::default());
        l[axis] = h.clone();
        l[1 - axis] = &radius * &s;
        point(&l)
    };
    // A plane through the pole axis: a chord through the chart origin.
    if h.is_zero() {
        let mut ends = vec![];
        for s in [q(1), q(-1)] {
            ends.push(crossing(s)?);
        }
        let ends: [ExactPoint; 2] = ends.try_into().map_err(|_| Refused("boolean/contract-violation:sphere/chord"))?;
        return Ok(Some(vec![curve(Trimmed::new(ends, Carrier::Line))?]));
    }
    // l_0 = h: 2au = h(1 + s); l_1 = h: 2aσv = h(1 + s).
    let centre = arithmetic(|| {
        if axis == 0 {
            [r(a.clone()) / h, r(q(0))]
        } else {
            [r(q(0)), r(a * &sg) / h]
        }
    })?;
    let r2 = arithmetic(|| (r(a * a) - h * h) / (h * h))?;
    let (p, m) = (crossing(q(1))?, crossing(q(-1))?);
    let ring = curve(Trimmed::ring_about(curve(ExactPoint::from_coordinates(centre))?, r2, p.clone(), true))?;
    let mut inside = vec![];
    for arc in curve(ring.split(vec![p, m]))? {
        let w = curve(arc.exact_interior_point())?.coordinates();
        if arithmetic(|| &w[0] * &w[0] + &w[1] * &w[1])? < r(q(1)) {
            inside.push(arc);
        }
    }
    if inside.len() != 1 {
        return Err(Refused("boolean/contract-violation:sphere/disc-arc"));
    }
    Ok(Some(inside))
}

// ------------------------------------------------------------- patch faces

/// The latitude `(axis, h)` of a circle on sphere `s`, and whether the
/// curve's own direction (counter-clockwise about its frame normal) is
/// counter-clockwise about the frame column `axis`.
pub fn latitude_of(s: &Sphere3, c: &Curve3) -> Result<(usize, Radical, bool)> {
    let (centre, cols) = match c {
        Curve3::Circle(k) => (k.origin(), k.columns().clone()),
        Curve3::RadicalCircle(k) => (k.center()?, k.frame.columns().clone()),
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(Refused("model/g2-curve-off-carrier")),
        Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/sphere-latitude")),
    };
    let n = crate::cross(&cols[0], &cols[1]);
    let inv = s.frame.inverse();
    let nl: Point = std::array::from_fn(|i| (0..3).fold(Q::zero(), |v, j| v + &n[j] * &inv.columns()[j][i]));
    let nonzero = (0..3).filter(|&i| !nl[i].is_zero()).collect::<Vec<_>>();
    let [axis] = nonzero[..] else {
        return Err(Refused("boolean/sphere-chart-conflict"));
    };
    let l = local(s, &centre)?;
    if !l[(axis + 1) % 3].is_zero() || !l[(axis + 2) % 3].is_zero() {
        return Err(Refused("boolean/sphere-chart-conflict"));
    }
    Ok((axis, l[axis].clone(), nl[axis].is_positive()))
}
/// A sphere face outside the tube-band class (`tube`): no loops, a loop
/// with arcs, or a ring that is no latitude of the carrier frame's third
/// column. Its coedges carry stereographic atlas trims.
pub(super) fn is_patch(d: &Draft, fi: FaceId) -> bool {
    let f = &d.faces[fi.index()];
    let Carrier3::Sphere(s) = &d.surfaces[f.surface.index()].carrier else {
        return false;
    };
    f.loops.is_empty()
        || f.loops.iter().any(|l| {
            let cs = &d.loops[l.index()].coedges;
            if cs.len() != 1 {
                return true;
            }
            let e = &d.edges[d.coedges[cs[0].index()].edge.index()];
            !matches!(e.bounds, Bounds::Ring)
                || !matches!(latitude_of(s, &d.curves[e.curve.index()].geometry), Ok((2, _, _)))
        })
}
fn sphere_of(d: &Draft, fi: FaceId) -> Result<&Sphere3> {
    match &d.surfaces[d.faces[fi.index()].surface.index()].carrier {
        Carrier3::Sphere(s) => Ok(s),
        _ => Err(Refused("model/g3-sphere-carrier")),
    }
}
fn on_seam(p: &ExactPoint) -> Result<bool> {
    let [u, v] = p.coordinates();
    Ok(arithmetic(|| &u * &u + &v * &v)? == r(q(1)))
}
/// Chart continuity from `a` (end of a piece in patch `pa`) to `b` (start of
/// the next in `pb`): the same point, or mirrored seam points.
fn continues(pa: Patch, a: &ExactPoint, pb: Patch, b: &ExactPoint) -> Result<bool> {
    if pa == pb {
        return Ok(a == b);
    }
    let [u, v] = a.coordinates();
    Ok(on_seam(a)? && curve(ExactPoint::from_coordinates([u, arithmetic(|| -v)?]))? == *b)
}
/// Whether a chart piece runs counter-clockwise about the frame column
/// `axis`: three distinct points in traversal order turn the traversal's
/// way; a full chart ring keeps its chart sense in First and reverses it in
/// the mirrored Second.
pub fn ccw_about_axis(a: &Q, axis: usize, patch: Patch, piece: &Trimmed) -> Result<bool> {
    if piece.is_ring() {
        let Carrier::Circle(c) = piece.carrier() else {
            return Err(Refused("model/g3-pcurve-class"));
        };
        if axis != 2 {
            return Err(Refused("model/g3-sphere-ring-axis"));
        }
        return Ok(c.ccw != (patch == Patch::Second));
    }
    let e = piece.ends();
    let from = lift_local(a, patch, &e[0].coordinates())?;
    let to = lift_local(a, patch, &e[1].coordinates())?;
    let m = lift_local(a, patch, &curve(piece.exact_interior_point())?.coordinates())?;
    let turn = arithmetic(|| {
        let u: RPoint = std::array::from_fn(|i| &m[i] - &from[i]);
        let v: RPoint = std::array::from_fn(|i| &to[i] - &m[i]);
        let (i, j) = ((axis + 1) % 3, (axis + 2) % 3);
        &u[i] * &v[j] - &u[j] * &v[i]
    })?;
    if turn.is_zero() {
        return Err(Refused("model/g3-sphere-degenerate-arc"));
    }
    Ok(turn.is_positive())
}
fn same_carrier(a: &Trimmed, b: &Trimmed) -> Result<bool> {
    Ok(match (a.carrier(), b.carrier()) {
        (Carrier::Circle(x), Carrier::Circle(y)) => x.c == y.c && x.r2 == y.r2,
        (Carrier::Line, Carrier::Line) => {
            let (p, q2) = (&b.ends()[0], &b.ends()[1]);
            let d = q2.difference(p);
            a.ends().iter().all(|e| {
                let v = e.difference(p);
                radical::guard(|| radical::cross(&d, &v).is_zero()).unwrap_or(false)
            })
        }
        _ => false,
    })
}
/// G3 for a patch face: every coedge's atlas trim lies on the chart images
/// of its own 3D circle, is continuous across the seam, starts and ends at
/// its vertices and runs the coedge's way along the circle.
pub(super) fn chart_audit(d: &Draft, keys: &[super::VertexKey], fi: FaceId) -> Result<()> {
    let s = sphere_of(d, fi)?;
    let a = s.radius();
    for &l in &d.faces[fi.index()].loops {
        for &c in &d.loops[l.index()].coedges {
            let co = &d.coedges[c.index()];
            let atlas = co.atlas.as_ref().ok_or(Refused("model/g3-periodic-atlas-missing"))?;
            let pieces = &atlas.pieces;
            if pieces.is_empty() {
                return Err(Refused("model/g3-atlas-piece-count"));
            }
            if co.pcurve.key() != pieces[0].piece.key() || co.pcurve.ends() != pieces[0].piece.ends() {
                return Err(Refused("model/g3-primary-chart"));
            }
            let e = &d.edges[co.edge.index()];
            let (axis, h, own_ccw) = latitude_of(s, &d.curves[e.curve.index()].geometry)?;
            for (k, p) in pieces.iter().enumerate() {
                if p.winding_delta != 0 {
                    return Err(Refused("model/g3-atlas-transition"));
                }
                let fits = match disc_pieces(a, axis, &h, p.patch)? {
                    None => same_carrier(&p.piece, &seam()?)?,
                    Some(images) => match images.first() {
                        Some(img) => same_carrier(&p.piece, img)?,
                        None => false,
                    },
                };
                if !fits {
                    return Err(Refused("model/g3-pcurve-identity"));
                }
                for end in p.piece.ends() {
                    let [u, v] = end.coordinates();
                    if arithmetic(|| &u * &u + &v * &v)? > r(q(1)) {
                        return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
                    }
                }
                if k + 1 < pieces.len() {
                    let next = &pieces[k + 1];
                    if !continues(p.patch, &p.piece.ends()[1], next.patch, &next.piece.ends()[0])? {
                        return Err(Refused("model/g3-atlas-transition"));
                    }
                }
            }
            let (first, last) = (&pieces[0], &pieces[pieces.len() - 1]);
            match e.bounds {
                Bounds::Segment([v0, v1]) => {
                    let (sv, tv) = if co.forward { (v0, v1) } else { (v1, v0) };
                    let at = |v: super::VertexId, patch: Patch| -> Result<ExactPoint> {
                        let l = local(s, &keys[v.index()].coordinates())?;
                        curve(ExactPoint::from_coordinates(chart_local(a, patch, &l)?))
                    };
                    if at(sv, first.patch)? != first.piece.ends()[0] || at(tv, last.patch)? != last.piece.ends()[1] {
                        return Err(Refused("model/g3-pcurve-ends"));
                    }
                }
                Bounds::Ring => {
                    if !continues(last.patch, &last.piece.ends()[1], first.patch, &first.piece.ends()[0])? {
                        return Err(Refused("model/g3-pcurve-ends"));
                    }
                }
            }
            if ccw_about_axis(a, axis, first.patch, &first.piece)? != (co.forward == own_ccw) {
                return Err(Refused("model/g3-pcurve-sense"));
            }
        }
    }
    Ok(())
}
/// G5 for a patch face: consecutive coedges continue in the atlas.
pub(super) fn loop_audit(d: &Draft, li: usize) -> Result<()> {
    let lp = &d.loops[li];
    let n = lp.coedges.len();
    for k in 0..n {
        let (c, next) = (&d.coedges[lp.coedges[k].index()], &d.coedges[lp.coedges[(k + 1) % n].index()]);
        let (Some(a), Some(b)) = (&c.atlas, &next.atlas) else {
            return Err(Refused("model/g3-periodic-atlas-missing"));
        };
        let (last, first) = (&a.pieces[a.pieces.len() - 1], &b.pieces[0]);
        if !continues(last.patch, &last.piece.ends()[1], first.patch, &first.piece.ends()[0])? {
            return Err(Refused("model/g5-loop-open"));
        }
    }
    Ok(())
}
/// G6 for a patch face: within each patch, trim pieces meet only at their
/// common ends.
pub(super) fn crossing_audit(d: &Draft, fi: FaceId) -> Result<()> {
    for patch in [Patch::First, Patch::Second] {
        let mut pieces = vec![];
        for &l in &d.faces[fi.index()].loops {
            for &c in &d.loops[l.index()].coedges {
                if let Some(a) = &d.coedges[c.index()].atlas {
                    pieces.extend(a.pieces.iter().filter(|p| p.patch == patch).map(|p| p.piece.clone()));
                }
            }
        }
        for i in 0..pieces.len() {
            for j in i + 1..pieces.len() {
                let (x, y) = (&pieces[i], &pieces[j]);
                for p in x.contacts(y).map_err(|_| Refused("model/g6-overlap"))? {
                    if !(x.ends().contains(&p) && y.ends().contains(&p)) {
                        return Err(Refused("model/g6-crossing"));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Whether an exact point of the carrier lies in the closure of patch face
/// `fi`: the face's atlas pieces of the point's patch and the seam are
/// arranged; the cell holding the point is in the face iff it lies on the
/// face side (left about the outward normal for a forward face) of a trim
/// piece bounding it. A hemisphere without trim pieces lies wholly in or
/// out of the face, as its seam does: a seam point off every trim is then
/// located in the other patch. Undecidable layouts refuse by name.
pub(super) fn patch_contains(d: &Draft, fi: FaceId, p: &RPoint) -> Result<bool> {
    let s = sphere_of(d, fi)?;
    if d.faces[fi.index()].loops.is_empty() {
        return Ok(true);
    }
    let l = local(s, p)?;
    if l.iter().any(|c| c.rational().is_none()) {
        return contains_by_signs(d, fi, s, &l);
    }
    let patch = patch_of(&l);
    let x = curve(ExactPoint::from_coordinates(chart_local(s.radius(), patch, &l)?))?;
    // A seam point is in both patches: in the face if either says so.
    if l[2].is_zero() {
        let [u, v] = x.coordinates();
        let mirrored = curve(ExactPoint::from_coordinates([u, arithmetic(|| -v)?]))?;
        if locate_in(d, fi, Patch::Second, &mirrored)? == Some(true) {
            return Ok(true);
        }
    }
    if let Some(inside) = locate_in(d, fi, patch, &x)? {
        return Ok(inside);
    }
    let other = match patch {
        Patch::First => Patch::Second,
        Patch::Second => Patch::First,
    };
    let trims = trim_pieces(d, fi, other)?;
    for (t, sx, sy) in (0..64i64).flat_map(|t| [(t, 1, 1), (t, -1, 1), (t, 1, -1), (t, -1, -1)]) {
        let tq = Q::new(t.into(), (t + 1).into());
        let den = q(1) + &tq * &tq;
        let seam_point = ExactPoint::from_rational([q(sx) * (q(1) - &tq * &tq) / &den, q(sy) * q(2) * &tq / &den]);
        let mut off = true;
        for piece in &trims {
            off &= !curve(piece.contains(&seam_point))?;
        }
        if off {
            return locate_in(d, fi, other, &seam_point)?.ok_or(Refused("boolean/ssi-row-unavailable:sphere/patch-locate"));
        }
    }
    Err(Refused("boolean/ssi-row-unavailable:sphere/patch-locate"))
}
/// Containment of an irrational own point `l` (its chart point would mix
/// quadratic fields with the trims'): its exact sign vector against every
/// trim plane is matched with the rational witnesses of the trim
/// arrangement's cells in both patches; every matching cell must agree.
fn contains_by_signs(d: &Draft, fi: FaceId, s: &Sphere3, l: &RPoint) -> Result<bool> {
    let undecided = Refused("boolean/ssi-row-unavailable:sphere/patch-locate");
    let mut planes: Vec<(usize, Radical)> = vec![];
    for &lp in &d.faces[fi.index()].loops {
        for &c in &d.loops[lp.index()].coedges {
            let e = &d.edges[d.coedges[c.index()].edge.index()];
            let (axis, h, _) = latitude_of(s, &d.curves[e.curve.index()].geometry)?;
            if !planes.contains(&(axis, h.clone())) {
                planes.push((axis, h));
            }
        }
    }
    let signs = |p: &RPoint| -> Result<Vec<std::cmp::Ordering>> {
        planes.iter().map(|(k, h)| arithmetic(|| p[*k].cmp(h))).collect()
    };
    let target = signs(l)?;
    if target.contains(&std::cmp::Ordering::Equal) {
        return Err(undecided);
    }
    let mut verdict = None;
    for patch in [Patch::First, Patch::Second] {
        let mut pieces = vec![seam()?];
        for (k, h) in &planes {
            if let Some(ps) = disc_pieces(s.radius(), *k, h, patch)? {
                pieces.extend(ps);
            }
        }
        let budget = wonky_curve::Budget { segments: 4096, pieces: 65536 };
        let arr = curve(wonky_curve::arrange_pieces_exact(&[&pieces], budget))?;
        for ci in 0..arr.cells.len() {
            let Ok(w) = arr.witness(ci, &[], &[]).or_else(|_| arr.witness_exact(ci, &[], &[])) else {
                return Err(undecided);
            };
            let Ok(uv) = w.rat() else { return Err(undecided) };
            let wl = lift_local(s.radius(), patch, &uv.clone().map(Radical::from))?;
            if signs(&wl)? != target {
                continue;
            }
            let model_point = model(s, &wl)?;
            let inside = patch_contains(d, fi, &model_point)?;
            match verdict {
                None => verdict = Some(inside),
                Some(v) if v != inside => return Err(undecided),
                Some(_) => {}
            }
        }
    }
    verdict.ok_or(undecided)
}
fn trim_pieces(d: &Draft, fi: FaceId, patch: Patch) -> Result<Vec<Trimmed>> {
    let mut out = vec![];
    for &lp in &d.faces[fi.index()].loops {
        for &c in &d.loops[lp.index()].coedges {
            let atlas = d.coedges[c.index()].atlas.as_ref().ok_or(Refused("model/g3-periodic-atlas-missing"))?;
            out.extend(atlas.pieces.iter().filter(|q2| q2.patch == patch).map(|q2| q2.piece.clone()));
        }
    }
    Ok(out)
}
/// Location of chart point `x` of `patch` in patch face `fi`; `None` when
/// the face has no trim piece in this patch.
fn locate_in(d: &Draft, fi: FaceId, patch: Patch, x: &ExactPoint) -> Result<Option<bool>> {
    let f = &d.faces[fi.index()];
    let trims = trim_pieces(d, fi, patch)?;
    if trims.is_empty() {
        return Ok(None);
    }
    for q2 in &trims {
        if curve(q2.contains(x))? {
            return Ok(Some(true));
        }
    }
    // The seam, split where trims end on it, without the arcs a trim (an
    // equator edge of the face) already covers.
    let mut cuts = vec![];
    for t in &trims {
        for e in t.ends() {
            if on_seam(e)? {
                cuts.push(e.clone());
            }
        }
    }
    let mut pieces = vec![];
    for arc in curve(seam()?.split(cuts))? {
        let m = curve(arc.exact_interior_point())?;
        let mut covered = false;
        for t in &trims {
            covered |= curve(t.contains(&m))?;
        }
        if !covered {
            pieces.push(arc);
        }
    }
    let nseam = pieces.len();
    pieces.extend(trims);
    let budget = wonky_curve::Budget { segments: 4096, pieces: 65536 };
    let arr = curve(wonky_curve::arrange_pieces_exact(&[&pieces], budget))?;
    for cell in &arr.cells {
        let mut winding = 0;
        let mut on_seam = false;
        for cyc in &cell.cycles {
            let profile = arr.cycle_profile(cyc);
            for piece in profile.pieces() {
                on_seam |= curve(piece.contains(x))?;
            }
            winding += curve(profile.winding(x))?;
        }
        if winding == 0 && !on_seam {
            continue;
        }
        for cyc in &cell.cycles {
            for &h in cyc {
                let owner = arr.pieces[h / 2].owners[0];
                if owner.1 < nseam {
                    continue;
                }
                let left_of_trim = (h % 2 == 0) == owner.2;
                return Ok(Some(left_of_trim == f.forward));
            }
        }
        return Err(Refused("boolean/ssi-row-unavailable:sphere/patch-locate"));
    }
    Err(Refused("boolean/ssi-row-unavailable:sphere/patch-locate"))
}

// ------------------------------------------------------------- measures

fn iv(x: &Radical) -> Result<Iv> {
    x.enclosure().map_err(|_| Refused("boolean/budget-exceeded:sphere-measure"))
}
fn ivq(x: &Q) -> Result<Iv> {
    iv(&r(x.clone()))
}
fn rdot(a: &RPoint, b: &RPoint) -> Result<Radical> {
    arithmetic(|| (0..3).fold(Radical::default(), |s, k| s + &a[k] * &b[k]))
}
fn rcross(a: &RPoint, b: &RPoint) -> Result<RPoint> {
    arithmetic(|| std::array::from_fn(|i| {
        let (j, k) = ((i + 1) % 3, (i + 2) % 3);
        &a[j] * &b[k] - &a[k] * &b[j]
    }))
}
fn rsub(a: &RPoint, b: &RPoint) -> Result<RPoint> {
    arithmetic(|| std::array::from_fn(|k| &a[k] - &b[k]))
}
/// The signed angle in (−π, π] of `(x, y)`; a reversal (π with y = 0 and
/// x < 0) is a cusp of a boundary and refuses.
fn signed_angle(x: &Radical, y: &Radical) -> Result<Iv> {
    if y.is_zero() && x.is_negative() {
        return Err(Refused("boolean/higher-order-contact"));
    }
    let a = curve(radical::positive_angle(x, y))?;
    Ok(if y.is_negative() { a - wonky_curve::numeric::pi() * Iv::point(2.) } else { a })
}
/// One boundary edge of a patch face in its loop's traversal, own frame.
struct Arc {
    axis: usize,
    h: Radical,
    ccw: bool,
    ends: Option<[RPoint; 2]>,
}
impl Arc {
    fn centre(&self) -> RPoint {
        let mut p: RPoint = std::array::from_fn(|_| Radical::default());
        p[self.axis] = self.h.clone();
        p
    }
    fn unit(&self) -> RPoint {
        let mut e: RPoint = std::array::from_fn(|_| Radical::default());
        e[self.axis] = r(q(1));
        e
    }
    /// Signed sweep about the axis column.
    fn sweep(&self) -> Result<Iv> {
        let two_pi = wonky_curve::numeric::pi() * Iv::point(2.);
        let Some([s, t]) = &self.ends else {
            return Ok(if self.ccw { two_pi } else { -two_pi });
        };
        let p = self.centre();
        let (u, v) = (rsub(s, &p)?, rsub(t, &p)?);
        let dot = rdot(&u, &v)?;
        let turn = rdot(&rcross(&u, &v)?, &self.unit())?;
        Ok(if self.ccw {
            curve(radical::positive_angle(&dot, &turn))?
        } else {
            -curve(radical::positive_angle(&dot, &arithmetic(|| -turn)?))?
        })
    }
    /// Traversal tangent at own point `x` (not normalized).
    fn tangent(&self, x: &RPoint) -> Result<RPoint> {
        let t = rcross(&self.unit(), &rsub(x, &self.centre())?)?;
        Ok(if self.ccw { t } else { arithmetic(|| t.map(|c| -c))? })
    }
}
/// The loop's edges in traversal order. The sense about the axis column
/// comes from exact data alone (the coedge's sense along the circle's own
/// direction), so it serves patch and tube-band sphere faces alike.
fn loop_arcs(d: &Draft, s: &Sphere3, l: super::LoopId) -> Result<Vec<Arc>> {
    let mut out = vec![];
    for &c in &d.loops[l.index()].coedges {
        let co = &d.coedges[c.index()];
        let e = &d.edges[co.edge.index()];
        let (axis, h, own_ccw) = latitude_of(s, &d.curves[e.curve.index()].geometry)?;
        let ccw = co.forward == own_ccw;
        let ends = match e.bounds {
            Bounds::Ring => None,
            Bounds::Segment([v0, v1]) => {
                let (sv, tv) = if co.forward { (v0, v1) } else { (v1, v0) };
                let p = |v: super::VertexId| -> Result<RPoint> {
                    local(s, &d.vertices[v.index()].def.key()?.coordinates())
                };
                Some([p(sv)?, p(tv)?])
            }
        };
        out.push(Arc { axis, h, ccw, ends });
    }
    Ok(out)
}
/// Area and the flux `∫ x·n dA` of a patch face (model frame), as
/// enclosures. Area by Gauss–Bonnet on the region-left traversal:
/// `A = a²(2πχ − Σ (h/a) Δθ − Σ ε)`; flux `c·N + σ a A` with the vector
/// area `N = ½ Σ (p × Δx + ρ² Δθ e)` of the stored traversal.
fn patch_measure(d: &Draft, fi: FaceId) -> Result<(Iv, Iv)> {
    let s = sphere_of(d, fi)?;
    let cols = s.frame.columns();
    for i in 0..3 {
        for j in 0..3 {
            let v = crate::dot(&cols[i], &cols[j]);
            if v != if i == j { q(1) } else { q(0) } {
                return Err(Refused("boolean/ssi-row-unavailable:measure/sphere-frame-metric"));
            }
        }
    }
    let f = &d.faces[fi.index()];
    let a = s.radius();
    let ai = ivq(a)?;
    let sigma = if f.forward { Iv::point(1.) } else { Iv::point(-1.) };
    let pi = wonky_curve::numeric::pi();
    let mut turning = Iv::point(0.);
    let mut n = [Iv::point(0.), Iv::point(0.), Iv::point(0.)];
    for &l in &f.loops {
        let arcs = loop_arcs(d, s, l)?;
        for (k, arc) in arcs.iter().enumerate() {
            let sweep = arc.sweep()?;
            turning = turning + iv(&arc.h)? / ai * sweep;
            let rho2 = iv(&arithmetic(|| r(a * a) - &arc.h * &arc.h)?)?;
            let p = arc.centre();
            let dx = match &arc.ends {
                Some([s0, t0]) => rcross(&p, &rsub(t0, s0)?)?,
                None => std::array::from_fn(|_| Radical::default()),
            };
            for i in 0..3 {
                let e = if i == arc.axis { Iv::point(1.) } else { Iv::point(0.) };
                n[i] = n[i] + (iv(&dx[i])? + rho2 * sweep * e) * Iv::point(0.5);
            }
            if let Some([_, t0]) = &arc.ends {
                let next = &arcs[(k + 1) % arcs.len()];
                let Some([s1, _]) = &next.ends else {
                    return Err(Refused("model/g5-loop-open"));
                };
                if s1 != t0 {
                    return Err(Refused("model/g5-loop-open"));
                }
                let (tin, tout) = (arc.tangent(t0)?, next.tangent(t0)?);
                let cross = rdot(t0, &rcross(&tin, &tout)?)?;
                turning = turning + signed_angle(&rdot(&tin, &tout)?, &cross)?;
            }
        }
    }
    let chi = Iv::point(2. - f.loops.len() as f64);
    // The stored loops of a reversed face run the other way round.
    let area = ai * ai * (pi * Iv::point(2.) * chi - sigma * turning);
    if !(area.lo() > 0.) {
        return Err(Refused("model/g8-volume"));
    }
    let c = s.frame.origin();
    let mut flux = sigma * ai * area;
    for i in 0..3 {
        // N in model axes: Σ_j N_j col_j.
        let mut nm = Iv::point(0.);
        for j in 0..3 {
            nm = nm + n[j] * ivq(&cols[j][i])?;
        }
        flux = flux + ivq(&c[i])? * nm;
    }
    Ok((area, flux))
}
/// Area and flux of a planar face from its exact chart Green expression:
/// flux `(n·o)|x|² G`, area `|G| |n| |x|²`.
fn plane_measure(d: &Draft, fi: FaceId) -> Result<(Iv, Iv)> {
    let f = &d.faces[fi.index()];
    let Carrier3::Plane(p) = &d.surfaces[f.surface.index()].carrier else {
        return Err(Refused("boolean/ssi-row-unavailable:measure/stereo-mixed-carrier"));
    };
    let mut g = Iv::point(0.);
    for &l in &f.loops {
        let pieces = d.loops[l.index()].coedges.iter().map(|c| d.coedges[c.index()].pcurve.clone()).collect();
        g = g + curve(curve(wonky_curve::Cycle::new(pieces).green_symbolic())?.enclosure())?;
    }
    let xx = ivq(&crate::dot(&p.x, &p.x))?;
    let flux = ivq(&crate::dot(&p.n, &p.o))? * xx * g;
    let area = g.abs() * ivq(&crate::dot(&p.n, &p.n))?.sqrt() * xx;
    Ok((area, flux))
}
/// Area and flux of one face of a Model with a patch face.
pub(super) fn face_measure(d: &Draft, fi: FaceId) -> Result<(Iv, Iv)> {
    if is_sphere(d, fi) {
        return patch_measure(d, fi);
    }
    match band_measure(d, fi)? {
        Some((area, flux, _)) => Ok((area, flux)),
        None => plane_measure(d, fi),
    }
}
/// Area, flux `∮ x·n dA` and first moments `∫ x_i dV` terms of a full-turn
/// cylinder or cone band beside a sphere face (probe G8: a sphere ∪ coaxial
/// pin, whose ring has a Q(√d) height): the exact band terms of
/// `periodic::radical_band_moments` and `RadicalBand::area_parts`, enclosed.
/// `None` for a face that is no such band.
fn band_measure(d: &Draft, fi: FaceId) -> Result<Option<(Iv, Iv, [Iv; 3])>> {
    if !matches!(d.surfaces[d.faces[fi.index()].surface.index()].carrier, Carrier3::Cylinder(_) | Carrier3::Cone(_)) {
        return Ok(None);
    }
    let b = super::periodic::radical_band(d, fi)?
        .ok_or(Refused("boolean/ssi-row-unavailable:measure/stereo-partial-band"))?;
    let pi = wonky_curve::numeric::pi();
    let (p, k, radicand) = b.area_parts()?;
    let area = iv(&curve(Radical::quadratic(p, k, radicand))?)? * pi;
    let (volume, flux) = super::periodic::radical_band_moments(&b)?;
    let m = [iv(&flux[0])?, iv(&flux[1])?, iv(&flux[2])?].map(|f| f * pi * Iv::point(0.25));
    Ok(Some((area, iv(&volume)? * pi, m)))
}
/// Six times the volume and the area of each solid of a Model with a patch
/// face, as certified enclosures. Every face must be planar, a sphere face or
/// a full-turn cylinder or cone band.
pub(super) fn measures(d: &Draft) -> Result<Vec<(Iv, Iv)>> {
    let mut out = vec![];
    for solid in &d.solids {
        let (mut area, mut flux) = (Iv::point(0.), Iv::point(0.));
        for sh in &solid.shells {
            for &fi in &d.shells[sh.index()].faces {
                let (a, f) = face_measure(d, fi)?;
                area = area + a;
                flux = flux + f;
            }
        }
        if area.is_nan() || flux.is_nan() {
            return Err(Refused("boolean/budget-exceeded:sphere-measure"));
        }
        out.push((flux * Iv::point(2.), area));
    }
    Ok(out)
}
/// Whether a Model has a patch face (and so needs `measures`).
pub(super) fn has_patch(d: &Draft) -> bool {
    (0..d.faces.len()).any(|i| is_patch(d, FaceId(i as u32)))
}
fn is_sphere(d: &Draft, fi: FaceId) -> bool {
    matches!(d.surfaces[d.faces[fi.index()].surface.index()].carrier, Carrier3::Sphere(_))
}
/// Models measured by the enclosure route: a sphere face (a sphere patch, or
/// a sphere tube band whose first moments the exact route lacks), and only
/// planar, sphere, cylinder and cone faces (the latter full-turn bands,
/// `band_measure`, else the measures refuse by name).
pub(super) fn sphere_measured(d: &Draft) -> bool {
    (0..d.faces.len()).any(|i| is_sphere(d, FaceId(i as u32)))
        && d.faces.iter().all(|f| {
            matches!(
                d.surfaces[f.surface.index()].carrier,
                Carrier3::Plane(_) | Carrier3::Sphere(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_)
            )
        })
}
/// G8 for a Model with a patch face: every solid's volume enclosure is
/// positive. With G7's coherent orientation this proves an outward shell;
/// the per-face ray test of curved Models needs ray hits on patches, which
/// are not admitted yet.
pub(super) fn audit_outward(d: &Draft) -> Result<()> {
    for (v, _) in measures(d)? {
        if !(v.lo() > 0.) {
            return Err(Refused("model/g8-volume"));
        }
    }
    Ok(())
}

// ------------------------------------------------------------- moments

/// A linear form `k0 + kc cos θ + ks sin θ` and quadratic forms in
/// (1, c, s, cc, cs, ss) of the arc angle.
type Lin = [Iv; 3];
fn lin_mul(a: &Lin, b: &Lin) -> [Iv; 6] {
    [a[0] * b[0], a[0] * b[1] + a[1] * b[0], a[0] * b[2] + a[2] * b[0], a[1] * b[1], a[1] * b[2] + a[2] * b[1], a[2] * b[2]]
}
/// `∫ f dθ` from θ0 to θ0 + Δθ, with the end cosines and sines.
fn trig_integral(f: &[Iv; 6], dt: Iv, [c0, s0]: [Iv; 2], [c1, s1]: [Iv; 2]) -> Iv {
    let half = Iv::point(0.5);
    let sc = (s1 * c1 - s0 * c0) * half;
    f[0] * dt + f[1] * (s1 - s0) + f[2] * (c0 - c1) + f[3] * (dt * half + sc) + f[4] * ((s1 * s1 - s0 * s0) * half)
        + f[5] * (dt * half - sc)
}
/// First moments `∫ x dV` (model frame) and the volume of each solid of a
/// Model with a patch face, as enclosures, by `∫ x_k dV = ¼ ∮ x_k (x·n) dA`.
/// A planar face contributes its exact chart moments; a patch face needs
/// `W = ∫ n nᵀ dA`, which the surface divergence of `x_j P e_i` turns into
/// `(δ_ij A − ∮ x_j ν_i ds) / 3` over its arcs (ν the outward conormal).
pub(super) fn moments(d: &Draft) -> Result<Vec<([Iv; 3], Iv)>> {
    let mut out = vec![];
    for solid in &d.solids {
        let mut m = [Iv::point(0.); 3];
        let mut flux = Iv::point(0.);
        for sh in &solid.shells {
            for &fi in &d.shells[sh.index()].faces {
                let f = &d.faces[fi.index()];
                if is_sphere(d, fi) {
                    let (area, fx) = patch_measure(d, fi)?;
                    flux = flux + fx;
                    let s = sphere_of(d, fi)?;
                    let a = ivq(s.radius())?;
                    let sigma = if f.forward { Iv::point(1.) } else { Iv::point(-1.) };
                    let mut nvec = [Iv::point(0.); 3];
                    let mut b = [[Iv::point(0.); 3]; 3];
                    for &l in &f.loops {
                        for arc in loop_arcs(d, s, l)? {
                            let sweep = arc.sweep()?;
                            let k = arc.axis;
                            let (i1, i2) = ((k + 1) % 3, (k + 2) % 3);
                            let rho = circle_radius(s.radius(), &arc.h)?.ok_or(Refused("model/g4-degenerate-edge"))?;
                            let (rho_i, h) = (iv(&rho)?, iv(&arc.h)?);
                            let ends = match &arc.ends {
                                Some([p0, p1]) => {
                                    let cs = |p: &RPoint| -> Result<[Iv; 2]> {
                                        Ok([iv(&arithmetic(|| &p[i1] / &rho)?)?, iv(&arithmetic(|| &p[i2] / &rho)?)?])
                                    };
                                    (cs(p0)?, cs(p1)?)
                                }
                                None => ([Iv::point(1.), Iv::point(0.)], [Iv::point(1.), Iv::point(0.)]),
                            };
                            // x(θ) = h e_k + ρ (c e_i1 + s e_i2); the unit
                            // tangent along the traversal is ±(−s e_i1 + c e_i2).
                            let zero = Iv::point(0.);
                            let mut x: [Lin; 3] = [[zero; 3]; 3];
                            x[k] = [h, zero, zero];
                            x[i1] = [zero, rho_i, zero];
                            x[i2] = [zero, zero, rho_i];
                            let sg = if arc.ccw { Iv::point(1.) } else { Iv::point(-1.) };
                            // t × x = sg (h (c e_i1 + s e_i2) − ρ e_k) for the
                            // unit tangent t = sg (−s e_i1 + c e_i2) (c² + s² = 1).
                            let mut txx: [Lin; 3] = [[zero; 3]; 3];
                            txx[i1] = [zero, sg * h, zero];
                            txx[i2] = [zero, zero, sg * h];
                            txx[k] = [-(sg * rho_i), zero, zero];
                            // ν = (t × x)/a, ds = ρ|dθ|: the stored traversal's
                            // ∮ g ds = ρ sg ∫ g dθ over θ0 .. θ0 + Δθ.
                            for i in 0..3 {
                                for j in 0..3 {
                                    let f6 = lin_mul(&x[j], &txx[i]);
                                    b[i][j] = b[i][j] + trig_integral(&f6, sweep, ends.0, ends.1) * rho_i * sg / a;
                                }
                            }
                            let p = arc.centre();
                            let dx = match &arc.ends {
                                Some([s0, t0]) => rcross(&p, &rsub(t0, s0)?)?,
                                None => std::array::from_fn(|_| Radical::default()),
                            };
                            let rho2 = rho_i * rho_i;
                            for i in 0..3 {
                                let e = if i == k { Iv::point(1.) } else { Iv::point(0.) };
                                nvec[i] = nvec[i] + (iv(&dx[i])? + rho2 * sweep * e) * Iv::point(0.5);
                            }
                        }
                    }
                    // Outward quantities: m = ∫ n_out dA = σ N, W from the
                    // region-left boundary (σ times the stored one).
                    let mo: [Iv; 3] = std::array::from_fn(|i| sigma * nvec[i]);
                    let w: [[Iv; 3]; 3] = std::array::from_fn(|i| {
                        std::array::from_fn(|j| {
                            let delta = if i == j { area } else { Iv::point(0.) };
                            (delta - sigma * b[i][j]) / Iv::point(3.)
                        })
                    });
                    let cols = s.frame.columns();
                    let rot = |v: &[Iv; 3]| -> Result<[Iv; 3]> {
                        let mut r = [Iv::point(0.); 3];
                        for i in 0..3 {
                            for j in 0..3 {
                                r[i] = r[i] + v[j] * ivq(&cols[j][i])?;
                            }
                        }
                        Ok(r)
                    };
                    let c: [Iv; 3] = [ivq(&s.frame.origin()[0])?, ivq(&s.frame.origin()[1])?, ivq(&s.frame.origin()[2])?];
                    // c in own axes: Rᵀ c.
                    let mut cl = [Iv::point(0.); 3];
                    for j in 0..3 {
                        for i in 0..3 {
                            cl[j] = cl[j] + ivq(&cols[j][i])? * c[i];
                        }
                    }
                    let rm = rot(&mo)?;
                    let c_rm = c[0] * rm[0] + c[1] * rm[1] + c[2] * rm[2];
                    let wc: [Iv; 3] = std::array::from_fn(|i| w[i][0] * cl[0] + w[i][1] * cl[1] + w[i][2] * cl[2]);
                    let rwc = rot(&wc)?;
                    for k in 0..3 {
                        m[k] = m[k] + sigma * (c[k] * c_rm + a * c[k] * area + a * rwc[k] + a * a * rm[k]) * Iv::point(0.25);
                    }
                } else if let Some((_, fx, mk)) = band_measure(d, fi)? {
                    flux = flux + fx;
                    for k in 0..3 {
                        m[k] = m[k] + mk[k];
                    }
                } else {
                    let Carrier3::Plane(p) = &d.surfaces[f.surface.index()].carrier else {
                        return Err(Refused("boolean/ssi-row-unavailable:measure/stereo-mixed-carrier"));
                    };
                    let (mut g, mut mu, mut mv) = (Iv::point(0.), Iv::point(0.), Iv::point(0.));
                    for &l in &f.loops {
                        let pieces = d.loops[l.index()].coedges.iter().map(|c| d.coedges[c.index()].pcurve.clone()).collect();
                        let cyc = wonky_curve::Cycle::new(pieces);
                        g = g + curve(curve(cyc.green_symbolic())?.enclosure())?;
                        let [a0, a1] = curve(cyc.moments())?;
                        mu = mu + a0;
                        mv = mv + a1;
                    }
                    let xx = ivq(&crate::dot(&p.x, &p.x))?;
                    let no = ivq(&crate::dot(&p.n, &p.o))?;
                    flux = flux + no * xx * g;
                    let y = p.y();
                    for k in 0..3 {
                        m[k] = m[k] + no * xx * (ivq(&p.o[k])? * g + ivq(&p.x[k])? * mu + ivq(&y[k])? * mv) * Iv::point(0.25);
                    }
                }
            }
        }
        out.push((m, flux / Iv::point(3.)));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::Frame;

    fn sphere(a: i64) -> Sphere3 {
        let f = Frame::new([q(10), q(2), q(10)], [[q(1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]]).unwrap();
        Sphere3::new(f, q(a * a)).unwrap()
    }
    #[test]
    fn section_pieces_lift_onto_their_plane() {
        let s = sphere(4);
        // AC111: the box front l_1 = −2 (r² = 12, no rational point) and
        // top l_2 = 0 (the equator, the seam itself).
        for patch in [Patch::First, Patch::Second] {
            assert!(disc_pieces(s.radius(), 2, &r(q(0)), patch).unwrap().is_none());
            let pieces = disc_pieces(s.radius(), 1, &r(q(-2)), patch).unwrap().unwrap();
            assert_eq!(pieces.len(), 1);
            for p in pieces[0].ends() {
                let l = lift_local(s.radius(), patch, &p.coordinates()).unwrap();
                assert_eq!(l[1], r(q(-2)));
                assert!(l[2].is_zero(), "the arc ends on the equator");
            }
            let m = curve(pieces[0].exact_interior_point()).unwrap();
            let l = lift_local(s.radius(), patch, &m.coordinates()).unwrap();
            assert_eq!(l[1], r(q(-2)));
            let back = chart_local(s.radius(), patch, &l).unwrap();
            assert_eq!(back, m.coordinates());
        }
    }
    #[test]
    fn concentric_and_chord_images() {
        let s = sphere(5);
        let caps = disc_pieces(s.radius(), 2, &r(q(3)), Patch::First).unwrap().unwrap();
        assert!(caps[0].is_ring());
        assert!(disc_pieces(s.radius(), 2, &r(q(3)), Patch::Second).unwrap().unwrap().is_empty());
        let chord = disc_pieces(s.radius(), 0, &r(q(0)), Patch::Second).unwrap().unwrap();
        assert!(matches!(chord[0].carrier(), Carrier::Line));
        assert!(disc_pieces(s.radius(), 0, &r(q(5)), Patch::First).unwrap().unwrap().is_empty());
    }
}
