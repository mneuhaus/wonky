//! Exact-predicate audit (2026-10-02): replays the independent sympy corpus of
//! rust/wonky-alg/tests/data/predicate-audit.py against a1::roots, the Q(sqrt)
//! paves of the G9 SSI rows. For degree <= 2 each pave must equal sympy's root
//! p + q sqrt(d) exactly, in increasing order, with sympy's multiplicity
//! (double roots are touches); higher degrees must match count and multiplicity.
use std::cmp::Ordering;
use wonky_alg::{BigInt, Limits, Polynomial};
use wonky_bool::a1::{roots, Parameter};
use wonky_curve::radical::Radical;
use wonky_geom::Q;

fn q(s: &str) -> Q {
    let (n, d) = s.split_once('/').expect("n/d");
    Q::new(n.parse::<BigInt>().unwrap(), d.parse::<BigInt>().unwrap())
}

#[test]
fn quadratic_and_algebraic_paves_match_the_sympy_oracle() {
    let text = include_str!("data/a1-paves-audit.txt");
    let (mut equations, mut quadratic, mut algebraic) = (0, 0, 0);
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let (coefficients, expected) = line
            .strip_prefix("paves ")
            .and_then(|l| l.split_once(" | "))
            .expect("paves record");
        let equation =
            Polynomial::new(coefficients.split(' ').map(q).collect()).expect("rational equation");
        let paves = roots(&equation, Limits::default()).expect(line);
        let expected: Vec<Vec<&str>> = expected
            .split(" , ")
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.split(' ').collect())
            .collect();
        assert_eq!(paves.len(), expected.len(), "{line}");
        for pair in paves.windows(2) {
            assert_eq!(pair[0].cmp(&pair[1], Limits::default()).unwrap(), Ordering::Less, "{line}");
        }
        for (pave, want) in paves.iter().zip(&expected) {
            assert_eq!(pave.multiplicity.to_string(), want[3], "{line}");
            assert_eq!(pave.is_touch(), pave.multiplicity % 2 == 0);
            match &pave.parameter {
                Parameter::Quadratic(x) => {
                    let root = Radical::quadratic(q(want[0]), q(want[1]), q(want[2])).unwrap();
                    assert!(*x == root, "{line}: got {x:?}");
                    quadratic += 1;
                }
                Parameter::Algebraic(_) => {
                    assert_eq!(want[0], "-", "{line}: degree <= 2 fell back to AlgebraicReal");
                    algebraic += 1;
                }
            }
        }
        equations += 1;
    }
    eprintln!("a1 paves audit: {equations} equations, {quadratic} Q(sqrt) paves, {algebraic} algebraic paves");
    assert_eq!(equations, 162);
}
