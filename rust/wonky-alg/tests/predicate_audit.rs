//! Exact-predicate audit (2026-10-02): replays the independent sympy corpus of
//! tests/data/predicate-audit.py. Expected values come from factorization over
//! Q and exact interval refinement, never from Sturm sequences or gcds. Inputs
//! include shared irrational roots across polynomials, multiplicities 2 and 3,
//! roots 2^-60 and 2^-100 apart, and roots at 2^-1074, 2^-1022, 1 +- ulp, 2^1023.
use std::cmp::Ordering;
use std::time::{Duration, Instant};
use wonky_alg::{
    isolate_real_roots, AlgebraError, AlgebraicReal, Limits, Polynomial, Rational,
    RationalInterval, Sign, SturmSequence,
};

// Correctness audit, not a budget audit: ample bisections for 2^-1074..2^1023.
const LIMITS: Limits = Limits {
    max_bisections: 1 << 20,
};

fn rational(s: &str) -> Rational {
    let (n, d) = s.split_once('/').expect("n/d");
    Rational::new(n.parse().unwrap(), d.parse().unwrap())
}

fn interval(a: &str, b: &str) -> RationalInterval {
    RationalInterval::new(rational(a), rational(b)).unwrap()
}

#[test]
fn sturm_isolation_cmp_and_sign_at_match_the_sympy_oracle() {
    let text = include_str!("data/predicate-audit.txt");
    let mut polys = Vec::<Polynomial>::new();
    let mut roots = Vec::<Vec<AlgebraicReal>>::new();
    let mut checked = [0usize; 5];
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let f: Vec<&str> = line.split_whitespace().collect();
        let id = |k: usize| f[k].parse::<usize>().unwrap();
        let started = Instant::now();
        match f[0] {
            "poly" => {
                assert_eq!(id(1), polys.len());
                let p = Polynomial::new(f[2..].iter().map(|s| rational(s)).collect()).unwrap();
                roots.push(isolate_real_roots(&p, LIMITS).unwrap());
                polys.push(p);
            }
            "roots" => {
                let got: Vec<usize> = roots[id(1)].iter().map(|r| r.multiplicity()).collect();
                let want: Vec<usize> = f[2..].iter().map(|s| s.parse().unwrap()).collect();
                assert_eq!(got, want, "{line}");
                for pair in roots[id(1)].windows(2) {
                    assert_eq!(pair[0].cmp(&pair[1], LIMITS), Ok(Ordering::Less), "{line}");
                }
                checked[0] += 1;
            }
            "count" => {
                let sturm = SturmSequence::new(&polys[id(1)]).unwrap();
                let iv = interval(f[2], f[3]);
                let got = [
                    sturm.count_open(&iv),
                    sturm.count_half_open(&iv),
                    sturm.count_closed(&iv),
                ];
                let want = [id(4), id(5), id(6)];
                assert_eq!(got, want, "{line}");
                checked[1] += 1;
            }
            "cert" => {
                let got = AlgebraicReal::from_interval(&polys[id(1)], interval(f[2], f[3]));
                match (f[4], got) {
                    ("ok", Ok(root)) => {
                        assert_eq!(root.multiplicity().to_string(), f[5], "{line}")
                    }
                    ("endpoint", Err(AlgebraError::EndpointIsRoot)) => (),
                    (want, Err(AlgebraError::NotIsolating { roots }))
                        if want == format!("notisolating:{roots}") => {}
                    (want, got) => panic!("{line}: expected {want}, got {got:?}"),
                }
                checked[2] += 1;
            }
            "cmp" => {
                let got = roots[id(1)][id(2)].cmp(&roots[id(3)][id(4)], LIMITS).unwrap();
                let want = f[5].parse::<i8>().unwrap().cmp(&0);
                assert_eq!(got, want, "{line}");
                checked[3] += 1;
            }
            "sign" => {
                let got = roots[id(1)][id(2)].sign_at(&polys[id(3)], LIMITS).unwrap();
                let want = match f[4] {
                    "-1" => Sign::Negative,
                    "0" => Sign::Zero,
                    _ => Sign::Positive,
                };
                assert_eq!(got, want, "{line}");
                checked[4] += 1;
            }
            other => panic!("unknown record {other}"),
        }
        if started.elapsed() > Duration::from_secs(2) {
            eprintln!("slow record ({:?}): {}", started.elapsed(), &line[..line.len().min(80)]);
        }
    }
    eprintln!(
        "predicate audit: {} polynomials, roots/count/cert/cmp/sign_at = {checked:?}",
        polys.len()
    );
    assert_eq!(checked, [56, 448, 448, 279, 283]);
}
