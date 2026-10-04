//! K0 property tests (docs/rust-migration.md 6): every exact predicate of
//! wonky-num against an exact rational reference (num-rational BigRational;
//! every f64 converts exactly), per predicate random cases until 1_000_000 are
//! decided (refusals are checked and counted on top) and 100_000
//! near-degenerate cases; every operand is drawn from CAD scale, the whole
//! range policy, uniform random finite bit patterns (subnormal to f64::MAX) and
//! out-of-range values, including signed zeros, subnormals, values just
//! outside the range policy, NaN and infinities.
//!
//! For every case:
//! - a decided result must equal the reference sign (all three signs occur),
//! - an input outside the range policy must be refused as OutOfRange (and only then),
//! - NotExact is allowed only for wide-magnitude inputs, never for CAD-scale
//!   inputs (all nonzero |x| in [1e-7, 1e10]).
//!
//! Run: cargo test --release -p wonky-num --test properties -- --nocapture

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{Signed, Zero};
use wonky_num::*;

const N_RANDOM: usize = 1_000_000;
const N_NEAR: usize = 100_000;

// ---------------------------------------------------------------- reference

fn q(x: f64) -> BigRational {
    BigRational::from_float(x).expect("finite")
}
fn rsign(x: &BigRational) -> Sign {
    if x.is_zero() {
        Sign::Zero
    } else if x.is_positive() {
        Sign::Positive
    } else {
        Sign::Negative
    }
}
fn qv(p: P3) -> [BigRational; 3] {
    [q(p.x), q(p.y), q(p.z)]
}
fn qdot(a: &[BigRational; 3], b: &[BigRational; 3]) -> BigRational {
    &a[0] * &b[0] + &a[1] * &b[1] + &a[2] * &b[2]
}
// The sign oracles below run millions of times on operands spanning 2^-1074..2^1023,
// where BigRational reduces (gcd) after every operation and that gcd dominated the
// whole suite (num_bigint gcd/shift/sub, over 99 % of the samples). Every f64 is
// m * 2^e with integer m, so products and differences stay exact as dyadic integers
// (BigInt mantissa, binary exponent) without any reduction, and the sign of the
// mantissa is the sign of the value. Same exact arithmetic, same answers.
#[derive(Clone)]
struct Dy {
    m: BigInt,
    e: i32,
}
impl Dy {
    fn from_f64(x: f64) -> Dy {
        assert!(x.is_finite(), "finite");
        let bits = x.to_bits();
        let (biased, frac) = (((bits >> 52) & 0x7ff) as i32, bits & ((1u64 << 52) - 1));
        let (mantissa, e) = if biased == 0 { (frac, -1074) } else { (frac | (1u64 << 52), biased - 1075) };
        let m = BigInt::from(mantissa);
        Dy { m: if bits >> 63 == 1 { -m } else { m }, e }
    }
    fn is_zero(&self) -> bool {
        self.m.is_zero()
    }
    fn sign(&self) -> Sign {
        if self.m.is_zero() {
            Sign::Zero
        } else if self.m.is_positive() {
            Sign::Positive
        } else {
            Sign::Negative
        }
    }
    fn mul(&self, o: &Dy) -> Dy {
        Dy { m: &self.m * &o.m, e: self.e + o.e }
    }
    fn add(&self, o: &Dy) -> Dy {
        let e = self.e.min(o.e);
        Dy { m: (&self.m << (self.e - e) as usize) + (&o.m << (o.e - e) as usize), e }
    }
    fn sub(&self, o: &Dy) -> Dy {
        let e = self.e.min(o.e);
        Dy { m: (&self.m << (self.e - e) as usize) - (&o.m << (o.e - e) as usize), e }
    }
}
fn dv(p: P3) -> [Dy; 3] {
    [Dy::from_f64(p.x), Dy::from_f64(p.y), Dy::from_f64(p.z)]
}
fn ddot(a: &[Dy; 3], b: &[Dy; 3]) -> Dy {
    a[0].mul(&b[0]).add(&a[1].mul(&b[1])).add(&a[2].mul(&b[2]))
}
fn dsub(a: &[Dy; 3], b: &[Dy; 3]) -> [Dy; 3] {
    [a[0].sub(&b[0]), a[1].sub(&b[1]), a[2].sub(&b[2])]
}
/// x*y - z*w
fn dcross(x: &Dy, y: &Dy, z: &Dy, w: &Dy) -> Dy {
    x.mul(y).sub(&z.mul(w))
}
fn ref_plane(n: P3, p: P3, o: P3) -> Sign {
    ddot(&dv(n), &dsub(&dv(p), &dv(o))).sign()
}
fn ref_orient2d(a: P2, b: P2, c: P2) -> Sign {
    let (ax, ay, bx, by, cx, cy) = (Dy::from_f64(a.x), Dy::from_f64(a.y), Dy::from_f64(b.x), Dy::from_f64(b.y), Dy::from_f64(c.x), Dy::from_f64(c.y));
    dcross(&bx.sub(&ax), &cy.sub(&ay), &by.sub(&ay), &cx.sub(&ax)).sign()
}
fn ref_orient3d(a: P3, b: P3, c: P3, d: P3) -> Sign {
    let da = dv(a);
    let [bx, by, bz] = dsub(&dv(b), &da);
    let [cx, cy, cz] = dsub(&dv(c), &da);
    let [dx, dy, dz] = dsub(&dv(d), &da);
    bx.mul(&dcross(&cy, &dz, &cz, &dy)).add(&by.mul(&dcross(&cz, &dx, &cx, &dz))).add(&bz.mul(&dcross(&cx, &dy, &cy, &dx))).sign()
}
fn ref_dot_sign(a: P3, b: P3) -> Sign {
    ddot(&dv(a), &dv(b)).sign()
}
fn ref_perpendicular(a: P3, b: P3) -> bool {
    ddot(&dv(a), &dv(b)).is_zero()
}
fn ref_parallel(a: P3, b: P3) -> bool {
    let (qa, qb) = (dv(a), dv(b));
    dcross(&qa[1], &qb[2], &qa[2], &qb[1]).is_zero() && dcross(&qa[2], &qb[0], &qa[0], &qb[2]).is_zero() && dcross(&qa[0], &qb[1], &qa[1], &qb[0]).is_zero()
}
fn ref_line_point(n: P3, dir: P3, origin: P3, point: P3, t: f64) -> Sign {
    let qn = dv(n);
    ddot(&qn, &dsub(&dv(origin), &dv(point))).add(&Dy::from_f64(t).mul(&ddot(&qn, &dv(dir)))).sign()
}
fn ref_segment(n: P3, o: P3, a: P3, b: P3) -> SegmentPlane {
    match (ref_plane(n, a, o), ref_plane(n, b, o)) {
        (Sign::Zero, Sign::Zero) => SegmentPlane::InPlane,
        (Sign::Zero, s) => SegmentPlane::TouchesAtStart(s),
        (s, Sign::Zero) => SegmentPlane::TouchesAtEnd(s),
        (x, y) if x == y => SegmentPlane::Disjoint(x),
        _ => SegmentPlane::Crossing,
    }
}

/// The range policy, stated independently of wonky_num::in_range.
fn policy_ok(x: f64) -> bool {
    x == 0.0 || (x.is_normal() && x.abs() >= 1.0e-150 && x.abs() <= 1.0e150)
}
fn cad_only(xs: &[f64]) -> bool {
    xs.iter().all(|x| *x == 0.0 || (x.abs() >= 1.0e-7 && x.abs() <= 1.0e10))
}

// ---------------------------------------------------------------- generators

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn sgn(&mut self) -> f64 {
        if self.next() & 1 == 0 {
            1.0
        } else {
            -1.0
        }
    }
    /// CAD scale: signed zeros, small integers, dyadics, decimals, 1e4, 1e9 and 1e-6 scales.
    fn cad(&mut self) -> f64 {
        let s = self.sgn();
        match self.below(8) {
            0 => s * 0.0,
            1 => s * self.below(200) as f64,
            2 => s * self.below(4096) as f64 / 64.0,
            3 => s * (self.below(100000) as f64 * 0.001),
            4 => s * self.unit() * 1.0e4,
            5 => s * self.unit() * 1.0e9,
            6 => s * (1.0 + self.unit()) * 1.0e-6,
            _ => s * self.below(7) as f64,
        }
    }
    /// Anywhere inside the range policy, including its exact boundaries.
    fn wide(&mut self) -> f64 {
        let s = self.sgn();
        match self.below(10) {
            0 => s * 1.0e-150,
            1 => s * 1.0e150,
            _ => s * (1.0 + self.unit()) * 10f64.powi(self.below(299) as i32 - 150),
        }
    }
    /// Outside the range policy: subnormals, too small/large normals, infinities, NaN.
    fn bad(&mut self) -> f64 {
        const BAD: [f64; 14] = [
            5.0e-324,
            -5.0e-324,
            2.225e-308,
            -1.0e-310,
            1.0e-151,
            -1.0e-160,
            f64::MIN_POSITIVE,
            1.0e151,
            -1.0e200,
            f64::MAX,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
            -f64::NAN,
        ];
        let x = BAD[self.below(BAD.len() as u64) as usize];
        match self.below(3) {
            0 => 1.0e-150f64.next_down(),
            1 => 1.0e150f64.next_up(),
            _ => x,
        }
    }
    /// Uniform over all finite f64 bit patterns: every exponent from subnormal to
    /// f64::MAX, both signs (NaN/infinity patterns are redrawn; bad() has those).
    fn full(&mut self) -> f64 {
        loop {
            let x = f64::from_bits(self.next());
            if x.is_finite() {
                return x;
            }
        }
    }
    /// Random mixture: 88 % CAD scale, 8 % anywhere in range, 2 % out of range,
    /// 2 % anywhere in the whole f64 range.
    fn any(&mut self) -> f64 {
        match self.below(100) {
            0..=87 => self.cad(),
            88..=95 => self.wide(),
            96..=97 => self.bad(),
            _ => self.full(),
        }
    }
    fn vec_any(&mut self) -> P3 {
        v3(self.any(), self.any(), self.any())
    }
    fn vec_cad(&mut self) -> P3 {
        v3(self.cad(), self.cad(), self.cad())
    }
    fn small_vec(&mut self) -> P3 {
        v3(self.below(64) as f64, self.below(64) as f64 - 32.0, self.below(64) as f64)
    }
    /// x moved by -3..=3 ulps; an exact zero stays zero but may change its sign.
    fn ulps(&mut self, x: f64) -> f64 {
        if x == 0.0 {
            return self.sgn() * 0.0;
        }
        let mut y = x;
        let k = self.below(7) as i32 - 3;
        for _ in 0..k.abs() {
            y = if k > 0 { y.next_up() } else { y.next_down() };
        }
        y
    }
    fn wiggle(&mut self, p: P3) -> P3 {
        v3(self.ulps(p.x), self.ulps(p.y), self.ulps(p.z))
    }
    /// 2^k with k in [-400, 400]: keeps a degenerate configuration exactly
    /// degenerate while moving it across the whole range.
    fn pow2(&mut self) -> f64 {
        2f64.powi(self.below(801) as i32 - 400)
    }
}

fn sc(p: P3, s: f64) -> P3 {
    v3(p.x * s, p.y * s, p.z * s)
}

/// In-plane directions of n (exact for small integer n).
fn in_plane(n: P3) -> (P3, P3) {
    let a = if n.x.abs() < 0.5 * n.magnitude() { v3(0.0, -n.z, n.y) } else { v3(-n.y, n.x, 0.0) };
    (a, n.cross(a))
}
/// A point on the plane through o with normal n: exact for small integer n and o.
fn on_plane(r: &mut Rng, o: P3, n: P3) -> P3 {
    let (a, b) = in_plane(n);
    let (s, t) = (r.below(64) as f64 / 8.0 - 4.0, r.below(64) as f64 / 8.0 - 4.0);
    o.add(a.scale(s)).add(b.scale(t))
}

// ---------------------------------------------------------------- bookkeeping

#[derive(Default)]
struct Stats {
    decided: usize,
    classes: std::collections::BTreeMap<String, usize>,
    out_of_range: usize,
    not_exact: usize,
}

impl Stats {
    fn record<T: PartialEq + std::fmt::Debug>(&mut self, inputs: &[f64], got: Result<T, Undecided>, reference: impl FnOnce() -> T, what: impl Fn() -> String) {
        let oor = inputs.iter().any(|x| !policy_ok(*x));
        match got {
            Ok(value) => {
                assert!(!oor, "decided {value:?} although an input is out of range: {}", what());
                let expected = reference();
                assert_eq!(value, expected, "wrong result for {}", what());
                self.decided += 1;
                *self.classes.entry(format!("{value:?}")).or_default() += 1;
            }
            Err(u) => {
                let refusal = u.into_refusal();
                if oor {
                    assert_eq!(refusal.kind, UndecidedKind::OutOfRange, "{}", what());
                    self.out_of_range += 1;
                } else {
                    assert_eq!(refusal.kind, UndecidedKind::NotExact, "in-range input refused as {:?}: {}", refusal.kind, what());
                    assert!(!cad_only(inputs), "NotExact on CAD-scale input: {}", what());
                    self.not_exact += 1;
                }
            }
        }
    }
    fn report(&self, name: &str) {
        eprintln!(
            "{name}: {} decided (0 mismatches) {:?}; {} refused OutOfRange; {} refused NotExact",
            self.decided, self.classes, self.out_of_range, self.not_exact
        );
    }
    fn count(&self, class: &str) -> usize {
        self.classes.get(class).copied().unwrap_or(0)
    }
}

fn flat(ps: &[P3]) -> Vec<f64> {
    ps.iter().flat_map(|p| [p.x, p.y, p.z]).collect()
}

// ---------------------------------------------------------------- plane side and segment/plane

#[test]
fn plane_side_random_and_near_degenerate() {
    let mut r = Rng(0x9E3779B97F4A7C15);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (n, p, o) = (r.vec_any(), r.vec_any(), r.vec_any());
        random.record(&flat(&[n, p, o]), plane_side(n, p, o, "test"), || ref_plane(n, p, o), || format!("n={n:?} p={p:?} o={o:?}"));
    }
    random.report("plane_side random");
    let mut near = Stats::default();
    for i in 0..N_NEAR {
        let small = i % 2 == 0;
        let n = if small { v3(r.below(5) as f64 - 2.0, r.below(5) as f64 - 2.0, 1.0) } else { r.vec_cad() };
        let o = if small { r.small_vec() } else { r.vec_cad() };
        let p = match i % 4 {
            0 => on_plane(&mut r, o, n),
            1 | 2 => {
                let p = on_plane(&mut r, o, n);
                r.wiggle(p)
            }
            _ => r.wiggle(o),
        };
        let (n, p, o) = if i % 3 == 0 {
            let (sn, sp) = (r.pow2(), r.pow2());
            (sc(n, sn), sc(p, sp), sc(o, sp))
        } else {
            (n, p, o)
        };
        near.record(&flat(&[n, p, o]), plane_side(n, p, o, "test"), || ref_plane(n, p, o), || format!("n={n:?} p={p:?} o={o:?}"));
    }
    near.report("plane_side near-degenerate");
    for s in [&random, &near] {
        assert!(s.count("Positive") > 0 && s.count("Negative") > 0);
    }
    assert!(random.out_of_range > 0, "the random suite must exercise the range policy");
    assert!(near.count("Zero") > N_NEAR / 10, "the near-degenerate suite must produce exact zeros");
}

#[test]
fn segment_plane_random_and_near_degenerate() {
    let mut r = Rng(0x94D049BB133111EB);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (n, o, a, b) = (r.vec_any(), r.vec_any(), r.vec_any(), r.vec_any());
        random.record(&flat(&[n, o, a, b]), segment_plane(n, o, a, b, "test"), || ref_segment(n, o, a, b), || format!("n={n:?} o={o:?} a={a:?} b={b:?}"));
    }
    random.report("segment_plane random");
    let mut near = Stats::default();
    for i in 0..N_NEAR {
        let n = if i % 2 == 0 { v3(r.below(5) as f64 - 2.0, 1.0, r.below(3) as f64) } else { r.vec_cad() };
        let o = if i % 2 == 0 { r.small_vec() } else { r.vec_cad() };
        let end = |r: &mut Rng| match r.below(4) {
            0 => on_plane(r, o, n),
            1 => {
                let p = on_plane(r, o, n);
                r.wiggle(p)
            }
            2 => r.wiggle(o),
            _ => r.vec_cad(),
        };
        let (a, b) = (end(&mut r), end(&mut r));
        near.record(&flat(&[n, o, a, b]), segment_plane(n, o, a, b, "test"), || ref_segment(n, o, a, b), || format!("n={n:?} o={o:?} a={a:?} b={b:?}"));
    }
    near.report("segment_plane near-degenerate");
    for class in ["InPlane", "Crossing"] {
        assert!(near.count(class) > 0, "no {class} case");
    }
    assert!(near.classes.keys().any(|k| k.starts_with("TouchesAtStart")) && near.classes.keys().any(|k| k.starts_with("Disjoint")));
    assert!(random.out_of_range > 0);
}

#[test]
fn line_point_side_random_and_near_degenerate() {
    let mut r = Rng(0x9FB21C651E98DF25);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (n, d, o, p, t) = (r.vec_any(), r.vec_any(), r.vec_any(), r.vec_any(), r.any());
        let mut inputs = flat(&[n, d, o, p]);
        inputs.push(t);
        random.record(&inputs, line_point_side(n, d, o, p, t, "test"), || ref_line_point(n, d, o, p, t), || format!("n={n:?} d={d:?} o={o:?} p={p:?} t={t:?}"));
    }
    random.report("line_point_side random");
    let mut near = Stats::default();
    for i in 0..N_NEAR {
        let small = i % 2 == 0;
        let n = if small { v3(r.below(5) as f64 - 2.0, 1.0, r.below(3) as f64) } else { r.vec_cad() };
        let point = if small { v3(r.below(64) as f64, r.below(64) as f64, 0.5) } else { r.vec_cad() };
        let d = if small { v3(r.below(9) as f64 - 4.0, 1.0, 0.25) } else { r.vec_cad() };
        let t = [0.0, 1.0, -2.5, 0.375, 1024.0][i % 5];
        let on = on_plane(&mut r, point, n);
        let origin = if i % 4 < 2 { on.sub(d.scale(t)) } else { r.wiggle(on.sub(d.scale(t))) };
        let (n, d, origin, point) = if i % 3 == 0 {
            let (sn, sp) = (r.pow2(), r.pow2());
            (sc(n, sn), sc(d, sp), sc(origin, sp), sc(point, sp))
        } else {
            (n, d, origin, point)
        };
        let mut inputs = flat(&[n, d, origin, point]);
        inputs.push(t);
        near.record(&inputs, line_point_side(n, d, origin, point, t, "test"), || ref_line_point(n, d, origin, point, t), || format!("n={n:?} d={d:?} o={origin:?} p={point:?} t={t:?}"));
    }
    near.report("line_point_side near-degenerate");
    assert!(near.count("Zero") > N_NEAR / 10 && near.count("Positive") > 0 && near.count("Negative") > 0);
    assert!(random.out_of_range > 0);
}

// ---------------------------------------------------------------- orientation

#[test]
fn orient2d_random_and_near_degenerate() {
    let mut r = Rng(0xBF58476D1CE4E5B9);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (a, b, c) = (p2(r.any(), r.any()), p2(r.any(), r.any()), p2(r.any(), r.any()));
        random.record(&[a.x, a.y, b.x, b.y, c.x, c.y], orient2d(a, b, c, "test"), || ref_orient2d(a, b, c), || format!("a={a:?} b={b:?} c={c:?}"));
    }
    random.report("orient2d random");
    let mut near = Stats::default();
    for i in 0..N_NEAR {
        let small = i % 2 == 0;
        let pick = |r: &mut Rng| if small { p2(r.below(64) as f64 - 32.0, r.below(64) as f64) } else { p2(r.cad(), r.cad()) };
        let (a, b) = (pick(&mut r), pick(&mut r));
        let t = r.below(32) as f64 / 8.0 - 2.0;
        let c0 = p2(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
        let c = if i % 4 < 2 { c0 } else { p2(r.ulps(c0.x), r.ulps(c0.y)) };
        let s = if i % 3 == 0 { r.pow2() } else { 1.0 };
        let (a, b, c) = (p2(a.x * s, a.y * s), p2(b.x * s, b.y * s), p2(c.x * s, c.y * s));
        near.record(&[a.x, a.y, b.x, b.y, c.x, c.y], orient2d(a, b, c, "test"), || ref_orient2d(a, b, c), || format!("a={a:?} b={b:?} c={c:?}"));
    }
    near.report("orient2d near-degenerate");
    assert!(near.count("Zero") > N_NEAR / 10 && near.count("Positive") > 0 && near.count("Negative") > 0);
    assert!(random.out_of_range > 0);
}

#[test]
fn orient3d_random_and_near_degenerate() {
    let mut r = Rng(0x2545F4914F6CDD1D);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (a, b, c, d) = (r.vec_any(), r.vec_any(), r.vec_any(), r.vec_any());
        random.record(&flat(&[a, b, c, d]), orient3d(a, b, c, d, "test"), || ref_orient3d(a, b, c, d), || format!("{a:?} {b:?} {c:?} {d:?}"));
    }
    random.report("orient3d random");
    let mut near = Stats::default();
    for i in 0..N_NEAR {
        let small = i % 2 == 0;
        let pick = |r: &mut Rng| if small { r.small_vec() } else { r.vec_cad() };
        let (a, b) = (pick(&mut r), pick(&mut r));
        let c = if i % 3 == 0 { a.add(b.sub(a).scale(0.5)) } else { pick(&mut r) };
        let (t, s) = (r.below(16) as f64 / 4.0 - 2.0, r.below(16) as f64 / 4.0 - 2.0);
        let d0 = a.add(b.sub(a).scale(t)).add(c.sub(a).scale(s));
        let d = if i % 4 < 2 { d0 } else { r.wiggle(d0) };
        let k = if i % 5 == 0 { r.pow2() } else { 1.0 };
        let (a, b, c, d) = (sc(a, k), sc(b, k), sc(c, k), sc(d, k));
        near.record(&flat(&[a, b, c, d]), orient3d(a, b, c, d, "test"), || ref_orient3d(a, b, c, d), || format!("{a:?} {b:?} {c:?} {d:?}"));
    }
    near.report("orient3d near-degenerate");
    assert!(near.count("Zero") > N_NEAR / 10 && near.count("Positive") > 0 && near.count("Negative") > 0);
    assert!(random.out_of_range > 0);
}

// ---------------------------------------------------------------- vector relations

#[test]
fn dot_sign_and_perpendicular_random_and_near_degenerate() {
    let mut r = Rng(0xD1B54A32D192ED03);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (a, b) = (r.vec_any(), r.vec_any());
        let reference = || ref_dot_sign(a, b);
        random.record(&flat(&[a, b]), dot_sign(a, b, "test"), reference, || format!("a={a:?} b={b:?}"));
    }
    random.report("dot_sign random");
    let mut near = Stats::default();
    let mut perp = Stats::default();
    for i in 0..N_NEAR {
        let a = if i % 2 == 0 { r.small_vec() } else { r.vec_cad() };
        let w = v3(r.below(7) as f64, r.below(7) as f64 - 3.0, 1.0);
        let b0 = a.cross(w);
        let b = if i % 4 < 2 { b0 } else { r.wiggle(b0) };
        let (a, b) = if i % 3 == 0 { (sc(a, r.pow2()), sc(b, r.pow2())) } else { (a, b) };
        near.record(&flat(&[a, b]), dot_sign(a, b, "test"), || ref_dot_sign(a, b), || format!("a={a:?} b={b:?}"));
        perp.record(&flat(&[a, b]), perpendicular(a, b, "test"), || ref_perpendicular(a, b), || format!("a={a:?} b={b:?}"));
    }
    near.report("dot_sign near-degenerate");
    perp.report("perpendicular near-degenerate");
    assert!(near.count("Zero") > N_NEAR / 10 && near.count("Positive") > 0 && near.count("Negative") > 0);
    assert!(perp.count("true") > 0 && perp.count("false") > 0);
    assert!(random.out_of_range > 0);
}

#[test]
fn parallel_random_and_near_degenerate() {
    let mut r = Rng(0xA0761D6478BD642F);
    let mut random = Stats::default();
    while random.decided < N_RANDOM {
        let (a, b) = (r.vec_any(), r.vec_any());
        random.record(&flat(&[a, b]), parallel(a, b, "test"), || ref_parallel(a, b), || format!("a={a:?} b={b:?}"));
    }
    random.report("parallel random");
    let mut near = Stats::default();
    for i in 0..N_NEAR {
        let a = if i % 2 == 0 { r.small_vec() } else { r.vec_cad() };
        let k = [0.5, 2.0, -3.0, 0.125, 1.0, -1.0][i % 6];
        let b0 = a.scale(k);
        let b = if i % 4 < 2 { b0 } else { r.wiggle(b0) };
        let (a, b) = if i % 3 == 0 { (sc(a, r.pow2()), sc(b, r.pow2())) } else { (a, b) };
        near.record(&flat(&[a, b]), parallel(a, b, "test"), || ref_parallel(a, b), || format!("a={a:?} b={b:?}"));
    }
    near.report("parallel near-degenerate");
    assert!(near.count("true") > N_NEAR / 10 && near.count("false") > 0);
    assert!(random.count("true") > 0 && random.out_of_range > 0);
}

// ---------------------------------------------------------------- targeted cases

/// Signed zeros and exact zero results give Zero, never a signed answer.
#[test]
fn signed_zeros() {
    let z = v3(-0.0, 0.0, -0.0);
    assert_eq!(plane_side(v3(0.0, 0.0, 1.0), z, v3(0.0, -0.0, 0.0), "t").unwrap(), Sign::Zero);
    assert_eq!(plane_side(v3(-0.0, -0.0, -0.0), v3(1.0, 2.0, 3.0), z, "t").unwrap(), Sign::Zero);
    assert_eq!(orient2d(p2(-0.0, 0.0), p2(1.0, -0.0), p2(2.0, 0.0), "t").unwrap(), Sign::Zero);
    assert_eq!(orient3d(z, v3(1.0, 0.0, -0.0), v3(0.0, 1.0, 0.0), v3(-0.0, 0.0, 1.0), "t").unwrap(), Sign::Positive);
    assert!(parallel(z, v3(1.0, 2.0, 3.0), "t").unwrap());
    assert!(perpendicular(z, v3(1.0, 2.0, 3.0), "t").unwrap());
    assert_eq!(dot_sign(v3(-0.0, 1.0, 0.0), v3(5.0, -0.0, 3.0), "t").unwrap(), Sign::Zero);
}

/// The decision spike's exact::side ran its filter before its range check and
/// returned an exact zero when all products underflowed (m == 0): for
/// n = p - o = (1e-200, 0, 0) it certified "on the plane" although the true
/// value is 1e-400. wonky-num refuses such inputs by name.
#[test]
fn underflowing_products_are_refused_not_zero() {
    let got = plane_side(v3(1.0e-200, 0.0, 0.0), v3(1.0e-200, 0.0, 0.0), v3(0.0, 0.0, 0.0), "spike-underflow");
    let refusal = got.unwrap_err().into_refusal();
    assert_eq!((refusal.site, refusal.kind), ("spike-underflow", UndecidedKind::OutOfRange));
}

/// Regression of the independent spike verification (tmp/rust-spike-verify,
/// predcheck case 5): the spike's exact::side(n, a, o) returned 0 ("on the
/// plane") for n = o = (1e-320, 0, 0), a = (2e-320, 0, 0), because the products
/// underflow to 0 and its filter ran before its range gate; the exact sign is
/// +1. Here every predicate refuses subnormal operands by name, whichever
/// operand carries them.
#[test]
fn spike_subnormal_repro_is_refused() {
    let (n, o, a) = (v3(1.0e-320, 0.0, 0.0), v3(1.0e-320, 0.0, 0.0), v3(2.0e-320, 0.0, 0.0));
    assert_eq!(ref_plane(n, a, o), Sign::Positive);
    let refused = |r: Result<Sign, Undecided>| r.unwrap_err().into_refusal().kind;
    assert_eq!(refused(plane_side(n, a, o, "repro")), UndecidedKind::OutOfRange);
    assert_eq!(refused(plane_side(v3(1.0, 0.0, 0.0), a, o, "repro")), UndecidedKind::OutOfRange);
    assert_eq!(refused(dot_sign(n, a, "repro")), UndecidedKind::OutOfRange);
    assert_eq!(perpendicular(n, a, "repro").unwrap_err().into_refusal().kind, UndecidedKind::OutOfRange);
    assert_eq!(parallel(n, v3(0.0, 1.0e-320, 0.0), "repro").unwrap_err().into_refusal().kind, UndecidedKind::OutOfRange);
    assert_eq!(refused(orient3d(o, a, v3(0.0, 1.0, 0.0), v3(0.0, 0.0, 1.0), "repro")), UndecidedKind::OutOfRange);
    assert_eq!(refused(orient2d(p2(1.0e-320, 0.0), p2(1.0, 0.0), p2(0.0, 1.0), "repro")), UndecidedKind::OutOfRange);
}

/// Inputs at both ends of the range in one predicate: exact or NotExact, never wrong.
#[test]
fn extreme_dynamic_range_is_exact_or_refused() {
    let tiny = 1.0e-150;
    let cases = [
        (v3(1.0e150, 1.0e150, 0.0), v3(tiny, 1.0, 0.0), v3(1.0, 1.0, 1.0), v3(tiny, tiny, tiny)),
        (v3(1.0e150, 0.0, 0.0), v3(0.0, 1.0e150, 0.0), v3(0.0, 0.0, 1.0e150), v3(tiny, tiny, tiny)),
        (v3(tiny, 0.0, 0.0), v3(0.0, tiny, 0.0), v3(0.0, 0.0, tiny), v3(1.0e150, -1.0e150, 1.0e150)),
    ];
    let (mut exact, mut refused) = (0, 0);
    for (a, b, c, d) in cases {
        match orient3d(a, b, c, d, "extreme") {
            Ok(s) => {
                assert_eq!(s, ref_orient3d(a, b, c, d));
                exact += 1;
            }
            Err(u) => {
                assert_eq!(u.into_refusal().kind, UndecidedKind::NotExact);
                refused += 1;
            }
        }
    }
    eprintln!("extreme_dynamic_range: {exact} exact, {refused} NotExact");
}

/// In range, but the exact evaluation needs a product below 2^-960
/// (n.y * dy ~ 4e-304 after scaling): NotExact, and segment_plane propagates
/// exactly that refusal from its start point instead of guessing a side.
#[test]
fn not_exact_is_refused_and_propagated() {
    let (n, p, o) = (v3(1.0e150, 1.0e-150, 0.0), v3(1.0, 1.0e-3, 0.0), v3(1.0, 0.0, 0.0));
    assert_eq!(plane_side(n, p, o, "tiny").unwrap_err().into_refusal().kind, UndecidedKind::NotExact);
    let got = segment_plane(n, o, p, v3(1.0, -1.0, 0.0), "segment-start");
    let refusal = got.unwrap_err().into_refusal();
    assert_eq!((refusal.site, refusal.kind), ("segment-start", UndecidedKind::NotExact));
}

/// A swallowed Undecided (dropped without into_refusal) is a loud failure.
#[test]
#[should_panic(expected = "swallowed decision")]
fn swallowed_undecided_panics() {
    let _ = plane_side(v3(f64::NAN, 0.0, 1.0), v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 0.0), "swallow").unwrap_or(Sign::Zero);
}

// ---------------------------------------------------------------- ball arithmetic (from the spike's S1, Result API)

/// Every ball operation encloses the exact result (sqrt checked by squares).
#[test]
fn ball_arithmetic_encloses() {
    let mut r = Rng(0xE7037ED1A0B428DB);
    let inside = |x: &BigRational, v: Iv| q(v.lo()) <= *x && *x <= q(v.hi());
    for i in 0..N_NEAR {
        let (a, b, c) = (r.cad(), r.cad(), r.cad());
        let (ia, ib, ic) = (Iv::point(a), Iv::point(b), Iv::point(c));
        let e1 = (ia + ib) * ic - ia * ib;
        let x1 = (q(a) + q(b)) * q(c) - q(a) * q(b);
        assert!(inside(&x1, e1), "e1 {a} {b} {c}: {e1:?}");
        if b != 0.0 && c != 0.0 {
            let e2 = (ia - ic) / ib + e1 / ic;
            let x2 = (q(a) - q(c)) / q(b) + x1.clone() / q(c);
            assert!(inside(&x2, e2), "e2 {a} {b} {c}: {e2:?}");
        }
        let s = (ia * ia + ib * ib).sqrt();
        let x = q(a) * q(a) + q(b) * q(b);
        let (lo, hi) = (q(s.lo().max(0.0)), q(s.hi()));
        assert!(lo.clone() * lo <= x && x <= hi.clone() * hi, "sqrt {a} {b}: {s:?}");
        let m = v3(a, b, c).iv().magnitude();
        let xm = [q(a).abs(), q(b).abs(), q(c).abs()].into_iter().max().unwrap();
        assert!(inside(&xm, m), "magnitude {i}");
        // decide agrees with the exact sign whenever it decides
        match decide(e1, "ball") {
            Ok(sign) => assert_eq!(sign, rsign(&x1), "decide {a} {b} {c}"),
            Err(u) => assert_eq!(u.into_refusal().kind, UndecidedKind::Unresolved),
        }
    }
    eprintln!("ball_arithmetic_encloses: {N_NEAR} cases x 4 expressions, all enclosed");
}

/// |dot(p - o, n)| / |n| against a margin: decided outcomes of `lt` equal the
/// exact comparison; undecided ones lie within a few ulps of the threshold.
#[test]
fn clear_margin_decisions() {
    let mut r = Rng(0x8CB92BA72F3D8DD7);
    let (mut decided, mut undecided, mut widest) = (0, 0, 0.0f64);
    for i in 0..N_NEAR {
        let n = if i % 2 == 0 { v3(1.0, r.below(3) as f64, 0.0) } else { r.vec_cad() };
        if n.magnitude() == 0.0 {
            continue;
        }
        let o = r.vec_cad();
        let margin = [1.0e-5, 1.0e-9, 0.001][i % 3];
        let unit = n.normalize();
        let k = 1.0 + (r.below(5) as f64 - 2.0) * f64::EPSILON * 4.0;
        let base = on_plane(&mut r, o, n).add(unit.scale(margin * k));
        let p = r.wiggle(base);
        let d = p.iv().sub(o.iv()).dot(n.iv().normalize());
        let (qp, qo, qn) = (qv(p), qv(o), qv(n));
        let dot = qdot(&qp, &qn) - qdot(&qo, &qn);
        let reference = dot.clone() * dot > q(margin) * q(margin) * qdot(&qn, &qn);
        match lt(Iv::point(margin), d.abs(), "margin") {
            Ok(got) => {
                assert_eq!(got, reference, "margin decision p={p:?} o={o:?} n={n:?} margin={margin}");
                decided += 1;
            }
            Err(u) => {
                assert_eq!(u.into_refusal().kind, UndecidedKind::Unresolved);
                undecided += 1;
                let dot = num_traits::ToPrimitive::to_f64(&(qdot(&qp, &qn) - qdot(&qo, &qn))).unwrap();
                let gap = (dot.abs() / n.length() - margin).abs();
                let ulps = gap / (f64::EPSILON * (p.magnitude() + o.magnitude() + margin));
                widest = widest.max(ulps);
                assert!(ulps < 64.0, "undecided {ulps} ulps from the threshold");
            }
        }
    }
    eprintln!("clear_margin_decisions: {decided} decided (0 mismatches), {undecided} Unresolved, all within {widest:.1} coordinate ulps of the threshold");
    assert!(decided > N_NEAR / 3);
}

// F1: the original mostly-CAD mixture rarely put ALL operands at adversarial
// scales. Every case here is in range, every operand role samples every binary
// exponent -498..498, and each predicate gets 1,000,000 rational comparisons.
// Countermetric is named refusal count, reported separately from decisions.
#[test]
fn all_predicates_full_range_adversarial() {
    fn wide(r: &mut Rng) -> f64 {
        let sign = r.sgn();
        match r.below(12) {
            0 => sign * 0.0,
            1 => sign * 1e-150,
            2 => sign * 1e150,
            _ => {
                let e = r.below(997) as i32 - 498;
                let power = 2f64.powi(e);
                let x = match r.below(4) {
                    0 => power,
                    1 => power.next_up(),
                    2 => power.next_down(),
                    _ => power * (1.0 + r.unit()),
                };
                sign * x.clamp(1e-150, 1e150)
            }
        }
    }
    fn vec(r: &mut Rng) -> P3 {
        v3(wide(r), wide(r), wide(r))
    }
    fn wiggle(x: f64) -> f64 {
        if x == 0.0 {
            x
        } else {
            x.next_up().signum() * x.next_up().abs().clamp(1e-150, 1e150)
        }
    }
    let mut rng = Rng(0xb84e8dec917028e1);
    let mut stats: [Stats; 8] = std::array::from_fn(|_| Stats::default());
    for i in 0..1_000_000 {
        let (mut a, mut b, mut c, mut d) = (vec(&mut rng), vec(&mut rng), vec(&mut rng), vec(&mut rng));
        let t = wide(&mut rng);
        match i % 8 {
            // Exact degeneracies, then one-ulp perturbations. Independent
            // groups retain their independently chosen full-range magnitudes.
            0 => b = a,
            1 => {
                b = a;
                b.x = wiggle(b.x);
            }
            2 => d = c,
            3 => {
                d = c;
                d.z = wiggle(d.z);
            }
            4 => {
                b = v3(-a.y, a.x, 0.0);
                a.z = 0.0;
            }
            5 => {
                b = v3(-a.y, wiggle(a.x), 0.0);
                a.z = 0.0;
            }
            6 => {
                c = v3(0.0, 0.0, 0.0);
                d = c;
            }
            _ => {}
        }
        let input = flat(&[a, b, c, d]);
        let desc = || format!("case={i} a={a:?} b={b:?} c={c:?} d={d:?} t={t}");
        let expected = ref_plane(a, b, c);
        stats[0].record(&input, plane_side(a, b, c, "wide"), || expected, desc);
        let expected = ref_segment(a, b, c, d);
        stats[1].record(&input, segment_plane(a, b, c, d, "wide"), || expected, desc);
        let mut line_input = input.clone();
        line_input.push(t);
        let expected = ref_line_point(a, b, c, d, t);
        stats[2].record(&line_input, line_point_side(a, b, c, d, t, "wide"), || expected, desc);
        let (a2, b2, c2) = (p2(a.x, a.y), p2(b.x, b.y), p2(c.x, c.y));
        let expected = ref_orient2d(a2, b2, c2);
        stats[3].record(&input, orient2d(a2, b2, c2, "wide"), || expected, desc);
        let expected = ref_orient3d(a, b, c, d);
        stats[4].record(&input, orient3d(a, b, c, d, "wide"), || expected, desc);
        let expected = ref_dot_sign(a, b);
        stats[5].record(&input, dot_sign(a, b, "wide"), || expected, desc);
        let expected = ref_parallel(a, b);
        stats[6].record(&input, parallel(a, b, "wide"), || expected, desc);
        let expected = ref_perpendicular(a, b);
        stats[7].record(&input, perpendicular(a, b, "wide"), || expected, desc);
    }
    for (name, s) in ["plane", "segment", "line", "orient2d", "orient3d", "dot", "parallel", "perpendicular"].iter().zip(&stats) {
        s.report(&format!("full-range {name}"));
        assert_eq!(s.decided + s.not_exact, 1_000_000);
        assert!(s.decided > 100_000, "refusal farming: {name}");
    }
}
