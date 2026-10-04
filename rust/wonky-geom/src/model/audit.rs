//! Structural checks and the generic audit G1-G8 (surface-model design §2.10),
//! with the planar rows that stage A0 needs. Every decision is exact: rational
//! arithmetic on carriers and `VertexKey`s, and the `wonky-curve` operation
//! table on chart pieces. No check reads a binary64 cache (plan rule X1).
//!
//! | check | meaning (planar rows) |
//! |---|---|
//! | structure | ids in range; every coedge, loop, face and shell has exactly one owner; nothing empty or orphaned; vertex keys finite and distinct |
//! | G1 | carrier admissibility: a plane has `n != 0`, `x != 0`, `x . n = 0`; a line has `d != 0` |
//! | G2 | edge-carrier incidence per coedge: the edge's line lies in the face's plane |
//! | G3 | pcurve-curve consistency: each pcurve is a chart piece of the curve's class whose ends are the chart images of the coedge's start and end vertices |
//! | G4 | vertex on each incident curve; segment ends distinct; a ring only on a closed curve |
//! | G5 | loop closure (vertex chain and chart chain); outer loop counter-clockwise about the outward normal, holes clockwise (exact cycle orientation) |
//! | G6 | chart embedding: pieces of one face meet only at the shared end of consecutive pieces; every hole lies inside the outer loop and outside the other holes |
//! | G7 | manifoldness: two opposite uses per edge, both in one shell; no two edges on one point set; shells edge-connected; every vertex link one cycle; Euler-Poincare `V + R - E + F - H = 2 (S - G)` with `G >= 0` |
//! | G8 | outward orientation: from an exact point strictly inside each face, the ray along its outward normal crosses the solid's boundary an even number of times; signed volume of each solid > 0 |
//!
//! No-Claim (as in the design): global embedding (no face-face contact away
//! from edges) is not re-proved; replay, tests and the OCCT round trip carry it.
use super::{
    is_zero, Bounds, Carrier3, CoedgeId, Curve3, Draft, EdgeId, FaceId, LoopId, ShellId, VertexId,
    VertexKey,
};
use crate::{dot, Refused, Result, Q};
use num_traits::Zero;
use std::collections::{BTreeMap, BTreeSet};
use wonky_curve::{Carrier, Cycle, Trimmed};

/// Ownership maps established by the structural checks.
struct Own {
    keys: Vec<VertexKey>,
    loop_face: Vec<FaceId>,
    face_shell: Vec<ShellId>,
}

/// The vertex keys of a draft that passes every check.
pub(super) fn check(d: &Draft) -> Result<Vec<VertexKey>> {
    let own = structure(d)?;
    g1(d)?;
    g2(d)?;
    g3(d, &own)?;
    g4(d, &own)?;
    g5(d, &own)?;
    g6(d)?;
    g7(d, &own)?;
    g8(d, &own)?;
    Ok(own.keys)
}

use super::algebraic::{self as exact, RPoint, RadicalPlane3};
use wonky_curve::radical::Radical;
fn point(keys: &[VertexKey], v: VertexId) -> Result<RPoint> {
    Ok(keys[v.index()].coordinates())
}
fn plane(d: &Draft, f: FaceId) -> Result<RadicalPlane3> {
    d.surfaces[d.faces[f.index()].surface.index()]
        .carrier
        .exact_plane()
}
fn coedges(d: &Draft, l: LoopId) -> &[CoedgeId] {
    &d.loops[l.index()].coedges
}
/// Start and end vertex of a coedge, or `None` on a ring.
fn ends(d: &Draft, c: CoedgeId) -> Option<[VertexId; 2]> {
    let co = &d.coedges[c.index()];
    match d.edges[co.edge.index()].bounds {
        Bounds::Segment([a, b]) => Some(if co.forward { [a, b] } else { [b, a] }),
        Bounds::Ring => None,
    }
}
fn pieces(d: &Draft, l: LoopId) -> Vec<Trimmed> {
    coedges(d, l)
        .iter()
        .map(|c| d.coedges[c.index()].pcurve.clone())
        .collect()
}

fn structure(d: &Draft) -> Result<Own> {
    let bad = Refused("model/structure-reference");
    let (ns, nc, nv, ne) = (
        d.surfaces.len(),
        d.curves.len(),
        d.vertices.len(),
        d.edges.len(),
    );
    if d.solids.is_empty() {
        return Err(Refused("model/structure-empty"));
    }
    let mut used = [
        vec![false; ns],
        vec![false; nc],
        vec![false; nv],
        vec![false; ne],
    ];
    for e in &d.edges {
        *used[1].get_mut(e.curve.index()).ok_or(bad.clone())? = true;
        match e.bounds {
            Bounds::Segment(vs) => {
                for v in vs {
                    *used[2].get_mut(v.index()).ok_or(bad.clone())? = true;
                }
            }
            Bounds::Ring => {}
        }
    }
    for c in &d.coedges {
        *used[3].get_mut(c.edge.index()).ok_or(bad.clone())? = true;
    }
    // Each child has exactly one owner.
    fn owners<T: Copy>(n: usize, parents: impl Iterator<Item = (T, Vec<usize>)>) -> Result<Vec<T>> {
        let mut out: Vec<Option<T>> = vec![None; n];
        for (parent, children) in parents {
            if children.is_empty() {
                return Err(Refused("model/structure-empty"));
            }
            for c in children {
                let slot = out.get_mut(c).ok_or(Refused("model/structure-reference"))?;
                if slot.replace(parent).is_some() {
                    return Err(Refused("model/structure-shared-child"));
                }
            }
        }
        out.into_iter()
            .map(|o| o.ok_or(Refused("model/structure-orphan")))
            .collect()
    }
    owners(
        d.coedges.len(),
        d.loops.iter().enumerate().map(|(i, l)| {
            (
                LoopId(i as u32),
                l.coedges.iter().map(|c| c.index()).collect(),
            )
        }),
    )?;
    // A closed sphere has no trim at all (no seam or pole topology, the
    // WC0 convention); every other face needs a loop.
    let loop_face = owners(
        d.loops.len(),
        d.faces
            .iter()
            .enumerate()
            .filter(|(_, f)| !(f.loops.is_empty() && matches!(d.surfaces.get(f.surface.index()).map(|s| &s.carrier), Some(Carrier3::Sphere(_)))))
            .map(|(i, f)| {
                (
                    FaceId(i as u32),
                    f.loops.iter().map(|l| l.index()).collect(),
                )
            }),
    )?;
    let face_shell = owners(
        d.faces.len(),
        d.shells.iter().enumerate().map(|(i, s)| {
            (
                ShellId(i as u32),
                s.faces.iter().map(|f| f.index()).collect(),
            )
        }),
    )?;
    owners(
        d.shells.len(),
        d.solids
            .iter()
            .enumerate()
            .map(|(i, s)| (i, s.shells.iter().map(|s| s.index()).collect())),
    )?;
    for f in &d.faces {
        *used[0].get_mut(f.surface.index()).ok_or(bad.clone())? = true;
    }
    if used.iter().flatten().any(|u| !u) {
        return Err(Refused("model/structure-orphan"));
    }
    let keys = d
        .vertices
        .iter()
        .map(|v| v.def.key())
        .collect::<Result<Vec<_>>>()?;
    if keys.iter().collect::<BTreeSet<_>>().len() != keys.len() {
        return Err(Refused("model/structure-duplicate-vertex"));
    }
    Ok(Own {
        keys,
        loop_face,
        face_shell,
    })
}

fn g1(d: &Draft) -> Result<()> {
    for s in &d.surfaces {
        match &s.carrier {
            Carrier3::TranslatedCylinder(c) => {super::QuadraticPoint3::from_coordinates(c.offset.clone())?;}
            Carrier3::Rotated(_) => {
                let p=s.carrier.exact_plane()?;
                if exact::zero(&p.n) || exact::zero(&p.x) || !exact::dot(&p.x,&p.n).is_zero() {return Err(Refused("model/g1-plane-degenerate"));}
            },
            Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {}
            Carrier3::RadicalPlane(p) => {
                if exact::zero(&p.n) || exact::zero(&p.x) || !exact::dot(&p.x, &p.n).is_zero() {
                    return Err(Refused("model/g1-plane-degenerate"));
                }
            }
            Carrier3::Plane(p) => {
                if is_zero(&p.n) || is_zero(&p.x) || !dot(&p.x, &p.n).is_zero() {
                    return Err(Refused("model/g1-plane-degenerate"));
                }
            }
        }
    }
    for c in &d.curves {
        match &c.geometry {
            Curve3::RadicalLine { d, .. } => {
                if exact::zero(d) {
                    return Err(Refused("model/g1-line-degenerate"));
                }
            }
            Curve3::TranslatedCircle(c) => {super::QuadraticPoint3::from_coordinates(c.offset.clone())?;}
            Curve3::Circle(_) | Curve3::RadicalCircle(_) => {}
            Curve3::Line { d, .. } => {
                if is_zero(d) {
                    return Err(Refused("model/g1-line-degenerate"));
                }
            }
        }
    }
    Ok(())
}

fn g2(d: &Draft) -> Result<()> {
    for f in &d.faces {
        let carrier = &d.surfaces[f.surface.index()].carrier;
        for &l in &f.loops {
            for c in coedges(d, l) {
                let curve =
                    &d.curves[d.edges[d.coedges[c.index()].edge.index()].curve.index()].geometry;
                let on = carrier.contains_curve(curve)?;
                if !on {
                    return Err(Refused("model/g2-curve-off-carrier"));
                }
            }
        }
    }
    Ok(())
}

fn g3(d: &Draft, own: &Own) -> Result<()> {
    for (fi, f) in d.faces.iter().enumerate() {
        if super::revolution_partial::is_band(d,FaceId(fi as u32)) {super::revolution_partial::chart_audit(d,FaceId(fi as u32))?;continue;}
        if super::periodic::is_band(d, FaceId(fi as u32))? {
            continue;
        }
        if super::quadratic_extrusion::strip(d,FaceId(fi as u32)) {super::quadratic_extrusion::chart_audit(d,FaceId(fi as u32))?;continue;}
        if super::extrusion::strip(d,FaceId(fi as u32)) {super::extrusion::chart_audit(d,FaceId(fi as u32))?;continue;}
        if super::stereo::is_patch(d, FaceId(fi as u32)) {
            super::stereo::chart_audit(d, &own.keys, FaceId(fi as u32))?;
            continue;
        }
        let pl = plane(d, FaceId(fi as u32))?;
        for &l in &f.loops {
            for &c in coedges(d, l) {
                let co = &d.coedges[c.index()];
                let curve = &d.curves[d.edges[co.edge.index()].curve.index()].geometry;
                if co.atlas.is_some() {
                    return Err(Refused("model/g3-planar-atlas"));
                }
                match (curve, co.pcurve.carrier()) {
                    (Curve3::TranslatedCircle(circle), Carrier::Circle(_)) => {
                        let expected=circle.plane_ring(&pl,co.forward)?.trim(co.pcurve.ends()[0].clone(),co.pcurve.ends()[1].clone()).map_err(|e|Refused(e.name()))?;
                        if expected.key()!=co.pcurve.key()||expected.ends()!=co.pcurve.ends() {return Err(Refused("model/g3-pcurve-identity"));}
                        let (Carrier::Circle(a),Carrier::Circle(b))=(expected.carrier(),co.pcurve.carrier()) else{return Err(Refused("model/g3-pcurve-class"))};
                        if a.ccw!=b.ccw {return Err(Refused("model/g3-pcurve-sense"));}
                    }
                    (Curve3::Circle(circle), Carrier::Circle(_)) => {
                        let expected = super::periodic::plane_ring(
                            circle,
                            d.surfaces[f.surface.index()].carrier.plane()?,
                            co.forward,
                        )?;
                        let expected = match d.edges[co.edge.index()].bounds {
                            Bounds::Ring => expected,
                            Bounds::Segment(_) => expected.trim(co.pcurve.ends()[0].clone(),co.pcurve.ends()[1].clone()).map_err(|e|Refused(e.name()))?,
                        };
                        if expected.key() != co.pcurve.key() || expected.ends() != co.pcurve.ends()
                        {
                            return Err(Refused("model/g3-pcurve-identity"));
                        }
                        let expected_ccw = match expected.carrier() {
                            Carrier::Circle(c) => c.ccw,
                            Carrier::Line | Carrier::BSpline(_) => {
                                return Err(Refused("model/g3-pcurve-class"))
                            }
                        };
                        let actual_ccw = match co.pcurve.carrier() {
                            Carrier::Circle(c) => c.ccw,
                            Carrier::Line | Carrier::BSpline(_) => {
                                return Err(Refused("model/g3-pcurve-class"))
                            }
                        };
                        if expected_ccw != actual_ccw {
                            return Err(Refused("model/g3-pcurve-sense"));
                        }
                    }
                    (Curve3::Circle(_) | Curve3::TranslatedCircle(_), Carrier::Line | Carrier::BSpline(_)) => {
                        return Err(Refused("model/g3-pcurve-class"))
                    }
                    (Curve3::RadicalCircle(circle), Carrier::Circle(pc)) => {
                        // The chart circle of a Q(√d) circle: its centre and
                        // squared radius in the plane chart; the sense is
                        // the coedge's about the plane normal.
                        let rp = d.surfaces[f.surface.index()].carrier.plane()?;
                        let centre = circle.center()?;
                        let rpl = super::algebraic::RadicalPlane3::from(rp);
                        let cc = rpl.chart_coordinates(&centre)?;
                        let x = super::algebraic::lift(&circle.frame.columns()[0]);
                        let origin = super::algebraic::lift(&[Q::zero(), Q::zero(), Q::zero()]);
                        let ox = rpl.chart_coordinates(&origin)?;
                        let xc = rpl.chart_coordinates(&x)?;
                        let r2 = wonky_curve::radical::guard(|| {
                            let dx = [&xc[0] - &ox[0], &xc[1] - &ox[1]];
                            circle.radius() * circle.radius() * (&dx[0] * &dx[0] + &dx[1] * &dx[1])
                        }).map_err(|_| Refused("boolean/budget-exceeded:quadratic"))?;
                        if pc.c.coordinates() != cc || pc.r2 != r2 {
                            return Err(Refused("model/g3-pcurve-identity"));
                        }
                        let n = crate::cross(&circle.frame.columns()[0], &circle.frame.columns()[1]);
                        let along = num_traits::Signed::is_positive(&crate::dot(&n, &rp.n));
                        if pc.ccw != (co.forward == along) {
                            return Err(Refused("model/g3-pcurve-sense"));
                        }
                        if matches!(d.edges[co.edge.index()].bounds, Bounds::Ring) != pc.full {
                            return Err(Refused("model/g3-pcurve-class"));
                        }
                    }
                    (Curve3::RadicalCircle(_), Carrier::Line | Carrier::BSpline(_)) => {
                        return Err(Refused("model/g3-pcurve-class"))
                    }
                    (Curve3::Line { .. } | Curve3::RadicalLine { .. }, Carrier::Line) => {}
                    (
                        Curve3::Line { .. } | Curve3::RadicalLine { .. },
                        Carrier::Circle(_) | Carrier::BSpline(_),
                    ) => return Err(Refused("model/g3-pcurve-class")),
                }
                let pe = co.pcurve.ends();
                let matches = match ends(d, c) {
                    Some([s, t]) => {
                        let image = |v| pl.chart(&point(&own.keys, v)?);
                        pe[0] == image(s)? && pe[1] == image(t)?
                    }
                    None => pe[0] == pe[1],
                };
                if !matches {
                    return Err(Refused("model/g3-pcurve-ends"));
                }
            }
        }
    }
    Ok(())
}

fn g4(d: &Draft, own: &Own) -> Result<()> {
    for e in &d.edges {
        match (e.bounds, &d.curves[e.curve.index()].geometry) {
            (
                Bounds::Segment([a, b]),
                curve @ (Curve3::Line { .. } | Curve3::RadicalLine { .. }),
            ) => {
                let (p, dir) = match curve {
                    Curve3::Line { p, d } => (exact::lift(p), exact::lift(d)),
                    Curve3::RadicalLine { p, d } => (p.clone(), d.clone()),
                    Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => unreachable!(),
                };
                if own.keys[a.index()] == own.keys[b.index()] {
                    return Err(Refused("model/g4-degenerate-edge"));
                }
                for v in [a, b] {
                    if !exact::zero(&exact::cross(&exact::sub(&point(&own.keys, v)?, &p), &dir)) {
                        return Err(Refused("model/g4-vertex-off-curve"));
                    }
                }
            }
            (Bounds::Ring, Curve3::TranslatedCircle(_)) => return Err(Refused("model/translated-circle/ring-unavailable")),
            (Bounds::Segment([a,b]),Curve3::TranslatedCircle(c)) => {
                if own.keys[a.index()]==own.keys[b.index()] {return Err(Refused("model/g4-degenerate-edge"));}
                for v in [a,b] {if !c.contains_vertex(&own.keys[v.index()])? {return Err(Refused("model/g4-vertex-off-curve"));}}
            }
            (Bounds::Ring, Curve3::Circle(_) | Curve3::RadicalCircle(_)) => {}
            (Bounds::Segment([a, b]), Curve3::RadicalCircle(c)) => {
                if own.keys[a.index()] == own.keys[b.index()] {
                    return Err(Refused("model/g4-degenerate-edge"));
                }
                for v in [a, b] {
                    if !c.contains_vertex(&own.keys[v.index()])? {
                        return Err(Refused("model/g4-vertex-off-curve"));
                    }
                }
            }
            (Bounds::Segment([a, b]), Curve3::Circle(c)) => {
                if own.keys[a.index()] == own.keys[b.index()] {
                    return Err(Refused("model/g4-degenerate-edge"));
                }
                for v in [a, b] {
                    if !c.contains_vertex(&own.keys[v.index()])? {
                        return Err(Refused("model/g4-vertex-off-curve"));
                    }
                }
            }
            (Bounds::Ring, Curve3::Line { .. } | Curve3::RadicalLine { .. }) => {
                return Err(Refused("model/g4-ring-on-open-curve"))
            }
        }
    }
    Ok(())
}

fn g5(d: &Draft, own: &Own) -> Result<()> {
    for (li, lp) in d.loops.iter().enumerate() {
        if super::revolution_partial::is_band(d,own.loop_face[li]) {super::revolution_partial::boundary_audit(d,own.loop_face[li])?;continue;}
        if super::periodic::is_band(d, own.loop_face[li])? {
            continue;
        }
        if super::stereo::is_patch(d, own.loop_face[li]) {
            super::stereo::loop_audit(d, li)?;
            let chained = (0..lp.coedges.len()).all(|k| {
                let (c, next) = (lp.coedges[k], lp.coedges[(k + 1) % lp.coedges.len()]);
                match (ends(d, c), ends(d, next)) {
                    (Some([_, t]), Some([s, _])) => t == s,
                    (None, None) => lp.coedges.len() == 1,
                    (Some(_), None) | (None, Some(_)) => false,
                }
            });
            if !chained {
                return Err(Refused("model/g5-loop-open"));
            }
            continue;
        }
        let n = lp.coedges.len();
        for k in 0..n {
            let (c, next) = (lp.coedges[k], lp.coedges[(k + 1) % n]);
            let chained = match (ends(d, c), ends(d, next)) {
                (Some([_, t]), Some([s, _])) => t == s,
                (None, None) => n == 1,
                (Some(_), None) | (None, Some(_)) => false,
            };
            let charted =
                d.coedges[c.index()].pcurve.ends()[1] == d.coedges[next.index()].pcurve.ends()[0];
            if !chained || !charted {
                return Err(Refused("model/g5-loop-open"));
            }
        }
        let face = own.loop_face[li];
        let f = &d.faces[face.index()];
        let outer = f.loops[0] == LoopId(li as u32);
        let ccw = Cycle::new(pieces(d, LoopId(li as u32)))
            .orientation()
            .map_err(|_| Refused("model/g5-orientation-undecided"))?;
        if ccw != (outer == f.forward) {
            return Err(Refused("model/g5-loop-orientation"));
        }
    }
    Ok(())
}

fn g6(d: &Draft) -> Result<()> {
    for (fi, f) in d.faces.iter().enumerate() {
        if super::revolution_partial::is_band(d,FaceId(fi as u32)) {continue;}
        if super::periodic::is_band(d, FaceId(fi as u32))? {
            continue;
        }
        if super::stereo::is_patch(d, FaceId(fi as u32)) {
            super::stereo::crossing_audit(d, FaceId(fi as u32))?;
            continue;
        }
        let loops: Vec<Vec<Trimmed>> = f.loops.iter().map(|&l| pieces(d, l)).collect();
        let all: Vec<(usize, usize)> = loops
            .iter()
            .enumerate()
            .flat_map(|(li, l)| (0..l.len()).map(move |k| (li, k)))
            .collect();
        for (i, &(la, ka)) in all.iter().enumerate() {
            for &(lb, kb) in &all[i + 1..] {
                let (a, b) = (&loops[la][ka], &loops[lb][kb]);
                let n = loops[la].len();
                let consecutive = la == lb && (kb == ka + 1 || (ka == 0 && kb == n - 1));
                let contacts = a.contacts(b).map_err(|_| Refused("model/g6-overlap"))?;
                for p in contacts {
                    if !(consecutive && a.ends().contains(&p) && b.ends().contains(&p)) {
                        return Err(Refused("model/g6-crossing"));
                    }
                }
            }
        }
        let cycles: Vec<Cycle> = loops.into_iter().map(Cycle::new).collect();
        for k in 1..cycles.len() {
            let w = cycles[k].pieces()[0]
                .interior_point()
                .map_err(|_| Refused("model/g6-witness"))?;
            let winding = |j: usize| {
                cycles[j]
                    .winding(&w)
                    .map_err(|_| Refused("model/g6-winding"))
            };
            if winding(0)? == 0 {
                return Err(Refused("model/g6-hole-outside"));
            }
            for j in 1..cycles.len() {
                if j != k && winding(j)? != 0 {
                    return Err(Refused("model/g6-hole-nested"));
                }
            }
        }
    }
    Ok(())
}

fn g7(d: &Draft, own: &Own) -> Result<()> {
    // Edge uses: exactly two, opposite, within one shell.
    let mut uses: BTreeMap<EdgeId, Vec<(bool, FaceId)>> = BTreeMap::new();
    for (li, lp) in d.loops.iter().enumerate() {
        for c in &lp.coedges {
            let co = &d.coedges[c.index()];
            uses.entry(co.edge)
                .or_default()
                .push((co.forward, own.loop_face[li]));
        }
    }
    for u in uses.values() {
        if u.len() != 2 || u[0].0 == u[1].0 {
            return Err(Refused("model/g7-edge-use"));
        }
        if own.face_shell[u[0].1.index()] != own.face_shell[u[1].1.index()] {
            return Err(Refused("model/g7-shell-split"));
        }
    }
    // One point set is one edge. Two segments on lines through the same two
    // vertices coincide: a non-manifold edge split in two halves with two
    // uses each, which the use count above cannot see and whose canonical
    // keys would tie.
    let mut segments = BTreeSet::new();
    let mut rings = BTreeSet::new();
    let mut radical_rings = BTreeSet::new();
    let mut arcs = BTreeSet::new();
    let mut radical_arcs = BTreeSet::new();
    let mut translated_arcs=std::collections::BTreeSet::new();
    for e in &d.edges {
        match (e.bounds, &d.curves[e.curve.index()].geometry) {
            (Bounds::Segment([a, b]), Curve3::Line { .. } | Curve3::RadicalLine { .. }) => {
                if !segments.insert((a.min(b), a.max(b))) {
                    return Err(Refused("model/g7-edge-coincident"));
                }
            }
            (Bounds::Ring,Curve3::TranslatedCircle(_))=>return Err(Refused("model/translated-circle/ring-unavailable")),
            (Bounds::Segment([a,b]),c@Curve3::TranslatedCircle(_))=> {
                let (key,flip)=super::canonical::curve_key(c);
                let positive=if a<b {!flip}else{flip};
                if !translated_arcs.insert((key,a.min(b),a.max(b),positive)){return Err(Refused("model/g7-edge-coincident"));}
            }
            (Bounds::Ring, Curve3::Circle(c)) => {
                if !rings.insert(c.canonical_key().0) {
                    return Err(Refused("model/g7-edge-coincident"));
                }
            }
            (Bounds::Ring, Curve3::RadicalCircle(c)) => {
                let (n, center, r2, _) = c.canonical_data()?;
                if !radical_rings.insert((n, center, r2)) {
                    return Err(Refused("model/g7-edge-coincident"));
                }
            }
            (Bounds::Segment([a, b]), Curve3::RadicalCircle(c)) => {
                let (n, centre, r2, flip) = c.canonical_data()?;
                let positive = if a < b { !flip } else { flip };
                if !radical_arcs.insert((n, centre, r2, a.min(b), a.max(b), positive)) {
                    return Err(Refused("model/g7-edge-coincident"));
                }
            }
            (Bounds::Segment([a,b]), Curve3::Circle(c)) => {
                let (key,flip)=c.canonical_key();
                let positive=if a<b {!flip}else{flip};
                if !translated_arcs.insert((key.clone(),a.min(b),a.max(b),positive)){return Err(Refused("model/g7-edge-coincident"));}
                if !arcs.insert((key,a.min(b),a.max(b),positive)) {return Err(Refused("model/g7-edge-coincident"));}
            }
            (Bounds::Ring, Curve3::Line { .. } | Curve3::RadicalLine { .. }) => {
                return Err(Refused("model/g4-ring-on-open-curve"))
            }
        }
    }
    // Shells are edge-connected.
    for s in &d.shells {
        let mut reached = BTreeSet::from([s.faces[0]]);
        let mut todo = vec![s.faces[0]];
        while let Some(f) = todo.pop() {
            for u in uses.values().filter(|u| u.iter().any(|x| x.1 == f)) {
                for &(_, g) in u {
                    if reached.insert(g) {
                        todo.push(g);
                    }
                }
            }
        }
        if reached.len() != s.faces.len() {
            return Err(Refused("model/g7-shell-disconnected"));
        }
    }
    // Vertex links: the corners at a vertex join its incident edges into one cycle.
    let mut corners: BTreeMap<VertexId, Vec<(EdgeId, EdgeId)>> = BTreeMap::new();
    for lp in &d.loops {
        let n = lp.coedges.len();
        for k in 0..n {
            let (c, next) = (lp.coedges[k], lp.coedges[(k + 1) % n]);
            match ends(d, c) {
                Some([_, v]) => corners
                    .entry(v)
                    .or_default()
                    .push((d.coedges[c.index()].edge, d.coedges[next.index()].edge)),
                None => {}
            }
        }
    }
    let mut incident: BTreeMap<VertexId, BTreeSet<EdgeId>> = BTreeMap::new();
    for (i, e) in d.edges.iter().enumerate() {
        match e.bounds {
            Bounds::Segment(vs) => {
                for v in vs {
                    incident.entry(v).or_default().insert(EdgeId(i as u32));
                }
            }
            Bounds::Ring => {}
        }
    }
    for (v, edges) in &incident {
        let links = corners.get(v).map(Vec::as_slice).unwrap_or(&[]);
        let mut degree: BTreeMap<EdgeId, usize> = BTreeMap::new();
        for &(a, b) in links {
            *degree.entry(a).or_default() += 1;
            *degree.entry(b).or_default() += 1;
        }
        if degree.keys().copied().collect::<BTreeSet<_>>() != *edges
            || degree.values().any(|&k| k != 2)
        {
            return Err(Refused("model/g7-vertex-link"));
        }
        let first = *edges.iter().next().expect("an incident vertex has an edge");
        let mut reached = BTreeSet::from([first]);
        let mut todo = vec![first];
        while let Some(e) = todo.pop() {
            for &(a, b) in links {
                for (x, y) in [(a, b), (b, a)] {
                    if x == e && reached.insert(y) {
                        todo.push(y);
                    }
                }
            }
        }
        if reached != *edges {
            return Err(Refused("model/g7-vertex-link"));
        }
    }
    // Euler-Poincare; a ring counts one virtual vertex. On planar Models it
    // follows from the checks above (G6 makes every face a disk with holes,
    // and the shells are closed orientable surfaces), so no planar plant can
    // reach it; it becomes a live check with G8's periodic carriers, where a
    // face's topology no longer follows from its loop count.
    let rings = d
        .edges
        .iter()
        .filter(|e| match e.bounds {
            Bounds::Ring => true,
            Bounds::Segment(_) => false,
        })
        .count();
    // A closed sphere face has no loop: it counts −1 hole (χ = 2 alone).
    let holes: i64 = d.faces.iter().map(|f| f.loops.len() as i64 - 1).sum();
    let chi = (d.vertices.len() + rings + d.faces.len()) as i64 - (d.edges.len() as i64 + holes);
    if chi % 2 != 0 || d.shells.len() as i64 - chi / 2 < 0 {
        return Err(Refused("model/g7-euler"));
    }
    Ok(())
}

/// Six times the exact signed volume of each solid (divergence theorem over
/// the planar faces: per loop, a fan about its first vertex).
pub(super) fn volumes6(d: &Draft) -> Result<Vec<Q>> {
    exact::volumes6(d)?
        .into_iter()
        .map(|x| {
            x.rational()
                .ok_or(Refused("model/radical-volume/rational-consumer"))
        })
        .collect()
}

/// Deterministic witness fractions (distinct, with small odd denominators so
/// that lattice-aligned degeneracies at 1/2 are left quickly).
const FRACTIONS: [(i64, i64); 8] = [
    (1, 2),
    (1, 3),
    (2, 3),
    (1, 5),
    (2, 5),
    (3, 5),
    (4, 5),
    (1, 7),
];

enum Hit {
    Outside,
    Inside,
    /// On a boundary, or the ray lies in the face plane: choose another witness.
    Degenerate,
}

/// Exact location of a point of `g`'s plane against face `g`.
fn locate(pl: &RadicalPlane3, cycles: &[Cycle], h: &RPoint) -> Result<Hit> {
    let p = pl.chart(h)?;
    for s in cycles.iter().flat_map(Cycle::pieces) {
        if s.contains(&p).map_err(|_| Refused("model/g8-winding"))? {
            return Ok(Hit::Degenerate);
        }
    }
    let mut winding = 0;
    for c in cycles {
        winding += c.winding(&p).map_err(|_| Refused("model/g8-winding"))?;
    }
    Ok(if winding == 0 {
        Hit::Outside
    } else {
        Hit::Inside
    })
}

fn g8(d: &Draft, own: &Own) -> Result<()> {
    if super::quadratic_extrusion::outward(d)? {return Ok(());}
    if super::revolution_partial::product(d)?.is_some() {return Ok(());}
    if super::extrusion::outward(d)? {return Ok(());}
    let curved = d.curves.iter().any(|c| match c.geometry {
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => false,
        Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => true,
    });
    if super::stereo::has_patch(d) {
        return super::stereo::audit_outward(d);
    }
    if curved {
        return super::periodic::audit_outward(d);
    }
    for v in exact::volumes6(d)? {
        if v <= Radical::default() {
            return Err(Refused("model/g8-volume"));
        }
    }
    let cycles: Vec<Vec<Cycle>> = d
        .faces
        .iter()
        .map(|f| f.loops.iter().map(|&l| Cycle::new(pieces(d, l))).collect())
        .collect();
    for solid in &d.solids {
        let faces: Vec<FaceId> = solid
            .shells
            .iter()
            .flat_map(|s| d.shells[s.index()].faces.iter().copied())
            .collect();
        for &f in &faces {
            let pl = plane(d, f)?;
            let face = &d.faces[f.index()];
            let outward: RPoint = if face.forward {
                pl.n.clone()
            } else {
                pl.n.clone().map(|x| -x)
            };
            // Chart segments of the face, from the exact vertex keys.
            let mut segments = vec![];
            for &l in &face.loops {
                for &c in coedges(d, l) {
                    match ends(d, c) {
                        Some([s, t]) => segments.push([
                            pl.chart_coordinates(&point(&own.keys, s)?)?,
                            pl.chart_coordinates(&point(&own.keys, t)?)?,
                        ]),
                        None => return Err(Refused("model/g8-ring-witness-unsupported")),
                    }
                }
            }
            let mut levels: Vec<&Radical> =
                segments.iter().flat_map(|s| [&s[0][1], &s[1][1]]).collect();
            levels.sort();
            levels.dedup();
            if levels.len() < 2 {
                return Err(Refused("model/g8-witness"));
            }
            let (b0, b1) = (levels[0].clone(), levels[1].clone());
            let fraction = |(n, m): (i64, i64)| Q::new(n.into(), m.into());
            let mut decided = false;
            'attempt: for (ty, tx) in FRACTIONS
                .iter()
                .flat_map(|&y| FRACTIONS.iter().map(move |&x| (y, x)))
            {
                let y = &b0 + (&b1 - &b0) * fraction(ty);
                // Crossings of the scanline: it avoids every vertex level of the face.
                let mut xs: Vec<Radical> = segments
                    .iter()
                    .filter(|[p, q]| ((&p[1] - &y) * (&q[1] - &y)).is_negative())
                    .map(|[p, q]| &p[0] + (&y - &p[1]) * (&q[0] - &p[0]) / (&q[1] - &p[1]))
                    .collect();
                xs.sort();
                if xs.len() < 2 {
                    return Err(Refused("model/g8-witness"));
                }
                let x = &xs[0] + (&xs[1] - &xs[0]) * fraction(tx);
                let w = pl.point(&[x, y]);
                let mut hits = 0;
                for &g in faces.iter().filter(|&&g| g != f) {
                    let gp = plane(d, g)?;
                    let denom = exact::dot(&gp.n, &outward);
                    let side = gp.side(&w);
                    if denom.is_zero() {
                        if side.is_zero() {
                            continue 'attempt;
                        }
                        continue;
                    }
                    let t = -side / denom;
                    if t.is_negative() {
                        continue;
                    }
                    let h: RPoint = std::array::from_fn(|k| &w[k] + &t * &outward[k]);
                    match locate(&gp, &cycles[g.index()], &h)? {
                        Hit::Outside => {}
                        Hit::Inside if t.is_zero() => continue 'attempt,
                        Hit::Inside => hits += 1,
                        Hit::Degenerate => continue 'attempt,
                    }
                }
                if hits % 2 != 0 {
                    return Err(Refused("model/g8-inward-face"));
                }
                decided = true;
                break;
            }
            if !decided {
                return Err(Refused("model/g8-witness-budget"));
            }
        }
    }
    Ok(())
}
