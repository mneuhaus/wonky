use num_traits::{One, Zero};
use wonky_alg::{
    isolate_real_roots, AlgebraError, AlgebraicReal, BigInt, Limits, Polynomial, Rational,
    RationalInterval, Sign, SturmSequence,
};

fn q(n: i64, d: i64) -> Rational {
    Rational::new(n.into(), d.into())
}
fn interval(a: i64, b: i64) -> RationalInterval {
    RationalInterval::new(q(a, 1), q(b, 1)).unwrap()
}
fn pow(p: &Polynomial, n: usize) -> Polynomial {
    (0..n).fold(Polynomial::one(), |a, _| a.mul(p))
}

// Independent coefficient construction from supplied rational roots. Expected root
// locations and multiplicities never come from a solver or the polynomial under test.
fn from_roots(roots: &[Rational]) -> Polynomial {
    let mut c = vec![Rational::one()];
    for root in roots {
        let mut next = vec![Rational::zero(); c.len() + 1];
        for (i, value) in c.iter().enumerate() {
            next[i] -= root * value;
            next[i + 1] += value;
        }
        c = next;
    }
    Polynomial::new(c).unwrap()
}

fn assert_certificates(p: &Polynomial, roots: &[AlgebraicReal]) {
    let square_free = p.square_free_part().unwrap();
    for root in roots {
        let i = root.interval();
        let a = square_free.evaluate(i.lower()).unwrap();
        let b = square_free.evaluate(i.upper()).unwrap();
        if i.is_point() {
            assert_eq!(a, Rational::zero());
        } else {
            // This is a rational sign-change check, not the solver's root counter.
            assert!(
                a * b < Rational::zero(),
                "not a strict exact bracket: {i:?}"
            );
        }
    }
    for adjacent in roots.windows(2) {
        assert!(adjacent[0].interval().upper() < adjacent[1].interval().lower());
    }
}

#[test]
fn arithmetic_division_and_gcd_contract() {
    let p = Polynomial::from_integers(&[4, -2, 0, 1]);
    let linear = Polynomial::from_integers(&[-1, 1]);
    let (quotient, remainder) = p.div_rem(&linear).unwrap();
    assert_eq!(quotient, Polynomial::from_integers(&[-1, 1, 1]));
    assert_eq!(remainder, Polynomial::from_integers(&[3]));
    assert_eq!(p.evaluate(&q(3, 2)).unwrap(), q(35, 8));
    assert_eq!(p.derivative(), Polynomial::from_integers(&[-2, 0, 3]));
    let repeated = Polynomial::from_integers(&[2, -3, 0, 1]); // (x-1)^2(x+2)
    let other = Polynomial::from_integers(&[-1, 1, -1, 1]); // (x-1)(x^2+1)
    assert_eq!(repeated.gcd(&other), linear);
    assert_eq!(repeated.gcd(&Polynomial::zero()), repeated.monic());
    assert_eq!(
        Polynomial::zero().gcd(&Polynomial::zero()),
        Polynomial::zero()
    );
    assert_eq!(
        repeated.square_free_part().unwrap(),
        Polynomial::from_integers(&[-2, 1, 1])
    );
    for i in -8..=8 {
        let x = q(i, 3);
        assert_eq!(
            quotient.mul(&linear).add(&remainder).evaluate(&x).unwrap(),
            p.evaluate(&x).unwrap()
        );
        assert_eq!(p.sub(&p).evaluate(&x).unwrap(), Rational::zero());
    }
    assert_eq!(p.exact_div(&linear), Err(AlgebraError::NonExactDivision));
}

#[test]
fn square_free_decomposition_preserves_units_and_multiplicities() {
    let a = Polynomial::from_integers(&[-1, 1]);
    let b = Polynomial::from_integers(&[2, 1]);
    let c = Polynomial::from_integers(&[1, 0, 1]);
    let p = pow(&a, 2)
        .mul(&pow(&b, 3))
        .mul(&pow(&c, 4))
        .scale(&q(-7, 3))
        .unwrap();
    let decomposition = p.square_free_decomposition().unwrap();
    assert_eq!(decomposition.unit, q(-7, 3));
    let actual: Vec<_> = decomposition
        .factors
        .iter()
        .map(|f| (f.polynomial.clone(), f.multiplicity))
        .collect();
    assert_eq!(actual, vec![(a, 2), (b, 3), (c, 4)]);
    let reconstructed = decomposition
        .factors
        .iter()
        .fold(Polynomial::one(), |p, f| {
            p.mul(&pow(&f.polynomial, f.multiplicity))
        })
        .scale(&decomposition.unit)
        .unwrap();
    assert_eq!(reconstructed, p);
    let roots = isolate_real_roots(&p, Limits::default()).unwrap();
    assert_eq!(roots.len(), 2);
    for (root, expected, multiplicity) in [(roots[0].clone(), -2, 3), (roots[1].clone(), 1, 2)] {
        assert!(
            root.interval().lower() <= &q(expected, 1)
                && root.interval().upper() >= &q(expected, 1)
        );
        assert_eq!(root.multiplicity(), multiplicity);
    }
    assert_certificates(&p, &roots);
}

#[test]
fn sturm_counts_and_endpoints() {
    let p = Polynomial::from_integers(&[0, -1, 0, 1]); // roots -1, 0, 1
    let s = SturmSequence::new(&p).unwrap();
    assert_eq!(
        s.real_root_count(),
        3,
        "known cubic has exactly three distinct real roots"
    );
    for (x, expected) in [(-2, 3), (-1, 2), (0, 1), (1, 0), (2, 0)] {
        assert_eq!(s.variations_at(&q(x, 1)).unwrap(), expected, "V({x})");
    }
    for (a, b, expected) in [
        (-2, 2, 3),
        (-1, 1, 1),
        (-1, 0, 0),
        (0, 1, 0),
        (0, 0, 0),
        (-2, 0, 1),
        (0, 2, 1),
    ] {
        assert_eq!(s.count_open(&interval(a, b)), expected, "({a},{b})");
    }
    // Positive-only normalization of signed remainders matters for x^4+x^2+1.
    for (coefficients, expected) in [
        (&[1, 0, 1, 0, 1][..], 0),
        (&[1, 0, -2, 0, 1][..], 2),
        (&[4, 0, -5, 0, 1][..], 4),
    ] {
        let p = Polynomial::from_integers(coefficients);
        assert_eq!(SturmSequence::new(&p).unwrap().real_root_count(), expected);
        assert_eq!(
            SturmSequence::new(&p.scale(&q(-5, 7)).unwrap())
                .unwrap()
                .real_root_count(),
            expected
        );
    }
}

#[test]
fn chebyshev_roots_and_exact_refinement_brackets() {
    let mut previous = Polynomial::one();
    let mut current = Polynomial::from_integers(&[0, 1]);
    let twice_x = Polynomial::from_integers(&[0, 2]);
    let width = q(1, 1_000_000_000_000);
    for degree in 1..=12 {
        // T_n has exactly n simple roots cos((2k-1)pi/(2n)), all in (-1,1).
        assert_eq!(
            SturmSequence::new(&current).unwrap().real_root_count(),
            degree
        );
        let mut roots = isolate_real_roots(&current, Limits::default()).unwrap();
        assert_eq!(roots.len(), degree);
        for root in &mut roots {
            root.refine(&width, Limits::default()).unwrap();
            assert!(root.interval().width() <= width);
            assert!(root.interval().lower() > &q(-1, 1));
            assert!(root.interval().upper() < &q(1, 1));
            assert_eq!(root.multiplicity(), 1);
        }
        assert_certificates(&current, &roots);
        let next = twice_x.mul(&current).sub(&previous);
        previous = current;
        current = next;
    }
}

#[test]
fn wilkinson_twenty_known_roots() {
    let expected: Vec<_> = (1..=20).map(|n| q(n, 1)).collect();
    let p = from_roots(&expected);
    assert_eq!(p.degree(), Some(20));
    assert_eq!(SturmSequence::new(&p).unwrap().real_root_count(), 20);
    let mut roots = isolate_real_roots(&p, Limits::default()).unwrap();
    assert_eq!(roots.len(), expected.len());
    for (root, exact) in roots.iter_mut().zip(expected) {
        root.refine(&q(1, 1_000_000), Limits::default()).unwrap();
        assert!(root.interval().width() <= q(1, 1_000_000));
        assert!(root.interval().lower() <= &exact && &exact <= root.interval().upper());
    }
    assert_certificates(&p, &roots);
}

#[test]
fn clustered_quartic_at_one_trillionth() {
    let expected: Vec<_> = (0..4)
        .map(|n| q(1_000_000_000_000 + n, 1_000_000_000_000))
        .collect();
    let p = from_roots(&expected);
    let mut roots = isolate_real_roots(&p, Limits::default()).unwrap();
    assert_eq!(roots.len(), 4, "no close root may be merged");
    let width = Rational::new(1.into(), BigInt::from(10).pow(36));
    for (root, exact) in roots.iter_mut().zip(&expected) {
        root.refine(&width, Limits::default()).unwrap();
        assert!(root.interval().width() <= width);
        assert!(root.interval().lower() <= exact && exact <= root.interval().upper());
        assert_eq!(
            root.sign_at(&from_roots(std::slice::from_ref(exact)), Limits::default())
                .unwrap(),
            Sign::Zero
        );
    }
    assert_certificates(&p, &roots);
}

#[test]
fn quadric_section_quartics_and_tangency() {
    // Exact section/elimination fixtures, NOT a production surface intersection solver.
    // Common tilted cylinder: x^2 + 2(y-1/2)^2 + z^2 - 2xz = 1.
    // CC: x=0 and y^2+z^2=1 -> y=3/4-z^2/2 -> 4z^4+4z^2-7=0.
    // SC: x=0 and y^2+(z-1/2)^2=1 -> y=(-z^2+2z+1)/2.
    // KC: x=1 and y^2-z^2+1=0 -> y=(3z^2-2z-3/2)/2.
    let cases = [
        ("cylinder/cylinder", vec![-7, 0, 4, 0, 4], -1, q(0, 1), 1),
        ("sphere/cylinder", vec![-2, 0, 6, -4, 1], -1, q(0, 1), 1),
        ("cone/cylinder", vec![25, 24, -36, -48, 36], 1, q(5, 4), 2),
    ];
    for (name, coefficients, lo, separator, hi) in cases {
        let p = Polynomial::from_integers(&coefficients);
        let mut roots = isolate_real_roots(&p, Limits::default()).unwrap();
        assert_eq!(roots.len(), 2, "{name}");
        for root in &mut roots {
            root.refine(&q(1, 1_000_000_000_000), Limits::default())
                .unwrap();
        }
        let outer_lower = q(lo, 1);
        let outer_upper = q(hi, 1);
        assert!(roots[0].interval().lower() > &outer_lower);
        assert!(roots[0].interval().upper() < &separator);
        assert!(roots[1].interval().lower() > &separator);
        assert!(roots[1].interval().upper() < &outer_upper);
        assert_certificates(&p, &roots);
    }
    // At x=0, y^2+z^2=1 and 2(y-1/2)^2+z^2=1/2 imply
    // y=1-z^2/2, hence z^4=0: one root with multiplicity four.
    let contact = Polynomial::from_integers(&[0, 0, 0, 0, 1]);
    let roots = isolate_real_roots(&contact, Limits::default()).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].multiplicity(), 4);
    assert_eq!(roots[0].interval(), &interval(0, 0));
}

#[test]
fn signs_at_irrational_roots_and_shared_factors() {
    let sqrt2 = Polynomial::from_integers(&[-2, 0, 1]);
    let sqrt3 = Polynomial::from_integers(&[-3, 0, 1]);
    let defining = sqrt2.mul(&sqrt3);
    let alpha =
        AlgebraicReal::from_interval(&defining, RationalInterval::new(q(1, 1), q(3, 2)).unwrap())
            .unwrap();
    let cases = [
        (sqrt2.clone(), Sign::Zero),
        (sqrt3, Sign::Negative),
        (Polynomial::from_integers(&[-1, 1]), Sign::Positive),
        (Polynomial::from_integers(&[0, -1]), Sign::Negative),
        (Polynomial::zero(), Sign::Zero),
        (Polynomial::from_integers(&[7]), Sign::Positive),
        (
            sqrt2.mul(&Polynomial::from_integers(&[2, 3, 4, 5])),
            Sign::Zero,
        ),
    ];
    for (p, expected) in cases {
        assert_eq!(alpha.sign_at(&p, Limits::default()).unwrap(), expected);
    }
    // Rational Pell approximants straddle sqrt(2), much closer than the certificate.
    let below = q(2_140_758_220_993, 1_513_744_654_945);
    let above = q(886_731_088_897, 627_013_566_048);
    assert!(&below * &below < q(2, 1));
    assert!(&above * &above > q(2, 1));
    for (cut, expected) in [(below, Sign::Positive), (above, Sign::Negative)] {
        let p = from_roots(&[cut]);
        assert_eq!(alpha.sign_at(&p, Limits::default()).unwrap(), expected);
        assert_eq!(
            alpha.sign_at(&p.mul(&p), Limits::default()).unwrap(),
            Sign::Positive
        );
    }
    // A common factor elsewhere in the defining polynomial must not report zero here.
    let negative =
        AlgebraicReal::from_interval(&Polynomial::from_integers(&[-1, 0, 1]), interval(-2, 0))
            .unwrap();
    assert_eq!(
        negative
            .sign_at(&Polynomial::from_integers(&[-1, 1]), Limits::default())
            .unwrap(),
        Sign::Negative
    );
}

#[test]
fn exact_rational_properties_and_metamorphisms() {
    // Deterministic generated factorizations. Oracle: supplied rational roots, not
    // Sturm or f64. Covers even/odd multiplicity, sign scaling, rational coefficients.
    let mut state = 0x5a17_u64;
    for case in 0..48 {
        let mut expected = Vec::new();
        for slot in 0..4 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            // Disjoint slots guarantee four distinct roots without deduplication.
            expected.push(q(slot * 5 - 8, 1) + q((state % 17) as i64, 19));
        }
        let mut expanded = Vec::new();
        for (i, r) in expected.iter().enumerate() {
            expanded.extend(std::iter::repeat_n(r.clone(), 1 + (i + case) % 3));
        }
        let unit = q(if case % 2 == 0 { -3 } else { 7 }, 11);
        let p = from_roots(&expanded).scale(&unit).unwrap();
        let roots = isolate_real_roots(&p, Limits::default()).unwrap();
        assert_eq!(roots.len(), 4);
        for (i, (root, exact)) in roots.iter().zip(&expected).enumerate() {
            assert!(root.interval().lower() <= exact && exact <= root.interval().upper());
            assert_eq!(root.multiplicity(), 1 + (i + case) % 3);
            // Independent product evaluation protects coefficient arithmetic too.
            let x = q(case as i64 - 20, 7);
            let value = expanded.iter().fold(unit.clone(), |acc, r| acc * (&x - r));
            assert_eq!(p.evaluate(&x).unwrap(), value);
        }
        assert_certificates(&p, &roots);
        assert_eq!(SturmSequence::new(&p.neg()).unwrap().real_root_count(), 4);
        let repeated = p.mul(&p);
        assert_eq!(
            repeated.square_free_part().unwrap(),
            p.square_free_part().unwrap()
        );
    }
}

#[test]
fn invalid_inputs_and_transactional_budget_refusals() {
    let zero = Polynomial::zero();
    let one = Polynomial::one();
    assert_eq!(zero.degree(), None);
    assert_eq!(one.degree(), Some(0));
    assert_eq!(
        one.div_rem(&zero),
        Err(AlgebraError::DivisionByZeroPolynomial)
    );
    assert_eq!(
        zero.square_free_decomposition(),
        Err(AlgebraError::ZeroPolynomial)
    );
    assert!(matches!(
        SturmSequence::new(&zero),
        Err(AlgebraError::ZeroPolynomial)
    ));
    assert!(matches!(
        isolate_real_roots(&zero, Limits::default()),
        Err(AlgebraError::ZeroPolynomial)
    ));
    assert!(isolate_real_roots(&one, Limits::default())
        .unwrap()
        .is_empty());
    assert!(one.square_free_decomposition().unwrap().factors.is_empty());
    let invalid = Rational::new_raw(1.into(), 0.into());
    assert_eq!(
        Polynomial::new(vec![invalid.clone()]),
        Err(AlgebraError::ZeroDenominator)
    );
    assert_eq!(one.evaluate(&invalid), Err(AlgebraError::ZeroDenominator));
    assert_eq!(one.scale(&invalid), Err(AlgebraError::ZeroDenominator));
    assert_eq!(
        RationalInterval::new(invalid.clone(), q(1, 1)),
        Err(AlgebraError::ZeroDenominator)
    );
    assert_eq!(
        RationalInterval::new(q(0, 1), invalid.clone()),
        Err(AlgebraError::ZeroDenominator)
    );
    assert_eq!(
        RationalInterval::new(q(1, 1), q(-1, 1)),
        Err(AlgebraError::ReversedInterval)
    );
    let raw = Rational::new_raw(2.into(), (-4).into());
    assert_eq!(
        Polynomial::new(vec![raw.clone()]).unwrap().coefficients(),
        &[q(-1, 2)]
    );
    assert_eq!(
        Polynomial::from_integers(&[0, 1]).evaluate(&raw).unwrap(),
        q(-1, 2)
    );
    let p = Polynomial::from_integers(&[-2, 0, 1]);
    let mut alpha = AlgebraicReal::from_interval(&p, interval(1, 2)).unwrap();
    let original = alpha.interval().clone();
    for width in [q(0, 1), q(-1, 1)] {
        assert_eq!(
            alpha.refine(&width, Limits::default()),
            Err(AlgebraError::NonPositiveWidth)
        );
    }
    assert_eq!(
        alpha.refine(&invalid, Limits::default()),
        Err(AlgebraError::ZeroDenominator)
    );
    let no_steps = Limits { max_bisections: 0 };
    assert_eq!(
        alpha.refine(&q(1, 1_000), no_steps),
        Err(AlgebraError::BudgetExceeded {
            operation: "refine",
            limit: 0
        })
    );
    assert_eq!(alpha.interval(), &original);
    // Exhaust the budget AFTER an actual step: no partial state may escape.
    assert_eq!(
        alpha.refine(&q(1, 1_000), Limits { max_bisections: 1 }),
        Err(AlgebraError::BudgetExceeded {
            operation: "refine",
            limit: 1
        })
    );
    assert_eq!(alpha.interval(), &original);
    assert_eq!(
        alpha.sign_at(&Polynomial::from_integers(&[-3, 2]), no_steps),
        Err(AlgebraError::BudgetExceeded {
            operation: "sign_at",
            limit: 0
        })
    );
    assert!(matches!(
        isolate_real_roots(&p, no_steps),
        Err(AlgebraError::BudgetExceeded {
            operation: "isolate_real_roots",
            limit: 0
        })
    ));
    assert!(matches!(
        AlgebraicReal::from_interval(&p, interval(-2, 2)),
        Err(AlgebraError::NotIsolating { roots: 2 })
    ));
    assert!(matches!(
        AlgebraicReal::from_interval(&p, interval(3, 4)),
        Err(AlgebraError::NotIsolating { roots: 0 })
    ));
    assert!(matches!(
        AlgebraicReal::from_interval(&one, interval(0, 0)),
        Err(AlgebraError::NotIsolating { roots: 0 })
    ));
    let linear = Polynomial::from_integers(&[-1, 1]);
    assert!(matches!(
        AlgebraicReal::from_interval(&linear, interval(0, 1)),
        Err(AlgebraError::EndpointIsRoot)
    ));
    let point = AlgebraicReal::from_interval(&linear, interval(1, 1)).unwrap();
    assert_eq!(
        point
            .sign_at(&Polynomial::from_integers(&[-2, 1]), no_steps)
            .unwrap(),
        Sign::Negative
    );
    assert_eq!(
        SturmSequence::new(&p).unwrap().variations_at(&invalid),
        Err(AlgebraError::ZeroDenominator)
    );
}

#[test]
fn arbitrary_precision_and_repeated_irrational_roots() {
    // Neither coefficient magnitude nor sub-f64 separation may force a float path.
    let huge = BigInt::from(1) << 2048;
    let unit = Rational::new(huge, BigInt::from(3));
    let sqrt2 = Polynomial::from_integers(&[-2, 0, 1]);
    let repeated = sqrt2.mul(&sqrt2).scale(&unit).unwrap();
    let mut roots = isolate_real_roots(&repeated, Limits::default()).unwrap();
    assert_eq!(roots.len(), 2);
    for root in &mut roots {
        assert_eq!(root.multiplicity(), 2);
        root.refine(&q(1, 1_000_000), Limits::default()).unwrap();
        assert_eq!(root.sign_at(&sqrt2, Limits::default()).unwrap(), Sign::Zero);
    }
    assert_certificates(&repeated, &roots);
    let tiny = Rational::new(1.into(), BigInt::from(1) << 1100);
    let p = from_roots(&[Rational::zero(), tiny.clone()]);
    let mut roots = isolate_real_roots(&p, Limits::default()).unwrap();
    assert_eq!(roots.len(), 2);
    for (root, exact) in roots.iter_mut().zip([Rational::zero(), tiny.clone()]) {
        root.refine(&(&tiny / q(16, 1)), Limits::default()).unwrap();
        assert!(root.interval().width() <= &tiny / q(16, 1));
        assert!(root.interval().lower() <= &exact && &exact <= root.interval().upper());
    }
    assert_certificates(&p, &roots);
}
