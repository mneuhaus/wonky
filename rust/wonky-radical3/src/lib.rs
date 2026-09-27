//! Exact signs for at most three nonnegative square-root generators (degree <= 8).
//!
//! `sum3` is a + b√c + d√e + f√g. `Radical3` also retains products of those
//! same roots, needed by fillet/decide.bend's translation-stripe numerator and
//! positive denominator. Coefficients and radicands are exact dyadic values,
//! not rounded constructions. No independence or square-free assumption is made.
//!
//! A ball filter precedes recursive sign-aware squaring in wonky-num expansions.
//! At each step x = A + B√r: zero or equal signs decide immediately; ONLY for
//! opposite nonzero signs is sign(x) = sign(A) * sign(A²-rB²). This reduces
//! the generator count by one, even when the roots are algebraically dependent.
//! Every expansion operation checks its exactness witness before reading a sign.
//!
//! Budgets are capability limits, not geometric tolerances: 3 generators, 64
//! expansion components, and 131072 scalar product pairs per evaluation. Exceeding
//! them is a named refusal. The committed wonky-num input and product-exactness
//! policies remain in force. No general algebraic numbers, division or trig.
#![deny(unused_must_use)]

use wonky_num::expansion::{self as ex, Exp, Guard};
use wonky_num::{check_range, Decision, Iv, Scalar, Sign, Undecided, UndecidedKind};

pub const MAX_COMPONENTS: usize = 64;
pub const MAX_PRODUCT_PAIRS: usize = 131_072;

fn refused(site: &'static str, kind: UndecidedKind) -> Undecided {
    Undecided::new(site, kind)
}

/// An exact dyadic expression built from admitted binary64 inputs. The private
/// representation prevents callers injecting overlapping/NaN "expansions".
#[derive(Clone, Debug, Default)]
pub struct Dyadic(Exp);

impl Dyadic {
    pub fn new(value: f64) -> Result<Self, Undecided> {
        check_range(&[value], "radical3.input")?;
        Ok(Self(if value == 0.0 { vec![] } else { vec![value] }))
    }

    pub fn add(&self, rhs: &Self) -> Result<Self, Undecided> {
        Eval::default().add(self, rhs)
    }

    pub fn sub(&self, rhs: &Self) -> Result<Self, Undecided> {
        self.add(&rhs.neg())
    }

    pub fn mul(&self, rhs: &Self) -> Result<Self, Undecided> {
        Eval::default().mul(self, rhs)
    }

    pub fn neg(&self) -> Self {
        Self(ex::neg(&self.0))
    }

    pub fn sign(&self) -> Sign {
        sign(ex::sign(&self.0))
    }
}

fn sign(s: i32) -> Sign {
    match s {
        -1 => Sign::Negative,
        0 => Sign::Zero,
        1 => Sign::Positive,
        _ => unreachable!("expansion sign is ternary"),
    }
}

#[derive(Default)]
struct Eval {
    product_pairs: usize,
}

impl Eval {
    fn checked(out: Exp, guard: Guard) -> Result<Dyadic, Undecided> {
        if !guard.exact() || out.iter().any(|x| !x.is_finite()) {
            return Err(refused(
                "radical3.expansion_exactness",
                UndecidedKind::NotExact,
            ));
        }
        if out.len() > MAX_COMPONENTS {
            return Err(refused(
                "radical3.component_budget",
                UndecidedKind::Unresolved,
            ));
        }
        Ok(Dyadic(out))
    }

    fn add(&mut self, a: &Dyadic, b: &Dyadic) -> Result<Dyadic, Undecided> {
        let mut g = Guard::new();
        let out = ex::sum(&a.0, &b.0, &mut g);
        Self::checked(out, g)
    }

    fn mul(&mut self, a: &Dyadic, b: &Dyadic) -> Result<Dyadic, Undecided> {
        self.product_pairs += a.0.len() * b.0.len();
        if self.product_pairs > MAX_PRODUCT_PAIRS {
            return Err(refused(
                "radical3.product_budget",
                UndecidedKind::Unresolved,
            ));
        }
        let mut g = Guard::new();
        let out = ex::mul(&a.0, &b.0, &mut g);
        Self::checked(out, g)
    }

    fn product(
        &mut self,
        a: &[Dyadic],
        b: &[Dyadic],
        roots: &[Dyadic],
    ) -> Result<Vec<Dyadic>, Undecided> {
        let mut out = vec![Dyadic::default(); a.len()];
        for (i, x) in a.iter().enumerate() {
            if x.0.is_empty() {
                continue;
            }
            for (j, y) in b.iter().enumerate() {
                if y.0.is_empty() {
                    continue;
                }
                let mut term = self.mul(x, y)?;
                for (k, r) in roots.iter().enumerate() {
                    if (i & j) & (1 << k) != 0 {
                        term = self.mul(&term, r)?;
                    }
                }
                out[i ^ j] = self.add(&out[i ^ j], &term)?;
            }
        }
        Ok(out)
    }

    fn exact_sign(&mut self, coefficients: &[Dyadic], roots: &[Dyadic]) -> Decision {
        if roots.is_empty() {
            return Ok(coefficients[0].sign());
        }
        let n = coefficients.len() / 2;
        let (a, b) = coefficients.split_at(n);
        let r = roots.last().unwrap();
        let lower = &roots[..roots.len() - 1];
        let sa = self.exact_sign(a, lower)?;
        if r.sign() == Sign::Zero {
            return Ok(sa);
        }
        let sb = self.exact_sign(b, lower)?;
        // Squaring guard: essential, since squaring forgets the signs of A and B.
        if sa == Sign::Zero {
            return Ok(sb);
        }
        if sb == Sign::Zero || sa == sb {
            return Ok(sa);
        }
        let aa = self.product(a, a, lower)?;
        let bb = self.product(b, b, lower)?;
        let mut delta = Vec::with_capacity(n);
        for (x, y) in aa.iter().zip(&bb) {
            let ry = self.mul(r, y)?;
            delta.push(self.add(x, &ry.neg())?);
        }
        let sd = self.exact_sign(&delta, lower)?;
        Ok(if sa == Sign::Positive { sd } else { sd.flip() })
    }
}

/// A sum over the basis 1, √r0, √r1, √(r0 r1), √r2, √(r0 r2),
/// √(r1 r2), √(r0 r1 r2). Basis index bits select roots; principal roots only.
#[derive(Clone, Debug)]
pub struct Radical3 {
    roots: [Dyadic; 3],
    coefficients: [Dyadic; 8],
}

impl Radical3 {
    pub fn new(roots: [Dyadic; 3], coefficients: [Dyadic; 8]) -> Result<Self, Undecided> {
        if roots.iter().any(|r| r.sign() == Sign::Negative) {
            return Err(refused(
                "radical3.negative_radicand",
                UndecidedKind::OutOfRange,
            ));
        }
        Ok(Self {
            roots,
            coefficients,
        })
    }

    pub fn sign(&self) -> Decision {
        if let Some(s) = self.filter() {
            return Ok(s);
        }
        Eval::default().exact_sign(&self.coefficients, &self.roots)
    }

    /// Exact comparison. Different bases are merged only if their union has at
    /// most three distinct nonzero radicands; otherwise a named degree refusal.
    /// Square-class factorization is deliberately not attempted.
    pub fn compare(&self, rhs: &Self) -> Decision {
        let mut eval = Eval::default();
        let mut roots = Vec::<Dyadic>::new();
        let mut coefficients = std::array::from_fn(|_| Dyadic::default());
        for (value, negate) in [(self, false), (rhs, true)] {
            let mut mapping = [None; 3];
            for (i, r) in value.roots.iter().enumerate() {
                let active = value
                    .coefficients
                    .iter()
                    .enumerate()
                    .any(|(mask, c)| mask & (1 << i) != 0 && !c.0.is_empty());
                if !active || r.0.is_empty() {
                    continue;
                }
                let mut found = None;
                for (j, other) in roots.iter().enumerate() {
                    if eval.add(r, &other.neg())?.0.is_empty() {
                        found = Some(j);
                        break;
                    }
                }
                mapping[i] = Some(match found {
                    Some(j) => j,
                    None => {
                        if roots.len() == 3 {
                            return Err(refused(
                                "radical3.degree_budget",
                                UndecidedKind::Unresolved,
                            ));
                        }
                        roots.push(r.clone());
                        roots.len() - 1
                    }
                });
            }
            for (mask, c) in value.coefficients.iter().enumerate() {
                if c.0.is_empty() {
                    continue;
                }
                let mut term = if negate { c.neg() } else { c.clone() };
                let mut target = 0;
                for (i, mapped) in mapping.iter().enumerate() {
                    if mask & (1 << i) == 0 {
                        continue;
                    }
                    let Some(j) = mapped else {
                        term = Dyadic::default();
                        break;
                    };
                    let bit = 1 << j;
                    if target & bit != 0 {
                        term = eval.mul(&term, &roots[*j])?;
                    }
                    target ^= bit;
                }
                coefficients[target] = eval.add(&coefficients[target], &term)?;
            }
        }
        roots.resize(3, Dyadic::default());
        let difference = Self {
            roots: roots.try_into().unwrap(),
            coefficients,
        };
        if let Some(s) = difference.filter() {
            return Ok(s);
        }
        eval.exact_sign(&difference.coefficients, &difference.roots)
    }

    fn filter(&self) -> Option<Sign> {
        let mut roots = [Iv::point(0.0); 3];
        for (i, r) in self.roots.iter().enumerate() {
            let ball = enclosure(r)?;
            // P0's sqrt exactness shortcut tests an FMA residual of m*m.
            // Below the expansion product floor that residual can underflow
            // to zero despite an inexact sqrt. Defer to the guarded exact path,
            // which may return NotExact, rather than certify a rounded root.
            if ball.m != 0.0 && ball.m < ex::PRODUCT_MIN {
                return None;
            }
            // Never let an invalid interval enter sqrt (the old P0 sqrt's max
            // could otherwise turn NaN into a finite lower-bound certificate).
            roots[i] = valid(ball.sqrt())?;
        }
        let mut total = Iv::point(0.0);
        for (mask, c) in self.coefficients.iter().enumerate() {
            let mut term = enclosure(c)?;
            for (i, root) in roots.iter().enumerate() {
                if mask & (1 << i) != 0 {
                    term = valid(term * *root)?;
                }
            }
            total = valid(total + term)?;
        }
        if total.lo() > 0.0 {
            Some(Sign::Positive)
        } else if total.hi() < 0.0 {
            Some(Sign::Negative)
        } else if total.m == 0.0 && total.r == 0.0 {
            Some(Sign::Zero)
        } else {
            None
        }
    }
}

fn valid(value: Iv) -> Option<Iv> {
    (value.m.is_finite()
        && value.r.is_finite()
        && value.r >= 0.0
        && value.lo().is_finite()
        && value.hi().is_finite())
    .then_some(value)
}

fn enclosure(value: &Dyadic) -> Option<Iv> {
    let mut out = Iv::point(0.0);
    for &component in &value.0 {
        out = valid(out + Iv::point(component))?;
    }
    Some(out)
}

/// Construct the requested simple-sum class on the exact admitted f64 words.
pub fn sum3(a: f64, terms: [(f64, f64); 3]) -> Result<Radical3, Undecided> {
    let roots = [
        Dyadic::new(terms[0].1)?,
        Dyadic::new(terms[1].1)?,
        Dyadic::new(terms[2].1)?,
    ];
    let mut coefficients = std::array::from_fn(|_| Dyadic::default());
    coefficients[0] = Dyadic::new(a)?;
    for (i, (coefficient, _)) in terms.iter().enumerate() {
        coefficients[1 << i] = Dyadic::new(*coefficient)?;
    }
    Radical3::new(roots, coefficients)
}
