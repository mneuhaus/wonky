//! Independent exact-rational enclosure checks for non-point Iv balls.
//! Seed and distributions adapted from the independent P0 verifier's
//! iv_enclosure_attack: include gradual underflow, wide exponents and radii.
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use wonky_num::*;

fn q(x: f64) -> Q {
    Q::from_float(x).expect("finite interval component")
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn sample(rng: &mut Rng) -> Iv {
    let sign = if rng.next() & 1 == 0 { 1.0 } else { -1.0 };
    let m = match rng.below(8) {
        0 => 0.0,
        1 => sign * f64::from_bits(1 + rng.below(1 << 52)),
        2 => sign * f64::MIN_POSITIVE * (1.0 + rng.unit()),
        3 => sign * f64::MAX * rng.unit(),
        4 => {
            sign * 2f64
                .powi(rng.below(2046) as i32 - 1022)
                .max(f64::MIN_POSITIVE)
        }
        _ => sign * 2f64.powi(rng.below(200) as i32 - 100) * (1.0 + rng.unit()),
    };
    let r = match rng.below(5) {
        0 | 1 => 0.0,
        2 => m.abs() * rng.unit(),
        3 => f64::from_bits(1 + rng.below(1 << 40)),
        _ => m.abs() * 2.0 * rng.unit() + 1e-300,
    };
    Iv { m, r }
}

fn values(v: Iv) -> [Q; 3] {
    let (m, r) = (q(v.m), q(v.r));
    [&m - &r, m.clone(), m + r]
}

fn encloses(v: Iv, exact: &Q, context: &str) {
    // Overflow may refuse, but a valid result must enclose in BOTH its
    // published endpoints and its underlying mathematical ball m +/- r.
    if v.is_nan() {
        return;
    }
    let (m, r) = (q(v.m), q(v.r));
    assert!(
        &m - &r <= *exact && *exact <= &m + &r,
        "raw ball misses exact value ({context}): {v:?}"
    );
    if v.lo().is_finite() {
        assert!(
            q(v.lo()) <= *exact,
            "lower endpoint misses ({context}): {v:?}"
        );
    }
    if v.hi().is_finite() {
        assert!(
            *exact <= q(v.hi()),
            "upper endpoint misses ({context}): {v:?}"
        );
    }
}

fn sqrt_encloses(v: Iv, square: &Q, context: &str) {
    if v.is_nan() {
        return;
    }
    let (m, r) = (q(v.m), q(v.r));
    let (lower, upper) = (&m - &r, &m + &r);
    if lower.is_positive() {
        assert!(
            &lower * &lower <= *square,
            "sqrt lower misses ({context}): {v:?}"
        );
    }
    assert!(
        !upper.is_negative() && &upper * &upper >= *square,
        "sqrt upper misses ({context}): {v:?}"
    );
}

#[test]
fn division_across_zero_and_subnormal_normalization_cannot_certify() {
    let denominator = Iv { m: 1.0, r: 2.0 };
    assert!(
        (Iv::point(1.0) / denominator).is_nan(),
        "division by [-1, 3] must refuse"
    );
    let tiny = v3(f64::from_bits(1), 0.0, 0.0).iv().normalize().length();
    let decision = le(tiny, Iv::point(1e-9), "tiny normalized length");
    assert!(
        !matches!(decision, Ok(true)),
        "normalized nonzero vector certified near zero: {tiny:?}"
    );
    if let Err(u) = decision {
        let _ = u.into_refusal();
    }
}

#[test]
fn norm3_straddling_zero_cannot_certify_a_positive_lower_bound() {
    let z = Iv::point(0.0);
    let norm = (Iv { m: 0.1, r: 1.0 }).norm3(z, z);
    // Zero lies in [-0.9, 1.1]; choosing that point yields exact norm 0.
    sqrt_encloses(norm, &Q::zero(), "norm3 zero in component interval");
    let decision = le(norm, Iv::point(0.5), "norm3 straddle");
    assert!(
        !matches!(decision, Ok(false)),
        "zero-containing norm certified > 0.5: {norm:?}"
    );
    if let Err(u) = decision {
        let _ = u.into_refusal();
    }
}

#[test]
fn non_point_endpoints_enclose_exact_subnormal_radii() {
    let tiny = f64::from_bits(1);
    for ball in [Iv { m: 1.0, r: tiny }, Iv { m: -1.0, r: tiny }] {
        for exact in values(ball) {
            encloses(ball, &exact, "non-point endpoint below one ulp");
        }
    }
}

#[test]
fn seeded_non_point_arithmetic_encloses_exact_rationals() {
    let mut rng = Rng(0x1234_5678_9abc_def1);
    let mut non_point = 0;
    let mut subnormal = 0;
    let mut decisions = [0usize; 9]; // add, sub, mul, div, max, min, abs, sqrt, norm3
    for i in 0..4_000 {
        let (a, b) = (sample(&mut rng), sample(&mut rng));
        if a.is_nan() || b.is_nan() {
            continue;
        }
        non_point += usize::from(a.r > 0.0 || b.r > 0.0);
        subnormal += usize::from(a.m.is_subnormal() || b.m.is_subnormal());
        let (ea, eb) = (values(a), values(b));
        for x in &ea {
            encloses(a, x, "input a");
            for y in &eb {
                encloses(a + b, &(x + y), &format!("add {i}"));
                encloses(a - b, &(x - y), &format!("sub {i}"));
                encloses(a * b, &(x * y), &format!("mul {i}"));
                encloses(a.max(b), &if x > y { x.clone() } else { y.clone() }, "max");
                encloses(a.min(b), &if x < y { x.clone() } else { y.clone() }, "min");
                if !y.is_zero() {
                    encloses(a / b, &(x / y), &format!("div {i}"));
                }
            }
            encloses(a.abs(), &x.abs(), "abs");
            if !x.is_negative() && !a.sqrt().is_nan() {
                sqrt_encloses(a.sqrt(), x, "sqrt");
            }
        }
        let denominator_straddles_zero = eb[0] <= Q::zero() && eb[2] >= Q::zero();
        if denominator_straddles_zero {
            assert!((a / b).is_nan(), "division interval contains zero: {b:?}");
        }
        let c = a * b;
        for (count, result) in decisions[..7].iter_mut().zip([
            a + b, a - b, c, a / b, a.max(b), a.min(b), a.abs(),
        ]) {
            *count += usize::from(!result.is_nan());
        }
        decisions[7] += usize::from(!a.sqrt().is_nan());
        let norm = a.norm3(b, c);
        decisions[8] += usize::from(!norm.is_nan());
        if !norm.is_nan() && !c.is_nan() {
            for x in &ea {
                for y in &eb {
                    for z in values(c) {
                        sqrt_encloses(norm, &(x * x + y * y + &z * &z), "norm3");
                    }
                }
            }
        }
    }
    for (op, count) in ["add", "sub", "mul", "div", "max", "min", "abs", "sqrt", "norm3"].iter().zip(decisions) {
        assert!(count > 50, "{op} refused too many eligible cases: {count}");
    }
    assert!(
        non_point > 1_000 && subnormal > 200,
        "test generator lost radius/subnormal coverage: {non_point}, {subnormal}"
    );
}
