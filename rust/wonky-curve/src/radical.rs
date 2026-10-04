//! Exact multiquadratic arithmetic with a shared real-generator extension.
//! Rational functions retain their generator and never store rounded values.
//!
//! The base terms are rational multiples of positive square roots; K1 adds
//! bounded towers of positive roots of quadratic scalars. Their signs and
//! inverses use exact conjugation, with signs checked before squaring.
//! Square classes are
//! merged by testing whether their ratio has a rational root, without integer
//! factorization. Ordering splits an independent radical basis and squares
//! ONLY after establishing opposite signs. No binary64 value decides a sign.
use crate::numeric::{enclose, exact_root, Q};
use crate::refusal::{Refusal, R};
use num_bigint::BigInt;
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering::{self, Equal, Greater};
use std::ops::{Add, Div, Mul, Neg, Sub};
use std::panic::{catch_unwind, panic_any, resume_unwind, AssertUnwindSafe};
use wonky_num::{Iv, Scalar};

// Budgets bound field degree, work and integer growth independently. They are
// capability limits, never tolerances. Check before doubling an allocation or
// multiplying large rationals; no cache decides an exhausted computation.
const MAX_RANK: usize = 6;
const MAX_TERMS: usize = 1 << MAX_RANK;
const MAX_BITS: u64 = 16_384;
const MAX_WORK: usize = 65_536;
#[derive(Default)]
struct Budget { work: usize }
impl Budget {
    fn charge(&mut self, n: usize) -> R<()> {
        self.work = self.work.checked_add(n).ok_or(Refusal::RadicalBudget)?;
        if self.work > MAX_WORK { Err(Refusal::RadicalBudget) } else { Ok(()) }
    }
    fn value(&mut self, q: &Q) -> R<()> {
        self.charge(1)?;
        if q.numer().bits() > MAX_BITS || q.denom().bits() > MAX_BITS {
            Err(Refusal::RadicalBudget)
        } else { Ok(()) }
    }
    fn product(&mut self, a: &Q, b: &Q) -> R<Q> {
        self.charge(1)?;
        if a.numer().bits() + b.numer().bits() > MAX_BITS
            || a.denom().bits() + b.denom().bits() > MAX_BITS {
            return Err(Refusal::RadicalBudget);
        }
        let out = a * b;
        self.value(&out)?;
        Ok(out)
    }
    fn quotient(&mut self, a: &Q, b: &Q) -> R<Q> {
        if b.is_zero() { return Err(Refusal::NumericRange); }
        self.product(a, &b.recip())
    }
    fn sum(&mut self, a: &Q, b: &Q) -> R<Q> {
        self.charge(1)?;
        // Bound the cross-products BEFORE Ratio allocates them, including the
        // carry bit. Cancellation may refuse, but may not evade the work cap.
        if (a.numer().bits() + b.denom().bits()).max(b.numer().bits() + a.denom().bits()) + 1 > MAX_BITS
            || a.denom().bits() + b.denom().bits() > MAX_BITS {
            return Err(Refusal::RadicalBudget);
        }
        let out = a + b;
        self.value(&out)?;
        Ok(out)
    }
}
fn required<T>(r: R<T>) -> T { r.unwrap_or_else(|r| panic_any(r)) }
/// Recover only a typed arithmetic refusal from infallible operator/ordering
/// traits. Other panics still propagate as defects. Public curve Result
/// methods and the native operation boundary recover before returning a
/// geometric answer, body or export.
pub fn guard<T>(f: impl FnOnce() -> T) -> R<T> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(out) => Ok(out),
        Err(e) => match e.downcast::<Refusal>() {
            Ok(r) => Err(*r),
            Err(e) => resume_unwind(e),
        },
    }
}

#[derive(Clone, Debug, Default)]
pub struct Radical(Vec<(Q, Q)>, Option<Box<Extension>>, Option<Box<crate::real::Real>>);
/// A positive square root of a quadratic scalar, kept as a field extension.
/// Coefficients are in earlier fields; the radicands are ordered exactly.
#[derive(Clone, Debug)]
struct Extension { a: Radical, b: Radical, r: Radical }


impl From<Q> for Radical {
    fn from(v: Q) -> Self {
        if v.is_zero() {
            Self::default()
        } else {
            Self(vec![(Q::one(), v)], None, None)
        }
    }
}
impl Radical {
    pub fn from_real(v: crate::real::Real) -> Self {
        match v.constant() {
            Some(q) => Self::from(q),
            None => Self(vec![], None, Some(Box::new(v))),
        }
    }
    pub fn is_real(&self) -> bool {
        self.2.is_some()
    }
    pub fn same_real_field(&self, b: &Self) -> bool {
        match (&self.2, &b.2) {
            (Some(a), Some(b)) => a.same_field(b),
            (Some(_), None) => b.rational().is_some(),
            (None, Some(_)) => self.rational().is_some(),
            (None, None) => false,
        }
    }
    fn real_pair(&self, b: &Self) -> R<(crate::real::Real, crate::real::Real)> {
        match (&self.2, &b.2) {
            (Some(a), Some(b)) => Ok((a.as_ref().clone(), b.as_ref().clone())),
            (Some(a), None) => Ok((
                a.as_ref().clone(),
                a.rational(b.rational().ok_or(Refusal::RealFieldTower)?)?,
            )),
            (None, Some(b)) => Ok((
                b.rational(self.rational().ok_or(Refusal::RealFieldTower)?)?,
                b.as_ref().clone(),
            )),
            (None, None) => Err(Refusal::RealFieldTower),
        }
    }
    pub fn quadratic(base: Q, offset: Q, radicand: Q) -> R<Self> {
        if radicand.is_negative() {
            return Err(Refusal::NumericRange);
        }
        let mut budget = Budget::default();
        for value in [&base, &offset, &radicand] { budget.value(value)?; }
        let mut out = Self::from(base);
        out.insert(radicand, offset, &mut budget)?;
        Ok(out)
    }
    fn insert(&mut self, mut r: Q, mut c: Q, budget: &mut Budget) -> R<()> {
        budget.value(&r)?;
        budget.value(&c)?;
        if self.0.len() > MAX_TERMS { return Err(Refusal::RadicalBudget); }
        if r.is_zero() || c.is_zero() {
            return Ok(());
        }
        if let Some(root) = exact_root(&r) {
            c = budget.product(&c, &root)?;
            r = Q::one();
        }
        for (s, a) in &mut self.0 {
            if let Some(root) = exact_root(&budget.quotient(&r, s)?) {
                let term = budget.product(&c, &root)?;
                *a = budget.sum(a, &term)?;
                self.0.retain(|(_, a)| !a.is_zero());
                return Ok(());
            }
        }
        if self.0.len() == MAX_TERMS { return Err(Refusal::RadicalBudget); }
        self.0.push((r, c));
        self.0.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(())
    }
    pub fn rational(&self) -> Option<Q> {
        if self.1.is_some() || self.2.is_some() { return None; }
        match self.0.as_slice() {
            [] => Some(Q::zero()),
            [(r, c)] if r.is_one() => Some(c.clone()),
            _ => None,
        }
    }
    /// A quadratic representation, when there is only one non-rational class.
    pub fn parts(&self) -> Option<(Q, Q, Q)> {
        if self.1.is_some() || self.2.is_some() { return None; }
        let mut a = Q::zero();
        let mut b = Q::zero();
        let mut r = Q::one();
        for (s, c) in &self.0 {
            if s.is_one() {
                a = c.clone();
            } else if b.is_zero() {
                b = c.clone();
                r = s.clone();
            } else {
                return None;
            }
        }
        Some((a, b, r))
    }
    pub fn is_zero(&self) -> bool {
        if let Some(v)=&self.2 {required(v.sign())==Equal} else if self.1.is_some() { self.sign() == Equal } else { self.0.is_empty() }
    }
    /// Positive square root if it is expressible without a nested radical.
    /// Failure is a representation refusal, never a rounded root.
    pub fn quadratic_sqrt(&self) -> R<Self> { guard(|| self.quadratic_sqrt_exact())? }
    /// Exact square root, retaining a bounded tower when no quadratic form exists.
    pub fn exact_sqrt(&self) -> R<Self> {
        guard(|| match self.quadratic_sqrt_exact() {
            Err(Refusal::CrossingNeedsAlgebraicVertex) if self.parts().is_some() && self.is_positive() =>
                Self::extension(Self::default(), Self::from(Q::one()), self.clone()),
            result => result,
        })?
    }
    fn quadratic_sqrt_exact(&self) -> R<Self> {
        if self.is_negative() { return Err(Refusal::NumericRange); }
        let (a, b, r) = self.parts().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?;
        if b.is_zero() { return Self::quadratic(Q::zero(), Q::one(), a); }
        let norm = &a * &a - &b * &b * &r;
        if norm.is_negative() { return Err(Refusal::CrossingNeedsAlgebraicVertex); }
        let root = exact_root(&norm).ok_or(Refusal::CrossingNeedsAlgebraicVertex)?;
        let u = (&a + root) / Q::from_integer(2.into());
        let v = &a - &u;
        if u.is_negative() || v.is_negative() { return Err(Refusal::CrossingNeedsAlgebraicVertex); }
        let x = Self::quadratic(Q::zero(), Q::one(), u)?;
        let y = Self::quadratic(Q::zero(), if b.is_negative() { -Q::one() } else { Q::one() }, v)?;
        let out = x + y;
        if &out * &out != *self { return Err(Refusal::CrossingNeedsAlgebraicVertex); }
        Ok(out.abs())
    }
    pub fn is_positive(&self) -> bool {
        self.sign() == Greater
    }
    pub fn is_negative(&self) -> bool {
        self.sign() == Ordering::Less
    }
    pub fn abs(&self) -> Self {
        if self.is_negative() {
            -self
        } else {
            self.clone()
        }
    }
    /// Express the terms in a square-class-independent basis. Dependence is
    /// tested exactly against all products already in the basis (e.g. sqrt 6
    /// belongs to the basis sqrt 2, sqrt 3); no prime factorization is needed.
    fn field(&self, budget: &mut Budget) -> R<(Vec<Q>, Vec<Q>)> {
        if self.0.len() > MAX_TERMS { return Err(Refusal::RadicalBudget); }
        let mut basis = vec![];
        let mut products = vec![Q::one()];
        let mut coefficients = vec![Q::zero()];
        for (r, c) in &self.0 {
            budget.value(r)?;
            budget.value(c)?;
            let mut found = None;
            for (k, s) in products.iter().enumerate() {
                if let Some(root) = exact_root(&budget.quotient(r, s)?) {
                    found = Some((k, root));
                    break;
                }
            }
            if let Some((k, root)) = found {
                let term = budget.product(c, &root)?;
                coefficients[k] = budget.sum(&coefficients[k], &term)?;
            } else {
                if basis.len() == MAX_RANK { return Err(Refusal::RadicalBudget); }
                let n = products.len();
                let more = (0..n).map(|k| budget.product(&products[k], r)).collect::<R<Vec<_>>>()?;
                products.extend(more);
                coefficients.resize(2 * n, Q::zero());
                coefficients[n] = c.clone();
                basis.push(r.clone());
            }
        }
        Ok((basis, coefficients))
    }
    pub fn try_sign(&self) -> R<Ordering> { guard(|| self.try_sign_exact())? }
    fn try_sign_exact(&self) -> R<Ordering> {
        if let Some(v)=&self.2 {return v.sign();}
        // The rational subfield needs no basis construction or square-class
        // reduction. Retain the admission bound before deciding its sign.
        if self.1.is_none() {
            match self.0.as_slice() {
                [] => return Ok(Equal),
                [(r, c)] if r.is_one() => {
                    Budget::default().value(c)?;
                    return Ok(c.cmp(&Q::zero()));
                }
                _ => {}
            }
        }
        if let Some(e) = &self.1 {
            let sa = e.a.try_sign()?;
            let sb = e.b.try_sign()?;
            if sb == Equal { return Ok(sa); }
            if sa == Equal || sa == sb { return Ok(sb); }
            let difference = &e.a * &e.a - &e.b * &e.b * &e.r;
            let sd = difference.try_sign()?;
            return Ok(if sa == Greater { sd } else { sd.reverse() });
        }
        let mut budget = Budget::default();
        let (basis, coefficients) = self.field(&mut budget)?;
        field_sign(&basis, &coefficients, &mut budget)
    }
    pub fn sign(&self) -> Ordering { required(self.try_sign()) }
    pub fn enclosure(&self) -> R<Iv> {
        if let Some(v)=&self.2 {
            for bits in [64,128,256,512] {
                match v.bounds(bits) {
                    Ok((lo,hi))=>return crate::bspline::QBound{lo,hi}.iv(),
                    Err(Refusal::RealUndecided)=>{},
                    Err(e)=>return Err(e),
                }
            }
            return Err(Refusal::RealUndecided);
        }
        if let Some(e) = &self.1 {
            return crate::numeric::finite(e.a.enclosure()? + e.b.enclosure()? * e.r.enclosure()?.sqrt());
        }
        let mut budget = Budget::default();
        if self.0.len() > MAX_TERMS { return Err(Refusal::RadicalBudget); }
        for (r, c) in &self.0 { budget.value(r)?; budget.value(c)?; }
        if let Some(v) = self.rational() {
            return enclose(&v);
        }
        // Refine rational root bounds before enclosing the SUM. This preserves
        // cancellation, unlike adding binary64 caches or root enclosures.
        for bits in [64usize, 128, 256, 512, 1024, 2048, 4096] {
            let mut lo = Q::zero();
            let mut hi = Q::zero();
            for (r, c) in &self.0 {
                let (l, h) = root_bounds(r, bits, &mut budget)?;
                let (l, h) = if c.is_negative() { (h, l) } else { (l, h) };
                let lower = budget.product(c, &l)?;
                let upper = budget.product(c, &h)?;
                lo = budget.sum(&lo, &lower)?;
                hi = budget.sum(&hi, &upper)?;
            }
            let bound = crate::bspline::QBound { lo, hi };
            let iv = bound.iv()?;
            if iv.r <= iv.m.abs() * 8. * f64::EPSILON || bound.is_exact() {
                return Ok(iv);
            }
        }
        Err(Refusal::RadicalBudget)
    }
    /// Exact inversion in the independent multiquadratic field, by recursive
    /// conjugation. Callers must reject zero denominators before invoking it.
    pub fn try_inverse(&self) -> R<Self> {
        if let Some(v)=&self.2 {return Ok(Self::from_real(v.inverse()?));}
        if self.is_zero() { return Err(Refusal::NumericRange); }
        if let Some(e) = &self.1 {
            let norm = &e.a * &e.a - &e.b * &e.b * &e.r;
            let inverse = norm.try_inverse()?;
            return Self::extension(&e.a * &inverse, -&e.b * &inverse, e.r.clone());
        }
        let mut budget = Budget::default();
        let (basis, coefficients) = self.field(&mut budget)?;
        let inverse = field_inverse(&basis, &coefficients, &mut budget)?;
        Self::from_field(&basis, &inverse, &mut budget)
    }
    fn inverse(&self) -> Self { required(self.try_inverse()) }
    fn from_field(basis: &[Q], c: &[Q], budget: &mut Budget) -> R<Self> {
        let mut out = Self::default();
        for (k, a) in c.iter().enumerate().filter(|(_, a)| !a.is_zero()) {
            let r = basis
                .iter()
                .enumerate()
                .filter(|(i, _)| k & (1 << i) != 0)
                .try_fold(Q::one(), |v, (_, b)| budget.product(&v, b))?;
            out.insert(r, a.clone(), budget)?;
        }
        Ok(out)
    }
}
fn root_bounds(r: &Q, bits: usize, budget: &mut Budget) -> R<(Q, Q)> {
    budget.value(r)?;
    if let Some(root) = exact_root(r) {
        return Ok((root.clone(), root));
    }
    if r.numer().bits() + 2 * bits as u64 > MAX_BITS { return Err(Refusal::RadicalBudget); }
    let scale = BigInt::one() << bits;
    let floor = ((r.numer() << (2 * bits)) / r.denom()).sqrt();
    Ok((Q::new(floor.clone(), scale.clone()), Q::new(floor + 1, scale)))
}
fn field_mul(basis: &[Q], a: &[Q], b: &[Q], budget: &mut Budget) -> R<Vec<Q>> {
    let mut c = vec![Q::zero(); a.len()];
    for (i, x) in a.iter().enumerate().filter(|(_, x)| !x.is_zero()) {
        for (j, y) in b.iter().enumerate().filter(|(_, y)| !y.is_zero()) {
            let square = basis
                .iter()
                .enumerate()
                .filter(|(k, _)| i & j & (1 << k) != 0)
                .try_fold(Q::one(), |v, (_, r)| budget.product(&v, r))?;
            let xy = budget.product(x, y)?;
            let term = budget.product(&xy, &square)?;
            c[i ^ j] = budget.sum(&c[i ^ j], &term)?;
        }
    }
    Ok(c)
}
fn field_sign(basis: &[Q], c: &[Q], budget: &mut Budget) -> R<Ordering> {
    budget.charge(1)?;
    if basis.is_empty() {
        budget.value(&c[0])?;
        return Ok(c[0].cmp(&Q::zero()));
    }
    let n = c.len() / 2;
    let (a, b) = c.split_at(n);
    let smaller = &basis[..basis.len() - 1];
    let sa = field_sign(smaller, a, budget)?;
    let sb = field_sign(smaller, b, budget)?;
    if sb == Equal {
        return Ok(sa);
    }
    if sa == Equal || sa == sb {
        return Ok(sb);
    }
    let aa = field_mul(smaller, a, a, budget)?;
    let bb = field_mul(smaller, b, b, budget)?;
    let diff = aa.iter().zip(bb).map(|(x, y)| { let term = budget.product(&y, &basis[basis.len() - 1])?; budget.sum(x, &-term) }).collect::<R<Vec<_>>>()?;
    let s = field_sign(smaller, &diff, budget)?;
    Ok(if sa == Greater { s } else { s.reverse() })
}
fn field_inverse(basis: &[Q], c: &[Q], budget: &mut Budget) -> R<Vec<Q>> {
    budget.charge(1)?;
    if basis.is_empty() {
        budget.value(&c[0])?;
        let v = budget.quotient(&Q::one(), &c[0])?;
        return Ok(vec![v]);
    }
    let n = c.len() / 2;
    let smaller = &basis[..basis.len() - 1];
    let (a, b) = c.split_at(n);
    let aa = field_mul(smaller, a, a, budget)?;
    let bb = field_mul(smaller, b, b, budget)?;
    let norm = aa.iter().zip(bb).map(|(x, y)| { let term = budget.product(&y, &basis[basis.len() - 1])?; budget.sum(x, &-term) }).collect::<R<Vec<_>>>()?;
    let inv = field_inverse(smaller, &norm, budget)?;
    let mut out = field_mul(smaller, a, &inv, budget)?;
    out.extend(field_mul(smaller, b, &inv, budget)?.into_iter().map(|x| -x));
    Ok(out)
}
impl PartialEq for Radical {
    fn eq(&self, o: &Self) -> bool {
        (self - o).is_zero()
    }
}
impl PartialEq<Q> for Radical {
    fn eq(&self, o: &Q) -> bool {
        self == &Self::from(o.clone())
    }
}
impl Eq for Radical {}
impl Ord for Radical {
    fn cmp(&self, o: &Self) -> Ordering {
        (self - o).sign()
    }
}
impl PartialOrd for Radical {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Neg for &Radical {
    type Output = Radical;
    fn neg(self) -> Radical {
        if let Some(v)=&self.2 {return Radical::from_real(required(v.neg()));}
        if let Some(e) = &self.1 { return required(Radical::extension(-&e.a, -&e.b, e.r.clone())); }
        Radical(self.0.iter().map(|(r, c)| (r.clone(), -c)).collect(), None, None)
    }
}
impl Add<&Radical> for &Radical {
    type Output = Radical;
    fn add(self, o: &Radical) -> Radical {
        if self.is_real() || o.is_real(){let (a,b)=required(self.real_pair(o));return Radical::from_real(required(a.add(&b)));}
        if let Some((r,a,b,c,d)) = Radical::align(self,o) {
            return required(Radical::extension(a+c, b+d, r));
        }
        let mut out = self.clone();
        let mut budget = Budget::default();
        for (r, c) in &o.0 {
            required(out.insert(r.clone(), c.clone(), &mut budget));
        }
        out
    }
}
impl Sub<&Radical> for &Radical {
    type Output = Radical;
    fn sub(self, o: &Radical) -> Radical {
        self + &-o
    }
}
impl Mul<&Radical> for &Radical {
    type Output = Radical;
    fn mul(self, o: &Radical) -> Radical {
        if self.is_real() || o.is_real(){let (a,b)=required(self.real_pair(o));return Radical::from_real(required(a.mul(&b)));}
        if let Some((r,a,b,c,d)) = Radical::align(self,o) {
            return required(Radical::extension(&a*&c + &b*&d*&r, &a*&d + &b*&c, r));
        }
        let mut out = Radical::default();
        let mut budget = Budget::default();
        for (r, c) in &self.0 {
            for (s, d) in &o.0 {
                let radicand = required(budget.product(r, s));
                let coefficient = required(budget.product(c, d));
                required(out.insert(radicand, coefficient, &mut budget));
            }
        }
        out
    }
}
impl Div<&Radical> for &Radical {
    type Output = Radical;
    fn div(self, o: &Radical) -> Radical {
        self * &o.inverse()
    }
}
macro_rules! owned_ops {
    ($trait:ident, $method:ident) => {
        impl $trait<Radical> for Radical {
            type Output = Radical;
            fn $method(self, o: Radical) -> Radical {
                (&self).$method(&o)
            }
        }
        impl $trait<&Radical> for Radical {
            type Output = Radical;
            fn $method(self, o: &Radical) -> Radical {
                (&self).$method(o)
            }
        }
        impl $trait<Radical> for &Radical {
            type Output = Radical;
            fn $method(self, o: Radical) -> Radical {
                self.$method(&o)
            }
        }
        impl $trait<Q> for Radical {
            type Output = Radical;
            fn $method(self, o: Q) -> Radical {
                self.$method(Radical::from(o))
            }
        }
        impl $trait<&Q> for Radical {
            type Output = Radical;
            fn $method(self, o: &Q) -> Radical {
                self.$method(o.clone())
            }
        }
        impl $trait<Q> for &Radical {
            type Output = Radical;
            fn $method(self, o: Q) -> Radical {
                self.$method(&Radical::from(o))
            }
        }
        impl $trait<&Q> for &Radical {
            type Output = Radical;
            fn $method(self, o: &Q) -> Radical {
                self.$method(o.clone())
            }
        }
    };
}
owned_ops!(Add, add);
owned_ops!(Sub, sub);
owned_ops!(Mul, mul);
owned_ops!(Div, div);
impl Neg for Radical {
    type Output = Radical;
    fn neg(self) -> Radical {
        if let Some(e) = &self.1 { return required(Radical::extension(-&e.a, -&e.b, e.r.clone())); }
        -&self
    }
}
pub fn positive_angle(x: &Radical, y: &Radical) -> R<Iv> {
    if let (Some(x), Some(y)) = (x.rational(), y.rational()) {
        return crate::numeric::positive_angle(&x, &y);
    }
    let pi = crate::numeric::pi();
    if y.is_zero() {
        return Ok(if !x.is_negative() { Iv::point(0.) } else { pi });
    }
    if x.is_zero() {
        return Ok(if y.is_positive() { pi / Iv::point(2.) } else { pi * Iv::point(1.5) });
    }
    let (ax, ay) = (x.abs(), y.abs());
    let acute = if ax >= ay {
        crate::numeric::atan_unit((&ay / &ax).enclosure()?)?
    } else {
        pi / Iv::point(2.) - crate::numeric::atan_unit((&ax / &ay).enclosure()?)?
    };
    Ok(match (x.is_positive(), y.is_positive()) {
        (true, true) => acute,
        (false, true) => pi - acute,
        (false, false) => pi + acute,
        (true, false) => pi * Iv::point(2.) - acute,
    })
}
pub type V = [Radical; 2];
pub fn vector(p: &crate::numeric::P) -> V {
    p.clone().map(Radical::from)
}
pub fn sub(a: &V, b: &V) -> V {
    [&a[0] - &b[0], &a[1] - &b[1]]
}
pub fn dot(a: &V, b: &V) -> Radical {
    &a[0] * &b[0] + &a[1] * &b[1]
}
pub fn cross(a: &V, b: &V) -> Radical {
    &a[0] * &b[1] - &a[1] * &b[0]
}
pub fn norm(a: &V) -> R<Iv> {
    crate::numeric::finite(dot(a, a).enclosure()?.sqrt())
}
pub fn direction_cmp(a: &V, b: &V) -> Ordering {
    let half = |v: &V| v[1].is_negative() || (v[1].is_zero() && v[0].is_negative());
    half(a).cmp(&half(b)).then_with(|| cross(a, b).sign().reverse())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::numeric::q;
    fn root(r: f64) -> Radical {
        Radical::quadratic(q(0.), q(1.), q(r)).unwrap()
    }
    #[test]
    fn square_roots_are_verified_in_the_field_and_nested_roots_refuse() {
        for value in [Radical::from(q(0.)),root(2.),root(2.)+q(1.),root(2.)-q(1.),root(2.)+root(3.)] {
            let square = &value * &value;
            let positive = square.quadratic_sqrt().unwrap();
            assert_eq!(positive,value.abs());
            assert_eq!(&positive * &positive,square);
        }
        assert_eq!((root(2.)+q(2.)).quadratic_sqrt(),Err(Refusal::CrossingNeedsAlgebraicVertex));
        assert_eq!((root(2.)+q(1.)).quadratic_sqrt(),Err(Refusal::CrossingNeedsAlgebraicVertex));
        assert_eq!(Radical::from(q(-1.)).quadratic_sqrt(),Err(Refusal::NumericRange));
    }
    #[test]
    fn rational_signs_retain_the_integer_size_admission_bound() {
        for n in [-7, 0, 7] {
            let v = Q::new(n.into(), 13.into());
            assert_eq!(Radical::from(v.clone()).try_sign(), Ok(v.cmp(&Q::zero())));
        }
        let admitted = BigInt::one() << (MAX_BITS - 1);
        for v in [Q::from_integer(admitted.clone()), Q::new(BigInt::one(), admitted)] {
            assert_eq!(Radical::from(v.clone()).try_sign(), Ok(Greater));
            assert_eq!(Radical::from(-v).try_sign(), Ok(Ordering::Less));
        }
        let refused = BigInt::one() << MAX_BITS;
        for v in [Q::from_integer(refused.clone()), Q::new(BigInt::one(), refused)] {
            assert_eq!(Radical::from(v.clone()).try_sign(), Err(Refusal::RadicalBudget));
            assert_eq!(Radical::from(-v).try_sign(), Err(Refusal::RadicalBudget));
        }
    }
    #[test]
    fn field_rank_and_bit_growth_exhaustion_refuse_before_exponential_work() {
        let sum = [2., 3., 5., 7., 11., 13., 17.].into_iter().fold(Radical::default(), |v, r| v + root(r));
        assert_eq!(sum.try_sign(), Err(Refusal::RadicalBudget));
        assert_eq!(sum.try_inverse(), Err(Refusal::RadicalBudget));
        assert_eq!(guard(|| sum.sign()), Err(Refusal::RadicalBudget));
        assert_eq!(guard(|| Radical::from(q(1.)) / &sum), Err(Refusal::RadicalBudget));
        let huge = Radical::from(Q::from_integer(BigInt::one() << (MAX_BITS + 1)));
        assert_eq!(huge.try_sign(), Err(Refusal::RadicalBudget));
        assert_eq!(huge.try_inverse(), Err(Refusal::RadicalBudget));
        assert_eq!(huge.enclosure(), Err(Refusal::RadicalBudget));
        let mut budget = Budget { work: MAX_WORK };
        assert_eq!(field_sign(&[], &[q(1.)], &mut budget), Err(Refusal::RadicalBudget));
        let large = Q::from_integer(BigInt::one() << (MAX_BITS / 2 + 1));
        assert_eq!(Budget::default().product(&large, &large), Err(Refusal::RadicalBudget));
        assert_eq!(Refusal::RadicalBudget.name(), "curve2/radical-budget");
    }
    #[test]
    fn typed_guard_never_disguises_an_ordinary_panic() {
        assert!(catch_unwind(|| guard(|| panic!("defect"))).is_err());
    }
    #[test]
    fn dependent_square_classes_cancel_without_factoring() {
        assert_eq!(root(8.), root(2.) * q(2.));
        assert!((root(6.) - root(2.) * root(3.)).is_zero());
        assert_eq!((root(2.) + root(3.) - root(6.)).sign(), Greater);
        assert_eq!((root(2.) + root(3.)).clone() / (root(2.) + root(3.)), Radical::from(q(1.)));
    }
    #[test]
    fn near_ties_are_ordered_exactly_not_by_binary64() {
        let x = root(2.);
        let eps = Q::new(1.into(), BigInt::one() << 220);
        let y = &x + eps;
        assert_eq!(x.enclosure().unwrap().m, y.enclosure().unwrap().m);
        assert!(x < y);
        // Two distinct radicands with the same binary64 root cache.
        let z = Radical::quadratic(q(0.), q(1.), q(2.) + Q::new(1.into(), BigInt::one() << 220)).unwrap();
        assert_eq!(x.enclosure().unwrap().m, z.enclosure().unwrap().m);
        assert!(x < z);
    }
    #[test]
    fn radical3_order_handles_opposing_signs_and_exact_equalities() {
        assert_eq!((root(2.) + root(3.) - Radical::from(q(3.))).sign(), Greater);
        assert!((root(2.) + root(3.) - Radical::from(q(4.))).is_negative());
        assert_eq!((root(2.) - root(3.) + root(5.)).sign(), Greater);
        assert_eq!((root(2.) + root(3.) - root(10.)).sign(), Ordering::Less);
        assert_eq!((root(2.) * root(3.) - root(6.)).sign(), Equal);
    }
    #[test]
    fn cancellation_is_enclosed_before_rounding() {
        let tiny = Radical::quadratic(q(-2.), q(1.), q(4.) + Q::new(1.into(), BigInt::one() << 200)).unwrap();
        let iv = tiny.enclosure().unwrap();
        assert!(iv.lo() > 0.);
        assert!((tiny.clone() - Radical::from(q(iv.lo()))).is_positive());
        assert!((Radical::from(q(iv.hi())) - tiny).is_positive());
    }
}

impl PartialEq<Radical> for Q { fn eq(&self, rhs: &Radical) -> bool { rhs == self } }
impl PartialOrd<Q> for Radical { fn partial_cmp(&self, rhs: &Q) -> Option<Ordering> { Some(self.cmp(&Radical::from(rhs.clone()))) } }

impl Radical {
    pub fn is_nested(&self) -> bool { self.1.is_some() }
    fn extension_depth(&self) -> usize {
        self.1.as_ref().map_or(0, |e| 1 + e.a.extension_depth().max(e.b.extension_depth()))
    }
    fn extension(a: Self, b: Self, r: Self) -> R<Self> {
        if b.is_zero() { return Ok(a); }
        if a.is_real() || b.is_real() || r.is_real() { return Err(Refusal::RealFieldTower); }
        if r.1.is_some() || !r.is_positive() { return Err(Refusal::CrossingNeedsAlgebraicVertex); }
        if a.extension_depth().max(b.extension_depth()) >= 4 { return Err(Refusal::RadicalBudget); }
        // Dependence can arise across roots of distinct quadratic scalars.
        // A zero norm proves that this extension collapses in its base field.
        if &a * &a == &b * &b * &r {
            return Ok(if a.sign() == b.sign() { a * Q::from_integer(2.into()) } else { Self::default() });
        }
        Ok(Self(Vec::new(), Some(Box::new(Extension { a,b,r })), None))
    }
    fn align(a: &Self,b: &Self) -> Option<(Self,Self,Self,Self,Self)> {
        let r = match (&a.1,&b.1) {
            (None,None) => return None,
            (Some(e),None)|(None,Some(e)) => e.r.clone(),
            (Some(e),Some(f)) => e.r.clone().max(f.r.clone()),
        };
        let parts = |v: &Self| match &v.1 {
            Some(e) if e.r == r => (e.a.clone(),e.b.clone()),
            Some(_)|None => (v.clone(),Self::default()),
        };
        let (aa,ab)=parts(a); let (ba,bb)=parts(b);
        Some((r,aa,ab,ba,bb))
    }
}

macro_rules! rational_left {
    ($trait:ident,$method:ident) => {
        impl $trait<&Radical> for &Q { type Output=Radical; fn $method(self,rhs:&Radical)->Radical { Radical::from(self.clone()).$method(rhs) } }
        impl $trait<Radical> for &Q { type Output=Radical; fn $method(self,rhs:Radical)->Radical { Radical::from(self.clone()).$method(rhs) } }
        impl $trait<&Radical> for Q { type Output=Radical; fn $method(self,rhs:&Radical)->Radical { Radical::from(self).$method(rhs) } }
        impl $trait<Radical> for Q { type Output=Radical; fn $method(self,rhs:Radical)->Radical { Radical::from(self).$method(rhs) } }
    }
}
rational_left!(Add,add); rational_left!(Sub,sub); rational_left!(Mul,mul); rational_left!(Div,div);

impl PartialOrd<Radical> for Q { fn partial_cmp(&self,rhs:&Radical)->Option<Ordering> { Some(Radical::from(self.clone()).cmp(rhs)) } }
