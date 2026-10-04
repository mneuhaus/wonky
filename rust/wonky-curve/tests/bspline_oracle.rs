//! The BSpline math against the independent oracle (`tests/oracle/bspline_oracle.py`,
//! sympy and mpmath). Exact quantities must be equal as rationals; certified
//! enclosures must contain the oracle value and be at most 1e-12 (relative) wide.
//!
//! `cargo test -p wonky-curve --features plant_drop_p1p2_green` must FAIL here:
//! the planted defect drops the P1*P2 term of the cubic Green area.
use num_bigint::BigInt;
use num_traits::{One, Signed, Zero};
use wonky_curve::bspline::{BSpline, QBound};
use wonky_curve::{Refusal, P, Q};

const ORACLE: &str = include_str!("oracle/bspline_oracle.json");

mod support;
use support::json::J;

fn oracle() -> J {
    support::json::parse(ORACLE)
}

// ---- values ---------------------------------------------------------------------------

fn int(s: &str) -> Q {
    Q::from_integer(s.parse::<BigInt>().unwrap())
}
/// "n/d" exact rational.
fn rat(s: &str) -> Q {
    let (n, d) = s.split_once('/').unwrap_or((s, "1"));
    int(n) / int(d)
}
/// "-12.3456" decimal string (the oracle's 40 digit mpmath values) as an exact rational.
fn dec(s: &str) -> Q {
    let (neg, s) = s.strip_prefix('-').map_or((false, s), |r| (true, r));
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let scale = int(&format!("1{}", "0".repeat(frac.len())));
    let v = (int(whole) * &scale + int(if frac.is_empty() { "0" } else { frac })) / scale;
    if neg {
        -v
    } else {
        v
    }
}
fn point(j: &J) -> P {
    let a = j.arr();
    [rat(a[0].str()), rat(a[1].str())]
}
/// A point of plain JSON integers.
fn int_point(j: &J) -> P {
    let a = j.arr();
    let n = |x: &J| match x {
        J::Num(s) => int(s),
        other => panic!("not a number: {other:?}"),
    };
    [n(&a[0]), n(&a[1])]
}
fn spline(c: &J) -> BSpline {
    let poles: Vec<P> = c.get("poles").arr().iter().map(point).collect();
    let w = c.get("weights");
    let weights = (!w.is_null()).then(|| w.arr().iter().map(|x| rat(x.str())).collect());
    BSpline::bezier(poles, weights).unwrap()
}
/// `max(|v|, 1) / 10^digits`.
fn rel(v: &Q, digits: usize) -> Q {
    let one = Q::one();
    (if v.abs() > one { v.abs() } else { one }) / int(&format!("1{}", "0".repeat(digits)))
}
/// The certified enclosure contains `v` and is at most 1e-12 (relative) wide.
/// The oracle's decimals carry 40 significant digits, so containment is only
/// granted their rounding (1e-30 relative), not the 1e-12 width budget: an
/// enclosure that misses the true value by more than that fails here.
fn enclosed(name: &str, b: &QBound, v: &Q) {
    let slack = rel(v, 30);
    assert!(&b.lo - &slack <= *v && *v <= &b.hi + &slack, "{name}: oracle {v} outside [{}, {}]", b.lo, b.hi);
    assert!(b.width() <= rel(v, 12), "{name}: enclosure too wide: {}", b.width());
}
fn to_f64(q: &Q) -> f64 {
    use num_traits::ToPrimitive;
    q.to_f64().unwrap()
}

fn range_of(r: &J) -> (Q, Q) {
    (rat(r.get("from").str()), rat(r.get("to").str()))
}

/// Exact (polynomial) or enclosed (rational) Green moments against the oracle.
fn check_moments(c: &J, s: &BSpline, exact: bool) {
    let name = c.get("name").str();
    for r in c.get("ranges").arr() {
        let (a, b) = range_of(r);
        let g = s.green(&a, &b).unwrap();
        for (k, got) in [("area", &g.area), ("mx", &g.mx), ("my", &g.my)] {
            let want = r.get(k).str();
            if exact {
                assert_eq!(*got, QBound::exact(rat(want)), "{name} {k} on [{a}, {b}]");
            } else {
                enclosed(&format!("{name} {k}"), got, &dec(want));
            }
        }
    }
}

/// `(min, max)` bounds of `a x + b y` over the whole domain: the ends, the knots and the critical points.
fn extreme(s: &BSpline, form: [i64; 2]) -> (QBound, QBound) {
    let (lo, hi) = (s.domain().0.clone(), s.domain().1.clone());
    let (fa, fb) = (Q::from_integer(form[0].into()), Q::from_integer(form[1].into()));
    let mut vals: Vec<QBound> = [&lo, &hi]
        .iter()
        .map(|t| {
            let p = s.eval(t).unwrap();
            QBound::exact(&fa * &p[0] + &fb * &p[1])
        })
        .collect();
    vals.extend(s.form_values(&lo, &hi, &fa, &fb).unwrap());
    let max_hi = vals.iter().map(|v| v.hi.clone()).max().unwrap();
    let max_lo = vals.iter().map(|v| v.lo.clone()).max().unwrap();
    let min_hi = vals.iter().map(|v| v.hi.clone()).min().unwrap();
    let min_lo = vals.iter().map(|v| v.lo.clone()).min().unwrap();
    (QBound { lo: min_lo, hi: min_hi }, QBound { lo: max_lo, hi: max_hi })
}

fn check_extremes(c: &J, s: &BSpline) {
    let name = c.get("name").str();
    let e = c.get("extremes");
    for (axis, form) in [("x", [1, 0]), ("y", [0, 1])] {
        let (mn, mx) = extreme(s, form);
        enclosed(&format!("{name} {axis}min"), &mn, &dec(e.get(&format!("{axis}min")).str()));
        enclosed(&format!("{name} {axis}max"), &mx, &dec(e.get(&format!("{axis}max")).str()));
    }
}

fn check_length(c: &J, s: &BSpline) {
    let (a, b) = (s.domain().0.clone(), s.domain().1.clone());
    enclosed(&format!("{} length", c.get("name").str()), &s.length(&a, &b).unwrap(), &dec(c.get("length").str()));
}

// ---- the oracle cases -----------------------------------------------------------------

#[test]
fn ac100_matches_the_oracle_exactly() {
    let o = oracle();
    let c = o.get("ac100");
    let s = spline(c);
    check_moments(c, &s, true);
    let (a, b) = (s.domain().0.clone(), s.domain().1.clone());
    // |C'|^2 = 36 (2t^2 - 2t + 5)^2: the length is exact.
    assert_eq!(s.length(&a, &b).unwrap(), QBound::exact(rat(c.get("length_exact").str())));
    let (_, ymax) = extreme(&s, [0, 1]);
    assert_eq!(ymax, QBound::exact(rat(c.get("apex_y").str())));
    let pt = c.get("point");
    let t = rat(pt.get("t").str());
    assert_eq!(s.eval(&t).unwrap(), point(pt.get("p")));
    // The unit normal (-12/37, 35/37): the tangent (35, 12) k rotated by +90 degrees over its length.
    let tan = s.tangent_at(&t, true).unwrap();
    let un = pt.get("unit_normal").arr();
    let n = [rat(un[0].str()), rat(un[1].str())];
    assert_eq!(&tan[0] * &n[0], -(&tan[1] * &n[1]), "the normal is orthogonal to the tangent");
    assert!((&tan[0] * &n[1] - &tan[1] * &n[0]).is_positive(), "and is the left normal");
    let cl = c.get("closest");
    let got = s.closest(&a, &b, &point(cl.get("probe"))).unwrap();
    assert_eq!(got.t, Some(rat(cl.get("t").str())));
    assert_eq!(got.dist2, QBound::exact(rat(cl.get("dist2").str())));
    s.regular().unwrap();
}

#[test]
fn ac100_quartic_elevation_has_identical_moments() {
    let o = oracle();
    let cubic = spline(o.get("ac100"));
    let want = o.get("ac100_elevated");
    let e = cubic.elevated().unwrap();
    assert_eq!(e.degree(), 4);
    let poles: Vec<P> = want.get("poles").arr().iter().map(point).collect();
    assert_eq!(e.poles(), poles.as_slice(), "the Greville solve is the classical elevation");
    check_moments(want, &e, true);
    let (a, b) = (e.domain().0.clone(), e.domain().1.clone());
    assert_eq!(e.length(&a, &b).unwrap(), QBound::exact(rat(o.get("ac100").get("length_exact").str())));
    let same_area = cubic.green(&a, &b).unwrap();
    let elev = e.green(&a, &b).unwrap();
    assert_eq!((same_area.area, same_area.mx, same_area.my), (elev.area, elev.mx, elev.my));
    let t = rat("1/4");
    assert_eq!(e.eval(&t).unwrap(), cubic.eval(&t).unwrap());
}

#[test]
fn s_edge_block_matches_the_oracle() {
    let o = oracle();
    let c = o.get("s_edge");
    let s = spline(c);
    check_moments(c, &s, true);
    let (a, b) = (s.domain().0.clone(), s.domain().1.clone());
    // The cap: the cubic plus the three closing lines (shoelace).
    let mut cap = s.green(&a, &b).unwrap().area;
    for l in c.get("cap_lines").arr() {
        let (p, q) = (int_point(&l.arr()[0]), int_point(&l.arr()[1]));
        cap = cap.add(&QBound::exact((&p[0] * &q[1] - &q[0] * &p[1]) / int("2")));
    }
    assert_eq!(cap, QBound::exact(rat(c.get("cap_area").str())));
    assert_eq!(cap, QBound::exact(rat("3039/5")));
    check_length(c, &s);
    check_extremes(c, &s);
    let (ymin, ymax) = extreme(&s, [0, 1]);
    let yr = c.get("y_range").arr();
    assert_eq!(ymin, QBound::exact(rat(yr[0].str())));
    assert_eq!(ymax, QBound::exact(rat(yr[1].str())));
    s.regular().unwrap();
}

#[test]
fn twenty_dyadic_cubics_match_the_oracle() {
    let o = oracle();
    let all = o.get("dyadic").arr();
    assert_eq!(all.len(), 20);
    for c in all {
        let s = spline(c);
        check_moments(c, &s, true);
        check_length(c, &s);
        check_extremes(c, &s);
    }
}

#[test]
fn rational_spans_are_certified_enclosures_of_the_oracle() {
    let o = oracle();
    for c in o.get("rational").arr() {
        let s = spline(c);
        assert!(s.is_rational());
        check_moments(c, &s, false);
        check_length(c, &s);
        check_extremes(c, &s);
    }
}

#[test]
fn cusp_and_true_loop_refuse_by_name() {
    let o = oracle();
    let reg = o.get("regularity");
    let want = reg.get("refusal").str();
    for k in ["cusp", "loop"] {
        let poles: Vec<P> = reg.get(k).get("poles").arr().iter().map(point).collect();
        let s = BSpline::bezier(poles, None).unwrap();
        let e = s.regular().unwrap_err();
        assert_eq!(e.name(), want, "{k}");
        let typed = if k == "cusp" { Refusal::SplineCusp } else { Refusal::SplineSelfIntersecting };
        assert_eq!(e, typed, "{k}");
    }
    // The oracle's crossing parameters of the true loop lie strictly inside the domain.
    let cr = reg.get("loop").get("crossing_params").arr();
    let (s0, s1) = (dec(cr[0].str()), dec(cr[1].str()));
    assert!(s0 > Q::zero() && s0 < s1 && s1 < Q::one());
    assert!(to_f64(&s0) < 0.5 && to_f64(&s1) > 0.5);
}
