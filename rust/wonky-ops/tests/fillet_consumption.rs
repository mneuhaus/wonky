//! F1c: face consumption at the critical radius on the general plane/plane
//! surgery (frozen Onshape probes FP03 and FP04, fixtures/fillet/reference.json).
//! The cube is the probes' 10 mm extrusion; lengths are metres as on the wire.
use std::f64::consts::PI;
use wonky_contract::{Body, BodyKey};
use wonky_ops::{
    analytic::{self, Solid},
    affine::Affine,
    extrude::{blind_prism, Prism},
    fillet,
    polyhedron::{audit, Audited},
};
const MM: f64 = 0.001;
/// The probes' input: a 10 mm square sketched on z = 0, extruded BLIND 10 mm
/// (the opExtrude path the FeatureScript fixture takes, not a cuboid family).
fn cube() -> Audited {
    let s = 10. * MM;
    let lines = [[0., 0., s, 0.], [s, 0., s, s], [s, s, 0., s], [0., s, 0., 0.]];
    let segments = lines.map(|p| [wonky_num::p2(p[0], p[1]), wonky_num::p2(p[2], p[3])]);
    let regions = wonky_sketch::region::lines_region(&segments).unwrap();
    let body = blind_prism(&Prism {
        key: BodyKey {
            id: [3, 5, 7, 11],
            revision: 0,
        },
        source: [3, 5, 7, 11],
        frame: Affine::IDENTITY,
        segments: &lines,
        region: &regions.loops[0],
        depth: s,
        reverse: false,
    })
    .unwrap();
    audit(&body.check().unwrap()).unwrap()
}
/// Edges whose two ends agree with `near` on the two fixed coordinates.
fn select(a: &Audited, near: [Option<f64>; 3]) -> Vec<usize> {
    let mut out = vec![];
    for (i, e) in a.body.edges.iter().enumerate() {
        if e.vertices.len() != 2 {
            continue;
        }
        let p = e
            .vertices
            .iter()
            .map(|v| a.body.vertices[v.0 as usize].point.map(|x| x.get()))
            .collect::<Vec<_>>();
        if (0..3).all(|k| near[k].map_or(p[0][k] != p[1][k], |x| p[0][k] == x && p[1][k] == x)) {
            out.push(i);
        }
    }
    out
}
/// Faces and volume (mm³) of the replayed, wire-decoded result.
fn measure(body: &Body) -> (usize, f64) {
    let words = wonky_wire::v3::encode(body).unwrap();
    let s = analytic::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
    let Solid::Planar(a) = &s else {
        panic!("extrusion expected");
    };
    let m = s.model().unwrap();
    assert_eq!(m.draft().faces.len(), body.faces.len());
    (body.faces.len(), a.volume_mm3().unwrap())
}
fn round(edges: [Option<f64>; 3], count: usize, radius: f64) -> Result<Body, String> {
    let a = cube();
    let e = select(&a, edges);
    assert_eq!(e.len(), count);
    fillet::constant_radius(&a, &e, radius).map_err(|e| e.0)
}
fn close(x: f64, y: f64) -> bool {
    (x - y).abs() <= y.abs() * 1e-12
}

#[test]
fn fp03_radius_equal_to_both_face_widths_consumes_both_supports() {
    let body = round([Some(10. * MM), Some(10. * MM), None], 1, 10. * MM).unwrap();
    let (faces, volume) = measure(&body);
    // Onshape FP03: 5 faces; closed form ΔV = -(1 - π/4) 100 · 10 mm³.
    assert_eq!(faces, 5);
    assert!(close(volume - 1000., -(1. - PI / 4.) * 1000.), "{volume}");
}

#[test]
fn fp04_two_rounds_meeting_on_the_consumed_face_are_one_cylinder() {
    let a = cube();
    let mut e = select(&a, [None, Some(0.), Some(10. * MM)]);
    e.extend(select(&a, [None, Some(10. * MM), Some(10. * MM)]));
    assert_eq!(e.len(), 2);
    let body = fillet::constant_radius(&a, &e, 5. * MM).unwrap();
    let (faces, volume) = measure(&body);
    // Onshape FP04: 6 faces (one half cylinder); ΔV = -2 (1 - π/4) 25 · 10 mm³.
    assert_eq!(faces, 6);
    assert!(close(volume - 1000., -2. * (1. - PI / 4.) * 250.), "{volume}");
}

/// Faces and audited volume (mm³) of the wire-decoded result, without the
/// exact Model view (near-critical slivers are not a Model family yet).
fn measure_wire(body: &Body) -> (usize, f64) {
    let words = wonky_wire::v3::encode(body).unwrap();
    let s = analytic::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap();
    let Solid::Planar(a) = &s else {
        panic!("extrusion expected");
    };
    (body.faces.len(), a.volume_mm3().unwrap())
}

#[test]
fn near_critical_radii_keep_slivers_and_are_never_welded() {
    // 1e-10 m below the face width: each spring line lies 1e-10 m from the
    // far face vertex, distinct in exact arithmetic. An epsilon weld would
    // consume the sliver supports and report FP03's or FP04's topology.
    let r = 10. * MM - 1e-10;
    let body = round([Some(10. * MM), Some(10. * MM), None], 1, r).unwrap();
    let (faces, volume) = measure_wire(&body);
    assert_eq!(faces, 7);
    let mm = r / MM;
    assert!(close(volume - 1000., -(1. - PI / 4.) * mm * mm * 10.), "{volume}");

    let r = 5. * MM - 1e-10;
    let a = cube();
    let mut e = select(&a, [None, Some(0.), Some(10. * MM)]);
    e.extend(select(&a, [None, Some(10. * MM), Some(10. * MM)]));
    let body = fillet::constant_radius(&a, &e, r).unwrap();
    let (faces, volume) = measure_wire(&body);
    assert_eq!(faces, 8);
    let mm = r / MM;
    assert!(close(volume - 1000., -2. * (1. - PI / 4.) * mm * mm * 10.), "{volume}");
}

/// FP10's input: the ridge pentagon (apex 15 × 10.14399408618 mm, dihedral
/// 178.9°) extruded 20 mm. Its sloped faces have irrational unit normals.
fn ridge() -> Audited {
    let h = 10.14399408618 * MM;
    let p = [[0., 0.], [30. * MM, 0.], [30. * MM, 10. * MM], [15. * MM, h], [0., 10. * MM]];
    let lines: [[f64; 4]; 5] =
        std::array::from_fn(|i| [p[i][0], p[i][1], p[(i + 1) % 5][0], p[(i + 1) % 5][1]]);
    let segments = lines.map(|p| [wonky_num::p2(p[0], p[1]), wonky_num::p2(p[2], p[3])]);
    let regions = wonky_sketch::region::lines_region(&segments).unwrap();
    let body = blind_prism(&Prism {
        key: BodyKey {
            id: [3, 5, 7, 13],
            revision: 0,
        },
        source: [3, 5, 7, 13],
        frame: Affine::IDENTITY,
        segments: &lines,
        region: &regions.loops[0],
        depth: 20. * MM,
        reverse: false,
    })
    .unwrap();
    audit(&body.check().unwrap()).unwrap()
}

#[test]
fn fp10_near_tangent_ridge_builds_one_cylinder() {
    let a = ridge();
    let before = a.volume_mm3().unwrap();
    let e = select(&a, [Some(15. * MM), Some(10.14399408618 * MM), None]);
    assert_eq!(e.len(), 1);
    let body = fillet::constant_radius(&a, &e, 2. * MM).unwrap();
    let (faces, volume) = measure(&body);
    // The exact Model: the ball centre lies in Q(sqrt s) (the sloped normals
    // have irrational length), so the blend is one radical-centre cylinder.
    let words = wonky_wire::v3::encode(&body).unwrap();
    let model = analytic::audit(&wonky_wire::v3::decode(&words).unwrap())
        .unwrap()
        .model()
        .unwrap();
    let carriers = &model.draft().surfaces;
    let cylinders = carriers
        .iter()
        .filter_map(|s| match &s.carrier {
            wonky_geom::model::Carrier3::Cylinder(c) => Some(c),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(cylinders.len(), 1);
    assert!(cylinders[0].is_radical());
    assert_eq!(cylinders[0].radius2(), wonky_curve::numeric::q(2. * MM) * wonky_curve::numeric::q(2. * MM));
    assert!(carriers
        .iter()
        .all(|s| matches!(s.carrier, wonky_geom::model::Carrier3::Plane(_) | wonky_geom::model::Carrier3::Cylinder(_))));
    // Onshape FP10: 8 faces (7 planes, 1 cylinder); ΔV = -L r² (cot(α/2) - (π-α)/2)
    // with α the interior dihedral at the ridge, L = 20 mm, r = 2 mm.
    assert_eq!(faces, 8);
    let alpha = PI - 2. * (0.14399408618f64 / 15.).atan();
    let expected = -20. * 4. * (1. / (alpha / 2.).tan() - (PI - alpha) / 2.);
    let delta = volume - before;
    assert!((delta - expected).abs() <= expected.abs() * 1e-3, "{delta} vs {expected}");
}
