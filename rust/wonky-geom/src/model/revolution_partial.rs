//! Polygon revolution boundary products. The shared audit proves cap pairing,
//! latitude/generator incidence and the half-angle atlas without seam edges.
//! Operation admission is deliberately separate from this Model producer.
use super::curved::Patch;
use super::*;
use crate::{AngleWitness, Turn};
use num_traits::{Signed, Zero};
use std::collections::BTreeSet;
use wonky_curve::{radical::Radical, Carrier, ExactPoint, Trimmed};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn ep(p: [Radical; 2]) -> Result<ExactPoint> {
    (if p.iter().any(|v|v.is_real()){ExactPoint::from_real_coordinates(p)}else{ExactPoint::from_coordinates(p)}).map_err(|e| Refused(e.name()))
}
fn line(a: [Radical; 2], b: [Radical; 2]) -> Result<Trimmed> {
    Trimmed::new([ep(a)?, ep(b)?], Carrier::Line).map_err(|e| Refused(e.name()))
}
fn prov(node: u32, slot: usize) -> Provenance {
    Provenance {
        node,
        slot: slot as u32,
    }
}
fn circle(r: &Q, z: &Q) -> Result<Circle3> {
    Circle3::new(
        Frame::new([q(0), q(0), z.clone()], Frame::identity().columns().clone())?,
        r * r,
    )
}
fn endpoint(p: &[Q; 2], t: &Turn) -> Result<VertexDef> {
    if p[0].is_zero() {
        Ok(VertexDef::Rational([q(0), q(0), p[1].clone()]))
    } else {
        Ok(VertexDef::OnCurve(crate::rotation::OnCurve {
            circle: circle(&p[0], &p[1])?,
            t: t.clone(),
        }))
    }
}
fn edge(d: &mut Draft, node: u32, a: VertexId, b: VertexId, geometry: Curve3) -> EdgeId {
    let curve = CurveId(d.curves.len() as u32);
    d.curves.push(Curve {
        geometry,
        provenance: prov(node, curve.index()),
    });
    let e = EdgeId(d.edges.len() as u32);
    d.edges.push(Edge {
        curve,
        bounds: Bounds::Segment([a, b]),
        provenance: prov(node, e.index()),
    });
    e
}
fn straight(d: &mut Draft, node: u32, a: VertexId, b: VertexId) -> Result<EdgeId> {
    let p = d.vertices[a.index()].def.key()?.coordinates();
    let end = d.vertices[b.index()].def.key()?.coordinates();
    Ok(edge(
        d,
        node,
        a,
        b,
        algebraic::line(p.clone(), algebraic::sub(&end, &p)),
    ))
}
fn use_edge(
    d: &mut Draft,
    node: u32,
    e: EdgeId,
    forward: bool,
    pcurve: Trimmed,
    atlas: Option<AtlasTrim>,
) -> CoedgeId {
    let id = CoedgeId(d.coedges.len() as u32);
    d.coedges.push(Coedge {
        edge: e,
        forward,
        pcurve,
        atlas,
        provenance: prov(node, id.index()),
    });
    id
}
fn face(d: &mut Draft, node: u32, carrier: Carrier3, forward: bool, coedges: Vec<CoedgeId>) {
    let lp = LoopId(d.loops.len() as u32);
    d.loops.push(Loop {
        coedges,
        provenance: prov(node, lp.index()),
    });
    let surface = SurfaceId(d.surfaces.len() as u32);
    d.surfaces.push(Surface {
        carrier,
        provenance: prov(node, surface.index()),
    });
    d.faces.push(Face {
        surface,
        forward,
        loops: vec![lp],
        provenance: prov(node, d.faces.len()),
    });
}
fn fraction(t: &Turn) -> Result<Q> {
    match t.construction_key().1 {
        Some(AngleWitness::Turns(v)) if v > q(0) && v <= q(1) => Ok(v),
        Some(AngleWitness::Turns(_)) => Err(Refused("revolve/turn-range")),
        _ => Err(Refused("revolve/angle-not-rational-pi-measure")),
    }
}
/// Exact half-angle chart path from turn zero, split at both virtual seams.
/// Each patch owns t in [-1,1]; there is no pole and no seam B-rep edge.
pub fn latitude(t: &Turn, height: &Q, forward: bool) -> Result<AtlasTrim> {
    let sector = t.sector()?;
    let (s, c) = t.exact_sin_cos()?;
    let one = Radical::from(q(1));
    let mut ranges: Vec<(Patch, Radical, Radical, i32)> = vec![];
    if sector == 0 {
        ranges.push((Patch::First, Radical::default(), s / (&one + c), 0));
    } else {
        ranges.push((Patch::First, Radical::default(), one.clone(), 1));
        if sector == 1 {
            ranges.push((Patch::Second, -one.clone(), -s / (&one - c), 0));
        } else {
            ranges.push((Patch::Second, -one.clone(), one.clone(), 1));
            ranges.push((Patch::First, -one.clone(), s / (&one + c), 0));
        }
    }
    // At a seam the last nonempty piece owns the endpoint; no zero-length piece.
    ranges.retain(|(_, a, b, _)| a != b);
    if !forward {
        ranges.reverse();
        for (_, a, b, w) in &mut ranges {
            std::mem::swap(a, b);
            *w = -*w;
        }
        // Delta belongs to the transition AFTER a piece, not before it.
        let deltas: Vec<_> = ranges.iter().map(|r| r.3).collect();
        for i in 0..ranges.len() {
            ranges[i].3 = if i + 1 < ranges.len() {
                deltas[i + 1]
            } else {
                0
            };
        }
    }
    let mut pieces = vec![];
    for (patch, a, b, winding_delta) in ranges {
        pieces.push(AtlasPiece {
            patch,
            piece: line(
                [a, Radical::from(height.clone())],
                [b, Radical::from(height.clone())],
            )?,
            winding_delta,
        });
    }
    Ok(AtlasTrim { pieces })
}
/// Build a polygon in its rational (radius,height) construction chart.
/// Full turns use the existing ring primitive; partial turns sew two caps.
/// No opRevolve dispatch or observation geometry is used here. Partial caps
/// use one exact real generator for every admitted Turn class.
pub fn polygon(placement: Frame, profile: &[[Q; 2]], turn: Turn, node: u32) -> Result<Draft> {
    let sector = turn.sector()?;
    // Shared exact simple-profile admission, including axis crossings.
    let mut d = super::revolution::revolution(placement, Frame::identity(), profile, node)?;
    if sector == 4 {
        return Ok(d);
    }
    turn.exact_sin_cos()?;
    d.surfaces.clear();
    d.curves.clear();
    d.vertices.clear();
    d.edges.clear();
    d.coedges.clear();
    d.loops.clear();
    d.faces.clear();
    d.shells.clear();
    d.solids.clear();
    let n = profile.len();
    let mut ids = [vec![], vec![]];
    for (i, p) in profile.iter().enumerate() {
        let id = VertexId(d.vertices.len() as u32);
        d.vertices.push(Vertex {
            def: VertexDef::Rational([p[0].clone(), q(0), p[1].clone()]),
            provenance: prov(node, i),
        });
        ids[0].push(id);
    }
    for (i, p) in profile.iter().enumerate() {
        if p[0].is_zero() {
            ids[1].push(ids[0][i]);
            continue;
        }
        let id = VertexId(d.vertices.len() as u32);
        d.vertices.push(Vertex {
            def: endpoint(p, &turn)?,
            provenance: prov(node, n + i),
        });
        ids[1].push(id);
    }
    let mut cap = [vec![], vec![]];
    for k in 0..2 {
        for i in 0..n {
            let j = (i + 1) % n;
            let e = if k == 1 && profile[i][0].is_zero() && profile[j][0].is_zero() {
                cap[0][i]
            } else {
                straight(&mut d, node, ids[k][i], ids[k][j])?
            };
            cap[k].push(e);
        }
    }
    let mut arcs = vec![None; n];
    for i in 0..n {
        if !profile[i][0].is_zero() {
            arcs[i] = Some(edge(
                &mut d,
                node,
                ids[0][i],
                ids[1][i],
                Curve3::Circle(circle(&profile[i][0], &profile[i][1])?),
            ));
        }
    }
    let base = Plane3 {
        o: crate::zero(),
        x: [q(1), q(0), q(0)],
        n: [q(0), q(-1), q(0)],
    };
    for k in 0..2 {
        let carrier = if k == 0 {
            Carrier3::Plane(base.clone())
        } else {
            Carrier3::rotated(
                Carrier3::Plane(base.clone()),
                crate::rotation::Line3 {
                    p: crate::zero(),
                    d: [q(0), q(0), q(1)],
                },
                turn.clone(),
            )?
        };
        let mut uses = vec![];
        let order: Vec<_> = if k == 0 {
            (0..n).collect()
        } else {
            (0..n).rev().collect()
        };
        for i in order {
            let j = (i + 1) % n;
            let mut ends = [
                profile[i].clone().map(Radical::from),
                profile[j].clone().map(Radical::from),
            ];
            if k == 1 {
                ends.reverse();
            }
            uses.push(use_edge(
                &mut d,
                node,
                cap[k][i],
                k == 0,
                line(ends[0].clone(), ends[1].clone())?,
                None,
            ));
        }
        face(&mut d, node, carrier, k == 0, uses);
    }
    for i in 0..n {
        let j = (i + 1) % n;
        let (a, b) = (&profile[i], &profile[j]);
        if a[0].is_zero() && b[0].is_zero() {
            continue;
        }
        let carrier = if a[1] == b[1] {
            Carrier3::Plane(Plane3 {
                o: [q(0), q(0), a[1].clone()],
                x: [q(1), q(0), q(0)],
                n: [q(0), q(0), q(1)],
            })
        } else if a[0] == b[0] {
            Carrier3::Cylinder(Cylinder3::new(Frame::identity(), &a[0] * &a[0])?)
        } else {
            Carrier3::Cone(Cone3::new(
                Frame::identity(),
                [(a[1].clone(), a[0].clone()), (b[1].clone(), b[0].clone())],
            )?)
        };
        let mut boundary = vec![(cap[0][i], false)];
        if let Some(e) = arcs[i] {
            boundary.push((e, true));
        }
        boundary.push((cap[1][i], true));
        if let Some(e) = arcs[j] {
            boundary.push((e, false));
        }
        let mut uses = vec![];
        for (e, forward) in boundary {
            let Bounds::Segment(mut vs) = d.edges[e.index()].bounds else {
                unreachable!()
            };
            if !forward {
                vs.reverse();
            }
            let p = vs.map(|v| d.vertices[v.index()].def.key().map(|k| k.coordinates()));
            let [pa, pb] = p;
            let (pa, pb) = (pa?, pb?);
            let (pc, atlas) = match &carrier {
                Carrier3::Plane(pl) => {
                    let pl = RadicalPlane3::from(pl);
                    let ends = [pl.chart(&pa)?, pl.chart(&pb)?];
                    let pc = match &d.curves[d.edges[e.index()].curve.index()].geometry {
                        Curve3::Circle(c) => {
                            super::periodic::plane_ring(c, carrier.plane()?, forward)?
                                .trim(ends[0].clone(), ends[1].clone())
                                .map_err(|e| Refused(e.name()))?
                        }
                        Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                            Trimmed::new(ends, Carrier::Line).map_err(|e| Refused(e.name()))?
                        }
                        Curve3::RadicalCircle(_) => {
                            return Err(Refused("boolean/ssi-row-unavailable:revolution/quadratic-ring"))
                        }
                        Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/revolution-partial")),
                    };
                    (pc, None)
                }
                Carrier3::Cylinder(_) | Carrier3::Cone(_) => {
                    if matches!(
                        d.curves[d.edges[e.index()].curve.index()].geometry,
                        Curve3::Circle(_)
                    ) {
                        let atlas = latitude(
                            &turn,
                            &pa[2].rational().ok_or(Refused("revolve/height-field"))?,
                            forward,
                        )?;
                        (atlas.pieces[0].piece.clone(), Some(atlas))
                    } else {
                        let at_end = vs
                            .iter()
                            .any(|v| matches!(d.vertices[v.index()].def, VertexDef::OnCurve(_)));
                        let (patch, t) = if at_end {
                            end_chart(&turn)?
                        } else {
                            (Patch::First, Radical::default())
                        };
                        let pc = line([t.clone(), pa[2].clone()], [t, pb[2].clone()])?;
                        let atlas = AtlasTrim {
                            pieces: vec![AtlasPiece {
                                patch,
                                piece: pc.clone(),
                                winding_delta: 0,
                            }],
                        };
                        (pc, Some(atlas))
                    }
                }
                Carrier3::Rotated(_) | Carrier3::RadicalPlane(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) | Carrier3::TranslatedCylinder(_) => {
                    return Err(Refused("revolve/carrier-class"))
                }
            };
            uses.push(use_edge(&mut d, node, e, forward, pc, atlas));
        }
        let forward = if a[1] == b[1] {
            b[0] < a[0]
        } else {
            a[1] < b[1]
        };
        face(&mut d, node, carrier, forward, uses);
    }
    d.shells.push(Shell {
        faces: (0..d.faces.len()).map(|i| FaceId(i as u32)).collect(),
        provenance: prov(node, 0),
    });
    d.solids.push(Solid {
        shells: vec![ShellId(0)],
        provenance: prov(node, 0),
    });
    Ok(d)
}
fn end_chart(t: &Turn) -> Result<(Patch, Radical)> {
    let sector = t.sector()?;
    let (s, c) = t.exact_sin_cos()?;
    let one = Radical::from(q(1));
    if sector == 0 || sector == 2 {
        Ok((Patch::First, s / (&one + c)))
    } else {
        Ok((Patch::Second, -s / (&one - c)))
    }
}
pub(super) fn is_band(d: &Draft, fi: FaceId) -> bool {
    let f = &d.faces[fi.index()];
    matches!(
        d.surfaces[f.surface.index()].carrier,
        Carrier3::Cylinder(_) | Carrier3::Cone(_)
    ) && f.loops.len() == 1
        && d.loops[f.loops[0].index()]
            .coedges
            .iter()
            .any(|c| d.coedges[c.index()].atlas.is_some())
        && d.loops[f.loops[0].index()].coedges.iter().all(|c| {
            matches!(
                d.edges[d.coedges[c.index()].edge.index()].bounds,
                Bounds::Segment(_)
            )
        })
}
fn same_atlas(a: &AtlasTrim, b: &AtlasTrim) -> bool {
    a.pieces.len() == b.pieces.len()
        && a.pieces.iter().zip(&b.pieces).all(|(a, b)| {
            a.patch == b.patch
                && a.winding_delta == b.winding_delta
                && a.piece.ends() == b.piece.ends()
                && a.piece.key() == b.piece.key()
        })
}
fn turn_of(d: &Draft) -> Result<Option<Turn>> {
    let mut turn: Option<Turn> = None;
    for v in &d.vertices {
        if let VertexDef::OnCurve(p) = &v.def {
            if let Some(t) = &turn {
                if t != &p.t {
                    return Err(Refused("revolve/mixed-cap-turn"));
                }
            } else {
                turn = Some(p.t.clone());
            }
        }
    }
    Ok(turn)
}
/// Independent chart incidence: lift every atlas endpoint through its patch,
/// check latitude/generator classes and all transitions against exact vertices.
pub(super) fn chart_audit(d: &Draft, fi: FaceId) -> Result<()> {
    let turn = turn_of(d)?.ok_or(Refused("model/g3-revolution-turn"))?;
    let f = &d.faces[fi.index()];
    let carrier = &d.surfaces[f.surface.index()].carrier;
    let frame = match carrier {
        Carrier3::Cylinder(c) => c.frame()?,
        Carrier3::Cone(c) => &c.frame,
        _ => return Err(Refused("model/g3-revolution-carrier")),
    };
    if frame != &Frame::identity() {
        return Err(Refused("model/g3-revolution-chart-frame"));
    }
    for &c in &d.loops[f.loops[0].index()].coedges {
        let co = &d.coedges[c.index()];
        let edge = &d.edges[co.edge.index()];
        let Bounds::Segment(mut vs) = edge.bounds else {
            return Err(Refused("model/g3-revolution-bounds"));
        };
        if !co.forward {
            vs.reverse();
        }
        let [a, b] = vs.map(|v| d.vertices[v.index()].def.key().map(|v| v.coordinates()));
        let (a, b) = (a?, b?);
        let atlas = co
            .atlas
            .as_ref()
            .ok_or(Refused("model/g3-periodic-atlas-missing"))?;
        let expected = match &d.curves[edge.curve.index()].geometry {
            Curve3::Circle(circle) => {
                if !a[2].eq(&b[2])
                    || circle.frame()?.origin()
                        != &[
                            q(0),
                            q(0),
                            a[2].rational()
                                .ok_or(Refused("model/g3-revolution-height"))?,
                        ]
                    || circle.frame()?.columns() != Frame::identity().columns()
                {
                    return Err(Refused("model/g3-revolution-latitude"));
                }
                latitude(
                    &turn,
                    &a[2]
                        .rational()
                        .ok_or(Refused("model/g3-revolution-height"))?,
                    co.forward,
                )?
            }
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                let at_end = vs
                    .iter()
                    .any(|v| matches!(d.vertices[v.index()].def, VertexDef::OnCurve(_)));
                let (patch, t) = if at_end {
                    end_chart(&turn)?
                } else {
                    (Patch::First, Radical::default())
                };
                AtlasTrim {
                    pieces: vec![AtlasPiece {
                        patch,
                        piece: line([t.clone(), a[2].clone()], [t, b[2].clone()])?,
                        winding_delta: 0,
                    }],
                }
            }
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/revolution-partial")),
            Curve3::RadicalCircle(_) => {
                return Err(Refused("boolean/ssi-row-unavailable:revolution/quadratic-ring"))
            }
        };
        if !same_atlas(atlas, &expected)
            || co.pcurve.ends() != atlas.pieces[0].piece.ends()
            || co.pcurve.key() != atlas.pieces[0].piece.key()
        {
            return Err(Refused("model/g3-revolution-atlas-identity"));
        }
        // Independently verify chart embedding and seam transitions. Agreement
        // with the constructor alone is not a chart proof.
        let latitude_curve = matches!(d.curves[edge.curve.index()].geometry, Curve3::Circle(_));
        for (i, part) in atlas.pieces.iter().enumerate() {
            if !matches!(part.piece.carrier(), Carrier::Line) {
                return Err(Refused("model/g3-revolution-chart-class"));
            }
            let [u, v] = [
                part.piece.ends()[0].coordinates(),
                part.piece.ends()[1].coordinates(),
            ];
            let one = Radical::from(q(1));
            if u[0].abs() > one || v[0].abs() > one {
                return Err(Refused("model/g3-revolution-chart-pole"));
            }
            if latitude_curve {
                if u[1] != v[1] || (v[0] > u[0]) != co.forward {
                    return Err(Refused("model/g3-revolution-chart-sense"));
                }
                if let Some(next) = atlas.pieces.get(i + 1) {
                    let next_uv = next.piece.ends()[0].coordinates();
                    let seam = Radical::from(if co.forward { q(1) } else { q(-1) });
                    if v[0] != seam
                        || next_uv[0] != -seam
                        || v[1] != next_uv[1]
                        || next.patch == part.patch
                        || part.winding_delta != if co.forward { 1 } else { -1 }
                    {
                        return Err(Refused("model/g3-revolution-seam-transition"));
                    }
                } else if part.winding_delta != 0 {
                    return Err(Refused("model/g3-revolution-seam-transition"));
                }
            } else if u[0] != v[0] || atlas.pieces.len() != 1 || part.winding_delta != 0 {
                return Err(Refused("model/g3-revolution-generator-chart"));
            }
        }
        // The complete pcurve lifts to the actual curve and exact end vertices.
        let ends = [atlas.pieces.first().unwrap(), atlas.pieces.last().unwrap()];
        for (i, part) in ends.iter().enumerate() {
            let uv = part.piece.ends()[i].coordinates();
            let t = &uv[0];
            let h = &uv[1];
            let den = Radical::from(q(1)) + t * t;
            let mut xy = [(Radical::from(q(1)) - t * t) / &den, (t * q(2)) / &den];
            if part.patch == Patch::Second {
                xy = xy.map(|x| -x);
            }
            let r = match carrier {
                Carrier3::Cylinder(c) => {
                    Radical::from(wonky_curve::numeric::exact_root(&c.radius2()).unwrap())
                }
                Carrier3::Cone(c) => {
                    let [x, y] = c.meridian()?;
                    Radical::from(x) + h * y
                }
                _ => unreachable!(),
            };
            let p = [&r * &xy[0], &r * &xy[1], h.clone()];
            if p != if i == 0 { a.clone() } else { b.clone() } {
                return Err(Refused("model/g3-pcurve-ends"));
            }
        }
    }
    Ok(())
}
pub(super) fn boundary_audit(d: &Draft, fi: FaceId) -> Result<()> {
    let f = &d.faces[fi.index()];
    let lp = &d.loops[f.loops[0].index()];
    if lp.coedges.len() != 3 && lp.coedges.len() != 4 {
        return Err(Refused("model/g5-revolution-boundary"));
    }
    for i in 0..lp.coedges.len() {
        let ends = |c: CoedgeId| -> Result<[VertexId; 2]> {
            let co = &d.coedges[c.index()];
            let Bounds::Segment(v) = d.edges[co.edge.index()].bounds else {
                return Err(Refused("model/g5-revolution-bounds"));
            };
            Ok(if co.forward { v } else { [v[1], v[0]] })
        };
        if ends(lp.coedges[i])?[1] != ends(lp.coedges[(i + 1) % lp.coedges.len()])?[0] {
            return Err(Refused("model/g5-loop-open"));
        }
    }
    Ok(())
}
/// Reconstruct and prove a closed angular boundary product from its actual
/// topology. This is a surface-class row: no source-family tag admits a body.
/// The cap's simple meridian plus a positive angular interval is injective
/// away from the axis; the shared axis edge quotients precisely its collapse.
pub(super) fn product(d: &Draft) -> Result<Option<(Vec<[Q; 2]>, Turn)>> {
    // OnCurve is a general vertex class, not an operation-family tag. Only
    // angular cylinder/cone trims request this boundary-product audit row.
    if !d
        .faces
        .iter()
        .enumerate()
        .any(|(i, _)| is_band(d, FaceId(i as u32)))
    {
        return Ok(None);
    }
    let Some(turn) = turn_of(d)? else {
        return Ok(None);
    };
    let sector = turn.sector()?;
    if sector == 4 {
        return Err(Refused("model/g8-revolution-cap-full-turn"));
    }
    if d.solids.len() != 1 || d.shells.len() != 1 {
        return Err(Refused("model/g8-revolution-shells"));
    }
    let base = RadicalPlane3::from(&Plane3 {
        o: crate::zero(),
        x: [q(1), q(0), q(0)],
        n: [q(0), q(-1), q(0)],
    });
    let (sin, cos) = turn.exact_sin_cos()?;
    let target = RadicalPlane3 {
        o: base.o.clone(),
        x: [cos.clone(), sin.clone(), Radical::default()],
        n: [sin.clone(), -cos.clone(), Radical::default()],
    };
    let mut caps = [None, None];
    for (i, face) in d.faces.iter().enumerate() {
        if let Ok(pl) = d.surfaces[face.surface.index()].carrier.exact_plane() {
            for (k, p) in [&base, &target].iter().enumerate() {
                if &pl == *p {
                    if caps[k].replace(FaceId(i as u32)).is_some() {
                        return Err(Refused("model/g8-revolution-cap-duplicate"));
                    }
                }
            }
        }
    }
    let [Some(start), Some(end)] = caps else {
        return Err(Refused("model/g8-revolution-caps"));
    };
    if !d.faces[start.index()].forward || d.faces[end.index()].forward {
        return Err(Refused("model/g8-inward-face"));
    }
    if d.faces[start.index()].loops.len() != 1 || d.faces[end.index()].loops.len() != 1 {
        return Err(Refused("model/g8-revolution-cap-loops"));
    }
    let start_uses = &d.loops[d.faces[start.index()].loops[0].index()].coedges;
    let end_uses = &d.loops[d.faces[end.index()].loops[0].index()].coedges;
    if start_uses.len() != end_uses.len() {
        return Err(Refused("model/g8-revolution-cap-pair"));
    }
    let ends = |c: CoedgeId| -> Result<[VertexId; 2]> {
        let co = &d.coedges[c.index()];
        let Bounds::Segment(v) = d.edges[co.edge.index()].bounds else {
            return Err(Refused("model/g8-revolution-cap-bounds"));
        };
        Ok(if co.forward { v } else { [v[1], v[0]] })
    };
    let mut profile = vec![];
    let mut accounted = BTreeSet::from([start, end]);
    let coords = |v: VertexId| d.vertices[v.index()].def.key().map(|k| k.coordinates());
    for &c in start_uses {
        let [av, bv] = ends(c)?;
        let (a, b) = (coords(av)?, coords(bv)?);
        let a = algebraic::rational(&a).ok_or(Refused("model/g8-revolution-meridian"))?;
        let b = algebraic::rational(&b).ok_or(Refused("model/g8-revolution-meridian"))?;
        if !a[1].is_zero() || !b[1].is_zero() || a[0].is_negative() || b[0].is_negative() {
            return Err(Refused("model/g8-revolution-meridian"));
        }
        profile.push([a[0].clone(), a[2].clone()]);
        let rotated = |p: &Point| [&cos * &p[0], &sin * &p[0], Radical::from(p[2].clone())];
        let (ta, tb) = (rotated(&a), rotated(&b));
        let paired = end_uses
            .iter()
            .filter_map(|&c| ends(c).ok().map(|v| (c, v)))
            .filter(|(_, v)| {
                coords(v[0]).ok() == Some(tb.clone()) && coords(v[1]).ok() == Some(ta.clone())
            })
            .map(|(c, _)| c)
            .collect::<Vec<_>>();
        if paired.len() != 1 {
            return Err(Refused("model/g8-revolution-cap-pair"));
        }
        let e0 = d.coedges[c.index()].edge;
        let e1 = d.coedges[paired[0].index()].edge;
        if a[0].is_zero() && b[0].is_zero() {
            if e0 != e1 {
                return Err(Refused("model/g8-revolution-axis-edge"));
            }
            continue;
        }
        let walls = d
            .faces
            .iter()
            .enumerate()
            .filter(|(i, face)| {
                *i != start.index() && *i != end.index() && face.loops.len() == 1 && {
                    let co = &d.loops[face.loops[0].index()].coedges;
                    co.iter().any(|c| d.coedges[c.index()].edge == e0)
                        && co.iter().any(|c| d.coedges[c.index()].edge == e1)
                }
            })
            .map(|(i, _)| FaceId(i as u32))
            .collect::<Vec<_>>();
        if walls.len() != 1 || !accounted.insert(walls[0]) {
            return Err(Refused("model/g8-revolution-wall-pair"));
        }
        let wall = &d.faces[walls[0].index()];
        let carrier = &d.surfaces[wall.surface.index()].carrier;
        let expected = if a[2] == b[2] {
            Carrier3::Plane(Plane3 {
                o: [q(0), q(0), a[2].clone()],
                x: [q(1), q(0), q(0)],
                n: [q(0), q(0), q(1)],
            })
        } else if a[0] == b[0] {
            Carrier3::Cylinder(Cylinder3::new(Frame::identity(), &a[0] * &a[0])?)
        } else {
            Carrier3::Cone(Cone3::new(
                Frame::identity(),
                [(a[2].clone(), a[0].clone()), (b[2].clone(), b[0].clone())],
            )?)
        };
        if carrier != &expected
            || wall.forward
                != if a[2] == b[2] {
                    b[0] < a[0]
                } else {
                    a[2] < b[2]
                }
        {
            return Err(Refused("model/g8-inward-face"));
        }
        let mut expected_edges = BTreeSet::from([e0, e1]);
        for (p, v, t) in [(&a, av, &ta), (&b, bv, &tb)] {
            if p[0].is_zero() {
                continue;
            }
            let found=d.edges.iter().enumerate().filter(|(_,e)| {
                let Bounds::Segment(vs)=e.bounds else{return false;};
                let matches=(vs[0]==v && coords(vs[1]).ok().as_ref()==Some(t)) || (vs[1]==v && coords(vs[0]).ok().as_ref()==Some(t));
                matches && matches!(&d.curves[e.curve.index()].geometry,Curve3::Circle(c) if c.frame().is_ok_and(|f| f.origin()==&[q(0),q(0),p[2].clone()]) && c.radius2()==&p[0]*&p[0])
            }).map(|(i,_)|EdgeId(i as u32)).collect::<Vec<_>>();
            if found.len() != 1 {
                return Err(Refused("model/g8-revolution-latitude-pair"));
            }
            expected_edges.insert(found[0]);
        }
        let actual = d.loops[wall.loops[0].index()]
            .coedges
            .iter()
            .map(|c| d.coedges[c.index()].edge)
            .collect::<BTreeSet<_>>();
        if actual != expected_edges {
            return Err(Refused("model/g8-revolution-wall-boundary"));
        }
    }
    if accounted.len() != d.faces.len() {
        return Err(Refused("model/g8-revolution-extra-face"));
    }
    // Recheck the recovered meridian independently of vertex admission. This
    // also excludes axis-crossing and contact polygons in mutated Models.
    super::revolution::revolution(Frame::identity(), Frame::identity(), &profile, 0)?;
    Ok(Some((profile, turn)))
}
pub(super) fn volumes6(d: &Draft) -> Result<Option<Vec<PiValue>>> {
    let Some((p, t)) = product(d)? else {
        return Ok(None);
    };
    let mut moment6 = q(0);
    for i in 0..p.len() {
        let (a, b) = (&p[i], &p[(i + 1) % p.len()]);
        moment6 += (&a[0] * &b[1] - &b[0] * &a[1]) * (&a[0] + &b[0]);
    }
    Ok(Some(vec![PiValue {
        rational: q(0),
        pi: q(2) * fraction(&t)? * moment6,
        pi2: q(0),
    }]))
}
/// Exact polygon cap area and lateral Q(sqrt) coefficient of pi. Refuse a
/// wider metric field rather than replacing an analytic wall by a mesh.
#[derive(Clone, Debug)]
pub struct Measures {
    /// Six times the construction-frame volume.
    pub volume6: PiValue,
    pub area_rational: Q,
    pub area_pi: Radical,
}
pub fn measures(model: &Model) -> Result<Measures> {
    let d = &model.draft;
    let Some((p, t)) = product(d)? else {
        return Err(Refused("revolve/partial-measures-source"));
    };
    wonky_curve::radical::guard(|| measures_product(&p, &t))
        .map_err(|_| Refused("revolve/metric-field-budget"))?
}
pub(super) fn measures_product(p: &[[Q; 2]], t: &Turn) -> Result<Measures> {
    let f = fraction(t)?;
    let m = angular_measures_product(p, t)?;
    Ok(Measures {
        volume6: PiValue {rational:q(0),pi:q(2)*&f*m.volume6_per_radian,pi2:q(0)},
        area_rational: m.cap_area,
        area_pi: m.lateral_area_per_radian*q(2)*f,
    })
}

impl Measures {
    /// Rational certified enclosure of the analytic area, without export.
    pub fn area_enclosure(&self) -> Result<(Q, Q)> {
        let v = self
            .area_pi
            .enclosure()
            .map_err(|_| Refused("revolve/metric-enclosure-budget"))?;
        let (lo, hi) = PiValue {
            rational: q(0),
            pi: q(1),
            pi2: q(0),
        }
        .enclosure(32)?;
        Ok((
            &self.area_rational + crate::binary64(v.lo())? * lo,
            &self.area_rational + crate::binary64(v.hi())? * hi,
        ))
    }
}

/// Exact angular product: volume6 = angle * volume6_per_radian and
/// area = cap_area + angle * lateral_area_per_radian. The angle retains its
/// construction witness; no rational multiple of pi is fabricated.
#[derive(Clone, Debug)]
pub struct AngularMeasures {
    pub angle: Turn,
    pub volume6_per_radian: Q,
    pub cap_area: Q,
    pub lateral_area_per_radian: Radical,
}
pub fn angular_measures(model: &Model) -> Result<AngularMeasures> {
    let Some((p, t)) = product(&model.draft)? else {
        return Err(Refused("revolve/partial-measures-source"));
    };
    angular_measures_product(&p, &t)
}
fn angular_measures_product(p: &[[Q; 2]], t: &Turn) -> Result<AngularMeasures> {
    wonky_curve::radical::guard(|| {
        let mut cap2 = q(0);
        let mut moment6 = q(0);
        let mut lateral = Radical::default();
        for i in 0..p.len() {
            let (a, b) = (&p[i], &p[(i + 1) % p.len()]);
            let wedge = &a[0] * &b[1] - &b[0] * &a[1];
            cap2 += &wedge;
            moment6 += wedge * (&a[0] + &b[0]);
            let (dr, dz) = (&b[0] - &a[0], &b[1] - &a[1]);
            let length = Radical::quadratic(q(0), q(1), &dr * &dr + &dz * &dz)
                .map_err(|_| Refused("revolve/metric-field-budget"))?;
            lateral = lateral + length * (&a[0] + &b[0]) / q(2);
        }
        Ok(AngularMeasures {
            angle: t.clone(),
            volume6_per_radian: moment6,
            cap_area: cap2,
            lateral_area_per_radian: lateral,
        })
    })
    .map_err(|_| Refused("revolve/metric-field-budget"))?
}
impl AngularMeasures {
    pub fn volume6_enclosure(&self, bits: usize) -> Result<(Q, Q)> {
        let a = self.angle.radians_enclosure(bits)?;
        Ok(wonky_curve::real::multiply(
            &a,
            &(
                self.volume6_per_radian.clone(),
                self.volume6_per_radian.clone(),
            ),
        ))
    }
    pub fn area_enclosure(&self, bits: usize) -> Result<(Q, Q)> {
        let a = self.angle.radians_enclosure(bits)?;
        let b = self
            .lateral_area_per_radian
            .enclosure()
            .map_err(|e| Refused(e.name()))?;
        let p =
            wonky_curve::real::multiply(&a, &(crate::binary64(b.lo())?, crate::binary64(b.hi())?));
        Ok((&self.cap_area + p.0, &self.cap_area + p.1))
    }
}
