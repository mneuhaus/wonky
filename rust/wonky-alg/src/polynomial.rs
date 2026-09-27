use crate::{checked_rational, AlgebraError, BigInt, Rational};
use num_traits::{One, Zero};

/// Canonical rational polynomial. The zero polynomial has no coefficients and no degree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Polynomial {
    coefficients: Vec<Rational>,
}

/// `original = unit * product(factor.polynomial ^ factor.multiplicity)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SquareFreeDecomposition {
    pub unit: Rational,
    /// Monic, pairwise coprime square-free factors, in increasing multiplicity order.
    pub factors: Vec<SquareFreeFactor>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SquareFreeFactor {
    pub polynomial: Polynomial,
    pub multiplicity: usize,
}

impl Polynomial {
    /// Coefficients in ascending power order; raw rationals are checked and normalized.
    pub fn new(coefficients: Vec<Rational>) -> Result<Self, AlgebraError> {
        Ok(Self::canonical(
            coefficients
                .iter()
                .map(checked_rational)
                .collect::<Result<_, _>>()?,
        ))
    }

    pub fn from_integers(coefficients: &[i64]) -> Self {
        Self::from_bigints(coefficients.iter().copied().map(BigInt::from).collect())
    }

    pub fn from_bigints(coefficients: Vec<BigInt>) -> Self {
        Self::canonical(
            coefficients
                .into_iter()
                .map(Rational::from_integer)
                .collect(),
        )
    }

    pub fn zero() -> Self {
        Self::canonical(Vec::new())
    }

    pub fn one() -> Self {
        Self::canonical(vec![Rational::one()])
    }

    fn canonical(mut coefficients: Vec<Rational>) -> Self {
        while coefficients.last().is_some_and(Zero::is_zero) {
            coefficients.pop();
        }
        Self { coefficients }
    }

    pub fn coefficients(&self) -> &[Rational] {
        &self.coefficients
    }

    pub fn degree(&self) -> Option<usize> {
        self.coefficients.len().checked_sub(1)
    }

    pub fn is_zero(&self) -> bool {
        self.coefficients.is_empty()
    }

    pub fn is_one(&self) -> bool {
        self.coefficients.len() == 1 && self.coefficients[0].is_one()
    }

    pub fn leading_coefficient(&self) -> Option<&Rational> {
        self.coefficients.last()
    }

    pub fn evaluate(&self, x: &Rational) -> Result<Rational, AlgebraError> {
        Ok(self.eval(&checked_rational(x)?))
    }

    pub(crate) fn eval(&self, x: &Rational) -> Rational {
        self.coefficients
            .iter()
            .rev()
            .fold(Rational::zero(), |acc, c| acc * x + c)
    }

    pub fn derivative(&self) -> Self {
        Self::canonical(
            self.coefficients
                .iter()
                .enumerate()
                .skip(1)
                .map(|(i, c)| c * Rational::from_integer(BigInt::from(i)))
                .collect(),
        )
    }

    pub fn add(&self, other: &Self) -> Self {
        let mut coefficients = self.coefficients.clone();
        coefficients.resize(
            coefficients.len().max(other.coefficients.len()),
            Rational::zero(),
        );
        for (c, d) in coefficients.iter_mut().zip(&other.coefficients) {
            *c += d;
        }
        Self::canonical(coefficients)
    }

    pub fn neg(&self) -> Self {
        Self::canonical(self.coefficients.iter().map(|c| -c).collect())
    }

    pub fn sub(&self, other: &Self) -> Self {
        self.add(&other.neg())
    }

    pub fn mul(&self, other: &Self) -> Self {
        if self.is_zero() || other.is_zero() {
            return Self::zero();
        }
        let mut coefficients =
            vec![Rational::zero(); self.coefficients.len() + other.coefficients.len() - 1];
        for (i, a) in self.coefficients.iter().enumerate() {
            for (j, b) in other.coefficients.iter().enumerate() {
                coefficients[i + j] += a * b;
            }
        }
        Self::canonical(coefficients)
    }

    pub fn scale(&self, factor: &Rational) -> Result<Self, AlgebraError> {
        let factor = checked_rational(factor)?;
        Ok(self.scaled(&factor))
    }

    pub(crate) fn scaled(&self, factor: &Rational) -> Self {
        Self::canonical(self.coefficients.iter().map(|c| c * factor).collect())
    }

    /// Zero remains zero. Other polynomials become monic.
    pub fn monic(&self) -> Self {
        match self.leading_coefficient() {
            Some(lead) => self.scaled(&lead.recip()),
            None => Self::zero(),
        }
    }

    /// Euclidean division over Q; remainder degree is strictly below divisor degree.
    pub fn div_rem(&self, divisor: &Self) -> Result<(Self, Self), AlgebraError> {
        let divisor_degree = divisor
            .degree()
            .ok_or(AlgebraError::DivisionByZeroPolynomial)?;
        let Some(degree) = self.degree() else {
            return Ok((Self::zero(), Self::zero()));
        };
        if degree < divisor_degree {
            return Ok((Self::zero(), self.clone()));
        }
        let mut quotient = vec![Rational::zero(); degree - divisor_degree + 1];
        let mut remainder = self.clone();
        while let Some(rd) = remainder.degree() {
            if rd < divisor_degree {
                break;
            }
            let shift = rd - divisor_degree;
            let coefficient = &remainder.coefficients[rd] / &divisor.coefficients[divisor_degree];
            quotient[shift] = coefficient.clone();
            for (i, c) in divisor.coefficients.iter().enumerate() {
                remainder.coefficients[i + shift] -= &coefficient * c;
            }
            remainder = Self::canonical(remainder.coefficients);
        }
        Ok((Self::canonical(quotient), remainder))
    }

    pub fn exact_div(&self, divisor: &Self) -> Result<Self, AlgebraError> {
        let (quotient, remainder) = self.div_rem(divisor)?;
        if !remainder.is_zero() {
            return Err(AlgebraError::NonExactDivision);
        }
        Ok(quotient)
    }

    /// Monic gcd, with gcd(0, 0) = 0.
    pub fn gcd(&self, other: &Self) -> Self {
        let (mut a, mut b) = (self.clone(), other.clone());
        while !b.is_zero() {
            // b is nonzero by the loop invariant.
            let r = a.div_rem(&b).expect("nonzero gcd divisor").1;
            a = b;
            b = r.monic();
        }
        a.monic()
    }

    /// Yun's characteristic-zero square-free decomposition over Q.
    pub fn square_free_decomposition(&self) -> Result<SquareFreeDecomposition, AlgebraError> {
        let unit = self
            .leading_coefficient()
            .ok_or(AlgebraError::ZeroPolynomial)?
            .clone();
        let f = self.monic();
        let mut repeated = f.gcd(&f.derivative());
        let mut remaining = f.exact_div(&repeated)?;
        let mut multiplicity = 1;
        let mut factors = Vec::new();
        while !remaining.is_one() {
            let shared = remaining.gcd(&repeated);
            let factor = remaining.exact_div(&shared)?;
            if !factor.is_one() {
                factors.push(SquareFreeFactor {
                    polynomial: factor,
                    multiplicity,
                });
            }
            remaining = shared;
            repeated = repeated.exact_div(&remaining)?;
            multiplicity += 1;
        }
        Ok(SquareFreeDecomposition { unit, factors })
    }

    pub fn square_free_part(&self) -> Result<Self, AlgebraError> {
        if self.is_zero() {
            return Err(AlgebraError::ZeroPolynomial);
        }
        self.exact_div(&self.gcd(&self.derivative()))
            .map(|p| p.monic())
    }
}
