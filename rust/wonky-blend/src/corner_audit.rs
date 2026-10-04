//! F1a corner audit (pkg-predicate-audit.fix1, 2026-10-02): replays the sympy
//! corpus of tests/data/chamfer-audit.py against the private Cramer corner.
//! The oracle solves each system by fraction-free LU in an algebraic number
//! field; a quarter of the systems have exactly dependent normals with
//! irrational weights, a quarter are dependent up to a 2^-80 perturbation.
use super::{intersection, Plane, RPoint};
use num_bigint::BigInt;
use wonky_curve::radical::{guard, Radical};
use wonky_geom::Q;

fn q(s: &str) -> Q {
    let (n, d) = s.split_once('/').expect("n/d");
    Q::new(n.parse::<BigInt>().unwrap(), d.parse::<BigInt>().unwrap())
}

fn radical(f: &mut std::str::Split<'_, char>) -> Radical {
    let k: usize = f.next().unwrap().parse().unwrap();
    (0..k).fold(Radical::default(), |s, _| {
        let r = q(f.next().unwrap());
        let c = q(f.next().unwrap());
        s + Radical::quadratic(Q::from_integer(0.into()), c, r).unwrap()
    })
}

#[test]
fn cramer_corner_matches_the_sympy_lu_oracle() {
    let text = include_str!("../tests/data/corner-audit.txt");
    let (mut points, mut singular) = (0, 0);
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let (planes, want) = line.strip_prefix("corner ").unwrap().split_once(" | ").unwrap();
        let mut f = planes.split(' ');
        let planes: Vec<Plane> = guard(|| {
            (0..3)
                .map(|_| Plane {
                    normal: std::array::from_fn(|_| radical(&mut f)),
                    offset: radical(&mut f),
                })
                .collect()
        })
        .unwrap();
        let got = guard(|| intersection(&planes[0], &planes[1], &planes[2])).unwrap();
        if want == "singular" {
            assert_eq!(got.unwrap_err().0, "chamfer/corner-degenerate", "{line}");
            singular += 1;
        } else {
            let mut w = want.split(' ');
            let expected: RPoint = guard(|| std::array::from_fn(|_| radical(&mut w))).unwrap();
            assert!(got.unwrap_or_else(|e| panic!("{line}: {e:?}")) == expected, "{line}");
            points += 1;
        }
    }
    eprintln!("corner audit: {points} corners, {singular} singular");
    assert_eq!(points + singular, 160);
}
