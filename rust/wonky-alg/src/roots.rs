use crate::{checked_rational, sign, AlgebraError, BigInt, Polynomial, Rational, Sign};
use num_traits::{Signed, Zero};
use std::cmp::Ordering;
use std::sync::Arc;

/// A closed rational interval, possibly a single point. Endpoints are canonical.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RationalInterval {
    lower: Rational,
    upper: Rational,
}

impl RationalInterval {
    pub fn new(lower: Rational, upper: Rational) -> Result<Self, AlgebraError> {
        let lower = checked_rational(&lower)?;
        let upper = checked_rational(&upper)?;
        if lower > upper {
            return Err(AlgebraError::ReversedInterval);
        }
        Ok(Self { lower, upper })
    }

    pub fn lower(&self) -> &Rational {
        &self.lower
    }
    pub fn upper(&self) -> &Rational {
        &self.upper
    }
    pub fn width(&self) -> Rational {
        &self.upper - &self.lower
    }
    pub fn is_point(&self) -> bool {
        self.lower == self.upper
    }

    /// Exact interval product; known signs select extrema without comparing
    /// large, closely spaced rational products.
    pub fn product(&self, rhs: &Self) -> Self {
        let (a,b,c,d)=(&self.lower,&self.upper,&rhs.lower,&rhs.upper);
        let zero=Rational::zero();
        let (lower,upper)=if a >= &zero {
            if c >= &zero {(a*c,b*d)}
            else if d <= &zero {(b*c,a*d)}
            else {(b*c,b*d)}
        } else if b <= &zero {
            if c >= &zero {(a*d,b*c)}
            else if d <= &zero {(b*d,a*c)}
            else {(a*d,a*c)}
        } else if c >= &zero {(a*d,b*d)}
        else if d <= &zero {(b*c,a*c)}
        else {((a*d).min(b*c),(a*c).max(b*d))};
        Self {lower,upper}
    }

    fn midpoint(&self) -> Rational {
        (&self.lower + &self.upper) / Rational::from_integer(2.into())
    }
}

/// Bisection/split budget shared across a whole operation, not reset per root.
/// Exact gcd and evaluation are not bounded by this budget.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_bisections: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_bisections: 16_384,
        }
    }
}

struct Budget {
    used: usize,
    limit: usize,
    operation: &'static str,
}
impl Budget {
    fn new(limits: Limits, operation: &'static str) -> Self {
        Self {
            used: 0,
            limit: limits.max_bisections,
            operation,
        }
    }
    fn step(&mut self) -> Result<(), AlgebraError> {
        if self.used == self.limit {
            return Err(AlgebraError::BudgetExceeded {
                operation: self.operation,
                limit: self.limit,
            });
        }
        self.used += 1;
        Ok(())
    }
}

/// Sturm sequence of the monic square-free part: p, p', -rem(p,p'), ... .
/// Later terms may be scaled only by POSITIVE constants to control coefficient size.
#[derive(Clone, Debug)]
pub struct SturmSequence {
    terms: Vec<Polynomial>,
}
impl SturmSequence {
    pub fn new(polynomial: &Polynomial) -> Result<Self, AlgebraError> {
        let p = polynomial.square_free_part()?;
        let derivative = p.derivative();
        let mut terms = vec![p];
        if !derivative.is_zero() {
            terms.push(derivative);
            loop {
                let n = terms.len();
                let remainder = terms[n - 2].div_rem(&terms[n - 1])?.1.neg();
                if remainder.is_zero() {
                    break;
                }
                let scale = remainder
                    .leading_coefficient()
                    .expect("nonzero remainder")
                    .abs()
                    .recip();
                terms.push(remainder.scaled(&scale));
            }
        }
        Ok(Self { terms })
    }

    pub fn terms(&self) -> &[Polynomial] {
        &self.terms
    }
    pub fn polynomial(&self) -> &Polynomial {
        &self.terms[0]
    }

    /// Zero sequence entries are omitted, never treated as either sign.
    pub fn variations_at(&self, x: &Rational) -> Result<usize, AlgebraError> {
        Ok(self.variations(&checked_rational(x)?))
    }

    fn variations(&self, x: &Rational) -> usize {
        variations(self.terms.iter().map(|p| p.sign_at(x)))
    }

    /// Number of distinct real roots, not the sum of multiplicities.
    pub fn real_root_count(&self) -> usize {
        let at_infinity = |negative: bool| {
            variations(self.terms.iter().map(|p| {
                let lead = sign(p.leading_coefficient().expect("nonzero Sturm term"));
                if negative && p.degree().expect("nonzero Sturm term") % 2 == 1 {
                    lead.flip()
                } else {
                    lead
                }
            }))
        };
        at_infinity(true) - at_infinity(false)
    }

    /// Distinct roots in the OPEN interval (lower, upper). Endpoints may be roots.
    /// For square-free p, V(root) is its right limit, so subtract a root at upper.
    pub fn count_open(&self, interval: &RationalInterval) -> usize {
        if interval.is_point() {
            return 0;
        }
        self.variations(&interval.lower)
            - self.variations(&interval.upper)
            - usize::from(self.is_root(&interval.upper))
    }

    /// Distinct roots in the HALF-OPEN interval [lower, upper): a root at `lower`
    /// counts, a root at `upper` does not, so the counts of [a, b) and [b, c) add up
    /// to the count of [a, c) and a shared endpoint is owned by exactly one side.
    /// A point interval [a, a) is empty.
    pub fn count_half_open(&self, interval: &RationalInterval) -> usize {
        if cfg!(feature = "plant_closed_count") {
            // Planted negative (Cargo feature): the endpoint-root tests must fail.
            return self.count_closed(interval);
        }
        if interval.is_point() {
            0
        } else {
            self.count_open(interval) + usize::from(self.is_root(&interval.lower))
        }
    }

    /// Distinct roots in the CLOSED interval [lower, upper]; [a, a] counts a root at a.
    pub fn count_closed(&self, interval: &RationalInterval) -> usize {
        self.variations(&interval.lower) - self.variations(&interval.upper)
            + usize::from(self.is_root(&interval.lower))
    }

    fn is_root(&self, x: &Rational) -> bool {
        self.polynomial().sign_at(x) == Sign::Zero
    }

    fn root_bound(&self) -> Rational {
        let coefficients = self.polynomial().coefficients();
        let max = coefficients[..coefficients.len() - 1]
            .iter()
            .map(Signed::abs)
            .max()
            .unwrap_or_else(Rational::zero);
        // Monic Cauchy bound |root| <= 1 + max|a_i|. Strictly larger integer
        // endpoints ensure no root of p is an endpoint of the initial interval.
        Rational::from_integer(max.ceil().to_integer() + BigInt::from(2))
    }
}

fn variations(signs: impl Iterator<Item = Sign>) -> usize {
    let mut previous = None;
    let mut count = 0;
    for current in signs {
        if current == Sign::Zero {
            continue;
        }
        if previous.is_some_and(|p| p != current) {
            count += 1;
        }
        previous = Some(current);
    }
    count
}

/// An exact real root: square-free defining polynomial + certified isolating
/// interval. No floating coordinate is stored. Refinement preserves root identity.
#[derive(Clone, Debug)]
pub struct AlgebraicReal {
    sturm: Arc<SturmSequence>,
    interval: RationalInterval,
    multiplicity: usize,
}

impl AlgebraicReal {
    /// Validate a caller-provided certificate against the original polynomial.
    /// Non-point endpoints must not be roots. Exactly rational point roots are valid.
    pub fn from_interval(
        polynomial: &Polynomial,
        interval: RationalInterval,
    ) -> Result<Self, AlgebraError> {
        let sturm = Arc::new(SturmSequence::new(polynomial)?);
        let roots = if interval.is_point() {
            usize::from(sturm.polynomial().sign_at(&interval.lower) == Sign::Zero)
        } else {
            if sturm.polynomial().sign_at(&interval.lower) == Sign::Zero
                || sturm.polynomial().sign_at(&interval.upper) == Sign::Zero
            {
                return Err(AlgebraError::EndpointIsRoot);
            }
            sturm.count_open(&interval)
        };
        if roots != 1 {
            return Err(AlgebraError::NotIsolating { roots });
        }
        let multiplicity = multiplicity_in(&factor_sequences(polynomial)?, &interval);
        Ok(Self {
            sturm,
            interval,
            multiplicity,
        })
    }

    /// Monic square-free defining polynomial (may contain other roots outside the interval).
    pub fn polynomial(&self) -> &Polynomial {
        self.sturm.polynomial()
    }
    pub fn interval(&self) -> &RationalInterval {
        &self.interval
    }
    pub fn multiplicity(&self) -> usize {
        self.multiplicity
    }

    /// Refine to width <= max_width. On error, the original certificate is unchanged.
    pub fn refine(&mut self, max_width: &Rational, limits: Limits) -> Result<(), AlgebraError> {
        let max_width = checked_rational(max_width)?;
        if max_width <= Rational::zero() {
            return Err(AlgebraError::NonPositiveWidth);
        }
        let mut interval = self.interval.clone();
        let mut budget = Budget::new(limits, "refine");
        let mut lower = None;
        while interval.width() > max_width {
            let known = lower.get_or_insert_with(|| self.polynomial().sign_at(&interval.lower));
            bisect_from(self.polynomial(), &mut interval, &mut budget, known)?;
        }
        self.interval = interval;
        Ok(())
    }

    /// Exact sign of q(alpha), including shared irrational roots and even multiplicities.
    /// First test equality with gcd. Otherwise refine until q has no root in the
    /// certified interval and both endpoints are nonzero. Continuity fixes the sign.
    pub fn sign_at(&self, q: &Polynomial, limits: Limits) -> Result<Sign, AlgebraError> {
        let q = q.div_rem(self.polynomial())?.1;
        if q.is_zero() {
            return Ok(Sign::Zero);
        }
        if self.interval.is_point() {
            return Ok(q.sign_at(&self.interval.lower));
        }
        // Exact rational Horner enclosure is a sign filter, never a floating
        // estimate. A range containing zero still reaches the gcd/Sturm proof.
        let range=q.coefficients().iter().rev().fold(
            RationalInterval {lower:Rational::zero(),upper:Rational::zero()},
            |range,c| {let product=range.product(&self.interval);
                RationalInterval {lower:product.lower+c,upper:product.upper+c}}
        );
        if range.lower>Rational::zero(){return Ok(Sign::Positive);}
        if range.upper<Rational::zero(){return Ok(Sign::Negative);}
        let common = self.polynomial().gcd(&q);
        if common.degree().is_some_and(|d| d > 0)
            && SturmSequence::new(&common)?.count_open(&self.interval) == 1
        {
            return Ok(Sign::Zero);
        }
        let q_sturm = SturmSequence::new(&q)?;
        let mut interval = self.interval.clone();
        let mut budget = Budget::new(limits, "sign_at");
        loop {
            let lower = q.sign_at(&interval.lower);
            if interval.is_point() {
                return Ok(lower);
            }
            if lower != Sign::Zero
                && q.sign_at(&interval.upper) != Sign::Zero
                && q_sturm.count_open(&interval) == 0
            {
                return Ok(lower);
            }
            bisect(self.polynomial(), &mut interval, &mut budget)?;
        }
    }

    /// Exact order of two algebraic reals, with no separation-bound guess. A root lies
    /// strictly inside a non-point certificate, so certificates whose interiors are
    /// disjoint decide at once. Otherwise the two are equal iff the gcd of their
    /// defining polynomials has a root in the intersection (each certificate isolates
    /// one root of its own polynomial); if not, the wider certificate is bisected
    /// until the two separate. Bisections are charged to `limits`
    /// (`BudgetExceeded { operation: "cmp" }`); neither value is modified.
    pub fn cmp(&self, other: &Self, limits: Limits) -> Result<Ordering, AlgebraError> {
        let (mut a, mut b) = (self.interval.clone(), other.interval.clone());
        if let Some(order) = certified_order(&a, &b) {
            return Ok(order);
        }
        let common = self.polynomial().gcd(other.polynomial());
        if common.degree().is_some_and(|d| d > 0) {
            let overlap = RationalInterval {
                lower: std::cmp::max(&a.lower, &b.lower).clone(),
                upper: std::cmp::min(&a.upper, &b.upper).clone(),
            };
            if SturmSequence::new(&common)?.count_closed(&overlap) > 0 {
                return Ok(Ordering::Equal);
            }
        }
        let mut budget = Budget::new(limits, "cmp");
        loop {
            if b.is_point() || (!a.is_point() && a.width() >= b.width()) {
                bisect(self.polynomial(), &mut a, &mut budget)?;
            } else {
                bisect(other.polynomial(), &mut b, &mut budget)?;
            }
            if let Some(order) = certified_order(&a, &b) {
                return Ok(order);
            }
        }
    }
}

/// Order of two roots from their certificates alone, if the certificates decide it.
/// A non-point certificate never has its root on an endpoint, so touching at one
/// endpoint already separates unless both are the same point.
fn certified_order(a: &RationalInterval, b: &RationalInterval) -> Option<Ordering> {
    if a.is_point() && b.is_point() {
        return Some(a.lower.cmp(&b.lower));
    }
    if a.upper <= b.lower {
        Some(Ordering::Less)
    } else if b.upper <= a.lower {
        Some(Ordering::Greater)
    } else {
        None
    }
}

fn factor_sequences(polynomial: &Polynomial) -> Result<Vec<(SturmSequence, usize)>, AlgebraError> {
    polynomial
        .square_free_decomposition()?
        .factors
        .into_iter()
        .map(|f| Ok((SturmSequence::new(&f.polynomial)?, f.multiplicity)))
        .collect()
}

fn multiplicity_in(factors: &[(SturmSequence, usize)], interval: &RationalInterval) -> usize {
    factors
        .iter()
        .find(|(sturm, _)| {
            if interval.is_point() {
                sturm.polynomial().sign_at(&interval.lower) == Sign::Zero
            } else {
                sturm.count_open(interval) == 1
            }
        })
        .expect("exactly one square-free factor owns an isolated root")
        .1
}

/// Isolate ALL distinct real roots in increasing order, with original multiplicities.
/// Each non-point interval has opposite exact signs of the square-free part at its
/// endpoints. All closed output intervals are strictly disjoint. Constant nonzero
/// polynomials yield an empty list; the zero polynomial is refused (infinitely many roots).
/// The shared budget includes separation into strictly disjoint closed intervals.
pub fn isolate_real_roots(
    polynomial: &Polynomial,
    limits: Limits,
) -> Result<Vec<AlgebraicReal>, AlgebraError> {
    let sturm = Arc::new(SturmSequence::new(polynomial)?);
    let total = sturm.real_root_count();
    if total == 0 {
        return Ok(Vec::new());
    }
    let factors = factor_sequences(polynomial)?;
    let bound = sturm.root_bound();
    let initial = RationalInterval {
        lower: -&bound,
        upper: bound,
    };
    let mut pending = vec![(initial, total)];
    let mut roots = Vec::with_capacity(total);
    let mut budget = Budget::new(limits, "isolate_real_roots");
    while let Some((mut interval, count)) = pending.pop() {
        if count == 0 {
            continue;
        }
        if count == 1 {
            // Shrink BOTH original boundaries to obtain strictly disjoint CLOSED
            // intervals even when adjacent subdivision cells shared an endpoint.
            let original = interval.clone();
            while interval.lower <= original.lower || interval.upper >= original.upper {
                bisect(sturm.polynomial(), &mut interval, &mut budget)?;
            }
            let multiplicity = multiplicity_in(&factors, &interval);
            roots.push(AlgebraicReal {
                sturm: Arc::clone(&sturm),
                interval,
                multiplicity,
            });
            continue;
        }
        // Never split exactly on a root. Distinct rational trial points must yield
        // a non-root within degree+1 attempts; charge every attempt to the budget.
        let mut denominator = BigInt::from(2);
        let split = loop {
            budget.step()?;
            let trial =
                &interval.lower + interval.width() / Rational::from_integer(denominator.clone());
            if sturm.polynomial().sign_at(&trial) != Sign::Zero {
                break trial;
            }
            denominator += 1;
        };
        let left = RationalInterval {
            lower: interval.lower,
            upper: split.clone(),
        };
        let right = RationalInterval {
            lower: split,
            upper: interval.upper,
        };
        let left_count = sturm.count_open(&left);
        // LIFO stack: right first, so output is ordered without approximate sorting.
        pending.push((right, count - left_count));
        pending.push((left, left_count));
    }
    Ok(roots)
}

fn bisect(
    p: &Polynomial,
    interval: &mut RationalInterval,
    budget: &mut Budget,
) -> Result<(), AlgebraError> {
    let mut lower = p.sign_at(&interval.lower);
    bisect_from(p, interval, budget, &mut lower)
}

/// One bisection step given the sign of `p` at the lower end, which it keeps
/// current (a refinement loop then evaluates only the midpoints).
fn bisect_from(
    p: &Polynomial,
    interval: &mut RationalInterval,
    budget: &mut Budget,
    lower: &mut Sign,
) -> Result<(), AlgebraError> {
    budget.step()?;
    let midpoint = interval.midpoint();
    let at_midpoint = p.sign_at(&midpoint);
    if at_midpoint == Sign::Zero {
        interval.lower = midpoint.clone();
        interval.upper = midpoint;
        *lower = Sign::Zero;
    } else if at_midpoint == *lower {
        interval.lower = midpoint;
    } else {
        interval.upper = midpoint;
    }
    Ok(())
}
