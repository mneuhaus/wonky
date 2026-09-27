//! Primary numeric oracle: arbitrary precision rational squaring, independent
//! of expansion arithmetic and its interval bounds. Every attempted CAD case
//! must decide (no all-refuse pass); all three signs and both arities occur.
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use std::io::{BufWriter, Write};
use wonky_n2::*;

// EX1 consumes the actual API results, never the rational expected values.
// Canonical Python float.hex form preserves all authoritative binary64 bits.
fn hex(x: f64) -> String {
    let bits = x.to_bits();
    let sign = if bits >> 63 != 0 { "-" } else { "" };
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1_u64 << 52) - 1);
    if exponent == 0 && fraction == 0 {
        return format!("{sign}0x0.0p+0");
    }
    assert!(exponent > 0 && exponent < 0x7ff);
    format!("{sign}0x1.{fraction:013x}p{:+}", exponent - 1023)
}
fn certificate(writer: &mut impl Write, values: &[f64], sign: Sign) {
    let name = match values.len() {
        3 => "one_surd_sign",
        5 => "two_surd_sign",
        _ => unreachable!(),
    };
    let inputs = values
        .iter()
        .map(|&x| format!("\"{}\"", hex(x)))
        .collect::<Vec<_>>()
        .join(",");
    writeln!(
        writer,
        "{{\"predicate\":\"{name}\",\"inputs\":[{inputs}],\"claimed\":{{\"Sign\":\"{sign:?}\"}}}}"
    )
    .unwrap();
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn sg(a: &Q) -> i32 {
    if a.is_zero() {
        0
    } else if a.is_positive() {
        1
    } else {
        -1
    }
}
fn one(a: Q, b: Q, c: Q) -> i32 {
    if c.is_zero() || b.is_zero() {
        return sg(&a);
    }
    if a.is_zero() {
        return sg(&b);
    }
    if sg(&a) == sg(&b) {
        return sg(&a);
    }
    sg(&a) * sg(&(&a * &a - &b * &b * c))
}
// Isolate the rational a against the SUM of the two roots, instead of the
// production tower which isolates the second radical. This different
// elimination order also protects the reference from copied branch errors.
fn reference(v: [f64; 5]) -> i32 {
    reference_q(v.map(q))
}
fn reference_q([a, b, c, d, e]: [Q; 5]) -> i32 {
    let t = if b.is_zero() || c.is_zero() {
        sg(&d) * sg(&e)
    } else if d.is_zero() || e.is_zero() {
        sg(&b)
    } else if sg(&b) == sg(&d) {
        sg(&b)
    } else {
        sg(&b) * sg(&(&b * &b * &c - &d * &d * &e))
    };
    if a.is_zero() {
        return t;
    }
    if t == 0 || sg(&a) == t {
        return sg(&a);
    }
    // a^2 - (b sqrt(c)+d sqrt(e))^2
    let h = &a * &a - &b * &b * &c - &d * &d * &e;
    let k = -q(2.) * b * d;
    sg(&a) * one(h, k, c * e)
}
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn f(&mut self) -> f64 {
        let n = self.next();
        let k = (self.next() % 81) as i32 - 40;
        ((n >> 11) as f64 / (1u64 << 52) as f64 - 1.) * 2.0_f64.powi(k)
    }
}
#[test]
fn million_random_and_hundred_thousand_near_degenerate_against_rationals() {
    let mut rng = Rng(0x918ada89cc239ef1);
    let mut counts = [0_usize; 3];
    let mut calls = 0;
    let mut output = std::env::var_os("N2_CERTIFICATES")
        .map(|path| BufWriter::new(std::fs::File::create(path).unwrap()));
    let mut recorded = 0;
    for i in 0..1_100_000 {
        let mut v = [rng.f(), rng.f(), rng.f().abs(), rng.f(), rng.f().abs()];
        if i % 3 == 0 {
            v[3] = 0.;
            v[4] = 0.;
        }
        if i >= 1_000_000 {
            match i % 5 {
                0 => {
                    v = [0., v[1], v[2], -v[1], v[2]];
                } // exact cancellation, irrational
                1 => {
                    let r = (rng.next() % 4096 + 1) as f64;
                    v = [-r, 1., r * r, 0., 0.];
                }
                2 => {
                    v[0] = -(v[1] * v[2].sqrt() + v[3] * v[4].sqrt());
                }
                3 => {
                    v[0] = (-(v[1] * v[2].sqrt() + v[3] * v[4].sqrt())).next_up();
                }
                _ => {
                    v[0] = (-(v[1] * v[2].sqrt() + v[3] * v[4].sqrt())).next_down();
                }
            }
        }
        let expected = reference(v);
        let got = if v[3] == 0. && v[4] == 0. {
            sign_one(v[0], v[1], v[2])
        } else {
            sign_two(v[0], v[1], v[2], v[3], v[4])
        };
        let got = got.unwrap_or_else(|e| panic!("unexpected refusal {e:?}, case {i}: {v:?}"));
        assert_eq!(got.to_i32(), expected, "case {i}: {v:?}");
        counts[(expected + 1) as usize] += 1;
        calls += 1;
        if i >= 1_000_000 || i % 10 == 0 {
            if let Some(writer) = &mut output {
                let inputs = if v[3] == 0. && v[4] == 0. {
                    &v[..3]
                } else {
                    &v[..]
                };
                certificate(writer, inputs, got);
                recorded += 1;
            }
        }
        // Metamorphism changes authoritative words exactly; no floating
        // construction of the expected sign. Exercise every thousandth case.
        if i % 1000 == 0 {
            assert_eq!(
                sign_two(-v[0], -v[1], v[2], -v[3], v[4]).unwrap(),
                got.flip()
            );
            assert_eq!(
                sign_two(v[0] * 8., v[1] * 8., v[2], v[3] * 8., v[4]).unwrap(),
                got
            );
        }
    }
    if let Some(mut writer) = output {
        writer.flush().unwrap();
        assert_eq!(recorded, 200_000);
        eprintln!("N2 EX1 certificates={recorded} (100000 random + all 100000 near-degenerate)");
    }
    assert_eq!(calls, 1_100_000);
    assert!(counts.iter().all(|&n| n > 10000));
    eprintln!("N2 random=1000000 near=100000 calls={calls} metamorphic_calls=2200 refusals=0 wrong=0 signs={counts:?}");
}
#[test]
fn wide_exponents_compare_every_decision_and_count_refusals() {
    let mut rng = Rng(0xafa16889);
    let mut accepted = 0;
    let mut refused = 0;
    let mut out_of_range = 0;
    for i in 0..5000 {
        let v = std::array::from_fn(|slot| {
            let exponent = (rng.next() % 997) as i32 - 498;
            let x = (1. + (rng.next() >> 11) as f64 / (1u64 << 53) as f64) * 2.0_f64.powi(exponent);
            if slot == 2 || slot == 4 || rng.next() % 2 == 0 {
                x
            } else {
                -x
            }
        });
        let expected = reference(v);
        let invalid = v
            .iter()
            .any(|x| *x != 0.0 && (x.abs() < 1e-150 || x.abs() > 1e150));
        match sign_two(v[0], v[1], v[2], v[3], v[4]) {
            Ok(s) => {
                assert!(!invalid, "out-of-range input accepted: {v:?}");
                assert_eq!(s.to_i32(), expected, "wide {i} {v:?}");
                accepted += 1;
            }
            Err(Refusal::Numeric(wonky_num::Refusal {
                kind: wonky_num::UndecidedKind::NotExact,
                ..
            })) => {
                assert!(!invalid);
                refused += 1;
            }
            Err(Refusal::Numeric(wonky_num::Refusal {
                kind: wonky_num::UndecidedKind::OutOfRange,
                ..
            })) => {
                assert!(invalid, "in-range input refused: {v:?}");
                out_of_range += 1;
            }
            e => panic!("unexpected wide result {e:?} for {v:?}"),
        }
    }
    assert!(
        accepted >= 4000,
        "refusal farming: {accepted} accepted, {refused} refused"
    );
    assert_eq!(accepted + refused + out_of_range, 5000);
    eprintln!("N2 wide=5000 accepted={accepted} named_not_exact={refused} out_of_range={out_of_range} wrong=0");
}
#[test]
fn incircle_against_rational_determinants() {
    let mut rng = Rng(0x371119cba);
    let mut counts = [0; 3];
    for _ in 0..10_000 {
        let pts: [[f64; 2]; 4] = std::array::from_fn(|_| [rng.f(), rng.f()]);
        let [a, b, c, d] = pts;
        let v: [[_; 2]; 3] = [a, b, c].map(|p| [q(p[0]) - q(d[0]), q(p[1]) - q(d[1])]);
        let [a, b, c] = v;
        let norm = |p: &[Q; 2]| &p[0] * &p[0] + &p[1] * &p[1];
        let cross = |p: &[Q; 2], q: &[Q; 2]| &p[0] * &q[1] - &p[1] * &q[0];
        let expected =
            sg(&(norm(&a) * cross(&b, &c) + norm(&b) * cross(&c, &a) + norm(&c) * cross(&a, &b)));
        let [a, b, c, d] = pts;
        assert_eq!(incircle(a, b, c, d).unwrap().to_i32(), expected);
        counts[(expected + 1) as usize] += 1;
    }
    assert!(counts[0] > 1000 && counts[2] > 1000);
}
#[test]
fn circle_order_random_intersections_is_monotone_on_each_quadrant() {
    let mut rng = Rng(0x679dea201);
    for _ in 0..2000 {
        let y1 = (rng.next() % 1_000_000 + 1) as f64 / 1_000_001.;
        let y2 = (rng.next() % 1_000_000 + 1) as f64 / 1_000_001.;
        let c = Circle {
            center: [0.; 2],
            radius: 1.,
        };
        let line = |y| Line {
            origin: [0., y],
            direction: [1., 0.],
        };
        let two = |hits| match hits {
            Intersections::Two(p) => p,
            _ => panic!("expected two"),
        };
        let [left1, right1] = two(circle_line(c, line(y1)).unwrap());
        let [left2, right2] = two(circle_line(c, line(y2)).unwrap());
        let expected = Sign::of_exact(y1 - y2); // dyadic difference sign, no rounded roots
        assert_eq!(compare_along_circle(c, &right1, &right2).unwrap(), expected);
        assert_eq!(
            compare_along_circle(c, &left1, &left2).unwrap(),
            expected.flip()
        );
        assert_eq!(
            compare_along_circle(c, &right1, &left2).unwrap(),
            Sign::Negative
        );
        // Different constructions and non-unit direction, equivalent exact
        // points. Unlike a boundary-only residual check this requires both
        // distinct roots, with correct pairing and parameter order.
        let cc = two(circle_circle(
            c,
            Circle {
                center: [2. * y1, 0.],
                radius: 1.,
            },
        )
        .unwrap());
        let cl = two(circle_line(
            c,
            Line {
                origin: [y1, 0.],
                direction: [0., 3.],
            },
        )
        .unwrap());
        for i in 0..2 {
            assert_eq!(compare_along_circle(c, &cc[i], &cl[i]).unwrap(), Sign::Zero);
        }
        assert_eq!(
            compare_along_line(
                Line {
                    origin: [y1, 0.],
                    direction: [0., 3.]
                },
                &cc[0],
                &cc[1]
            )
            .unwrap(),
            Sign::Negative
        );
    }
}

#[test]
fn quadratic_parameters_keep_rational_denominators_exact() {
    let mut rng = Rng(0xbad1922287);
    for _ in 0..5000 {
        let a = [rng.f(), rng.f()];
        let b = [rng.f(), rng.f()];
        let c = rng.f().abs();
        let den = (rng.next() % 63 + 1) as f64;
        let d = [rng.f(), rng.f()];
        let e = [rng.f(), rng.f()];
        let f = rng.f().abs();
        let other_den = (rng.next() % 63 + 1) as f64;
        let p = Point::quadratic(a, b, c, den).unwrap();
        let other = Point::quadratic(d, e, f, other_den).unwrap();
        for axis in 0..2 {
            let expected = reference_q([
                q(a[axis]) / q(den) - q(d[axis]) / q(other_den),
                q(b[axis]) / q(den),
                q(c),
                -q(e[axis]) / q(other_den),
                q(f),
            ]);
            assert_eq!(
                p.compare_coordinate(&other, axis).unwrap().to_i32(),
                expected
            );
        }
    }
}
