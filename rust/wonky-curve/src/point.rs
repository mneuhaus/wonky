//! Exact point keys. Rational, quadratic and shared real coordinates use
//! exact scalar arithmetic; serialization caches never decide topology.
use crate::numeric::{pt, P, Q};
use crate::radical::{self, Radical, V};
use crate::refusal::{Refusal, R};
use std::cmp::Ordering;
use num_traits::Zero;
use wonky_num::Iv;

/// Opaque coordinates admitted from one shared quadratic root. Geometry
/// consumers cannot inject an unrestricted multiquadratic point.
#[derive(Clone, Debug)]
pub struct QuadraticPoint(V);
#[derive(Clone, Debug)]
pub struct AlgebraicPoint(V);

#[derive(Clone, Debug)]
pub enum ExactPoint {
    Rational(P),
    Quadratic(QuadraticPoint),
    /// Coordinates in bounded exact quadratic towers, needed by K1 circle cuts.
    Algebraic(AlgebraicPoint),
    Real(V),
}
impl PartialEq for ExactPoint { fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal } }
impl Eq for ExactPoint {}
impl PartialOrd for ExactPoint { fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) } }
impl Ord for ExactPoint {
    fn cmp(&self, other: &Self) -> Ordering {
        let (a, b) = (self.coordinates(), other.coordinates());
        if cfg!(feature = "plant_quadratic_cache_order") && (self.rat().is_err() || other.rat().is_err()) {
            if let (Ok(a), Ok(b)) = (self.cache(), other.cache()) {
                return a[0].total_cmp(&b[0]).then_with(|| a[1].total_cmp(&b[1]));
            }
        }
        a[0].cmp(&b[0]).then_with(|| a[1].cmp(&b[1]))
    }
}
impl ExactPoint {
    pub fn from_exact_coordinates(p:V)->R<Self> {if p.iter().any(|v|v.is_real()){Self::from_real_coordinates(p)}else{Self::from_coordinates(p)}}
    /// Coordinates of one exact real generator, distinct from quadratic points.
    pub fn from_real_coordinates(p: V) -> R<Self> {
        let g=p.iter().find(|v|v.is_real()).ok_or(Refusal::RealFieldTower)?;
        if !p.iter().all(|v|v.rational().is_some()||g.same_real_field(v)){return Err(Refusal::RealFieldTower);}
        Ok(Self::Real(p))
    }

    pub fn from_f64(p: [f64; 2]) -> Self { Self::Rational(pt(p)) }
    pub fn from_rational(p: P) -> Self { Self::Rational(p) }
    pub(crate) fn from_radical(p: V) -> Self {
        if p.iter().any(|v|v.is_real()){return Self::Real(p);}
        match (p[0].rational(), p[1].rational()) {
            (Some(x), Some(y)) => Self::Rational([x, y]),
            _ if !Self::shared_quadratic(&p) => Self::Algebraic(AlgebraicPoint(p)),
            _ => Self::Quadratic(QuadraticPoint(p)),
        }
    }
    fn shared_quadratic(p: &V) -> bool {
        let (Some(a),Some(b))=(p[0].parts(),p[1].parts()) else { return false; };
        a.1.is_zero() || b.1.is_zero() || crate::numeric::exact_root(&(&a.2 / &b.2)).is_some()
    }
    pub fn from_quadratic(base: P, offset: P, r: Q) -> R<Self> {
        Ok(Self::from_radical([
            Radical::quadratic(base[0].clone(), offset[0].clone(), r.clone())?,
            Radical::quadratic(base[1].clone(), offset[1].clone(), r)?,
        ]))
    }
    /// Admit one shared quadratic field, or coordinates retaining a bounded
    /// quadratic tower (K1). Unrestricted multiquadratic injection is refused.
    pub fn from_coordinates(p: V) -> R<Self> {
        if p.iter().any(Radical::is_nested) { return Ok(Self::from_radical(p)); }
        let parts = p.iter().map(|c| c.parts().ok_or(Refusal::CrossingNeedsAlgebraicVertex))
            .collect::<R<Vec<_>>>()?;
        if !parts[0].1.is_zero() && !parts[1].1.is_zero()
            && crate::numeric::exact_root(&(&parts[0].2 / &parts[1].2)).is_none() {
            return Err(Refusal::CrossingNeedsAlgebraicVertex);
        }
        Ok(Self::from_radical(p))
    }
    /// Rational-only consumers must propagate this refusal, never round or panic.
    pub fn rat(&self) -> R<&P> {
        match self {
            Self::Rational(p) => Ok(p),
            Self::Quadratic(_) | Self::Algebraic(_) | Self::Real(_) => Err(Refusal::CrossingNeedsAlgebraicVertex),
        }
    }
    pub fn coordinates(&self) -> V {
        match self {
            Self::Rational(p) => radical::vector(p),
            Self::Quadratic(p) => p.0.clone(),
            Self::Algebraic(p) => p.0.clone(),
            Self::Real(p) => p.clone(),
        }
    }
    pub fn difference(&self, other: &Self) -> V { radical::sub(&self.coordinates(), &other.coordinates()) }
    pub fn difference_rational(&self, other: &P) -> V { radical::sub(&self.coordinates(), &radical::vector(other)) }
    pub fn cache(&self) -> R<[f64; 2]> { Ok(self.enclosure()?.map(|x| x.m)) }
    pub fn enclosure(&self) -> R<[Iv; 2]> {
        let p = self.coordinates();
        Ok([p[0].enclosure()?, p[1].enclosure()?])
    }
    pub fn linear_form(&self, constant: &Q, coeff: [&Q; 2]) -> R<Iv> {
        radical::guard(|| self.linear_form_exact(constant, coeff))?
    }
    fn linear_form_exact(&self, constant: &Q, coeff: [&Q; 2]) -> R<Iv> {
        let p = self.coordinates();
        (Radical::from(constant.clone()) + &p[0] * coeff[0] + &p[1] * coeff[1]).enclosure()
    }
    pub fn enclosed_difference(&self, other: &Self) -> R<[Iv; 2]> {
        radical::guard(|| self.enclosed_difference_exact(other))?
    }
    fn enclosed_difference_exact(&self, other: &Self) -> R<[Iv; 2]> {
        let d = self.difference(other);
        Ok([d[0].enclosure()?, d[1].enclosure()?])
    }
    pub fn rounding(&self) -> R<f64> {
        let p = self.enclosure()?;
        Ok(p[0].r.max(p[1].r))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::numeric::q;
    use num_bigint::BigInt;
    use num_traits::One;
    #[test]
    fn exact_from_f64_round_trips_and_orders_lexicographically() {
        let a = ExactPoint::from_f64([0.1, 2.]);
        let b = ExactPoint::from_f64([0.1, 3.]);
        assert!(a < b);
        assert_eq!(a, ExactPoint::from_f64([0.1, 2.]));
        assert_eq!(a.cache().unwrap(), [0.1, 2.]);
        assert_eq!(a.enclosure().unwrap()[0].r, 0.);
    }
    #[test]
    fn non_dyadic_rational_gets_a_certified_enclosure() {
        let third = Q::new(1.into(), 3.into());
        let p = ExactPoint::from_rational([third.clone(), Q::from_integer(0.into())]);
        let e = p.enclosure().unwrap()[0];
        assert!(q(e.lo()) <= third && third <= q(e.hi()));
        assert!(e.r > 0.);
        assert_eq!(p.cache().unwrap()[0], e.m);
    }
    #[test]
    fn linear_form_and_difference_are_rounded_once() {
        let p = ExactPoint::from_f64([2., 3.]);
        let o = ExactPoint::from_f64([1., 1.]);
        let f = p.linear_form(&q(10.), [&q(2.), &q(-1.)]).unwrap();
        assert_eq!((f.m, f.r), (11., 0.));
        let d = p.enclosed_difference(&o).unwrap();
        assert_eq!((d[0].m, d[1].m), (1., 2.));
    }
    #[test]
    fn quadratic_keys_separate_equal_caches_and_merge_dependent_radicals() {
        let a = ExactPoint::from_quadratic([q(0.), q(0.)], [q(1.), q(0.)], q(2.)).unwrap();
        let b = ExactPoint::from_quadratic([Q::new(1.into(), BigInt::one() << 220), q(0.)], [q(1.), q(0.)], q(2.)).unwrap();
        assert_eq!(a.cache().unwrap(), b.cache().unwrap());
        assert!(a < b);
        let same = ExactPoint::from_quadratic([q(0.), q(0.)], [q(0.5), q(0.)], q(8.)).unwrap();
        assert_eq!(a, same);
        assert!(a.rat().is_err());
    }
    #[test]
    fn computed_coordinates_keep_the_shared_quadratic_vertex_invariant() {
        let root = |r| Radical::quadratic(q(0.),q(1.),q(r)).unwrap();
        let point = ExactPoint::from_coordinates([root(2.),root(8.)]).unwrap();
        assert_eq!(point,ExactPoint::from_quadratic([q(0.),q(0.)],[q(1.),q(2.)],q(2.)).unwrap());
        assert_eq!(ExactPoint::from_coordinates([root(2.),root(3.)]),Err(Refusal::CrossingNeedsAlgebraicVertex));
        assert_eq!(ExactPoint::from_coordinates([root(2.)+root(3.),Radical::default()]),Err(Refusal::CrossingNeedsAlgebraicVertex));
    }
}
