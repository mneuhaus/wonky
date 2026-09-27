//! 100,000 predeclared comparisons (20k constructions x 5 independent predicates).
//! A wonky-num refusal is recorded, never coerced into an agreement.
use wonky_num::{p2, v3};
use wonky_oracle::{adversarial::Generator, point2, point3};

#[derive(Clone, Copy, Default)]
struct Coverage {
    calls: usize,
    decided: usize,
    refused: usize,
}

fn check(got: wonky_num::Decision, expected: i8, coverage: &mut Coverage) {
    coverage.calls += 1;
    match got {
        Ok(actual) => {
            coverage.decided += 1;
            assert_eq!(actual.to_i32(), i32::from(expected));
        }
        Err(undecided) => {
            let record = undecided.into_refusal();
            assert_eq!(record.site, "oracle-crosscheck");
            coverage.refused += 1;
        }
    }
}
#[test]
fn hundred_thousand_literal_f64_predicates() {
    const PREDICATES: [&str; 5] = [
        "orient2d",
        "orient3d",
        "plane_side",
        "dot_sign",
        "line_point_side",
    ];
    let mut gen = Generator::new(0xcafe_1234_5678_9abc);
    let mut coverage = [Coverage::default(); 5];
    let site = "oracle-crosscheck";
    for i in 0..20_000 {
        let (a, b, c, d, n, t) = match i % 4 {
            0 => {
                let x = (gen.next_u64() % 1000) as f64;
                let y = (gen.next_u64() % 1000) as f64;
                (
                    [x, y, 0.0],
                    [y, x, 1.0],
                    [x + 1.0, y - 1.0, 2.0],
                    [y + 1.0, x + 1.0, -2.0],
                    [1.0, -2.0, 3.0],
                    2.0,
                )
            }
            1 => {
                let m = gen.kernel_power();
                // Smallest kernel-range powers divided by 2 can be refused by policy.
                (
                    [m, 0.0, 0.0],
                    [0.0, m, 0.0],
                    [0.0, 0.0, m],
                    [m, m, m],
                    [m, m, m],
                    1.0,
                )
            }
            2 => {
                let (exact, near) = gen.near_collinear();
                let c = if gen.next_u64() & 1 == 0 {
                    exact[2]
                } else {
                    near[2]
                };
                (
                    [exact[0][0], exact[0][1], 0.0],
                    [exact[1][0], exact[1][1], 0.0],
                    [c[0], c[1], 0.0],
                    [c[0], c[1], 1.0],
                    [1.0, -1.0, 1.0],
                    1.0,
                )
            }
            _ => {
                let x = (gen.next_u64() % 1024) as f64;
                let ulp = f64::from_bits(x.to_bits() + 1);
                (
                    [x, x, x],
                    [ulp, x + 1.0, x],
                    [x + 1.0, ulp, x],
                    [x, x, ulp],
                    [1.0, 1.0, -2.0],
                    0.5,
                )
            }
        };
        let (ra, rb, rc, rd, rn) = (
            point3(a).unwrap(),
            point3(b).unwrap(),
            point3(c).unwrap(),
            point3(d).unwrap(),
            point3(n).unwrap(),
        );
        let (a2, b2, c2) = (
            point2([a[0], a[1]]).unwrap(),
            point2([b[0], b[1]]).unwrap(),
            point2([c[0], c[1]]).unwrap(),
        );
        check(
            wonky_num::orient2d(p2(a[0], a[1]), p2(b[0], b[1]), p2(c[0], c[1]), site),
            wonky_oracle::orientation2d(&a2, &b2, &c2),
            &mut coverage[0],
        );
        check(
            wonky_num::orient3d(
                v3(a[0], a[1], a[2]),
                v3(b[0], b[1], b[2]),
                v3(c[0], c[1], c[2]),
                v3(d[0], d[1], d[2]),
                site,
            ),
            wonky_oracle::orientation3d(&ra, &rb, &rc, &rd),
            &mut coverage[1],
        );
        check(
            wonky_num::plane_side(
                v3(n[0], n[1], n[2]),
                v3(d[0], d[1], d[2]),
                v3(a[0], a[1], a[2]),
                site,
            ),
            wonky_oracle::plane_side(&rn, &rd, &ra),
            &mut coverage[2],
        );
        check(
            wonky_num::dot_sign(v3(n[0], n[1], n[2]), v3(c[0], c[1], c[2]), site),
            wonky_oracle::dot_sign(&rn, &rc),
            &mut coverage[3],
        );
        check(
            wonky_num::line_point_side(
                v3(n[0], n[1], n[2]),
                v3(b[0], b[1], b[2]),
                v3(a[0], a[1], a[2]),
                v3(d[0], d[1], d[2]),
                t,
                site,
            ),
            wonky_oracle::line_point_side(&rn, &rb, &ra, &rd, &wonky_oracle::binary64(t).unwrap()),
            &mut coverage[4],
        );
    }
    for (name, counts) in PREDICATES.into_iter().zip(coverage) {
        assert_eq!(
            counts.calls, 20_000,
            "{name}: missing predicate invocations"
        );
        assert_eq!(
            counts.decided + counts.refused,
            counts.calls,
            "{name}: unaccounted outcomes"
        );
        assert!(
            counts.decided > 15_000,
            "{name}: excessive refusals: {} of {} calls",
            counts.refused,
            counts.calls
        );
        eprintln!(
            "oracle cross-check {name}: {} exact decisions agree, {} named refusals, {} calls",
            counts.decided, counts.refused, counts.calls
        );
    }
}
