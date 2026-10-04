//! Exact-predicate audit (2026-10-02): replays the independent sympy corpus of
//! rust/wonky-alg/tests/data/predicate-audit.py against the multiquadratic
//! Radical. Expected signs are certified by mpmath interval arithmetic, exact
//! zeros by minimal_polynomial == x; denestings come from sympy's sqrtdenest.
//! Inputs include dependent square classes (r, 4r, r/9, 25r/4), up to six terms,
//! 2^64 denominators, 2^61 - 1 and 3^40 radicands and near-cancelling convergents.
use num_bigint::BigInt;
use std::cmp::Ordering;
use wonky_curve::numeric::Q;
use wonky_curve::radical::{guard, Radical};
use wonky_curve::refusal::Refusal;

fn q(s: &str) -> Q {
    let (n, d) = s.split_once('/').expect("n/d");
    Q::new(n.parse::<BigInt>().unwrap(), d.parse::<BigInt>().unwrap())
}

fn sum(pairs: &[&str]) -> Radical {
    pairs.chunks(2).fold(Radical::default(), |s, p| {
        s + Radical::quadratic(Q::from_integer(0.into()), q(p[1]), q(p[0])).unwrap()
    })
}

#[test]
fn radical_signs_and_denesting_match_the_sympy_oracle() {
    let text = include_str!("data/radical-audit.txt");
    let (mut signs, mut zeros, mut denested, mut refused, mut negative) = (0, 0, 0, 0, 0);
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let f: Vec<&str> = line.split(' ').collect();
        match f[0] {
            "sign" => {
                let want = f[1].parse::<i8>().unwrap().cmp(&0);
                let n: usize = f[2].parse().unwrap();
                let value = guard(|| sum(&f[3..3 + 2 * n])).unwrap();
                assert_eq!(value.try_sign(), Ok(want), "{line}");
                assert_eq!(value.is_zero(), want == Ordering::Equal, "{line}");
                signs += 1;
                zeros += usize::from(want == Ordering::Equal);
            }
            "denest" => {
                let x = Radical::quadratic(q(f[1]), q(f[2]), q(f[3])).unwrap();
                match (f[4], x.quadratic_sqrt()) {
                    ("negative", Err(Refusal::NumericRange)) => negative += 1,
                    ("none", Err(Refusal::CrossingNeedsAlgebraicVertex)) => refused += 1,
                    (_, Ok(root)) if !matches!(f[4], "negative" | "none") => {
                        let want = guard(|| sum(&f[4..])).unwrap();
                        assert!(root == want, "{line}: got {root:?}");
                        assert!(guard(|| &root * &root == x).unwrap(), "{line}");
                        denested += 1;
                    }
                    (want, got) => panic!("{line}: expected {want}, got {got:?}"),
                }
            }
            other => panic!("unknown record {other}"),
        }
    }
    eprintln!("radical audit: {signs} signs ({zeros} exact zeros), {denested} denested, {refused} not denestable, {negative} negative");
    assert_eq!((signs, denested + refused + negative), (300, 150));
}
