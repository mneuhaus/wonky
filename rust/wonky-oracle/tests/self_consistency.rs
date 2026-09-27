use num_rational::BigRational;
use num_traits::{One, Signed, Zero};
use wonky_oracle::*;
fn r(n: i64) -> R {
    R::from_integer(n.into())
}
fn p(x: f64, y: f64, z: f64) -> P3 {
    point3([x, y, z]).unwrap()
}
fn q(x: f64, y: f64) -> P2 {
    point2([x, y]).unwrap()
}
fn face(out: &mut Vec<[P3; 3]>, a: P3, b: P3, c: P3, d: P3) {
    out.push([a.clone(), b, c.clone()]);
    out.push([a, c, d]);
}
fn box_mesh(x: [f64; 2], y: [f64; 2], z: [f64; 2]) -> Vec<[P3; 3]> {
    let v = |i, j, k| p(x[i], y[j], z[k]);
    let mut f = Vec::new();
    face(&mut f, v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0));
    face(&mut f, v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1));
    face(&mut f, v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1));
    face(&mut f, v(1, 1, 0), v(0, 1, 0), v(0, 1, 1), v(1, 1, 1));
    face(&mut f, v(0, 1, 0), v(0, 0, 0), v(0, 0, 1), v(0, 1, 1));
    face(&mut f, v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1));
    f
}

#[test]
fn literal_binary64_is_exact_and_rejects_nonfinite() {
    assert_eq!(binary64(-0.0).unwrap(), R::zero());
    assert_eq!(binary64(0.5).unwrap(), BigRational::new(1.into(), 2.into()));
    assert_eq!(
        binary64(f64::from_bits(1)).unwrap() * r(2).pow(1074),
        R::one()
    );
    assert_eq!(
        binary64(f64::MAX).unwrap(),
        R::from_integer(((1_i64 << 53) - 1).into()) * r(2).pow(971)
    );
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(binary64(value), Err(OracleError::NonFinite));
    }
    let mut generator = adversarial::Generator::new(0x9e37_79b9);
    let mut min_exp = 2047;
    let mut max_exp = 0;
    for _ in 0..10_000 {
        let v = generator.full_range();
        min_exp = min_exp.min(((v.to_bits() >> 52) & 2047) as i32);
        max_exp = max_exp.max(((v.to_bits() >> 52) & 2047) as i32);
        let exact = binary64(v).unwrap();
        assert_eq!(exact, -binary64(-v).unwrap());
        assert_eq!(exact, BigRational::from_float(v).unwrap());
    }
    assert_eq!(min_exp, 0);
    assert_eq!(max_exp, 2046);
}

#[test]
fn plane_side_retains_sign_through_binary64_cancellation_and_extremes() {
    // All expected signs follow from literal binary64 arithmetic, not from
    // another predicate or a rounded floating-point dot product.
    let m = 9_007_199_254_740_992.0; // 2^53: adding 1 to m rounds back to m.
    let tiny = f64::from_bits(1); // Its square underflows in f64, but is positive.
    let zero = p(0.0, 0.0, 0.0);
    for (normal, point) in [
        ([1.0, 1.0, -1.0], [m, 1.0, m]), // m + 1 - m = 1.
        ([tiny, 0.0, 0.0], [tiny, 0.0, 0.0]),
        ([f64::MAX, f64::MAX, 1.0], [f64::MAX, -f64::MAX, 1.0]),
    ] {
        let normal = point3(normal).unwrap();
        let point = point3(point).unwrap();
        assert_eq!(plane_side(&normal, &point, &zero), 1);
        let opposite: P3 = std::array::from_fn(|i| -&normal[i]);
        assert_eq!(plane_side(&opposite, &point, &zero), -1);
    }
}

#[test]
fn geometry_construction_and_incidence_identities() {
    let a = q(1.0, 2.0);
    let b = q(5.0, 2.0);
    let c = q(1.0, 7.0);
    assert_eq!(orientation2d(&a, &b, &c), 1);
    assert_eq!(orientation2d(&b, &a, &c), -1);
    let d = q(3.0, 2.0);
    assert_eq!(orientation2d(&a, &b, &d), 0);
    let a3 = p(1.0, 2.0, 3.0);
    let b3 = p(5.0, 2.0, 3.0);
    let c3 = p(1.0, 7.0, 3.0);
    let d3 = p(1.0, 2.0, 9.0);
    assert_eq!(orientation3d(&a3, &b3, &c3, &d3), 1);
    assert_eq!(orientation3d(&b3, &a3, &c3, &d3), -1);
    let n = p(0.0, 0.0, 2.0);
    assert_eq!(plane_side(&n, &d3, &a3), 1);
    assert_eq!(line_point_side(&n, &p(0.0, 0.0, 3.0), &a3, &d3, &r(2)), 0);
    assert_eq!(dot_sign(&p(1.0, 2.0, 3.0), &p(-2.0, 1.0, 0.0)), 0);
    assert!(parallel(&p(1.0, 2.0, 3.0), &p(-2.0, -4.0, -6.0)));
    assert!(!parallel(&n, &b3));
}

#[test]
fn exact_intersections_roundtrip_and_refuse_parallel() {
    let origin = p(2.0, 3.0, 4.0);
    let dir = p(0.0, 0.0, 2.0);
    let plane_point = p(0.0, 0.0, 7.0);
    let normal = p(0.0, 0.0, 1.0);
    let (t, hit) = plane_line_intersection(&normal, &plane_point, &origin, &dir).unwrap();
    assert_eq!(t, BigRational::new(3.into(), 2.into()));
    assert_eq!(hit, p(2.0, 3.0, 7.0));
    assert_eq!(plane_side(&normal, &hit, &plane_point), 0);
    assert_eq!(
        plane_line_intersection(&normal, &plane_point, &origin, &p(1.0, 0.0, 0.0)),
        Err(OracleError::Degenerate)
    );
    let nx = p(1.0, 0.0, 0.0);
    let ny = p(0.0, 1.0, 0.0);
    let intersection = three_plane_intersection([
        (&nx, &p(2.0, 0.0, 0.0)),
        (&ny, &p(0.0, 3.0, 0.0)),
        (&normal, &plane_point),
    ])
    .unwrap();
    assert_eq!(intersection, hit);
    assert_eq!(
        three_plane_intersection([(&nx, &origin), (&nx, &plane_point), (&normal, &plane_point)]),
        Err(OracleError::Degenerate)
    );
}

#[test]
fn polygon_area_containment_and_reversed_winding() {
    let vertices = vec![q(0.0, 0.0), q(4.0, 0.0), q(4.0, 3.0), q(0.0, 3.0)];
    assert_eq!(polygon_area(&vertices), Ok(r(12)));
    let mut reversed = vertices.clone();
    reversed.reverse();
    assert_eq!(polygon_area(&reversed), Ok(r(-12)));
    for (x, y, expect) in [
        (2.0, 1.0, Containment::Inside),
        (5.0, 1.0, Containment::Outside),
        (4.0, 1.0, Containment::Boundary),
        (0.0, 0.0, Containment::Boundary),
    ] {
        assert_eq!(point_in_polygon(&q(x, y), &vertices), Ok(expect));
        assert_eq!(point_in_polygon(&q(x, y), &reversed), Ok(expect));
    }
    assert_eq!(
        point_in_polygon(&q(0.0, 0.0), &vertices[..2]),
        Err(OracleError::Degenerate)
    );
    let concave = vec![
        q(0.0, 0.0),
        q(3.0, 0.0),
        q(3.0, 1.0),
        q(1.0, 1.0),
        q(1.0, 3.0),
        q(0.0, 3.0),
    ];
    assert_eq!(
        point_in_polygon(&q(2.0, 2.0), &concave),
        Ok(Containment::Outside)
    );
    assert_eq!(
        point_in_polygon(&q(0.5, 2.0), &concave),
        Ok(Containment::Inside)
    );
}

#[test]
fn box_volume_equals_edge_product_and_detects_open_mesh() {
    for (x, y, z) in [
        ([-2.0, 3.0], [1.0, 4.0], [-1.0, 6.0]),
        ([0.5, 4.5], [-8.0, -6.0], [2.0, 3.0]),
    ] {
        let f = box_mesh(x, y, z);
        let expected = binary64(x[1] - x[0]).unwrap()
            * binary64(y[1] - y[0]).unwrap()
            * binary64(z[1] - z[0]).unwrap();
        assert_eq!(polyhedron_volume(&f), Ok(expected.clone()));
        let mut reversed = f.clone();
        for t in &mut reversed {
            t.swap(1, 2);
        }
        assert_eq!(polyhedron_volume(&reversed), Ok(-expected));
        assert_eq!(polyhedron_volume(&f[..11]), Err(OracleError::OpenMesh));
        let mut wrong = f.clone();
        wrong[0].swap(1, 2);
        assert_eq!(polyhedron_volume(&wrong), Err(OracleError::OpenMesh));
    }
}

#[test]
fn exact_distances_and_quadratic_root_certificates() {
    let o = p(0.0, 0.0, 0.0);
    let x = p(3.0, 4.0, 0.0);
    let y = p(0.0, 0.0, 5.0);
    assert_eq!(distance_squared(&o, &x), r(25));
    assert_eq!(compare_distance_squared(&o, &x, &o, &y), 0);
    assert_eq!(compare_distance_squared(&o, &x, &o, &p(1.0, 0.0, 0.0)), 1);
    assert_eq!(
        isolate_quadratic(&r(1), &r(0), &r(1)),
        Ok(QuadraticRoots::None)
    );
    assert_eq!(
        isolate_quadratic(&r(1), &r(-2), &r(1)),
        Ok(QuadraticRoots::One(r(1)))
    );
    assert_eq!(
        isolate_quadratic(&r(1), &r(0), &r(-4)),
        Ok(QuadraticRoots::Two([(r(-2), r(-2)), (r(2), r(2))]))
    );
    // Scaling (x - 1)(x - 2) changes coefficients, never its roots.
    for scale in [2, -3] {
        assert_eq!(
            isolate_quadratic(&r(scale), &r(-3 * scale), &r(2 * scale)),
            Ok(QuadraticRoots::Two([(r(1), r(1)), (r(2), r(2))])),
            "nonmonic quadratic with scale {scale}"
        );
    }
    assert_eq!(
        isolate_quadratic(&r(0), &r(1), &r(1)),
        Err(OracleError::Degenerate)
    );
    if let QuadraticRoots::Two([(lo, hi), (lo2, hi2)]) =
        isolate_quadratic(&r(1), &r(0), &r(-2)).unwrap()
    {
        let polynomial = |v: &R| v * v - r(2);
        assert!(lo <= hi && hi < lo2 && lo2 <= hi2);
        assert!(polynomial(&lo) >= R::zero() && polynomial(&hi) <= R::zero());
        assert!(polynomial(&lo2) <= R::zero() && polynomial(&hi2) >= R::zero());
    } else {
        panic!("expected two isolated irrational roots");
    }
}

// A root bracket is a certificate only when its endpoint signs straddle zero.
// The signs reverse for a negative leading coefficient.
fn assert_quadratic_brackets(a: R, b: R, c: R) {
    let QuadraticRoots::Two([(left_lo, left_hi), (right_lo, right_hi)]) =
        isolate_quadratic(&a, &b, &c).unwrap()
    else {
        panic!("expected two isolated roots");
    };
    assert!(left_lo <= left_hi && left_hi < right_lo && right_lo <= right_hi);
    let polynomial = |x: &R| &a * x * x + &b * x + &c;
    let sign = if a.is_positive() { r(1) } else { r(-1) };
    assert!(sign.clone() * polynomial(&left_lo) >= R::zero());
    assert!(sign.clone() * polynomial(&left_hi) <= R::zero());
    assert!(sign.clone() * polynomial(&right_lo) <= R::zero());
    assert!(sign * polynomial(&right_hi) >= R::zero());
}

#[test]
fn negative_leading_coefficient_isolates_irrational_roots() {
    // -2(x² - 2), whose roots are irrational; a negative scale must
    // still produce two ordered, disjoint, sign-changing brackets.
    assert_quadratic_brackets(r(-2), r(0), r(4));
}

#[test]
fn fractional_coefficients_certify_irrational_roots() {
    // 2x² - x - 2 scaled by 1/4: roots (1 ± sqrt(17))/4.
    assert_quadratic_brackets(
        BigRational::new(1.into(), 2.into()),
        BigRational::new((-1).into(), 4.into()),
        BigRational::new((-1).into(), 2.into()),
    );
}

#[test]
fn plane_plane_line_is_incident_to_both_planes() {
    let n0 = p(2.0, 1.0, 0.0);
    let n1 = p(0.0, 1.0, 3.0);
    let p0 = p(1.0, 4.0, 5.0);
    let p1 = p(0.0, 2.0, 1.0);
    let (at, direction) = plane_plane_intersection(&n0, &p0, &n1, &p1).unwrap();
    assert_eq!(plane_side(&n0, &at, &p0), 0);
    assert_eq!(plane_side(&n1, &at, &p1), 0);
    assert_eq!(dot_sign(&n0, &direction), 0);
    assert_eq!(dot_sign(&n1, &direction), 0);
    let shifted: P3 = std::array::from_fn(|i| &at[i] + r(7) * &direction[i]);
    assert_eq!(plane_side(&n0, &shifted, &p0), 0);
    assert_eq!(plane_side(&n1, &shifted, &p1), 0);
    assert_eq!(
        plane_plane_intersection(&n0, &p0, &n0, &p1),
        Err(OracleError::Degenerate)
    );
}

#[test]
fn constructed_collinearity_and_one_ulp_perturbations() {
    let mut generator = adversarial::Generator::new(0xabbad00d);
    for _ in 0..1000 {
        let (exact, perturbed) = generator.near_collinear();
        let to_points = |coordinates: [[f64; 2]; 3]| coordinates.map(|v| point2(v).unwrap());
        let [a, b, c] = to_points(exact);
        let [p, q, r] = to_points(perturbed);
        assert_eq!(orientation2d(&a, &b, &c), 0);
        assert_eq!(orientation2d(&p, &q, &r), 1);
    }
}

#[test]
fn power_of_two_generator_spans_all_binary64_magnitudes() {
    let mut generator = adversarial::Generator::new(0x2511f1);
    let mut min_exponent = i32::MAX;
    let mut max_exponent = i32::MIN;
    let mut saw_subnormal = false;
    let mut saw_negative = false;
    for _ in 0..50_000 {
        let value = generator.full_power();
        let bits = value.to_bits();
        let exp_bits = ((bits >> 52) & 2047) as i32;
        let exponent = if exp_bits == 0 {
            saw_subnormal = true;
            (bits & ((1u64 << 52) - 1)).trailing_zeros() as i32 - 1074
        } else {
            exp_bits - 1023
        };
        min_exponent = min_exponent.min(exponent);
        max_exponent = max_exponent.max(exponent);
        saw_negative |= value.is_sign_negative();
        assert_eq!(binary64(value).unwrap().abs(), r(2).pow(exponent));
    }
    assert!(saw_subnormal && saw_negative);
    assert_eq!(min_exponent, -1074);
    assert_eq!(max_exponent, 1023);
}
