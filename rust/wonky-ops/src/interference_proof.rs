//! Sufficient pair proofs from audited construction geometry, not a Boolean
//! reconstruction. One box-cover algorithm evaluates every adapter with the
//! same conservative CSG rules. An inconclusive cover returns `null`, never a
//! geometric verdict. Clearance carries a lower bound, not a minimum distance.
use crate::{
    analytic::Solid,
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use wonky_curve as wc;
use wonky_geom::frame::Frame;
use wonky_num::Scalar;

type R<T> = Result<T, Refused>;
type P = [Q; 3];
type Box3 = [P; 2];
fn q(x: f64) -> Q {
    Q::from_float(x).expect("audited finite input")
}
fn no() -> Refused {
    Refused("interference/source-proof-unavailable".into())
}
fn box_of(points: &[P]) -> Box3 {
    std::array::from_fn(|side| {
        std::array::from_fn(|k| {
            let values = points.iter().map(|p| p[k].clone());
            if side == 0 {
                values.min().unwrap()
            } else {
                values.max().unwrap()
            }
        })
    })
}
fn corners(b: &Box3) -> Vec<P> {
    (0..8)
        .map(|mask| std::array::from_fn(|k| b[usize::from(mask & (1 << k) != 0)][k].clone()))
        .collect()
}
pub fn mapped_box(b: &Box3, f: &Frame) -> Box3 {
    // Exact affine interval evaluation equals the extrema over all eight
    // corners, without repeatedly mapping identical zero/identity components.
    std::array::from_fn(|side| {
        std::array::from_fn(|k| {
            let mut value = f.origin()[k].clone();
            for j in 0..3 {
                let c = &f.columns()[j][k];
                if !c.is_zero() {
                    let endpoint = if *c > Q::zero() { side } else { 1 - side };
                    value += c * &b[endpoint][j];
                }
            }
            value
        })
    })
}
// Extrema of a linear functional over a box occur at the two corners chosen
// by exact coefficient signs; evaluating all eight corners adds no information.
fn plane_range(n: &P, d: &Q, b: &Box3) -> (Q,Q) {
    let value = |side: usize| {
        let corner: P = std::array::from_fn(|k| b[if n[k]>=Q::zero() {side} else {1-side}][k].clone());
        crate::planar_geometry::dot(n,&corner)-d
    };
    (value(0),value(1))
}
fn expanded(b: &Box3, d: &Q) -> Box3 {
    [b[0].clone().map(|x| x - d), b[1].clone().map(|x| x + d)]
}
fn common(a: &Box3, b: &Box3) -> Option<Box3> {
    let c = [
        std::array::from_fn(|k| a[0][k].clone().max(b[0][k].clone())),
        std::array::from_fn(|k| a[1][k].clone().min(b[1][k].clone())),
    ];
    (0..3).all(|k| c[0][k] <= c[1][k]).then_some(c)
}
#[derive(Clone, Copy)]
struct State {
    outside: bool,
    inside: bool,
}
impl State {
    const UNKNOWN: Self = Self {
        outside: false,
        inside: false,
    };
}

pub struct Shape {
    outer: Box3,
    kind: Kind,
}
enum Kind {
    Prism {
        profile: wc::Cycle,
        axes: [usize; 3],
        levels: [Q; 2],
        inverse: Frame,
    },
    Planes(Vec<(P, Q)>),
    Csg(u8, Vec<Shape>),
    Enclosure,
    Revolved { profile: wc::Cycle, axis: usize, inverse: Frame },
}
impl Shape {
    /// Exact operand bound in metres. No Boolean result is consulted.
    pub fn bounds(&self) -> &[[Q; 3]; 2] { &self.outer }
    /// Uniform membership of an open cell: (inside, outside). Neither means
    /// boundary/unresolved, never an invented membership result.
    pub fn classify_box(&self, cell: &[[Q; 3]; 2]) -> R<(bool, bool)> {
        let state = self.state(cell, true)?;
        Ok((state.inside, state.outside))
    }
    /// False means this adapter can only exclude cells by operand bounds.
    pub fn has_membership(&self) -> bool {
        match &self.kind { Kind::Enclosure => false, Kind::Csg(_,xs) => xs.iter().all(Self::has_membership), Kind::Prism { .. } | Kind::Planes(_) | Kind::Revolved { .. } => true }
    }
    /// Include all CSG leaf bounds as exact grid cuts.
    pub fn cuts(&self, out: &mut [Vec<Q>; 3]) {
        for k in 0..3 { out[k].extend([self.outer[0][k].clone(), self.outer[1][k].clone()]); }
        if let Kind::Csg(_, xs) = &self.kind { for x in xs { x.cuts(out); } }
    }
    fn revolved(points: &[[f64;2]], axis: usize, frame: &Placement) -> R<Self> {
        let f=frame.exact_frame()?;
        let radius=points.iter().map(|p|q(p[0])).max().ok_or_else(no)?;
        let low=points.iter().map(|p|q(p[1])).min().unwrap();
        let high=points.iter().map(|p|q(p[1])).max().unwrap();
        let local=[std::array::from_fn(|k|if k==axis {low.clone()} else {-&radius}),
                   std::array::from_fn(|k|if k==axis {high.clone()} else {radius.clone()})];
        Ok(Self {outer:mapped_box(&local,&f),kind:Kind::Revolved {profile:wc::Cycle::polygon(points)?,axis,inverse:f.inverse()}})
    }
    fn prism(profile: wc::Cycle, axes: [usize; 3], levels: [f64; 2], frame: &Placement) -> R<Self> {
        let f = frame.exact_frame()?;
        let bounds = profile.bounds()?;
        // Lines have rational ends: retain tight levels/coordinates, including
        // exact equality at caps, rather than widening by serialization ulps.
        if profile.pieces().iter().all(|p| !p.is_curved()) {
            let points = profile
                .pieces()
                .iter()
                .map(|p| p.ends()[0].rat())
                .collect::<wc::R<Vec<_>>>()?;
            let local: Box3 = std::array::from_fn(|side| {
                std::array::from_fn(|k| {
                    if k == axes[2] {
                        return q(levels[side]);
                    }
                    let j = usize::from(k == axes[1]);
                    let xs = points.iter().map(|p| p[j].clone());
                    if side == 0 {
                        xs.min().unwrap()
                    } else {
                        xs.max().unwrap()
                    }
                })
            });
            return Ok(Self {
                outer: mapped_box(&local, &f),
                kind: Kind::Prism {
                    profile,
                    axes,
                    levels: levels.map(q),
                    inverse: f.inverse(),
                },
            });
        }
        if bounds.iter().flatten().any(|x| !x.is_finite()) {
            return Err(no());
        }
        // Curve extrema are outward enclosures, never caches of the ends.
        let local: Box3 = std::array::from_fn(|side| {
            std::array::from_fn(|k| {
                if k == axes[2] {
                    q(levels[side])
                } else {
                    q(bounds[side][usize::from(k == axes[1])])
                }
            })
        });
        Ok(Self {
            outer: mapped_box(&local, &f),
            kind: Kind::Prism {
                profile,
                axes,
                levels: levels.map(q),
                inverse: f.inverse(),
            },
        })
    }
    fn cuboid(b: [[f64; 3]; 2], frame: &Placement) -> R<Self> {
        let [lo, hi] = b;
        Self::prism(
            wc::Cycle::polygon(&[
                [lo[0], lo[1]],
                [hi[0], lo[1]],
                [hi[0], hi[1]],
                [lo[0], hi[1]],
            ])?,
            [0, 1, 2],
            [lo[2], hi[2]],
            frame,
        )
    }
    fn csg(op: u8, xs: Vec<Self>) -> R<Self> {
        let first = xs.first().ok_or_else(no)?;
        let outer = if op == 1 {
            first.outer.clone()
        } else {
            std::array::from_fn(|side| {
                std::array::from_fn(|k| {
                    let v = xs.iter().map(|s| s.outer[side][k].clone());
                    if (op == 0) == (side == 0) {
                        v.min().unwrap()
                    } else {
                        v.max().unwrap()
                    }
                })
            })
        };
        Ok(Self {
            outer,
            kind: Kind::Csg(op, xs),
        })
    }
    /// `interior`: exclude boundary-only material for a no-positive-volume
    /// proof. Outside is only sufficient; inside is strict for closed covers
    /// and closed for interior covers, so subtraction keeps its boundary.
    fn state(&self, world: &Box3, interior: bool) -> R<State> {
        if (0..3).any(|k| {
            if interior {
                world[1][k] <= self.outer[0][k] || world[0][k] >= self.outer[1][k]
            } else {
                world[1][k] < self.outer[0][k] || world[0][k] > self.outer[1][k]
            }
        }) {
            return Ok(State {
                outside: true,
                inside: false,
            });
        }
        Ok(match &self.kind {
            Kind::Enclosure => State::UNKNOWN,
            Kind::Revolved {profile,axis,inverse} => {
                let local=mapped_box(world,inverse);
                let mut lo=Q::zero();let mut hi=Q::zero();
                for k in (0..3).filter(|k|k!=axis) {
                    let a=&local[0][k];let b=&local[1][k];
                    lo+=if *a<=Q::zero()&&*b>=Q::zero() {Q::zero()} else {(a*a).min(b*b)};
                    hi+=(a*a).max(b*b);
                }
                let lower=radial_root(&lo)?[0].clone();let upper=radial_root(&hi)?[1].clone();
                profile_state(profile,&[[lower,local[0][*axis].clone()],[upper,local[1][*axis].clone()]],interior)?
            },
            Kind::Planes(planes) => {
                let ranges = planes.iter().map(|(n,d)| plane_range(n,d,world)).collect::<Vec<_>>();
                State {
                    outside: ranges.iter().any(|(lo, _)| {
                        if interior {
                            *lo >= Q::zero()
                        } else {
                            *lo > Q::zero()
                        }
                    }),
                    inside: ranges.iter().all(|(_, hi)| {
                        if interior {
                            *hi <= Q::zero()
                        } else {
                            *hi < Q::zero()
                        }
                    }),
                }
            }
            Kind::Prism {
                profile,
                axes,
                levels,
                inverse,
            } => {
                let local = mapped_box(world, inverse);
                let [x, y, z] = *axes;
                let axial_out = if interior {
                    local[1][z] <= levels[0] || local[0][z] >= levels[1]
                } else {
                    local[1][z] < levels[0] || local[0][z] > levels[1]
                };
                if axial_out {
                    State {
                        outside: true,
                        inside: false,
                    }
                } else {
                    let xy = [
                        [local[0][x].clone(), local[0][y].clone()],
                        [local[1][x].clone(), local[1][y].clone()],
                    ];
                    let planar = profile_state(profile, &xy, interior)?;
                    let axial_in = if interior {
                        local[0][z] >= levels[0] && local[1][z] <= levels[1]
                    } else {
                        local[0][z] > levels[0] && local[1][z] < levels[1]
                    };
                    State {
                        outside: planar.outside,
                        inside: planar.inside && axial_in,
                    }
                }
            }
            Kind::Csg(op, xs) => {
                // Evaluate decisive children first and stop immediately. A void
                // cutter can certify exclusion without visiting engraving leaves.
                match op {
                    0 => {
                        let mut outside = true;
                        for x in xs {
                            let s = x.state(world, interior)?;
                            if s.inside {
                                return Ok(s);
                            }
                            outside &= s.outside;
                        }
                        State {
                            outside,
                            inside: false,
                        }
                    }
                    1 => {
                        let base = xs[0].state(world, interior)?;
                        if base.outside {
                            return Ok(base);
                        }
                        let mut inside = base.inside;
                        for x in &xs[1..] {
                            let s = x.state(world, interior)?;
                            if s.inside {
                                return Ok(State {
                                    outside: true,
                                    inside: false,
                                });
                            }
                            inside &= s.outside;
                        }
                        State {
                            outside: false,
                            inside,
                        }
                    }
                    2 => {
                        let mut inside = true;
                        for x in xs {
                            let s = x.state(world, interior)?;
                            if s.outside {
                                return Ok(s);
                            }
                            inside &= s.inside;
                        }
                        State {
                            outside: false,
                            inside,
                        }
                    }
                    _ => return Err(no()),
                }
            }
        })
    }
    // Sufficient surviving-material witness. Intersections require strict
    // membership: a degenerate source intersection is not regularized material.
    fn witness(&self, p: &P) -> R<bool> {
        Ok(match &self.kind {
            Kind::Enclosure | Kind::Revolved {..} => false,
            Kind::Planes(planes) => planes
                .iter()
                .all(|(n, d)| crate::planar_geometry::dot(n, p) <= *d),
            Kind::Prism {
                profile,
                axes,
                levels,
                inverse,
            } => {
                let p = inverse.point(p);
                levels[0] <= p[axes[2]]
                    && p[axes[2]] <= levels[1]
                    && profile.contains(&wc::ExactPoint::from_rational([
                        p[axes[0]].clone(),
                        p[axes[1]].clone(),
                    ]))?
            }
            Kind::Csg(0, xs) => {
                let mut yes = false;
                for x in xs {
                    yes |= x.witness(p)?;
                }
                yes
            }
            Kind::Csg(1, xs) => {
                xs[0].witness(p)?
                    && xs[1..]
                        .iter()
                        .map(|x| x.state(&[p.clone(), p.clone()], false).map(|s| s.outside))
                        .collect::<R<Vec<_>>>()?
                        .iter()
                        .all(|v| *v)
            }
            Kind::Csg(2, _) => self.state(&[p.clone(), p.clone()], false)?.inside,
            Kind::Csg(_, _) => return Err(no()),
        })
    }
}
/// A floating root is a filter candidate only. Exact squaring proves both
/// interval endpoints before any membership sign uses them.
fn radial_root(x: &Q) -> R<[Q;2]> {
    if x.is_zero() {return Ok([Q::zero(),Q::zero()]);}
    let v=crate::probe_exact::enclose(x).map_err(|_|Refused("operand-box/radial-root-enclosure".into()))?.sqrt();
    if !v.lo().is_finite() || !v.hi().is_finite() {return Err(Refused("operand-box/radial-root-enclosure".into()));}
    let lo=q(v.lo().max(0.));let hi=q(v.hi());
    if &lo*&lo>*x || &hi*&hi<*x {return Err(Refused("operand-box/radial-root-enclosure".into()));}
    Ok([lo,hi])
}
fn profile_state(c: &wc::Cycle, b: &[[Q; 2]; 2], interior: bool) -> R<State> {
    let ps = (0..4)
        .map(|m| [b[m & 1][0].clone(), b[(m >> 1) & 1][1].clone()])
        .collect::<Vec<_>>();
    if c.pieces().iter().all(|p| !p.is_curved()) {
        let vertices = c
            .pieces()
            .iter()
            .map(|p| p.ends()[0].rat())
            .collect::<wc::R<Vec<_>>>()?;
        let planes = c
            .pieces()
            .iter()
            .map(|p| {
                Ok((
                    p.ends()[0].rat()?,
                    wc::numeric::sub(p.ends()[1].rat()?, p.ends()[0].rat()?),
                ))
            })
            .collect::<wc::R<Vec<_>>>()?;
        // Corner containment is valid only after exact convexity certification.
        if planes.iter().all(|(a, d)| {
            vertices
                .iter()
                .all(|v| wc::numeric::cross(d, &wc::numeric::sub(v, a)) >= Q::zero())
        }) {
            let ranges = planes
                .iter()
                .map(|(a, d)| {
                    let v = ps
                        .iter()
                        .map(|p| wc::numeric::cross(d, &wc::numeric::sub(p, a)))
                        .collect::<Vec<_>>();
                    (
                        v.iter().min().unwrap().clone(),
                        v.into_iter().max().unwrap(),
                    )
                })
                .collect::<Vec<_>>();
            return Ok(State {
                outside: ranges.iter().any(|(_, hi)| {
                    if interior {
                        *hi <= Q::zero()
                    } else {
                        *hi < Q::zero()
                    }
                }),
                inside: ranges.iter().all(|(lo, _)| {
                    if interior {
                        *lo >= Q::zero()
                    } else {
                        *lo > Q::zero()
                    }
                }),
            });
        }
    }
    if let Some(inside) = c.rectangle_membership(b, interior)? {
        return Ok(State {
            inside,
            outside: !inside,
        });
    }
    // Spline rectangle membership uses certified carrier bounds and exact
    // winding. An overlapping carrier bound remains unresolved: the stronger
    // disc-clearance predicate is not implemented for splines.
    if c.pieces().iter().any(|p| matches!(p.carrier(), wc::Carrier::BSpline(_))) {
        return Ok(State::UNKNOWN);
    }
    let centre = [(&b[0][0] + &b[1][0]) / q(2.), (&b[0][1] + &b[1][1]) / q(2.)];
    let d = wc::numeric::sub(&b[1], &b[0]);
    let r2 = wc::numeric::dot(&d, &d) / q(4.);
    // One circumscribed disc encloses the query rectangle. If no boundary
    // reaches it, its centre's exact winding proves uniform membership.
    let mut clear = true;
    for s in c.pieces() {
        if !s.clears_disc(&centre, &r2)? {
            clear = false;
            break;
        }
    }
    if clear {
        let inside = c.winding(&wc::ExactPoint::from_rational(centre))? != 0;
        Ok(State {
            inside,
            outside: !inside,
        })
    } else {
        Ok(State::UNKNOWN)
    }
}
fn planar(a: &Audited) -> R<Shape> {
    if let Some(s) = &a.arcs {
        if s.rim.is_none() {
            return Shape::prism(s.profile.cycle().clone(), [0, 1, 2], s.levels, &a.frame);
        }
    }
    if let Some(c) = &a.orthogonal {
        return Shape::csg(
            0,
            c.boxes
                .iter()
                .map(|b| Shape::cuboid(*b, &a.frame))
                .collect::<R<_>>()?,
        );
    }
    if a.arcs.is_some() || a.rounded.is_some() || a.corner.is_some() {
        return enclosure(&Solid::Planar(a.clone()));
    }
    let points = crate::planar_geometry::world_points(a, 1.)?;
    let mut planes = vec![];
    for face in &a.face_loops {
        let origin = &points[face[0]];
        let mut n = std::array::from_fn(|_| Q::zero());
        for i in 1..face.len() - 1 {
            let d = crate::planar_geometry::cross(
                &crate::planar_geometry::sub(&points[face[i]], origin),
                &crate::planar_geometry::sub(&points[face[i + 1]], origin),
            );
            for k in 0..3 {
                n[k] += &d[k];
            }
        }
        if a.frame.reversed().map_err(|_| no())? {
            n = n.map(|x| -x);
        }
        let d = crate::planar_geometry::dot(&n, origin);
        if n.iter().all(Zero::is_zero)
            || points
                .iter()
                .any(|p| crate::planar_geometry::dot(&n, p) > d)
        {
            return enclosure(&Solid::Planar(a.clone()));
        }
        planes.push((n, d));
    }
    if planes.is_empty() {
        return Err(no());
    }
    Ok(Shape {
        outer: box_of(&points),
        kind: Kind::Planes(planes),
    })
}
fn enclosure(s: &Solid) -> R<Shape> {
    let b = crate::broad_phase::bounds(s)?;
    Ok(Shape {
        outer: [
            b.min.map(|x| q(x) / q(1000.)),
            b.max.map(|x| q(x) / q(1000.)),
        ],
        kind: Kind::Enclosure,
    })
}
fn cylinder(c: &crate::cylinder::Cylinder) -> R<Shape> {
    let k = c.spec.axis()?;
    let i = (k + 1) % 3;
    let j = (k + 2) % 3;
    Shape::prism(
        crate::prism_stack::ring_profile([c.spec.bottom[i], c.spec.bottom[j]], c.spec.radius)?,
        [i, j, k],
        [
            c.spec.bottom[k].min(c.spec.top[k]),
            c.spec.bottom[k].max(c.spec.top[k]),
        ],
        &c.frame,
    )
}
/// Operand membership adapter for independent measurements. Replay CSG from
/// audited source operands instead of inspecting the output boundary. Existing
/// interference dispatch retains its conservative adapter set.
pub fn operand_shape(s: &Solid) -> R<Shape> {
    match s {
        Solid::Revolved(p) => Shape::revolved(&p.points,p.mode,&Placement::from_affine(p.frame).map_err(|_|no())?),
        Solid::PrismStack(p) => stack_shape(p,true),
        Solid::PrismHoles(p) => Shape::csg(1, p.sources().iter().map(operand_shape).collect::<R<_>>()?),
        Solid::Columns(p) => {
            let base = match &p.base {
                crate::prism_holes::Base::Planar(a) => operand_shape(&Solid::Planar(a.clone()))?,
                crate::prism_holes::Base::Cylinder(c) => cylinder(c)?,
                crate::prism_holes::Base::Revolved(t) => operand_shape(&Solid::Revolved(t.rev.clone()))?,
            };
            p.tools.iter().try_fold(base, |base,(op,tool)| Shape::csg(*op,vec![base,cylinder(tool)?]))
        }
        Solid::Planar(a) if a.arrangement.is_none() && a.arcs.is_none() && a.rounded.is_none()
            && a.corner.is_none() && a.chamfer.is_none() && a.orthogonal.is_none()
            && a.bound_to_construction && !a.cap.is_empty() => {
            let points = a.cap.iter().map(|p|[p.x,p.y]).collect::<Vec<_>>();
            Shape::prism(wc::Cycle::polygon(&points)?,[(a.axis+1)%3,(a.axis+2)%3,a.axis],a.levels,&a.frame)
        }
        Solid::Planar(_) | Solid::Model(_, _) | Solid::Cylinder(_)
        | Solid::Perforated(_) | Solid::Coaxial(_) | Solid::Conical(_)
        | Solid::Bicylinder(_) | Solid::CylinderTee(_) | Solid::Spherical(_)
        | Solid::Axial(_) | Solid::Lens(_) | Solid::PerforatedChamfer(_) | Solid::Placed(_) => shape(s),
    }
}
fn stack_shape(p: &crate::prism_stack::PrismStack, polar: bool) -> R<Shape> {
            let leaves = p
                .leaves
                .iter()
                .map(|l| {
                    match &l.meridian {
                        None => Shape::prism(l.profile.clone(),l.axes,l.levels,&l.frame),
                        Some(points) if polar => Shape::revolved(points,l.axes[2],&l.frame),
                        Some(_) => Err(no()),
                    }
                })
                .collect::<R<Vec<_>>>()?;
            fn expr(e: &crate::prism_stack::Expr, leaves: &[Shape]) -> R<Shape> {
                match e {
                    crate::prism_stack::Expr::Leaf(i) => clone_shape(&leaves[*i]),
                    crate::prism_stack::Expr::Op(op, xs) => {
                        Shape::csg(*op, xs.iter().map(|x| expr(x, leaves)).collect::<R<_>>()?)
                    }
                }
            }
            expr(&p.expr, &leaves)
}
pub fn shape(s: &Solid) -> R<Shape> {
    match s {
        Solid::Model(_, _) | Solid::Placed(_) if s.curved_model() => Err(crate::polyhedron::Refused("boolean/ssi-row-unavailable:model/curved-interference".into())),
        Solid::Planar(a) | Solid::Model(a, _) => planar(a),
        Solid::Cylinder(c) => cylinder(c),
        Solid::PrismStack(p) => stack_shape(p,false),
        Solid::Perforated(p) => {
            let mut xs = vec![planar(&p.base)?];
            for h in &p.holes {
                let k = h.axis()?;
                let i = (k + 1) % 3;
                let j = (k + 2) % 3;
                xs.push(Shape::prism(
                    crate::prism_stack::ring_profile([h.bottom[i], h.bottom[j]], h.radius)?,
                    [i, j, k],
                    [h.bottom[k].min(h.top[k]), h.bottom[k].max(h.top[k])],
                    &p.base.frame,
                )?);
            }
            Shape::csg(1, xs)
        }
        Solid::Coaxial(c) => {
            let frame =
                Placement::from_frames(&c.body, wonky_contract::FrameId(1)).map_err(|_| no())?;
            let k = c.axis;
            let i = (k + 1) % 3;
            let j = (k + 2) % 3;
            let mut slices = vec![];
            for slice in &c.slices {
                let profile = |r| crate::prism_stack::ring_profile([c.center[i], c.center[j]], r);
                let outer = Shape::prism(
                    profile(slice.outer)?,
                    [i, j, k],
                    [slice.z0, slice.z1],
                    &frame,
                )?;
                slices.push(if slice.inner == 0. {
                    outer
                } else {
                    Shape::csg(
                        1,
                        vec![
                            outer,
                            Shape::prism(
                                profile(slice.inner)?,
                                [i, j, k],
                                [slice.z0, slice.z1],
                                &frame,
                            )?,
                        ],
                    )?
                });
            }
            Shape::csg(0, slices)
        }
        Solid::PrismHoles(_)
        | Solid::Columns(_)
        | Solid::Revolved(_)
        | Solid::Placed(_)
        | Solid::Conical(_)
        | Solid::Bicylinder(_)
        | Solid::CylinderTee(_)
        | Solid::Spherical(_)
        | Solid::Axial(_)
        | Solid::Lens(_)
        | Solid::PerforatedChamfer(_) => enclosure(s),
    }
}
fn clone_shape(s: &Shape) -> R<Shape> {
    Ok(Shape {
        outer: s.outer.clone(),
        kind: match &s.kind {
            Kind::Prism {
                profile,
                axes,
                levels,
                inverse,
            } => Kind::Prism {
                profile: profile.clone(),
                axes: *axes,
                levels: levels.clone(),
                inverse: inverse.clone(),
            },
            Kind::Revolved {profile,axis,inverse} => Kind::Revolved {profile:profile.clone(),axis:*axis,inverse:inverse.clone()},
            Kind::Planes(p) => Kind::Planes(p.clone()),
            Kind::Csg(op, xs) => Kind::Csg(*op, xs.iter().map(clone_shape).collect::<R<_>>()?),
            Kind::Enclosure => Kind::Enclosure,
        },
    })
}
// Sufficient inclusion of an entire source bound in a negative leaf. CSG
// difference/intersection inherit supersets from their positive children, so
// neither holes nor engraving need to be rebuilt for a clearance certificate.
#[cfg(test)]
fn contained(inner: &Shape, outer: &Shape, d: &Q) -> R<bool> {
    contained_near(inner, outer, d, None)
}
fn contained_near(inner: &Shape, outer: &Shape, d: &Q, positive: Option<&Box3>) -> R<bool> {
    if outer.state(&expanded(&inner.outer, d), false)?.inside {
        return Ok(true);
    }
    match &inner.kind {
        Kind::Csg(0, xs) => {
            for x in xs {
                if !contained_near(x, outer, d, positive)? {
                    return Ok(false);
                }
            }
            return Ok(true);
        }
        Kind::Csg(1, xs) => return contained_near(&xs[0], outer, d, positive),
        Kind::Csg(2, xs) => {
            for x in xs {
                if contained_near(x, outer, d, positive)? {
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        Kind::Csg(_, _) => return Err(no()),
        Kind::Planes(_) | Kind::Enclosure | Kind::Prism { .. } | Kind::Revolved {..} => {}
    }
    let (
        Kind::Prism {
            profile: ip,
            axes: ia,
            levels: il,
            inverse: ii,
        },
        Kind::Prism {
            profile: op,
            axes: oa,
            levels: ol,
            inverse: oi,
        },
    ) = (&inner.kind, &outer.kind)
    else {
        return Ok(false);
    };
    let source = ii.inverse();
    let origin = oi.point(source.origin());
    let columns = source.columns().each_ref().map(|c| oi.vector(c));
    let [x, y, z] = *oa;
    let [u, v, w] = *ia;
    if !columns[u][z].is_zero()
        || !columns[v][z].is_zero()
        || !columns[w][x].is_zero()
        || !columns[w][y].is_zero()
    {
        return Ok(false);
    }
    let a = [columns[u][x].clone(), columns[u][y].clone()];
    let b = [columns[v][x].clone(), columns[v][y].clone()];
    if wc::numeric::dot(&a, &a) != q(1.)
        || wc::numeric::dot(&b, &b) != q(1.)
        || !wc::numeric::dot(&a, &b).is_zero()
    {
        return Ok(false);
    }
    let rows = |k: usize| oi.columns().iter().map(|c| c[k].abs()).sum::<Q>();
    let axial_margin = d * rows(z);
    let levels = il.each_ref().map(|h| &origin[z] + &columns[w][z] * h);
    let lo = levels[0].clone().min(levels[1].clone());
    let hi = levels[0].clone().max(levels[1].clone());
    if &lo - &axial_margin <= ol[0] || &hi + &axial_margin >= ol[1] {
        // Coincident source caps need not be a contact with the remaining body.
        // For a non-protruding source, certify the entire relevant axial slab:
        // (source+d) intersect (positive enclosure+d) must be strictly in the
        // cutter. Both dilations are exact enclosures; nothing is sampled away.
        if lo < ol[0] || hi > ol[1] {
            return Ok(false);
        }
        let Some(positive) = positive else {
            return Ok(false);
        };
        let nearby = mapped_box(&expanded(positive, d), oi);
        if (&lo - &axial_margin).max(nearby[0][z].clone()) <= ol[0]
            || (&hi + &axial_margin).min(nearby[1][z].clone()) >= ol[1]
        {
            return Ok(false);
        }
    }
    if let (Some((ic, ir2)), Some((oc, or2))) = (ip.circular_region(), op.circular_region()) {
        let centre = [
            &origin[x] + &a[0] * &ic[0] + &b[0] * &ic[1],
            &origin[y] + &a[1] * &ic[0] + &b[1] * &ic[1],
        ];
        let radius = |r2: &Q| -> R<wonky_num::Iv> {
            Ok(crate::probe_exact::enclose(r2).map_err(|_| no())?.sqrt())
        };
        let gap = q(radius(&or2)?.lo()) - q(radius(&ir2)?.hi()) - d * (rows(x) + rows(y));
        if gap <= Q::zero() {
            return Ok(false);
        }
        let dc = wc::numeric::sub(&centre, &oc);
        return Ok(wc::numeric::dot(&dc, &dc) < &gap * &gap);
    }
    // Before boundary refinement, require the enclosure itself to fit the
    // outer enclosure. Failing this sufficient filter is only inconclusive.
    if (0..3)
        .any(|k| inner.outer[0][k] < outer.outer[0][k] || inner.outer[1][k] > outer.outer[1][k])
    {
        return Ok(false);
    }
    let map =
        wc::PlaneMap::isometry([origin[x].clone(), origin[y].clone()], a, b).ok_or_else(no)?;
    op.contains_region_enclosure(&ip.mapped(&map)?, &[d * rows(x), d * rows(y)])
        .map_err(Into::into)
}
fn separated(a: &Shape, b: &Shape, d: &Q) -> R<bool> {
    if a.state(&expanded(&b.outer, d), false)?.outside
        || b.state(&expanded(&a.outer, d), false)?.outside
    {
        return Ok(true);
    }
    for (left, right) in [(a, b), (b, a)] {
        match &left.kind {
            Kind::Csg(0, xs) => {
                let mut all = true;
                for x in xs {
                    if !separated(x, right, d)? {
                        all = false;
                        break;
                    }
                }
                if all {
                    return Ok(true);
                }
            }
            Kind::Csg(1, xs) => {
                for x in &xs[1..] {
                    if contained_near(right, x, d, Some(&xs[0].outer))? {
                        return Ok(true);
                    }
                }
                if separated(&xs[0], right, d)? {
                    return Ok(true);
                }
            }
            Kind::Csg(2, xs) => {
                for x in xs {
                    if separated(x, right, d)? {
                        return Ok(true);
                    }
                }
            }
            Kind::Csg(_, _) => return Err(no()),
            Kind::Planes(_) | Kind::Enclosure | Kind::Prism { .. } | Kind::Revolved {..} => {}
        }
    }
    Ok(false)
}
fn extrusion_axis(s: &Shape) -> Option<usize> {
    match &s.kind {
        Kind::Prism { axes, inverse, .. } => {
            let row = inverse.columns().each_ref().map(|c| &c[axes[2]]);
            let nonzero = (0..3).filter(|&k| !row[k].is_zero()).collect::<Vec<_>>();
            if nonzero.len() == 1 {
                Some(nonzero[0])
            } else {
                None
            }
        }
        Kind::Csg(_, xs) => {
            let axis = extrusion_axis(xs.first()?)?;
            xs.iter()
                .all(|x| extrusion_axis(x) == Some(axis))
                .then_some(axis)
        }
        Kind::Planes(_) | Kind::Enclosure | Kind::Revolved {..} => None,
    }
}
/// Cover the common enclosure, splitting only inconclusive boxes. A failed or
/// exhausted cover is not evidence of contact or overlap.
fn cover(a: &Shape, b: &Shape, root: Box3, d: &Q, interior: bool) -> R<bool> {
    // Never discard an axial interval: every query still tests the whole box.
    // When both expressions share a coordinate extrusion axis, refine only the
    // profile plane. Splitting a constant profile along that axis adds no facts.
    let axis = extrusion_axis(a).filter(|axis| extrusion_axis(b) == Some(*axis));
    let mut todo = vec![(root, 0)];
    let mut work = 0;
    while let Some((box3, depth)) = todo.pop() {
        work += 1;
        if work > 256 {
            return Ok(false);
        }
        let query = expanded(&box3, d);
        let sa = a.state(&query, interior)?;
        if sa.outside {
            continue;
        }
        let sb = b.state(&query, interior)?;
        if sb.outside {
            continue;
        }
        if sa.inside && sb.inside {
            return Ok(false);
        }
        if depth >= 18 {
            return Ok(false);
        }
        let k = (0..3)
            .filter(|k| Some(*k) != axis)
            .max_by_key(|&k| &box3[1][k] - &box3[0][k])
            .unwrap();
        if box3[0][k] == box3[1][k] {
            return Ok(false);
        }
        let mid = (&box3[0][k] + &box3[1][k]) / q(2.);
        let mut left = box3.clone();
        let mut right = box3;
        left[1][k] = mid.clone();
        right[0][k] = mid;
        todo.push((right, depth + 1));
        todo.push((left, depth + 1));
    }
    Ok(true)
}
fn contact(a: &Shape, b: &Shape, root: &Box3) -> R<bool> {
    // Grid points only propose witnesses; exact surviving-material membership
    // is required. The caller separately certifies no positive-volume overlap.
    for mask in 0..125 {
        let mut m = mask;
        let p = std::array::from_fn(|k| {
            let i = m % 5;
            m /= 5;
            &root[0][k] + (&root[1][k] - &root[0][k]) * q(i as f64) / q(4.)
        });
        if a.witness(&p)? && b.witness(&p)? {
            return Ok(true);
        }
    }
    Ok(false)
}
const ABUT:&str="{\"type\":\"ABUT_NO_CLASS\",\"kind\":\"abutment\",\"distanceMm\":0,\"distanceBoundMm\":0,\"distanceMeaning\":\"bounded-exact-distance\"}";
pub(crate) fn pair(a: &Shape, b: &Shape) -> R<String> {
    // Enclosure-only adapters cannot decide an overlapping pair. Refinement
    // cannot recover information absent from the adapter, so defer at once.
    if matches!(a.kind, Kind::Enclosure) || matches!(b.kind, Kind::Enclosure) {
        return Ok("null".into());
    }
    let d = q(1.) / q(1_024_000.);
    let clear = || -> R<String> {
        let lower = crate::probe_exact::enclose(&(&d * q(1000.)))
            .map_err(|_| no())?
            .lo();
        Ok(format!("{{\"type\":\"NONE\",\"kind\":\"clear\",\"distanceLowerBoundMm\":{lower:?},\"distanceMm\":null,\"distanceBoundMm\":null,\"distanceMeaning\":\"certified-lower-bound\"}}"))
    };
    // Exact enclosure cap equality alone excludes positive volume. Check its
    // surviving contact witness before attempting costly positive-margin proofs.
    if let Some(root) = common(&a.outer, &b.outer) {
        if (0..3).any(|k| root[0][k] == root[1][k]) && contact(a, b, &root)? {
            return Ok(ABUT.into());
        }
    }
    if separated(a, b, &d)? {
        return clear();
    }
    // Test undilated interiors before margin refinement. Exact cap contacts
    // should not spend their entire work budget trying to prove a positive gap.
    if let Some(root) = common(&a.outer, &b.outer) {
        let degenerate = (0..3).any(|k| root[0][k] == root[1][k]);
        if degenerate || cover(&a, &b, root.clone(), &Q::zero(), true)? {
            if contact(a, b, &root)? {
                return Ok(ABUT.into());
            }
        }
    }
    // Expanding every cover box by d encloses both ends of a hypothetical
    // pair less than d apart, whose midpoint is in this root. No minimum is claimed.
    if let Some(root) = common(&expanded(&a.outer, &d), &expanded(&b.outer, &d)) {
        if cover(&a, &b, root, &d, false)? {
            return clear();
        }
    }
    Ok("null".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame() -> Placement {
        let body = crate::orthogonal::cuboid(
            wonky_contract::BodyKey {
                id: [1, 2, 3, 4],
                revision: 0,
            },
            [0.; 3],
            [1.; 3],
        )
        .unwrap();
        crate::polyhedron::audit(&body.check().unwrap())
            .unwrap()
            .frame
    }
    fn cube(lo: [f64; 3], hi: [f64; 3]) -> Shape {
        Shape::cuboid([lo, hi], &frame()).unwrap()
    }
    #[test]
    fn exact_linear_box_ranges_equal_all_corner_extrema() {
        let b=[[q(-2.),q(0.125),q(-1e-20)],[q(3.),q(0.75),q(2e-20)]];
        for n in [[0.,1.,0.],[-2.,3.,-4.],[1e20,-1e-20,0.5]].map(|n|n.map(q)) {
            let d=q(0.3);
            let values=corners(&b).iter().map(|p|crate::planar_geometry::dot(&n,p)-&d).collect::<Vec<_>>();
            assert_eq!(plane_range(&n,&d,&b),(values.iter().min().unwrap().clone(),values.into_iter().max().unwrap()));
        }
    }

    #[test]
    fn spline_cells_use_exact_rectangle_membership_or_remain_unresolved() {
        let spline = wc::bspline::BSpline::bezier_f64(&[[0.,0.],[0.5,1.],[1.,0.]]).unwrap();
        let (a,b) = (spline.domain().0.clone(), spline.domain().1.clone());
        let profile = wc::Cycle::new(vec![
            wc::Trimmed::spline(std::sync::Arc::new(spline),a,b).unwrap(),
            wc::Trimmed::line([1.,0.],[0.,0.]),
        ]);
        let unknown = profile_state(&profile,&[[q(0.4),q(0.1)],[q(0.6),q(0.4)]],true).unwrap();
        assert!(!unknown.inside && !unknown.outside);
        let outside = profile_state(&profile,&[[q(2.),q(2.)],[q(3.),q(3.)]],true).unwrap();
        assert!(outside.outside && !outside.inside);
    }

    #[test]
    fn rational_profile_proofs_propagate_quadratic_endpoint_refusal() {
        let points = [[0.,0.],[1.,0.],[1.,1.],[0.,1.]].map(|p|
            wc::ExactPoint::from_quadratic(p.map(q),[q(1.),q(0.)],q(2.)).unwrap());
        let profile = wc::Cycle::new((0..4).map(|i| wc::Trimmed::new(
            [points[i].clone(),points[(i+1)%4].clone()],wc::Carrier::Line).unwrap()).collect());
        let name = wc::Refusal::CrossingNeedsAlgebraicVertex.name();
        assert_eq!(Shape::prism(profile.clone(),[0,1,2],[0.,1.],&frame()).err().unwrap().0,name);
        let b = [[q(1.5),q(0.25)],[q(1.75),q(0.5)]];
        assert_eq!(profile_state(&profile,&b,false).err().unwrap().0,name);
    }
    #[test]
    fn contact_needs_both_an_empty_interior_and_surviving_material() {
        let a = cube([0.; 3], [1.; 3]);
        let touch = cube([1., 0., 0.], [2., 1., 1.]);
        assert!(pair(&a, &touch).unwrap().contains("ABUT_NO_CLASS"));
        let overlap = cube([1. - 2f64.powi(-30), 0., 0.], [2., 1., 1.]);
        assert_eq!(pair(&a, &overlap).unwrap(), "null");
        let wall = Shape::csg(1, vec![a, cube([0.125, 0.125, 0.5], [0.875, 0.875, 1.5])]).unwrap();
        let former_cap = [q(0.5), q(0.5), q(1.)];
        assert!(!wall.witness(&former_cap).unwrap());
        assert!(pair(&wall, &cube([0.25, 0.25, 1.], [0.75, 0.75, 1.25]))
            .unwrap()
            .contains("certified-lower-bound"));
    }
    #[test]
    fn concave_profile_cannot_use_corner_containment_and_exhaustion_is_not_evidence() {
        let profile = wc::Cycle::polygon(&[
            [0., 0.],
            [3., 0.],
            [3., 3.],
            [2., 3.],
            [2., 1.],
            [1., 1.],
            [1., 3.],
            [0., 3.],
        ])
        .unwrap();
        let b = [[q(0.5), q(1.5)], [q(2.5), q(2.5)]];
        let s = profile_state(&profile, &b, false).unwrap();
        assert!(!s.inside && !s.outside);
        let a = Shape::prism(profile, [0, 1, 2], [0., 1.], &frame()).unwrap();
        let actual_overlap = cube([0.5, 1.5, 0.25], [2.5, 2.5, 0.75]);
        assert_eq!(pair(&a, &actual_overlap).unwrap(), "null");
        let unknown = Shape {
            outer: a.outer.clone(),
            kind: Kind::Enclosure,
        };
        assert!(!cover(&a, &unknown, a.outer.clone(), &Q::zero(), false).unwrap());
        assert_eq!(pair(&a, &unknown).unwrap(), "null");
    }
    #[test]
    fn coincident_source_caps_need_a_certified_positive_overlap_slab() {
        let insert = Shape::prism(
            crate::prism_stack::ring_profile([0., 0.], 0.125).unwrap(),
            [0, 1, 2],
            [0., 1.],
            &frame(),
        )
        .unwrap();
        let cutter = Shape::prism(
            crate::prism_stack::ring_profile([0., 0.], 0.25).unwrap(),
            [0, 1, 2],
            [0., 1.],
            &frame(),
        )
        .unwrap();
        let positive = cube([-0.5, -0.5, 0.25], [0.5, 0.5, 0.75]);
        let d = q(0.001);
        assert!(!contained(&insert, &cutter, &d).unwrap());
        assert!(contained_near(&insert, &cutter, &d, Some(&positive.outer)).unwrap());
        let exposed_cap = cube([-0.5, -0.5, 0.], [0.5, 0.5, 0.75]);
        assert!(!contained_near(&insert, &cutter, &d, Some(&exposed_cap.outer)).unwrap());
        let protruding = Shape::prism(
            crate::prism_stack::ring_profile([0., 0.], 0.125).unwrap(),
            [0, 1, 2],
            [-0.25, 1.25],
            &frame(),
        )
        .unwrap();
        assert!(!contained_near(&protruding, &cutter, &d, Some(&positive.outer)).unwrap());
    }
    #[test]
    fn inclusion_is_exact_under_affine_frames_and_never_uses_a_near_isometry() {
        let small = Shape::prism(
            crate::prism_stack::ring_profile([0., 0.], 0.125).unwrap(),
            [0, 1, 2],
            [0.25, 0.75],
            &frame(),
        )
        .unwrap();
        let large = Shape::prism(
            crate::prism_stack::ring_profile([0., 0.], 0.25).unwrap(),
            [0, 1, 2],
            [0., 1.],
            &frame(),
        )
        .unwrap();
        assert!(contained(&small, &large, &q(0.001)).unwrap());
        let stretched = frame()
            .then(&crate::placement::Post::Rows {
                translation: [0.; 3],
                rows: [[4., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            })
            .unwrap();
        let changed = Shape::prism(
            crate::prism_stack::ring_profile([0., 0.], 0.125).unwrap(),
            [0, 1, 2],
            [0.25, 0.75],
            &stretched,
        )
        .unwrap();
        assert!(!contained(&changed, &large, &q(0.001)).unwrap());
        let exact = stretched.exact_frame().unwrap();
        let b = [
            [q(-0.125), q(-0.125), q(0.25)],
            [q(0.125), q(0.125), q(0.75)],
        ];
        assert_eq!(
            mapped_box(&b, &exact),
            box_of(
                &corners(&b)
                    .iter()
                    .map(|p| exact.point(p))
                    .collect::<Vec<_>>()
            )
        );
    }
}
