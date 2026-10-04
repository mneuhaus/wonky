//! Exact construction classes next to an authoritative binary64 angle word.
//! The real cyclotomic generator avoids the false half-angle degree formula.
//! No observation coordinate or trigonometric floating estimate decides a sign.
use crate::{binary64, Refused, Result, Q};
use num_traits::{One, Signed, ToPrimitive, Zero};
use wonky_alg::{AlgebraicReal, BigInt, Limits, Polynomial as P, RationalInterval, Sign};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum AngleWitness {
    Turns(Q),
    Tan(Q),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnClass {
    Rational,
    Quadratic,
    Radical,
    Algebraic,
    Transcendental,
}
#[derive(Clone, Debug)]
struct Field {
    root: AlgebraicReal,
    cos: P,
    sin: P,
}
#[derive(Clone, Debug)]
pub struct Turn {
    word: f64,
    witness: Option<AngleWitness>,
    class: TurnClass,
    field: Option<Field>,
    coordinate_root: std::sync::Arc<std::sync::OnceLock<Result<std::sync::Arc<AlgebraicReal>>>>,
}
impl PartialEq for Turn {
    fn eq(&self, b: &Self) -> bool {
        self.word.to_bits() == b.word.to_bits()
            && self.witness == b.witness
            && self.class == b.class
            && match (&self.field, &b.field) {
                (None, None) => true,
                (Some(f), Some(g)) => {
                    f.cos == g.cos
                        && f.sin == g.sin
                        && f.root.polynomial() == g.root.polynomial()
                        && f.root.interval() == g.root.interval()
                }
                _ => false,
            }
    }
}
impl Eq for Turn {}
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn err<T>(r: std::result::Result<T, wonky_alg::AlgebraError>) -> Result<T> {
    r.map_err(|_| Refused("turn/algebra-budget"))
}
fn p(v: Q) -> P {
    P::new(vec![v]).expect("canonical rational")
}
fn rem(v: P, modulus: &P) -> Result<P> {
    Ok(err(v.div_rem(modulus))?.1)
}
fn cosine_polys(n: usize, modulus: &P) -> Result<Vec<P>> {
    let x = P::from_integers(&[0, 1]);
    let mut cs = vec![p(q(2)), x.clone()];
    for k in 2..=n {
        cs.push(rem(x.mul(&cs[k - 1]).sub(&cs[k - 2]), modulus)?);
    }
    Ok(cs)
}
fn phi(mut n: u64) -> u64 {
    let mut result = n;
    let mut d = 2;
    while d <= n / d {
        if n % d == 0 {
            result = result / d * (d - 1);
            while n % d == 0 {
                n /= d;
            }
        }
        d += 1;
    }
    if n > 1 {
        result = result / n * (n - 1);
    }
    result
}
fn cyclotomic(n: usize, cache: &mut std::collections::BTreeMap<usize, P>) -> Result<P> {
    if let Some(p) = cache.get(&n) {
        return Ok(p.clone());
    }
    let mut coefficients = vec![Q::zero(); n + 1];
    coefficients[0] = -Q::one();
    coefficients[n] = Q::one();
    let mut f = err(P::new(coefficients))?;
    for d in 1..n {
        if n % d == 0 {
            f = err(f.exact_div(&cyclotomic(d, cache)?))?;
        }
    }
    cache.insert(n, f.clone());
    Ok(f)
}
/// Minimal polynomial of 2 cos(2 pi / n), for n >= 3.
/// Phi_n(z) = z^(phi(n)/2) Psi_n(z + 1/z), triangular exact conversion.
pub fn real_cyclotomic(n: usize) -> Result<P> {
    if n < 3 || n > 2048 {
        return Err(Refused("turn/degree-budget"));
    }
    let f = cyclotomic(n, &mut Default::default())?;
    let d = f.degree().unwrap() / 2;
    let mut cs = vec![p(q(2)), P::from_integers(&[0, 1])];
    for k in 2..=d {
        cs.push(cs[1].mul(&cs[k - 1]).sub(&cs[k - 2]));
    }
    let mut result = p(f.coefficients()[d].clone());
    for (j, c) in cs.iter().enumerate().take(d + 1).skip(1) {
        result = result.add(&err(c.scale(&f.coefficients()[d + j]))?);
    }
    Ok(result.monic())
}
/// Rational Taylor enclosure; alternating tail is decreasing before termination.
/// This is proof arithmetic, not a polygonal or binary64 trigonometric approximation.
fn trig(x: &Q, cosine: bool, bits: usize) -> Result<(Q, Q)> {
    if x.abs() > q(8) || bits > 512 {
        return Err(Refused("turn/enclosure-budget"));
    }
    let eps = Q::new(BigInt::one(), BigInt::one() << bits);
    let xx = x * x;
    let mut term = if cosine { Q::one() } else { x.clone() };
    let mut sum = term.clone();
    for i in 1..1024 {
        let a = if cosine { 2 * i - 1 } else { 2 * i };
        let next = -&term * &xx / q((a * (a + 1)) as i64);
        if i > 8 && next.abs() < eps {
            return Ok((&sum - next.abs(), sum + next.abs()));
        }
        sum += &next;
        term = next;
    }
    Err(Refused("turn/enclosure-budget"))
}
fn atan_small(x: Q, bits: usize) -> (Q, Q) {
    let eps = Q::new(BigInt::one(), BigInt::one() << bits);
    let xx = &x * &x;
    let mut power = x.clone();
    let mut sum = x;
    for i in 1..2048 {
        power = -power * &xx;
        let term = &power / q(2 * i + 1);
        if term.abs() < eps {
            return (&sum - term.abs(), sum + term.abs());
        }
        sum += term;
    }
    unreachable!("Machin arguments <= 1/5, bits <= 512")
}
fn pi(bits: usize) -> (Q, Q) {
    let a = atan_small(Q::one() / q(5), bits + 8);
    let b = atan_small(Q::one() / q(239), bits + 8);
    (q(16) * a.0 - q(4) * b.1, q(16) * a.1 - q(4) * b.0)
}
fn generator(modulus: &P, n: u64) -> Result<AlgebraicReal> {
    let (lo, hi) = pi(80);
    let a = q(2) * lo / q(n as i64);
    let b = q(2) * hi / q(n as i64);
    let mid = (&a + &b) / q(2);
    let (lo, hi) = trig(&mid, true, 80)?;
    let radius = (&b - &a) / q(2);
    // Taylor/Machin bounds have large non-dyadic denominators. Keep their
    // proof, but round the *enclosure endpoints* outward to dyadics before
    // Sturm evaluation. This never rounds the root or changes its polynomial.
    let scale = Q::from_integer(BigInt::one() << 80);
    let lower = (q(2) * (lo - &radius) * &scale).floor() / &scale;
    let upper = (q(2) * (hi + radius) * &scale).ceil() / &scale;
    let interval = err(RationalInterval::new(lower, upper))?;
    err(AlgebraicReal::from_interval(modulus, interval))
}
impl Turn {
    /// Rational circle construction, independent of an interpreter angle word.
    /// Sketch arcs provide this pair by exact dot/cross products divided by r².
    pub fn from_sin_cos(sin: Q, cos: Q) -> Result<Self> {
        if sin.denom() <= &BigInt::from(0) || cos.denom() <= &BigInt::from(0) {
            return Err(Refused("turn/invalid-circle-witness"));
        }
        if &sin * &sin + &cos * &cos != Q::one() {
            return Err(Refused("turn/invalid-circle-witness"));
        }
        let poly = P::from_integers(&[0, 1]);
        let root = err(AlgebraicReal::from_interval(
            &poly,
            err(RationalInterval::new(q(0), q(0)))?,
        ))?;
        // The word is an observation here: exact geometry is the supplied circle pair.
        let word = sin
            .to_f64()
            .ok_or(Refused("turn/observation-range"))?
            .atan2(cos.to_f64().ok_or(Refused("turn/observation-range"))?);
        Ok(Self {
            word,
            witness: None,
            class: TurnClass::Rational,
            field: Some(Field {
                root,
                cos: p(cos),
                sin: p(sin),
            }),
            coordinate_root: Default::default(),
        })
    }
    pub fn verify_witness(word: f64, witness: Option<&AngleWitness>) -> Result<()> {
        Self::verify_witness_with_atan(word, witness, |x| Ok(crate::angle_word::atan(x)))
    }
    /// Reconstruct the binary64 word with the interpreter's atan implementation.
    /// This callback supplies construction arithmetic only; exact tangent
    /// geometry still comes from the rational witness, never this observation.
    pub fn verify_witness_with_atan(
        word: f64,
        witness: Option<&AngleWitness>,
        atan: impl FnOnce(f64) -> Result<f64>,
    ) -> Result<()> {
        binary64(word)?;
        if let Some(w) = witness {
            let rational = match w {
                AngleWitness::Turns(t) | AngleWitness::Tan(t) => t,
            };
            if rational.denom() <= &BigInt::from(0) {
                return Err(Refused("angle/witness-mismatch"));
            }
            let expected = match w {
                AngleWitness::Turns(t) => {
                    let degrees = crate::angle_word::nearest(&(t * q(360)))?;
                    crate::angle_word::nearest(
                        &(binary64(degrees)? * binary64(std::f64::consts::PI / 180.)?),
                    )?
                }
                AngleWitness::Tan(t) => atan(crate::angle_word::nearest(t)?)?,
            };
            if expected.to_bits() != word.to_bits() {
                return Err(Refused("angle/witness-mismatch"));
            }
        }
        Ok(())
    }
    pub fn new(word: f64, witness: Option<AngleWitness>) -> Result<Self> {
        Self::new_with_atan(word, witness, |x| Ok(crate::angle_word::atan(x)))
    }
    /// Host construction counterpart of `new`; retains the supplied word.
    pub fn new_with_atan(
        word: f64,
        witness: Option<AngleWitness>,
        atan: impl FnOnce(f64) -> Result<f64>,
    ) -> Result<Self> {
        Self::verify_witness_with_atan(word, witness.as_ref(), atan)?;
        let mut result = Self {
            word,
            witness,
            class: TurnClass::Transcendental,
            field: None,
            coordinate_root: Default::default(),
        };
        match &result.witness {
            None => {}
            Some(AngleWitness::Tan(t)) => {
                let c2 = Q::one() / (Q::one() + t * t);
                let rational_cos = wonky_curve::numeric::exact_root(&c2);
                let polynomial = if let Some(c) = &rational_cos {
                    err(P::new(vec![-c.clone(), Q::one()]))?
                } else {
                    err(P::new(vec![-c2, Q::zero(), Q::one()]))?
                };
                let root = err(AlgebraicReal::from_interval(
                    &polynomial,
                    err(RationalInterval::new(Q::zero(), q(2)))?,
                ))?;
                let c = P::from_integers(&[0, 1]);
                result.class = if wonky_curve::numeric::exact_root(&(Q::one() / (Q::one() + t * t)))
                    .is_some()
                {
                    TurnClass::Rational
                } else {
                    TurnClass::Quadratic
                };
                result.field = Some(Field {
                    root,
                    cos: c.clone(),
                    sin: err(c.scale(t))?,
                });
            }
            Some(AngleWitness::Turns(t)) => {
                let n = t.denom().to_u64().ok_or(Refused("turn/degree-budget"))?;
                if n <= 4 && 4 % n == 0 {
                    let k = ((t * q(4)).to_integer() % BigInt::from(4) + BigInt::from(4))
                        % BigInt::from(4);
                    let k = k.to_usize().unwrap();
                    let poly = P::from_integers(&[0, 1]);
                    result.class = TurnClass::Rational;
                    result.field = Some(Field {
                        root: err(AlgebraicReal::from_interval(
                            &poly,
                            err(RationalInterval::new(q(0), q(0)))?,
                        ))?,
                        cos: p(q([1, 0, -1, 0][k])),
                        sin: p(q([0, 1, 0, -1][k])),
                    });
                } else {
                    // Sin and cos share the maximal real field of conductor lcm(n,4).
                    let m = n
                        .checked_mul(if n % 4 == 0 {
                            1
                        } else if n % 2 == 0 {
                            2
                        } else {
                            4
                        })
                        .ok_or(Refused("turn/degree-budget"))?;
                    if m > 2048 {
                        return Err(Refused("turn/degree-budget"));
                    }
                    let degree = phi(m) / 2;
                    if degree > 48 || m > 2048 {
                        return Err(Refused("turn/degree-budget"));
                    }
                    let polynomial = real_cyclotomic(m as usize)?;
                    let root = generator(&polynomial, m)?;
                    let k = ((t.numer() * BigInt::from(m / n)) % BigInt::from(m) + BigInt::from(m))
                        % BigInt::from(m);
                    let k = k.to_usize().unwrap();
                    let m = m as usize;
                    let cs = cosine_polys(m / 2, &polynomial)?;
                    let index = |i: usize| if i > m / 2 { m - i } else { i };
                    let cos = err(cs[index(k)].scale(&(Q::one() / q(2))))?;
                    let sin = err(cs[index((m + m / 4 - k) % m)].scale(&(Q::one() / q(2))))?;
                    result.class = if degree <= 2 {
                        TurnClass::Quadratic
                    } else if m == 24 {
                        TurnClass::Radical
                    } else {
                        TurnClass::Algebraic
                    };
                    result.field = Some(Field { root, cos, sin });
                }
            }
        }
        Ok(result)
    }
    /// Exact coordinates in the existing single-quadratic vertex field.
    /// Wider symbolic fields remain named capability gaps for this consumer.
    pub fn quadratic_sin_cos(&self) -> Result<(wonky_curve::radical::Radical, wonky_curve::radical::Radical)> {
        use wonky_curve::radical::Radical;
        let f = self.field.as_ref().ok_or(Refused("turn/coordinate-field-unavailable"))?;
        let cs = f.root.polynomial().coefficients();
        let root = match f.root.polynomial().degree() {
            Some(1) => Radical::from(-&cs[0] / &cs[1]),
            Some(2) => {
                let center = -&cs[1] / (q(2) * &cs[2]);
                let discriminant = &cs[1]*&cs[1] - q(4)*&cs[2]*&cs[0];
                // Select the isolated root by an exact sign, never its cache.
                let side = err(f.root.sign_at(&P::new(vec![-center.clone(),Q::one()]).map_err(|_|Refused("turn/algebra-budget"))?, Limits::default()))?;
                let sign = match side {Sign::Negative => -Q::one(),Sign::Positive => Q::one(),Sign::Zero => Q::zero()};
                Radical::quadratic(center, sign / (q(2)*cs[2].abs()), discriminant)
                    .map_err(|_|Refused("turn/coordinate-field-budget"))?
            }
            _ => return Err(Refused("turn/coordinate-field-unavailable")),
        };
        let eval = |p: &P| p.coefficients().iter().rev().fold(Radical::default(),|v,c|v*&root+Radical::from(c.clone()));
        Ok((eval(&f.sin),eval(&f.cos)))
    }
    pub fn class(&self) -> TurnClass {
        self.class
    }
    pub fn word(&self) -> f64 {
        self.word
    }
    pub fn construction_key(&self) -> (u64, Option<AngleWitness>) {
        (self.word.to_bits(), self.witness.clone())
    }
    pub fn degree(&self) -> Option<usize> {
        self.field
            .as_ref()
            .and_then(|f| f.root.polynomial().degree())
    }
    fn radical_sin_cos(
        &self,
    ) -> Result<Option<(wonky_curve::radical::Radical, wonky_curve::radical::Radical)>> {
        use wonky_curve::radical::{guard, Radical};
        if !matches!(
            self.class,
            TurnClass::Rational | TurnClass::Quadratic | TurnClass::Radical
        ) {
            return Ok(None);
        }
        let f = self.field.as_ref().expect("algebraic construction class");
        guard(|| -> Result<_> {
            let sqrt = |x: Q| {
                Radical::quadratic(Q::zero(), Q::one(), x)
                    .map_err(|_| Refused("turn/radical-budget"))
            };
            let root = match &self.witness {
                Some(AngleWitness::Tan(t)) => sqrt(Q::one() / (Q::one() + t * t))?,
                Some(AngleWitness::Turns(t)) if self.class != TurnClass::Rational => {
                    let n = t.denom().to_u64().expect("admitted conductor");
                    let m = n * if n % 4 == 0 {
                        1
                    } else if n % 2 == 0 {
                        2
                    } else {
                        4
                    };
                    // Exact embeddings of the real cyclotomic generators in radical3.
                    match m {
                        8 => sqrt(q(2))?,
                        12 => sqrt(q(3))?,
                        24 => (sqrt(q(2))? + sqrt(q(6))?) * Radical::from(Q::one() / q(2)),
                        _ => return Err(Refused("turn/radical-field")),
                    }
                }
                _ => Radical::from(Q::zero()),
            };
            let eval = |p: &P| {
                p.coefficients()
                    .iter()
                    .rev()
                    .fold(Radical::from(Q::zero()), |v, c| {
                        v * &root + Radical::from(c.clone())
                    })
            };
            Ok(Some((eval(&f.sin), eval(&f.cos))))
        })
        .map_err(|_| Refused("turn/radical-budget"))?
    }
    /// General linear trigonometric predicate a cos(theta)+b sin(theta)+c.
    pub fn sign(&self, a: &Q, b: &Q, c: &Q) -> Result<Sign> {
        if a.is_zero() && b.is_zero() {
            return Ok(if c.is_zero() {
                Sign::Zero
            } else if c.is_positive() {
                Sign::Positive
            } else {
                Sign::Negative
            });
        }
        if let Some((sin, cos)) = self.radical_sin_cos()? {
            let order = wonky_curve::radical::guard(|| {
                (cos * a + sin * b + wonky_curve::radical::Radical::from(c.clone())).sign()
            })
            .map_err(|_| Refused("turn/radical-budget"))?;
            return Ok(match order {
                std::cmp::Ordering::Less => Sign::Negative,
                std::cmp::Ordering::Equal => Sign::Zero,
                std::cmp::Ordering::Greater => Sign::Positive,
            });
        }
        if let Some(f) = &self.field {
            let expr = err(f.cos.scale(a))?
                .add(&err(f.sin.scale(b))?)
                .add(&p(c.clone()));
            return err(f.root.sign_at(&expr, Limits::default()));
        }
        for bits in [64, 128, 256, 512] {
            let co = trig(&binary64(self.word)?, true, bits)?;
            let si = trig(&binary64(self.word)?, false, bits)?;
            let scale = |v: (Q, Q), k: &Q| {
                if k.is_negative() {
                    (v.1 * k, v.0 * k)
                } else {
                    (v.0 * k, v.1 * k)
                }
            };
            let co = scale(co, a);
            let si = scale(si, b);
            let lo = co.0 + si.0 + c;
            let hi = co.1 + si.1 + c;
            if lo.is_zero() && hi.is_zero() {
                return Ok(Sign::Zero);
            }
            if lo > Q::zero() {
                return Ok(Sign::Positive);
            }
            if hi < Q::zero() {
                return Ok(Sign::Negative);
            }
        }
        Err(Refused("turn/transcendental-coincidence-undecided"))
    }
    /// Rational enclosure of a linear coordinate; endpoints are proof values.
    pub fn enclosure(&self, a: &Q, b: &Q, c: &Q, bits: usize) -> Result<(Q, Q)> {
        if bits > 512 {
            return Err(Refused("turn/enclosure-budget"));
        }
        let scale = |v: (Q, Q), k: &Q| {
            if k.is_negative() {
                (v.1 * k, v.0 * k)
            } else {
                (v.0 * k, v.1 * k)
            }
        };
        let (co, si) = if let Some(f) = &self.field {
            let mut root = f.root.clone();
            err(root.refine(
                &Q::new(BigInt::one(), BigInt::one() << bits),
                Limits::default(),
            ))?;
            let eval = |p: &P| {
                let lo = root.interval().lower();
                let hi = root.interval().upper();
                let mut v = (Q::zero(), Q::zero());
                for coefficient in p.coefficients().iter().rev() {
                    let products = [&v.0 * lo, &v.0 * hi, &v.1 * lo, &v.1 * hi];
                    v = (
                        products.iter().min().unwrap() + coefficient,
                        products.iter().max().unwrap() + coefficient,
                    )
                }
                v
            };
            (eval(&f.cos), eval(&f.sin))
        } else {
            (
                trig(&binary64(self.word)?, true, bits)?,
                trig(&binary64(self.word)?, false, bits)?,
            )
        };
        let co = scale(co, a);
        let si = scale(si, b);
        Ok((co.0 + si.0 + c, co.1 + si.1 + c))
    }
    /// Compare linear coordinates in compatible construction fields.
    pub fn coordinate_difference_sign(&self, a: &[Q; 3], other: &Self, b: &[Q; 3]) -> Result<Sign> {
        self.compatible(other)?;
        if let (Some((s, c)), Some((t, d))) = (self.radical_sin_cos()?, other.radical_sin_cos()?) {
            let order = wonky_curve::radical::guard(|| {
                (c * &a[0] + s * &a[1] + wonky_curve::radical::Radical::from(a[2].clone())
                    - d * &b[0]
                    - t * &b[1]
                    - wonky_curve::radical::Radical::from(b[2].clone()))
                .sign()
            })
            .map_err(|_| Refused("turn/radical-budget"))?;
            return Ok(match order {
                std::cmp::Ordering::Less => Sign::Negative,
                std::cmp::Ordering::Equal => Sign::Zero,
                std::cmp::Ordering::Greater => Sign::Positive,
            });
        }
        if self == other {
            return self.sign(&(&a[0] - &b[0]), &(&a[1] - &b[1]), &(&a[2] - &b[2]));
        }
        if self.class == TurnClass::Rational {
            let (si, co) = self.rational_sin_cos()?;
            return other.sign(
                &(-&b[0]),
                &(-&b[1]),
                &(&a[0] * co + &a[1] * si + &a[2] - &b[2]),
            );
        }
        if other.class == TurnClass::Rational {
            let (si, co) = other.rational_sin_cos()?;
            return self.sign(&a[0], &a[1], &(&a[2] - &b[0] * co - &b[1] * si - &b[2]));
        }
        if let (Some(f), Some(g)) = (&self.field, &other.field) {
            if f.root.polynomial() == g.root.polynomial()
                && err(f.root.cmp(&g.root, Limits::default()))? == std::cmp::Ordering::Equal
            {
                let x = err(f.cos.scale(&a[0]))?
                    .add(&err(f.sin.scale(&a[1]))?)
                    .add(&p(a[2].clone()));
                let y = err(g.cos.scale(&b[0]))?
                    .add(&err(g.sin.scale(&b[1]))?)
                    .add(&p(b[2].clone()));
                return err(f.root.sign_at(&x.sub(&y), Limits::default()));
            }
        }
        for bits in [64, 128, 256, 512] {
            let x = self.enclosure(&a[0], &a[1], &a[2], bits)?;
            let y = other.enclosure(&b[0], &b[1], &b[2], bits)?;
            if x.0 > y.1 {
                return Ok(Sign::Positive);
            }
            if x.1 < y.0 {
                return Ok(Sign::Negative);
            }
        }
        Err(Refused("turn/coordinate-coincidence-undecided"))
    }
    /// General quadratic predicate in cos and sin, for transformed analytic carriers.
    /// Coefficients are 1, cos, sin, cos², cos sin, sin².
    pub fn quadratic_sign(&self, coefficients: &[Q; 6]) -> Result<Sign> {
        // Quotient by cos²+sin²=1 before enclosure arithmetic. Construction
        // identities are exact even when the angle itself is transcendental.
        let mut normal = (*coefficients).clone();
        normal[0] += &coefficients[5];
        normal[3] -= &coefficients[5];
        normal[5] = Q::zero();
        if normal[1..].iter().all(Q::is_zero) {
            return Ok(if normal[0].is_zero() {
                Sign::Zero
            } else if normal[0].is_positive() {
                Sign::Positive
            } else {
                Sign::Negative
            });
        }
        let coefficients = &normal;
        if let Some((sin, cos)) = self.radical_sin_cos()? {
            use wonky_curve::radical::{guard, Radical};
            let order = guard(|| {
                let terms = [
                    Radical::from(Q::one()),
                    cos.clone(),
                    sin.clone(),
                    &cos * &cos,
                    &cos * &sin,
                    &sin * &sin,
                ];
                terms
                    .iter()
                    .zip(coefficients)
                    .fold(Radical::from(Q::zero()), |v, (term, c)| v + term * c)
                    .sign()
            })
            .map_err(|_| Refused("turn/radical-budget"))?;
            return Ok(match order {
                std::cmp::Ordering::Less => Sign::Negative,
                std::cmp::Ordering::Equal => Sign::Zero,
                std::cmp::Ordering::Greater => Sign::Positive,
            });
        }
        if let Some(f) = &self.field {
            let terms = [
                P::one(),
                f.cos.clone(),
                f.sin.clone(),
                f.cos.mul(&f.cos),
                f.cos.mul(&f.sin),
                f.sin.mul(&f.sin),
            ];
            let mut value = P::zero();
            for (term, c) in terms.iter().zip(coefficients) {
                value = value.add(&err(term.scale(c))?)
            }
            return err(f.root.sign_at(&value, Limits::default()));
        }
        let mul = |a: &(Q, Q), b: &(Q, Q)| {
            let v = [&a.0 * &b.0, &a.0 * &b.1, &a.1 * &b.0, &a.1 * &b.1];
            (
                v.iter().min().unwrap().clone(),
                v.iter().max().unwrap().clone(),
            )
        };
        for bits in [64, 128, 256, 512] {
            let co = trig(&binary64(self.word)?, true, bits)?;
            let si = trig(&binary64(self.word)?, false, bits)?;
            let terms = [
                (Q::one(), Q::one()),
                co.clone(),
                si.clone(),
                mul(&co, &co),
                mul(&co, &si),
                mul(&si, &si),
            ];
            let (mut lo, mut hi) = (Q::zero(), Q::zero());
            for (v, c) in terms.iter().zip(coefficients) {
                if c.is_negative() {
                    lo += &v.1 * c;
                    hi += &v.0 * c
                } else {
                    lo += &v.0 * c;
                    hi += &v.1 * c
                }
            }
            if lo.is_zero() && hi.is_zero() {
                return Ok(Sign::Zero);
            }
            if lo > Q::zero() {
                return Ok(Sign::Positive);
            }
            if hi < Q::zero() {
                return Ok(Sign::Negative);
            }
        }
        Err(Refused("turn/transcendental-coincidence-undecided"))
    }
    /// Predicate on arbitrary polynomial expressions in the exact generator.
    pub fn polynomial_sign(&self, expression: &P) -> Result<Sign> {
        let f = self
            .field
            .as_ref()
            .ok_or(Refused("turn/transcendental-coincidence-undecided"))?;
        err(f.root.sign_at(expression, Limits::default()))
    }
    /// Actual minimal polynomial of tan(theta/2), found by exact linear dependence.
    pub fn tangent_minimal_polynomial(&self) -> Result<P> {
        let f = self
            .field
            .as_ref()
            .ok_or(Refused("turn/transcendental-coincidence-undecided"))?;
        let modulus = f.root.polynomial();
        let mut r0 = modulus.clone();
        let mut r1 = f.cos.add(&P::one());
        let mut s0 = P::zero();
        let mut s1 = P::one();
        while !r1.is_zero() {
            let (quotient, r) = err(r0.div_rem(&r1))?;
            let s = s0.sub(&quotient.mul(&s1));
            r0 = r1;
            r1 = r;
            s0 = s1;
            s1 = s;
        }
        if r0.degree() != Some(0) {
            return Err(Refused("turn/tangent-pole"));
        }
        let inv = err(s0.scale(&(Q::one() / r0.coefficients()[0].clone())))?;
        let t = rem(f.sin.mul(&inv), modulus)?;
        let d = modulus.degree().unwrap();
        let mut basis: Vec<(usize, Vec<Q>, Vec<Q>)> = vec![];
        let mut power = P::one();
        for k in 0..=d {
            let mut v = vec![Q::zero(); d];
            for (i, c) in power.coefficients().iter().enumerate() {
                v[i] = c.clone()
            }
            let mut relation = vec![Q::zero(); d + 1];
            relation[k] = Q::one();
            for (pivot, b, r) in &basis {
                let factor = v[*pivot].clone();
                for i in 0..d {
                    v[i] -= &factor * &b[i]
                }
                for i in 0..=d {
                    relation[i] -= &factor * &r[i]
                }
            }
            if let Some(pivot) = v.iter().position(|c| !c.is_zero()) {
                let norm = v[pivot].clone();
                for c in &mut v {
                    *c /= &norm
                }
                for c in &mut relation {
                    *c /= &norm
                }
                basis.push((pivot, v, relation));
            } else {
                return Ok(err(P::new(relation))?.monic());
            }
            power = rem(power.mul(&t), modulus)?;
        }
        Err(Refused("turn/algebra-budget"))
    }
    /// Enforce the single algebraic field policy before composing exact expressions.
    pub fn compatible(&self, b: &Self) -> Result<()> {
        if self.class == TurnClass::Algebraic
            && b.class == TurnClass::Algebraic
            && self.witness != b.witness
        {
            return Err(Refused("turn/field-tower"));
        }
        Ok(())
    }
    pub fn rational_sin_cos(&self) -> Result<(Q, Q)> {
        if self.class != TurnClass::Rational {
            return Err(Refused("turn/non-rational-consumer"));
        }
        let f = self.field.as_ref().unwrap();
        let mut root = f.root.clone();
        err(root.refine(&(Q::one() / q(1 << 20)), Limits::default()))?;
        // Rational Tan classes may have a quadratic defining polynomial but an exact rational root.
        if let Some(AngleWitness::Tan(t)) = &self.witness {
            let c = wonky_curve::numeric::exact_root(&(Q::one() / (Q::one() + t * t))).unwrap();
            return Ok((t * &c, c));
        }
        Ok((
            f.sin.coefficients().first().cloned().unwrap_or_default(),
            f.cos.coefficients().first().cloned().unwrap_or_default(),
        ))
    }
}
/// Existing operations admit only their old sentinels; their byte words stay unchanged.
/// New consumers can verify a construction witness without broadening producer capability.
pub fn sentinel(word: f64, degrees: i64) -> bool {
    word.to_bits() == ((degrees as f64) * (std::f64::consts::PI / 180.)).to_bits()
}

/// Existing algebraic field or analytic half-angle generator, shared by coordinates.
#[derive(Debug)]
struct CoordinateField {
    turn: Turn,
    root: Option<std::sync::Arc<AlgebraicReal>>,
}
impl wonky_curve::real::Generator for CoordinateField {
    fn identity(&self) -> Vec<u8> {
        match &self.root {
            Some(root) => format!("{:?}:{:?}", root.polynomial(), root.interval()).into_bytes(),
            None => format!("analytic-half-angle:{:?}", self.turn.construction_key()).into_bytes(),
        }
    }
    fn modulus(&self) -> Option<&P> {
        self.root.as_ref().map(|r| r.polynomial())
    }
    fn bounds(&self, bits: usize) -> wonky_curve::refusal::R<(Q, Q)> {
        if let Some(root) = &self.root {
            let mut r = root.as_ref().clone();
            r.refine(
                &Q::new(BigInt::one(), BigInt::one() << bits),
                Limits::default(),
            )
            .map_err(|_| wonky_curve::Refusal::RealBudget)?;
            return Ok((r.interval().lower().clone(), r.interval().upper().clone()));
        }
        let s = self
            .turn
            .enclosure(&q(0), &q(1), &q(0), bits)
            .map_err(|_| wonky_curve::Refusal::RealUndecided)?;
        let c = self
            .turn
            .enclosure(&q(1), &q(0), &q(1), bits)
            .map_err(|_| wonky_curve::Refusal::RealUndecided)?;
        if c.0 <= q(0) {
            return Err(wonky_curve::Refusal::RealUndecided);
        }
        Ok(wonky_curve::real::multiply(&s, &(q(1) / c.1, q(1) / c.0)))
    }
    fn sign(&self, p: &P) -> wonky_curve::refusal::R<std::cmp::Ordering> {
        use std::cmp::Ordering::*;
        if p.is_zero() {
            return Ok(Equal);
        }
        if let Some(root) = &self.root {
            return root
                .sign_at(p, Limits::default())
                .map(|s| match s {
                    Sign::Negative => Less,
                    Sign::Zero => Equal,
                    Sign::Positive => Greater,
                })
                .map_err(|_| wonky_curve::Refusal::RealBudget);
        }
        for bits in [64, 128, 256, 512] {
            if let Ok(b) = self.bounds(bits) {
                let (lo, hi) = wonky_curve::real::evaluate(p, &b);
                if lo > q(0) {
                    return Ok(Greater);
                }
                if hi < q(0) {
                    return Ok(Less);
                }
            }
        }
        Err(wonky_curve::Refusal::RealUndecided)
    }
}
impl Turn {
    /// Coordinates in a shared exact real field, including algebraic and
    /// transcendental turns. No coordinate is replaced by an observation.
    pub fn exact_sin_cos(
        &self,
    ) -> Result<(wonky_curve::radical::Radical, wonky_curve::radical::Radical)> {
        if self
            .field
            .as_ref()
            .is_some_and(|f| f.root.polynomial().degree().unwrap_or(0) <= 2)
        {
            return self.quadratic_sin_cos();
        }
        let root = if let Some(field) = &self.field {
            Some(
                self.coordinate_root
                    .get_or_init(|| {
                        let mut root = field.root.clone();
                        err(root.refine(
                            &Q::new(BigInt::one(), BigInt::one() << 512),
                            Limits::default(),
                        ))?;
                        Ok(std::sync::Arc::new(root))
                    })
                    .clone()?,
            )
        } else {
            None
        };
        let generator = std::sync::Arc::new(CoordinateField {
            turn: self.clone(),
            root,
        });
        if let Some(field) = &self.field {
            let scalar = |p: P| {
                wonky_curve::real::Real::polynomial(generator.clone(), p)
                    .map(wonky_curve::radical::Radical::from_real)
                    .map_err(|e| Refused(e.name()))
            };
            return Ok((scalar(field.sin.clone())?, scalar(field.cos.clone())?));
        }
        let u = wonky_curve::radical::Radical::from_real(
            wonky_curve::real::Real::variable(generator).map_err(|e| Refused(e.name()))?,
        );
        wonky_curve::radical::guard(|| {
            let one = wonky_curve::radical::Radical::from(q(1));
            let u2 = &u * &u;
            let denominator = &one + &u2;
            (u.clone() * q(2) / &denominator, (&one - u2) / denominator)
        })
        .map_err(|e| Refused(e.name()))
    }
    /// Positive principal angular sector. Witnessed full turns retain their
    /// winding; unwitnessed words are exact binary64 radians, not pi sentinels.
    pub fn sector(&self) -> Result<u8> {
        if let Some(AngleWitness::Turns(f)) = &self.witness {
            if f <= &q(0) || f > &q(1) {
                return Err(Refused("revolve/turn-range"));
            }
            return Ok(if f == &q(1) {
                4
            } else if f <= &Q::new(1.into(), 4.into()) {
                0
            } else if f <= &Q::new(3.into(), 4.into()) {
                1
            } else {
                2
            });
        }
        if self.field.is_none() {
            let word = binary64(self.word)?;
            if word <= q(0) {
                return Err(Refused("revolve/turn-range"));
            }
            let (lo, hi) = pi(128);
            if word >= q(2) * hi {
                return Err(Refused("revolve/turn-range"));
            }
            if word >= q(2) * lo {
                return Err(Refused("revolve/turn-range-undecided"));
            }
        } else if self.sign(&q(0), &q(1), &q(0))? == Sign::Negative
            || (self.sign(&q(0), &q(1), &q(0))? == Sign::Zero
                && self.sign(&q(1), &q(0), &q(0))? != Sign::Negative)
        {
            // Rational circle constructions use atan2's signed principal angle.
            return Err(Refused("revolve/turn-range"));
        }
        let sin = self.sign(&q(0), &q(1), &q(0))?;
        let cos = self.sign(&q(1), &q(0), &q(0))?;
        Ok(if sin != Sign::Negative && cos != Sign::Negative {
            0
        } else if sin == Sign::Negative && cos == Sign::Positive {
            2
        } else {
            1
        })
    }
    /// Exact angular measure enclosure in radians. Tan/circle witnesses are
    /// integrated by the rational half-angle identity, with certified series.
    pub fn radians_enclosure(&self, bits: usize) -> Result<(Q, Q)> {
        if bits == 0 || bits > 512 {
            return Err(Refused("turn/enclosure-budget"));
        }
        if let Some(AngleWitness::Turns(f)) = &self.witness {
            let p = pi(bits);
            let factor = q(2) * f;
            return Ok(wonky_curve::real::multiply(&p, &(factor.clone(), factor)));
        }
        if self.field.is_none() {
            let v = binary64(self.word)?;
            return Ok((v.clone(), v));
        }
        if self.sign(&q(0), &q(1), &q(0))? == Sign::Zero
            && self.sign(&q(1), &q(0), &q(0))? == Sign::Negative
        {
            return Ok(pi(bits));
        }
        // atan2 is recovered from the exact half-angle coordinate, reduced
        // to |x| <= 1/5 by atan addition (not by a floating angle cache).
        let sector = self.sector()?;
        let h = CoordinateField {
            turn: self.clone(),
            root: None,
        };
        let (lo, hi) =
            wonky_curve::real::Generator::bounds(&h, bits + 0).map_err(|e| Refused(e.name()))?;
        fn atan(mut x: Q, bits: usize) -> (Q, Q) {
            let negative = x.is_negative();
            x = x.abs();
            let reciprocal = x > q(1);
            if reciprocal {
                x = q(1) / x;
            }
            let mut k = 0;
            let step = Q::new(1.into(), 5.into());
            while x > step {
                x = (&x - &step) / (q(1) + &x * &step);
                k += 1;
            }
            let a = atan_small(x, bits + 8);
            let b = atan_small(step, bits + 8);
            let mut out = (a.0 + q(k) * b.0, a.1 + q(k) * b.1);
            if reciprocal {
                let p = pi(bits + 8);
                out = (p.0 / q(2) - out.1, p.1 / q(2) - out.0);
            }
            if negative {
                out = (-out.1, -out.0);
            }
            out
        }
        let a = atan(lo, bits);
        let b = atan(hi, bits);
        let mut out = (q(2) * a.0, q(2) * b.1);
        if sector == 2 {
            let p = pi(bits);
            out = (out.0 + q(2) * p.0, out.1 + q(2) * p.1);
        }
        Ok(out)
    }
}
