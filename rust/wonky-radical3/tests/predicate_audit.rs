//! Exact-predicate audit (2026-10-02): replays the independent sympy corpus of
//! rust/wonky-alg/tests/data/predicate-audit.py. Expected signs are certified by
//! mpmath interval arithmetic; exact zeros by minimal_polynomial == x. Inputs
//! include near-cancelling binary64 sums and their ulp neighbours, equal and
//! dependent radicands (r, 4r, r/4, 9r), exact zeros in the product basis, and
//! inputs at and just outside the admitted range [1e-150, 1e150].
//! Every in-range input must be decided correctly or refused by name; an
//! out-of-range input must be refused as OutOfRange; a compare whose radicand
//! union exceeds three must be the documented degree refusal.
use wonky_num::{Sign, UndecidedKind};
use wonky_radical3::{sum3, Dyadic, Radical3};

fn word(s: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(s, 16).unwrap())
}

fn sign(s: &str) -> Sign {
    match s {
        "-1" => Sign::Negative,
        "0" => Sign::Zero,
        "1" => Sign::Positive,
        other => panic!("not a sign: {other}"),
    }
}

fn value(f: &[&str]) -> Result<Radical3, wonky_num::Refusal> {
    let t = |k: usize| (word(f[1 + 2 * k]), word(f[2 + 2 * k]));
    sum3(word(f[0]), [t(0), t(1), t(2)]).map_err(|u| u.into_refusal())
}

#[derive(Debug, Default)]
struct Tally {
    decided: usize,
    zeros: usize,
    out_of_range: usize,
    degree: usize,
    refused: Vec<String>,
}

impl Tally {
    fn decide(&mut self, line: &str, want: &str, got: Result<Sign, wonky_num::Refusal>) {
        match got {
            Ok(s) => {
                assert_eq!(s, sign(want), "{line}");
                self.decided += 1;
                self.zeros += usize::from(s == Sign::Zero);
            }
            Err(r) => {
                assert_ne!(r.kind, UndecidedKind::OutOfRange, "{line}: in-range input refused {r}");
                self.refused.push(format!("{r}"));
            }
        }
    }
}

#[test]
fn radical3_signs_and_compares_match_the_sympy_oracle() {
    let text = include_str!("data/predicate-audit.txt");
    let mut tally = Tally::default();
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let f: Vec<&str> = line.split(' ').collect();
        match (f[0], f[1]) {
            ("sum3", "out") => {
                let r = value(&f[2..]).err().expect("out-of-range input admitted");
                assert_eq!(r.kind, UndecidedKind::OutOfRange, "{line}");
                tally.out_of_range += 1;
            }
            ("sum3", want) => {
                let got = value(&f[2..]).and_then(|v| v.sign().map_err(|u| u.into_refusal()));
                tally.decide(line, want, got);
            }
            ("general", want) => {
                let d = |k: usize| Dyadic::new(word(f[2 + k])).map_err(|u| u.into_refusal());
                let got = (|| {
                    let roots = [d(0)?, d(1)?, d(2)?];
                    let coefficients = (3..11).map(d).collect::<Result<Vec<_>, _>>()?;
                    Radical3::new(roots, coefficients.try_into().unwrap())
                        .and_then(|v| v.sign())
                        .map_err(|u| u.into_refusal())
                })();
                tally.decide(line, want, got);
            }
            ("cmp", want) => {
                let (x, y) = (value(&f[2..9]).unwrap(), value(&f[9..16]).unwrap());
                let got = x.compare(&y).map_err(|u| u.into_refusal());
                if want == "degree" {
                    let r = got.err().expect("four radicands compared");
                    assert_eq!(r.site, "radical3.degree_budget", "{line}");
                    tally.degree += 1;
                } else {
                    tally.decide(line, want, got);
                }
            }
            _ => panic!("unknown record {line}"),
        }
    }
    eprintln!("radical3 audit: {tally:?}");
    // This frozen corpus is fully decidable except for its explicit range and
    // degree negatives. A new refusal must not hide a lost exact decision.
    assert!(tally.refused.is_empty(), "unexpected refusals: {:?}", tally.refused);
    assert_eq!((tally.decided, tally.zeros, tally.out_of_range, tally.degree),
        (706, 90, 12, 50));
    assert_eq!(
        tally.decided + tally.out_of_range + tally.degree + tally.refused.len(),
        387 + 190 + 191
    );
}
