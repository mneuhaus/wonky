//! P1: the carrier relation table (plane rows of stage A0).
//!
//! For every carrier pair (A surface, B surface) one relation is decided
//! exactly, once, and reused by every later stage (rule X2):
//!
//! * `n_a x n_b = 0` (parallel): with `s = n_a . (o_b - o_a)`, `s = 0` gives
//!   one plane, **identical** when the normals point the same way and
//!   **opposite** otherwise (a contact); `s != 0` gives **parallel-disjoint**
//!   with the exact squared gap `s^2 / (n_a . n_a)` and whether B lies on the
//!   side A's normal points to. A proved gap stays a gap at any size (E4).
//! * otherwise **transverse**, with the exact section line: direction
//!   `d = n_a x n_b` and the point `(h_a (n_b x d) + h_b (d x n_a)) / (d . d)`,
//!   `h = n . o`.
//!
//! **Provenance.** When both operands come from one construction DAG
//! (`Lineage::Shared`) in one frame (R0), equal provenance names one
//! construction slot, and the pair is identical by construction (proof
//! `Provenance`). The exact data must agree; if they do not, the table
//! refuses `relation/provenance`. Every other pair is decided on the exact
//! data (proof `ExactData`), which are the E9 construction values carried
//! into the working frame by the exact frame relation, never world caches.
//!
//! Contracts: the relation of (b, a), decided independently, must be the
//! mirror of the one of (a, b) (`relation/symmetric`), and a section line
//! must satisfy both plane equations (`relation/line-identity`).
use crate::contract;
use crate::operand::{Lineage, Operands, WorkingPlane};
use num_traits::{Signed, Zero};
use wonky_geom::frame::RelationClass;
use wonky_geom::model::SurfaceId;
use wonky_geom::{cross, dot, Point, Refused, Result, Q};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlaneRelation {
    /// One plane; the carrier normals point the same way.
    Identical,
    /// One plane; the carrier normals are opposite (a face contact).
    Opposite,
    /// Parallel and distinct. `aligned`: the normals point the same way;
    /// `above`: B's plane lies on the side A's normal points to;
    /// `distance2`: the exact squared distance of the planes in the working
    /// frame (A's model frame; a Source-frame distance only when A's
    /// placement is an isometry).
    ParallelDisjoint {
        aligned: bool,
        above: bool,
        distance2: Q,
    },
    /// The planes meet in the line `point + t direction`, `direction = n_a x n_b`.
    Transverse { point: Point, direction: Point },
}

/// What proved a relation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Proof {
    /// One construction slot of a shared lineage in one frame (confirmed on the exact data).
    Provenance,
    /// Exact rational tests on the construction data in the working frame.
    ExactData,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Relation {
    pub kind: PlaneRelation,
    pub proof: Proof,
}

/// One relation per (A surface, B surface).
#[derive(Clone, Debug)]
pub struct RelationTable {
    columns: usize,
    cells: Vec<Relation>,
}

impl RelationTable {
    pub fn get(&self, a: SurfaceId, b: SurfaceId) -> &Relation {
        &self.cells[a.index() * self.columns + b.index()]
    }
    /// Every cell with its (A surface, B surface), row by row.
    pub fn iter(&self) -> impl Iterator<Item = (SurfaceId, SurfaceId, &Relation)> + '_ {
        self.cells.iter().enumerate().map(move |(i, r)| {
            (
                SurfaceId((i / self.columns) as u32),
                SurfaceId((i % self.columns) as u32),
                r,
            )
        })
    }
}

fn is_zero(p: &Point) -> bool {
    p.iter().all(Q::is_zero)
}

/// The relation of plane `b` to plane `a`.
pub fn decide(a: &WorkingPlane, b: &WorkingPlane) -> PlaneRelation {
    let d = cross(&a.n, &b.n);
    if is_zero(&d) {
        let s = a.side(&b.o);
        let aligned = dot(&a.n, &b.n).is_positive();
        return if s.is_zero() {
            if aligned {
                PlaneRelation::Identical
            } else {
                PlaneRelation::Opposite
            }
        } else {
            PlaneRelation::ParallelDisjoint {
                aligned,
                above: s.is_positive(),
                distance2: &s * &s / dot(&a.n, &a.n),
            }
        };
    }
    let (ha, hb, dd) = (dot(&a.n, &a.o), dot(&b.n, &b.o), dot(&d, &d));
    let (u, v) = (cross(&b.n, &d), cross(&d, &a.n));
    let point = std::array::from_fn(|k| (&ha * &u[k] + &hb * &v[k]) / &dd);
    PlaneRelation::Transverse {
        point,
        direction: d,
    }
}

/// The relation of (b, a) implied by the relation of (a, b).
pub fn mirror(r: &PlaneRelation) -> PlaneRelation {
    match r {
        PlaneRelation::Identical => PlaneRelation::Identical,
        PlaneRelation::Opposite => PlaneRelation::Opposite,
        // Same-way normals: B above A means A below B. Opposite normals: B on
        // A's normal side means A on B's normal side.
        PlaneRelation::ParallelDisjoint {
            aligned,
            above,
            distance2,
        } => PlaneRelation::ParallelDisjoint {
            aligned: *aligned,
            above: if *aligned { !above } else { *above },
            distance2: distance2.clone(),
        },
        PlaneRelation::Transverse { point, direction } => PlaneRelation::Transverse {
            point: point.clone(),
            direction: direction.clone().map(|x| -x),
        },
    }
}

/// The planes the table decides on: the exact working-frame planes.
#[cfg(not(feature = "plant_relation_world_cache"))]
fn planes(ops: &Operands) -> Result<[Vec<WorkingPlane>; 2]> {
    Ok([ops.placed[0].planes.clone(), ops.placed[1].planes.clone()])
}

/// PLANTED NEGATIVE (wrong on purpose): each plane is taken from its binary64
/// world cache, the world image of its own-frame data rounded to the nearest
/// binary64, as a WC0 carrier cache would carry it.
#[cfg(feature = "plant_relation_world_cache")]
fn planes(ops: &Operands) -> Result<[Vec<WorkingPlane>; 2]> {
    use wonky_geom::model::Carrier3;
    let world = |placed: &crate::operand::Placed| -> Result<Vec<WorkingPlane>> {
        let d = placed.model.draft();
        let inverse = d.placement.inverse();
        let round = |p: Point| -> Result<Point> {
            let r = |x: &Q| crate::boxes::nearest(x).map(|f| Q::from_float(f).expect("finite"));
            Ok([r(&p[0])?, r(&p[1])?, r(&p[2])?])
        };
        d.surfaces
            .iter()
            .map(|s| match &s.carrier {
                Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Sphere(_) => {
                    Err(Refused("boolean/ssi-row-unavailable:curved/plane-relation"))
                }
                Carrier3::Rotated(_) => Err(Refused("boolean/ssi-row-unavailable:rotated-plane")),
                Carrier3::RadicalPlane(_) => Err(Refused("boolean/ssi-row-unavailable:radical-plane")),
                Carrier3::Plane(p) => Ok(WorkingPlane {
                    o: round(d.placement.point(&p.o))?,
                    n: round(crate::operand::normal_image(&inverse, &p.n))?,
                }),
            })
            .collect()
    };
    Ok([world(&ops.placed[0])?, world(&ops.placed[1])?])
}

/// P1 over all carrier pairs.
pub(crate) fn table(ops: &Operands) -> Result<RelationTable> {
    let [pa, pb] = planes(ops)?;
    let [a, b] = &ops.placed;
    let by_provenance = ops.lineage == Lineage::Shared && ops.frame == RelationClass::R0Identical;
    let mut cells = Vec::with_capacity(pa.len() * pb.len());
    for (i, x) in pa.iter().enumerate() {
        for (j, y) in pb.iter().enumerate() {
            let kind = decide(x, y);
            if decide(y, x) != mirror(&kind) {
                return Err(Refused(contract::RELATION_SYMMETRIC));
            }
            match &kind {
                PlaneRelation::Transverse { point, direction } => {
                    let on = |p: &WorkingPlane| {
                        p.side(point).is_zero() && dot(&p.n, direction).is_zero()
                    };
                    if !on(x) || !on(y) {
                        return Err(Refused(contract::RELATION_LINE));
                    }
                }
                PlaneRelation::Identical
                | PlaneRelation::Opposite
                | PlaneRelation::ParallelDisjoint { .. } => {}
            }
            let proof = if by_provenance && a.provenance[i] == b.provenance[j] {
                if kind != PlaneRelation::Identical {
                    return Err(Refused(contract::RELATION_PROVENANCE));
                }
                Proof::Provenance
            } else {
                Proof::ExactData
            };
            cells.push(Relation { kind, proof });
        }
    }
    Ok(RelationTable {
        columns: pb.len(),
        cells,
    })
}
