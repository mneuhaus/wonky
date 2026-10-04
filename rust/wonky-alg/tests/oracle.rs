//! Seeded property tests of the curve toolkit against an INDEPENDENT oracle.
//!
//! Every case is built from a table of monic factors (rational linear, random
//! quadratic, cubic or sextic) with known multiplicities; a second polynomial
//! (the partner) shares one factor, so shared and double/triple roots are
//! frequent, and interval endpoints are drawn from the rational roots themselves.
//! The oracle never calls Sturm, gcd, square-free decomposition or the crate's
//! basis changes: square-freeness and coprimality are Sylvester resultants,
//! roots are isolated per factor by Bernstein (Descartes) subdivision with exact
//! signs, and positions are decided by exact sign evaluation and bisection.
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering;
use wonky_alg::{
    isolate_real_roots, Limits, Polynomial, Rational, RationalInterval, SturmSequence,
};

type Q = Rational;

fn q(n: i64, d: i64) -> Q {
    Q::new(n.into(), d.into())
}

struct Lcg(u64);
impl Lcg {
    fn new(seed: u64) -> Self {
        let mut rng = Self(seed ^ 0x9e37_79b9_7f4a_7c15);
        rng.next();
        rng
    }
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn int(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as usize) as i64
    }
    /// Small-denominator rationals: the same grid feeds roots and interval ends.
    fn grid(&mut self) -> Q {
        q(self.int(-12, 12), [1, 2, 3, 4][self.below(4)])
    }
    fn coefficient(&mut self) -> Q {
        q(self.int(-9, 9), [1, 2, 4][self.below(3)])
    }
    fn unit(&mut self) -> Q {
        let n = self.int(1, 9) * if self.below(2) == 0 { 1 } else { -1 };
        q(n, self.int(1, 5))
    }
}

// ---- test-local dense arithmetic, ascending coefficients ----

fn mul(a: &[Q], b: &[Q]) -> Vec<Q> {
    let mut c = vec![Q::zero(); a.len() + b.len() - 1];
    for (i, x) in a.iter().enumerate() {
        for (j, y) in b.iter().enumerate() {
            c[i + j] += x * y;
        }
    }
    c
}

fn eval(c: &[Q], x: &Q) -> Q {
    c.iter().rev().fold(Q::zero(), |acc, a| acc * x + a)
}

fn sign(x: &Q) -> i8 {
    if x.is_zero() {
        0
    } else if x.is_positive() {
        1
    } else {
        -1
    }
}

fn derivative(c: &[Q]) -> Vec<Q> {
    c.iter()
        .enumerate()
        .skip(1)
        .map(|(i, a)| a * q(i as i64, 1))
        .collect()
}

fn power(f: &[Q], m: usize) -> Vec<Q> {
    (0..m).fold(vec![Q::one()], |acc, _| mul(&acc, f))
}

/// Sylvester resultant by exact Gaussian elimination: zero iff f and g share a root.
fn resultant(f: &[Q], g: &[Q]) -> Q {
    let (m, n) = (f.len() - 1, g.len() - 1);
    let size = m + n;
    let mut rows = Vec::with_capacity(size);
    for (shift, source) in (0..n).map(|s| (s, f)).chain((0..m).map(|s| (s, g))) {
        let mut row = vec![Q::zero(); size];
        for (k, c) in source.iter().rev().enumerate() {
            row[shift + k] = c.clone();
        }
        rows.push(row);
    }
    let mut det = Q::one();
    for col in 0..size {
        let Some(pivot) = (col..size).find(|&r| !rows[r][col].is_zero()) else {
            return Q::zero();
        };
        if pivot != col {
            rows.swap(pivot, col);
            det = -det;
        }
        det *= &rows[col][col];
        for r in col + 1..size {
            let factor = &rows[r][col] / &rows[col][col];
            for c in col..size {
                let delta = &factor * &rows[col][c];
                rows[r][c] -= delta;
            }
        }
    }
    det
}

// ---- oracle: Descartes subdivision on Bernstein coefficients, exact signs ----

fn binomial(n: usize, k: usize) -> Q {
    q(
        (0..k).fold(1i64, |acc, i| acc * (n - i) as i64 / (i + 1) as i64),
        1,
    )
}

/// Bernstein coefficients of f on [lo, hi] by blossoming (polar form), a route
/// independent of the crate's basis conversion.
fn bernstein_on(f: &[Q], lo: &Q, hi: &Q) -> Vec<Q> {
    let n = f.len() - 1;
    (0..=n)
        .map(|k| {
            f.iter().enumerate().fold(Q::zero(), |sum, (i, c)| {
                let mut blossom = Q::zero();
                for j in i.saturating_sub(n - k)..=i.min(k) {
                    blossom += binomial(k, j)
                        * binomial(n - k, i - j)
                        * num_traits::pow(lo.clone(), i - j)
                        * num_traits::pow(hi.clone(), j);
                }
                sum + c * blossom / binomial(n, i)
            })
        })
        .collect()
}

fn variations(b: &[Q]) -> usize {
    let signs: Vec<i8> = b.iter().map(sign).filter(|&s| s != 0).collect();
    signs.windows(2).filter(|w| w[0] != w[1]).count()
}

/// An oracle root of factor `factor`: a point, or an open interval holding exactly
/// one root of that factor with opposite nonzero signs at both ends.
#[derive(Clone, Debug)]
struct Root {
    factor: usize,
    lo: Q,
    hi: Q,
}

const ORACLE_STEPS: usize = 200_000;

fn isolate(f: &[Q], factor: usize, steps: &mut usize) -> Vec<Root> {
    let lead = f.last().unwrap();
    let max = f[..f.len() - 1]
        .iter()
        .map(|c| (c / lead).abs())
        .max()
        .unwrap_or_else(Q::zero);
    let bound = Q::from_integer(max.ceil().to_integer()) + q(2, 1);
    let mut stack = vec![(-bound.clone(), bound)];
    let mut roots = Vec::new();
    while let Some((lo, hi)) = stack.pop() {
        *steps = steps.checked_sub(1).expect("oracle subdivision undecided");
        let v = variations(&bernstein_on(f, &lo, &hi));
        if v == 0 {
            continue;
        }
        if v == 1 && !eval(f, &lo).is_zero() && !eval(f, &hi).is_zero() {
            roots.push(Root { factor, lo, hi });
            continue;
        }
        let mid = (&lo + &hi) / q(2, 1);
        if eval(f, &mid).is_zero() {
            roots.push(Root {
                factor,
                lo: mid.clone(),
                hi: mid.clone(),
            });
        }
        stack.push((lo, mid.clone()));
        stack.push((mid, hi));
    }
    roots
}

/// Order of the root relative to the rational `a`, by one exact sign evaluation.
fn root_vs(factors: &[Vec<Q>], root: &Root, a: &Q) -> Ordering {
    if root.lo == root.hi {
        return root.lo.cmp(a);
    }
    if a <= &root.lo {
        return Ordering::Greater;
    }
    if a >= &root.hi {
        return Ordering::Less;
    }
    let f = &factors[root.factor];
    match sign(&eval(f, a)) {
        0 => Ordering::Equal,
        s if s == sign(&eval(f, &root.lo)) => Ordering::Greater,
        _ => Ordering::Less,
    }
}

fn bisect(factors: &[Vec<Q>], root: &mut Root) {
    let mid = (&root.lo + &root.hi) / q(2, 1);
    match root_vs(factors, root, &mid) {
        Ordering::Equal => {
            root.lo = mid.clone();
            root.hi = mid;
        }
        Ordering::Less => root.hi = mid,
        Ordering::Greater => root.lo = mid,
    }
}

/// Roots of distinct (coprime) factors differ; roots of one factor are separated.
fn oracle_cmp(factors: &[Vec<Q>], a: &Root, b: &Root) -> Ordering {
    if a.factor == b.factor && a.lo == b.lo && a.hi == b.hi {
        return Ordering::Equal;
    }
    let (mut a, mut b) = (a.clone(), b.clone());
    for _ in 0..ORACLE_STEPS {
        if a.lo == a.hi {
            return root_vs(factors, &b, &a.lo).reverse();
        }
        if b.lo == b.hi {
            return root_vs(factors, &a, &b.lo);
        }
        if a.hi <= b.lo {
            return Ordering::Less;
        }
        if b.hi <= a.lo {
            return Ordering::Greater;
        }
        if &a.hi - &a.lo >= &b.hi - &b.lo {
            bisect(factors, &mut a);
        } else {
            bisect(factors, &mut b);
        }
    }
    panic!("oracle comparison undecided");
}

// ---- generated cases ----

struct Case {
    factors: Vec<Vec<Q>>,
    /// (factor index, multiplicity) of the polynomial under test and of its partner.
    p: Vec<(usize, usize)>,
    partner: Vec<(usize, usize)>,
    unit: Q,
    partner_unit: Q,
}

/// Factor kinds: L linear (rational root on the grid), Q quadratic, C cubic, S sextic.
fn factor(rng: &mut Lcg, kind: char) -> Vec<Q> {
    let degree = match kind {
        'L' => return vec![-rng.grid(), Q::one()],
        'Q' => 2,
        'C' => 3,
        'S' => 6,
        _ => unreachable!(),
    };
    let mut c: Vec<Q> = (0..degree).map(|_| rng.coefficient()).collect();
    c.push(Q::one());
    c
}

const CUBICS: &[&[(char, usize)]] = &[
    &[('L', 1), ('L', 1), ('L', 1)],
    &[('L', 2), ('L', 1)],
    &[('L', 3)],
    &[('L', 1), ('Q', 1)],
    &[('C', 1)],
];
const SEXTICS: &[&[(char, usize)]] = &[
    &[('C', 1), ('C', 1)],
    &[('C', 2)],
    &[('L', 2), ('Q', 1), ('L', 2)],
    &[('Q', 3)],
    &[('L', 3), ('C', 1)],
    &[('Q', 1), ('Q', 1), ('Q', 1)],
    &[('L', 1), ('L', 1), ('L', 1), ('L', 1), ('L', 1), ('L', 1)],
    &[('S', 1)],
    &[('L', 2), ('Q', 2)],
    &[('L', 1), ('L', 2), ('C', 1)],
];

fn generate(seed: u64, families: &[&[(char, usize)]]) -> Case {
    let family = families[seed as usize % families.len()];
    for attempt in 0..1000 {
        let mut rng = Lcg::new(seed * 1000 + attempt);
        let mut factors = Vec::new();
        let mut p = Vec::new();
        for &(kind, multiplicity) in family {
            p.push((factors.len(), multiplicity));
            factors.push(factor(&mut rng, kind));
        }
        // The partner shares one factor of p (a shared root, possibly repeated)
        // and adds one fresh linear or quadratic factor.
        let shared = rng.below(p.len());
        let fresh = factors.len();
        let kind = if rng.below(2) == 0 { 'L' } else { 'Q' };
        factors.push(factor(&mut rng, kind));
        let partner = vec![(p[shared].0, 1 + rng.below(2)), (fresh, 1)];
        let square_free = factors
            .iter()
            .all(|f| f.len() == 2 || !resultant(f, &derivative(f)).is_zero());
        let coprime = (0..factors.len()).all(|i| {
            (i + 1..factors.len()).all(|j| !resultant(&factors[i], &factors[j]).is_zero())
        });
        if square_free && coprime {
            return Case {
                factors,
                p,
                partner,
                unit: rng.unit(),
                partner_unit: rng.unit(),
            };
        }
    }
    panic!("seed {seed}: no square-free coprime factor table in 1000 attempts");
}

fn expand(case: &Case, parts: &[(usize, usize)], unit: &Q) -> Vec<Q> {
    parts.iter().fold(vec![unit.clone()], |acc, &(i, m)| {
        mul(&acc, &power(&case.factors[i], m))
    })
}

/// Distinct real roots with multiplicity, in increasing order, by the oracle.
fn oracle_roots(case: &Case, parts: &[(usize, usize)], steps: &mut usize) -> Vec<(Root, usize)> {
    let mut roots = Vec::new();
    for &(i, m) in parts {
        roots.extend(
            isolate(&case.factors[i], i, steps)
                .into_iter()
                .map(|r| (r, m)),
        );
    }
    roots.sort_by(|a, b| oracle_cmp(&case.factors, &a.0, &b.0));
    roots
}

fn de_casteljau(b: &[Q], t: &Q) -> Q {
    let mut b = b.to_vec();
    for level in (1..b.len()).rev() {
        for i in 0..level {
            b[i] = (Q::one() - t) * &b[i] + t * &b[i + 1];
        }
    }
    b[0].clone()
}

/// What the seeded cases exercised, so a degenerate generator cannot pass vacuously.
#[derive(Debug, Default)]
struct Coverage {
    /// Intervals [a, b], a < b, with a root exactly at an end.
    endpoint_roots: usize,
    /// Distinct roots of multiplicity >= 2 (double and triple).
    repeated_roots: usize,
    /// Roots the oracle only brackets (not found exactly as a dyadic point).
    bracketed_roots: usize,
    /// Root pairs of the polynomial and its partner that are the same number.
    shared_equal: usize,
    /// Deflations at a rational root of multiplicity >= 2.
    repeated_deflations: usize,
    /// Compared pairs whose certificates leave the order open: equal ones need the
    /// gcd test of `cmp`, distinct ones its bisection.
    overlapping_equal: usize,
    overlapping_distinct: usize,
}

/// Whether two certificates alone leave the order of their roots open: they are
/// not both points and they overlap beyond a shared endpoint.
fn undecided(a: &RationalInterval, b: &RationalInterval) -> bool {
    !(a.is_point() && b.is_point()) && a.upper() > b.lower() && b.upper() > a.lower()
}

fn check_case(seed: u64, case: &Case, rng: &mut Lcg, seen: &mut Coverage) {
    let limits = Limits::default();
    let mut steps = ORACLE_STEPS;
    let coefficients = expand(case, &case.p, &case.unit);
    let p = Polynomial::new(coefficients.clone()).unwrap();
    let roots = oracle_roots(case, &case.p, &mut steps);
    let sturm = SturmSequence::new(&p).unwrap();
    assert_eq!(
        sturm.real_root_count(),
        roots.len(),
        "seed {seed}: root count"
    );

    // Interval counts. Ends: every rational root of a linear factor (endpoint
    // roots), three grid points and two far bounds; all pairs, including [a, a].
    let mut ends: Vec<Q> = case
        .p
        .iter()
        .filter(|&&(i, _)| case.factors[i].len() == 2)
        .map(|&(i, _)| -case.factors[i][0].clone())
        .collect();
    ends.extend((0..3).map(|_| rng.grid()));
    ends.extend([q(-40, 1), q(40, 1)]);
    ends.sort();
    ends.dedup();
    for (i, a) in ends.iter().enumerate() {
        for b in &ends[i..] {
            let interval = RationalInterval::new(a.clone(), b.clone()).unwrap();
            let (mut open, mut at_a, mut at_b) = (0, 0, 0);
            for (root, _) in &roots {
                let (oa, ob) = (
                    root_vs(&case.factors, root, a),
                    root_vs(&case.factors, root, b),
                );
                open += usize::from(oa == Ordering::Greater && ob == Ordering::Less);
                at_a += usize::from(oa == Ordering::Equal);
                at_b += usize::from(ob == Ordering::Equal);
            }
            seen.endpoint_roots += usize::from(a != b && at_a + at_b > 0);
            let (half_open, closed) = if a == b {
                (0, at_a)
            } else {
                (open + at_a, open + at_a + at_b)
            };
            let context = format!("seed {seed}: [{a}, {b}]");
            assert_eq!(sturm.count_open(&interval), open, "{context} open");
            assert_eq!(
                sturm.count_half_open(&interval),
                half_open,
                "{context} half-open"
            );
            assert_eq!(sturm.count_closed(&interval), closed, "{context} closed");
        }
    }
    // Half-open counts partition: [a, m) + [m, b) = [a, b), a root at m included.
    let count =
        |x: &Q, y: &Q| sturm.count_half_open(&RationalInterval::new(x.clone(), y.clone()).unwrap());
    for w in ends.windows(3) {
        assert_eq!(
            count(&w[0], &w[1]) + count(&w[1], &w[2]),
            count(&w[0], &w[2]),
            "seed {seed}: half-open additivity at {}",
            w[1]
        );
    }

    // Isolation: order, containment and multiplicity against the oracle.
    let isolated = isolate_real_roots(&p, limits).unwrap();
    assert_eq!(isolated.len(), roots.len(), "seed {seed}: isolated roots");
    for (alpha, (root, multiplicity)) in isolated.iter().zip(&roots) {
        let i = alpha.interval();
        assert_ne!(
            root_vs(&case.factors, root, i.lower()),
            Ordering::Less,
            "seed {seed}"
        );
        assert_ne!(
            root_vs(&case.factors, root, i.upper()),
            Ordering::Greater,
            "seed {seed}"
        );
        assert_eq!(
            alpha.multiplicity(),
            *multiplicity,
            "seed {seed}: multiplicity"
        );
        seen.repeated_roots += usize::from(*multiplicity >= 2);
        seen.bracketed_roots += usize::from(root.lo != root.hi);
    }

    // Exact comparison with the partner's roots (one factor shared).
    let partner = Polynomial::new(expand(case, &case.partner, &case.partner_unit)).unwrap();
    let partner_roots = oracle_roots(case, &case.partner, &mut steps);
    let partner_isolated = isolate_real_roots(&partner, limits).unwrap();
    assert_eq!(
        partner_isolated.len(),
        partner_roots.len(),
        "seed {seed}: partner"
    );
    let mut equal = 0;
    for (alpha, (a, _)) in isolated.iter().zip(&roots) {
        for (beta, (b, _)) in partner_isolated.iter().zip(&partner_roots) {
            let expected = oracle_cmp(&case.factors, a, b);
            equal += usize::from(expected == Ordering::Equal);
            if undecided(alpha.interval(), beta.interval()) {
                if expected == Ordering::Equal {
                    seen.overlapping_equal += 1;
                } else {
                    seen.overlapping_distinct += 1;
                }
            }
            assert_eq!(
                alpha.cmp(beta, limits).unwrap(),
                expected,
                "seed {seed}: cmp"
            );
            assert_eq!(
                beta.cmp(alpha, limits).unwrap(),
                expected.reverse(),
                "seed {seed}"
            );
        }
        assert_eq!(
            alpha.cmp(alpha, limits).unwrap(),
            Ordering::Equal,
            "seed {seed}"
        );
    }
    let shared = case.partner[0].0;
    let shared_real = roots.iter().filter(|(r, _)| r.factor == shared).count();
    assert_eq!(
        equal, shared_real,
        "seed {seed}: every shared real root compares equal"
    );
    seen.shared_equal += equal;

    // Deflation at every rational root of a linear factor, and at a non-root.
    for (k, &(i, multiplicity)) in case.p.iter().enumerate() {
        if case.factors[i].len() != 2 {
            continue;
        }
        let deflation = p.deflate(&-case.factors[i][0].clone()).unwrap();
        assert_eq!(
            deflation.multiplicity, multiplicity,
            "seed {seed}: deflation"
        );
        seen.repeated_deflations += usize::from(multiplicity >= 2);
        let rest: Vec<_> = (0..case.p.len())
            .filter(|&j| j != k)
            .map(|j| case.p[j])
            .collect();
        let expected = Polynomial::new(expand(case, &rest, &case.unit)).unwrap();
        assert_eq!(
            deflation.quotient, expected,
            "seed {seed}: deflated quotient"
        );
    }
    let off = loop {
        let x = rng.grid();
        if !eval(&coefficients, &x).is_zero() {
            break x;
        }
    };
    let deflation = p.deflate(&off).unwrap();
    assert_eq!(
        (deflation.multiplicity, &deflation.quotient),
        (0, &p),
        "seed {seed}"
    );

    // Bernstein <-> power at the own degree and elevated by two, by de Casteljau.
    let degree = p.degree().unwrap();
    let points = [q(0, 1), q(1, 1), q(1, 3), q(5, 7), q(-2, 1), q(3, 2)];
    for n in [degree, degree + 2] {
        let b = p.to_bernstein(n).unwrap();
        assert_eq!(b.len(), n + 1);
        for t in &points {
            assert_eq!(
                de_casteljau(&b, t),
                eval(&coefficients, t),
                "seed {seed}: Bernstein"
            );
        }
        assert_eq!(
            Polynomial::from_bernstein(&b).unwrap(),
            p,
            "seed {seed}: round trip"
        );
    }

    // Composition with a random affine or quadratic inner polynomial.
    let mut inner: Vec<Q> = (0..1 + rng.below(2)).map(|_| rng.coefficient()).collect();
    inner.push(rng.unit());
    let inner_polynomial = Polynomial::new(inner.clone()).unwrap();
    let composed = p.compose(&inner_polynomial);
    assert_eq!(
        composed.degree(),
        inner_polynomial.degree().map(|d| d * degree),
        "seed {seed}: composed degree"
    );
    for t in &points {
        assert_eq!(
            composed.evaluate(t).unwrap(),
            eval(&coefficients, &eval(&inner, t)),
            "seed {seed}: composition"
        );
    }
}

fn run(first_seed: u64, count: u64, families: &[&[(char, usize)]]) {
    let mut seen = Coverage::default();
    for seed in first_seed..first_seed + count {
        let case = generate(seed, families);
        check_case(
            seed,
            &case,
            &mut Lcg::new(seed.wrapping_mul(31) + 7),
            &mut seen,
        );
    }
    eprintln!("{count} cases from seed {first_seed}: {seen:?}");
    let floor = count as usize / 10;
    for (what, n) in [
        ("endpoint roots", seen.endpoint_roots),
        ("repeated roots", seen.repeated_roots),
        ("bracketed roots", seen.bracketed_roots),
        ("shared equal roots", seen.shared_equal),
        ("repeated deflations", seen.repeated_deflations),
        ("overlapping equal pairs", seen.overlapping_equal),
        ("overlapping distinct pairs", seen.overlapping_distinct),
    ] {
        assert!(n >= floor, "only {n} {what} in {count} cases");
    }
}

#[test]
fn seeded_cubics_match_the_subdivision_oracle() {
    run(0, 5_000, CUBICS);
}

#[test]
fn seeded_sextics_match_the_subdivision_oracle() {
    run(1_000_000, 5_000, SEXTICS);
}
