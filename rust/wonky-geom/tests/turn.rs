use num_traits::One;
use wonky_alg::{Polynomial, Sign};
use wonky_geom::{AngleWitness, Refused, Turn, TurnClass, Q};
fn q(n: i64, d: i64) -> Q {
    Q::new(n.into(), d.into())
}
fn turn(k: i64, n: i64) -> Turn {
    Turn::new(
        (k as f64 * 360. / n as f64) * (std::f64::consts::PI / 180.),
        Some(AngleWitness::Turns(q(k, n))),
    )
    .unwrap()
}
#[test]
fn five_classes_and_exact_zero() {
    for (k, n, class) in [
        (1, 4, TurnClass::Rational),
        (1, 6, TurnClass::Quadratic),
        (1, 24, TurnClass::Radical),
        (1, 7, TurnClass::Algebraic),
    ] {
        assert_eq!(turn(k, n).class(), class)
    }
    assert_eq!(
        Turn::new(0.123, None).unwrap().class(),
        TurnClass::Transcendental
    );
    assert_eq!(
        turn(1, 6).sign(&q(1, 1), &q(0, 1), &q(-1, 2)).unwrap(),
        Sign::Zero
    );
    assert_eq!(
        Turn::new(std::f64::consts::PI / 3., None)
            .unwrap()
            .sign(&q(1, 1), &q(0, 1), &q(-1, 2))
            .unwrap(),
        Sign::Positive
    );
}
#[test]
fn actual_tangent_degrees() {
    assert_eq!(
        turn(1, 3).tangent_minimal_polynomial().unwrap(),
        Polynomial::from_integers(&[-3, 0, 1])
    );
    assert_eq!(
        turn(1, 8).tangent_minimal_polynomial().unwrap(),
        Polynomial::from_integers(&[-1, 2, 1])
    );
    let construction = std::time::Instant::now();
    let t = turn(1, 360);
    eprintln!(
        "T0 degree-48 generator certificate: {:.6} ms",
        construction.elapsed().as_secs_f64() * 1000.
    );
    assert_eq!(t.degree(), Some(48));
    let start = std::time::Instant::now();
    assert_eq!(
        t.sign(&Q::one(), &q(0, 1), &q(-999, 1000)).unwrap(),
        Sign::Positive
    );
    eprintln!(
        "T0 degree-48 Sturm sign predicate: {:.6} ms",
        start.elapsed().as_secs_f64() * 1000.
    );
}
#[test]
fn planted_mismatch_and_old_sentinels() {
    let word = 135. * (std::f64::consts::PI / 180.);
    assert_eq!(
        Turn::new(
            f64::from_bits(word.to_bits() + 1),
            Some(AngleWitness::Turns(q(135, 360)))
        )
        .unwrap_err(),
        Refused("angle/witness-mismatch")
    );
    assert!(wonky_geom::turn::sentinel(std::f64::consts::FRAC_PI_2, 90));
    assert!(wonky_geom::turn::sentinel(std::f64::consts::TAU, 360));
    assert_eq!(turn(1, 4).rational_sin_cos().unwrap(), (q(1, 1), q(0, 1)));
    assert_eq!(turn(1, 1).rational_sin_cos().unwrap(), (q(0, 1), q(1, 1)));
    assert_eq!(
        turn(1, 7).compatible(&turn(1, 9)),
        Err(Refused("turn/field-tower"))
    );
    assert_eq!(
        Turn::new(
            360. / 193. * (std::f64::consts::PI / 180.),
            Some(AngleWitness::Turns(q(1, 193)))
        )
        .unwrap_err(),
        Refused("turn/degree-budget")
    );
}
#[test]
fn atan_witnesses_require_the_constructed_word_without_a_tolerance() {
    let x = 0.1;
    let upper = 0x3fb983e282e2cc4du64;
    for sign in [0, 1u64 << 63] {
        let input = if sign == 0 { x } else { -x };
        let witness = AngleWitness::Tan(wonky_geom::binary64(input).unwrap());
        // Standalone fdlibm construction selects the upper word.
        Turn::verify_witness(f64::from_bits(upper | sign), Some(&witness)).unwrap();
        for bits in [upper - 2, upper - 1, upper + 1] {
            assert_eq!(
                Turn::verify_witness(f64::from_bits(bits | sign), Some(&witness)),
                Err(Refused("angle/witness-mismatch"))
            );
        }
        // Different interpreters may select either neighbour, but the verifier
        // must accept only the word that interpreter actually constructed.
        for constructed in [upper - 1, upper] {
            for bits in [upper - 2, upper - 1, upper, upper + 1] {
                let result = Turn::verify_witness_with_atan(
                    f64::from_bits(bits | sign), Some(&witness), |rounded| {
                        assert_eq!(rounded.to_bits(), input.to_bits());
                        Ok(f64::from_bits(constructed | sign))
                    }
                );
                assert_eq!(result, if bits == constructed { Ok(()) } else {
                    Err(Refused("angle/witness-mismatch"))
                });
            }
        }
        assert_eq!(Turn::verify_witness_with_atan(input, Some(&witness), |_| {
            Err(Refused("angle/witness-construction-unavailable"))
        }), Err(Refused("angle/witness-construction-unavailable")));
    }
    let witness = AngleWitness::Tan(wonky_geom::binary64(x).unwrap());
    let a = Turn::new(f64::from_bits(upper), Some(witness.clone())).unwrap();
    let b = Turn::new_with_atan(f64::from_bits(upper - 1), Some(witness), |_| {
        Ok(f64::from_bits(upper - 1))
    }).unwrap();
    assert_eq!(a.tangent_minimal_polynomial().unwrap(), b.tangent_minimal_polynomial().unwrap());
}

#[test]
fn on_curve_cache_tie() {
    use wonky_geom::{frame::Frame, model::Circle3, rotation::OnCurve};
    let circle = Circle3::new(
        Frame::new(
            [q(1, 1), q(0, 1), q(0, 1)],
            [
                [q(1, 1), q(0, 1), q(0, 1)],
                [q(0, 1), q(1, 1), q(0, 1)],
                [q(0, 1), q(0, 1), q(1, 1)],
            ],
        )
        .unwrap(),
        q(1, 1),
    )
    .unwrap();
    let mut frame = circle.frame().unwrap().clone();
    let delta = Q::new(1.into(), wonky_alg::BigInt::one() << 60);
    let mut origin = frame.origin().clone();
    origin[0] += &delta;
    frame = Frame::new(origin, frame.columns().clone()).unwrap();
    let a = OnCurve {
        circle: circle.clone(),
        t: turn(1, 4),
    };
    let b = OnCurve {
        circle: Circle3::new(frame, q(1, 1)).unwrap(),
        t: turn(1, 4),
    };
    use num_traits::ToPrimitive;
    assert_eq!(
        a.rational().unwrap()[0].to_f64(),
        b.rational().unwrap()[0].to_f64()
    );
    assert_eq!(a.cmp(&b).unwrap(), std::cmp::Ordering::Less);
    let a = OnCurve {
        circle: a.circle,
        t: turn(1, 8),
    };
    let b = OnCurve {
        circle: b.circle,
        t: turn(1, 8),
    };
    assert_eq!(a.rounded().unwrap(), b.rounded().unwrap());
    assert_eq!(a.cmp(&b).unwrap(), std::cmp::Ordering::Less);
}

#[test]
fn radical_fields_share_exact_coordinates() {
    // sqrt(2) has different generator polynomials in the 8/24 fields.
    let q45 = turn(1, 8);
    let r15 = turn(1, 24);
    assert_eq!(
        q45.coordinate_difference_sign(
            &[q(1, 1), q(1, 1), q(0, 1)],
            &r15,
            &[q(2, 1), q(-2, 1), q(0, 1)]
        )
        .unwrap(),
        Sign::Zero
    );
    let sixty = turn(1, 6);
    let thirty = turn(1, 12);
    assert_eq!(
        sixty
            .coordinate_difference_sign(
                &[q(1, 1), q(0, 1), q(0, 1)],
                &thirty,
                &[q(0, 1), q(1, 1), q(0, 1)]
            )
            .unwrap(),
        Sign::Zero
    );
    let delta = Q::new(1.into(), wonky_alg::BigInt::one() << 60);
    assert_eq!(
        q45.coordinate_difference_sign(
            &[q(1, 1), q(1, 1), delta],
            &r15,
            &[q(2, 1), q(-2, 1), q(0, 1)]
        )
        .unwrap(),
        Sign::Positive
    );
}

#[test]
fn sympy_ten_thousand_signs() {
    let source = include_str!("../../../fixtures/turn-signs/sympy.tsv");
    let mut turns = std::collections::BTreeMap::new();
    let mut count = 0;
    let mut zero = 0;
    let mut costs = std::collections::BTreeMap::<usize, (usize, f64)>::new();
    for line in source.lines() {
        let v: Vec<i64> = line
            .split_whitespace()
            .map(|x| x.parse().unwrap())
            .collect();
        assert_eq!(v.len(), 5);
        let t = turns.entry(v[0]).or_insert_with(|| turn(v[0], 360));
        let start = std::time::Instant::now();
        let actual = t.sign(&q(v[1], 1), &q(v[2], 1), &q(v[3], 12)).unwrap();
        let entry = costs.entry(t.degree().unwrap()).or_default();
        entry.0 += 1;
        entry.1 += start.elapsed().as_secs_f64() * 1000.;
        let expected = match v[4] {
            -1 => Sign::Negative,
            0 => Sign::Zero,
            1 => Sign::Positive,
            _ => panic!("oracle sign"),
        };
        assert_eq!(actual, expected, "oracle row {count}: {line}");
        count += 1;
        if expected == Sign::Zero {
            zero += 1
        }
    }
    assert_eq!(count, 10000);
    assert!(zero >= 100);
    eprintln!("T0 oracle: {count} signs, {zero} exact zeros, 0 mismatches, 0 refusals");
    for (d, (n, ms)) in costs {
        eprintln!(
            "T0 degree {d}: {n} predicates, total {ms:.6} ms, mean {:.6} ms/predicate",
            ms / n as f64
        )
    }
}

#[test]
fn rotated_carriers_use_exact_predicates_and_rational_rewrite() {
    use wonky_geom::{
        model::{Carrier3, Plane3},
        rotation::Line3,
    };
    let axis = Line3 {
        p: [q(0, 1), q(0, 1), q(0, 1)],
        d: [q(0, 1), q(0, 1), q(2, 1)],
    };
    let plane = Carrier3::Plane(Plane3 {
        o: [q(0, 1), q(0, 1), q(0, 1)],
        x: [q(0, 1), q(0, 1), q(1, 1)],
        n: [q(0, 1), q(1, 1), q(0, 1)],
    });
    let rational = Carrier3::rotated(plane.clone(), axis.clone(), turn(1, 4)).unwrap();
    assert!(matches!(rational, Carrier3::Plane(_)));
    assert!(rational
        .contains_point(&[q(0, 1), q(1, 1), q(2, 1)])
        .unwrap());
    let symbolic = Carrier3::rotated(plane, axis, turn(1, 8)).unwrap();
    assert!(matches!(symbolic, Carrier3::Rotated(_)));
    assert!(symbolic
        .contains_point(&[q(1, 1), q(1, 1), q(0, 1)])
        .unwrap());
    assert!(!symbolic
        .contains_point(&[q(1, 1), q(0, 1), q(0, 1)])
        .unwrap());
}
#[test]
fn on_curve_rounds_irrational_coordinates_only_at_observation() {
    use wonky_geom::{frame::Frame, model::Circle3, rotation::OnCurve};
    let a = OnCurve {
        circle: Circle3::new(Frame::identity(), q(1, 1)).unwrap(),
        t: turn(1, 8),
    };
    let observed = a.rounded().unwrap();
    assert_eq!(observed[0], std::f64::consts::FRAC_1_SQRT_2);
    assert_eq!(observed[1], observed[0]);
    assert_eq!(observed[2], 0.);
}

#[test]
fn rational_arc_class_and_tangent_witness() {
    let arc = Turn::from_sin_cos(q(3, 5), q(4, 5)).unwrap();
    assert_eq!(arc.class(), TurnClass::Rational);
    assert_eq!(arc.rational_sin_cos().unwrap(), (q(3, 5), q(4, 5)));
    assert_eq!(arc.sign(&q(5, 1), &q(0, 1), &q(-4, 1)).unwrap(), Sign::Zero);
    let theta = (3.0f64 / 4.).atan();
    let t = Turn::new(theta, Some(AngleWitness::Tan(q(3, 4)))).unwrap();
    assert_eq!(t.rational_sin_cos().unwrap(), (q(3, 5), q(4, 5)));
    assert_eq!(
        t.tangent_minimal_polynomial().unwrap(),
        Polynomial::new(vec![q(-1, 3), q(1, 1)]).unwrap()
    );
    assert_eq!(
        Turn::from_sin_cos(q(1, 1), q(1, 1)).unwrap_err(),
        Refused("turn/invalid-circle-witness")
    );
}

#[test]
fn rounded_cancellation_with_a_broad_initial_enclosure() {
    use wonky_geom::{frame::Frame, model::Circle3, rotation::OnCurve};
    let scale = Q::from_integer(wonky_alg::BigInt::one() << 400);
    let frame = Frame::new(
        [q(0, 1), q(0, 1), q(0, 1)],
        [
            [scale.clone(), scale.clone(), q(0, 1)],
            [-scale.clone(), scale, q(0, 1)],
            [q(0, 1), q(0, 1), q(1, 1)],
        ],
    )
    .unwrap();
    let a = OnCurve {
        circle: Circle3::new(frame, q(1, 1)).unwrap(),
        t: turn(1, 8),
    };
    assert_eq!(a.rounded().unwrap()[0], 0.);
}

#[test]
fn transcendental_construction_identities_are_not_guessed_coincidences() {
    let t = Turn::new(0.123, None).unwrap();
    assert_eq!(
        t.quadratic_sign(&[q(-1, 1), q(0, 1), q(0, 1), q(1, 1), q(0, 1), q(1, 1)])
            .unwrap(),
        Sign::Zero
    );
    assert_eq!(
        Turn::new(0., None)
            .unwrap()
            .sign(&q(1, 1), &q(0, 1), &q(-1, 1))
            .unwrap(),
        Sign::Zero
    );
}
