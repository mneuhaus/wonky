//! K1: real arrangements, independent symbolic measures, and planted audits.
use wonky_curve::{
    arrange, classify,
    numeric::{pt, q},
    radical::Radical,
    Budget, Cycle, ExactPoint, Param, Refusal, Trimmed,
};
fn radii() -> Vec<Radical> {
    vec![
        q(12.).into(),
        q(55.).into(),
        Radical::quadratic(q(112.), q(40.), q(3.)).unwrap(),
        Radical::quadratic(q(112.), q(-40.), q(3.)).unwrap(),
    ]
}
fn ring(r2: Radical) -> Trimmed {
    Trimmed::circle(pt([0., 0.]), r2, true).unwrap()
}
const LIMIT: Budget = Budget {
    segments: 100,
    pieces: 200,
};
#[test]
fn all_k1_circles_have_exact_cells_winding_and_pi_terms() {
    for r2 in radii() {
        let source = ring(r2.clone());
        assert!(source.ends()[0].rat().is_err());
        let disc = Cycle::new(vec![source.clone()]);
        assert_eq!(disc.circular_region_exact().unwrap().1, r2);
        assert_eq!(
            disc.rectangle_membership(&[pt([-1., -1.]), pt([1., 1.])], false)
                .unwrap(),
            Some(true)
        );
        assert_eq!(
            disc.rectangle_membership(&[pt([20., 20.]), pt([21., 21.])], false)
                .unwrap(),
            Some(false)
        );
        let rectangle = Cycle::polygon(&[[0., -20.], [20., -20.], [20., 20.], [0., 20.]]).unwrap();
        assert_eq!(disc.winding(&ExactPoint::from_f64([1., 0.])).unwrap(), 1);
        assert_eq!(
            disc.reversed()
                .winding(&ExactPoint::from_f64([1., 0.]))
                .unwrap(),
            -1
        );
        assert_eq!(disc.winding(&ExactPoint::from_f64([20., 0.])).unwrap(), 0);
        let mut arr = arrange(&[&disc, &rectangle], LIMIT).unwrap();
        classify(&mut arr, &[&disc, &rectangle]).unwrap();
        assert_eq!(arr.cells.len(), 3, "radius {:?}", r2);
        let mut membership = arr
            .cells
            .iter()
            .map(|c| c.inside.clone())
            .collect::<Vec<_>>();
        membership.sort();
        assert_eq!(
            membership,
            vec![vec![false, true], vec![true, false], vec![true, true]]
        );
        for cell in &arr.cells {
            let mut green = wonky_curve::Green::default();
            for cycle in &cell.cycles {
                green
                    .add(arr.cycle_profile(cycle).green_symbolic().unwrap())
                    .unwrap();
            }
            assert!(green.atan.is_empty(), "diameter cuts have exact pi terms");
            let sign = if cell.inside[0] { q(1.) } else { q(-1.) };
            assert_eq!(green.pi, &r2 * sign / q(2.));
            assert_eq!(
                green.algebraic,
                if cell.inside[0] { q(0.) } else { q(800.) }
            );
        }
        assert_eq!(disc.green_symbolic().unwrap().pi, r2);
    }
}
#[test]
fn quadratic_radius_line_cuts_store_nested_exact_roots() {
    for r2 in radii().into_iter().skip(2) {
        let circle = ring(r2.clone());
        let line = Trimmed::line([1., -20.], [1., 20.]);
        let cuts = line.contacts(&circle).unwrap();
        assert_eq!(cuts.len(), 2);
        assert!(cuts.iter().any(|p| matches!(p, ExactPoint::Algebraic(_))));
        for p in &cuts {
            assert!(circle.contains(p).unwrap());
            assert!(line.contains(p).unwrap());
        }
        let ordered = circle.sorted_cuts(cuts.clone()).unwrap();
        assert_eq!(
            ordered[0].coordinates()[1].sign(),
            std::cmp::Ordering::Greater
        );
        let parts = circle.split(cuts).unwrap();
        assert_eq!(parts.len(), 2);
        for piece in &parts {
            let m = piece.exact_interior_point().unwrap();
            assert!(piece.contains(&m).unwrap());
            assert!(!piece.ends().contains(&m));
        }
        let disc = Cycle::new(vec![circle]);
        let rectangle = Cycle::polygon(&[[1., -20.], [20., -20.], [20., 20.], [1., 20.]]).unwrap();
        let mut arr = arrange(&[&disc, &rectangle], LIMIT).unwrap();
        classify(&mut arr, &[&disc, &rectangle]).unwrap();
        assert_eq!(arr.cells.len(), 3);
        let mut sum = wonky_curve::Green::default();
        for c in arr.cells.iter().filter(|c| c.inside[0]) {
            for lp in &c.cycles {
                sum.add(arr.cycle_profile(lp).green_symbolic().unwrap())
                    .unwrap();
            }
        }
        assert_eq!(sum.pi, r2);
        assert_eq!(sum.algebraic, q(0.));
        assert!(sum.atan.values().all(|v| v.is_zero()));
    }
}
#[test]
fn nonrational_circles_intersect_rational_point_circles() {
    for (i, r2) in radii().into_iter().enumerate() {
        let a = Cycle::new(vec![ring(r2)]);
        let center = if i < 2 { 3. } else { 10. };
        let b = Cycle::new(vec![Trimmed::ring(
            pt([center, 0.]),
            q(25.),
            ExactPoint::from_f64([center + 5., 0.]),
            true,
        )
        .unwrap()]);
        let hits = a.pieces()[0].contacts(&b.pieces()[0]).unwrap();
        assert_eq!(hits.len(), 2);
        for p in &hits {
            assert!(a.contains(p).unwrap());
            assert!(b.contains(p).unwrap());
        }
        let mut arr = arrange(&[&a, &b], LIMIT).unwrap();
        classify(&mut arr, &[&a, &b]).unwrap();
        assert_eq!(arr.cells.len(), 3);
        assert!(arr.cells.iter().any(|c| c.inside == [true, true]));
    }
}
#[test]
fn angular_parameters_order_without_rational_points_or_float_angles() {
    let radius = q(55.);
    let p = |x, y| ExactPoint::from_quadratic(pt([0., 0.]), pt([x, y]), radius.clone()).unwrap();
    let circle = Trimmed::ring(pt([0., 0.]), radius.clone(), p(1., 0.), true).unwrap();
    let points = vec![p(0., -1.), p(-1., 0.), p(0., 1.), p(1., 0.)];
    assert_eq!(
        circle.sorted_cuts(points).unwrap(),
        vec![p(1., 0.), p(0., 1.), p(-1., 0.), p(0., -1.)]
    );
    assert!(Param::Angular(p(0., 1.).coordinates()) < Param::Angular(p(-1., 0.).coordinates()));
}
#[test]
fn stereographic_rational_point_claim_on_55_fails_the_identity_audit() {
    // Stereographic projection needs an actual point on the conic. Pretending
    // (sqrt(55),0) is rational and rotating it yields a rational *wrong* point.
    let anchor = q(55f64.sqrt());
    let t = q(1.);
    let den = q(1.) + &t * &t;
    let fake = ExactPoint::from_rational([
        &anchor * (q(1.) - &t * &t) / &den,
        &anchor * q(2.) * &t / &den,
    ]);
    assert!(fake.rat().is_ok());
    assert_eq!(
        Trimmed::ring(pt([0., 0.]), q(55.), fake, true).unwrap_err(),
        Refusal::RingSeamOffCircle
    );
}
#[test]
fn f64_sqrt_radius_fails_the_identity_audit() {
    let fake = ExactPoint::from_f64([12f64.sqrt(), 0.]);
    assert_eq!(
        Trimmed::ring(pt([0., 0.]), q(12.), fake, true).unwrap_err(),
        Refusal::RingSeamOffCircle
    );
}
mod support;
#[test]
fn exact_green_coefficients_and_cap_enclosures_match_independent_sympy() {
    let oracle = support::json::parse(include_str!("oracle/k1_circles.json"));
    for (r2, row) in radii().into_iter().zip(oracle.get("rows").arr()) {
        let circle = ring(r2.clone());
        let radius = r2.exact_sqrt().unwrap();
        let north = ExactPoint::from_coordinates([Radical::default(), radius.clone()]).unwrap();
        let west = ExactPoint::from_coordinates([-radius, Radical::default()]).unwrap();
        for (end, key) in [(north, "quarter_pi"), (west, "half_pi")] {
            let green = circle
                .trim(circle.ends()[0].clone(), end)
                .unwrap()
                .green_symbolic()
                .unwrap();
            let coefficients = row.get(key).arr();
            let parse = |s: &str| {
                let (a, b) = s.split_once('/').unwrap_or((s, "1"));
                wonky_curve::Q::new(a.parse().unwrap(), b.parse().unwrap())
            };
            let expected = Radical::quadratic(
                parse(coefficients[0].str()),
                parse(coefficients[1].str()),
                q(3.),
            )
            .unwrap();
            assert_eq!(green.pi, expected);
            assert_eq!(green.algebraic, q(0.));
            assert!(green.atan.is_empty());
        }
        let full = circle.green_symbolic().unwrap().enclosure().unwrap();
        let want: f64 = row.get("full_area").str().parse().unwrap();
        assert!(full.lo() <= want && want <= full.hi());
        assert!(full.hi() - full.lo() < 1e-10);
        let cuts = Trimmed::line([1., -20.], [1., 20.])
            .contacts(&circle)
            .unwrap();
        let ordered = circle.sorted_cuts(cuts).unwrap();
        let arc = circle.trim(ordered[1].clone(), ordered[0].clone()).unwrap();
        let chord = Trimmed::new(
            [ordered[0].clone(), ordered[1].clone()],
            wonky_curve::Carrier::Line,
        )
        .unwrap();
        let cap = Cycle::new(vec![arc, chord])
            .green_symbolic()
            .unwrap()
            .enclosure()
            .unwrap();
        let want: f64 = row.get("offset_cap").str().parse().unwrap();
        assert!(cap.lo() <= want && want <= cap.hi(), "{cap:?} vs {want}");
        assert!(cap.hi() - cap.lo() < 1e-10);
    }
}

#[test]
fn circle_admission_and_trim_reject_out_of_class_and_forged_endpoints() {
    let square = Radical::quadratic(q(1.), q(1.), q(2.)).unwrap()
        + Radical::quadratic(q(0.), q(1.), q(3.)).unwrap();
    assert_eq!(
        Trimmed::circle(pt([0., 0.]), square, true).unwrap_err(),
        Refusal::CircleRadiusClass
    );
    let circle = ring(q(55.).into());
    assert_eq!(
        circle
            .trim(circle.ends()[0].clone(), ExactPoint::from_f64([1., 1.]))
            .unwrap_err(),
        Refusal::CirclePointOffCurve
    );
    assert_eq!(
        Trimmed::circle(pt([0., 0.]), q(0.), true).unwrap_err(),
        Refusal::RadiusRange
    );
}

#[test]
fn nested_field_arithmetic_signs_inverses_and_identity_are_exact() {
    let a = Radical::quadratic(q(111.), q(40.), q(3.))
        .unwrap()
        .exact_sqrt()
        .unwrap();
    let b = Radical::quadratic(q(111.), q(-40.), q(3.))
        .unwrap()
        .exact_sqrt()
        .unwrap();
    assert!(a.is_nested() && b.is_nested());
    assert_eq!(&a * &a + &b * &b, q(222.));
    assert_eq!((&a * &b) * (&a * &b), q(7521.));
    assert!((&a - &b).is_positive());
    let sum = &a + &b;
    assert_eq!(&sum * sum.try_inverse().unwrap(), q(1.));
    let epsilon = wonky_curve::Q::new(1.into(), num_bigint::BigInt::from(1) << 220);
    let nearby = &a + epsilon;
    assert_eq!(a.enclosure().unwrap().m, nearby.enclosure().unwrap().m);
    assert!(a < nearby);
    assert_eq!(&a - &a, q(0.));
    assert_eq!((-&a).try_sign().unwrap(), std::cmp::Ordering::Less);
}

#[test]
fn general_quadratic_radius_does_not_require_a_single_quadratic_seam() {
    let r2 = Radical::quadratic(q(5.), q(2.), q(6.)).unwrap();
    let circle = ring(r2.clone());
    assert!(matches!(circle.ends()[0], ExactPoint::Algebraic(_)));
    assert!(circle.contains(circle.ends().first().unwrap()).unwrap());
    let hits = circle
        .contacts(&Trimmed::line([0., -10.], [0., 10.]))
        .unwrap();
    assert_eq!(hits.len(), 2);
    for p in hits {
        assert!(circle.contains(&p).unwrap());
    }
    assert_eq!(circle.green_symbolic().unwrap().pi, r2);
    assert!(circle
        .contains(&circle.exact_interior_point().unwrap())
        .unwrap());
}

#[test]
fn nested_field_capacity_ends_in_a_named_refusal() {
    let result = wonky_curve::radical::guard(|| {
        let mut sum = Radical::default();
        for i in 0..5 {
            let root = Radical::quadratic(q(111. + 2. * i as f64), q(40.), q(3.))
                .unwrap()
                .exact_sqrt()
                .unwrap();
            assert!(root.is_nested());
            sum = sum + root;
        }
        sum
    });
    assert_eq!(result.unwrap_err(), Refusal::RadicalBudget);
}
