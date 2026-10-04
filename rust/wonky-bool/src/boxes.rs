//! P2: certified candidate boxes.
//!
//! A `CertifiedBox` holds binary64 bounds rounded OUTWARD from the exact
//! extremes of the exact points it was built around, so it contains each of
//! them (checked on every run: `candidates/box-contains`). Two boxes that do
//! not meet prove, by a strict inequality, that the exact point sets are
//! disjoint; that is the only thing a box ever decides. Boxes that meet
//! decide nothing: the exact stages P3/P4 look at the pair. For a planar face
//! the box of its vertices contains the face (its convex hull), for an edge
//! the box of its ends contains the segment.
//!
//! The pairs are culled by brute force over the box lists: planar operands
//! of today's corpus have tens of faces. A sweep over sorted box bounds is
//! the obvious next step when a consumer brings thousands.
use crate::contract;
use crate::operand::{Operands, Placed};
use num_traits::ToPrimitive;
use wonky_geom::model::FaceId;
use wonky_geom::{Point, Refused, Result, Q};

const RANGE: &str = "boolean/budget-exceeded:box-range";

fn exact(f: f64) -> Q {
    Q::from_float(f).expect("finite binary64")
}
fn approximate(x: &Q) -> Result<f64> {
    x.to_f64().filter(|f| f.is_finite()).ok_or(Refused(RANGE))
}

/// The largest binary64 that is `<= x`.
pub fn down(x: &Q) -> Result<f64> {
    let mut f = approximate(x)?;
    while &exact(f) > x {
        f = f.next_down();
    }
    while f.next_up().is_finite() && &exact(f.next_up()) <= x {
        f = f.next_up();
    }
    Ok(f)
}
/// The smallest binary64 that is `>= x`.
pub fn up(x: &Q) -> Result<f64> {
    Ok(-down(&-x)?)
}
/// The binary64 nearest to `x`, ties to even (observation caches only; the
/// planted negatives use it to imitate WC0 world caches).
pub fn nearest(x: &Q) -> Result<f64> {
    let (lo, hi) = (down(x)?, up(x)?);
    let (dl, dh) = (x - exact(lo), exact(hi) - x);
    Ok(if dl < dh || (dl == dh && lo.to_bits() & 1 == 0) { lo } else { hi })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CertifiedBox {
    pub lo: [f64; 3],
    pub hi: [f64; 3],
}

impl CertifiedBox {
    /// The box around exact points (at least one).
    pub fn around<'p>(points: impl IntoIterator<Item = &'p Point>) -> Result<Self> {
        let points: Vec<&Point> = points.into_iter().collect();
        let first = points.first().expect("a box around at least one point");
        let mut lo = (*first).clone();
        let mut hi = (*first).clone();
        for p in &points[1..] {
            for k in 0..3 {
                if p[k] < lo[k] {
                    lo[k] = p[k].clone();
                }
                if p[k] > hi[k] {
                    hi[k] = p[k].clone();
                }
            }
        }
        let b = CertifiedBox {
            lo: [down(&lo[0])?, down(&lo[1])?, down(&lo[2])?],
            hi: [up(&hi[0])?, up(&hi[1])?, up(&hi[2])?],
        };
        if !points.iter().all(|p| b.contains(p)) {
            return Err(Refused(contract::BOX_CONTAINS));
        }
        Ok(b)
    }
    /// Closed boxes overlap (touching counts: contact is an interference).
    pub fn meets(&self, other: &Self) -> bool {
        (0..3).all(|k| self.lo[k] <= other.hi[k] && other.lo[k] <= self.hi[k])
    }
    /// The exact point lies in the closed box.
    pub fn contains(&self, p: &Point) -> bool {
        (0..3).all(|k| exact(self.lo[k]) <= p[k] && p[k] <= exact(self.hi[k]))
    }
}

/// The boxes of every vertex, edge and face of both operands.
#[derive(Clone, Debug)]
pub(crate) struct Boxes {
    pub vertices: [Vec<CertifiedBox>; 2],
    pub edges: [Vec<CertifiedBox>; 2],
    pub faces: [Vec<CertifiedBox>; 2],
}

fn vertex_boxes(o: &Placed) -> Result<Vec<CertifiedBox>> {
    o.points.iter().map(|p| CertifiedBox::around([p])).collect()
}
fn edge_boxes(o: &Placed) -> Result<Vec<CertifiedBox>> {
    o.ends.iter().map(|[a, b]| CertifiedBox::around([&o.points[a.index()], &o.points[b.index()]])).collect()
}
fn face_boxes(o: &Placed) -> Result<Vec<CertifiedBox>> {
    o.face_edges
        .iter()
        .map(|edges| CertifiedBox::around(edges.iter().flat_map(|e| o.ends[e.index()].iter().map(|v| &o.points[v.index()]))))
        .collect()
}

impl Boxes {
    pub fn of(ops: &Operands) -> Result<Self> {
        let [a, b] = &ops.placed;
        Ok(Boxes {
            vertices: [vertex_boxes(a)?, vertex_boxes(b)?],
            edges: [edge_boxes(a)?, edge_boxes(b)?],
            faces: [face_boxes(a)?, face_boxes(b)?],
        })
    }

    /// (A face, B face) pairs whose boxes meet, in order.
    pub fn face_pairs(&self) -> Vec<[FaceId; 2]> {
        let mut out = vec![];
        for (i, a) in self.faces[0].iter().enumerate() {
            for (j, b) in self.faces[1].iter().enumerate() {
                if a.meets(b) {
                    out.push([FaceId(i as u32), FaceId(j as u32)]);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(n: i64, d: i64) -> Q {
        Q::new(n.into(), d.into())
    }

    #[test]
    fn outward_rounding_brackets_non_dyadic_values_and_keeps_dyadic_ones() {
        for x in [q(1, 3), q(-1, 3), q(2, 3), q(-7, 10), q(123456789, 1000)] {
            let (lo, hi) = (down(&x).unwrap(), up(&x).unwrap());
            assert!(exact(lo) < x && x < exact(hi), "{x}");
            assert_eq!(lo.next_up(), hi, "{x}: adjacent binary64 neighbours");
            let n = nearest(&x).unwrap();
            assert!(n == lo || n == hi);
        }
        for f in [0.5, -0.25, 3.0, 1e-300, -1e300, 0.1] {
            let x = exact(f);
            assert_eq!((down(&x).unwrap(), up(&x).unwrap(), nearest(&x).unwrap()), (f, f, f));
        }
        // A value 2^-60 above 1: nearest is 1, the box still contains it.
        let x = Q::from_integer(1.into()) + Q::new(1.into(), (1u64 << 60).into());
        assert_eq!(nearest(&x).unwrap(), 1.0);
        assert_eq!((down(&x).unwrap(), up(&x).unwrap()), (1.0, 1.0f64.next_up()));
    }

    #[test]
    fn boxes_meet_when_closed_intervals_touch() {
        let p = |x: i64| [Q::from_integer(x.into()), Q::from_integer(0.into()), Q::from_integer(0.into())];
        let a = CertifiedBox::around([&p(0), &p(1)]).unwrap();
        let b = CertifiedBox::around([&p(1), &p(2)]).unwrap();
        let c = CertifiedBox::around([&p(3)]).unwrap();
        assert!(a.meets(&b) && b.meets(&a));
        assert!(!a.meets(&c) && !c.meets(&a));
    }
}
