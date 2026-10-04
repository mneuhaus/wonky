//! Owner tests for exact composed placement: a placed body is placed again by
//! appending an exact map (`Frame::AffineImage` / `Frame::InterpreterImage`) to
//! its frame chain. Oracles are independent rational (BigRational) products of
//! the binary64 inputs; nothing here calls a rounding helper of the code under
//! test to compute an expectation. Regression classes: composition rounded
//! through binary64, order mistakes (T2(T1(p)) vs T1(T2(p))), singular maps
//! accepted, a composed body refused or silently re-based.
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive};
use wonky_contract::*;
use wonky_geom::frame::Frame as QFrame;
use wonky_num::p2;
use wonky_ops::{
    affine::Affine,
    cylinder::{self, Spec},
    extrude::{blind_prism, Prism},
    orthogonal, pattern,
    placement::Post,
    polyhedron::{audit, Audited},
};
use wonky_oracle::binary64;
use wonky_sketch::region::lines_region;

fn q(x: f64) -> Q {
    binary64(x).unwrap()
}
fn key(k: u32) -> BodyKey {
    BodyKey { id: [k, 2, 3, 4], revision: k }
}
fn prism(frame: Affine) -> Audited {
    let points = [[0.002, 0.], [0.007, 0.], [0.002, 0.005]];
    let segments: Vec<_> = points.iter().enumerate().map(|(i, a)| {
        let b = points[(i + 1) % 3];
        [a[0], a[1], b[0], b[1]]
    }).collect();
    let pairs: Vec<_> = segments.iter().map(|s| [p2(s[0], s[1]), p2(s[2], s[3])]).collect();
    let region = lines_region(&pairs).unwrap();
    let body = blind_prism(&Prism { key: key(1), source: [0; 4], frame, segments: &segments, region: &region.loops[0], depth: 0.003, reverse: false }).unwrap();
    audit(&body.check().unwrap()).unwrap()
}
fn skew() -> Affine {
    Affine { origin: [0.4995830860227657, 0.49987329024944255, 0.00022344449278308316], x: [0.9953610106153096, 0.08075849942674315, -0.05229266982293196], z: [0.05443374184663523, -0.024540530893688527, 0.9982157733135806] }
}
/// A binary64 rotation about a skew axis: cos/sin are rounded, so the matrix is
/// only near-orthonormal and its exact square is not a binary64 matrix.
fn rotation(angle: f64) -> [[f64; 3]; 3] {
    let axis = [0.36, 0.48, 0.8];
    let (s, c) = angle.sin_cos();
    let mut r = [[0.; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            let k = if i == j { 1. } else { 0. };
            let cross = [[0., -axis[2], axis[1]], [axis[2], 0., -axis[0]], [-axis[1], axis[0], 0.]][i][j];
            r[i][j] = c * k + (1. - c) * axis[i] * axis[j] + s * cross;
        }
    }
    r
}
/// The exact rational frame of a post map, independent of `Post::exact`.
fn oracle(post: &Post) -> QFrame {
    let (origin, columns) = match post {
        Post::Rational { rows, denominator } => ([q(0.), q(0.), q(0.)], [0, 1, 2].map(|j| [0, 1, 2].map(|k| q(rows[k][j]) / q(*denominator)))),
        Post::Rows { translation, rows } => (translation.map(q), [0, 1, 2].map(|j| [0, 1, 2].map(|k| q(rows[k][j])))),
        Post::LocalQuarter(k) => {
            let (c,s) = [(1.,0.),(0.,1.),(-1.,0.),(0.,-1.)][*k as usize];
            ([q(0.),q(0.),q(0.)], [[q(c),q(s),q(0.)],[q(-s),q(c),q(0.)],[q(0.),q(0.),q(1.)]])
        },
        Post::Interpreter(a) => {
            let (x, z) = (a.x.map(q), a.z.map(q));
            let y = [&z[1] * &x[2] - &z[2] * &x[1], &z[2] * &x[0] - &z[0] * &x[2], &z[0] * &x[1] - &z[1] * &x[0]];
            (a.origin.map(q), [x, y, z])
        }
    };
    QFrame::new(origin, columns).unwrap()
}
fn source_oracle(f: Affine) -> QFrame {
    oracle(&Post::Interpreter(f))
}
/// then(first) followed by post: exactly post(first(p)).
fn product(post: &QFrame, first: &QFrame) -> QFrame {
    QFrame::new(post.point(first.origin()), first.columns().each_ref().map(|c| post.vector(c))).unwrap()
}
fn nearest(x: &Q) -> f64 {
    let seed = x.to_f64().unwrap();
    [seed.next_down(), seed, seed.next_up()]
        .into_iter()
        .min_by(|a, b| (x - q(*a)).abs().cmp(&(x - q(*b)).abs()).then_with(|| (a.to_bits() & 1).cmp(&(b.to_bits() & 1))))
        .unwrap()
}
fn round_trip(a: &Audited) -> Audited {
    audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&a.body).unwrap()).unwrap()).unwrap()
}
fn assert_world_matches(a: &Audited, source: &Audited, exact: &QFrame, what: &str) {
    assert_eq!(a.frame.exact_frame().unwrap(), *exact, "{what}: exact frame");
    let world = a.world_vertices_mm().unwrap();
    for (i, v) in source.body.vertices.iter().enumerate() {
        let p = exact.point(&v.point.map(|c| q(c.get())));
        for k in 0..3 {
            assert_eq!(world[i][k], nearest(&(p[k].clone() * q(1000.))), "{what}: vertex {i} axis {k}");
        }
    }
}
fn place(a: &Audited, k: u32, post: Post) -> Audited {
    pattern::place(a, key(k), &post).unwrap()
}

fn mixed_chain() -> [Post; 3] {
    let r1 = rotation(0.31);
    let r3 = rotation(-1.17);
    [
        Post::Rows { translation: [0.0123, -0.0456, 0.0078], rows: r1 },
        Post::Interpreter(Affine { origin: [-0.0031, 0.0217, 0.0009], x: [0.8, 0.6, 0.0], z: [0.0, 0.0, 1.0] }),
        Post::Rows { translation: [0.0011, 0.0005, -0.0023], rows: r3 },
    ]
}

#[test]
fn mixed_chain_is_the_exact_product_in_every_grouping() {
    let source = prism(skew());
    let posts = mixed_chain();
    let mut placed = source.clone();
    let mut expected = source_oracle(skew());
    for (i, post) in posts.iter().enumerate() {
        placed = place(&placed, 10 + i as u32, *post);
        expected = product(&oracle(post), &expected);
        assert_world_matches(&placed, &source, &expected, &format!("step {i}"));
    }
    // Associativity: (c b) a and c (b a) are the same exact frame as the chain.
    let [a, b, c] = posts.map(|p| oracle(&p));
    let right = product(&c, &product(&b, &a));
    let left_maps = QFrame::new(
        product(&c, &b).point(a.origin()),
        a.columns().each_ref().map(|col| product(&c, &b).vector(col)),
    )
    .unwrap();
    let start = source_oracle(skew());
    assert_eq!(product(&right, &start), expected);
    assert_eq!(product(&left_maps, &start), expected);
    // The composed body survives the wire and its audit, and keeps its lineage.
    assert_world_matches(&round_trip(&placed), &source, &expected, "round trip");
    assert_eq!(placed.body.frames.len(), source.body.frames.len() + 3);
    assert!(placed.body.frames.iter().any(|f| matches!(f, Frame::InterpreterImage { .. })));
    assert_eq!(source.body.constructions, placed.body.constructions[..source.body.constructions.len()]);
}

#[test]
fn exact_inverse_returns_the_source_placement() {
    // Signed permutations with dyadic translations invert exactly in binary64.
    let rows = [[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]];
    let inverse_rows = [[0., 1., 0.], [-1., 0., 0.], [0., 0., 1.]];
    let t = [0.25, -0.5, 0.125];
    // inverse translation = -(rows^T t) = -(inverse_rows t)
    let it: [f64; 3] = std::array::from_fn(|k| -(0..3).map(|j| inverse_rows[k][j] * t[j]).sum::<f64>());
    let source = prism(skew());
    let there = place(&source, 20, Post::Rows { translation: t, rows });
    let back = place(&there, 21, Post::Rows { translation: it, rows: inverse_rows });
    assert_ne!(there.frame.exact_frame().unwrap(), source.frame.exact_frame().unwrap());
    assert_eq!(back.frame.exact_frame().unwrap(), source.frame.exact_frame().unwrap());
    assert_eq!(back.world_vertices_mm().unwrap(), source.world_vertices_mm().unwrap());
    // An interpreter post inverts the same way: q -> (0.5 - q.y, q.x + 0.25, q.z - 0.125).
    let turn = Affine { origin: [0.5, 0.25, -0.125], x: [0., 1., 0.], z: [0., 0., 1.] };
    let turned = place(&source, 22, Post::Interpreter(turn));
    assert_ne!(turned.frame.exact_frame().unwrap(), source.frame.exact_frame().unwrap());
    let undone = place(&turned, 23, Post::Rows { translation: [-0.25, 0.5, 0.125], rows: [[0., 1., 0.], [-1., 0., 0.], [0., 0., 1.]] });
    assert_eq!(undone.frame.exact_frame().unwrap(), source.frame.exact_frame().unwrap());
    assert_eq!(undone.world_vertices_mm().unwrap(), source.world_vertices_mm().unwrap());
}

#[test]
fn skew_rotation_composed_twice_stays_exact_and_binary64_composition_is_detected() {
    let r = rotation(0.7);
    let t = [0.013, -0.021, 0.0047];
    let source = prism(skew());
    let once = place(&source, 30, Post::Rows { translation: t, rows: r });
    let twice = place(&once, 31, Post::Rows { translation: t, rows: r });
    let mut expected = source_oracle(skew());
    for _ in 0..2 {
        expected = product(&oracle(&Post::Rows { translation: t, rows: r }), &expected);
    }
    assert_world_matches(&twice, &source, &expected, "exact chain");
    // Planted negative: the same two placements composed in binary64 (one
    // rounded matrix product and translation) are a different map, so the exact
    // check above fails for it. This is the mutation the test guards against.
    let mut m = [[0.; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (0..3).map(|k| r[i][k] * r[k][j]).sum();
        }
    }
    let mt: [f64; 3] = std::array::from_fn(|k| (0..3).map(|j| r[k][j] * t[j]).sum::<f64>() + t[k]);
    let rounded = place(&source, 32, Post::Rows { translation: mt, rows: m });
    assert_ne!(rounded.frame.exact_frame().unwrap(), expected, "binary64 composition must differ from the exact product");
    assert_ne!(rounded.world_vertices_mm().unwrap(), twice.world_vertices_mm().unwrap(), "a rounded composition moves a vertex");
}

#[test]
fn singular_or_non_rigid_maps_refuse_by_name() {
    let source = prism(skew());
    let zero = Post::Rows { translation: [0.; 3], rows: [[0.; 3]; 3] };
    let flat = Post::Rows { translation: [0.; 3], rows: [[1., 0., 0.], [1., 0., 0.], [0., 0., 1.]] };
    let parallel = Post::Interpreter(Affine { origin: [0.; 3], x: [1., 0., 0.], z: [2., 0., 0.] });
    for (name, post) in [("zero", zero), ("two equal rows", flat), ("parallel axes", parallel)] {
        let refused = pattern::place(&source, key(40), &post).expect_err(name);
        assert!(refused.0.starts_with("pattern/"), "{name}: {}", refused.0);
    }
    // The same maps through the interpreter transform of an already placed body.
    let placed = place(&source, 41, Post::Rows { translation: [0.01, 0., 0.], rows: rotation(0.2) });
    let refused = orthogonal::transform(&placed, Affine { origin: [0.; 3], x: [1., 0., 0.], z: [2., 0., 0.] }).expect_err("parallel");
    assert_eq!(refused.0, "orthogonal/non-rigid-placement");
}

#[test]
fn a_placed_box_and_cylinder_are_placed_again_exactly() {
    let f1 = skew();
    let f2 = Affine { origin: [0.0021, -0.0134, 0.0005], x: [0.6, 0., 0.8], z: [-0.8, 0., 0.6] };
    let f3 = Affine { origin: [-0.0007, 0.0042, 0.0013], x: [0.9950041652780258, 0.09983341664682815, 0.], z: [0., 0., 1.] };
    let cuboid = orthogonal::cuboid(key(50), [0.001, 0.002, 0.003], [0.009, 0.007, 0.006]).unwrap();
    let mut a = audit(&cuboid.check().unwrap()).unwrap();
    let source = a.clone();
    let mut expected = QFrame::identity();
    for (i, f) in [f1, f2, f3].into_iter().enumerate() {
        a = audit(&orthogonal::transform(&a, f).unwrap().check().unwrap()).unwrap();
        expected = if i == 0 { source_oracle(f) } else { product(&source_oracle(f), &expected) };
        assert_world_matches(&a, &source, &expected, &format!("box placement {i}"));
    }
    assert_world_matches(&round_trip(&a), &source, &expected, "box round trip");

    let spec = Spec { bottom: [0.001, 0.002, 0.], top: [0.001, 0.002, 0.016], radius: 0.004 };
    let mut c = cylinder::audit(&cylinder::create(key(51), spec).unwrap().check().unwrap()).unwrap();
    let mut expected = QFrame::identity();
    for (i, f) in [f1, f2, f3].into_iter().enumerate() {
        c = cylinder::audit(&cylinder::transform(&c, f).unwrap().check().unwrap()).unwrap();
        expected = if i == 0 { source_oracle(f) } else { product(&source_oracle(f), &expected) };
        assert_eq!(c.frame.exact_frame().unwrap(), expected, "cylinder placement {i}");
    }
}

#[test]
fn a_placed_box_whose_lineage_is_not_the_replayed_placement_refuses() {
    // A wire body is untrusted: the audit accepts a placed box only if replaying
    // its recorded placement on the unplaced body reproduces it exactly. A stray
    // lineage wrapper (valid contract, valid unplaced source) must not pass.
    let f2 = Affine { origin: [0.0021, -0.0134, 0.0005], x: [0.6, 0., 0.8], z: [-0.8, 0., 0.6] };
    let cuboid = orthogonal::cuboid(key(60), [0.001, 0.002, 0.003], [0.009, 0.007, 0.006]).unwrap();
    let once = audit(&orthogonal::transform(&audit(&cuboid.check().unwrap()).unwrap(), skew()).unwrap().check().unwrap()).unwrap();
    let twice = orthogonal::transform(&once, f2).unwrap();
    assert!(matches!(twice.frames.last(), Some(Frame::InterpreterImage { .. })));
    audit(&twice.clone().check().unwrap()).expect("the replayed placement audits");
    let mut tampered = twice;
    let stray = tampered.constructions.last().unwrap().clone();
    tampered.constructions.push(stray);
    let refused = audit(&tampered.check().expect("stray wrapper is contract-valid")).expect_err("stray lineage");
    assert_eq!(refused.0, "audit/placement-not-replayed");
}

#[test]
fn rational_images_compose_with_translations_and_inverse_without_rounding() {
    let source = prism(Affine::IDENTITY);
    let rotation = Post::Rational { rows: [[4.,-3.,0.],[3.,4.,0.],[0.,0.,5.]], denominator: 5. };
    let inverse = Post::Rational { rows: [[4.,3.,0.],[-3.,4.,0.],[0.,0.,5.]], denominator: 5. };
    let there = place(&source, 80, rotation);
    let exact = oracle(&rotation);
    assert_world_matches(&round_trip(&there), &source, &exact, "rational wire image");
    assert_eq!(there.frame.orthonormality_defect().unwrap(), 0.);
    let moved = place(&there, 81, Post::Interpreter(Affine { origin: [0.125,-0.25,0.5], ..Affine::IDENTITY }));
    let move_oracle = oracle(&Post::Interpreter(Affine { origin: [0.125,-0.25,0.5], ..Affine::IDENTITY }));
    assert_world_matches(&round_trip(&moved), &source, &product(&move_oracle,&exact), "translation after rational");
    let back = place(&there, 82, inverse);
    assert_world_matches(&round_trip(&back), &source, &QFrame::identity(), "exact rational inverse");
    assert!(there.frame.apply_exact([1.,0.,0.],1.,true).is_err(), "non-dyadic coordinate must not become an expansion approximation");
}

#[test]
fn rational_observation_encloses_non_dyadic_vertices_and_never_claims_exact_expansions() {
    let body = orthogonal::cuboid(key(80), [0.;3], [1.;3]).unwrap();
    let source = audit(&body.check().unwrap()).unwrap();
    let post = Post::Rational { rows: [[12.,-5.,0.],[5.,12.,0.],[0.,0.,13.]], denominator: 13. };
    let rotated = place(&source, 81, post);
    let exact = oracle(&post);
    for p in [[1.,0.,0.], [0.,1.,0.], [1.,1.,1.]] {
        let world = exact.point(&p.map(q)).map(|v| v * q(1000.));
        let balls = rotated.frame.apply_enclosed(p, 1000., true).unwrap();
        for k in 0..3 {
            assert!(q(balls[k].lo()) <= world[k] && world[k] <= q(balls[k].hi()));
            assert!(balls[k].r < 1e-9);
        }
    }
    assert!(rotated.frame.apply_exact([1.,0.,0.], 1000., true).is_err());
    let normal = rotated.frame.cofactor_observed([1.,0.,0.]).unwrap();
    for (v, expected) in normal.into_iter().zip([Q::new(12.into(),13.into()),Q::new(5.into(),13.into()),q(0.)]) {
        assert!((q(v) - expected).abs() <= q(f64::EPSILON));
    }
    let inverse = Post::Rational { rows: [[12.,5.,0.],[-5.,12.,0.],[0.,0.,13.]], denominator: 13. };
    let restored = place(&rotated, 82, inverse);
    assert_eq!(restored.frame.apply_exact([1.;3],1000.,true).unwrap(), [vec![1000.],vec![1000.],vec![1000.]]);
}

#[test]
fn public_point_measurement_preserves_exact_world_units_and_existing_mapping_refusals() {
    use wonky_ops::polyhedron::Probe;
    let body = orthogonal::cuboid(key(90), [0.;3], [1.;3]).unwrap();
    let source = audit(&body.check().unwrap()).unwrap();
    for wrapped in [false,true] {
        let mut a = if wrapped { place(&source, 91, Post::Rational { rows: [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]],denominator:1. }) } else { source.clone() };
        for (i,x) in [0.001, -2f64.powi(-66)].into_iter().enumerate() {
            a = place(&a,92+i as u32,Post::Interpreter(Affine { origin:[x,0.,0.],..Affine::IDENTITY }));
        }
        let exact_distance = Q::new(67.into(), num_bigint::BigInt::from(1) << 63);
        match a.distance_mm([1.,500.,500.]) {
            Probe::Measured { distance_mm,inside,bound_mm } => {
                assert!(wrapped, "expansion path retains the protected mapping-budget refusal");
                assert!(!inside);
                assert!(distance_mm > bound_mm);
                assert!((q(distance_mm)-exact_distance).abs() <= q(bound_mm));
            },
            Probe::Refused(reason) => {
                assert!(!wrapped, "rational inverse refused: {reason}");
                assert!(reason == "observe/probe-within-mapping-budget" || reason == "observe/interior-probe-within-mapping-budget");
            },
        }
    }
}

#[test]
fn rational_inverse_bounds_enclose_exact_oracle_for_one_ulp_inputs() {
    let source = prism(Affine::IDENTITY);
    let rotation = Post::Rational { rows: [[12.,-5.,0.],[5.,12.,0.],[0.,0.,13.]], denominator: 13. };
    let moved = place(&source, 101, rotation);
    // At [12,5,0] the inverse is exactly [13,0,0]. One ULP in x
    // introduces a non-dyadic thirteenth: a zero error certificate is false.
    for x in [12f64.next_down(), 12., 12f64.next_up(), f64::from_bits(1), 1e-200, 1e100] {
        for scale in [1., 1000.] {
            let world = [x, 5., 0.];
            // Hand-derived inverse of the 5-12-13 rotation, independent
            // of the production frame inversion and enclosure helpers.
            let exact = [(q(12.)*q(x)+q(25.))/(q(13.)*q(scale)),
                (-q(5.)*q(x)+q(60.))/(q(13.)*q(scale)), q(0.)];
            let result = moved.frame.inverse_scaled_approx(world, scale);
            assert!(result.is_ok(), "finite review input should be enclosed");
            if let Ok((mid, bound)) = result {
                let mut inexact = false;
                for k in 0..3 {
                    let residual = (&exact[k]-q(mid[k])).abs();
                    assert!(residual <= q(bound), "x={x:?} scale={scale} axis={k}");
                    inexact |= residual != q(0.);
                }
                if inexact { assert!(bound > 0.); }
                if scale == 1. && x == 12. { assert_eq!(bound, 0.); }
                if scale == 1. && (x == 12f64.next_up() || x == 12f64.next_down()) { assert!(bound > 0.); }
            }
            if scale == 1. {
                if let Ok((mid, bound)) = moved.frame.inverse_approx(world) {
                    for k in 0..3 { assert!((&exact[k]-q(mid[k])).abs() <= q(bound)); }
                }
            }
        }
    }
}

#[test]
fn source_quarter_turns_compose_on_the_right_of_rational_world_images() {
    let source = prism(skew());
    let rotation = Post::Rational { rows: [[5.,0.,0.],[0.,4.,-3.],[0.,3.,4.]], denominator: 5. };
    let rational = place(&source, 120, rotation);
    let base = product(&oracle(&rotation), &source_oracle(skew()));
    for k in 0..4 {
        let local = Post::LocalQuarter(k);
        let placed = place(&rational, 121 + k, local);
        let expected = product(&base, &oracle(&local));
        assert_world_matches(&round_trip(&placed), &source, &expected, "rational then source turn");
        if k != 0 {
            assert_ne!(expected, product(&oracle(&local), &base), "world and source turns differ");
        }
        let world = place(&placed, 130 + k, rotation);
        assert_world_matches(&round_trip(&world), &source, &product(&oracle(&rotation), &expected), "world image after source turn");
    }
}

#[test]
fn placed_curved_source_keeps_analytic_volume_and_area() {
    // A stadium's vertices alone form a rectangle; retaining only a planar
    // payload would lose both semicircular ends in its measured geometry.
    let body = wonky_ops::arc_profile::build(
        key(90), Affine::IDENTITY,
        &[[-10., -5., 10., -5.], [10., 5., -10., 5.]],
        &[[10., -5., 15., 0., 10., 5.], [-10., 5., -15., 0., -10., -5.]],
        4., false,
    ).unwrap();
    let source = audit(&body.check().unwrap()).unwrap();
    let moved = place(&source, 91, Post::Interpreter(Affine {
        origin: [0.25, -0.5, 0.125], ..Affine::IDENTITY
    }));
    let expected_volume = (200. + 25. * std::f64::consts::PI) * 4. * 1e9;
    let expected_area = (2. * (200. + 25. * std::f64::consts::PI)
        + 4. * (40. + 10. * std::f64::consts::PI)) * 1e6;
    assert!((moved.volume_mm3().unwrap() - expected_volume).abs() < expected_volume * 1e-12);
    let area: f64 = moved.face_areas_mm2().unwrap().iter().sum();
    assert!((area - expected_area).abs() < expected_area * 1e-12);
}
