//! Range fallback for closest-edge predicates. Geometry remains binary64;
//! rationals are temporary decision values when expansion products underflow.
use crate::polyhedron::{Audited, Refused};
use num_bigint::BigInt;
use num_rational::BigRational as Q;
use num_traits::Zero;

type V = [Q; 3];
fn exact(x: f64) -> Q {
    // Caller validates finite inputs and Audited guarantees finite vertices.
    let bits = x.to_bits();
    let e = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = (bits & ((1u64 << 52) - 1)) | if e == 0 { 0 } else { 1u64 << 52 };
    let mut n = BigInt::from(mantissa);
    if bits >> 63 != 0 {
        n = -n;
    }
    let power = if e == 0 { -1074 } else { e - 1075 };
    if power >= 0 {
        Q::from_integer(n << power as usize)
    } else {
        Q::new(n, BigInt::from(1u8) << (-power) as usize)
    }
}
fn dot(a: &V, b: &V) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn minus(a: &V, b: &V) -> V {
    std::array::from_fn(|k| &a[k] - &b[k])
}
fn distance(body: &Audited, edge: usize, point: &V) -> Result<Q, Refused> {
    let edge = body
        .body
        .edges
        .get(edge)
        .ok_or_else(|| Refused("edge-query/edge-index".into()))?;
    let points = crate::planar_geometry::world_points(body, 1.)?;
    let at = |i: usize| points[edge.vertices[i].0 as usize].clone();
    let a = at(0);
    let v = minus(&at(1), &a);
    let w = minus(point, &a);
    let vv = dot(&v, &v);
    if vv.is_zero() {
        return Err(Refused("edge-query/degenerate-edge".into()));
    }
    let t = dot(&w, &v);
    if t <= Q::zero() {
        return Ok(dot(&w, &w));
    }
    if t >= vv {
        let e = minus(&w, &v);
        return Ok(dot(&e, &e));
    }
    Ok(dot(&w, &w) - &t * &t / vv)
}

pub(super) fn closest(
    candidates: &[(&Audited, usize)],
    point: [f64; 3],
    tie: f64,
) -> Result<Vec<usize>, Refused> {
    let point = point.map(exact);
    let ds = candidates
        .iter()
        .map(|(b, e)| distance(b, *e, &point))
        .collect::<Result<Vec<_>, _>>()?;
    let Some(best) = ds.iter().min() else {
        return Ok(vec![]);
    };
    let t = exact(tie);
    let t2 = &t * &t;
    let bound = Q::from_integer(4.into()) * &t2 * best;
    Ok(ds
        .iter()
        .enumerate()
        .filter_map(|(i, d)| {
            let left = d - best - &t2;
            (left <= Q::zero() || &left * &left <= bound).then_some(i)
        })
        .collect())
}
