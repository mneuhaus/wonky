//! P0 admission: both operands' exact data in one working frame.
//!
//! The working frame is A's model frame. B's model frame reaches it by the
//! exact frame relation of the two placements (`Frame::relation_from`, an
//! exact rational affine map of class R0-R3). Points map by the map; a plane
//! `{p : n . (p - o) = 0}` maps to origin `M o` and normal `L^-T n`, which
//! keeps the side function exactly (`n' . (M p - M o) = n . (p - o)`), so the
//! outside of a face stays its outside even under a mirror (Rule P: planes
//! survive every exact affine map; circular carriers will not, G8).
//!
//! Point location in a face is decided in the face's OWN chart (its model
//! frame and `Plane3::chart`) against the face's own checked pcurves: a
//! working-frame point is carried back by the inverse map, never re-charted.
use crate::contract;
use num_traits::{Signed, Zero};
use std::collections::BTreeSet;
use wonky_curve::ExactPoint;
use wonky_geom::frame::{Frame, RelationClass};
use wonky_geom::model::{
    Bounds, Curve3, EdgeId, FaceId, Model, Plane3, Provenance, VertexId,
};
use wonky_geom::{dot, sub, Point, Refused, Result, Q};

/// Which operand an entity belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Side {
    A,
    B,
}
impl Side {
    pub fn index(self) -> usize {
        match self {
            Side::A => 0,
            Side::B => 1,
        }
    }
    pub fn other(self) -> Side {
        match self {
            Side::A => Side::B,
            Side::B => Side::A,
        }
    }
}
pub(crate) const SIDES: [Side; 2] = [Side::A, Side::B];

/// Whether the provenance node ids of the two models index ONE construction
/// DAG (both replayed from one Boolean's lineage). Only then does equal
/// provenance name the same construction slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lineage {
    Shared,
    Separate,
}

/// Where an exact point on a face's carrier lies relative to the face.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Location {
    Inside,
    Boundary,
    Outside,
}

/// A plane in the working frame: the zero set of `n . (p - o)`, with `n`
/// pointing to the side the carrier's own normal points to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkingPlane {
    pub o: Point,
    pub n: Point,
}
impl WorkingPlane {
    /// `n . (p - o)`: zero exactly on the plane, positive on the normal's side.
    pub fn side(&self, p: &Point) -> Q {
        dot(&self.n, &sub(p, &self.o))
    }
}

/// One operand in the working frame.
#[derive(Clone, Debug)]
pub struct Placed<'m> {
    pub model: &'m Model,
    /// This operand's model frame to the working frame, and back; both
    /// `None` when they coincide.
    to_working: Option<Frame>,
    from_working: Option<Frame>,
    /// Per vertex: its exact point.
    pub points: Vec<Point>,
    /// Per edge: its start and end vertex.
    pub ends: Vec<[VertexId; 2]>,
    /// Per surface: its plane.
    pub planes: Vec<WorkingPlane>,
    local_planes: Vec<&'m Plane3>,
    /// Per surface: its provenance.
    pub provenance: Vec<Provenance>,
    /// Per face: the edges of all its loops, ascending.
    pub face_edges: Vec<Vec<EdgeId>>,
}

/// Both operands, admitted.
#[derive(Clone, Debug)]
pub struct Operands<'m> {
    pub placed: [Placed<'m>; 2],
    /// Class of B's frame relative to A's.
    pub frame: RelationClass,
    pub lineage: Lineage,
}

impl<'m> Operands<'m> {
    pub fn get(&self, s: Side) -> &Placed<'m> {
        &self.placed[s.index()]
    }
}

/// `L^-T n` for the linear part `L` of a frame, from the columns of its
/// inverse: `(L^-T n)_i = (L^-1 e_i) . n`.
pub(crate) fn normal_image(inverse: &Frame, n: &Point) -> Point {
    std::array::from_fn(|i| dot(&inverse.columns()[i], n))
}

impl<'m> Placed<'m> {
    /// `to_working`: this operand's model frame to the working frame, and
    /// `from_working` its inverse; both `None` for the identity.
    fn new(
        model: &'m Model,
        to_working: Option<&Frame>,
        from_working: Option<Frame>,
    ) -> Result<Self> {
        let d = model.draft();
        let point = |p: &Point| match to_working {
            Some(m) => m.point(p),
            None => p.clone(),
        };
        let points = (0..d.vertices.len())
            .map(|v| model.key(VertexId(v as u32)).rational().map(point))
            .collect::<Result<Vec<_>>>()?;
        let ends = d
            .edges
            .iter()
            .map(|e| {
                match &d.curves[e.curve.index()].geometry {
                    Curve3::Line { .. } | Curve3::RadicalLine { .. } => {}
                    Curve3::Circle(_) | Curve3::TranslatedCircle(_) | Curve3::RadicalCircle(_) => {
                        return Err(Refused("boolean/ssi-row-unavailable:circle/planar"))
                    }
                }
                match e.bounds {
                    Bounds::Segment(v) => Ok(v),
                    Bounds::Ring => Err(Refused(contract::RING_ON_LINE)),
                }
            })
            .collect::<Result<Vec<_>>>()?;
        let local_planes = d
            .surfaces
            .iter()
            .map(|s| s.carrier.plane())
            .collect::<Result<Vec<_>>>()?;
        let planes = (0..d.surfaces.len())
            .map(|s| {
                let p = local_planes[s];
                WorkingPlane {
                    o: point(&p.o),
                    n: match &from_working {
                        Some(inverse) => normal_image(inverse, &p.n),
                        None => p.n.clone(),
                    },
                }
            })
            .collect();
        let face_edges = d
            .faces
            .iter()
            .map(|f| {
                let edges: BTreeSet<EdgeId> = f
                    .loops
                    .iter()
                    .flat_map(|l| {
                        d.loops[l.index()]
                            .coedges
                            .iter()
                            .map(|c| d.coedges[c.index()].edge)
                    })
                    .collect();
                edges.into_iter().collect()
            })
            .collect();
        Ok(Self {
            model,
            to_working: to_working.cloned(),
            from_working,
            points,
            ends,
            planes,
            local_planes,
            provenance: d.surfaces.iter().map(|s| s.provenance).collect(),
            face_edges,
        })
    }

    /// The plane of a face's carrier in the working frame.
    pub fn face_plane(&self, f: FaceId) -> &WorkingPlane {
        &self.planes[self.model.draft().faces[f.index()].surface.index()]
    }

    /// A working-frame point in this operand's model frame.
    fn local(&self, x: &Point) -> Point {
        match &self.from_working {
            Some(m) => m.point(x),
            None => x.clone(),
        }
    }

    /// The working-frame point with chart coordinates `uv` on face `f`'s
    /// carrier (the face's own chart, carried by the exact frame relation).
    pub fn point(&self, f: FaceId, uv: &[Q; 2]) -> Point {
        let local =
            self.local_planes[self.model.draft().faces[f.index()].surface.index()].point(uv);
        match &self.to_working {
            Some(m) => m.point(&local),
            None => local,
        }
    }

    /// The outward normal of face `f` in the working frame: the carrier
    /// normal (`L^-T n`, which keeps the side function) when the face is
    /// forward, else its opposite.
    pub fn outward(&self, f: FaceId) -> Point {
        let n = &self.face_plane(f).n;
        if self.model.draft().faces[f.index()].forward {
            n.clone()
        } else {
            n.clone().map(|x| -x)
        }
    }

    /// Face `f`'s carrier as a plane of the working frame: origin `M o`, chart
    /// axis `L x` and normal `L^-T n` (so `x . n = 0` stays exact), with the
    /// carrier's provenance. Its chart differs from the face's own chart
    /// unless the frames coincide.
    pub fn working_carrier(&self, f: FaceId) -> Plane3 {
        let p = self.local_planes[self.model.draft().faces[f.index()].surface.index()];
        match &self.to_working {
            Some(m) => Plane3 {
                o: m.point(&p.o),
                x: m.vector(&p.x),
                n: self.face_plane(f).n.clone(),
            },
            None => p.clone(),
        }
    }

    /// Chart coordinates of a working-frame point on face `f`'s carrier, in
    /// the face's own chart.
    pub fn chart(&self, f: FaceId, x: &Point) -> Result<[Q; 2]> {
        let face = &self.model.draft().faces[f.index()];
        let p = self.local_planes[face.surface.index()];
        let local = self.local(x);
        if !p.side(&local).is_zero() {
            return Err(Refused(contract::OFF_PLANE));
        }
        p.chart(&local)
    }

    /// Exact location of a working-frame point of face `f`'s carrier: on a
    /// pcurve of any loop, else inside when the loops wind around it (outer
    /// loop counter-clockwise, holes clockwise), else outside.
    pub fn locate(&self, f: FaceId, x: &Point) -> Result<Location> {
        let uv = ExactPoint::from_rational(self.chart(f, x)?);
        let d = self.model.draft();
        let pcurves = || {
            d.faces[f.index()].loops.iter().flat_map(|l| {
                d.loops[l.index()]
                    .coedges
                    .iter()
                    .map(|c| &d.coedges[c.index()].pcurve)
            })
        };
        for pc in pcurves() {
            if pc.contains(&uv).map_err(|r| Refused(r.name()))? {
                return Ok(Location::Boundary);
            }
        }
        let mut winding = 0;
        for pc in pcurves() {
            winding += pc.winding(&uv).map_err(|r| Refused(r.name()))?;
        }
        Ok(if winding != 0 {
            Location::Inside
        } else {
            Location::Outside
        })
    }
}

/// P0: admit a planar pair. Every match on the model's carrier, curve and
/// bounds classes is exhaustive, so G8's curved classes are compile errors
/// here until they are admitted.
pub(crate) fn admit<'m>(a: &'m Model, b: &'m Model, lineage: Lineage) -> Result<Operands<'m>> {
    let relation = a.draft().placement.relation_from(&b.draft().placement);
    let frame = relation.class;
    let placed_b = match frame {
        RelationClass::R0Identical => Placed::new(b, None, None)?,
        RelationClass::R1PermutationTranslation
        | RelationClass::R2RationalRotation
        | RelationClass::R3Affine => {
            Placed::new(b, Some(&relation.map), Some(relation.map.inverse()))?
        }
    };
    Ok(Operands {
        placed: [Placed::new(a, None, None)?, placed_b],
        frame,
        lineage,
    })
}

/// Sign of an exact value: -1, 0 or 1.
pub(crate) fn sign(x: &Q) -> i8 {
    if x.is_positive() {
        1
    } else if x.is_negative() {
        -1
    } else {
        0
    }
}
