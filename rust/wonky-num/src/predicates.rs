//! Exact geometric predicates on f64 inputs.
//!
//! Every predicate
//! 1. refuses (OutOfRange) unless every input is zero or in [1e-150, 1e150],
//! 2. scales each homogeneous input group by a power of two so its largest
//!    magnitude lies in [0.5, 1) (exact within the range policy; the sign of a
//!    homogeneous polynomial is invariant under positive scaling),
//! 3. tries a static floating-point filter whose bound covers the rounding of
//!    the filter evaluation (Shewchuk's error analysis, taken with margin, plus
//!    an absolute term for underflow),
//! 4. otherwise evaluates exactly with expansions and refuses (NotExact) if the
//!    expansion guard reports an inexact intermediate.
//!
//! Nothing is guessed: the result is the exact sign or a named Undecided.

use crate::decision::{check_range, Decision, Sign, Undecided, UndecidedKind};
use crate::expansion::{difference, mul, neg, product, scale, sign, sum, Exp, Guard};
use crate::vec::{P2, P3};

// ---------------------------------------------------------------- filter and scaling

// Filter audit. u=2^-53, eta=2^-1074. For each rounded operation use
// |fl(x)-x| <= u|x| + eta (also valid for subnormals). Scaling is exact.
// Expand each expression into monomials in the exact coordinate differences.
// Each expanded monomial has <=8 rounding factors, as does its unsigned
// magnitude evaluation; gamma_k=ku/(1-ku). With exact permanent P:
// |Vhat-V| <= gamma_8 P + c eta A, |M-P| <= gamma_8 P + c eta A.
// Eliminating P gives gamma_8/(1-gamma_8) M + c eta A/(1-gamma_8).
// Hence a conservative bound is 17u M + 256 eta A.
// Counting the absolute eta terms at every node, including their downstream
// multipliers (scaled coordinates <1, differences <2), gives <256 eta for
// all filters except line_point_side, where it is <256 eta (1+|t|).
// 128u M + 2^-1000 A dominates both bounds even after the THREE roundings
// in this bound's own evaluation (multiply relative, multiply absolute, add).
// No overflow is accepted. A=1 normally and 1+|t| (rounded upward) for a line.
#[cfg(not(feature = "plant_filter"))]
const FILTER_REL: f64 = 64.0 * f64::EPSILON;
#[cfg(not(any(feature = "plant_filter", feature = "plant_filter_abs")))]
const FILTER_ABS: f64 = f64::from_bits(23u64 << 52);
// Planted negatives (docs/rust-migration.md 6, K0): plant_filter removes the
// whole error term, plant_filter_abs only the absolute (underflow) term.
#[cfg(feature = "plant_filter")]
const FILTER_REL: f64 = 0.0;
#[cfg(any(feature = "plant_filter", feature = "plant_filter_abs"))]
const FILTER_ABS: f64 = 0.0;

/// Sign only beyond the audited bound (never certify a rounded zero).
#[inline]
fn filtered(v: f64, magnitude: f64) -> Option<Sign> {
    filtered_amplified(v, magnitude, 1.0)
}

#[inline]
fn filtered_amplified(v: f64, magnitude: f64, amplifier: f64) -> Option<Sign> {
    if !(v.is_finite() && magnitude.is_finite()) {
        return None;
    }
    let bound = FILTER_REL * magnitude + FILTER_ABS * amplifier;
    if v > bound {
        Some(Sign::Positive)
    } else if v < -bound {
        Some(Sign::Negative)
    } else {
        None
    }
}

#[inline]
fn pow2(k: i32) -> f64 {
    debug_assert!((-1022..=1023).contains(&k));
    f64::from_bits(((k + 1023) as u64) << 52)
}

/// 2^k such that max|v| * 2^k lies in [0.5, 1); 1 for an all-zero group.
/// Inputs are range-checked, so the maximum is normal and every scaled value
/// stays normal (>= 2^-998): the scaling is exact.
#[inline]
fn group_scale(values: &[f64]) -> f64 {
    let m = values.iter().fold(0.0f64, |m, x| m.max(x.abs()));
    if m == 0.0 {
        return 1.0;
    }
    let e = ((m.to_bits() >> 52) & 0x7ff) as i32 - 1022;
    pow2(-e)
}

#[inline]
fn scaled(p: P3, s: f64) -> P3 {
    P3 { x: p.x * s, y: p.y * s, z: p.z * s }
}

#[inline]
fn exact_sign(e: &Exp, g: &Guard, site: &'static str) -> Decision {
    if g.exact() {
        Ok(Sign::of_exact(sign(e) as f64))
    } else {
        Err(Undecided::new(site, UndecidedKind::NotExact))
    }
}

#[inline]
fn coords(p: P3) -> [f64; 3] {
    [p.x, p.y, p.z]
}

// ---------------------------------------------------------------- plane side

/// sign(dot(n, p - o)): the side of point `p` relative to the plane through `o`
/// with normal `n` (the spike's `exact::side`).
pub fn plane_side(n: P3, p: P3, o: P3, site: &'static str) -> Decision {
    check_range(&[n.x, n.y, n.z, p.x, p.y, p.z, o.x, o.y, o.z], site)?;
    let n = scaled(n, group_scale(&coords(n)));
    let s = group_scale(&[p.x, p.y, p.z, o.x, o.y, o.z]);
    let (p, o) = (scaled(p, s), scaled(o, s));
    let (dx, dy, dz) = (p.x - o.x, p.y - o.y, p.z - o.z);
    // Three differences, three products, two additions. Each monomial has
    // <=4 roundings; M has <=4. Underflow losses have multipliers <=1.
    // The common 128u*M + 2^-1000 bound above therefore encloses this dot.
    let v = n.x * dx + n.y * dy + n.z * dz;
    let m = n.x.abs() * dx.abs() + n.y.abs() * dy.abs() + n.z.abs() * dz.abs();
    if let Some(sign) = filtered(v, m) {
        return Ok(sign);
    }
    let mut g = Guard::new();
    let tx = difference(p.x, o.x, &mut g);
    let ty = difference(p.y, o.y, &mut g);
    let tz = difference(p.z, o.z, &mut g);
    let a = scale(&tx, n.x, &mut g);
    let b = scale(&ty, n.y, &mut g);
    let c = scale(&tz, n.z, &mut g);
    let ab = sum(&a, &b, &mut g);
    let e = sum(&ab, &c, &mut g);
    exact_sign(&e, &g, site)
}

/// How a segment [a, b] meets a plane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentPlane {
    /// Both endpoints strictly on the given side.
    Disjoint(Sign),
    /// The endpoints lie strictly on opposite sides: one proper crossing.
    Crossing,
    /// The start point lies on the plane, the end strictly on the given side.
    TouchesAtStart(Sign),
    /// The end point lies on the plane, the start strictly on the given side.
    TouchesAtEnd(Sign),
    /// Both endpoints (so the whole segment) lie on the plane.
    InPlane,
}

/// Exact classification of the segment [a, b] against the plane through `o`
/// with normal `n`.
pub fn segment_plane(n: P3, o: P3, a: P3, b: P3, site: &'static str) -> Result<SegmentPlane, Undecided> {
    // No arithmetic beyond two audited plane_side decisions; propagate refusal.
    // All inputs first, so the refusal reason does not depend on evaluation order.
    check_range(&[n.x, n.y, n.z, o.x, o.y, o.z, a.x, a.y, a.z, b.x, b.y, b.z], site)?;
    #[cfg(not(feature = "plant_swallow"))]
    let sa = plane_side(n, a, o, site)?;
    // Planted negative (docs/rust-migration.md 6, K0): the Undecided of the
    // start point is swallowed instead of propagated with `?`.
    #[cfg(feature = "plant_swallow")]
    let sa = plane_side(n, a, o, site).unwrap_or(Sign::Zero);
    let sb = plane_side(n, b, o, site)?;
    Ok(match (sa, sb) {
        (Sign::Zero, Sign::Zero) => SegmentPlane::InPlane,
        (Sign::Zero, s) => SegmentPlane::TouchesAtStart(s),
        (s, Sign::Zero) => SegmentPlane::TouchesAtEnd(s),
        (x, y) if x == y => SegmentPlane::Disjoint(x),
        _ => SegmentPlane::Crossing,
    })
}

/// sign(dot(n, origin + t * direction - point)): the side of the point at
/// parameter `t` on the line (origin, direction) relative to the plane through
/// `point` with normal `n`. Zero is the spike's exact line/plane endpoint
/// certificate (`exact::line_endpoint_on_plane`).
pub fn line_point_side(n: P3, direction: P3, origin: P3, point: P3, t: f64, site: &'static str) -> Decision {
    check_range(
        &[n.x, n.y, n.z, direction.x, direction.y, direction.z, origin.x, origin.y, origin.z, point.x, point.y, point.z, t],
        site,
    )?;
    let n = scaled(n, group_scale(&coords(n)));
    // origin, point and direction scale together (t * direction is a length like origin - point)
    let s = group_scale(&[direction.x, direction.y, direction.z, origin.x, origin.y, origin.z, point.x, point.y, point.z]);
    let (direction, origin, point) = (scaled(direction, s), scaled(origin, s), scaled(point, s));
    let (dx, dy, dz) = (origin.x - point.x, origin.y - point.y, origin.z - point.z);
    let q = n.x * dx + n.y * dy + n.z * dz;
    let r = n.x * direction.x + n.y * direction.y + n.z * direction.z;
    let v = q + t * r;
    let mq = n.x.abs() * dx.abs() + n.y.abs() * dy.abs() + n.z.abs() * dz.abs();
    let mr = n.x.abs() * direction.x.abs() + n.y.abs() * direction.y.abs() + n.z.abs() * direction.z.abs();
    // q: depth 4, r: depth 3; multiply r by t then add q: depth <=5.
    // M=mq+|t|mr has depth <=5. EVERY error in r, including absolute
    // underflow, is magnified by |t|. Hence A=up(1+|t|), not 1.
    if let Some(sign) = filtered_amplified(v, mq + t.abs() * mr, (1.0 + t.abs()).next_up()) {
        return Ok(sign);
    }
    let mut g = Guard::new();
    let tx = difference(origin.x, point.x, &mut g);
    let ty = difference(origin.y, point.y, &mut g);
    let tz = difference(origin.z, point.z, &mut g);
    let (a, b, c) = (scale(&tx, n.x, &mut g), scale(&ty, n.y, &mut g), scale(&tz, n.z, &mut g));
    let ab = sum(&a, &b, &mut g);
    let cq = sum(&ab, &c, &mut g);
    let (d1, d2, d3) = (product(n.x, direction.x, &mut g), product(n.y, direction.y, &mut g), product(n.z, direction.z, &mut g));
    let d12 = sum(&d1, &d2, &mut g);
    let dr = sum(&d12, &d3, &mut g);
    let tr = scale(&dr, t, &mut g);
    let e = sum(&cq, &tr, &mut g);
    exact_sign(&e, &g, site)
}

// ---------------------------------------------------------------- orientation

/// sign(det[b - a, c - a]): Positive when a, b, c turn counterclockwise.
pub fn orient2d(a: P2, b: P2, c: P2, site: &'static str) -> Decision {
    check_range(&[a.x, a.y, b.x, b.y, c.x, c.y], site)?;
    let s = group_scale(&[a.x, a.y, b.x, b.y, c.x, c.y]);
    let (ax, ay, bx, by, cx, cy) = (a.x * s, a.y * s, b.x * s, b.y * s, c.x * s, c.y * s);
    // Shewchuk's form: det[a - c, b - c] == det[b - a, c - a]
    let (acx, bcx, acy, bcy) = (ax - cx, bx - cx, ay - cy, by - cy);
    // Each product contains two rounded differences then a product;
    // final subtraction: depth 4. M depth 4. Intermediate magnifiers <2;
    // all absolute losses fit the common 256 eta allowance.
    let (left, right) = (acx * bcy, acy * bcx);
    if let Some(sign) = filtered(left - right, left.abs() + right.abs()) {
        return Ok(sign);
    }
    let mut g = Guard::new();
    let (eacx, ebcx) = (difference(ax, cx, &mut g), difference(bx, cx, &mut g));
    let (eacy, ebcy) = (difference(ay, cy, &mut g), difference(by, cy, &mut g));
    let l = mul(&eacx, &ebcy, &mut g);
    let r = mul(&eacy, &ebcx, &mut g);
    let e = sum(&l, &neg(&r), &mut g);
    exact_sign(&e, &g, site)
}

/// sign(det[b - a, c - a, d - a]) (the spike's orient3d convention):
/// Positive when d lies on the side of the normal (b - a) x (c - a).
/// This is the negative of Shewchuk's orient3d(a, b, c, d).
pub fn orient3d(a: P3, b: P3, c: P3, d: P3, site: &'static str) -> Decision {
    let all = [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z];
    check_range(&all, site)?;
    let s = group_scale(&all);
    let (a, b, c, d) = (scaled(a, s), scaled(b, s), scaled(c, s), scaled(d, s));
    // filter: Shewchuk's det[a - d, b - d, c - d] = -det[b - a, c - a, d - a]
    let (adx, ady, adz) = (a.x - d.x, a.y - d.y, a.z - d.z);
    let (bdx, bdy, bdz) = (b.x - d.x, b.y - d.y, b.z - d.z);
    let (cdx, cdy, cdz) = (c.x - d.x, c.y - d.y, c.z - d.z);
    let (bdxcdy, cdxbdy) = (bdx * cdy, cdx * bdy);
    let (cdxady, adxcdy) = (cdx * ady, adx * cdy);
    let (adxbdy, bdxady) = (adx * bdy, bdx * ady);
    // Nine differences, six inner products, three differences, three outer
    // products and two sums. Each monomial has eight rounding factors:
    // three input differences, two products, inner subtraction, two sums.
    // M also has at most eight; absolute losses are amplified by
    // at most two differences (<2 each): total <256 eta.
    let det = adz * (bdxcdy - cdxbdy) + bdz * (cdxady - adxcdy) + cdz * (adxbdy - bdxady);
    let permanent = (bdxcdy.abs() + cdxbdy.abs()) * adz.abs() + (cdxady.abs() + adxcdy.abs()) * bdz.abs() + (adxbdy.abs() + bdxady.abs()) * cdz.abs();
    if let Some(sign) = filtered(det, permanent) {
        return Ok(sign.flip());
    }
    let mut g = Guard::new();
    let (bx, by, bz) = (difference(b.x, a.x, &mut g), difference(b.y, a.y, &mut g), difference(b.z, a.z, &mut g));
    let (cx, cy, cz) = (difference(c.x, a.x, &mut g), difference(c.y, a.y, &mut g), difference(c.z, a.z, &mut g));
    let (dx, dy, dz) = (difference(d.x, a.x, &mut g), difference(d.y, a.y, &mut g), difference(d.z, a.z, &mut g));
    let m1 = {
        let (p, q) = (mul(&cy, &dz, &mut g), mul(&cz, &dy, &mut g));
        sum(&p, &neg(&q), &mut g)
    };
    let m2 = {
        let (p, q) = (mul(&cz, &dx, &mut g), mul(&cx, &dz, &mut g));
        sum(&p, &neg(&q), &mut g)
    };
    let m3 = {
        let (p, q) = (mul(&cx, &dy, &mut g), mul(&cy, &dx, &mut g));
        sum(&p, &neg(&q), &mut g)
    };
    let t1 = mul(&bx, &m1, &mut g);
    let t2 = mul(&by, &m2, &mut g);
    let t3 = mul(&bz, &m3, &mut g);
    let t12 = sum(&t1, &t2, &mut g);
    let e = sum(&t12, &t3, &mut g);
    exact_sign(&e, &g, site)
}

// ---------------------------------------------------------------- vector relations

/// sign(dot(a, b)).
pub fn dot_sign(a: P3, b: P3, site: &'static str) -> Decision {
    check_range(&[a.x, a.y, a.z, b.x, b.y, b.z], site)?;
    let (a, b) = (scaled(a, group_scale(&coords(a))), scaled(b, group_scale(&coords(b))));
    // Three products and two additions: depth 3 for both value and M;
    // no later multiplier. The common bound covers <=5 eta as well.
    let (p, q, r) = (a.x * b.x, a.y * b.y, a.z * b.z);
    if let Some(sign) = filtered(p + q + r, p.abs() + q.abs() + r.abs()) {
        return Ok(sign);
    }
    let mut g = Guard::new();
    let (ex, ey, ez) = (product(a.x, b.x, &mut g), product(a.y, b.y, &mut g), product(a.z, b.z, &mut g));
    let exy = sum(&ex, &ey, &mut g);
    let e = sum(&exy, &ez, &mut g);
    exact_sign(&e, &g, site)
}

/// dot(a, b) == 0 exactly (I.perpendicular_certificate).
pub fn perpendicular(a: P3, b: P3, site: &'static str) -> Result<bool, Undecided> {
    // No additional numerical operation; inherit dot_sign's bound.
    Ok(dot_sign(a, b, site)? == Sign::Zero)
}

/// sign(a*b - c*d) on scaled inputs (exact).
#[inline]
fn product_difference(a: f64, b: f64, c: f64, d: f64, site: &'static str) -> Decision {
    // Two products, one subtraction; M is their absolute sum. Depth 2,
    // <=3 eta, no magnifier: covered by the common bound.
    let (p, q) = (a * b, c * d);
    if let Some(sign) = filtered(p - q, p.abs() + q.abs()) {
        return Ok(sign);
    }
    let mut g = Guard::new();
    let l = product(a, b, &mut g);
    let r = product(c, d, &mut g);
    let e = sum(&l, &neg(&r), &mut g);
    exact_sign(&e, &g, site)
}

/// cross(a, b) == 0 componentwise, exactly (I.exact_parallel). A zero vector is
/// parallel to everything.
pub fn parallel(a: P3, b: P3, site: &'static str) -> Result<bool, Undecided> {
    check_range(&[a.x, a.y, a.z, b.x, b.y, b.z], site)?;
    let (a, b) = (scaled(a, group_scale(&coords(a))), scaled(b, group_scale(&coords(b))));
    // Three audited product differences; no numerical operation on their signs.
    Ok(product_difference(a.y, b.z, a.z, b.y, site)? == Sign::Zero
        && product_difference(a.z, b.x, a.x, b.z, site)? == Sign::Zero
        && product_difference(a.x, b.y, a.y, b.x, site)? == Sign::Zero)
}
