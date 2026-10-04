//! Operand-only volume enclosure. No result boundary or reported measure enters
//! refinement. Unknown cells remain in the upper bound, including at the budget.
use crate::{P3, R};
use num_traits::Zero;
use std::collections::BinaryHeap;

pub type Cell = [P3; 2];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Membership {
    Inside,
    Outside,
    Boundary,
}
#[derive(Clone, Copy, Debug)]
pub enum Operation {
    Union,
    Difference,
    Intersection,
}
impl Operation {
    /// Query only operands needed by the conservative Boolean table. Errors
    /// from every queried predicate propagate; no result geometry is involved.
    pub fn classify_lazy<E>(
        self,
        count: usize,
        mut state: impl FnMut(usize) -> Result<Membership, E>,
    ) -> Result<Membership, E> {
        use Membership::*;
        assert!(count > 0);
        match self {
            Self::Difference => {
                let base = state(0)?;
                if base == Outside {
                    return Ok(Outside);
                }
                let mut all_outside = true;
                for i in 1..count {
                    let s = state(i)?;
                    if s == Inside {
                        return Ok(Outside);
                    }
                    all_outside &= s == Outside;
                }
                Ok(if base == Inside && all_outside {
                    Inside
                } else {
                    Boundary
                })
            }
            Self::Union | Self::Intersection => {
                let decisive = if matches!(self, Self::Union) {
                    Inside
                } else {
                    Outside
                };
                let opposite = if decisive == Inside { Outside } else { Inside };
                let mut uniform = true;
                for i in 0..count {
                    let s = state(i)?;
                    if s == decisive {
                        return Ok(decisive);
                    }
                    uniform &= s == opposite;
                }
                Ok(if uniform { opposite } else { Boundary })
            }
        }
    }
    pub fn classify(self, states: &[Membership]) -> Membership {
        use Membership::*;
        match self {
            Self::Union if states.contains(&Inside) => Inside,
            Self::Union if states.iter().all(|s| *s == Outside) => Outside,
            Self::Intersection if states.contains(&Outside) => Outside,
            Self::Intersection if states.iter().all(|s| *s == Inside) => Inside,
            Self::Difference if states[0] == Outside || states[1..].contains(&Inside) => Outside,
            Self::Difference
                if states[0] == Inside && states[1..].iter().all(|s| *s == Outside) =>
            {
                Inside
            }
            Self::Union | Self::Intersection | Self::Difference => Boundary,
        }
    }
}
#[derive(Debug)]
pub struct Enclosure {
    pub lower: R,
    pub upper: R,
    pub classified: usize,
    pub boundary_cells: usize,
    pub converged: bool,
}
impl Enclosure {
    pub fn width(&self) -> R {
        &self.upper - &self.lower
    }
    pub fn contains(&self, v: &R) -> bool {
        self.lower <= *v && *v <= self.upper
    }
}
pub fn cell_volume(c: &Cell) -> R {
    (0..3).map(|k| &c[1][k] - &c[0][k]).product()
}
#[derive(Eq, PartialEq)]
struct Pending {
    volume: R,
    serial: usize,
    cell: Cell,
}
impl Ord for Pending {
    fn cmp(&self, b: &Self) -> std::cmp::Ordering {
        self.volume.cmp(&b.volume).then(self.serial.cmp(&b.serial))
    }
}
impl PartialOrd for Pending {
    fn partial_cmp(&self, b: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(b))
    }
}
/// `classify` must certify uniform membership of the OPEN cell against operands
/// only. Cell faces have zero volume. Cuts are exact operand bounds/arrangement
/// coordinates; otherwise bisect the longest edge. Work is capped by classifications.
pub fn enclose<E>(
    root: Cell,
    cuts: &[Vec<R>; 3],
    budget: usize,
    mut classify: impl FnMut(&Cell) -> Result<Membership, E>,
) -> Result<Enclosure, E> {
    assert!(budget > 0 && (0..3).all(|k| root[0][k] <= root[1][k]));
    let mut pending = BinaryHeap::new();
    let mut boundary = cell_volume(&root);
    pending.push(Pending {
        volume: boundary.clone(),
        serial: 0,
        cell: root,
    });
    let mut lower = R::zero();
    let mut classified = 0;
    let mut serial = 0;
    while let Some(p) = pending.pop() {
        if classified >= budget {
            pending.push(p);
            break;
        }
        classified += 1;
        match classify(&p.cell)? {
            Membership::Inside => {
                boundary -= &p.volume;
                lower += p.volume;
            }
            Membership::Outside => {
                boundary -= p.volume;
            }
            Membership::Boundary => {
                // Prefer operand cuts; they remove thin/contact slabs without
                // requiring a depth proportional to the aspect ratio.
                let cut = (0..3)
                    .find_map(|k| {
                        let xs: Vec<_> = cuts[k]
                            .iter()
                            .filter(|x| p.cell[0][k] < **x && **x < p.cell[1][k])
                            .collect();
                        (!xs.is_empty()).then(|| (k, xs[xs.len() / 2].clone()))
                    })
                    .unwrap_or_else(|| {
                        let k = (0..3)
                            .max_by_key(|&k| &p.cell[1][k] - &p.cell[0][k])
                            .unwrap();
                        (
                            k,
                            (&p.cell[0][k] + &p.cell[1][k]) / R::from_integer(2.into()),
                        )
                    });
                let mut a = p.cell.clone();
                let mut b = p.cell;
                a[1][cut.0] = cut.1.clone();
                b[0][cut.0] = cut.1;
                for cell in [a, b] {
                    serial += 1;
                    pending.push(Pending {
                        volume: cell_volume(&cell),
                        serial,
                        cell,
                    });
                }
            }
        }
        // Width below 1% of the certified lower volume is stronger than 1%
        // of the true volume. Zero volume converges only with zero width.
        if boundary.is_zero()
            || (!lower.is_zero() && &boundary * R::from_integer(100.into()) < lower)
        {
            break;
        }
    }
    let converged =
        boundary.is_zero() || (!lower.is_zero() && &boundary * R::from_integer(100.into()) < lower);
    Ok(Enclosure {
        upper: &lower + &boundary,
        lower,
        classified,
        boundary_cells: pending.len(),
        converged,
    })
}

/// Exact sphere/ellipsoid-in-local-coordinates interval membership. The caller
/// may pass an affine interval enclosure of a world cell. No square root or
/// sample determines the sign; squared extrema include every interior point.
pub fn sphere_membership(cell: &Cell, center: &P3, radius: &R) -> Membership {
    assert!(*radius > R::zero());
    let mut lower = R::zero();
    let mut upper = R::zero();
    for k in 0..3 {
        let a = &cell[0][k] - &center[k];
        let b = &cell[1][k] - &center[k];
        let aa = &a * &a;
        let bb = &b * &b;
        lower += if a <= R::zero() && b >= R::zero() {
            R::zero()
        } else {
            aa.clone().min(bb.clone())
        };
        upper += aa.max(bb);
    }
    let squared = radius * radius;
    if upper <= squared {
        Membership::Inside
    } else if lower >= squared {
        Membership::Outside
    } else {
        Membership::Boundary
    }
}
