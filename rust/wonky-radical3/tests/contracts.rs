use wonky_num::{Sign, UndecidedKind};
use wonky_radical3::{sum3, Dyadic, Radical3};

fn evaluate(a: f64, terms: [(f64, f64); 3]) -> Sign {
    sum3(a, terms).unwrap().sign().unwrap()
}

#[test]
fn near_zero_signs_and_exact_pythagorean_zeros() {
    // Found by the independent fractions near-zero generator with the same-sign
    // squaring guard deleted. The roots cancel exactly, leaving +2^-57; the
    // unchecked recursive squaring incorrectly returns Negative.
    assert_eq!(
        evaluate(
            2.0_f64.powi(-57),
            [
                (0.0078125, 6549.0),
                (0.0078125, 26196.0),
                (-0.0078125, 58941.0)
            ]
        ),
        Sign::Positive
    );
    for (a, terms, expected) in [
        (-30.0, [(1.0, 25.0), (1.0, 169.0), (1.0, 144.0)], Sign::Zero),
        (
            -30.000000000000004,
            [(1.0, 25.0), (1.0, 169.0), (1.0, 144.0)],
            Sign::Negative,
        ),
        (
            -29.999999999999996,
            [(1.0, 25.0), (1.0, 169.0), (1.0, 144.0)],
            Sign::Positive,
        ),
        (0.0, [(1.0, 2.0), (1.0, 8.0), (-1.0, 18.0)], Sign::Zero),
        (
            f64::EPSILON,
            [(1.0, 2.0), (1.0, 8.0), (-1.0, 18.0)],
            Sign::Positive,
        ),
        (
            -f64::EPSILON,
            [(1.0, 2.0), (1.0, 8.0), (-1.0, 18.0)],
            Sign::Negative,
        ),
        (1.0, [(2.0, 0.0), (-1.0, 1.0), (0.0, 2.0)], Sign::Zero),
        (-0.0, [(1.0, -0.0), (-1.0, 0.0), (0.0, 0.0)], Sign::Zero),
    ] {
        assert_eq!(evaluate(a, terms), expected, "a={a:?}, terms={terms:?}");
        assert_eq!(evaluate(-a, terms.map(|(b, c)| (-b, c))), expected.flip());
    }
}

#[test]
fn compare_keeps_low_bits_merges_bases_and_rejects_four_roots() {
    let x = sum3(1.0, [(1.0, 2.0), (1.0, 3.0), (1.0, 5.0)]).unwrap();
    let y = sum3(
        1.0 - f64::EPSILON / 2.0,
        [(1.0, 5.0), (1.0, 2.0), (1.0, 3.0)],
    )
    .unwrap();
    assert_eq!(x.compare(&y).unwrap(), Sign::Positive);
    assert_eq!(y.compare(&x).unwrap(), Sign::Negative);
    assert_eq!(x.compare(&x).unwrap(), Sign::Zero);
    let duplicate = sum3(0.0, [(1.0, 2.0), (1.0, 2.0), (1.0, 2.0)]).unwrap();
    let collected = sum3(0.0, [(3.0, 2.0), (0.0, 0.0), (0.0, 0.0)]).unwrap();
    assert_eq!(duplicate.compare(&collected).unwrap(), Sign::Zero);
    let fourth = sum3(0.0, [(1.0, 7.0), (0.0, 0.0), (0.0, 0.0)]).unwrap();
    let refusal = x.compare(&fourth).unwrap_err().into_refusal();
    assert_eq!(refusal.site, "radical3.degree_budget");
    assert_eq!(refusal.kind, UndecidedKind::Unresolved);
}

#[test]
fn invalid_words_and_expansion_limits_are_named_refusals() {
    for bad in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::from_bits(1),
        1e-151,
        1e151,
    ] {
        // Even dead coefficients/roots do not launder invalid inputs.
        for result in [
            sum3(bad, [(0.0, 0.0); 3]),
            sum3(1.0, [(0.0, bad); 3]),
            sum3(1.0, [(bad, 0.0); 3]),
        ] {
            assert_eq!(
                result.unwrap_err().into_refusal().kind,
                UndecidedKind::OutOfRange
            );
        }
    }
    let e = sum3(1.0, [(0.0, -1.0); 3]).unwrap_err().into_refusal();
    assert_eq!(e.site, "radical3.negative_radicand");
    let mut x = Dyadic::new(1e150).unwrap();
    x = x.mul(&x).unwrap();
    assert_eq!(
        x.mul(&x).unwrap_err().into_refusal().kind,
        UndecidedKind::NotExact
    );
    let tiny = Dyadic::new(1e-150).unwrap();
    assert_eq!(
        tiny.mul(&tiny).unwrap_err().into_refusal().kind,
        UndecidedKind::NotExact
    );
    // A full binary64 eight-term basis can exhaust the expansion product floor
    // during repeated squaring, even at modest input magnitudes. Preserve this
    // observed capability boundary: never turn failed exactness into a sign.
    let value = Radical3::new(
        [
            168.38198089988364,
            1577.6649173414482,
            0.0006768716364076281,
        ]
        .map(|x| Dyadic::new(x).unwrap()),
        [
            -188.2340363775025,
            1.8575601875653693,
            0.7610301479705295,
            0.2684694596735411,
            0.742364359826297,
            1.392993843733215,
            1.9461376631244143,
            -0.5198844130559377,
        ]
        .map(|x| Dyadic::new(x).unwrap()),
    )
    .unwrap();
    let refusal = value.sign().unwrap_err().into_refusal();
    assert_eq!(refusal.site, "radical3.expansion_exactness");
    assert_eq!(refusal.kind, UndecidedKind::NotExact);
}

#[test]
fn exact_construction_and_dependent_basis_products() {
    // Keep the lost ulp in a constructed coefficient, not in a rounded f64.
    let one = Dyadic::new(1.0).unwrap();
    let half_ulp = Dyadic::new(f64::EPSILON / 2.0).unwrap();
    let residual = one.add(&half_ulp).unwrap().sub(&one).unwrap();
    let mut coefficients = std::array::from_fn(|_| Dyadic::default());
    coefficients[0] = residual;
    coefficients[1] = one.clone();
    coefficients[2] = one.clone();
    coefficients[4] = one.neg();
    let value = Radical3::new(
        [2.0, 8.0, 18.0].map(|x| Dyadic::new(x).unwrap()),
        coefficients,
    )
    .unwrap();
    assert_eq!(value.sign().unwrap(), Sign::Positive);
    // Construct r=3*2^-1064 from admitted inputs. P0's point-sqrt FMA
    // residual underflows to zero here, although sqrt(r) is not exact.
    // sqrt(3)'s nearest f64 lies below the true root, so the difference is
    // positive; the expansion size policy may refuse but must not certify zero.
    let base = Dyadic::new(2.0_f64.powi(-480)).unwrap();
    let a = Dyadic::new((1.0 + f64::EPSILON) * 2.0_f64.powi(-480)).unwrap();
    let b = Dyadic::new((1.0 + 3.0 * f64::EPSILON) * 2.0_f64.powi(-480)).unwrap();
    let leading = a.add(&b).unwrap().sub(&base).unwrap().mul(&base).unwrap();
    let r = a.mul(&b).unwrap().sub(&leading).unwrap();
    assert_eq!(r.sign(), Sign::Positive);
    let rounded_root = Dyadic::new(3.0_f64.sqrt() * 2.0_f64.powi(-266))
        .unwrap()
        .mul(&Dyadic::new(2.0_f64.powi(-266)).unwrap())
        .unwrap();
    let mut coefficients = std::array::from_fn(|_| Dyadic::default());
    coefficients[0] = rounded_root.neg();
    coefficients[1] = one.clone();
    let extreme = Radical3::new([r, Dyadic::default(), Dyadic::default()], coefficients).unwrap();
    match extreme.sign() {
        Ok(s) => assert_eq!(s, Sign::Positive),
        Err(e) => assert_eq!(e.into_refusal().kind, UndecidedKind::NotExact),
    }
    // √r0√r1 with r0=r1 must become r0 during comparison rebasing.
    let mut coefficients = std::array::from_fn(|_| Dyadic::default());
    coefficients[3] = one;
    let value = Radical3::new(
        [2.0, 2.0, 0.0].map(|x| Dyadic::new(x).unwrap()),
        coefficients,
    )
    .unwrap();
    assert_eq!(
        value.compare(&sum3(2.0, [(0.0, 0.0); 3]).unwrap()).unwrap(),
        Sign::Zero
    );
}
