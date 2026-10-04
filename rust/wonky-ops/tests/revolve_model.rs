//! Source-level shadows of the existing producers; these are not Onshape captures.
use num_traits::Zero;
use wonky_contract::{Body, BodyKey, CurveGeometry, SurfaceGeometry};
use wonky_geom::{
    frame::Frame,
    model::{
        self, Canonical, CanonicalEdge, CanonicalFace, CarrierKey, CurveKey, EdgeEnds, VertexKey,
    },
    AngleWitness, Point, Turn, Q,
};
use wonky_ops::{affine::Affine, analytic, revolve_full, revolve_sector};
fn q(x: f64) -> Q {
    wonky_geom::binary64(x).unwrap()
}
fn point(p: wonky_contract::Vector3) -> Point {
    p.map(|x| q(x.get()))
}
fn key() -> BodyKey {
    BodyKey {
        id: [1, 2, 3, 4],
        revision: 0,
    }
}
fn turn(deg: i64) -> Turn {
    Turn::new(
        deg as f64 * (std::f64::consts::PI / 180.),
        Some(AngleWitness::Turns(Q::new(deg.into(), 360.into()))),
    )
    .unwrap()
}
fn segments(p: &[[f64; 2]]) -> Vec<[f64; 4]> {
    (0..p.len())
        .map(|i| {
            let (a, b) = (p[i], p[(i + 1) % p.len()]);
            [a[0], a[1], b[0], b[1]]
        })
        .collect()
}
fn new_model(p: &[[f64; 2]], deg: i64, placement: Frame) -> model::Model {
    let p: Vec<_> = p.iter().map(|v| v.map(q)).collect();
    model::revolution_partial::polygon(placement, &p, turn(deg), 0)
        .unwrap()
        .check()
        .unwrap()
}
fn frames() -> [Affine; 4] {
    [
        Affine::IDENTITY,
        Affine {
            origin: [64., -32., 16.],
            ..Affine::IDENTITY
        },
        Affine {
            origin: [0.; 3],
            x: [0., 1., 0.],
            z: [1., 0., 0.],
        },
        Affine {
            origin: [0.; 3],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        },
    ]
}
#[test]
fn ac72_v0_v5_and_ac25_shadow_full_revolve_exact_canonical_identity() {
    let s = 1. / 1024.;
    for v in 0..6 {
        let bump = if v == 4 { 0.025 } else { 0. };
        let p = [
            [0., 0.],
            [8. + bump, 0.],
            [8. + bump, 6.],
            [5. + bump, 6.],
            [5. + bump, 18.],
            [0., 18.],
        ]
        .map(|p| p.map(|x| x * s));
        let frame = frames()[if v < 4 { v } else { 0 }];
        let body = revolve_full::build(
            key(),
            [0; 4],
            frame,
            2,
            &segments(&p),
            std::f64::consts::TAU,
        )
        .unwrap();
        let old = analytic::audit(&body.check().unwrap())
            .unwrap()
            .model()
            .unwrap();
        let new = new_model(&p, 360, old.draft().placement.clone());
        assert_eq!(new.canonical(), old.canonical(), "AC72 V{v}");
        assert_eq!(new.volume6_pi().unwrap(), old.volume6_pi().unwrap());
        assert_eq!(
            (
                new.canonical().faces.len(),
                new.canonical().edges.len(),
                new.canonical().vertices.len()
            ),
            (5, 4, 0)
        );
    }
    let p = [[0., 0.], [6., 0.], [0., 8.]].map(|p| p.map(|x| x * s));
    for frame in frames() {
        let body = revolve_full::build(
            key(),
            [0; 4],
            frame,
            2,
            &segments(&p),
            std::f64::consts::TAU,
        )
        .unwrap();
        let old = analytic::audit(&body.check().unwrap())
            .unwrap()
            .model()
            .unwrap();
        let new = new_model(&p, 360, old.draft().placement.clone());
        assert_eq!(new.canonical(), old.canonical(), "AC25");
        assert_eq!(
            (
                new.canonical().faces.len(),
                new.canonical().edges.len(),
                new.canonical().vertices.len()
            ),
            (2, 1, 0)
        );
    }
}
fn least(c: &[(usize, bool)]) -> Vec<(usize, bool)> {
    (0..c.len())
        .map(|i| c[i..].iter().chain(&c[..i]).copied().collect::<Vec<_>>())
        .min()
        .unwrap()
}
/// Independent exact point-set projection of the old quarter WC0. Its sampled
/// pcurves are deliberately not used as evidence of geometry or incidence.
fn quarter_canonical(b: &Body) -> Canonical {
    let pts: Vec<_> = b.vertices.iter().map(|v| point(v.point)).collect();
    let mut vertices: Vec<_> = pts.iter().cloned().map(VertexKey::Rational).collect();
    vertices.sort();
    let vpos: Vec<_> = pts
        .iter()
        .map(|p| {
            vertices
                .iter()
                .position(|v| *v == VertexKey::Rational(p.clone()))
                .unwrap()
        })
        .collect();
    let mut edges = Vec::new();
    for (i, e) in b.edges.iter().enumerate() {
        let [a, c] = [
            vpos[e.vertices[0].0 as usize],
            vpos[e.vertices[1].0 as usize],
        ];
        let (curve, ends) = match b.curves[e.curve.0 as usize].geometry.clone() {
            CurveGeometry::Line { a: p, b: end } => {
                let (p, end) = (point(p), point(end));
                let d = wonky_geom::sub(&end, &p);
                let k = d.iter().position(|v| !v.is_zero()).unwrap();
                let direction = d.clone().map(|v| v / &d[k]);
                let origin = std::array::from_fn(|j| &p[j] - &p[k] * &direction[j]);
                (
                    CurveKey::Line {
                        point: origin,
                        direction,
                    },
                    EdgeEnds::Segment([a.min(c), a.max(c)]),
                )
            }
            CurveGeometry::Circle {
                origin,
                normal,
                x,
                radius,
                ..
            } => {
                let (o, z, x) = (point(origin), point(normal), point(x));
                let y = wonky_geom::cross(&z, &x);
                let circle =
                    model::Circle3::new(Frame::new(o, [x, y, z]).unwrap(), q(radius.get()).pow(2))
                        .unwrap();
                let (plane, quadratic, flip) = circle.canonical_data().unwrap();
                (
                    CurveKey::Circle { plane, quadratic },
                    EdgeEnds::Arc {
                        vertices: [a.min(c), a.max(c)],
                        positive: if a < c { !flip } else { flip },
                    },
                )
            }
            other => panic!("unexpected quarter curve {other:?}"),
        };
        edges.push((CanonicalEdge { curve, ends }, i));
    }
    edges.sort();
    let mut epos = vec![0; edges.len()];
    for (pos, (_, i)) in edges.iter().enumerate() {
        epos[*i] = pos;
    }
    let mut faces = vec![];
    for f in &b.faces {
        let (carrier, flip) = match b.surfaces[f.surface.0 as usize].geometry.clone() {
            SurfaceGeometry::Plane { origin, normal, .. } => {
                let (o, n) = (point(origin), point(normal));
                let pivot = n.iter().find(|v| !v.is_zero()).unwrap();
                let normal = n.clone().map(|v| v / pivot);
                let offset = wonky_geom::dot(&normal, &o);
                (CarrierKey::Plane { normal, offset }, pivot < &q(0.))
            }
            SurfaceGeometry::Cylinder {
                origin,
                axis,
                x,
                radius,
            } => {
                let (o, z, x) = (point(origin), point(axis), point(x));
                let y = wonky_geom::cross(&z, &x);
                let c = model::Carrier3::Cylinder(
                    model::Cylinder3::new(
                        Frame::new(o, [x, y, z]).unwrap(),
                        q(radius.get()).pow(2),
                    )
                    .unwrap(),
                );
                let coefficients = c.implicit().unwrap().coefficients();
                let pivot = coefficients.iter().find(|v| !v.is_zero()).unwrap();
                (
                    CarrierKey::Quadric(coefficients.clone().map(|v| v / pivot)),
                    pivot < &q(0.),
                )
            }
            other => panic!("unexpected quarter surface {other:?}"),
        };
        let loops = f
            .loops
            .iter()
            .map(|l| {
                let cycle = b.loops[l.0 as usize]
                    .coedges
                    .iter()
                    .map(|c| {
                        let co = &b.coedges[c.0 as usize];
                        let e = &b.edges[co.edge.0 as usize];
                        let (a, c) = (
                            vpos[e.vertices[0].0 as usize],
                            vpos[e.vertices[1].0 as usize],
                        );
                        (
                            epos[co.edge.0 as usize],
                            if co.forward { a < c } else { c < a },
                        )
                    })
                    .collect::<Vec<_>>();
                least(&cycle)
            })
            .collect();
        faces.push(CanonicalFace {
            carrier,
            outward: f.forward != flip,
            loops,
        });
    }
    faces.sort();
    Canonical {
        label: model::Label::Exact,
        vertices,
        edges: edges.into_iter().map(|(e, _)| e).collect(),
        faces,
        shells: vec![(0..b.faces.len()).collect()],
        solids: vec![vec![0]],
    }
}
#[test]
fn ac04_shadow_of_sector_uses_actual_old_geometry_and_oriented_topology() {
    let s = 1. / 1024.;
    let p = [[4., 0.], [8., 0.], [8., 6.], [4., 6.]].map(|p| p.map(|x| x * s));
    for frame in frames() {
        let b = revolve_sector::build(
            key(),
            [0; 4],
            frame,
            &segments(&p),
            std::f64::consts::FRAC_PI_2,
        )
        .unwrap();
        revolve_sector::audit(&b.clone().check().unwrap()).unwrap();
        let new = new_model(&p, 90, Frame::identity());
        assert_eq!(new.canonical(), quarter_canonical(&b));
    }
}
