//! WC0 emission of a replayed rule-6 Model with curved carriers (boolean3d
//! strand G12). The Model's own topology is written one to one: faces, loops,
//! coedges, edges (vertex-free rings included), vertices, shells and solids.
//! Every number on the wire is an observation cache in the root node's frame;
//! no consumer decides anything from it. Lines keep `ConstructionLine`;
//! circles are `ConstructionCurve` slots (the edge index), closed exactly for
//! rings. Replay (`model_boolean::ReplayCache::audit`) rebuilds the Model from
//! the construction DAG and requires this emission to be byte-equal.
//!
//! Planar Models keep the planar writer (`planar_boolean`); only a Model with
//! a curved carrier or a ring edge comes here (`curved`).
use crate::polyhedron::Refused;
use wonky_contract::*;
use wonky_geom::frame::Frame as XFrame;
use wonky_geom::model::algebraic::observe;
use wonky_geom::model::{Bounds, Carrier3, Curve3, Model, VertexKey};
use wonky_geom::{dot, Point, Q};

type R<T> = std::result::Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("boolean/contract-violation:emit/{s}"))
}
/// A carrier this writer has no row for (a radical centre, Q(√d) rings)
/// refuses under the geometry's own capability name.
fn cap(e: wonky_geom::Refused) -> Refused {
    Refused(e.0.into())
}

/// Whether the Model needs this writer: a curved carrier or a ring edge.
pub(crate) fn curved(m: &Model) -> bool {
    let d = m.draft();
    d.edges.iter().any(|e| matches!(e.bounds, Bounds::Ring)) || d.surfaces.iter().any(|s| curved_carrier(&s.carrier))
}

fn curved_carrier(carrier: &Carrier3) -> bool {
    match carrier {
        Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => false,
        Carrier3::Cylinder(_)
        | Carrier3::TranslatedCylinder(_)
        | Carrier3::Cone(_)
        | Carrier3::Sphere(_)
        | Carrier3::Rotated(_)
        | Carrier3::Torus(_) => true,
    }
}

fn scalar(x: f64) -> R<Binary64> {
    Binary64::new(if x == 0. { 0. } else { x }).map_err(|_| no(&format!("coordinate-range({x:e})")))
}
fn vector(x: [f64; 3]) -> R<Vector3> {
    Ok([scalar(x[0])?, scalar(x[1])?, scalar(x[2])?])
}
fn obs(p: &Point) -> R<[f64; 3]> {
    observe(&wonky_geom::model::algebraic::lift(p)).map_err(|e| no(e.0))
}
fn obs1(x: &Q) -> R<f64> {
    use num_traits::ToPrimitive;
    x.to_f64().filter(|v| v.is_finite()).ok_or_else(|| no(&format!("rational-range({x})")))
}
fn norm(v: [f64; 3]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}
/// A cache direction pair (n, x) with x ⟂ n exactly in binary64: x is a
/// coordinate cross product, so the contract's exact orthogonality holds.
fn axes(n: [f64; 3]) -> R<([f64; 3], [f64; 3])> {
    let k = (0..3).min_by(|&a, &b| n[a].abs().total_cmp(&n[b].abs())).unwrap();
    let mut e = [0.; 3];
    e[k] = 1.;
    let x = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]];
    if norm(n) == 0. || norm(x) == 0. {
        return Err(no("zero-direction"));
    }
    Ok((n, x))
}
fn unit() -> Domain {
    Domain {
        lower: Limit::Finite { value: Binary64::new(0.).unwrap(), closed: true },
        upper: Limit::Finite { value: Binary64::new(1.).unwrap(), closed: true },
    }
}

/// The exact map from the Model's frame into the root node's frame.
fn into_root(m: &Model, root: &XFrame) -> R<XFrame> {
    let p = &m.draft().placement;
    let inv = root.inverse();
    XFrame::new(inv.point(p.origin()), p.columns().clone().map(|c| inv.vector(&c))).map_err(|e| no(e.0))
}
/// The surface cache of a carrier, in the root frame, and the chart used for
/// its pcurve samples: (origin, first axis, second axis, third axis) with the
/// chart (dot x, dot y) for planes and (turns about the axis, height) else.
struct Cache {
    geometry: SurfaceGeometry,
    origin: [f64; 3],
    x: [f64; 3],
    y: [f64; 3],
    z: [f64; 3],
    periodic: bool,
}
fn surface(carrier: &Carrier3, map: &XFrame) -> R<Cache> {
    let unitv = |v: [f64; 3]| -> R<[f64; 3]> {
        let l = norm(v);
        if !(l > 0.) || !l.is_finite() { return Err(no("zero-direction")); }
        Ok(v.map(|c| c / l))
    };
    let frame_of = |f: &XFrame| -> R<([f64; 3], [f64; 3], [f64; 3], [f64; 3], f64)> {
        let [c0, c1, c2] = f.columns();
        let (u, v, w) = (map.vector(c0), map.vector(c1), map.vector(c2));
        let unit_len = obs1(&dot(&u, &u))?.sqrt();
        Ok((obs(&map.point(f.origin()))?, unitv(obs(&u)?)?, unitv(obs(&v)?)?, unitv(obs(&w)?)?, unit_len))
    };
    match carrier {
        Carrier3::Plane(p) => {
            let n = obs(&map.vector(&p.n))?;
            let (n, x) = axes(n)?;
            let o = obs(&map.point(&p.o))?;
            let (nu, xu) = (unitv(n)?, unitv(x)?);
            let y = [nu[1] * xu[2] - nu[2] * xu[1], nu[2] * xu[0] - nu[0] * xu[2], nu[0] * xu[1] - nu[1] * xu[0]];
            Ok(Cache { geometry: SurfaceGeometry::Plane { origin: vector(o)?, normal: vector(n)?, x: vector(x)? }, origin: o, x: xu, y, z: nu, periodic: false })
        }
        Carrier3::RadicalPlane(_) => Err(Refused("boolean/ssi-row-unavailable:radical-plane/curved-emit".into())),
        Carrier3::Cylinder(c) => {
            let (o, cx, cy, cz, len) = frame_of(c.frame().map_err(cap)?)?;
            let radius = obs1(&c.radius2())?.sqrt() * len;
            let (axis, x) = axes(cz)?;
            Ok(Cache { geometry: SurfaceGeometry::Cylinder { origin: vector(o)?, axis: vector(axis)?, x: vector(x)?, radius: scalar(radius)? }, origin: o, x: cx, y: cy, z: cz, periodic: true })
        }
        Carrier3::Cone(c) => {
            let (_, cx, cy, cz, len) = frame_of(&c.frame)?;
            // The contract's cone grows along its axis (slope > 0): the cache
            // starts at the ring of smaller radius and points to the larger.
            let rings = c.rings().map_err(cap)?;
            let (h, r) = if rings[0].1 <= rings[1].1 { &rings[0] } else { &rings[1] };
            let [_, m1] = c.meridian().map_err(cap)?;
            let height = obs1(&dot(&map.vector(&c.frame.columns()[2]), &map.vector(&c.frame.columns()[2])))?.sqrt();
            let origin = obs(&map.point(&c.frame.point(&[Q::from_integer(0.into()), Q::from_integer(0.into()), h.clone()])))?;
            let grows = if num_traits::Signed::is_negative(&m1) { cz.map(|v| -v) } else { cz };
            let (axis, x) = axes(grows)?;
            Ok(Cache {
                geometry: SurfaceGeometry::ConeSlope { origin: vector(origin)?, axis: vector(axis)?, x: vector(x)?, radius: scalar(obs1(r)? * len)?, slope: scalar(obs1(&m1)?.abs() * len / height)? },
                origin, x: cx, y: cy, z: cz, periodic: true,
            })
        }
        Carrier3::Sphere(s) => {
            let (o, cx, cy, cz, len) = frame_of(&s.frame)?;
            let radius = obs1(s.radius())? * len;
            let (axis, x) = axes(cz)?;
            Ok(Cache { geometry: SurfaceGeometry::Sphere { origin: vector(o)?, axis: vector(axis)?, x: vector(x)?, radius: scalar(radius)? }, origin: o, x: cx, y: cy, z: cz, periodic: true })
        }
        // A Q(√d)-translated cylinder has a radical centre: no row, as for a
        // radical-centre carrier (`cap`).
        Carrier3::TranslatedCylinder(_) => Err(Refused("boolean/ssi-row-unavailable:translated-cylinder/curved-emit".into())),
        Carrier3::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus/curved-emit".into())),
        Carrier3::Rotated(_) => Err(Refused("boolean/ssi-row-unavailable:rotated/curved-emit".into())),
    }
}
fn chart(c: &Cache, p: [f64; 3]) -> [f64; 2] {
    let d = [p[0] - c.origin[0], p[1] - c.origin[1], p[2] - c.origin[2]];
    let f = |v: [f64; 3]| d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    if c.periodic {
        let turns = f(c.y).atan2(f(c.x)) / std::f64::consts::TAU;
        [if turns < 0. { turns + 1. } else { turns }, f(c.z)]
    } else {
        [f(c.x), f(c.y)]
    }
}

/// Emit the Model `m` of rule-6 node `root` into `body` (empty geometry).
pub(crate) fn emit(mut body: Body, root: usize, m: &Model) -> R<Body> {
    let d = m.draft();
    // Rule-6 ownership is read from the first vertex's provenance, or from the
    // first curve's or surface's for a ring-only Model (`model_boolean::root`).
    let frame = body.constructions[root].frame;
    let root_frame = crate::placement::Placement::from_frames(&body, frame)
        .map_err(|_| Refused("boolean/cross-frame-unproved".into()))?
        .exact_frame()?;
    let map = into_root(m, &root_frame)?;
    let provenance = Provenance::Construction { node: NodeId(root as u32) };
    // Vertices: every Model vertex, observed in the root frame.
    for (i, _) in d.vertices.iter().enumerate() {
        let p = match m.key(wonky_geom::model::VertexId(i as u32)) {
            VertexKey::Rational(p) => obs(&map.point(p))?,
            VertexKey::Quadratic(p) => observe(p.mapped(&map).map_err(|e| no(e.0))?.coordinates()).map_err(|e| no(e.0))?,
            VertexKey::Real(p) => observe(&wonky_geom::model::algebraic::mapped(p, &map)).map_err(|e| no(e.0))?,
        };
        body.vertices.push(Vertex { point: vector(p)?, frame, provenance: provenance.clone() });
    }
    // Curves and edges, one per Model edge.
    for (i, e) in d.edges.iter().enumerate() {
        let (geometry, vertices) = match (&d.curves[e.curve.index()].geometry, e.bounds) {
            (Curve3::Line { .. } | Curve3::RadicalLine { .. }, Bounds::Segment([a, b])) =>
                (CurveGeometry::ConstructionLine { edge: EdgeId(i as u32) }, vec![VertexId(a.0), VertexId(b.0)]),
            (Curve3::Circle(_), Bounds::Segment([a, b])) =>
                (CurveGeometry::ConstructionCurve { slot: i as u32, closed: false }, vec![VertexId(a.0), VertexId(b.0)]),
            (Curve3::Circle(_), Bounds::Ring) => (CurveGeometry::ConstructionCurve { slot: i as u32, closed: true }, vec![]),
            (Curve3::Line { .. } | Curve3::RadicalLine { .. }, Bounds::Ring) => return Err(no("ring-on-line")),
            (Curve3::RadicalCircle(_), Bounds::Segment([a, b])) =>
                (CurveGeometry::ConstructionCurve { slot: i as u32, closed: false }, vec![VertexId(a.0), VertexId(b.0)]),
            (Curve3::RadicalCircle(_), Bounds::Ring) => (CurveGeometry::ConstructionCurve { slot: i as u32, closed: true }, vec![]),
            (Curve3::TranslatedCircle(_), _) => return Err(Refused("boolean/ssi-row-unavailable:translated-circle/curved-emit".into())),
        };
        body.curves.push(Curve { frame, provenance: provenance.clone(), geometry, domain: unit(), supports: vec![] });
        body.edges.push(Edge { curve: CurveId(i as u32), domain: unit(), vertices });
    }
    // Faces: one surface each; one pcurve per (edge, face) use.
    let mut uses = std::collections::BTreeMap::new();
    for f in &d.faces {
        let sid = SurfaceId(body.surfaces.len() as u32);
        let cache = surface(&d.surfaces[f.surface.index()].carrier, &map)?;
        body.surfaces.push(Surface { frame, provenance: provenance.clone(), geometry: cache.geometry.clone() });
        let mut loops = Vec::new();
        for l in &f.loops {
            let mut coedges = Vec::new();
            for c in &d.loops[l.index()].coedges {
                let co = &d.coedges[c.index()];
                let edge = co.edge.index();
                let ends = match d.edges[edge].bounds {
                    Bounds::Segment([a, b]) => [body.vertices[a.index()].point, body.vertices[b.index()].point],
                    Bounds::Ring => {
                        let start = match &d.curves[d.edges[edge].curve.index()].geometry {
                            Curve3::Circle(circle) => {
                                let r = wonky_curve::numeric::exact_root(&circle.radius2()).ok_or_else(|| no("ring-radius"))?;
                                vector(obs(&map.point(&circle.frame().map_err(cap)?.point(&[r, Q::from_integer(0.into()), Q::from_integer(0.into())])))?)?
                            }
                            Curve3::RadicalCircle(circle) => {
                                let p = circle.point(wonky_geom::model::curved::Patch::First, &Q::from_integer(0.into())).map_err(cap)?;
                                vector(observe(&wonky_geom::model::algebraic::mapped(&p, &map)).map_err(|e| no(e.0))?)?
                            }
                            Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(no("ring-on-line")),
                            Curve3::TranslatedCircle(_) => return Err(Refused("boolean/ssi-row-unavailable:translated-circle/curved-emit".into())),
                        };
                        [start, start]
                    }
                };
                let pc = PcurveId(body.pcurves.len() as u32);
                let entry = *uses.entry((edge, sid.0)).or_insert(pc);
                if entry == pc {
                    let points = ends.map(|p| chart(&cache, p.map(|v| v.get())));
                    let magnitude = (1. + points.iter().flatten().fold(0f64, |a, v| a.max(v.abs()))) * 8. * f64::EPSILON;
                    body.pcurves.push(Pcurve {
                        curve: CurveId(edge as u32),
                        surface: sid,
                        domain: unit(),
                        geometry: PcurveGeometry::Samples {
                            parameters: vec![scalar(0.)?, scalar(1.)?],
                            points: vec![[scalar(points[0][0])?, scalar(points[0][1])?], [scalar(points[1][0])?, scalar(points[1][1])?]],
                            error: Bound::Estimated { estimate: Estimate { magnitude: scalar(magnitude)? } },
                        },
                    });
                    body.curves[edge].supports.push(Support { surface: sid, pcurve: pc });
                }
                coedges.push(CoedgeId(body.coedges.len() as u32));
                body.coedges.push(Coedge { edge: EdgeId(edge as u32), forward: co.forward, pcurve: entry });
            }
            loops.push(LoopId(body.loops.len() as u32));
            body.loops.push(Loop { outer: loops.len() == 1, coedges });
        }
        body.faces.push(Face { surface: sid, forward: f.forward, loops });
    }
    body.shells = d.shells.iter().map(|s| Shell { faces: s.faces.iter().map(|f| FaceId(f.0)).collect() }).collect();
    body.solids = d.solids.iter().map(|s| Solid { shells: s.shells.iter().map(|s| ShellId(s.0)).collect() }).collect();
    body.clone().check().map_err(|e| no(&format!("contract: {e:?}")))?;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wonky_curve::{numeric::q, Trimmed};
    use wonky_geom::model::{extrusion, EdgeId, Label};

    /// A Q(√d)-centred rolling-ball stripe (an arc/chord profile filleted at
    /// both chord ends) is curved, and the writer refuses its translated
    /// carriers by name instead of emitting them.
    #[test]
    fn translated_carriers_route_curved_and_refuse_by_name() {
        let arc = Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap();
        let line = Trimmed::line([3., 4.], [-3., 4.]);
        let m = extrusion::profile(XFrame::identity(), Label::Exact, 0, &[arc, line], [q(0.), q(4.)]).unwrap().check().unwrap();
        let vertical = |x: f64| {
            let d = m.draft();
            (0..d.edges.len())
                .find(|&i| {
                    let Bounds::Segment(v) = d.edges[i].bounds else { return false };
                    let [a, b] = v.map(|v| m.key(v).coordinates());
                    a[0] == q(x) && b[0] == q(x) && a[1] == q(4.) && b[1] == q(4.) && a[2] != b[2]
                })
                .map(|i| EdgeId(i as u32))
                .unwrap()
        };
        let r = wonky_blend::profile_model::replace(&m, &[vertical(3.), vertical(-3.)], &q(0.5), true, 1).unwrap();
        let d = r.model.draft();
        let stripe = d.surfaces.iter().find(|s| matches!(s.carrier, Carrier3::TranslatedCylinder(_))).unwrap();
        assert!(d.curves.iter().any(|c| matches!(c.geometry, Curve3::TranslatedCircle(_))));
        // The arc face is a plain cylinder, so check the stripe carrier itself.
        assert!(curved_carrier(&stripe.carrier));
        assert!(curved(&r.model));
        assert_eq!(
            surface(&stripe.carrier, &XFrame::identity()).err().unwrap().0,
            "boolean/ssi-row-unavailable:translated-cylinder/curved-emit"
        );
    }
}
