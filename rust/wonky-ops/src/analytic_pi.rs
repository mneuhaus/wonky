//! Shared analytic pi enclosure, reused from the arc strand.
use num_rational::BigRational as Q;
use num_traits::{ToPrimitive, Zero};
use std::sync::OnceLock;
use wonky_num::ball::Iv;
/// Machin's identity pi=16 atan(1/5)-4 atan(1/239), with exact alternating
/// rational series bounds. Conversion to binary64 is outward checked, cached.
pub fn pi() -> Iv {
    *PI.get_or_init(|| {
        let q = |n: i64| Q::from_integer(n.into());
        let atan = |d: i64| {
            let x = q(1) / q(d);
            let mut power = x.clone();
            let mut s = Q::zero();
            for k in 0..32 {
                let term = &power / q(2 * k + 1);
                s += if k % 2 == 0 { term } else { -term };
                power *= &x * &x;
            }
            let upper = &s + power / q(65);
            (s, upper)
        };
        let (al, ah) = atan(5);
        let (bl, bh) = atan(239);
        let lo = q(16) * al - q(4) * bh;
        let hi = q(16) * ah - q(4) * bl;
        let mut l = lo.to_f64().unwrap();
        while Q::from_float(l).unwrap() > lo {
            l = l.next_down();
        }
        let mut h = hi.to_f64().unwrap();
        while Q::from_float(h).unwrap() < hi {
            h = h.next_up();
        }
        Iv {
            m: l,
            r: (h - l).next_up(),
        }
    })
}
static PI: OnceLock<Iv> = OnceLock::new();
