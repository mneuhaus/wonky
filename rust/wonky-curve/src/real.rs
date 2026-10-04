//! Rational functions of one exact real generator. Algebraic relations are
//! reduced before predicates; analytic generators provide certified bounds.
use crate::{
    numeric::Q,
    refusal::{Refusal, R},
};
use num_traits::{One, Zero};
use std::{cmp::Ordering, fmt::Debug, sync::Arc};
use wonky_alg::Polynomial as P;

pub trait Generator: Debug + Send + Sync {
    fn identity(&self) -> Vec<u8>;
    fn modulus(&self) -> Option<&P>;
    fn bounds(&self, bits: usize) -> R<(Q, Q)>;
    fn sign(&self, polynomial: &P) -> R<Ordering>;
}
#[derive(Clone, Debug)]
pub struct Real {
    pub(crate) generator: Arc<dyn Generator>,
    numerator: P,
    denominator: P,
}
fn alg<T>(v: Result<T, wonky_alg::AlgebraError>) -> R<T> {
    v.map_err(|_| Refusal::RealBudget)
}
fn budget(p: &P) -> R<()> {
    if p.degree().unwrap_or(0) > 128
        || p.coefficients()
            .iter()
            .any(|c| c.numer().bits() > 16384 || c.denom().bits() > 16384)
    {
        Err(Refusal::RealBudget)
    } else {
        Ok(())
    }
}
impl Real {
    /// Import an exact polynomial in the generator's existing field.
    pub fn polynomial(generator: Arc<dyn Generator>, value: P) -> R<Self> {
        Self::new(generator, value, P::one())
    }
    pub fn variable(generator: Arc<dyn Generator>) -> R<Self> {
        Self::new(generator, P::from_integers(&[0, 1]), P::one())
    }
    fn new(generator: Arc<dyn Generator>, mut numerator: P, mut denominator: P) -> R<Self> {
        budget(&numerator)?;
        budget(&denominator)?;
        if let Some(m) = generator.modulus() {
            numerator = alg(numerator.div_rem(m))?.1;
            denominator = alg(denominator.div_rem(m))?.1;
            let (mut a, mut b, mut x, mut y) =
                (m.clone(), denominator.clone(), P::zero(), P::one());
            while !b.is_zero() {
                let (q, r) = alg(a.div_rem(&b))?;
                let z = x.sub(&q.mul(&y));
                a = b;
                b = r;
                x = y;
                y = z;
                budget(&y)?;
            }
            if a.degree() != Some(0) {
                return Err(Refusal::RealUndecided);
            }
            numerator = alg(numerator
                .mul(&alg(x.scale(&(Q::one() / &a.coefficients()[0])))?)
                .div_rem(m))?
            .1;
            denominator = P::one();
        } else {
            if denominator.is_zero() {
                return Err(Refusal::NumericRange);
            }
            let gcd = numerator.gcd(&denominator);
            numerator = alg(numerator.exact_div(&gcd))?;
            denominator = alg(denominator.exact_div(&gcd))?;
            let scale = Q::one() / denominator.leading_coefficient().unwrap();
            numerator = alg(numerator.scale(&scale))?;
            denominator = alg(denominator.scale(&scale))?;
        }
        budget(&numerator)?;
        budget(&denominator)?;
        Ok(Self {
            generator,
            numerator,
            denominator,
        })
    }
    pub fn constant(&self) -> Option<Q> {
        if self.numerator.is_zero() {
            Some(Q::zero())
        } else if self.numerator.degree() == Some(0) && self.denominator.degree() == Some(0) {
            Some(&self.numerator.coefficients()[0] / &self.denominator.coefficients()[0])
        } else {
            None
        }
    }
    pub fn same_field(&self, b: &Self) -> bool {
        self.generator.identity() == b.generator.identity()
    }
    fn pair(&self, b: &Self) -> R<()> {
        if self.same_field(b) {
            Ok(())
        } else {
            Err(Refusal::RealFieldTower)
        }
    }
    pub fn rational(&self, q: Q) -> R<Self> {
        Self::new(self.generator.clone(), alg(P::new(vec![q]))?, P::one())
    }
    pub fn neg(&self) -> R<Self> {
        Self::new(
            self.generator.clone(),
            self.numerator.neg(),
            self.denominator.clone(),
        )
    }
    pub fn add(&self, b: &Self) -> R<Self> {
        self.pair(b)?;
        Self::new(
            self.generator.clone(),
            self.numerator
                .mul(&b.denominator)
                .add(&b.numerator.mul(&self.denominator)),
            self.denominator.mul(&b.denominator),
        )
    }
    pub fn mul(&self, b: &Self) -> R<Self> {
        self.pair(b)?;
        Self::new(
            self.generator.clone(),
            self.numerator.mul(&b.numerator),
            self.denominator.mul(&b.denominator),
        )
    }
    pub fn inverse(&self) -> R<Self> {
        if self.sign()? == Ordering::Equal {
            return Err(Refusal::NumericRange);
        }
        Self::new(
            self.generator.clone(),
            self.denominator.clone(),
            self.numerator.clone(),
        )
    }
    pub fn sign(&self) -> R<Ordering> {
        let a = self.generator.sign(&self.numerator)?;
        let b = self.generator.sign(&self.denominator)?;
        if b == Ordering::Equal {
            return Err(Refusal::NumericRange);
        }
        Ok(if b == Ordering::Less { a.reverse() } else { a })
    }
    pub fn bounds(&self, bits: usize) -> R<(Q, Q)> {
        let bound = self.generator.bounds(bits)?;
        let a = evaluate(&self.numerator, &bound);
        let b = evaluate(&self.denominator, &bound);
        if b.0 <= Q::zero() && b.1 >= Q::zero() {
            return Err(Refusal::RealUndecided);
        }
        Ok(multiply(&a, &(Q::one() / b.1, Q::one() / b.0)))
    }
}
pub fn multiply(a: &(Q, Q), b: &(Q, Q)) -> (Q, Q) {
    let p = [&a.0 * &b.0, &a.0 * &b.1, &a.1 * &b.0, &a.1 * &b.1];
    (
        p.iter().min().unwrap().clone(),
        p.iter().max().unwrap().clone(),
    )
}
pub fn evaluate(p: &P, b: &(Q, Q)) -> (Q, Q) {
    p.coefficients()
        .iter()
        .rev()
        .fold((Q::zero(), Q::zero()), |v, c| {
            let r = multiply(&v, b);
            (r.0 + c, r.1 + c)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        radical::{guard, Radical},
        ExactPoint,
    };
    use wonky_alg::{AlgebraicReal, Limits, RationalInterval, Sign};
    #[derive(Debug)]
    struct Root(AlgebraicReal);
    impl Generator for Root {
        fn identity(&self) -> Vec<u8> {
            format!("{:?}", self.0).into_bytes()
        }
        fn modulus(&self) -> Option<&P> {
            Some(self.0.polynomial())
        }
        fn bounds(&self, bits: usize) -> R<(Q, Q)> {
            let mut r = self.0.clone();
            r.refine(
                &Q::new(1.into(), num_bigint::BigInt::from(1) << bits),
                Limits::default(),
            )
            .map_err(|_| Refusal::RealBudget)?;
            Ok((r.interval().lower().clone(), r.interval().upper().clone()))
        }
        fn sign(&self, p: &P) -> R<Ordering> {
            self.0
                .sign_at(p, Limits::default())
                .map(|s| match s {
                    Sign::Negative => Ordering::Less,
                    Sign::Zero => Ordering::Equal,
                    Sign::Positive => Ordering::Greater,
                })
                .map_err(|_| Refusal::RealBudget)
        }
    }
    fn sqrt(n: i64) -> Radical {
        let p = P::from_integers(&[-n, 0, 1]);
        let root = AlgebraicReal::from_interval(
            &p,
            RationalInterval::new(Q::from_integer(1.into()), Q::from_integer(2.into())).unwrap(),
        )
        .unwrap();
        Radical::from_real(Real::variable(Arc::new(Root(root))).unwrap())
    }
    #[test]
    fn exact_generator_inverse_order_and_point_storage() {
        let u = sqrt(2);
        let one = Radical::from(Q::one());
        assert_eq!(&u * &u, Q::from_integer(2.into()));
        assert_eq!(&one / (&u - &one), &u + &one);
        assert!(
            u > Radical::from(Q::new(
                1414213562373095i64.into(),
                1000000000000000i64.into()
            ))
        );
        assert!(
            u < Radical::from(Q::new(
                1414213562373096i64.into(),
                1000000000000000i64.into()
            ))
        );
        let p = ExactPoint::from_real_coordinates([u.clone(), &u + &one]).unwrap();
        assert!(p.rat().is_err());
        assert!(p.cache().is_ok());
        assert_eq!(
            p,
            ExactPoint::from_real_coordinates([&one / (&u - &one) - &one, u + one]).unwrap()
        );
    }
    #[test]
    fn incompatible_fields_and_zero_divisors_refuse_by_name() {
        let u = sqrt(2);
        let v = sqrt(3);
        assert_eq!(guard(|| &u + &v).unwrap_err(), Refusal::RealFieldTower);
        assert_eq!(
            guard(|| &u / Radical::default()).unwrap_err(),
            Refusal::NumericRange
        );
        assert_eq!(
            guard(
                || &u + Radical::quadratic(Q::zero(), Q::one(), Q::from_integer(3.into())).unwrap()
            )
            .unwrap_err(),
            Refusal::RealFieldTower
        );
    }
}
