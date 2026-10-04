//! Exact adapters' construction primitives. The result goes through the same
//! Draft audit as every other Model; no operation dispatch calls this module.
use super::*;
use num_traits::{Signed, Zero};
use std::collections::BTreeMap;
use wonky_curve::{Carrier, Cycle, ExactPoint, Trimmed};

fn at(node: u32, slot: usize) -> Provenance {
    Provenance {
        node,
        slot: slot as u32,
    }
}
fn empty(placement: Frame) -> Draft {
    Draft {
        placement,
        label: Label::Exact,
        surfaces: vec![],
        curves: vec![],
        vertices: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
    }
}
fn circle(frame: &Frame, r: &Q, h: &Q) -> Result<Circle3> {
    let shifted = Frame::new(
        frame.point(&[Q::zero(), Q::zero(), h.clone()]),
        frame.columns().clone(),
    )?;
    Circle3::new(shifted, r * r)
}
fn ring(d: &mut Draft, node: u32, circle: Circle3) -> EdgeId {
    let curve = CurveId(d.curves.len() as u32);
    d.curves.push(Curve {
        geometry: Curve3::Circle(circle),
        provenance: at(node, curve.index()),
    });
    let edge = EdgeId(d.edges.len() as u32);
    d.edges.push(Edge {
        curve,
        bounds: Bounds::Ring,
        provenance: at(node, edge.index()),
    });
    edge
}
fn loop_use(
    d: &mut Draft,
    node: u32,
    edge: EdgeId,
    forward: bool,
    pcurve: Trimmed,
    atlas: Option<AtlasTrim>,
) -> LoopId {
    let co = CoedgeId(d.coedges.len() as u32);
    d.coedges.push(Coedge {
        edge,
        forward,
        pcurve,
        atlas,
        provenance: at(node, co.index()),
    });
    let lp = LoopId(d.loops.len() as u32);
    d.loops.push(Loop {
        coedges: vec![co],
        provenance: at(node, lp.index()),
    });
    lp
}
fn add_face(
    d: &mut Draft,
    node: u32,
    carrier: Carrier3,
    forward: bool,
    loops: Vec<LoopId>,
) -> FaceId {
    let s = SurfaceId(d.surfaces.len() as u32);
    d.surfaces.push(Surface {
        carrier,
        provenance: at(node, s.index()),
    });
    let f = FaceId(d.faces.len() as u32);
    d.faces.push(Face {
        surface: s,
        forward,
        loops,
        provenance: at(node, f.index()),
    });
    f
}
fn plane(frame: &Frame, h: &Q) -> Plane3 {
    Plane3 {
        o: frame.point(&[Q::zero(), Q::zero(), h.clone()]),
        x: frame.columns()[0].clone(),
        n: cross(&frame.columns()[0], &frame.columns()[1]),
    }
}
fn circle_of(d: &Draft, e: EdgeId) -> Result<&Circle3> {
    match &d.curves[d.edges[e.index()].curve.index()].geometry {
        Curve3::TranslatedCircle(_) => Err(Refused("model/translated-circle/revolution-unavailable")),
        Curve3::Circle(c) => Ok(c),
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => Err(Refused("model/g4-ring-on-open-curve")),
        Curve3::RadicalCircle(_) => Err(Refused("boolean/ssi-row-unavailable:revolution/quadratic-ring")),
    }
}
fn add_band(
    d: &mut Draft,
    node: u32,
    frame: Frame,
    rings: [(Q, Q); 2],
    edges: [EdgeId; 2],
    forward: bool,
) -> Result<FaceId> {
    let carrier = if rings[0].1 == rings[1].1 {
        Carrier3::Cylinder(Cylinder3::new(frame, &rings[0].1 * &rings[0].1)?)
    } else {
        Carrier3::Cone(Cone3::new(frame, rings.clone())?)
    };
    let mut loops = vec![];
    for i in 0..2 {
        let ccw = (i == 0) == forward;
        let atlas = AtlasTrim::ring(rings[i].0.clone(), ccw)?;
        let pcurve = atlas.pieces[0].piece.clone();
        loops.push(loop_use(d, node, edges[i], ccw, pcurve, Some(atlas)));
    }
    Ok(add_face(d, node, carrier, forward, loops))
}

/// A closed counter-clockwise rational meridian, rotated about its own Z.
/// This admits planes, full cylindrical/conical bands and collapsed cone
/// apexes. The singular boundary is never manufactured into a ring or vertex.
pub fn revolution(placement: Frame, frame: Frame, profile: &[[Q; 2]], node: u32) -> Result<Draft> {
    if profile.len() < 3 || profile.iter().any(|p| p[0].is_negative()) {
        return Err(Refused("model/g1-meridian"));
    }
    let pieces = (0..profile.len())
        .map(|i| {
            Trimmed::new(
                [profile[i].clone(), profile[(i + 1) % profile.len()].clone()]
                    .map(ExactPoint::from_rational),
                Carrier::Line,
            )
            .map_err(|e| Refused(e.name()))
        })
        .collect::<Result<Vec<_>>>()?;
    if !Cycle::new(pieces.clone())
        .orientation()
        .map_err(|e| Refused(e.name()))?
    {
        return Err(Refused("model/g5-meridian-orientation"));
    }
    for i in 0..pieces.len() {
        for j in i + 1..pieces.len() {
            for p in pieces[i]
                .contacts(&pieces[j])
                .map_err(|e| Refused(e.name()))?
            {
                let consecutive = j == i + 1 || (i == 0 && j + 1 == pieces.len());
                if !consecutive || !pieces[i].ends().contains(&p) || !pieces[j].ends().contains(&p)
                {
                    return Err(Refused("model/g6-meridian-crossing"));
                }
            }
        }
    }
    let mut d = empty(placement);
    let mut rings = BTreeMap::new();
    for p in profile {
        if !p[0].is_zero() && !rings.contains_key(p) {
            let e = ring(&mut d, node, circle(&frame, &p[0], &p[1])?);
            rings.insert(p.clone(), e);
        }
    }
    let mut faces = vec![];
    for i in 0..profile.len() {
        let (a, b) = (&profile[i], &profile[(i + 1) % profile.len()]);
        if a[0].is_zero() && b[0].is_zero() {
            continue;
        }
        if a[1] == b[1] {
            let pl = plane(&frame, &a[1]);
            let forward = b[0] < a[0];
            let (outer, inner) = if a[0] > b[0] { (a, b) } else { (b, a) };
            let mut loops = vec![];
            for (j, p) in [outer, inner].into_iter().enumerate() {
                if p[0].is_zero() {
                    continue;
                }
                let e = rings[p];
                let sense = (j == 0) == forward;
                let pc = periodic::plane_ring(circle_of(&d, e)?, &pl, sense)?;
                loops.push(loop_use(&mut d, node, e, sense, pc, None));
            }
            faces.push(add_face(&mut d, node, Carrier3::Plane(pl), forward, loops));
        } else {
            let (lo, hi) = if a[1] < b[1] { (a, b) } else { (b, a) };
            if a[0].is_zero() || b[0].is_zero() {
                let (apex, rim) = if a[0].is_zero() { (a, b) } else { (b, a) };
                let forward = a[1] < b[1];
                let sense = (rim[1] < apex[1]) == forward;
                let atlas = AtlasTrim::ring(rim[1].clone(), sense)?;
                let lp = loop_use(
                    &mut d,
                    node,
                    rings[rim],
                    sense,
                    atlas.pieces[0].piece.clone(),
                    Some(atlas),
                );
                let carrier = Carrier3::Cone(Cone3::new(
                    frame.clone(),
                    [
                        (lo[1].clone(), lo[0].clone()),
                        (hi[1].clone(), hi[0].clone()),
                    ],
                )?);
                faces.push(add_face(&mut d, node, carrier, forward, vec![lp]));
                continue;
            }
            faces.push(add_band(
                &mut d,
                node,
                frame.clone(),
                [
                    (lo[1].clone(), lo[0].clone()),
                    (hi[1].clone(), hi[0].clone()),
                ],
                [rings[lo], rings[hi]],
                a[1] < b[1],
            )?);
        }
    }
    d.shells.push(Shell {
        faces,
        provenance: at(node, 0),
    });
    d.solids.push(Solid {
        shells: vec![ShellId(0)],
        provenance: at(node, 0),
    });
    Ok(d)
}

/// Exact source cylinder and its (possibly overshooting) axial tool interval.
#[derive(Clone, Debug)]
pub struct Bore {
    pub carrier: Cylinder3,
    pub extent: [Q; 2],
}

/// Attach the ring trims of round columns to a checked prism/revolution Model.
/// Caps are found by exact plane relation and disc containment. Floors and
/// closed void shells are constructed when the tool ends inside the material.
pub fn bore_trims(base: &Model, bores: &[Bore], node: u32) -> Result<Draft> {
    if base.draft.solids.len() != 1 || base.draft.solids[0].shells.len() != 1 {
        return Err(Refused(
            "boolean/ssi-row-unavailable:bore/multiple-base-shells",
        ));
    }
    for i in 0..bores.len() {
        for j in i + 1..bores.len() {
            let a = &bores[i];
            let b = &bores[j];
            let relation = a.carrier.frame()?.relation_from(b.carrier.frame()?).map;
            if !relation.is_isometry() {
                return Err(Refused("boolean/ssi-row-unavailable:bore/non-parallel-tools"));
            }
            if !relation.columns()[2][0].is_zero() || !relation.columns()[2][1].is_zero() {
                // In A's Euclidean chart the common perpendicular n proves a
                // lower bound on EVERY pair of points of the two axes. If its
                // squared distance exceeds (ra+rb)^2, the infinite tubes (and
                // hence the finite tools) are disjoint. No angular tolerance.
                let n = cross(&[Q::zero(), Q::zero(), Q::from_integer(1.into())], &relation.columns()[2]);
                let height = dot(relation.origin(), &n);
                let sum = num_radius(&a.carrier) + num_radius(&b.carrier);
                if &height * &height > &sum * &sum * dot(&n, &n) { continue; }
                return Err(Refused("boolean/ssi-row-unavailable:bore/non-parallel-tools"));
            }
            let z = |h: &Q| &relation.origin()[2] + &relation.columns()[2][2] * h;
            let (u, v) = (z(&b.extent[0]), z(&b.extent[1]));
            let (lo, hi) = (u.clone().min(v.clone()), u.max(v));
            let distance2 = &relation.origin()[0] * &relation.origin()[0]
                + &relation.origin()[1] * &relation.origin()[1];
            let sum = num_radius(&a.carrier) + num_radius(&b.carrier);
            if a.extent[0] <= hi && lo <= a.extent[1] && distance2 <= &sum * &sum {
                return Err(Refused("boolean/ssi-row-unavailable:bore/tool-contact"));
            }
        }
    }
    let mut d = base.clone().into_draft();
    let base_faces = d.faces.len();
    for bore in bores {
        if bore.extent[0] >= bore.extent[1] {
            return Err(Refused("model/g1-bore-extent"));
        }
        let own = bore.carrier.frame()?;
        let axis = own.columns()[2].clone();
        let mut caps: Vec<(Q, FaceId)> = vec![];
        for fi in 0..base_faces {
            let f = &d.faces[fi];
            match &d.surfaces[f.surface.index()].carrier {
                Carrier3::TranslatedCylinder(_) => return Err(Refused("boolean/ssi-row-unavailable:translated-cylinder/cylinder")),
                Carrier3::Rotated(_) => return Err(Refused("model/rotated/bore-consumer")),
                Carrier3::RadicalPlane(_) => return Err(Refused("boolean/ssi-row-unavailable:radical-plane/cylinder")),
                Carrier3::Plane(pl) => {
                    let denom = dot(&pl.n, &axis);
                    if denom.is_zero() {
                        continue;
                    }
                    if !dot(&pl.n, &own.columns()[0]).is_zero()
                        || !dot(&pl.n, &own.columns()[1]).is_zero()
                    {
                        return Err(Refused(
                            "boolean/ssi-row-unavailable:plane×cylinder/oblique",
                        ));
                    }
                    let h = -pl.side(own.origin()) / denom;
                    let c = circle(own, &num_radius(&bore.carrier), &h)?;
                    let pc = periodic::plane_ring(&c, pl, true)?;
                    let (center, r2) = match pc.carrier() {
                        Carrier::Circle(c) => (c.c.rat().map_err(|e| Refused(e.name()))?.clone(), c.r2.rational().ok_or(Refused("model/revolution-radius"))?),
                        Carrier::Line | Carrier::BSpline(_) => {
                            return Err(Refused("model/g3-pcurve-class"))
                        }
                    };
                    let witness = ExactPoint::from_rational(center.clone());
                    let mut winding = 0;
                    let mut clears = true;
                    for l in &f.loops {
                        let pieces: Vec<_> = d.loops[l.index()]
                            .coedges
                            .iter()
                            .map(|c| d.coedges[c.index()].pcurve.clone())
                            .collect();
                        winding += Cycle::new(pieces.clone())
                            .winding(&witness)
                            .map_err(|e| Refused(e.name()))?;
                        for piece in pieces {
                            clears &= piece
                                .clears_disc(&center, &r2)
                                .map_err(|e| Refused(e.name()))?;
                        }
                    }
                    if winding != 0 {
                        if !clears {
                            return Err(Refused(
                                "boolean/ssi-row-unavailable:bore/cap-boundary-contact",
                            ));
                        }
                        caps.push((h, FaceId(fi as u32)));
                    }
                }
                Carrier3::Cylinder(c) => {
                    let relation = own.relation_from(c.frame()?).map;
                    if !relation.columns()[2][0].is_zero() || !relation.columns()[2][1].is_zero() {
                        return Err(Refused(
                            "boolean/ssi-row-unavailable:cylinder×cylinder/non-parallel",
                        ));
                    }
                }
                Carrier3::Cone(_) => {
                    return Err(Refused("boolean/ssi-row-unavailable:cone×cylinder/trim"))
                }
                Carrier3::Sphere(_) => {
                    return Err(Refused("boolean/ssi-row-unavailable:sphere×cylinder/trim"))
                }
                Carrier3::Torus(_) => {
                    return Err(Refused("boolean/ssi-row-unavailable:torus×cylinder/trim"))
                }
            }
        }
        caps.sort_by(|a, b| a.0.cmp(&b.0));
        if caps.len() != 2 {
            return Err(Refused("boolean/ssi-row-unavailable:bore/cap-interval"));
        }
        let (lo, hi) = (
            bore.extent[0].clone().max(caps[0].0.clone()),
            bore.extent[1].clone().min(caps[1].0.clone()),
        );
        if lo >= hi {
            return Err(Refused("boolean/ssi-row-unavailable:bore/disjoint-tool"));
        }
        let r = num_radius(&bore.carrier);
        let heights = [lo.clone(), hi.clone()];
        let edges = heights
            .each_ref()
            .map(|h| circle(own, &r, h))
            .into_iter()
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .map(|c| ring(&mut d, node, c))
            .collect::<Vec<_>>();
        let mut added = vec![];
        let mut attached = false;
        for i in 0..2 {
            if heights[i] == caps[i].0 {
                let fi = caps[i].1;
                let f = &d.faces[fi.index()];
                let pl = d.surfaces[f.surface.index()].carrier.plane()?;
                let c = circle_of(&d, edges[i])?;
                let a = periodic::plane_ring(c, pl, true)?;
                let ccw = match a.carrier() {
                    Carrier::Circle(c) => c.ccw,
                    Carrier::Line | Carrier::BSpline(_) => {
                        return Err(Refused("model/g3-pcurve-class"))
                    }
                };
                let sense = (!f.forward) == ccw;
                let pc = periodic::plane_ring(c, pl, sense)?;
                let lp = loop_use(&mut d, node, edges[i], sense, pc, None);
                d.faces[fi.index()].loops.push(lp);
                attached = true;
            } else {
                let pl = plane(own, &heights[i]);
                let forward = i == 0;
                let pc = periodic::plane_ring(circle_of(&d, edges[i])?, &pl, forward)?;
                let lp = loop_use(&mut d, node, edges[i], forward, pc, None);
                added.push(add_face(
                    &mut d,
                    node,
                    Carrier3::Plane(pl),
                    forward,
                    vec![lp],
                ));
            }
        }
        added.push(add_band(
            &mut d,
            node,
            own.clone(),
            [(lo, r.clone()), (hi, r)],
            [edges[0], edges[1]],
            false,
        )?);
        if attached {
            d.shells[0].faces.extend(added);
        } else {
            let s = ShellId(d.shells.len() as u32);
            d.shells.push(Shell {
                faces: added,
                provenance: at(node, s.index()),
            });
            d.solids[0].shells.push(s);
        }
    }
    Ok(d)
}
fn num_radius(c: &Cylinder3) -> Q {
    wonky_curve::numeric::exact_root(&c.radius2()).expect("rational radius")
}
