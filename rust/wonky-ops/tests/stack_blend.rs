//! The first tea-box arc keeps all authored binary64 witnesses. Neither a
//! nominal-radius substitution nor a tangent fit is an exact interpretation.
use wonky_curve::numeric::{exact_root, q};
use wonky_curve::{Chart, Trimmed};
#[test]
fn authored_decimal_arc_has_irrational_radius_and_non_tangent_joins() {
    let w = 160. * 0.001_f64;
    let r = 2. * 0.001_f64;
    let k = r * (1. - 1. / 2_f64.sqrt());
    let start = [w - r, 0.];
    let mid = [w - k, k];
    let end = [w, r];
    let arc = Trimmed::arc_through(start, mid, end).unwrap();
    let Chart::Circle(c) = arc.chart() else {
        panic!("circle")
    };
    assert!(
        exact_root(&c.r2).is_none(),
        "the source radius must not be rounded to 2mm"
    );
    assert_ne!(c.c.rat().unwrap()[0], q(start[0]), "bottom join is not exactly tangent");
    assert_ne!(c.c.rat().unwrap()[1], q(end[1]), "right join is not exactly tangent");
}

use wonky_contract::{Binary64, Body, BodyKey, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile, host, orthogonal,
};
fn checked(body: &Body) -> wonky_contract::CheckedBody {
    wonky_wire::v3::decode(&wonky_wire::v3::encode(body).unwrap()).unwrap()
}
fn solid(body: Body) -> Solid {
    analytic::audit(&checked(&body)).unwrap()
}
fn pocketed() -> Body {
    let key = BodyKey {
        id: [91; 4],
        revision: 0,
    };
    let outer = solid(
        arc_profile::build(
            key.clone(),
            Affine::IDENTITY,
            &[[4., 0., 12., 0.], [12., 8., 4., 8.]],
            &[[12., 0., 16., 4., 12., 8.], [4., 8., 0., 4., 4., 0.]],
            6.,
            false,
        )
        .unwrap(),
    );
    let pocket = solid(orthogonal::cuboid(key.clone(), [5., 2., 2.], [11., 6., 8.]).unwrap());
    analytic::boolean(key, 1, &[outer, pocket])
        .unwrap()
        .remove(0)
}
fn blended() -> Body {
    let source = pocketed();
    let words = wonky_wire::v3::encode(&source).unwrap();
    let edges = source
        .edges
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.vertices
                .iter()
                .all(|v| source.vertices[v.0 as usize].point[2].get() == 0.)
        })
        .map(|(i, _)| i as u32)
        .collect::<Vec<_>>();
    let bits = 0.5_f64.to_bits();
    let mut request = vec![
        host::MAGIC,
        host::VERSION,
        host::OP_FILLET,
        words.len() as u32,
    ];
    request.extend(words);
    request.extend([bits as u32, (bits >> 32) as u32, edges.len() as u32]);
    request.extend(edges);
    let result = host::host_op(&request);
    assert_eq!(
        result[0],
        0,
        "{:?}",
        result
            .iter()
            .skip(1)
            .filter_map(|&c| char::from_u32(c))
            .collect::<String>()
    );
    wonky_wire::v3::decode(&result[1..]).unwrap().body().clone()
}
#[test]
fn stacked_band_replays_and_refuses_tampered_carriers() {
    let body = blended();
    assert!(matches!(
        analytic::audit(&checked(&body)).unwrap(),
        Solid::PrismStack(_)
    ));
    let mut changed = body.clone();
    let surface = changed
        .surfaces
        .iter_mut()
        .find(|s| matches!(s.geometry, SurfaceGeometry::Torus { .. }))
        .unwrap();
    let SurfaceGeometry::Torus { minor, .. } = &mut surface.geometry else {
        unreachable!()
    };
    *minor = Binary64::new(0.25).unwrap();
    assert_eq!(
        analytic::audit(&checked(&changed)).unwrap_err().0,
        "stack-blend/construction-mismatch"
    );
}
#[test]
fn boolean_after_a_stack_band_is_an_explicit_refusal() {
    let band = solid(blended());
    let other = solid(
        orthogonal::cuboid(
            BodyKey {
                id: [92; 4],
                revision: 0,
            },
            [20., 20., 0.],
            [21., 21., 1.],
        )
        .unwrap(),
    );
    assert_eq!(
        analytic::boolean(
            BodyKey {
                id: [93; 4],
                revision: 0
            },
            0,
            &[band, other]
        )
        .unwrap_err()
        .0,
        "prism-stack/blended-boolean-unimplemented"
    );
}

fn selected_blend(
    source: &Body,
    edges: &[u32],
    chamfer: bool,
    radius: f64,
) -> Result<Body, String> {
    let words = wonky_wire::v3::encode(source).unwrap();
    let bits = radius.to_bits();
    let mut request = vec![
        host::MAGIC,
        host::VERSION,
        if chamfer {
            host::OP_CHAMFER
        } else {
            host::OP_FILLET
        },
        words.len() as u32,
    ];
    request.extend(words);
    request.extend([bits as u32, (bits >> 32) as u32, edges.len() as u32]);
    request.extend(edges);
    let result = host::host_op(&request);
    if result[0] != 0 {
        return Err(result
            .iter()
            .skip(1)
            .filter_map(|&c| char::from_u32(c))
            .collect());
    }
    Ok(wonky_wire::v3::decode(&result[1..]).unwrap().body().clone())
}
fn pocket_edges(source: &Body, vertical: bool) -> Vec<u32> {
    source
        .edges
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            let a = source.vertices[e.vertices[0].0 as usize]
                .point
                .map(|x| x.get());
            let b = source.vertices[e.vertices[1].0 as usize]
                .point
                .map(|x| x.get());
            if vertical {
                a[0] == b[0]
                    && a[1] == b[1]
                    && a[2] != b[2]
                    && (a[0] == 5. || a[0] == 11.)
                    && (a[1] == 2. || a[1] == 6.)
            } else {
                a[2] == 2. && b[2] == 2.
            }
        })
        .map(|(e, _)| e as u32)
        .collect()
}
#[test]
fn stack_generator_blends_replay_and_authenticate_sewn_carriers() {
    let source = pocketed();
    let edges = pocket_edges(&source, true);
    assert_eq!(edges.len(), 4);
    for chamfer in [false, true] {
        let body = selected_blend(&source, &edges, chamfer, 0.5).unwrap();
        let s = solid(body.clone());
        let measure = s.measure(None, &[]).unwrap();
        let value = measure
            .split("\"volumeMm3\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        // Stadium area 64+16pi, pocket 24*4; each of four hole corners
        // contributes (r²-pi*r²/4)*4, or a triangular r²/2*4 chamfer.
        let expected = (64. + 16. * std::f64::consts::PI) * 6. - 96.
            + if chamfer {
                2.
            } else {
                4. - std::f64::consts::PI
            };
        assert!((value - expected * 1e9).abs() < expected * 1e9 * 1e-12);
        let mut bad = body.clone();
        let vertex = &mut bad.vertices[0];
        vertex.point[0] = Binary64::new(vertex.point[0].get() + 0.125).unwrap();
        assert_eq!(
            analytic::audit(&checked(&bad)).unwrap_err().0,
            "prism-stack/construction-mismatch"
        );
    }
}
#[test]
fn non_tangent_floor_loops_require_corner_patches() {
    let source = pocketed();
    // A rectangle is deliberately not C1: adjacent cylinder patches must
    // share four exact vector-ellipse intersections, never straight chords.
    let edges = pocket_edges(&source, false);
    assert_eq!(edges.len(), 4);
    let body = selected_blend(&source, &edges, false, 0.5).unwrap();
    assert_eq!(body.curves.iter().filter(|c| matches!(c.geometry, wonky_contract::CurveGeometry::VectorEllipse { .. })).count(), 4);
    let measured = solid(body.clone()).measure(None, &[]).unwrap();
    assert!(measured.contains("volumeMm3"));
    let checked_body = checked(&body);
    let mesh = wonky_ops::mesh::tessellate(&checked_body, 2.).unwrap();
    wonky_ops::mesh::check_watertight(&mesh).unwrap();
    assert!(wonky_ops::mesh::binary_stl(&[mesh], 2.).unwrap().len() > 84);
    let step = analytic::step(&[("floor".into(), solid(body.clone()))], "floor").unwrap();
    assert_eq!(step.matches("ELLIPSE(").count(), 4);
    assert!(step.contains("STEP-only harmonic pcurve approximation (1e-9 mm)"));
    let mut bad = body;
    let curve = bad.curves.iter_mut().find(|c| matches!(c.geometry, wonky_contract::CurveGeometry::VectorEllipse { .. })).unwrap();
    if let wonky_contract::CurveGeometry::VectorEllipse { sine, .. } = &mut curve.geometry { sine[2] = Binary64::new(0.25).unwrap(); }
    assert_eq!(analytic::audit(&checked(&bad)).unwrap_err().0, "stack-blend/construction-mismatch");
}
#[test]
fn generator_blend_preserves_exact_sources_through_later_boolean_and_placement() {
    let source = pocketed();
    let edges = pocket_edges(&source, true);
    let band = solid(selected_blend(&source, &edges, false, 0.5).unwrap());
    let moved = band
        .transform(Affine {
            origin: [32., 16., 8.],
            ..Affine::IDENTITY
        })
        .unwrap();
    solid(moved);
    let other = solid(
        orthogonal::cuboid(
            BodyKey {
                id: [93; 4],
                revision: 0,
            },
            [7., 3., 0.],
            [9., 5., 1.],
        )
        .unwrap(),
    );
    for body in analytic::boolean(
        BodyKey {
            id: [94; 4],
            revision: 0,
        },
        1,
        &[band, other],
    )
    .unwrap()
    {
        solid(body);
    }
}
#[test]
fn generator_blends_refuse_collective_face_consumption() {
    let source = pocketed();
    let edges = pocket_edges(&source, true);
    for chamfer in [false, true] {
        assert!(selected_blend(&source, &edges, chamfer, 2.)
            .unwrap_err()
            .contains("adjacent-face-consumed"));
    }
}

#[test]
fn smooth_concave_floor_replays_and_rejects_reversed_face_sense() {
    let key = BodyKey {
        id: [95; 4],
        revision: 0,
    };
    let outer = solid(
        arc_profile::build(
            key.clone(),
            Affine::IDENTITY,
            &[[4., 0., 12., 0.], [12., 8., 4., 8.]],
            &[[12., 0., 16., 4., 12., 8.], [4., 8., 0., 4., 4., 0.]],
            6.,
            false,
        )
        .unwrap(),
    );
    let pocket = solid(
        arc_profile::build(
            key.clone(),
            Affine {
                origin: [0., 0., 2.],
                ..Affine::IDENTITY
            },
            &[[6., 2., 10., 2.], [10., 6., 6., 6.]],
            &[[10., 2., 12., 4., 10., 6.], [6., 6., 4., 4., 6., 2.]],
            6.,
            false,
        )
        .unwrap(),
    );
    let source = analytic::boolean(key, 1, &[outer, pocket])
        .unwrap()
        .remove(0);
    let edges = pocket_edges(&source, false);
    assert_eq!(edges.len(), 4);
    for chamfer in [false, true] {
        let body = selected_blend(&source, &edges, chamfer, 0.5).unwrap();
        let s = solid(body.clone());
        let measure = s.measure(None, &[]).unwrap();
        let value = measure
            .split("\"volumeMm3\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        let pi = std::f64::consts::PI;
        let added = if chamfer {
            (8. + 4. * pi) * 0.25 / 2. - pi * 0.125 / 3.
        } else {
            (8. + 4. * pi) * 0.25 * (1. - pi / 4.) - pi * 0.125 * (5. / 3. - pi / 2.)
        };
        let expected = ((64. + 16. * pi) * 6. - (16. + 4. * pi) * 4. + added) * 1e9;
        assert!((value - expected).abs() < expected * 1e-12);
        let mut bad = body;
        let fi = bad.faces.len() - 1;
        bad.faces[fi].forward = !bad.faces[fi].forward;
        assert_eq!(
            analytic::audit(&checked(&bad)).unwrap_err().0,
            "stack-blend/construction-mismatch"
        );
    }
}

#[test]
fn generator_blends_retain_an_unselected_circular_through_hole() {
    let base = solid(pocketed());
    let key = BodyKey {
        id: [96; 4],
        revision: 0,
    };
    let tool = solid(
        arc_profile::build_region(
            key.clone(),
            Affine::IDENTITY,
            &[],
            &[[2.5, 4., 2., 4.5, 1.5, 4.], [1.5, 4., 2., 3.5, 2.5, 4.]],
            8.,
            false,
            0,
        )
        .unwrap(),
    );
    let source = analytic::boolean(key, 1, &[base, tool]).unwrap().remove(0);
    let edges = pocket_edges(&source, true);
    assert_eq!(edges.len(), 4);
    let result = solid(selected_blend(&source, &edges, false, 0.5).unwrap());
    let measure = result.measure(None, &[]).unwrap();
    let value = measure
        .split("\"volumeMm3\":")
        .nth(1)
        .unwrap()
        .split(',')
        .next()
        .unwrap()
        .parse::<f64>()
        .unwrap();
    let pi = std::f64::consts::PI;
    let expected = ((64. + 16. * pi) * 6. - 96. + 4. - pi - 1.5 * pi) * 1e9;
    assert!((value - expected).abs() < expected * 1e-12);
}

#[test]
fn generator_construction_admission_rejects_malformed_sizes_and_indices() {
    let source = pocketed();
    let edges = pocket_edges(&source, true);
    let body = selected_blend(&source, &edges, false, 0.5).unwrap();
    for (parameter, value) in [(0, 0.), (0, -1.), (1, 0.5), (1, -1.)] {
        let mut bad = body.clone();
        bad.constructions.last_mut().unwrap().parameters[parameter] = Binary64::new(value).unwrap();
        assert_eq!(
            bad.check().unwrap_err(),
            wonky_contract::ContractError::UnsupportedWitness(10)
        );
    }
}
