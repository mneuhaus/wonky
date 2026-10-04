//! The spline arm of the arrangement (strand S6) on three synthetic profiles:
//! AC100's arch, an m 1 z 45 involute-approximating outline (the construction
//! of design-robustness, `exact_flank.py`, on every flank) and the AC102
//! 16-tooth outline from the zone's binary64 payload controls. Inputs and the
//! independent areas come from `tests/oracle/gear_outlines.py`.
//!
//! Every profile must give exact cells, winding and orientation with 0
//! contacts away from the shared ends: every adjacent pair of pieces reports
//! exactly its one shared end (found by deflation), no other pair reports a
//! contact, and the arrangement splits nothing. Timings are printed
//! (`--nocapture`).
//!
//! `cargo test -p wonky-curve --features plant_skip_deflation` must FAIL here:
//! without deflation a shared end is found by isolation and reported as a
//! contact away from the shared ends.
use num_bigint::BigInt;
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering;
use std::sync::Arc;
use std::time::Instant;
use wonky_curve::bspline::BSpline;
use wonky_curve::{
    arrange, classify, order_rays, Budget, ContactKind, Cycle, ExactPoint, Refusal, Star, Trimmed, P, Q, UNBOUNDED,
};

mod support;
use support::json::J;

const ORACLE: &str = include_str!("oracle/gear_outlines.json");
const BUDGET: Budget = Budget { segments: 1024, pieces: 8192 };

fn oracle() -> J {
    support::json::parse(ORACLE)
}
fn int(s: &str) -> Q {
    Q::from_integer(s.parse::<BigInt>().unwrap())
}
fn rat(s: &str) -> Q {
    let (n, d) = s.split_once('/').unwrap_or((s, "1"));
    int(n) / int(d)
}
fn r(n: i64, d: i64) -> Q {
    Q::new(BigInt::from(n), BigInt::from(d))
}
/// A decimal string as an exact rational.
fn dec(s: &str) -> Q {
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let scale = int(&format!("1{}", "0".repeat(frac.len())));
    (int(whole) * &scale + int(if frac.is_empty() { "0" } else { frac })) / scale
}
/// A binary64 written by Python's `repr` (shortest round trip).
fn f(j: &J) -> f64 {
    j.str().parse().unwrap()
}
fn fp(j: &J) -> [f64; 2] {
    let a = j.arr();
    [f(&a[0]), f(&a[1])]
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn qp(p: [f64; 2]) -> P {
    [q(p[0]), q(p[1])]
}

/// The rational enclosure of a cycle's area contains `value`.
fn area_contains(c: &Cycle, value: &Q) {
    let a = c.area().unwrap();
    assert!(q(a.lo()) <= *value && *value <= q(a.hi()), "area [{}, {}] misses {}", a.lo(), a.hi(), value);
}

/// Everything the profile tests share: one arrangement of the outline alone,
/// the contact report of every pair, admission of the simple chain, and the
/// winding of the source cycle at the probes (and equal windings within each
/// group of `through_vertex` probes).
fn check_outline(name: &str, outline: &Cycle, area: &Q, probes: &[(P, i32)], groups: &[[P; 3]]) {
    let n = outline.len();
    let pieces = outline.pieces();
    // Contacts: every adjacent pair shares exactly its one end, found by
    // deflation; no other pair touches. Pairs whose boxes miss are skipped as
    // the arrangement skips them.
    let t = Instant::now();
    let bounds = pieces.iter().map(|s| s.bounds().unwrap()).collect::<Vec<_>>();
    let (mut tested, mut multiplicities) = (0, std::collections::BTreeMap::<String, usize>::new());
    for i in 0..n {
        for j in i + 1..n {
            if (0..2).any(|k| bounds[i][1][k] < bounds[j][0][k] || bounds[j][1][k] < bounds[i][0][k]) {
                continue;
            }
            tested += 1;
            let (a, b) = (&pieces[i], &pieces[j]);
            let report = a.contact_report(b).unwrap_or_else(|e| panic!("{name}: pair {i} {j} refuses {e}"));
            let mut expected = vec![];
            if j == i + 1 {
                expected.push(a.ends()[1].clone());
            }
            if i == 0 && j == n - 1 {
                expected.push(a.ends()[0].clone());
            }
            let mut found = report.iter().map(|c| c.point.clone()).collect::<Vec<_>>();
            found.sort();
            expected.sort();
            assert_eq!(found, expected, "{name}: pair {i} {j}: {report:?}");
            for c in &report {
                match &c.kind {
                    ContactKind::End { shared: true, multiplicity } => {
                        *multiplicities.entry(format!("{multiplicity:?}")).or_default() += 1;
                    }
                    other => panic!("{name}: pair {i} {j}: a contact away from the shared ends: {other:?} at {:?}", c.point),
                }
            }
            a.admit(b).unwrap_or_else(|e| panic!("{name}: pair {i} {j} not admitted: {e}"));
        }
    }
    let contacts = t.elapsed();
    // One arrangement: nothing is split, one cell bounded by the whole outline.
    let t = Instant::now();
    let mut arr = arrange(&[outline], BUDGET).unwrap();
    classify(&mut arr, &[outline]).unwrap();
    let arranged = t.elapsed();
    assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (n, n, 1), "{name}: nothing split");
    assert_eq!(arr.cells[0].cycles.len(), 1);
    assert_eq!(arr.cells[0].inside, vec![true]);
    assert_eq!(arr.face.iter().filter(|&&f| f == UNBOUNDED).count(), n);
    assert_eq!(arr.face.iter().filter(|&&f| f == 0).count(), n);
    let cell = arr.cycle_profile(&arr.cells[0].cycles[0]);
    assert!(cell.orientation().unwrap(), "{name}: the cell runs counter-clockwise");
    area_contains(&cell, area);
    area_contains(outline, area);
    assert!(outline.orientation().unwrap());
    // Winding of the source cycle at the probes.
    let t = Instant::now();
    let wind = |p: &P| outline.winding(&ExactPoint::from_rational(p.clone())).unwrap();
    for (p, w) in probes {
        assert_eq!(wind(p), *w, "{name}: winding at {p:?}");
    }
    for g in groups {
        let w = g.iter().map(wind).collect::<Vec<_>>();
        assert!(w[0] == w[1] && w[1] == w[2] && (w[0] == 0 || w[0] == 1), "{name}: windings {w:?} around {:?}", g[0]);
    }
    let winding = t.elapsed();
    eprintln!(
        "[timing] {name}: {n} pieces, {tested} box-overlapping pairs, contact report {contacts:.2?}, arrange+classify {arranged:.2?}, {} windings {winding:.2?}; shared-end multiplicities {multiplicities:?}",
        probes.len() + 3 * groups.len()
    );
}

/// A probe whose horizontal ray runs exactly through the vertex `v` (left of
/// it by `dx`), and two just above and below it: the three lie in one face, so
/// their windings agree exactly when ends and knots on the ray count once.
fn through_vertex(v: &ExactPoint, dx: &Q) -> [P; 3] {
    let eps = Q::new(BigInt::one(), BigInt::one() << 40);
    let [x, y] = v.rat().unwrap().clone();
    [[&x - dx, y.clone()], [&x - dx, &y + &eps], [&x - dx, &y - &eps]]
}

fn polar(r: f64, a: f64) -> P {
    qp([r * a.cos(), r * a.sin()])
}

// ---- AC100 ---------------------------------------------------------------------------

fn arch(poles: &[[f64; 2]]) -> Cycle {
    let s = Arc::new(BSpline::bezier_f64(poles).unwrap());
    // Counter-clockwise: along the chord, back over the arch.
    Cycle::new(vec![
        Trimmed::line([0., 0.], [26., 0.]),
        Trimmed::spline(s, Q::one(), Q::zero()).unwrap(),
    ])
}

#[test]
fn ac100_arch_and_its_elevation_are_one_exact_cell() {
    let area = r(396, 5);
    let probes = |apex_touch: bool| {
        let mut p = vec![
            ([r(13, 1), r(4, 1)], 1),
            ([r(3, 1), r(1, 1)], 1),
            ([r(13, 1), r(5, 1)], 0),
            ([r(-1, 1), r(1, 1)], 0),
            ([r(27, 1), r(1, 1)], 0),
            ([r(13, 1), r(-1, 1)], 0),
            // The ray along the chord runs through both ends.
            ([r(-1, 1), r(0, 1)], 0),
        ];
        if apex_touch {
            // The ray through the apex (9/2 at x = 13) touches it: a double root.
            p.push(([r(12, 1), r(9, 2)], 0));
            p.push(([r(13, 1), r(449, 100)], 1));
        }
        p
    };
    let apex = ExactPoint::from_rational([r(13, 1), r(9, 2)]);
    // Left of (0,0) the ray runs along the chord through both ends.
    let groups = [through_vertex(&apex, &r(1, 1)), through_vertex(&ExactPoint::from_f64([0., 0.]), &r(1, 1))];
    check_outline("AC100 V0", &arch(&[[0., 0.], [8., 6.], [18., 6.], [26., 0.]]), &area, &probes(true), &groups);
    check_outline(
        "AC100 V5 (degree 4)",
        &arch(&[[0., 0.], [6., 4.5], [13., 6.], [20., 4.5], [26., 0.]]),
        &area,
        &probes(true),
        &groups,
    );
    // The chord meets the arch at both ends, each a simple root.
    let c = arch(&[[0., 0.], [8., 6.], [18., 6.], [26., 0.]]);
    let report = c.pieces()[0].contact_report(&c.pieces()[1]).unwrap();
    assert!(report.iter().all(|x| x.kind == ContactKind::End { shared: true, multiplicity: Some(1) }), "{report:?}");
    assert_eq!(report.len(), 2);
}

#[test]
fn a_line_tangent_to_the_arch_at_its_end_orders_by_curvature() {
    // The triangle (0,0), (4,3), (0,3) leaves (0,0) along the arch's end
    // tangent (8,6): the line (0,0)-(4,3) touches the arch there with
    // multiplicity 2 and lies above it. At (0,0) the arch ray and the line ray
    // share a direction; the arch bends right, so it comes first (clockwise).
    let a = arch(&[[0., 0.], [8., 6.], [18., 6.], [26., 0.]]);
    let t = Cycle::polygon(&[[0., 0.], [4., 3.], [0., 3.]]).unwrap();
    let joint = a.pieces()[1].contact_report(&t.pieces()[0]).unwrap();
    assert_eq!(joint, vec![wonky_curve::Contact {
        point: ExactPoint::from_f64([0., 0.]),
        kind: ContactKind::End { shared: true, multiplicity: Some(2) },
    }]);
    // The top edge y = 3 meets the arch's carrier at irrational parameters
    // outside the edge (x ~ 5.26 and 20.7): decided by sign_at, no contact.
    assert_eq!(a.pieces()[1].contact_report(&t.pieces()[1]).unwrap(), vec![]);
    let mut arr = arrange(&[&a, &t], BUDGET).unwrap();
    classify(&mut arr, &[&a, &t]).unwrap();
    assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (4, 5, 2));
    let mut cells = arr
        .cells
        .iter()
        .map(|c| (arr.cycle_profile(&c.cycles[0]), c.inside.clone(), c.cycles.len()))
        .collect::<Vec<_>>();
    cells.sort_by(|x, y| x.0.area().unwrap().mid().total_cmp(&y.0.area().unwrap().mid()));
    area_contains(&cells[0].0, &r(6, 1));
    area_contains(&cells[1].0, &r(396, 5));
    assert_eq!((cells[0].1.clone(), cells[0].2), (vec![false, true], 1));
    assert_eq!((cells[1].1.clone(), cells[1].2), (vec![true, false], 1));
}

/// `p` lies strictly inside the circle of centre `c` and squared radius `r2`.
fn inside(p: &P, c: &P, r2: &Q) -> bool {
    let d = [&p[0] - &c[0], &p[1] - &c[1]];
    &d[0] * &d[0] + &d[1] * &d[1] < *r2
}

#[test]
fn curvature_order_at_a_near_tie_agrees_with_the_exact_geometry() {
    // A cubic leaves (0,0) along +x like the arc of the circle about (0, 25/2)
    // through (15/2, 5/2). Its curvature there is 2 (3 + e) / 75, the circle's
    // 2/25 at e = 0; the derivatives differ in length (lambda = 6/5). Just after
    // the vertex the spline lies inside the disc exactly when it bends more, and
    // the rays must say so from whichever end of either piece they leave.
    let tiny = Q::one() / Q::from_integer(BigInt::one() << 400);
    let gap = Q::one() / Q::from_integer(BigInt::one() << 200);
    let arc = Trimmed::arc_through([0., 0.], [7.5, 2.5], [12.5, 12.5]).unwrap();
    let (centre, r2) = ([r(0, 1), r(25, 2)], r(625, 4));
    let down = Trimmed::line([0., 0.], [0., -3.]).ray(true).unwrap();
    let cubic = |e: &Q| Arc::new(BSpline::bezier(vec![qp([0., 0.]), qp([5., 0.]), [r(5, 1), r(3, 1) + e], qp([6., 4.])], None).unwrap());
    for e in [Q::zero(), gap.clone(), -gap.clone()] {
        let s = cubic(&e);
        let bends_more = inside(&s.eval(&tiny).unwrap(), &centre, &r2);
        assert!(e.is_zero() || bends_more == e.is_positive(), "e = {e}");
        let forward = Trimmed::spline(Arc::clone(&s), Q::zero(), Q::one()).unwrap().ray(true).unwrap();
        let backward = Trimmed::spline(Arc::clone(&s), Q::one(), Q::zero()).unwrap().ray(false).unwrap();
        for sp in [forward, backward] {
            for ar in [arc.ray(true).unwrap(), arc.reversed().ray(false).unwrap()] {
                let table = [sp.clone(), ar, down.clone()];
                let star = order_rays(&mut [0, 1, 2], &table);
                if e.is_zero() {
                    assert_eq!(star, Star::Tied, "equal direction and curvature");
                } else {
                    assert_eq!(star, Star::Ordered);
                    assert_eq!(table[0].ccw_cmp(&table[1]) == Ordering::Greater, bends_more, "e = {e}");
                }
            }
        }
    }
    // The rational quadratic (5,0), (5,5), (0,5) with weights 1, 2, 4w (w0 w2 / w1^2
    // = w) has the curvature w/10 at (5,0); w = 2 is the circle of radius 5 about
    // the origin. W and all its derivatives enter C'' there (W'(0) = 2).
    let circle = Trimmed::arc_through([5., 0.], [3., 4.], [0., 5.]).unwrap().ray(true).unwrap();
    let out = Trimmed::line([5., 0.], [9., 0.]).ray(true).unwrap();
    let small = Q::one() / Q::from_integer(BigInt::one() << 60);
    for w in [r(2, 1) + &small, r(2, 1) - &small] {
        let s = Arc::new(BSpline::bezier(vec![qp([5., 0.]), qp([5., 5.]), qp([0., 5.])], Some(vec![Q::one(), r(2, 1), &w * r(4, 1)])).unwrap());
        let bends_more = inside(&s.eval(&tiny).unwrap(), &[Q::zero(), Q::zero()], &r(25, 1));
        assert_eq!(bends_more, w > r(2, 1));
        let table = [Trimmed::spline(s, Q::zero(), r(1, 2)).unwrap().ray(true).unwrap(), circle.clone(), out.clone()];
        assert_eq!(order_rays(&mut [0, 1, 2], &table), Star::Ordered);
        assert_eq!(table[0].ccw_cmp(&table[1]) == Ordering::Greater, bends_more, "w = {w}");
    }
    // At a pinched vertex the order decides the cells. The cubic that bends
    // more, closed by its chord, lies inside the arc's circular segment and
    // touches its boundary only at (0,0) (multiplicity 2): two cells, the
    // segment minus the spline region by exactly the difference of the areas.
    let s = cubic(&gap);
    let inner = Cycle::new(vec![Trimmed::spline(s, Q::zero(), Q::one()).unwrap(), Trimmed::line([6., 4.], [0., 0.])]);
    let segment = Cycle::new(vec![arc.clone(), Trimmed::line([12.5, 12.5], [0., 0.])]);
    assert_eq!(inner.pieces()[0].contact_report(&arc).unwrap(), vec![wonky_curve::Contact {
        point: ExactPoint::from_f64([0., 0.]),
        kind: ContactKind::End { shared: true, multiplicity: Some(2) },
    }]);
    let mut arr = arrange(&[&inner, &segment], BUDGET).unwrap();
    classify(&mut arr, &[&inner, &segment]).unwrap();
    assert_eq!((arr.points.len(), arr.pieces.len(), arr.cells.len()), (3, 4, 2));
    let (a, b) = (inner.area().unwrap(), segment.area().unwrap());
    for cell in &arr.cells {
        let area = arr.cycle_profile(&cell.cycles[0]).area().unwrap();
        let want = if cell.inside == [true, true] { a.mid() } else { b.mid() - a.mid() };
        assert_eq!(cell.cycles.len(), 1);
        assert!((area.mid() - want).abs() < 1e-12, "{:?}: {} vs {want}", cell.inside, area.mid());
    }
    let mut inside_of = arr.cells.iter().map(|c| c.inside.clone()).collect::<Vec<_>>();
    inside_of.sort();
    assert_eq!(inside_of, vec![vec![false, true], vec![true, true]]);
}

// ---- z45 -----------------------------------------------------------------------------

/// Exact natural cubic interpolation through `p` at parameters `u` (the
/// construction of exact_flank.py): Bezier controls of each piece.
fn natural_bezier(p: &[P], u: &[Q]) -> Vec<[P; 4]> {
    let n = p.len() - 1;
    let h = (0..n).map(|i| &u[i + 1] - &u[i]).collect::<Vec<_>>();
    let six = r(6, 1);
    let mut ms: Vec<Vec<Q>> = vec![];
    for comp in 0..2 {
        let big_n = n - 1;
        let (mut a, mut b, mut c, mut d) =
            (vec![Q::zero(); big_n], vec![Q::zero(); big_n], vec![Q::zero(); big_n], vec![Q::zero(); big_n]);
        for i in 1..n {
            let k = i - 1;
            a[k] = h[i - 1].clone();
            b[k] = r(2, 1) * (&h[i - 1] + &h[i]);
            c[k] = h[i].clone();
            d[k] = &six * ((&p[i + 1][comp] - &p[i][comp]) / &h[i] - (&p[i][comp] - &p[i - 1][comp]) / &h[i - 1]);
        }
        for k in 1..big_n {
            let w = &a[k] / &b[k - 1];
            b[k] = &b[k] - &w * &c[k - 1];
            d[k] = &d[k] - &w * &d[k - 1];
        }
        let mut x = vec![Q::zero(); big_n];
        x[big_n - 1] = &d[big_n - 1] / &b[big_n - 1];
        for k in (0..big_n - 1).rev() {
            x[k] = (&d[k] - &c[k] * &x[k + 1]) / &b[k];
        }
        let mut m = vec![Q::zero()];
        m.extend(x);
        m.push(Q::zero());
        ms.push(m);
    }
    (0..n)
        .map(|i| {
            let mut inner = [[Q::zero(), Q::zero()], [Q::zero(), Q::zero()]];
            for (comp, m) in ms.iter().enumerate() {
                let (mi, mj) = (&m[i], &m[i + 1]);
                let slope = (&p[i + 1][comp] - &p[i][comp]) / &h[i];
                let d0 = &slope - &h[i] * (r(2, 1) * mi + mj) / &six;
                let d1 = &slope + &h[i] * (mi + r(2, 1) * mj) / &six;
                inner[0][comp] = &p[i][comp] + &h[i] * d0 / r(3, 1);
                inner[1][comp] = &p[i + 1][comp] - &h[i] * d1 / r(3, 1);
            }
            let [c1, c2] = inner;
            [p[i].clone(), c1, c2, p[i + 1].clone()]
        })
        .collect()
}

/// The flank as one cubic B-spline over the centripetal parameters (interior
/// knots of multiplicity 3: the Bezier pieces as poles).
fn z45_flank(j: &J) -> (Arc<BSpline>, Q, Q) {
    let p = j.get("points").arr().iter().map(|x| qp(fp(x))).collect::<Vec<_>>();
    let u = j.get("params").arr().iter().map(|x| q(f(x))).collect::<Vec<_>>();
    let pieces = natural_bezier(&p, &u);
    let mut knots = vec![u[0].clone(); 4];
    for k in &u[1..u.len() - 1] {
        knots.extend([k.clone(), k.clone(), k.clone()]);
    }
    knots.extend(vec![u[u.len() - 1].clone(); 4]);
    let mut poles = vec![pieces[0][0].clone()];
    for c in &pieces {
        poles.extend(c[1..].iter().cloned());
    }
    let s = BSpline::new(3, knots, poles, None).unwrap();
    (Arc::new(s), u[0].clone(), u[u.len() - 1].clone())
}

#[test]
fn z45_involute_outline_is_one_exact_cell() {
    let o = oracle();
    let z = o.get("z45");
    let teeth = z.get("teeth").arr();
    // The Rust interpolation is the oracle's: tooth 0's upper flank controls
    // and its exact Green term are equal as rationals.
    let (s0, a0, b0) = z45_flank(teeth[0].get("upper"));
    let expected = z.get("tooth0_upper").get("controls").arr();
    for (k, piece) in expected.iter().enumerate() {
        for (i, c) in piece.arr().iter().enumerate() {
            let c = c.arr();
            assert_eq!(s0.poles()[3 * k + i], [rat(c[0].str()), rat(c[1].str())], "control {k}.{i}");
        }
    }
    assert_eq!(s0.green(&a0, &b0).unwrap().area.lo, rat(z.get("tooth0_upper").get("green").str()));

    let mut pieces = vec![];
    let flanks = teeth.iter().map(|t| (z45_flank(t.get("lower")), z45_flank(t.get("upper")))).collect::<Vec<_>>();
    for (k, t) in teeth.iter().enumerate() {
        let ((lo, l0, l1), (up, u0, u1)) = &flanks[k];
        let (next, _, _) = &flanks[(k + 1) % teeth.len()].0;
        let tip = |s: &BSpline, at: &Q| {
            let p = s.eval(at).unwrap();
            [num_traits::ToPrimitive::to_f64(&p[0]).unwrap(), num_traits::ToPrimitive::to_f64(&p[1]).unwrap()]
        };
        // Every end of a flank is one of its binary64 input points.
        let (lower_root, lower_tip, upper_tip, upper_root, next_root) =
            (tip(lo, l0), tip(lo, l1), tip(up, u1), tip(up, u0), tip(next, l0));
        for p in [lower_root, lower_tip, upper_tip, upper_root, next_root] {
            assert!(p.iter().all(|x| x.is_finite()));
        }
        pieces.push(Trimmed::spline(Arc::clone(lo), l0.clone(), l1.clone()).unwrap());
        pieces.push(Trimmed::arc_through(lower_tip, fp(t.get("tipMid")), upper_tip).unwrap());
        pieces.push(Trimmed::spline(Arc::clone(up), u1.clone(), u0.clone()).unwrap());
        pieces.push(Trimmed::arc_through(upper_root, fp(t.get("rootMid")), next_root).unwrap());
    }
    // The arcs start and end at the flanks' exact ends.
    for w in 0..pieces.len() {
        assert_eq!(pieces[w].ends()[1], pieces[(w + 1) % pieces.len()].ends()[0], "chain closes at {w}");
    }
    let outline = Cycle::new(pieces);
    let area = dec(z.get("area_mm2").str());
    let (rf, ra) = (f(z.get("construction").get("rf")), f(z.get("construction").get("ra")));
    let mid = (rf + ra) / 2.;
    let step = std::f64::consts::PI / 45.;
    let mut probes = vec![
        ([Q::zero(), Q::zero()], 1),
        (polar(ra + 1., 0.3), 0),
        (polar(mid, 0.), 1),
        (polar(mid, step), 0),
        (polar(mid, 20. * 2. * step), 1),
        (polar(mid, 21. * 2. * step + step), 0),
        (polar(rf - 0.5, 1.234), 1),
    ];
    // Rays through a tip vertex, a root vertex and a knot of a flank.
    let (s, _, _) = &flanks[7].1;
    let knot = ExactPoint::from_rational(s.eval(&s.knots()[7]).unwrap());
    let groups = [
        through_vertex(&outline.pieces()[9].ends()[0], &r(1, 1000)),
        through_vertex(&outline.pieces()[4 * 30 + 3].ends()[0], &r(1, 2)),
        through_vertex(&knot, &r(1, 1000)),
    ];
    probes.push((polar(ra + 1., 1.), 0));
    check_outline("z45", &outline, &area, &probes, &groups);
}

// ---- AC102 ---------------------------------------------------------------------------

/// The AC102 outline from the zone's payload (binary64 SI metres), tooth by
/// tooth: radial line, lower flank, tip arc, upper flank (reversed), radial
/// line, root arc.
fn ac102_outline() -> (Cycle, J) {
    let o = oracle();
    let g = o.get("ac102").clone();
    let teeth = g.get("teeth").arr();
    let mut pieces = vec![];
    for (k, t) in teeth.iter().enumerate() {
        let (lo, up) = (t.get("lower"), t.get("upper"));
        let poles = |s: &J| s.get("poles").arr().iter().map(fp).collect::<Vec<_>>();
        let (lp, upp) = (poles(lo), poles(up));
        let next = teeth[(k + 1) % teeth.len()].get("lower");
        pieces.push(Trimmed::line(fp(lo.get("foot")), lp[0]));
        pieces.push(Trimmed::spline(Arc::new(BSpline::bezier_f64(&lp).unwrap()), Q::zero(), Q::one()).unwrap());
        pieces.push(Trimmed::arc_through(lp[3], fp(t.get("tipMid")), upp[3]).unwrap());
        pieces.push(Trimmed::spline(Arc::new(BSpline::bezier_f64(&upp).unwrap()), Q::one(), Q::zero()).unwrap());
        pieces.push(Trimmed::line(upp[0], fp(up.get("foot"))));
        pieces.push(Trimmed::arc_through(fp(up.get("foot")), fp(t.get("rootMid")), fp(next.get("foot"))).unwrap());
    }
    (Cycle::new(pieces), g)
}

/// Area in m^2 of the oracle's mm^2 value.
fn si_area(g: &J) -> Q {
    dec(g.get("area_mm2").str()) / int("1000000")
}

#[test]
fn ac102_outline_from_the_payload_is_one_exact_cell() {
    let (outline, g) = ac102_outline();
    assert_eq!(outline.len(), 96);
    let (rf, ra) = (10.125e-3, 13.5e-3);
    let mid = (rf + ra) / 2.;
    let step = std::f64::consts::PI / 16.;
    let mut probes = vec![
        ([Q::zero(), Q::zero()], 1),
        (polar(ra * 1.2, 0.1), 0),
        (polar(mid, 0.), 1),
        (polar(mid, step), 0),
        (polar(mid, 6. * 2. * step), 1),
        (polar(mid, 11. * 2. * step + step), 0),
    ];
    // Rays through the base point of tooth 0's upper flank (where the flank
    // meets its radial line G1 up to rounding) and through a tip vertex.
    let groups = [
        through_vertex(&outline.pieces()[4].ends()[0], &r(1, 100000)),
        through_vertex(&outline.pieces()[6 * 5 + 2].ends()[1], &r(1, 100000)),
    ];
    probes.push((polar(ra * 1.2, 2.), 0));
    check_outline("AC102", &outline, &si_area(&g), &probes, &groups);
}

#[test]
fn ac102_outline_holds_the_bore_as_a_hole() {
    let (outline, g) = ac102_outline();
    let r = 2.5e-3;
    let bore = Cycle::new(vec![
        Trimmed::arc_through([r, 0.], [0., r], [-r, 0.]).unwrap(),
        Trimmed::arc_through([-r, 0.], [0., -r], [r, 0.]).unwrap(),
    ]);
    let t = Instant::now();
    let mut arr = arrange(&[&outline, &bore], BUDGET).unwrap();
    classify(&mut arr, &[&outline, &bore]).unwrap();
    eprintln!("[timing] AC102 + bore: arrange+classify {:.2?}", t.elapsed());
    assert_eq!((arr.pieces.len(), arr.cells.len()), (98, 2));
    let holed = arr.cells.iter().position(|c| c.cycles.len() == 2).expect("the gear cell has the bore as a hole");
    assert_eq!(arr.cells[holed].inside, vec![true, false]);
    assert_eq!(arr.cells[1 - holed].inside, vec![true, true]);
    // The holed cell's area is the gear cap minus the bore disc.
    let outer = arr.cycle_profile(&arr.cells[holed].cycles[0]).area().unwrap();
    let hole = arr.cycle_profile(&arr.cells[holed].cycles[1]).area().unwrap();
    let cap = si_area(&g);
    assert!(q(outer.lo()) <= cap && cap <= q(outer.hi()));
    let disc = std::f64::consts::PI * r * r;
    assert!((hole.mid() + disc).abs() < 1e-15, "{} vs -{disc}", hole.mid());
}

#[test]
fn spline_pairs_that_need_an_algebraic_vertex_refuse_by_name() {
    // The S-arch (0,0), (8,-6), (18,6), (26,0) crosses its chord at t = 1/2,
    // a rational vertex (13, 0), but the line y = 1 meets it at irrational
    // parameters inside both trims.
    let s = Arc::new(BSpline::bezier_f64(&[[0., 0.], [8., -6.], [18., 6.], [26., 0.]]).unwrap());
    let arch = Trimmed::spline(Arc::clone(&s), Q::zero(), Q::one()).unwrap();
    let chord = Trimmed::line([0., 0.], [26., 0.]);
    let report = arch.contact_report(&chord).unwrap();
    assert_eq!(report.len(), 3, "{report:?}");
    assert!(report.contains(&wonky_curve::Contact {
        point: ExactPoint::from_f64([13., 0.]),
        kind: ContactKind::Inner { multiplicity: Some(1) },
    }));
    assert_eq!(arch.admit(&chord).unwrap_err(), Refusal::SplineIntersection);
    // The arrangement stores rational vertices at shared ends only: the
    // crossing at (13, 0) is a contact away from them.
    assert_eq!(arch.contacts(&chord).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
    let region = Cycle::new(vec![arch.clone(), chord.reversed()]);
    assert_eq!(arrange(&[&region], BUDGET).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
    let cut = Trimmed::line([0., 1.], [26., 1.]);
    assert_eq!(arch.contacts(&cut).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
    assert_eq!(arch.contact_report(&cut).unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
    assert_eq!(Refusal::CrossingNeedsAlgebraicVertex.name(), "curve2/crossing-needs-algebraic-vertex");
}
