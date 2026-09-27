//! Independent exact-rational checks of the predicates used by the planar op.
//! No-Claim: this does not validate planar Boolean topology, blends, or R20.
use wonky_num::v3;
use wonky_ops::planar::{exact, num};
use wonky_oracle::{adversarial::Generator, point3, OracleError};

fn check(n: [f64; 3], a: [f64; 3], b: [f64; 3], case: usize) {
    let (rn, ra, rb) = (point3(n).unwrap(), point3(a).unwrap(), point3(b).unwrap());
    let (n, a, b) = (
        v3(n[0], n[1], n[2]),
        v3(a[0], a[1], a[2]),
        v3(b[0], b[1], b[2]),
    );
    num::reset_undecided();
    assert_eq!(
        exact::coincident(n, a, b, "oracle-consumer-coincident"),
        wonky_oracle::plane_side(&rn, &ra, &rb) == 0,
        "coincident case {case}"
    );
    assert_eq!(
        exact::perpendicular(n, a, "oracle-consumer-perpendicular"),
        wonky_oracle::dot_sign(&rn, &ra) == 0,
        "perpendicular case {case}"
    );
    assert_eq!(
        exact::parallel(n, a, "oracle-consumer-parallel"),
        wonky_oracle::parallel(&rn, &ra),
        "parallel case {case}"
    );
    assert_eq!(num::undecided(), None, "unexpected refusal in case {case}");
}

#[test]
fn planar_predicates_agree_with_literal_binary64_rationals() {
    // Every predicate sees both a certificate and a counterexample, including
    // one-ulp displacement from an exact plane contact.
    check([0.0, 0.0, 1.0], [2.0, 3.0, 1.0], [0.0, 0.0, 1.0], 0);
    check(
        [0.0, 0.0, 1.0],
        [2.0, 3.0, f64::from_bits(1.0f64.to_bits() + 1)],
        [0.0, 0.0, 1.0],
        1,
    );
    check([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0], 2);
    check([1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 0.0, 0.0], 3);

    let mut generator = Generator::new(0x6173_10c1_ee77_5221);
    for i in 0..2048 {
        let next = |generator: &mut Generator| (generator.next_u64() % 2049) as f64 - 1024.0;
        let n = [1.0, next(&mut generator), next(&mut generator)];
        let a = [
            next(&mut generator),
            next(&mut generator),
            next(&mut generator),
        ];
        let b = if i % 4 == 0 {
            a
        } else {
            [
                next(&mut generator),
                next(&mut generator),
                next(&mut generator),
            ]
        };
        check(n, a, b, i + 4);
    }
}

#[test]
fn nonfinite_is_refused_not_compared_to_a_rational() {
    let invalid = [f64::NAN, 0.0, 1.0];
    assert_eq!(point3(invalid), Err(OracleError::NonFinite));
    num::reset_undecided();
    assert!(!exact::coincident(
        v3(invalid[0], invalid[1], invalid[2]),
        v3(0.0, 0.0, 0.0),
        v3(0.0, 0.0, 0.0),
        "oracle-consumer-nonfinite"
    ));
    assert_eq!(num::undecided(), Some("oracle-consumer-nonfinite"));
}
