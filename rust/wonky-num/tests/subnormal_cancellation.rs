//! K0 regression (adopted from the K0 verifier, defect 1): in-range inputs
//! whose filter terms become subnormal after the predicate's power-of-two
//! scaling and cancel at the 2^-1074 level. There the relative filter bound
//! underflows to 0, so only the absolute filter term (FILTER_ABS) keeps the
//! filter from certifying a rounded sign. The random and near-degenerate
//! property suites never reach this regime. Every decided sign must equal the
//! exact rational sign; a refusal must be NotExact.
//!
//! Planted negative: `cargo test --release -p wonky-num --features
//! plant_filter_abs --test subnormal_cancellation` must fail (wrong sign).
use num_rational::BigRational;
use num_traits::{Signed, Zero};
use wonky_num::*;

fn q(x: f64) -> BigRational {
    BigRational::from_float(x).unwrap()
}
fn ref_plane(n: P3, p: P3, o: P3) -> Sign {
    let v = q(n.x) * (q(p.x) - q(o.x)) + q(n.y) * (q(p.y) - q(o.y)) + q(n.z) * (q(p.z) - q(o.z));
    if v.is_zero() {
        Sign::Zero
    } else if v.is_positive() {
        Sign::Positive
    } else {
        Sign::Negative
    }
}
fn p2k(k: i32) -> f64 {
    2f64.powi(k)
}

/// Scaled configuration (group maxima 0.75 and 0.5+2^-53, so the predicate's
/// scaling maps the unscaled inputs back to exactly these values):
///   T_x = n.x * dx = (3*2^30 + j/2^21) u   (u = 2^-1074)
///   T_y = n.y * dy = -(y) u, |y| < 1         (rounds to 0 or -u)
///   T_z = n.z * dz = -(3*2^30 + r/2^21) u
fn case(j: u64, r: u64, y: f64) -> (P3, P3, P3) {
    let s = p2k(497);
    let nx = 0.75 + (j as f64) * p2k(-53);
    let nz = -(3.0 * p2k(-991) + (r as f64) * p2k(-1042));
    let ny = y * p2k(-31);
    let o = v3(p2k(-990), p2k(-990), 0.5);
    let p = v3(p2k(-990) + p2k(-1042), p2k(-990) - p2k(-1043), 0.5 + p2k(-53));
    let sc = |v: P3| v3(v.x * s, v.y * s, v.z * s);
    (sc(v3(nx, ny, nz)), sc(p), sc(o))
}

fn check(n: P3, p: P3, o: P3) -> Result<Sign, UndecidedKind> {
    for x in [n.x, n.y, n.z, p.x, p.y, p.z, o.x, o.y, o.z] {
        assert!(in_range(x), "constructed input out of range: {x:e}");
    }
    let expected = ref_plane(n, p, o);
    match plane_side(n, p, o, "verify") {
        Ok(s) => {
            assert_eq!(s, expected, "wrong sign for n={n:?} p={p:?} o={o:?}");
            Ok(s)
        }
        Err(u) => {
            let kind = u.into_refusal().kind;
            assert_eq!(kind, UndecidedKind::NotExact, "n={n:?} p={p:?} o={o:?}");
            Err(kind)
        }
    }
}

/// One hand-built case: computed filter value +u, exact value -0.25 u.
#[test]
fn subnormal_cancellation_hand_case() {
    let j = 1_258_291; // j / 2^21 = 0.59999990 -> T_x rounds up by u
    let r = 838_861; // r / 2^21 = 0.40000009 -> T_z rounds down to the integer
    let (n, p, o) = case(j, r, 0.45); // T_y = -0.45 u -> rounds to -0
    assert_eq!(ref_plane(n, p, o), Sign::Negative);
    let got = check(n, p, o);
    eprintln!("hand case: {got:?} (exact sign Negative)");
}

/// The same regime, randomized.
#[test]
fn subnormal_cancellation_random() {
    let mut s: u64 = 0x0123_4567_89AB_CDEF;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s
    };
    let (mut decided, mut refused, mut neg, mut pos) = (0, 0, 0, 0);
    for _ in 0..200_000 {
        let (j, r) = (next() % (1 << 21), next() % (1 << 21));
        let y = ((next() >> 11) as f64 / (1u64 << 53) as f64) * 2.0 - 1.0;
        let (n, p, o) = case(j, r, y);
        match check(n, p, o) {
            Ok(Sign::Negative) => {
                decided += 1;
                neg += 1
            }
            Ok(Sign::Positive) => {
                decided += 1;
                pos += 1
            }
            Ok(Sign::Zero) => decided += 1,
            Err(_) => refused += 1,
        }
    }
    eprintln!("subnormal cancellation: {decided} decided ({neg} neg, {pos} pos, 0 mismatches), {refused} NotExact");
}

/// The dot product's underflow error is subsequently multiplied by t.
#[test]
fn line_underflow_is_amplified_by_parameter() {
    let zero = v3(0.0, 0.0, 0.0);
    let mut cases = vec![(v3(1e150, 1e-10, 0.0), v3(0.0, 1e-10, 1e150), v3(-1.0000000000000002e-20, 0.0, 0.0), zero, 1e150)];
    for a in [1e-150, 2e-150, 5e-150, 1e-149] {
        for b in [-1e-150, 1e-150, 3e-150] {
            for t in [-1e150, 1e150] {
                for y in [-1e-3, 0.0, 1e-3] {
                    cases.push((v3(1e150, a, 0.0), v3(0.0, b, 0.0), zero, v3(0.0, y, 0.0), t));
                }
            }
        }
    }
    for (n, d, o, p, t) in cases {
        let exact = q(n.x) * (q(o.x) + q(t) * q(d.x) - q(p.x)) + q(n.y) * (q(o.y) + q(t) * q(d.y) - q(p.y)) + q(n.z) * (q(o.z) + q(t) * q(d.z) - q(p.z));
        let want = if exact.is_zero() {
            Sign::Zero
        } else if exact.is_positive() {
            Sign::Positive
        } else {
            Sign::Negative
        };
        match line_point_side(n, d, o, p, t, "amplified-underflow") {
            Ok(got) => assert_eq!(got, want, "n={n:?} d={d:?} o={o:?} p={p:?} t={t}"),
            Err(e) => assert_eq!(e.into_refusal().kind, UndecidedKind::NotExact),
        }
    }
}
