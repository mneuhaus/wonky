//! Exact line/circle profile extrusions and their shared chart admission.
//! Half-angle cylinder charts own no seam topology. The outward proof uses
//! paired caps and bijective generator walls, not a source-family label.
use super::*;
use num_traits::{Signed, Zero};
use std::collections::BTreeMap;
use wonky_curve::radical::Radical;
use wonky_curve::{Carrier, Chart, Cycle, ExactPoint, Trimmed};
fn no(s: &'static str) -> Refused {
    Refused(s)
}
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn ep(p: [Q; 2]) -> ExactPoint {
    ExactPoint::from_rational(p)
}
/// Build an analytic extrusion in its own orthonormal construction chart.
/// Full circular holes can be attached by the existing bore-trim mechanism.
pub fn profile(
    placement: Frame,
    label: Label,
    node: u32,
    pieces: &[Trimmed],
    levels: [Q; 2],
) -> Result<Draft> {
    if pieces.is_empty() || levels[0] >= levels[1] {
        return Err(no("model/extrusion-levels"));
    }
    // Partition only at exact rational quadrant contacts. Every resulting
    // cylinder chart has a pole outside its closed trim, even for major arcs
    // and quadratic springs. These are analytic arcs, not an approximation.
    let mut normalized = Vec::new();
    for piece in pieces {
        if piece.is_ring() { return Err(no("model/extrusion-ring-outer-profile")); }
        if let Some((c, cc)) = match piece.chart() { Chart::Circle(c) => c.c.rat().ok().map(|cc| (c, cc)), _ => None } {
            let r2 = c.r2.rational().ok_or(no("model/extrusion-radius"))?;
            let mid = c.mid.rat().ok();
            let radial = if let Some(r)=wonky_curve::numeric::exact_root(&r2) {[r,q(0)]}
                else {
                    let m = mid.ok_or(no("model/extrusion-anchor-incidence"))?;
                    [&m[0]-&cc[0],&m[1]-&cc[1]]
                };
            if &radial[0]*&radial[0]+&radial[1]*&radial[1]!=r2 {return Err(no("model/extrusion-anchor-incidence"));}
            let [x,y]=radial;
            let anchors = [[&cc[0]+&x,&cc[1]+&y],[&cc[0]-&y,&cc[1]+&x],
                [&cc[0]-&x,&cc[1]-&y],[&cc[0]+&y,&cc[1]-&x]];
            // The first rational anchor (start, mid, quadrant) whose chart
            // pole lies outside the closed trim frames the arc.
            let framed = |trim: &Trimmed, start: &ExactPoint| -> Result<Option<Trimmed>> {
                let mut choices = vec![];
                if let Ok(p) = start.rat() { choices.push(p.clone()); }
                choices.extend(mid.cloned());
                choices.extend(anchors.iter().cloned());
                let Carrier::Circle(mut carrier) = trim.carrier().clone() else { unreachable!() };
                for a in choices {
                    let pole = ep([q(2)*&cc[0]-&a[0], q(2)*&cc[1]-&a[1]]);
                    if !trim.contains(&pole).map_err(|e| no(e.name()))? {
                        carrier.mid = ep(a);
                        return Ok(Some(Trimmed::new([trim.ends()[0].clone(),trim.ends()[1].clone()],Carrier::Circle(carrier)).map_err(|e| no(e.name()))?));
                    }
                }
                Ok(None)
            };
            // An arc with such an anchor stays one edge (a half arc keeps the
            // wire's topology); only an arc without one is partitioned.
            if let Some(whole) = framed(piece, &piece.ends()[0])? { normalized.push(whole); continue; }
            let mut cuts = piece.ends().to_vec();
            let a = piece.ends()[0].difference_rational(cc);
            let b = piece.ends()[1].difference_rational(cc);
            let turn = wonky_curve::radical::cross(&a,&b);
            if turn.is_zero() || turn.is_positive() != c.ccw {
                for anchor in &anchors {
                    let p = ep(anchor.clone());
                    if piece.contains(&p).map_err(|e| no(e.name()))? { cuts.push(p); }
                }
            }
            let cuts = piece.sorted_cuts(cuts).map_err(|e| no(e.name()))?;
            for ends in cuts.windows(2) {
                let trim = piece.trim(ends[0].clone(),ends[1].clone()).map_err(|e| no(e.name()))?;
                normalized.push(framed(&trim, &ends[0])?.ok_or(no("model/extrusion-chart-pole"))?);
            }
        } else { normalized.push(piece.clone()); }
    }
    let pieces = normalized.as_slice();
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
    let prov = Provenance { node, slot: 0 };
    let n = pieces.len();
    for z in &levels {
        for s in pieces {
            let xy = s.ends()[0].coordinates();
            d.vertices.push(Vertex {
                def: VertexDef::Radical([xy[0].clone(), xy[1].clone(), Radical::from(z.clone())]),
                provenance: prov,
            });
        }
    }
    let mut circles = Vec::new();
    for s in pieces {
        if s.is_ring() {
            return Err(no("model/extrusion-ring-outer-profile"));
        }
        let c = match s.chart() {
            Chart::Line => None,
            // A radical centre has no rational radial anchor; rational centres
            // (also with quadratic springs) were anchored by the partition above.
            Chart::Circle(c) if c.c.rat().is_err() => {
                let centre = c.c.coordinates();
                Some((
                    [centre[0].clone(), centre[1].clone(), Radical::default()],
                    radical_axes(s, c)?,
                    c.r2.rational().ok_or(no("model/extrusion-radius"))?,
                    c.ccw,
                ))
            }
            Chart::Circle(c) => {
                // A rational radial anchor scales a unit prototype exactly.
                // Its physical radius may be irrational; no unit normal is rounded.
                let r2 = c.r2.rational().ok_or(no("model/extrusion-radius"))?;
                let (scale,radius2)=if let Some(r)=wonky_curve::numeric::exact_root(&r2) {(r,r2)}
                    else {(q(1),q(1))};
                let centre = c.c.rat().map_err(|e| no(e.name()))?;
                let a = c.mid.rat().map_err(|e| no(e.name()))?;
                let x = [(&a[0] - &centre[0]) / &scale, (&a[1] - &centre[1]) / &scale, q(0)];
                let y = [-x[1].clone(), x[0].clone(), q(0)];
                Some((
                    [centre[0].clone(), centre[1].clone(), q(0)].map(Radical::from),
                    [x, y, [q(0), q(0), q(1)]],
                    radius2,
                    c.ccw,
                ))
            }
            Chart::BSpline(_) => return Err(no("model/extrusion-spline-unavailable")),
        };
        circles.push(c);
    }
    for (k, z) in levels.iter().enumerate() {
        for (i, s) in pieces.iter().enumerate() {
            let geometry = if let Some((origin, columns, r2, ccw)) = &circles[i] {
                let mut o = origin.clone();
                o[2] = Radical::from(z.clone());
                let mut cols = columns.clone();
                if !ccw {
                    cols[1] = cols[1].clone().map(|v| -v);
                }
                Curve3::Circle(Circle3::about(o, cols, r2.clone())?)
            } else {
                let a = s.ends()[0].coordinates();
                let b = s.ends()[1].coordinates();
                Curve3::RadicalLine {
                    p: [a[0].clone(), a[1].clone(), Radical::from(z.clone())],
                    d: [&b[0] - &a[0], &b[1] - &a[1], Radical::default()],
                }
            };
            d.curves.push(Curve {
                geometry,
                provenance: prov,
            });
            d.edges.push(Edge {
                curve: CurveId((k * n + i) as u32),
                bounds: Bounds::Segment([
                    VertexId((k * n + i) as u32),
                    VertexId((k * n + (i + 1) % n) as u32),
                ]),
                provenance: prov,
            });
        }
    }
    for (i, s) in pieces.iter().enumerate() {
        let a = s.ends()[0].coordinates();
        d.curves.push(Curve {
            geometry: Curve3::RadicalLine {
                p: [a[0].clone(), a[1].clone(), Radical::from(levels[0].clone())],
                d: [
                    Radical::default(),
                    Radical::default(),
                    Radical::from(&levels[1] - &levels[0]),
                ],
            },
            provenance: prov,
        });
        d.edges.push(Edge {
            curve: CurveId((2 * n + i) as u32),
            bounds: Bounds::Segment([VertexId(i as u32), VertexId((n + i) as u32)]),
            provenance: prov,
        });
    }
    for k in 0..2 {
        let pl = Plane3 {
            o: [q(0), q(0), levels[k].clone()],
            x: [q(1), q(0), q(0)],
            n: [q(0), q(0), q(1)],
        };
        let face = FaceId(d.faces.len() as u32);
        let surface = SurfaceId(d.surfaces.len() as u32);
        d.surfaces.push(Surface {
            carrier: Carrier3::Plane(pl),
            provenance: prov,
        });
        let mut coedges = Vec::new();
        let order: Vec<_> = if k == 0 {
            (0..n).rev().collect()
        } else {
            (0..n).collect()
        };
        for i in order {
            coedges.push(CoedgeId(d.coedges.len() as u32));
            d.coedges.push(Coedge {
                edge: EdgeId((k * n + i) as u32),
                forward: k == 1,
                pcurve: if k == 0 {
                    pieces[i].reversed()
                } else {
                    pieces[i].clone()
                },
                atlas: None,
                provenance: prov,
            });
        }
        let lp = LoopId(d.loops.len() as u32);
        d.loops.push(Loop {
            coedges,
            provenance: prov,
        });
        d.faces.push(Face {
            surface,
            forward: k == 1,
            loops: vec![lp],
            provenance: prov,
        });
        let _ = face;
    }
    for (i, s) in pieces.iter().enumerate() {
        let (carrier, forward) = if let Some((origin, columns, r2, ccw)) = &circles[i] {
            (
                Carrier3::Cylinder(Cylinder3::about(origin.clone(), columns.clone(), r2.clone())?),
                *ccw,
            )
        } else if let (Ok(a), Ok(b)) = (s.ends()[0].rat(), s.ends()[1].rat()) {
            let t = [&b[0] - &a[0], &b[1] - &a[1], q(0)];
            let normal = cross(&t, &[q(0), q(0), q(1)]);
            (
                Carrier3::Plane(Plane3 {
                    o: [a[0].clone(), a[1].clone(), levels[0].clone()],
                    x: t,
                    n: normal,
                }),
                true,
            )
        } else if let Ok((o, mut t)) = s.rational_line() {
            // Quadratic ends on a rational support (a sloped face trimmed at
            // its spring line): the wall is that rational plane, directed
            // from the first end to the second.
            let chord = s.ends()[1].difference(&s.ends()[0]);
            if (&chord[0] * &t[0] + &chord[1] * &t[1]).is_negative() {
                t = t.map(|v| -v);
            }
            let t = [t[0].clone(), t[1].clone(), q(0)];
            let normal = cross(&t, &[q(0), q(0), q(1)]);
            (
                Carrier3::Plane(Plane3 {
                    o: [o[0].clone(), o[1].clone(), levels[0].clone()],
                    x: t,
                    n: normal,
                }),
                true,
            )
        } else {
            // Quadratic ends without a rational support: the exact wall
            // through both ends in their field.
            let a = s.ends()[0].coordinates();
            let b = s.ends()[1].coordinates();
            let t = [&b[0] - &a[0], &b[1] - &a[1], Radical::default()];
            let normal = algebraic::cross(&t, &algebraic::lift(&[q(0), q(0), q(1)]));
            (
                RadicalPlane3 {
                    o: [a[0].clone(), a[1].clone(), Radical::from(levels[0].clone())],
                    x: t,
                    n: normal,
                }.carrier(),
                true,
            )
        };
        let surface = SurfaceId(d.surfaces.len() as u32);
        d.surfaces.push(Surface {
            carrier: carrier.clone(),
            provenance: prov,
        });
        let es = [
            (i, true),
            (2 * n + (i + 1) % n, true),
            (n + i, false),
            (2 * n + i, false),
        ];
        let mut coedges = Vec::new();
        for (e, forward) in es {
            let Bounds::Segment(v) = d.edges[e].bounds else {
                unreachable!()
            };
            let v = if forward { v } else { [v[1], v[0]] };
            let xy = v
                .map(|v| {
                    let p = d.vertices[v.index()].def.key()?;
                    chart(&carrier, &p)
                })
                .into_iter()
                .collect::<Result<Vec<_>>>()?;
            let pcurve = Trimmed::new([xy[0].clone(), xy[1].clone()], Carrier::Line)
                .map_err(|e| no(e.name()))?;
            coedges.push(CoedgeId(d.coedges.len() as u32));
            d.coedges.push(Coedge {
                edge: EdgeId(e as u32),
                forward,
                pcurve,
                atlas: None,
                provenance: prov,
            });
        }
        let lp = LoopId(d.loops.len() as u32);
        d.loops.push(Loop {
            coedges,
            provenance: prov,
        });
        d.faces.push(Face {
            surface,
            forward,
            loops: vec![lp],
            provenance: prov,
        });
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
/// Cylinder axes for a trim whose centre or ends are quadratic: the radial
/// at an end is then irrational, so x is a rational unit direction proposed
/// from the binary64 mid-angle of the trim (stereographic parameter on a
/// dyadic grid) and certified exactly: the chart pole -x lies strictly
/// outside the closed trim. A failed certificate refuses by name.
fn radical_axes(s: &Trimmed, c: &wonky_curve::Circle) -> Result<[Point; 3]> {
    let u = s.ends()[0].difference(&c.c);
    let u = [
        u[0].enclosure().map_err(|e| no(e.name()))?.m,
        u[1].enclosure().map_err(|e| no(e.name()))?.m,
    ];
    let phi = u[1].atan2(u[0]) + c.angle.m / 2.;
    let t = ((phi / 2.).tan() * 65536.).round() / 65536.;
    if !t.is_finite() {
        return Err(no("model/extrusion-radical-chart-anchor"));
    }
    let t = Q::from_float(t).ok_or(no("model/extrusion-radical-chart-anchor"))?;
    let d = q(1) + &t * &t;
    let x = [(q(1) - &t * &t) / &d, q(2) * &t / &d, q(0)];
    let pole = [Radical::from(-x[0].clone()), Radical::from(-x[1].clone())];
    if c.angular_radical(s.ends(), &pole, false) {
        return Err(no("model/extrusion-radical-chart-anchor"));
    }
    let y = [-x[1].clone(), x[0].clone(), q(0)];
    Ok([x, y, [q(0), q(0), q(1)]])
}
/// A short cylindrical trim uses the half-angle chart t=y/(r+x), exact in
/// the field of the vertex and the centre (rational for rational data).
/// Its pole is outside the closed trim; no angular f64 decides ownership.
fn chart(carrier: &Carrier3, p: &VertexKey) -> Result<ExactPoint> {
    match carrier {
        Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => carrier.exact_plane()?.chart(&p.coordinates()),
        Carrier3::TranslatedCylinder(_) => super::quadratic_extrusion::chart(carrier, p),
        Carrier3::Rotated(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {
            let uv = chart_coordinates(carrier, p)?;
            ExactPoint::from_coordinates(uv).map_err(|e| no(e.name()))
        }
    }
}
/// The strip chart of an exact point on a cylinder carrier: the same
/// half-angle chart the strip auditor checks pcurves against.
pub fn strip_chart(carrier: &Carrier3, p: &RPoint) -> Result<ExactPoint> {
    chart(carrier, &VertexKey::Real(p.clone()))
}
/// The point of a strip chart coordinate pair (t, z): the inverse of
/// `strip_chart`, exact in the field of t and z.
pub fn strip_point(c: &Cylinder3, uv: &[Radical; 2]) -> RPoint {
    let r = Radical::from(wonky_curve::numeric::exact_root(&c.radius2()).unwrap());
    let (t, z) = (&uv[0], &uv[1]);
    let d = Radical::from(q(1)) + t * t;
    let local = [&r * &(Radical::from(q(1)) - t * t) / &d, &r * t * q(2) / &d, z.clone()];
    let o = c.origin();
    std::array::from_fn(|k| (0..3).fold(o[k].clone(), |s, j| s + &local[j] * &c.columns()[j][k]))
}
/// The half-angle chart coordinates of a point on a cylinder carrier.
fn chart_coordinates(carrier: &Carrier3, p: &VertexKey) -> Result<[Radical; 2]> {
    match carrier {
        Carrier3::Rotated(_) => Err(no("model/rotated/extrusion-chart-consumer")),
        Carrier3::Cylinder(c) => {
            // The chart is taken in the carrier frame, for any axis.
            let cols = c.columns();
            let orientation = dot(&cols[0], &cross(&cols[1], &cols[2]));
            if !orientation.is_positive() {
                return Err(no("model/extrusion-reversed-carrier-chart"));
            }
            let p = c.local(&p.coordinates());
            let r = wonky_curve::numeric::exact_root(&c.radius2()).unwrap();
            let pole = Radical::from(r) + &p[0];
            if pole <= Radical::default() {
                return Err(no("model/extrusion-chart-pole"));
            }
            Ok([&p[1] / &pole, p[2].clone()])
        }
        Carrier3::Plane(_) | Carrier3::RadicalPlane(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {
            Err(no("model/extrusion-carrier"))
        }
    }
}
/// A strip: a cylinder face whose one loop is a polygon of latitude arcs
/// and rulings in the half-angle chart (an extrusion wall has four; a
/// Boolean fragment of one may have any number, boolean3d G12b).
pub(super) fn strip(d: &Draft, fi: FaceId) -> bool {
    let f = &d.faces[fi.index()];
    matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Cylinder(_))
        && f.loops.len() == 1
        && d.loops[f.loops[0].index()].coedges.len() >= 2
        && d.loops[f.loops[0].index()].coedges.iter().all(|c| {
            matches!(
                d.edges[d.coedges[c.index()].edge.index()].bounds,
                Bounds::Segment(_)
            )
        })
}
pub(super) fn chart_audit(d: &Draft, fi: FaceId) -> Result<()> {
    let f = &d.faces[fi.index()];
    let carrier = &d.surfaces[f.surface.index()].carrier;
    for c in &d.loops[f.loops[0].index()].coedges {
        let co = &d.coedges[c.index()];
        if co.atlas.is_some() || !matches!(co.pcurve.carrier(), Carrier::Line) {
            return Err(no("model/g3-cylinder-chart"));
        }
        let edge = &d.edges[co.edge.index()];
        let Bounds::Segment(v) = edge.bounds else {
            return Err(no("model/g3-cylinder-bounds"));
        };
        let v = if co.forward { v } else { [v[1], v[0]] };
        let a = chart(carrier, &d.vertices[v[0].index()].def.key()?)?;
        let b = chart(carrier, &d.vertices[v[1].index()].def.key()?)?;
        if co.pcurve.ends() != &[a.clone(), b.clone()] {
            return Err(no("model/g3-pcurve-identity"));
        }
        let (a, b) = (a.coordinates(), b.coordinates());
        match &d.curves[edge.curve.index()].geometry {
            Curve3::TranslatedCircle(_) => return Err(no("model/translated-circle/legacy-stripe")),
            Curve3::RadicalCircle(_) => return Err(no("boolean/ssi-row-unavailable:extrusion/quadratic-circle")),
            Curve3::Circle(circle) => {
                if a[1] != b[1] {
                    return Err(no("model/g3-cylinder-circle-chart"));
                }
                let Carrier3::Cylinder(cylinder) = carrier else {
                    return Err(no("model/g3-cylinder-carrier"));
                };
                // The circle in cylinder coordinates: centre on the axis,
                // axes in the latitude plane (exact in the centre's field).
                let origin = cylinder.local(&circle.origin());
                let [cx, cy, _] = circle
                    .columns()
                    .clone()
                    .map(|v| cylinder.linear(&super::algebraic::lift(&v)));
                if !origin[0].is_zero() || !origin[1].is_zero() || !cx[2].is_zero() || !cy[2].is_zero()
                {
                    return Err(no("model/g3-cylinder-circle-latitude"));
                }
                let positive = (&cx[0] * &cy[1] - &cx[1] * &cy[0]).is_positive();
                let cols = cylinder.columns();
                let orientation = dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive();
                if (b[0] > a[0]) != (co.forward == (positive == orientation)) {
                    return Err(no("model/g3-cylinder-circle-sense"));
                }
            }
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                if a[0] != b[0] {
                    return Err(no("model/g3-cylinder-line-chart"));
                }
            }
        }
    }
    Ok(())
}
/// A cap-paired product proof of global embedding and outward orientation.
/// G1-G7 still verify each individual carrier, pcurve, loop and incidence.
pub(super) fn outward(d: &Draft) -> Result<bool> {
    product(d, false)
}
fn product(d: &Draft, planar: bool) -> Result<bool> {
    if !planar && !d
        .faces
        .iter()
        .enumerate()
        .any(|(i, _)| strip(d, FaceId(i as u32)))
    {
        return Ok(false);
    }
    // Only a body whose every face is a plane or a cylinder parallel to z is
    // a product candidate; any other carrier (a blend torus, an oblique
    // cylinder) leaves the proof to the general ray-parity audit.
    let product = d.faces.iter().all(|f| match &d.surfaces[f.surface.index()].carrier {
        Carrier3::Plane(_) => true,
        Carrier3::Cylinder(c) => {
            let z = &c.columns()[2];
            z[0].is_zero() && z[1].is_zero() && !z[2].is_zero()
        }
        // A vertical Q(√d) plane is a product wall too (cap-paired chamfers).
        Carrier3::RadicalPlane(p) => p.n[2].is_zero(),
        Carrier3::Rotated(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => false,
    });
    if !product {
        return Ok(false);
    }
    if d.solids.len() != 1 || d.shells.len() != 1 {
        return Err(no("model/extrusion-single-shell"));
    }
    let mut caps = Vec::new();
    for (i, f) in d.faces.iter().enumerate() {
        if let Carrier3::Plane(p) = &d.surfaces[f.surface.index()].carrier {
            if p.n[0].is_zero() && p.n[1].is_zero() && !p.n[2].is_zero() {
                caps.push((p.o[2].clone(), FaceId(i as u32)));
            }
        }
    }
    // More than two planes across the axis (a Boolean of a prism with a
    // cross-axis operand) is no product: the general audit decides.
    if caps.len() != 2 {
        return Ok(false);
    }
    caps.sort();
    let [(lo, bottom), (hi, top)] = caps.as_slice() else {
        unreachable!()
    };
    if lo >= hi {
        return Err(no("model/extrusion-levels"));
    }
    for (fi, positive) in [(*bottom, false), (*top, true)] {
        let f = &d.faces[fi.index()];
        let p = d.surfaces[f.surface.index()].carrier.plane()?;
        if (p.n[2].is_positive() == f.forward) != positive {
            return Err(no("model/g8-inward-face"));
        }
    }
    // Pair every cap edge by its exact XY carrier and oriented endpoints.
    // Every pair must own exactly one complete wall, and walls must own no
    // additional horizontal boundary. This proves the boundary is a product.
    let project = |fi: FaceId| -> Result<Vec<Vec<Trimmed>>> {
        let f = &d.faces[fi.index()];
        let p = d.surfaces[f.surface.index()].carrier.plane()?;
        let y = p.y();
        let map = wonky_curve::PlaneMap::affine(
            [p.o[0].clone(), p.o[1].clone()],
            [p.x[0].clone(), p.x[1].clone()],
            [y[0].clone(), y[1].clone()],
        )
        .ok_or(no("model/extrusion-cap-chart"))?;
        f.loops
            .iter()
            .map(|l| {
                d.loops[l.index()]
                    .coedges
                    .iter()
                    .map(|c| {
                        d.coedges[c.index()]
                            .pcurve
                            .mapped(&map)
                            .map_err(|e| no(e.name()))
                    })
                    .collect()
            })
            .collect()
    };
    let lower = project(*bottom)?
        .into_iter()
        .map(|p| Cycle::new(p).reversed())
        .collect::<Vec<_>>();
    let upper = project(*top)?
        .into_iter()
        .map(Cycle::new)
        .collect::<Vec<_>>();
    if lower.len() != upper.len() {
        return Err(no("model/extrusion-cap-loops"));
    }
    let equal = |a: &Cycle, b: &Cycle| {
        a.len() == b.len()
            && (0..a.len()).any(|k| {
                a.pieces().iter().enumerate().all(|(i, p)| {
                    p.key() == b.pieces()[(i + k) % b.len()].key()
                        && p.ends() == b.pieces()[(i + k) % b.len()].ends()
                        && match (p.carrier(), b.pieces()[(i + k) % b.len()].carrier()) {
                            (Carrier::Circle(a), Carrier::Circle(b)) => {
                                a.ccw == b.ccw && a.full == b.full
                            }
                            (Carrier::Line, Carrier::Line) => true,
                            _ => false,
                        }
                })
            })
    };
    if lower.iter().zip(&upper).any(|(a, b)| !equal(a, b)) {
        return Err(no("model/extrusion-caps-differ"));
    }
    let mut edges = BTreeMap::<EdgeId, FaceId>::new();
    for (i, f) in d.faces.iter().enumerate() {
        let fi = FaceId(i as u32);
        if fi == *top || fi == *bottom {
            continue;
        }
        match &d.surfaces[f.surface.index()].carrier {
            Carrier3::Rotated(_) => return Err(no("model/rotated/extrusion-wall-consumer")),
            Carrier3::Plane(p) => {
                if !p.n[2].is_zero() {
                    return Err(no("model/extrusion-oblique-wall"));
                }
            }
            Carrier3::Cylinder(c) => {
                let z = &c.columns()[2];
                if !z[0].is_zero() || !z[1].is_zero() || z[2].is_zero() {
                    return Err(no("model/extrusion-oblique-cylinder"));
                }
            }
            Carrier3::RadicalPlane(p) => {
                if !p.n[2].is_zero() { return Err(no("model/extrusion-oblique-wall")); }
            }
            Carrier3::TranslatedCylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) | Carrier3::Torus(_) => {
                return Err(no("model/extrusion-wall-carrier"))
            }
        }
        let mut counts = [0usize; 2];
        for l in &f.loops {
            for c in &d.loops[l.index()].coedges {
                let e = d.coedges[c.index()].edge;
                let mut cap = None;
                for (k, cf) in [*bottom, *top].iter().enumerate() {
                    if d.faces[cf.index()].loops.iter().any(|l| {
                        d.loops[l.index()]
                            .coedges
                            .iter()
                            .any(|c| d.coedges[c.index()].edge == e)
                    }) {
                        counts[k] += 1;
                        cap = Some(k);
                    }
                }
                if cap.is_some() {
                    if edges.insert(e, fi).is_some() {
                        return Err(no("model/extrusion-wall-overlap"));
                    }
                } else {
                    let Bounds::Segment(v) = d.edges[e.index()].bounds else {
                        return Err(no("model/extrusion-wall-ring"));
                    };
                    let p = v
                        .map(|v| d.vertices[v.index()].def.key().map(|p| p.coordinates()))
                        .into_iter()
                        .collect::<Result<Vec<_>>>()?;
                    let (lo, hi) = (Radical::from(lo.clone()), Radical::from(hi.clone()));
                    if p[0][0] != p[1][0]
                        || p[0][1] != p[1][1]
                        || !((p[0][2] == lo && p[1][2] == hi) || (p[1][2] == lo && p[0][2] == hi))
                    {
                        return Err(no("model/extrusion-incomplete-generator"));
                    }
                }
            }
        }
        if counts != [1, 1] {
            return Err(no("model/extrusion-incomplete-wall"));
        }
    }
    for fi in [*bottom, *top] {
        for l in &d.faces[fi.index()].loops {
            for c in &d.loops[l.index()].coedges {
                if !edges.contains_key(&d.coedges[c.index()].edge) {
                    return Err(no("model/extrusion-missing-wall"));
                }
            }
        }
    }
    Ok(true)
}

/// Green area for rational line/circle trims whose exact sweep is a rational
/// multiple of pi (full, half, quarter). Other sweeps are a named capability;
/// their shared chart audit and exact geometry remain independent of this metric.
pub(super) fn green(pieces: &[Trimmed]) -> Result<PiValue> {
    if let Some(value) = Cycle::new(pieces.to_vec())
        .area_exact()
        .map_err(|e| no(e.name()))?
    {
        return Ok(PiValue {
            rational: value,
            pi: q(0),
            pi2: q(0),
        });
    }
    let mut area = PiValue::default();
    for s in pieces {
        let a = s.ends()[0].rat().map_err(|e| no(e.name()))?;
        let b = s.ends()[1].rat().map_err(|e| no(e.name()))?;
        match s.carrier() {
            Carrier::Line => area.rational += (&a[0] * &b[1] - &a[1] * &b[0]) / q(2),
            Carrier::Circle(c) => {
                let centre = c.c.rat().map_err(|e| no(e.name()))?;
                area.rational += (&centre[0] * (&b[1] - &a[1]) - &centre[1] * (&b[0] - &a[0])) / q(2);
                area.pi += c.r2.rational().ok_or(no("boolean/ssi-row-unavailable:curve/green-area"))? * sweep(s)? / q(2);
            }
            Carrier::BSpline(_) => return Err(no("boolean/ssi-row-unavailable:curve/green-area")),
        }
    }
    Ok(area)
}
fn sweep(s: &Trimmed) -> Result<Q> {
    let Carrier::Circle(c) = s.carrier() else {
        return Err(no("model/extrusion-circle-metric"));
    };
    let a = s.ends()[0].rat().map_err(|e| no(e.name()))?;
    let b = s.ends()[1].rat().map_err(|e| no(e.name()))?;
    let centre = c.c.rat().map_err(|e| no(e.name()))?;
    let u = [&a[0] - &centre[0], &a[1] - &centre[1]];
    let v = [&b[0] - &centre[0], &b[1] - &centre[1]];
    let cross = &u[0] * &v[1] - &u[1] * &v[0];
    let dot = &u[0] * &v[0] + &u[1] * &v[1];
    let sign = if c.ccw { q(1) } else { q(-1) };
    if c.full {
        Ok(sign * q(2))
    } else if dot.is_zero() {
        Ok(sign
            * if cross.is_positive() == c.ccw {
                q(1) / q(2)
            } else {
                q(3) / q(2)
            })
    } else if cross.is_zero() && dot.is_negative() {
        Ok(sign)
    } else {
        Err(no("boolean/ssi-row-unavailable:circle/non-pi-sweep-metric"))
    }
}
/// An exact value `algebraic + angular`: an algebraic number (any radical
/// field) plus a sum of π and atan terms.
pub type Angular = (Radical, AtanSum);
fn rad<T>(f: impl FnOnce() -> T) -> Result<T> {
    wonky_curve::radical::guard(f).map_err(|_| no("boolean/budget-exceeded:quadratic"))
}
/// The strip chart (t, z) of a point on a cylinder carrier; `None` at the
/// chart pole, which lies on no strip (the strip audit binds every strip to
/// this chart).
pub(super) fn strip_chart_of(carrier: &Carrier3, p: &RPoint) -> Result<Option<[Radical; 2]>> {
    let Carrier3::Cylinder(c) = carrier else {
        return Err(no("model/extrusion-strip-carrier"));
    };
    let r = wonky_curve::numeric::exact_root(&c.radius2())
        .ok_or(no("boolean/ssi-row-unavailable:chart/quadratic-radius"))?;
    let l = c.local(p);
    let pole = rad(|| Radical::from(r) + &l[0])?;
    if pole.is_zero() {
        return Ok(None);
    }
    Ok(Some(rad(|| [&l[1] / &pole, l[2].clone()])?))
}
/// An `Angular` value times a rational.
pub(super) fn scale((algebraic, angular): &Angular, s: &Q) -> Result<Angular> {
    Ok((rad(|| algebraic * s)?, angular.scaled(&Radical::from(s.clone()))?))
}
/// Add an `Angular` value into a `SurdPiValue`: the algebraic part and the
/// π coefficient through the one-field slots, the atan terms as they are.
/// Every route builds its values through this, so equal sums compare equal.
pub(super) fn absorb(out: &mut SurdPiValue, (algebraic, angular): &Angular) -> Result<()> {
    out.add_scaled(algebraic, &PiValue { rational: q(1), ..PiValue::default() })?;
    out.add_scaled(&angular.pi, &PiValue { pi: q(1), ..PiValue::default() })?;
    for (x, c) in &angular.terms {
        out.atans.add_atan(x, c)?;
    }
    Ok(())
}
/// The signed sweep `φ` of a circle piece (positive counter-clockwise):
/// `(k, rest)` with `φ = kπ + rest`. On the quarter grid `rest` is zero (the
/// rational-π metric of `green`); otherwise `rest = 2·atan(x)` (plus `2π`
/// past a half turn) with `x = (u × v)/(r² + u·v)`, the tangent of half the
/// counter-clockwise angle from `u` to `v` (`|u| = |v| = r`), exact in the
/// field of the ends and the centre. No rounded angle participates.
pub(super) fn arc_sweep(s: &Trimmed) -> Result<(Q, AtanSum)> {
    let Carrier::Circle(c) = s.carrier() else {
        return Err(no("model/extrusion-circle-metric"));
    };
    if let Ok(k) = sweep(s) {
        return Ok((k, AtanSum::default()));
    }
    if c.full {
        return Err(no("model/extrusion-circle-metric"));
    }
    let [a, b] = [0, 1].map(|k| s.ends()[k].coordinates());
    let centre = c.c.coordinates();
    let (from, to) = if c.ccw { (&a, &b) } else { (&b, &a) };
    let (cross, den) = rad(|| {
        let u = [&from[0] - &centre[0], &from[1] - &centre[1]];
        let v = [&to[0] - &centre[0], &to[1] - &centre[1]];
        (&u[0] * &v[1] - &u[1] * &v[0], &c.r2 + &(&u[0] * &v[0] + &u[1] * &v[1]))
    })?;
    let sign = if c.ccw { q(1) } else { q(-1) };
    let mut rest = AtanSum::default();
    if den.is_zero() {
        // A half turn whose ends are irrational.
        rest.add_pi(&Radical::from(sign))?;
        return Ok((q(0), rest));
    }
    if cross.is_zero() {
        return Err(no("model/extrusion-degenerate-arc"));
    }
    let x = rad(|| &cross / &den)?;
    rest.add_atan(&x, &Radical::from(q(2) * &sign))?;
    if rad(|| cross.sign())? == std::cmp::Ordering::Less {
        rest.add_pi(&Radical::from(q(2) * &sign))?;
    }
    Ok((q(0), rest))
}
/// Green area of a loop of line and circle pieces with any sweep: `green`
/// where it applies, otherwise with exact atan terms (boolean3d G12b).
pub(super) fn green_surd(pieces: &[Trimmed]) -> Result<SurdPiValue> {
    if let Some(value) = Cycle::new(pieces.to_vec())
        .area_exact()
        .map_err(|e| no(e.name()))?
    {
        return Ok(SurdPiValue::rational(PiValue { rational: value, ..PiValue::default() }));
    }
    let mut out = SurdPiValue::default();
    for s in pieces {
        absorb(&mut out, &green_piece(s)?)?;
    }
    Ok(out)
}
/// The Green term `½∮(x dy − y dx)` of one line or circle piece.
pub(super) fn green_piece(s: &Trimmed) -> Result<Angular> {
    let [a, b] = [0, 1].map(|k| s.ends()[k].coordinates());
    match s.carrier() {
        Carrier::Line => Ok((rad(|| (&a[0] * &b[1] - &a[1] * &b[0]) * &(q(1) / q(2)))?, AtanSum::default())),
        Carrier::Circle(c) => {
            let centre = c.c.coordinates();
            let chord = rad(|| (&centre[0] * &(&b[1] - &a[1]) - &centre[1] * &(&b[0] - &a[0])) * &(q(1) / q(2)))?;
            let (k, rest) = arc_sweep(s)?;
            let half = rad(|| &c.r2 * &(q(1) / q(2)))?;
            let mut angular = rest.scaled(&half)?;
            angular.add_pi(&rad(|| &half * &k)?)?;
            Ok((chord, angular))
        }
        Carrier::BSpline(_) => Err(no("boolean/ssi-row-unavailable:curve/green-area")),
    }
}
/// The chart moments `[∫∫ 1, ∫∫ u, ∫∫ v]` contributed by one line or circle
/// piece of a planar loop: the polygon term of its chord plus, for an arc,
/// the signed circular segment between chord and arc (sector minus the
/// triangle over the centre). Sums over a loop are its moments of area.
pub(super) fn chart_moments_piece(s: &Trimmed) -> Result<[Angular; 3]> {
    let [a, b] = [0, 1].map(|k| s.ends()[k].coordinates());
    let sixth = q(1) / q(6);
    let chord = rad(|| {
        let wedge = &a[0] * &b[1] - &a[1] * &b[0];
        [
            &wedge * &(q(1) / q(2)),
            &wedge * &(&a[0] + &b[0]) * &sixth,
            &wedge * &(&a[1] + &b[1]) * &sixth,
        ]
    })?;
    let mut out: [Angular; 3] = chord.map(|v| (v, AtanSum::default()));
    match s.carrier() {
        Carrier::Line => {}
        Carrier::Circle(c) => {
            let centre = c.c.coordinates();
            let (k, rest) = arc_sweep(s)?;
            let mut phi = rest;
            phi.add_pi(&Radical::from(k))?;
            // Sector over the centre with sweep φ: area r²φ/2, moments
            // c·r²φ/2 + r²(b_v − a_v)/3 and c·r²φ/2 − r²(b_u − a_u)/3;
            // minus the triangle (c, a, b): area T, moments T(c + a + b)/3.
            let third = q(1) / q(3);
            let (algebraic, scale) = rad(|| {
                let tri = ((&a[0] - &centre[0]) * &(&b[1] - &centre[1]) - &(&a[1] - &centre[1]) * &(&b[0] - &centre[0])) * &(q(1) / q(2));
                let half = &c.r2 * &(q(1) / q(2));
                (
                    [
                        -&tri,
                        &c.r2 * &(&b[1] - &a[1]) * &third - &tri * &(&centre[0] + &a[0] + &b[0]) * &third,
                        -(&c.r2 * &(&b[0] - &a[0]) * &third) - &tri * &(&centre[1] + &a[1] + &b[1]) * &third,
                    ],
                    [half.clone(), &half * &centre[0], &half * &centre[1]],
                )
            })?;
            for i in 0..3 {
                out[i].0 = rad(|| &out[i].0 + &algebraic[i])?;
                out[i].1.add(&phi.scaled(&scale[i])?)?;
            }
        }
        Carrier::BSpline(_) => return Err(no("boolean/ssi-row-unavailable:curve/volume")),
    }
    Ok(out)
}
/// Exact measures of a strip face by Green's theorem in its chart (t, z),
/// with the angle θ = 2·atan(t) of the half-angle chart (continuous on the
/// strip: its pole lies outside the face).
///
/// On `P(θ, z) = o + z·Z + r(cos θ·X + sin θ·Y)` (carrier frame columns X, Y,
/// Z, any affine frame of positive orientation `D = X·(Y×Z)`), the normal
/// `N = P_θ × P_z = r(−sin θ·X×Z + cos θ·Y×Z)` gives `P·N = r(rD + α cos θ +
/// β sin θ)` with `α = o·(Y×Z)`, `β = −o·(X×Z)`, and `|N| = r·m` when `X×Z`
/// and `Y×Z` are orthogonal of equal length `m` (else a named refusal). An
/// integrand `g(θ) + z·h(θ)` integrates over the face as `∮ (G + z·H) dz`
/// with `G' = g`, `H' = h` (Green, counter-clockwise in (θ, z), the sense of
/// the chart (t, z)); latitudes contribute nothing (dz = 0), so only the
/// rulings `t = const` do, as polynomials in `cos θ`, `sin θ` (rational in
/// `t`) and `θ` itself (the atan terms). The loop orientation carries the
/// face sense, so the fluxes are outward; the area is signed by the sense.
///
/// Returns `[∮ P_i (P·n) dA]`, `∮ P·n dA` and the area.
pub(super) fn strip_measures(d: &Draft, fi: FaceId) -> Result<([Angular; 3], Angular, Angular)> {
    let f = &d.faces[fi.index()];
    let Carrier3::Cylinder(cy) = &d.surfaces[f.surface.index()].carrier else {
        return Err(no("model/extrusion-strip-carrier"));
    };
    if !strip(d, fi) {
        return Err(no("model/extrusion-strip-shape"));
    }
    let r = wonky_curve::numeric::exact_root(&cy.radius2())
        .ok_or(no("boolean/ssi-row-unavailable:chart/quadratic-radius"))?;
    let [x, y, z] = cy.columns();
    let (xz, yz) = (cross(x, z), cross(y, z));
    let det = dot(x, &yz);
    if !det.is_positive() {
        return Err(no("model/extrusion-reversed-carrier-chart"));
    }
    if !dot(&xz, &yz).is_zero() || dot(&xz, &xz) != dot(&yz, &yz) {
        return Err(no("boolean/ssi-row-unavailable:circle/elliptic-strip-area"));
    }
    let metric = wonky_curve::numeric::exact_root(&dot(&xz, &xz))
        .ok_or(no("boolean/ssi-row-unavailable:cylinder/strip-metric"))?;
    let o = cy.origin();
    let k = &r * &det;
    let odot = |v: &Point| -> Result<Radical> { rad(|| (0..3).fold(Radical::default(), |s, i| s + &o[i] * &v[i])) };
    let alpha = odot(&yz)?;
    let beta = -odot(&xz)?;
    let half = q(1) / q(2);
    let sense = if f.forward { q(1) } else { q(-1) };
    let mut moments: [Angular; 3] = Default::default();
    let mut flux: Angular = Default::default();
    let mut area: Angular = Default::default();
    for ci in &d.loops[f.loops[0].index()].coedges {
        let pc = &d.coedges[ci.index()].pcurve;
        if !matches!(pc.carrier(), Carrier::Line) {
            return Err(no("model/g3-cylinder-chart"));
        }
        let [a, b] = [0, 1].map(|j| pc.ends()[j].coordinates());
        if a[1] == b[1] {
            continue;
        }
        if a[0] != b[0] {
            return Err(no("model/g3-cylinder-line-chart"));
        }
        let t = a[0].clone();
        // Per quantity: the algebraic part and the coefficient of θ.
        let (f_terms, a_terms, m_terms) = rad(|| {
            let one = Radical::from(q(1));
            let dz = &b[1] - &a[1];
            let dz2 = (&b[1] * &b[1] - &a[1] * &a[1]) * &half;
            let den = &one + &(&t * &t);
            let c = (&one - &(&t * &t)) / &den;
            let s = &(&t * &q(2)) / &den;
            // The antiderivative of α cos θ + β sin θ.
            let g = &alpha * &s - &beta * &c;
            let flux = (&g * &dz * &r, &dz * &(&r * &k));
            let area = (Radical::default(), &dz * &(&r * &metric) * &sense);
            let moments: [(Radical, Radical); 3] = std::array::from_fn(|i| {
                let (oi, xi, yi, zi) = (&o[i], &x[i], &y[i], &z[i]);
                let algebraic = (oi * &g
                    + (&s * &(&k * xi) - &c * &(&k * yi)
                        + &s * &c * &(&alpha * xi - &beta * yi) * &half
                        + &s * &s * &(&beta * xi + &alpha * yi) * &half)
                        * &r)
                    * &dz
                    + &g * &dz2 * zi;
                let theta = (oi * &k + &(&alpha * xi + &beta * yi) * &(&r * &half)) * &dz + &dz2 * &(&k * zi);
                (algebraic * &r, theta * &r)
            });
            (flux, area, moments)
        })?;
        let add = |slot: &mut Angular, (algebraic, theta): (Radical, Radical)| -> Result<()> {
            slot.0 = rad(|| &slot.0 + &algebraic)?;
            slot.1.add_atan(&t, &rad(|| &theta * &q(2))?)
        };
        add(&mut flux, f_terms)?;
        add(&mut area, a_terms)?;
        for (slot, m) in moments.iter_mut().zip(m_terms) {
            add(slot, m)?;
        }
    }
    Ok((moments, flux, area))
}
pub(super) fn volumes6(d: &Draft) -> Result<Option<Vec<PiValue>>> {
    if !outward(d)? {
        return Ok(None);
    }
    let mut caps = Vec::new();
    for (i, f) in d.faces.iter().enumerate() {
        if let Carrier3::Plane(p) = &d.surfaces[f.surface.index()].carrier {
            if p.n[0].is_zero() && p.n[1].is_zero() {
                caps.push((p.o[2].clone(), FaceId(i as u32)));
            }
        }
    }
    caps.sort();
    let factor = q(6) * (&caps[1].0 - &caps[0].0);
    let a = super::periodic::planar_area(d, caps[1].1)?;
    Ok(Some(vec![PiValue {
        rational: &a.rational * &factor,
        pi: &a.pi * &factor,
        pi2: &a.pi2 * &factor,
    }]))
}
pub(super) fn strip_area(d: &Draft, fi: FaceId) -> Result<PiValue> {
    let f = &d.faces[fi.index()];
    let Carrier3::Cylinder(c) = &d.surfaces[f.surface.index()].carrier else {
        return Err(no("model/extrusion-strip-carrier"));
    };
    let mut height = None;
    let mut angular = None;
    for ci in &d.loops[f.loops[0].index()].coedges {
        let co = &d.coedges[ci.index()];
        let e = &d.edges[co.edge.index()];
        let Bounds::Segment(v) = e.bounds else {
            return Err(no("model/extrusion-strip-bounds"));
        };
        let a = chart(
            &Carrier3::Cylinder(c.clone()),
            &d.vertices[v[0].index()].def.key()?,
        )?;
        let b = chart(
            &Carrier3::Cylinder(c.clone()),
            &d.vertices[v[1].index()].def.key()?,
        )?;
        if a.coordinates()[1] != b.coordinates()[1] {
            height = Some((&b.coordinates()[1] - &a.coordinates()[1]).abs().rational().ok_or(no("model/extrusion-strip-algebraic-height"))?);
        } else {
            let t0 = a.coordinates()[0].rational().ok_or(no("model/extrusion-strip-algebraic-angle"))?;
            let t1 = b.coordinates()[0].rational().ok_or(no("model/extrusion-strip-algebraic-angle"))?;
            let angle = if (t0.is_zero() && t1.abs() == q(1)) || (t1.is_zero() && t0.abs() == q(1))
            {
                q(1) / q(2)
            } else {
                return Err(no("boolean/ssi-row-unavailable:circle/non-pi-sweep-metric"));
            };
            angular = Some(angle);
        }
    }
    let radius = wonky_curve::numeric::exact_root(&c.radius2()).unwrap();
    let [x, y, z] = c.columns();
    if !dot(x, y).is_zero() || dot(x, x) != dot(y, y) {
        return Err(no("boolean/ssi-row-unavailable:circle/elliptic-strip-area"));
    }
    let metric = wonky_curve::numeric::exact_root(&dot(x, x))
        .ok_or(no("model/extrusion-strip-metric"))?
        * wonky_curve::numeric::exact_root(&dot(z, z)).ok_or(no("model/extrusion-strip-metric"))?;
    Ok(PiValue {
        rational: q(0),
        pi2: q(0),
        pi: radius
            * metric
            * height.ok_or(no("model/extrusion-strip-height"))?
            * angular.ok_or(no("model/extrusion-strip-angle"))?,
    })
}

pub(super) fn membership(d: &Draft, w: &Point) -> Result<Option<Membership>> {
    if !outward(d)? {
        return Ok(None);
    }
    let mut caps = Vec::new();
    for (i, f) in d.faces.iter().enumerate() {
        if let Carrier3::Plane(p) = &d.surfaces[f.surface.index()].carrier {
            if p.n[0].is_zero() && p.n[1].is_zero() {
                caps.push((p.o[2].clone(), FaceId(i as u32)));
            }
        }
    }
    caps.sort();
    let (lo, bottom) = &caps[0];
    let (hi, top) = &caps[1];
    if &w[2] < lo || &w[2] > hi {
        return Ok(Some(Membership::Outside));
    }
    let f = &d.faces[top.index()];
    let p = d.surfaces[f.surface.index()].carrier.plane()?;
    let uv = ep(p.chart(w)?);
    let mut winding = 0;
    for l in &f.loops {
        let pieces = d.loops[l.index()]
            .coedges
            .iter()
            .map(|c| d.coedges[c.index()].pcurve.clone())
            .collect::<Vec<_>>();
        for (k, s) in pieces.iter().enumerate() {
            if s.contains(&uv).map_err(|e| no(e.name()))? {
                let e = d.coedges[d.loops[l.index()].coedges[k].index()].edge;
                let wall = d
                    .faces
                    .iter()
                    .enumerate()
                    .find(|(i, f)| {
                        FaceId(*i as u32) != *top
                            && FaceId(*i as u32) != *bottom
                            && f.loops.iter().any(|l| {
                                d.loops[l.index()]
                                    .coedges
                                    .iter()
                                    .any(|c| d.coedges[c.index()].edge == e)
                            })
                    })
                    .map(|(i, _)| FaceId(i as u32))
                    .ok_or(no("model/extrusion-missing-wall"))?;
                return Ok(Some(Membership::Boundary(wall)));
            }
        }
        winding += Cycle::new(pieces).winding(&uv).map_err(|e| no(e.name()))?;
    }
    Ok(Some(if winding == 0 {
        Membership::Outside
    } else if &w[2] == lo {
        Membership::Boundary(*bottom)
    } else if &w[2] == hi {
        Membership::Boundary(*top)
    } else {
        Membership::Inside
    }))
}

/// Recover a cap-paired analytic product from an audited Model. Every source
/// wall and cap must participate; this never recognizes an observation family.
pub fn section(input: &Model) -> Result<(Vec<Trimmed>, [Q; 2])> {
    let d = input.draft();
    product(d, true)?;
    let mut caps = d.faces.iter().filter_map(|f| {
        match &d.surfaces[f.surface.index()].carrier {
            Carrier3::Plane(p) if p.n[0].is_zero() && p.n[1].is_zero() => Some((p.o[2].clone(), f, p)),
            _ => None,
        }
    }).collect::<Vec<_>>();
    caps.sort_by(|a,b| a.0.cmp(&b.0));
    let (z, f, p) = &caps[1];
    if f.loops.len() != 1 { return Err(no("model/extrusion-section-multiple-loops")); }
    let y = p.y();
    let map = wonky_curve::PlaneMap::affine([p.o[0].clone(),p.o[1].clone()],
        [p.x[0].clone(),p.x[1].clone()], [y[0].clone(),y[1].clone()])
        .ok_or(no("model/extrusion-cap-chart"))?;
    let pieces = d.loops[f.loops[0].index()].coedges.iter().map(|c|
        d.coedges[c.index()].pcurve.mapped(&map).map_err(|e| no(e.name()))
    ).collect::<Result<Vec<_>>>()?;
    Ok((pieces, [caps[0].0.clone(), z.clone()]))
}
