//! Exact changes of construction frame. Canonical comparison transforms the
//! analytical point sets, not observation caches or rounded world vertices.
use super::*;
use num_traits::Signed;
use wonky_curve::{Carrier, ExactPoint, Trimmed};

fn mapped(model: &Model, target: &Frame) -> Result<(Draft, Vec<VertexKey>)> {
    let mut d = model.draft.clone();
    let map = target.relation_from(&d.placement).map;
    let inverse = map.inverse();
    let reflected = dot(
        &map.columns()[0],
        &cross(&map.columns()[1], &map.columns()[2]),
    )
    .is_negative();
    let frame = |f: &Frame| {
        Frame::new(
            map.point(f.origin()),
            f.columns().clone().map(|x| map.vector(&x)),
        )
    };
    let keys = model
        .keys
        .iter()
        .map(|v| match v {
            VertexKey::Rational(p) => Ok(VertexKey::Rational(map.point(p))),
            VertexKey::Quadratic(p) => Ok(p.mapped(&map)?.key()),
            VertexKey::Real(p)=>Ok(VertexKey::Real(super::algebraic::mapped(p,&map))),
        })
        .collect::<Result<Vec<_>>>()?;
    for (v, key) in d.vertices.iter_mut().zip(&keys) {
        v.def = match key {
            VertexKey::Rational(p) => VertexDef::Rational(p.clone()),
            VertexKey::Quadratic(p) => VertexDef::Quadratic(p.clone()),
            VertexKey::Real(p)=>VertexDef::Real(p.clone()),
        };
    }
    for c in &mut d.curves {
        // A Q(√d) line maps exactly under the rational affine map (its point
        // as a point, its direction as a vector); `line` keeps it radical
        // only while a coordinate stays irrational.
        if let Curve3::RadicalLine { p, d: dir } = &c.geometry {
            let origin = super::algebraic::lift(map.origin());
            let direction = super::algebraic::sub(&super::algebraic::mapped(dir, &map), &origin);
            c.geometry = super::algebraic::line(super::algebraic::mapped(p, &map), direction);
            continue;
        }
        match &mut c.geometry {
            Curve3::Line { p, d } => {
                *p = map.point(p);
                *d = map.vector(d);
            }
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/reframe-unavailable")),
            Curve3::Circle(c) => *c = Circle3::new(frame(c.frame()?)?, c.radius2())?,
            // Height and radius are own-frame coordinates: moving the
            // rational frame moves the point set exactly.
            Curve3::RadicalCircle(c) => c.frame = frame(&c.frame)?,
            Curve3::RadicalLine { .. } => unreachable!("mapped above"),
        }
    }
    for s in &mut d.surfaces {
        match &mut s.carrier {
            Carrier3::Rotated(_) => return Err(Refused("model/rotated/reframe-consumer")),
            Carrier3::Plane(p) => {
                p.o = map.point(&p.o);
                p.x = map.vector(&p.x);
                p.n = std::array::from_fn(|i| dot(&inverse.columns()[i], &p.n));
            }
            Carrier3::TranslatedCylinder(_) => return Err(Refused("model/translated-cylinder/reframe-unavailable")),
            Carrier3::Cylinder(c) => *c = Cylinder3::new(frame(c.frame()?)?, c.radius2())?,
            Carrier3::Cone(c) => c.frame = frame(&c.frame)?,
            Carrier3::Sphere(c) => c.frame = frame(&c.frame)?,
            Carrier3::Torus(c) => c.frame = frame(&c.frame)?,
            Carrier3::RadicalPlane(_) => {
                return Err(Refused("boolean/ssi-row-unavailable:radical/reframe"))
            }
        }
    }
    if reflected {
        for lp in &mut d.loops {
            lp.coedges.reverse();
        }
        for co in &mut d.coedges {
            co.forward = !co.forward;
        }
    }
    d.placement = target.clone();
    Ok((d, keys))
}
impl Model {
    /// Exact canonical point sets in a common frame, including affine images
    /// of circles and quadrics. No audit of a changed chart is needed: this
    /// operation emits only canonical geometry/topology, never a new Model.
    pub fn canonical_in(&self, target: &Frame) -> Result<Canonical> {
        let (d, keys) = mapped(self, target)?;
        Ok(canonical::of(&d, &keys))
    }

    /// The same body moved by the exact world map `by`: only the construction
    /// placement is composed, every chart-local coordinate stays as it was.
    /// A reflection would reverse every face orientation and refuses here.
    pub fn moved(&self, by: &Frame) -> Result<Model> {
        let [x, y, z] = by.columns();
        if !dot(x, &cross(y, z)).is_positive() {
            return Err(Refused("model/placement-reflection"));
        }
        let mut d = self.draft.clone();
        d.placement = Frame::new(
            by.point(d.placement.origin()),
            d.placement.columns().clone().map(|c| by.vector(&c)),
        )?;
        d.check()
    }

    /// Rebuild the charts after changing construction frame and run G1-G8.
    /// A noncircular planar image refuses instead of becoming a polygon.
    pub fn reframed(&self, target: &Frame) -> Result<Model> {
        if &self.draft.placement == target {
            return Ok(self.clone());
        }
        let (mut d, keys) = mapped(self, target)?;
        // Scaling the plane equation preserves the exact point set. A
        // rational unit normal restores equally scaled radial chart axes for
        // similarity images of rings; an elliptic image still refuses below.
        for surface in &mut d.surfaces {
            if let Carrier3::Plane(p) = &mut surface.carrier {
                if let Some(length) = wonky_curve::numeric::exact_root(&dot(&p.n, &p.n)) {
                    p.n = p.n.clone().map(|x| x / &length);
                }
            }
        }
        for f in &d.faces {
            match &d.surfaces[f.surface.index()].carrier {
                Carrier3::Rotated(_) => return Err(Refused("model/rotated/reframe-consumer")),
                Carrier3::Plane(p) => {
                    for lp in &f.loops {
                        for id in &d.loops[lp.index()].coedges {
                            let co = &mut d.coedges[id.index()];
                            let edge = &d.edges[co.edge.index()];
                            // Chart images of the coedge's start and end vertices.
                            let ends = |ends: &[VertexId; 2]| -> Result<[ExactPoint; 2]> {
                                let ends = if co.forward { *ends } else { [ends[1], ends[0]] };
                                let [a, b] = ends.map(|v| match &keys[v.index()] {
                                    VertexKey::Rational(p3) => p.chart(p3).map(ExactPoint::from_rational),
                                    VertexKey::Quadratic(_) | VertexKey::Real(_) => Err(Refused(
                                        "boolean/ssi-row-unavailable:quadratic/reframe-pcurve",
                                    )),
                                });
                                Ok([a?, b?])
                            };
                            co.pcurve = match (&d.curves[edge.curve.index()].geometry, &edge.bounds)
                            {
                                (Curve3::Circle(c), Bounds::Ring) => {
                                    periodic::plane_ring(c, p, co.forward)?
                                }
                                // The arc on its chart ring in the coedge's
                                // sense, as G3 expects it.
                                (Curve3::Circle(c), Bounds::Segment(v)) => {
                                    let [a, b] = ends(v)?;
                                    periodic::plane_ring(c, p, co.forward)?.trim(a, b).map_err(|e| Refused(e.name()))?
                                }
                                (Curve3::Line { .. }, Bounds::Segment(v)) => {
                                    Trimmed::new(ends(v)?, Carrier::Line)
                                        .map_err(|e| Refused(e.name()))?
                                }
                                _ => {
                                    return Err(Refused(
                                        "boolean/ssi-row-unavailable:curve/reframe-pcurve",
                                    ))
                                }
                            };
                        }
                    }
                }
                Carrier3::TranslatedCylinder(_) => return Err(Refused("model/translated-cylinder/reframe-unavailable")),
                Carrier3::Cylinder(_) | Carrier3::Cone(_) | Carrier3::Torus(_) => {}
                // Sphere charts are own-frame coordinates, which a similarity
                // image of the frame keeps (G1-G8 below re-audit them); any
                // other image is no sphere.
                Carrier3::Sphere(s) => {
                    let [x, y, z] = s.frame.columns();
                    let k = dot(x, x);
                    if dot(y, y) != k || dot(z, z) != k || !dot(x, y).is_zero() || !dot(x, z).is_zero() || !dot(y, z).is_zero() {
                        return Err(Refused("boolean/ssi-row-unavailable:sphere/reframe-chart"));
                    }
                }
                Carrier3::RadicalPlane(_) => {
                    return Err(Refused("boolean/ssi-row-unavailable:radical/reframe-chart"))
                }
            }
        }
        d.check()
    }
}
