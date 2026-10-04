//! Exact straight-edge planar geometry over admitted radical and real fields.
//! Rational carriers are normalized back to their original representation.
use super::*;
use wonky_curve::{radical::Radical, ExactPoint};
pub type RPoint = [Radical; 3];
pub fn lift(p: &Point) -> RPoint {
    p.clone().map(Radical::from)
}
pub fn sub(a: &RPoint, b: &RPoint) -> RPoint {
    std::array::from_fn(|k| &a[k] - &b[k])
}
pub fn dot(a: &RPoint, b: &RPoint) -> Radical {
    (0..3).fold(Radical::default(), |s, k| s + &a[k] * &b[k])
}
pub fn cross(a: &RPoint, b: &RPoint) -> RPoint {
    std::array::from_fn(|k| &a[(k + 1) % 3] * &b[(k + 2) % 3] - &a[(k + 2) % 3] * &b[(k + 1) % 3])
}
pub fn zero(p: &RPoint) -> bool {
    p.iter().all(Radical::is_zero)
}
pub fn rational(p: &RPoint) -> Option<Point> {
    let v = p
        .iter()
        .map(Radical::rational)
        .collect::<Option<Vec<_>>>()?;
    Some(std::array::from_fn(|k| v[k].clone()))
}
pub fn line(p: RPoint, d: RPoint) -> Curve3 {
    match (rational(&p), rational(&d)) {
        (Some(p), Some(d)) => Curve3::Line { p, d },
        _ => Curve3::RadicalLine { p, d },
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RadicalPlane3 {
    pub o: RPoint,
    pub n: RPoint,
    pub x: RPoint,
}
impl From<&Plane3> for RadicalPlane3 {
    fn from(p: &Plane3) -> Self {
        Self {
            o: lift(&p.o),
            n: lift(&p.n),
            x: lift(&p.x),
        }
    }
}
impl RadicalPlane3 {
    pub fn y(&self) -> RPoint {
        cross(&self.n, &self.x)
    }
    pub fn side(&self, p: &RPoint) -> Radical {
        dot(&self.n, &sub(p, &self.o))
    }
    pub fn chart_coordinates(&self, p: &RPoint) -> Result<[Radical; 2]> {
        let y = self.y();
        let xx = dot(&self.x, &self.x);
        let yy = dot(&y, &y);
        if xx.is_zero() || yy.is_zero() {
            return Err(Refused("model/g1-plane-degenerate"));
        }
        let d = sub(p, &self.o);
        Ok([dot(&d, &self.x) / xx, dot(&d, &y) / yy])
    }
    pub fn chart(&self, p: &RPoint) -> Result<ExactPoint> {
        { let p=self.chart_coordinates(p)?; if p.iter().any(|v|v.is_real()){ExactPoint::from_real_coordinates(p)}else{ExactPoint::from_coordinates(p)} }.map_err(|e| Refused(e.name()))
    }
    pub fn point(&self, uv: &[Radical; 2]) -> RPoint {
        let y = self.y();
        std::array::from_fn(|k| &self.o[k] + &uv[0] * &self.x[k] + &uv[1] * &y[k])
    }
    pub fn carrier(&self) -> Carrier3 {
        match (rational(&self.o), rational(&self.n), rational(&self.x)) {
            (Some(o), Some(n), Some(x)) => Carrier3::Plane(Plane3 { o, n, x }),
            _ => Carrier3::RadicalPlane(self.clone()),
        }
    }
}
impl Carrier3 {
    /// Refuses a zero normal, on which every point would lie.
    pub fn exact_plane(&self) -> Result<RadicalPlane3> {
        let plane = match self {
            Self::Rotated(r) => {
                let base=r.base.exact_plane()?;
                let (sin,cos)=r.turn.exact_sin_cos()?;
                let apply = |p: &RPoint, vector: bool| -> Result<RPoint> {
                    let p=rational(p).ok_or(Refused("turn/field-tower"))?;
                    let o=r.point(&crate::zero())?;
                    let c=r.point(&p)?;
                    Ok(std::array::from_fn(|i| {
                        let value=Radical::from(c[i].c.clone())+&cos*&c[i].a+&sin*&c[i].b;
                        if vector {value-(Radical::from(o[i].c.clone())+&cos*&o[i].a+&sin*&o[i].b)} else {value}
                    }))
                };
                RadicalPlane3 {o:apply(&base.o,false)?,x:apply(&base.x,true)?,n:apply(&base.n,true)?}
            },
            Self::Plane(p) => RadicalPlane3::from(p),
            Self::RadicalPlane(p) => p.clone(),
            Self::Cylinder(_) | Self::TranslatedCylinder(_) | Self::Cone(_) | Self::Sphere(_) | Self::Torus(_) => {
                return Err(Refused("model/curved/planar-consumer"))
            }
        };
        if zero(&plane.n) {
            return Err(Refused("model/degenerate-carrier"));
        }
        Ok(plane)
    }
}
#[derive(Clone, Debug)]
pub struct RadicalPolyFace {
    pub carrier: RadicalPlane3,
    pub forward: bool,
    pub loops: Vec<Vec<VertexDef>>,
    pub provenance: Provenance,
}
pub fn radical_polyhedron(
    placement: Frame,
    label: Label,
    node: u32,
    faces: Vec<RadicalPolyFace>,
) -> Result<Draft> {
    super::poly::build(placement, label, node, faces)
}
/// Nearest-even observation, proved against exact midpoints. Enclosure
/// midpoints are proposals only; they do not necessarily round correctly.
pub fn nearest(x: &Radical) -> Result<f64> {
    if let Some(q) = x.rational() {
        return super::nearest(&q);
    }
    let mut m = x
        .enclosure()
        .map_err(|_| Refused("model/radical-observation-range"))?
        .m;
    for _ in 0..64 {
        let (lo, hi) = (m.next_down(), m.next_up());
        if !m.is_finite() || !lo.is_finite() || !hi.is_finite() {
            return Err(Refused("model/radical-observation-range"));
        }
        let midpoint = |a: f64, b: f64| {
            Radical::from(
                (Q::from_float(a).expect("finite") + Q::from_float(b).expect("finite"))
                    / Q::from_integer(2.into()),
            )
        };
        let upper = midpoint(m, hi);
        let lower = midpoint(lo, m);
        if x > &upper || (x == &upper && m.to_bits() & 1 != 0) {
            m = hi;
            continue;
        }
        if x < &lower || (x == &lower && m.to_bits() & 1 != 0) {
            m = lo;
            continue;
        }
        return Ok(m);
    }
    Err(Refused("model/radical-observation-budget"))
}
pub fn observe(p: &RPoint) -> Result<[f64; 3]> {
    wonky_curve::radical::guard(|| Ok([nearest(&p[0])?, nearest(&p[1])?, nearest(&p[2])?]))
        .map_err(|_| Refused("model/radical-observation-budget"))?
}
pub(super) fn volumes6(d: &Draft) -> Result<Vec<Radical>> {
    let keys = d
        .vertices
        .iter()
        .map(|v| v.def.key().map(|p| p.coordinates()))
        .collect::<Result<Vec<_>>>()?;
    d.solids
        .iter()
        .map(|solid| {
            let mut volume = Radical::default();
            for s in &solid.shells {
                for f in &d.shells[s.index()].faces {
                    let face = &d.faces[f.index()];
                    d.surfaces[face.surface.index()].carrier.exact_plane()?;
                    for l in &face.loops {
                        let ps = d.loops[l.index()]
                            .coedges
                            .iter()
                            .map(|c| {
                                let co = &d.coedges[c.index()];
                                match d.edges[co.edge.index()].bounds {
                                    Bounds::Segment(v) => {
                                        Ok(&keys[v[usize::from(!co.forward)].index()])
                                    }
                                    Bounds::Ring => {
                                        Err(Refused("model/g8-ring-volume-unsupported"))
                                    }
                                }
                            })
                            .collect::<Result<Vec<_>>>()?;
                        for k in 1..ps.len().saturating_sub(1) {
                            volume = volume + dot(ps[0], &cross(ps[k], ps[k + 1]));
                        }
                    }
                }
            }
            Ok(volume)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn radical_observations_resolve_midpoints_exactly() {
        let one = Q::from_integer(1.into());
        let mid = (&one + Q::from_float(1f64.next_up()).unwrap()) / Q::from_integer(2.into());
        let epsilon = Q::from_float(2f64.powi(-100)).unwrap();
        let delta = Radical::quadratic(Q::zero(), epsilon, Q::from_integer(2.into())).unwrap();
        assert_eq!(
            nearest(&(Radical::from(mid.clone()) + &delta)).unwrap(),
            1f64.next_up()
        );
        assert_eq!(nearest(&(Radical::from(mid) - &delta)).unwrap(), 1.);
        let root = Radical::quadratic(Q::zero(), one, Q::from_integer(2.into())).unwrap();
        assert_eq!(nearest(&root).unwrap(), 2f64.sqrt());
    }
}

pub fn mapped(p:&RPoint,frame:&Frame)->RPoint {
    std::array::from_fn(|k| (0..3).fold(Radical::from(frame.origin()[k].clone()),|v,i|v+&p[i]*&frame.columns()[i][k]))
}
