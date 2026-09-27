use num_rational::BigRational as Q;
use wonky_num::*;
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}

#[test]
fn invalid_intervals_never_become_finite_certificates() {
    let z = Iv::point(0.0);
    let invalid = [
        z / z,
        Iv::point(-1.0).sqrt(),
        Iv { m: 0.0, r: 1.0 }.sqrt(),
        Iv::point(f64::NAN),
        Iv::point(f64::INFINITY),
        Iv { m: 1.0, r: -1.0 },
        Iv::point(f64::MAX) * Iv::point(2.0),
        Iv::point(1.0) / Iv { m: 1.0, r: 1.0 },
        v3(0.0, 0.0, 0.0).iv().normalize().length(),
    ];
    for bad in invalid {
        for value in [bad, bad.sqrt(), bad.abs(), bad.max(z), z.min(bad), bad + z, bad * z, z / bad] {
            assert!(le(value, Iv::point(1.0), "invalid").map_err(|e| e.into_refusal()).is_err(), "certified {value:?} from {bad:?}");
            assert!(lt(value, z, "invalid").map_err(|e| e.into_refusal()).is_err());
            assert!(decide(value, "invalid").map_err(|e| e.into_refusal()).is_err());
        }
    }
}

#[test]
fn interval_arithmetic_encloses_exact_rationals_across_exponents() {
    let mut seed = 0x392ec59452ab89u64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut decisions = [0usize; 9]; // add, sub, mul, div, composed, norm3, abs, sqrt, max
    fn check(decisions: &mut [usize; 9], op: usize, v: Iv, x: Q) {
        if !v.is_nan() && v.lo().is_finite() && v.hi().is_finite() {
            decisions[op] += 1;
            assert!(q(v.lo()) <= x && x <= q(v.hi()), "not enclosed by {v:?}: {x}");
        }
    }
    for _ in 0..20_000 {
        let mut sample = || {
            let bits = next();
            let x = f64::from_bits((bits & ((1u64 << 52) - 1)) | ((1 + next() % 2046) << 52));
            if bits & 1 == 0 {
                x
            } else {
                -x
            }
        };
        let (a, b) = (sample(), sample());
        let (ia, ib) = (Iv::point(a), Iv::point(b));
        check(&mut decisions, 0, ia + ib, q(a) + q(b));
        check(&mut decisions, 1, ia - ib, q(a) - q(b));
        check(&mut decisions, 2, ia * ib, q(a) * q(b));
        check(&mut decisions, 3, ia / ib, q(a) / q(b));
        // Composition exercises propagated radii, not just singleton arithmetic.
        check(&mut decisions, 4, (ia + ib) * ib, (q(a) + q(b)) * q(b));
        check(&mut decisions, 8, ia.max(ib), q(a).max(q(b)));
        let component = ia + ib;
        let norm = component.norm3(ib, Iv::point(0.0));
        if !norm.is_nan() && norm.lo().is_finite() && norm.hi().is_finite() {
            let sum = q(a) + q(b);
            let square = &sum * &sum + q(b) * q(b);
            let lo = norm.lo().max(0.0);
            decisions[5] += 1;
            assert!(q(lo) * q(lo) <= square && q(norm.hi()) * q(norm.hi()) >= square);
        }
        check(&mut decisions, 6, ia.abs(), q(a.abs()));
        let s = ia.abs().sqrt();
        if !s.is_nan() && s.lo().is_finite() && s.hi().is_finite() {
            let lo = s.lo().max(0.0);
            decisions[7] += 1;
            assert!(q(lo) * q(lo) <= q(a.abs()));
            assert!(q(s.hi()) * q(s.hi()) >= q(a.abs()));
        }
    }
    for (op, count) in ["add", "sub", "mul", "div", "composed", "norm3", "abs", "sqrt", "max"].iter().zip(decisions) {
        assert!(count > 100, "{op} refused too many eligible cases: {count}");
    }
}

#[test]
fn finite_max_ball_may_publish_infinite_outward_endpoint() {
    let tiny = f64::from_bits(1);
    let positive = Iv { m: f64::MAX, r: tiny };
    let negative = Iv { m: -f64::MAX, r: tiny };
    assert!(!positive.is_nan() && !negative.is_nan());
    assert!(positive.hi().is_infinite() && positive.hi().is_sign_positive());
    assert!(negative.lo().is_infinite() && negative.lo().is_sign_negative());
}
