use num_traits::Zero;
use wonky_bool::{fold_models, Op};
use wonky_geom::{
    frame::Frame,
    model::{self, Model, PiValue},
    Q,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn cyl(x: Q, y: Q, z0: Q, z1: Q, r: Q) -> Model {
    let f = Frame::new(
        [x, y, q(0)],
        [[q(1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]],
    )
    .unwrap();
    model::revolution::revolution(
        Frame::identity(),
        f,
        &[
            [q(0), z0.clone()],
            [r.clone(), z0],
            [r, z1.clone()],
            [q(0), z1],
        ],
        0,
    )
    .unwrap()
    .check()
    .unwrap()
}
#[test]
fn shared_cap_union_is_a_single_band_and_has_exact_green_volume() {
    let a = cyl(q(0), q(0), q(0), q(8), q(4));
    let b = cyl(q(0), q(0), q(8), q(16), q(4));
    let result = fold_models(Op::Union, &[&a, &b], 5).unwrap();
    let expected = cyl(q(0), q(0), q(0), q(16), q(4));
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].canonical(), expected.canonical());
    assert_eq!(
        wonky_bool::periodic::surface_area_model(&result[0], wonky_bool::split::BUDGET).unwrap(),
        vec![PiValue {
            rational: q(0),
            pi: q(160),
            pi2: q(0),
        }]
    );
    assert_eq!(
        wonky_bool::periodic::measure_model(&result[0], wonky_bool::split::BUDGET).unwrap(),
        vec![PiValue {
            rational: q(0),
            pi: q(1536),
            pi2: q(0),
        }]
    );
}
#[test]
fn coaxial_subtraction_builds_an_annulus_without_virtual_vertices() {
    let a = cyl(q(0), q(0), q(0), q(14), q(9));
    let b = cyl(q(0), q(0), q(-2), q(16), q(3));
    let result = fold_models(Op::Subtraction, &[&a, &b], 5).unwrap();
    assert_eq!(result.len(), 1);
    assert!(result[0].draft().vertices.is_empty());
    assert_eq!(
        wonky_bool::periodic::surface_area_model(&result[0], wonky_bool::split::BUDGET).unwrap(),
        vec![PiValue {
            rational: q(0),
            pi: q(480),
            pi2: q(0),
        }]
    );
    assert_eq!(
        wonky_bool::periodic::measure_model(&result[0], wonky_bool::split::BUDGET).unwrap(),
        vec![PiValue {
            rational: q(0),
            pi: q(6048),
            pi2: q(0),
        }]
    );
}
#[test]
fn tangent_and_sub_resolution_cylinders_keep_separate_solids() {
    let a = cyl(q(0), q(0), q(0), q(16), q(4));
    for gap in [Q::zero(), Q::new(1.into(), (1u64 << 30).into())] {
        let b = cyl(q(8) + gap, q(0), q(0), q(16), q(4));
        let result = fold_models(Op::Union, &[&a, &b], 5).unwrap();
        assert_eq!(result.len(), 2);
        let mut actual = result
            .iter()
            .map(|m| m.canonical().to_string())
            .collect::<Vec<_>>();
        actual.sort();
        let mut expected = [a.canonical().to_string(), b.canonical().to_string()];
        expected.sort();
        assert_eq!(actual, expected);
    }
}

use wonky_contract::BodyKey;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder, orthogonal, polyhedron, shadow,
};
fn key() -> BodyKey {
    BodyKey {
        id: [314, 159, 265, 358],
        revision: 0,
    }
}
fn cylinder_input(bottom: [f64; 3], top: [f64; 3], radius: f64, frame: Affine) -> Solid {
    let c = cylinder::audit(
        &cylinder::create(
            key(),
            cylinder::Spec {
                bottom: bottom.map(|x| x * 0.001),
                top: top.map(|x| x * 0.001),
                radius: radius * 0.001,
            },
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap();
    Solid::Cylinder(
        cylinder::audit(&cylinder::transform(&c, frame).unwrap().check().unwrap()).unwrap(),
    )
}
fn box_input(lo: [f64; 3], hi: [f64; 3], frame: Affine) -> Solid {
    let a = polyhedron::audit(
        &orthogonal::cuboid(key(), lo.map(|x| x * 0.001), hi.map(|x| x * 0.001))
            .unwrap()
            .check()
            .unwrap(),
    )
    .unwrap();
    Solid::Planar(
        polyhedron::audit(&orthogonal::transform(&a, frame).unwrap().check().unwrap()).unwrap(),
    )
}
fn frozen_frames() -> Vec<Affine> {
    use wonky_contract::Frame;
    include_str!("../../wonky-ops/tests/data/acid-curved-wc0.txt")
        .lines()
        .filter(|l| l.starts_with("AC18 "))
        .map(|l| {
            let hex = l.split_whitespace().nth(5).unwrap();
            let words = hex
                .as_bytes()
                .chunks(8)
                .map(|s| u32::from_str_radix(std::str::from_utf8(s).unwrap(), 16).unwrap())
                .collect::<Vec<_>>();
            let b = wonky_wire::v3::decode(&words).unwrap();
            let Frame::Interpreter { origin, x, z, .. } = &b.body().frames[1] else {
                panic!("frozen frame")
            };
            Affine {
                origin: origin.map(|a| a.get()),
                x: x.map(|a| a.get()),
                z: z.map(|a| a.get()),
            }
        })
        .collect()
}
fn cases(frame: Affine, dr: f64) -> Vec<(&'static str, u8, Vec<Solid>)> {
    let cyl = |p0, p1, r| cylinder_input(p0, p1, r, frame);
    let bx = |a, b| box_input(a, b, frame);
    let mut plate = vec![bx([0., 0., 0.], [32., 32., 4.])];
    for [x, y] in [[8., 8.], [24., 8.], [8., 24.], [24., 24.]] {
        plate.push(cyl([x, y, -2.], [x, y, 6.], 2.));
    }
    vec![
        ("AC18", 1, plate),
        (
            "AC21",
            0,
            vec![
                cyl([0., 0., 0.], [0., 0., 8.], 4.),
                cyl([0., 0., 8.], [0., 0., 16.], 4.),
            ],
        ),
        (
            "AC22",
            0,
            vec![
                cyl([0., 0., 0.], [0., 0., 16.], 4.),
                cyl([8., 0., 0.], [8., 0., 16.], 4.),
            ],
        ),
        (
            "AC23",
            1,
            vec![
                bx([0., 0., 0.], [16., 16., 8.]),
                cyl([8., -4., -2.], [8., -4., 10.], 4.),
            ],
        ),
        (
            "AC44",
            0,
            vec![
                cyl([0., 0., 0.], [0., 0., 16.], 4.),
                cyl(
                    [8. + 2f64.powi(-30), 0., 0.],
                    [8. + 2f64.powi(-30), 0., 16.],
                    4.,
                ),
            ],
        ),
        (
            "AC47",
            1,
            vec![
                bx([0., 0., 0.], [64., 64., 8.]),
                cyl([32., 32., -1.], [32., 32., 9.], 2f64.powi(-8)),
            ],
        ),
        (
            "AC61",
            1,
            vec![
                cyl([0., 0., 0.], [0., 0., 14.], 9. + dr),
                cyl([0., 0., -2.], [0., 0., 16.], 3. + dr),
            ],
        ),
        (
            "AC63",
            1,
            vec![
                bx([0., 0., 0.], [32., 24., 10.]),
                cyl([16., 12., 4.], [16., 12., 12.], 3. + dr),
            ],
        ),
        (
            "AC64",
            1,
            vec![
                bx([0., 0., 0.], [40., 24., 20.]),
                cyl([10., 6., -1.], [10., 6., 21.], 2. + dr),
                cyl([-1., 18., 14.], [41., 18., 14.], 2. + dr),
            ],
        ),
    ]
}
#[test]
fn live_family_boundary_agrees_with_general_geometry_and_green_measures() {
    let frames = frozen_frames();
    assert_eq!(frames.len(), 4);
    let mut cells = 0;
    for (frame_i, frame) in frames.into_iter().enumerate() {
        for (zone, op, inputs) in cases(frame, 0.) {
            let family = analytic::boolean(key(), op, &inputs).unwrap();
            let before = family
                .iter()
                .map(|b| wonky_wire::v3::encode(b).unwrap())
                .collect::<Vec<_>>();
            let line = shadow::line(op, &inputs, &Ok(family.clone()));
            assert!(
                line.contains("\"verdict\":\"equal\""),
                "{zone} frame {frame_i}: {line}"
            );
            assert!(
                line.contains("\"same_measure\":true"),
                "{zone} frame {frame_i}: {line}"
            );
            assert_eq!(
                before,
                family
                    .iter()
                    .map(|b| wonky_wire::v3::encode(b).unwrap())
                    .collect::<Vec<_>>()
            );
            cells += 1;
        }
    }
    for (zone, op, inputs) in cases(Affine::IDENTITY, 0.025)
        .into_iter()
        .filter(|c| ["AC61", "AC63", "AC64"].contains(&c.0))
    {
        let family = analytic::boolean(key(), op, &inputs).unwrap();
        let line = shadow::line(op, &inputs, &Ok(family));
        assert!(
            line.contains("\"verdict\":\"equal\""),
            "{zone} radius perturbation: {line}"
        );
        cells += 1;
    }
    assert_eq!(cells, 39);
}

#[test]
fn nary_union_preserves_all_exact_disconnected_solids() {
    let a = cyl(q(0), q(0), q(0), q(16), q(4));
    let b = cyl(q(20), q(0), q(0), q(16), q(4));
    let c = cyl(q(40), q(0), q(0), q(16), q(4));
    let result = fold_models(Op::Union, &[&a, &b, &c], 5).unwrap();
    assert_eq!(result.len(), 3);
    let mut expected = [
        a.canonical().to_string(),
        b.canonical().to_string(),
        c.canonical().to_string(),
    ];
    expected.sort();
    let mut actual = result
        .iter()
        .map(|m| m.canonical().to_string())
        .collect::<Vec<_>>();
    actual.sort();
    assert_eq!(actual, expected);
}
#[test]
fn skew_bore_adapter_requires_a_proved_clearance() {
    use model::Cylinder3;
    let base = box_input([0., 0., 0.], [32., 32., 32.], Affine::IDENTITY)
        .model()
        .unwrap();
    let z = Frame::new(
        [q(16), q(16), q(0)],
        [[q(1), q(0), q(0)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]],
    )
    .unwrap();
    let x = Frame::new(
        [q(0), q(17), q(16)],
        [[q(0), q(1), q(0)], [q(0), q(0), q(1)], [q(1), q(0), q(0)]],
    )
    .unwrap();
    let bores = [z, x].map(|frame| model::revolution::Bore {
        carrier: Cylinder3::new(frame, q(16)).unwrap(),
        extent: [q(-1), q(33)],
    });
    assert_eq!(
        model::revolution::bore_trims(&base, &bores, 9)
            .unwrap_err()
            .0,
        "boolean/ssi-row-unavailable:bore/non-parallel-tools"
    );
}
