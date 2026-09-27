use crate::{
    filter::{self, Ball},
    Refusal, Result, Sign,
};
use wonky_num::expansion::{self as ex, Exp, Guard};

pub(crate) fn scalar(x: f64) -> Exp {
    if x == 0.0 {
        vec![]
    } else {
        vec![x]
    }
}
pub(crate) type Field = [Exp; 4];
pub(crate) struct Context {
    guard: Guard,
}
impl Context {
    pub fn new() -> Self {
        Self {
            guard: Guard::new(),
        }
    }
    pub fn add(&mut self, a: &[f64], b: &[f64]) -> Exp {
        ex::sum(a, b, &mut self.guard)
    }
    pub fn sub(&mut self, a: &[f64], b: &[f64]) -> Exp {
        self.add(a, &ex::neg(b))
    }
    pub fn mul(&mut self, a: &[f64], b: &[f64]) -> Exp {
        ex::mul(a, b, &mut self.guard)
    }
    pub fn sq(&mut self, a: &[f64]) -> Exp {
        self.mul(a, a)
    }
    pub fn scale(&mut self, a: &[f64], b: f64) -> Exp {
        ex::scale(a, b, &mut self.guard)
    }
    pub fn finish(&self) -> Result<()> {
        if self.guard.exact() {
            Ok(())
        } else {
            Err(Refusal::Numeric(
                wonky_num::Undecided::new("N2 expansion", wonky_num::UndecidedKind::NotExact)
                    .into_refusal(),
            ))
        }
    }
    pub fn sign(&self, a: &[f64]) -> Result<Sign> {
        self.finish()?;
        Ok(Sign::of_exact(ex::sign(a) as f64))
    }
    fn one(&mut self, a: &[f64], b: &[f64], c: &[f64]) -> Result<Sign> {
        let (sa, sb, sc) = (self.sign(a)?, self.sign(b)?, self.sign(c)?);
        if sc == Sign::Negative {
            return Err(Refusal::NegativeRadicand);
        }
        if sb == Sign::Zero || sc == Sign::Zero {
            return Ok(sa);
        }
        if sa == Sign::Zero || sa == sb {
            return Ok(sb);
        }
        let aa = self.sq(a);
        let bb = self.sq(b);
        let bbc = self.mul(&bb, c);
        let delta = self.sub(&aa, &bbc);
        Ok(if sa == Sign::Positive {
            self.sign(&delta)?
        } else {
            self.sign(&delta)?.flip()
        })
    }
    /// a[0] + a[1] sqrt(c) + (a[2] + a[3] sqrt(c)) sqrt(e).
    /// Opposite signs permit squaring. Same signs must NOT be squared away.
    pub fn sign_field(&mut self, a: &Field, roots: &[Exp; 2]) -> Result<Sign> {
        self.finish()?;
        for r in roots {
            if self.sign(r)? == Sign::Negative {
                return Err(Refusal::NegativeRadicand);
            }
        }
        if let Some(s) = interval_field(a, roots).and_then(filter::sign) {
            return Ok(s);
        }
        let [c, e] = roots;
        let u = self.one(&a[0], &a[1], c)?;
        let v = self.one(&a[2], &a[3], c)?;
        if self.sign(e)? == Sign::Zero || v == Sign::Zero {
            return Ok(u);
        }
        if u == Sign::Zero || u == v {
            return Ok(v);
        }
        // (A+B sqrt(c))² - e(C+D sqrt(c))² = h + k sqrt(c).
        let aa = self.sq(&a[0]);
        let bb = self.sq(&a[1]);
        let bbc = self.mul(&bb, c);
        let cc = self.sq(&a[2]);
        let dd = self.sq(&a[3]);
        let ddc = self.mul(&dd, c);
        let uu = self.add(&aa, &bbc);
        let vv = self.add(&cc, &ddc);
        let evv = self.mul(e, &vv);
        let h = self.sub(&uu, &evv);
        let ab = self.mul(&a[0], &a[1]);
        let cd = self.mul(&a[2], &a[3]);
        let ecd = self.mul(e, &cd);
        let k = self.sub(&ab, &ecd);
        let k = self.scale(&k, 2.0);
        let s = self.one(&h, &k, c)?;
        Ok(if u == Sign::Positive { s } else { s.flip() })
    }
    pub fn field_sub(&mut self, a: &Field, b: &Field) -> Field {
        std::array::from_fn(|i| self.sub(&a[i], &b[i]))
    }
    pub fn field_mul(&mut self, a: &Field, b: &Field, roots: &[Exp; 2]) -> Field {
        let mut out: Field = std::array::from_fn(|_| vec![]);
        for i in 0..4 {
            for j in 0..4 {
                let mut term = self.mul(&a[i], &b[j]);
                for (k, r) in roots.iter().enumerate() {
                    if i & j & (1 << k) != 0 {
                        term = self.mul(&term, r);
                    }
                }
                out[i ^ j] = self.add(&out[i ^ j], &term);
            }
        }
        out
    }
}
fn interval(a: &[f64]) -> Option<Ball> {
    a.iter()
        .try_fold(Ball::point(0.0), |v, &x| v.add(Ball::point(x)))
}
fn interval_field(a: &Field, r: &[Exp; 2]) -> Option<Ball> {
    let c = interval(&r[0])?.sqrt()?;
    let e = interval(&r[1])?.sqrt()?;
    interval(&a[0])?
        .add(interval(&a[1])?.mul(c)?)?
        .add(interval(&a[2])?.add(interval(&a[3])?.mul(c)?)?.mul(e)?)
}
