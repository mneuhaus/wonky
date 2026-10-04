//! Exact analytic product caps with a separate chart for each circle segment.
//! A chord polygon and positive circular segments form an oriented 2-chain;
//! internal chord edges cancel. No circle centre is converted to Q.
use super::algebraic as a;
use super::translated::Translated;
use super::*;
use num_traits::{Signed, Zero};
use std::collections::BTreeMap;
use wonky_curve::{radical::Radical, Carrier, ExactPoint, Trimmed};
#[derive(Clone, Debug)]
pub struct SectionCircle {
    pub center: ExactPoint,
    pub radius2: Q,
    pub ccw: bool,
    /// Rational chart seed, excluded from geometric support identity.
    pub anchor: Option<[Q; 2]>,
}
impl PartialEq for SectionCircle {
    fn eq(&self, b: &Self) -> bool {
        self.center == b.center && self.radius2 == b.radius2 && self.ccw == b.ccw
    }
}
impl Eq for SectionCircle {}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SectionPiece {
    pub ends: [ExactPoint; 2],
    pub circle: Option<SectionCircle>,
}
fn no(s: &'static str) -> Refused {
    Refused(s)
}
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn zero() -> RPoint {
    std::array::from_fn(|_| Radical::default())
}
fn xyz(p: &ExactPoint, z: &Q) -> RPoint {
    let p = p.coordinates();
    [p[0].clone(), p[1].clone(), Radical::from(z.clone())]
}
impl SectionPiece {
    pub fn legacy(&self) -> Result<Trimmed> {
        match &self.circle {
            None => Trimmed::new(self.ends.clone(), Carrier::Line).map_err(|e| no(e.name())),
            Some(c) => {
                let center = c.center.rat().map_err(|e| no(e.name()))?.clone();
                let ring = if wonky_curve::numeric::exact_root(&c.radius2).is_none() {
                    if let Some(anchor) = &c.anchor {
                        Trimmed::ring_with_anchor(
                            center,
                            c.radius2.clone(),
                            self.ends[0].clone(),
                            c.ccw,
                            anchor.clone(),
                        )
                    } else {
                        Trimmed::ring(center, c.radius2.clone(), self.ends[0].clone(), c.ccw)
                    }
                } else {
                    Trimmed::ring(center, c.radius2.clone(), self.ends[0].clone(), c.ccw)
                };
                ring.and_then(|s| s.trim(self.ends[0].clone(), self.ends[1].clone()))
                    .map_err(|e| no(e.name()))
            }
        }
    }
    pub fn from_piece(s: &Trimmed) -> Result<Self> {
        Ok(Self {
            ends: s.ends().clone(),
            circle: match s.carrier() {
                Carrier::Line => None,
                Carrier::Circle(c) => Some(SectionCircle {
                    center: c.c.clone(),
                    radius2: c.r2.rational().ok_or(no("model/quadratic-extrusion/radius-class"))?,
                    ccw: c.ccw,
                    anchor: c.mid.rat().ok().cloned(),
                }),
                Carrier::BSpline(_) => {
                    return Err(no("model/quadratic-extrusion/spline-unsupported"))
                }
            },
        })
    }
    fn reversed(&self) -> Self {
        let mut p = self.clone();
        p.ends.swap(0, 1);
        if let Some(c) = &mut p.circle {
            c.ccw = !c.ccw;
        }
        p
    }
    fn local_arc(&self) -> Result<Trimmed> {
        let c = self
            .circle
            .as_ref()
            .ok_or(no("model/quadratic-extrusion/circle-required"))?;
        let ends = self
            .ends
            .each_ref()
            .map(|p| ExactPoint::from_coordinates(p.difference(&c.center)))
            .into_iter()
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| no(e.name()))?;
        Trimmed::ring([q(0), q(0)], c.radius2.clone(), ends[0].clone(), c.ccw)
            .and_then(|p| p.trim(ends[0].clone(), ends[1].clone()))
            .map_err(|e| no(e.name()))
    }
}
/// Local convexity and exactly one turn prove this closed boundary is convex
/// and embedded. Cardinal cuts retain exact circular arcs and permit major arcs.
fn convex(pieces: &[SectionPiece]) -> Result<()> {
    let mut tangents = vec![];
    for p in pieces {
        if let Some(c) = &p.circle {
            if !c.ccw {
                return Err(no("model/quadratic-extrusion/nonconvex-cap"));
            }
            let r = wonky_curve::numeric::exact_root(&c.radius2)
                .ok_or(no("model/quadratic-extrusion/radius"))?;
            let arc = p.local_arc()?;
            let mut cuts = arc.ends().to_vec();
            for v in [
                [r.clone(), q(0)],
                [q(0), r.clone()],
                [-r.clone(), q(0)],
                [q(0), -r],
            ] {
                let p = ExactPoint::from_rational(v);
                if arc.contains(&p).map_err(|e| no(e.name()))? {
                    cuts.push(p)
                }
            }
            for v in arc.sorted_cuts(cuts).map_err(|e| no(e.name()))? {
                let v = v.coordinates();
                tangents.push([-&v[1], v[0].clone()]);
            }
        } else {
            tangents.push(p.ends[1].difference(&p.ends[0]));
        }
    }
    let upper = |v: &[Radical; 2]| {
        v[1] > Radical::default() || (v[1].is_zero() && v[0] > Radical::default())
    };
    let mut turns = 0;
    for i in 0..tangents.len() {
        let (a, b) = (&tangents[i], &tangents[(i + 1) % tangents.len()]);
        let cross = wonky_curve::radical::cross(a, b);
        if a.iter().all(Radical::is_zero)
            || cross < Radical::default()
            || (cross.is_zero() && wonky_curve::radical::dot(a, b) <= Radical::default())
        {
            return Err(no("model/quadratic-extrusion/nonconvex-cap"));
        }
        if !upper(a) && upper(b) {
            turns += 1;
        }
    }
    if turns != 1 {
        return Err(no("model/quadratic-extrusion/cap-winding"));
    }
    Ok(())
}
fn axes(p: &SectionPiece) -> Result<[Point; 3]> {
    let arc = p.local_arc()?;
    let c = p.circle.as_ref().unwrap();
    let r = wonky_curve::numeric::exact_root(&c.radius2).unwrap();
    for x in [
        [q(1), q(0), q(0)],
        [q(0), q(1), q(0)],
        [-q(1), q(0), q(0)],
        [q(0), -q(1), q(0)],
    ] {
        let pole = ExactPoint::from_rational([-&r * &x[0], -&r * &x[1]]);
        if !arc.contains(&pole).map_err(|e| no(e.name()))? {
            let y = [-&x[1], x[0].clone(), q(0)];
            return Ok([x, y, [q(0), q(0), q(1)]]);
        }
    }
    Err(no("model/quadratic-extrusion/chart-pole"))
}
fn circle(p: &SectionPiece, z: &Q, cols: [Point; 3]) -> Result<Curve3> {
    let c = p.circle.as_ref().unwrap();
    let o = xyz(&c.center, z);
    if let Some(o) = a::rational(&o) {
        Ok(Curve3::Circle(Circle3::new(
            Frame::new(o, cols)?,
            c.radius2.clone(),
        )?))
    } else {
        Ok(Curve3::TranslatedCircle(Translated {
            base: Circle3::new(Frame::new(crate::zero(), cols)?, c.radius2.clone())?,
            offset: o,
        }))
    }
}
fn cylinder(p: &SectionPiece, cols: [Point; 3]) -> Result<Carrier3> {
    let c = p.circle.as_ref().unwrap();
    let o = xyz(&c.center, &q(0));
    if let Some(o) = a::rational(&o) {
        Ok(Carrier3::Cylinder(Cylinder3::new(
            Frame::new(o, cols)?,
            c.radius2.clone(),
        )?))
    } else {
        Ok(Carrier3::TranslatedCylinder(Translated {
            base: Cylinder3::new(Frame::new(crate::zero(), cols)?, c.radius2.clone())?,
            offset: o,
        }))
    }
}
pub fn chart(c: &Carrier3, p: &VertexKey) -> Result<ExactPoint> {
    let (v, r) = match c {
        Carrier3::Cylinder(c) => (
            QuadraticPoint3::from_coordinates(p.coordinates())?
                .mapped(&c.frame()?.inverse())?
                .coordinates()
                .clone(),
            c.radius2(),
        ),
        Carrier3::TranslatedCylinder(c) => (c.coordinates(p)?, c.base.radius2()),
        _ => return c.exact_plane()?.chart(&p.coordinates()),
    };
    let r = Radical::from(
        wonky_curve::numeric::exact_root(&r).ok_or(no("model/quadratic-extrusion/radius"))?,
    );
    if &r + &v[0] <= Radical::default() {
        return Err(no("model/quadratic-extrusion/chart-pole"));
    }
    ExactPoint::from_coordinates([&v[1] / (&r + &v[0]), v[2].clone()]).map_err(|e| no(e.name()))
}
fn add_face(
    d: &mut Draft,
    carrier: Carrier3,
    forward: bool,
    uses: Vec<(usize, bool)>,
    prov: Provenance,
) -> Result<()> {
    let mut coedges = vec![];
    for (ei, fwd) in uses {
        let e = &d.edges[ei];
        let Bounds::Segment(mut v) = e.bounds else {
            return Err(no("model/quadratic-extrusion/ring"));
        };
        if !fwd {
            v.swap(0, 1);
        }
        let keys = v
            .map(|v| d.vertices[v.index()].def.key())
            .into_iter()
            .collect::<Result<Vec<_>>>()?;
        let ends = keys
            .iter()
            .map(|v| chart(&carrier, v))
            .collect::<Result<Vec<_>>>()?;
        let pcurve = if matches!(carrier, Carrier3::Plane(_) | Carrier3::RadicalPlane(_)) {
            let plane = carrier.exact_plane()?;
            let ring = match &d.curves[e.curve.index()].geometry {
                Curve3::Circle(c) => Some(
                    Translated {
                        base: c.clone(),
                        offset: zero(),
                    }
                    .plane_ring(&plane, fwd)?,
                ),
                Curve3::TranslatedCircle(c) => Some(c.plane_ring(&plane, fwd)?),
                Curve3::RadicalCircle(_) => return Err(no("model/quadratic-extrusion/radical-circle-unavailable")),
                Curve3::Line { .. } | Curve3::RadicalLine { .. } => None,
            };
            if let Some(s) = ring {
                s.trim(ends[0].clone(), ends[1].clone())
                    .map_err(|e| no(e.name()))?
            } else {
                Trimmed::new([ends[0].clone(), ends[1].clone()], Carrier::Line)
                    .map_err(|e| no(e.name()))?
            }
        } else {
            Trimmed::new([ends[0].clone(), ends[1].clone()], Carrier::Line)
                .map_err(|e| no(e.name()))?
        };
        coedges.push(CoedgeId(d.coedges.len() as u32));
        d.coedges.push(Coedge {
            edge: EdgeId(ei as u32),
            forward: fwd,
            pcurve,
            atlas: None,
            provenance: prov,
        });
    }
    let l = LoopId(d.loops.len() as u32);
    d.loops.push(Loop {
        coedges,
        provenance: prov,
    });
    let s = SurfaceId(d.surfaces.len() as u32);
    d.surfaces.push(Surface {
        carrier,
        provenance: prov,
    });
    d.faces.push(Face {
        surface: s,
        forward,
        loops: vec![l],
        provenance: prov,
    });
    Ok(())
}
/// Subdivide only when every available half-angle pole lies on a major arc.
/// The cuts are exact cardinal contacts; each piece remains an analytic arc.
fn chart_partition(pieces: &[SectionPiece]) -> Result<Vec<SectionPiece>> {
    let mut out = vec![];
    for piece in pieces {
        let Some(c) = &piece.circle else {
            out.push(piece.clone());
            continue;
        };
        match axes(piece) {
            Ok(_) => {
                out.push(piece.clone());
                continue;
            }
            Err(e) if e.0 == "model/quadratic-extrusion/chart-pole" => {}
            Err(e) => return Err(e),
        }
        let arc = piece.local_arc()?;
        let r = wonky_curve::numeric::exact_root(&c.radius2)
            .ok_or(no("model/quadratic-extrusion/radius"))?;
        let mut cuts = arc.ends().to_vec();
        for v in [
            [r.clone(), q(0)],
            [q(0), r.clone()],
            [-r.clone(), q(0)],
            [q(0), -r],
        ] {
            let p = ExactPoint::from_rational(v);
            if arc.contains(&p).map_err(|e| no(e.name()))? {
                cuts.push(p);
            }
        }
        let cuts = arc.sorted_cuts(cuts).map_err(|e| no(e.name()))?;
        for pair in cuts.windows(2) {
            let ends = pair
                .iter()
                .map(|p| {
                    let a = p.coordinates();
                    let b = c.center.coordinates();
                    ExactPoint::from_coordinates([&a[0] + &b[0], &a[1] + &b[1]])
                        .map_err(|e| no(e.name()))
                })
                .collect::<Result<Vec<_>>>()?;
            let p = SectionPiece {
                ends: [ends[0].clone(), ends[1].clone()],
                circle: Some(c.clone()),
            };
            axes(&p)?;
            out.push(p);
        }
    }
    Ok(out)
}
/// The algebraic branch admits a convex cap partition, not a tessellation.
/// Rational sections keep the existing single-cap construction and topology.
pub fn profile(
    placement: Frame,
    label: Label,
    node: u32,
    pieces: &[SectionPiece],
    levels: [Q; 2],
) -> Result<Draft> {
    if pieces.is_empty() || levels[0] >= levels[1] {
        return Err(no("model/extrusion-levels"));
    }
    if pieces
        .iter()
        .all(|p| p.circle.as_ref().is_none_or(|c| c.center.rat().is_ok()))
    {
        return super::extrusion::profile(
            placement,
            label,
            node,
            &pieces
                .iter()
                .map(SectionPiece::legacy)
                .collect::<Result<Vec<_>>>()?,
            levels,
        );
    }
    convex(pieces)?;
    let normalized = chart_partition(pieces)?;
    let pieces = normalized.as_slice();
    let n = pieces.len();
    let prov = Provenance { node, slot: 0 };
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
    for z in &levels {
        for p in pieces {
            d.vertices.push(Vertex {
                def: VertexDef::Quadratic(QuadraticPoint3::from_coordinates(xyz(&p.ends[0], z))?),
                provenance: prov,
            });
        }
    }
    let cols = pieces
        .iter()
        .map(|p| {
            if p.circle.is_some() {
                axes(p).map(Some)
            } else {
                Ok(None)
            }
        })
        .collect::<Result<Vec<_>>>()?;
    let mut originals = [vec![], vec![]];
    let mut chords = [vec![], vec![]];
    for (k, z) in levels.iter().enumerate() {
        for (i, p) in pieces.iter().enumerate() {
            let a = xyz(&p.ends[0], z);
            let b = xyz(&p.ends[1], z);
            let curve = if let Some(cols) = &cols[i] {
                circle(p, z, cols.clone())?
            } else {
                a::line(a.clone(), a::sub(&b, &a))
            };
            let cid = CurveId(d.curves.len() as u32);
            d.curves.push(Curve {
                geometry: curve,
                provenance: prov,
            });
            let ei = d.edges.len();
            d.edges.push(Edge {
                curve: cid,
                bounds: Bounds::Segment([
                    VertexId((k * n + i) as u32),
                    VertexId((k * n + (i + 1) % n) as u32),
                ]),
                provenance: prov,
            });
            originals[k].push(ei);
            if p.circle.is_some() {
                let cid = CurveId(d.curves.len() as u32);
                d.curves.push(Curve {
                    geometry: a::line(a.clone(), a::sub(&b, &a)),
                    provenance: prov,
                });
                let ei = d.edges.len();
                d.edges.push(Edge {
                    curve: cid,
                    bounds: Bounds::Segment([
                        VertexId((k * n + i) as u32),
                        VertexId((k * n + (i + 1) % n) as u32),
                    ]),
                    provenance: prov,
                });
                chords[k].push(ei);
            } else {
                chords[k].push(ei);
            }
        }
    }
    let mut generators = vec![];
    for (i, p) in pieces.iter().enumerate() {
        let cid = CurveId(d.curves.len() as u32);
        d.curves.push(Curve {
            geometry: a::line(
                xyz(&p.ends[0], &levels[0]),
                [
                    Radical::default(),
                    Radical::default(),
                    Radical::from(&levels[1] - &levels[0]),
                ],
            ),
            provenance: prov,
        });
        let ei = d.edges.len();
        d.edges.push(Edge {
            curve: cid,
            bounds: Bounds::Segment([VertexId(i as u32), VertexId((n + i) as u32)]),
            provenance: prov,
        });
        generators.push(ei);
    }
    for k in 0..2 {
        let uses = if k == 1 {
            chords[k].iter().map(|e| (*e, true)).collect()
        } else {
            chords[k].iter().rev().map(|e| (*e, false)).collect()
        };
        add_face(
            &mut d,
            Carrier3::Plane(Plane3 {
                o: [q(0), q(0), levels[k].clone()],
                x: [q(1), q(0), q(0)],
                n: [q(0), q(0), q(1)],
            }),
            k == 1,
            uses,
            prov,
        )?;
        for (i, p) in pieces.iter().enumerate() {
            if let Some(c) = &p.circle {
                let plane = RadicalPlane3 {
                    o: xyz(&c.center, &levels[k]),
                    x: a::lift(&[q(1), q(0), q(0)]),
                    n: a::lift(&[q(0), q(0), q(1)]),
                };
                add_face(
                    &mut d,
                    plane.carrier(),
                    k == 1,
                    vec![(originals[k][i], k == 1), (chords[k][i], k == 0)],
                    prov,
                )?;
            }
        }
    }
    for (i, p) in pieces.iter().enumerate() {
        let carrier = if let Some(cols) = &cols[i] {
            cylinder(p, cols.clone())?
        } else {
            let a = xyz(&p.ends[0], &levels[0]);
            let t = a::sub(&xyz(&p.ends[1], &levels[0]), &a);
            let n = a::cross(&t, &a::lift(&[q(0), q(0), q(1)]));
            RadicalPlane3 { o: a, x: t, n }.carrier()
        };
        add_face(
            &mut d,
            carrier,
            true,
            vec![
                (originals[0][i], true),
                (generators[(i + 1) % n], true),
                (originals[1][i], false),
                (generators[i], false),
            ],
            prov,
        )?;
    }
    d.shells.push(Shell {
        faces: (0..d.faces.len()).map(|i| FaceId(i as u32)).collect(),
        provenance: prov,
    });
    d.solids.push(Solid {
        shells: vec![ShellId(0)],
        provenance: prov,
    });
    Ok(d)
}
fn circle_data(c: &Curve3) -> Result<(RPoint, &Frame, Q)> {
    match c {
        Curve3::Circle(c) => Ok((c.origin(), c.frame()?, c.radius2())),
        Curve3::TranslatedCircle(c) => Ok((c.center(), c.base.frame()?, c.base.radius2())),
        _ => Err(no("model/quadratic-extrusion/circle-required")),
    }
}
pub(super) fn strip(d: &Draft, f: FaceId) -> bool {
    matches!(
        d.surfaces[d.faces[f.index()].surface.index()].carrier,
        Carrier3::TranslatedCylinder(_)
    )
}
pub(super) fn chart_audit(d: &Draft, fi: FaceId) -> Result<()> {
    let f = &d.faces[fi.index()];
    let carrier = &d.surfaces[f.surface.index()].carrier;
    if f.loops.len() != 1 || d.loops[f.loops[0].index()].coedges.len() != 4 {
        return Err(no("model/quadratic-extrusion/stripe-loop"));
    }
    for ci in &d.loops[f.loops[0].index()].coedges {
        let co = &d.coedges[ci.index()];
        if co.atlas.is_some() || !matches!(co.pcurve.carrier(), Carrier::Line) {
            return Err(no("model/g3-cylinder-chart"));
        }
        let e = &d.edges[co.edge.index()];
        let Bounds::Segment(mut v) = e.bounds else {
            return Err(no("model/g3-cylinder-bounds"));
        };
        if !co.forward {
            v.swap(0, 1);
        }
        let aa = chart(carrier, &d.vertices[v[0].index()].def.key()?)?;
        let bb = chart(carrier, &d.vertices[v[1].index()].def.key()?)?;
        if co.pcurve.ends() != &[aa.clone(), bb.clone()] {
            return Err(no("model/g3-pcurve-identity"));
        }
        let (aa, bb) = (aa.coordinates(), bb.coordinates());
        match &d.curves[e.curve.index()].geometry {
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                if aa[0] != bb[0] {
                    return Err(no("model/g3-cylinder-line-chart"));
                }
            }
            Curve3::RadicalCircle(_) => return Err(no("model/quadratic-extrusion/radical-circle-unavailable")),
            c @ (Curve3::Circle(_) | Curve3::TranslatedCircle(_)) => {
                if aa[1] != bb[1] {
                    return Err(no("model/g3-cylinder-circle-chart"));
                }
                let (_, frame, _) = circle_data(c)?;
                let cols = frame.columns();
                if !cols[0][2].is_zero() || !cols[1][2].is_zero() {
                    return Err(no("model/g3-cylinder-circle-latitude"));
                }
                let positive =
                    (&cols[0][0] * &cols[1][1] - &cols[0][1] * &cols[1][0]).is_positive();
                if (bb[0] > aa[0]) != (co.forward == positive) {
                    return Err(no("model/g3-cylinder-circle-sense"));
                }
            }
        }
    }
    Ok(())
}
fn cap_boundary(
    d: &Draft,
    faces: &[FaceId],
    z: &Q,
    reverse: bool,
) -> Result<(Vec<SectionPiece>, Vec<EdgeId>)> {
    let mut uses: BTreeMap<EdgeId, Vec<CoedgeId>> = BTreeMap::new();
    for fi in faces {
        for l in &d.faces[fi.index()].loops {
            for ci in &d.loops[l.index()].coedges {
                uses.entry(d.coedges[ci.index()].edge)
                    .or_default()
                    .push(*ci);
            }
        }
    }
    let mut outer = vec![];
    for cs in uses.values() {
        match cs.as_slice() {
            [c] => outer.push(*c),
            [a, b] if d.coedges[a.index()].forward != d.coedges[b.index()].forward => {}
            _ => return Err(no("model/quadratic-extrusion/cap-chain")),
        }
    }
    let ends = |ci: CoedgeId| -> Result<[VertexId; 2]> {
        let co = &d.coedges[ci.index()];
        let Bounds::Segment(mut v) = d.edges[co.edge.index()].bounds else {
            return Err(no("model/quadratic-extrusion/cap-ring"));
        };
        if !co.forward {
            v.swap(0, 1);
        }
        Ok(v)
    };
    let mut ordered = vec![];
    let first = *outer
        .first()
        .ok_or(no("model/quadratic-extrusion/empty-cap"))?;
    let start = ends(first)?[0];
    let mut at = start;
    while !outer.is_empty() {
        let matches = outer
            .iter()
            .enumerate()
            .map(|(i, c)| ends(*c).map(|v| (i, *c, v)))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .filter(|(_, _, v)| v[0] == at)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(no("model/quadratic-extrusion/cap-branch"));
        }
        let (i, c, v) = matches[0];
        outer.remove(i);
        ordered.push(c);
        at = v[1];
        if at == start && !outer.is_empty() {
            return Err(no("model/quadratic-extrusion/multiple-cap-loops"));
        }
    }
    if at != start {
        return Err(no("model/quadratic-extrusion/open-cap"));
    }
    let mut pieces = vec![];
    let mut edges = vec![];
    for ci in ordered {
        let co = &d.coedges[ci.index()];
        let e = &d.edges[co.edge.index()];
        let v = ends(ci)?;
        let xyz = v
            .map(|v| d.vertices[v.index()].def.key().map(|p| p.coordinates()))
            .into_iter()
            .collect::<Result<Vec<_>>>()?;
        if xyz.iter().any(|p| p[2] != Radical::from(z.clone())) {
            return Err(no("model/quadratic-extrusion/cap-level"));
        }
        let ends = [
            ExactPoint::from_coordinates([xyz[0][0].clone(), xyz[0][1].clone()]),
            ExactPoint::from_coordinates([xyz[1][0].clone(), xyz[1][1].clone()]),
        ]
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| no(e.name()))?;
        let circle = match &d.curves[e.curve.index()].geometry {
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => None,
            Curve3::RadicalCircle(_) => return Err(no("model/quadratic-extrusion/radical-circle-unavailable")),
            c @ (Curve3::Circle(_) | Curve3::TranslatedCircle(_)) => {
                let (center, frame, r2) = circle_data(c)?;
                if !frame.is_isometry()
                    || !frame.columns()[0][2].is_zero()
                    || !frame.columns()[1][2].is_zero()
                    || center[2] != Radical::from(z.clone())
                {
                    return Err(no("model/quadratic-extrusion/cap-circle-metric"));
                }
                let positive = (&frame.columns()[0][0] * &frame.columns()[1][1]
                    - &frame.columns()[0][1] * &frame.columns()[1][0])
                    .is_positive();
                Some(SectionCircle {
                    center: ExactPoint::from_coordinates([center[0].clone(), center[1].clone()])
                        .map_err(|e| no(e.name()))?,
                    radius2: r2,
                    anchor: None,
                    ccw: co.forward == positive,
                })
            }
        };
        pieces.push(SectionPiece {
            ends: [ends[0].clone(), ends[1].clone()],
            circle,
        });
        edges.push(co.edge);
    }
    if reverse {
        pieces = pieces.into_iter().rev().map(|p| p.reversed()).collect();
        edges.reverse();
    }
    Ok((pieces, edges))
}
/// G8 product proof for an analytic cap partition. Positive simple face charts
/// and cancellation of every internal cap edge imply multiplicity one inside
/// the convex outer boundary. Every exterior cap edge has exactly one wall.
pub(super) fn outward(d: &Draft) -> Result<bool> {
    if !d
        .surfaces
        .iter()
        .any(|s| matches!(s.carrier, Carrier3::TranslatedCylinder(_)))
    {
        return Ok(false);
    }
    if d.shells.len() != 1 || d.solids.len() != 1 {
        return Err(no("model/quadratic-extrusion/single-shell"));
    }
    let mut caps: BTreeMap<Q, Vec<FaceId>> = BTreeMap::new();
    let mut walls = vec![];
    for (i, f) in d.faces.iter().enumerate() {
        let fi = FaceId(i as u32);
        let carrier = &d.surfaces[f.surface.index()].carrier;
        if matches!(carrier, Carrier3::Plane(_) | Carrier3::RadicalPlane(_)) {
            let p = carrier.exact_plane()?;
            if p.n[0].is_zero() && p.n[1].is_zero() {
                let z = (&a::dot(&p.n, &p.o) / &p.n[2])
                    .rational()
                    .ok_or(no("model/quadratic-extrusion/algebraic-level"))?;
                caps.entry(z).or_default().push(fi);
                continue;
            }
            if !p.n[2].is_zero() {
                return Err(no("model/quadratic-extrusion/oblique-wall"));
            }
        } else {
            let frame = match carrier {
                Carrier3::Cylinder(c) => c.frame()?,
                Carrier3::TranslatedCylinder(c) => c.base.frame()?,
                _ => return Err(no("model/quadratic-extrusion/wall-carrier")),
            };
            if !frame.is_isometry() || frame.columns()[2] != [q(0), q(0), q(1)] {
                return Err(no("model/quadratic-extrusion/wall-axis"));
            }
        }
        walls.push(fi);
    }
    if caps.len() != 2 {
        return Err(no("model/quadratic-extrusion/two-levels"));
    }
    let levels = caps.keys().cloned().collect::<Vec<_>>();
    let mut boundaries = vec![];
    let mut exterior = BTreeMap::new();
    for (k, z) in levels.iter().enumerate() {
        for fi in &caps[z] {
            let f = &d.faces[fi.index()];
            let p = d.surfaces[f.surface.index()].carrier.exact_plane()?;
            if (p.n[2].is_positive() == f.forward) != (k == 1) {
                return Err(no("model/g8-inward-face"));
            }
        }
        let (p, edges) = cap_boundary(d, &caps[z], z, k == 0)?;
        convex(&p)?;
        for e in edges {
            exterior.insert(e, k);
        }
        boundaries.push(p);
    }
    let (a, b) = (&boundaries[0], &boundaries[1]);
    if a.len() != b.len()
        || !(0..a.len()).any(|k| {
            a.iter()
                .enumerate()
                .all(|(i, p)| p == &b[(i + k) % b.len()])
        })
    {
        return Err(no("model/quadratic-extrusion/caps-differ"));
    }
    let mut covered = BTreeMap::new();
    for fi in walls {
        let f = &d.faces[fi.index()];
        if f.loops.len() != 1 || d.loops[f.loops[0].index()].coedges.len() != 4 {
            return Err(no("model/quadratic-extrusion/wall-loop"));
        }
        let mut counts = [0, 0];
        for ci in &d.loops[f.loops[0].index()].coedges {
            let e = d.coedges[ci.index()].edge;
            if let Some(k) = exterior.get(&e) {
                counts[*k] += 1;
                if covered.insert(e, fi).is_some() {
                    return Err(no("model/quadratic-extrusion/wall-overlap"));
                }
            } else {
                let Bounds::Segment(v) = d.edges[e.index()].bounds else {
                    return Err(no("model/quadratic-extrusion/generator-ring"));
                };
                let p = v
                    .map(|v| d.vertices[v.index()].def.key().map(|k| k.coordinates()))
                    .into_iter()
                    .collect::<Result<Vec<_>>>()?;
                if p[0][0] != p[1][0]
                    || p[0][1] != p[1][1]
                    || !((p[0][2] == levels[0] && p[1][2] == levels[1])
                        || (p[0][2] == levels[1] && p[1][2] == levels[0]))
                {
                    return Err(no("model/quadratic-extrusion/generator"));
                }
            }
        }
        if counts != [1, 1] {
            return Err(no("model/quadratic-extrusion/wall-cap-pair"));
        }
    }
    if covered.len() != exterior.len() {
        return Err(no("model/quadratic-extrusion/missing-wall"));
    }
    Ok(true)
}
