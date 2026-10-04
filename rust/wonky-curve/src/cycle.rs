//! A closed chain of trimmed pieces: winding, orientation, area and the Green
//! moments that the exact measures of a prism are built from. Everything here
//! is a fold over the piece operations of `trimmed`; only the digon shortcut of
//! `orientation` names a carrier (exhaustively).
use crate::carrier::{Carrier, PlaneMap};
use crate::numeric::{cross, enclose, finite, pt, q, Q};
use crate::point::ExactPoint;
use crate::refusal::{Refusal, R};
use crate::trimmed::Trimmed;
use num_traits::{Signed, Zero};
use wonky_num::Iv;

#[derive(Clone, Debug)]
pub struct Cycle {
    pieces: Vec<Trimmed>,
    // Immutable exact source geometry, so certified piece bounds can be reused
    // by repeated rectangle queries without recomputing carrier extrema.
    enclosures: std::sync::OnceLock<R<Vec<[crate::numeric::P; 2]>>>,
}

impl Cycle {
    /// A cycle from consecutive pieces (each piece ends where the next begins).
    pub fn new(pieces: Vec<Trimmed>) -> Self {
        Self { pieces, enclosures: std::sync::OnceLock::new() }
    }
    /// A counter-clockwise polygon of binary64 vertices. Fewer than three
    /// vertices or a zero enclosed area is `DegeneratePolygon`; a clockwise
    /// input is reversed.
    pub fn polygon(points: &[[f64; 2]]) -> R<Self> {
        if points.len() < 3 {
            return Err(Refusal::DegeneratePolygon);
        }
        let n = points.len();
        let pieces = (0..n)
            .map(|i| Trimmed::line(points[i], points[(i + 1) % n]))
            .collect::<Vec<_>>();
        let twice: Q = points
            .iter()
            .enumerate()
            .map(|(i, &a)| cross(&pt(a), &pt(points[(i + 1) % n])))
            .sum();
        if twice.is_zero() {
            return Err(Refusal::DegeneratePolygon);
        }
        let cycle = Self::new(pieces);
        Ok(if twice.is_negative() { cycle.reversed() } else { cycle })
    }
    pub fn green_symbolic(&self) -> R<crate::Green> {
        let mut out = crate::Green::default();
        for s in &self.pieces { out.add(s.green_symbolic()?)?; }
        Ok(out)
    }
    pub fn pieces(&self) -> &[Trimmed] {
        &self.pieces
    }
    pub fn len(&self) -> usize {
        self.pieces.len()
    }
    pub fn is_empty(&self) -> bool {
        self.pieces.is_empty()
    }
    /// The same cycle traversed the other way.
    pub fn reversed(&self) -> Self {
        Self::new(self.pieces.iter().rev().map(Trimmed::reversed).collect())
    }
    /// The cycle mapped through an exact nonsingular plane map, counter-clockwise
    /// again if the source was (a mirror reverses the traversal). Circular
    /// pieces refuse maps that do not preserve their radius.
    pub fn mapped(&self, map: &PlaneMap) -> R<Self> {
        let pieces = self
            .pieces
            .iter()
            .map(|s| s.mapped(map))
            .collect::<R<Vec<_>>>()?;
        let mapped = Self::new(pieces);
        Ok(if map.mirrors() { mapped.reversed() } else { mapped })
    }
    /// Exact winding number around a point that is not on the cycle
    /// (lower-inclusive, upper-exclusive horizontal ray).
    pub fn winding(&self, p: &ExactPoint) -> R<i32> {
        self.pieces.iter().map(|s| s.winding(p)).sum()
    }
    /// Closed containment: on the boundary counts as inside.
    pub fn contains(&self, p: &ExactPoint) -> R<bool> {
        for s in &self.pieces {
            if s.contains(p)? {
                return Ok(true);
            }
        }
        Ok(self.winding(p)? != 0)
    }
    /// The disc bounded by a simple audited CCW cycle made entirely of one
    /// circle. Multiple trimmed arcs and a periodic one-piece ring share this
    /// exact description; neither rounded centres nor angle caches are used.
    /// Rational-radius projection retained for existing rational-only consumers.
    pub fn circular_region(&self) -> Option<(crate::numeric::P, Q)> {
        let (c,r2)=self.circular_region_exact()?;
        Some((c,r2.rational()?))
    }
    pub fn circular_region_exact(&self) -> Option<(crate::numeric::P, crate::radical::Radical)> {
        let first = self.pieces.first()?;
        let Carrier::Circle(c) = first.carrier() else { return None; };
        if !c.ccw || !self.pieces.iter().all(|piece| match piece.carrier() {
            Carrier::Circle(other) => other.ccw && other.c == c.c && other.r2 == c.r2,
            Carrier::Line | Carrier::BSpline(_) => false,
        }) { return None; }
        if !self.pieces.iter().enumerate().all(|(i,piece)| piece.ends()[1] == self.pieces[(i+1)%self.pieces.len()].ends()[0]) { return None; }
        Some((c.c.rat().ok()?.clone(),c.r2.clone()))
    }
    /// Sufficient uniform membership of an exact axis-aligned rectangle.
    /// `interior` admits inside boundary points and excludes boundary-only
    /// outside points; otherwise both decisions are strict. None is inconclusive.
    pub fn rectangle_membership(&self, b: &[crate::numeric::P; 2], interior: bool) -> R<Option<bool>> {
        // A circle's supporting carrier is authoritative, not its rounded ends.
        if let Some((centre,r2)) = self.circular_region_exact() {
            let mut min = Q::zero();
            let mut max = Q::zero();
            for k in 0..2 {
                let lo = &b[0][k] - &centre[k];
                let hi = &b[1][k] - &centre[k];
                let near = if lo <= Q::zero() && hi >= Q::zero() { Q::zero() } else { lo.clone().abs().min(hi.clone().abs()) };
                let far = lo.abs().max(hi.abs());
                min += &near * &near;
                max += &far * &far;
            }
            if if interior { min >= r2 } else { min > r2 } { return Ok(Some(false)); }
            if if interior { max <= r2 } else { max < r2 } { return Ok(Some(true)); }
            return Ok(None);
        }
        // No boundary in a connected rectangle means the centre's exact winding
        // is uniform throughout it. Bounds include exact endpoint enclosures:
        // raw serialization caches alone must not certify this exclusion.
        for bounds in self.piece_enclosures()? {
            if !(0..2).any(|k| bounds[1][k] < b[0][k] || bounds[0][k] > b[1][k]) { return Ok(None); }
        }
        let centre = std::array::from_fn(|k| (&b[0][k] + &b[1][k]) / q(2.));
        Ok(Some(self.winding(&ExactPoint::from_rational(centre))? != 0))
    }
    /// Sufficient strict inclusion of a simple region and its rectangular
    /// dilation in another simple region. Cover the exact boundary pieces,
    /// refining them through rational witnesses, not a polygonal approximation.
    /// A closed Jordan boundary strictly inside a hole-free Jordan region also
    /// encloses only that region's interior. Dilation adds only neighbourhoods
    /// of this boundary. Work exhaustion is inconclusive, never inclusion.
    pub fn contains_region_enclosure(&self, inner: &Cycle, margin: &crate::numeric::P) -> R<bool> {
        if inner.is_empty() || self.is_empty() || margin.iter().any(|x|x.is_negative()) { return Ok(false); }
        let mut todo=inner.pieces.iter().cloned().map(|p|(p,0)).collect::<Vec<_>>();
        let mut work=0;
        while let Some((piece,depth))=todo.pop() {
            work+=1;
            if work>256 || depth>12 {return Ok(false);}
            for end in piece.ends() {
                for boundary in &self.pieces {
                    if boundary.contains(end)? { return Ok(false); }
                }
                if self.winding(end)?==0 {return Ok(false);}
            }
            let mut bounds=piece.bounds()?;
            for end in piece.ends() {
                for (k,e) in end.enclosure()?.iter().enumerate() {
                    bounds[0][k]=bounds[0][k].min(e.lo());
                    bounds[1][k]=bounds[1][k].max(e.hi());
                }
            }
            let b=[std::array::from_fn(|k|q(bounds[0][k])-&margin[k]),std::array::from_fn(|k|q(bounds[1][k])+&margin[k])];
            if self.rectangle_membership(&b,false)?==Some(true) {continue;}
            let centre=std::array::from_fn(|k|(&b[0][k]+&b[1][k])/q(2.));
            let diagonal=crate::numeric::sub(&b[1],&b[0]);
            let r2=crate::numeric::dot(&diagonal,&diagonal)/q(4.);
            let mut clears = true;
            for boundary in &self.pieces {
                if !boundary.clears_disc(&centre,&r2)? { clears = false; break; }
            }
            if clears && self.winding(&ExactPoint::from_rational(centre))?!=0 {continue;}
            let mid=piece.refinement_point()?;
            if piece.ends().contains(&mid) {return Ok(false);}
            todo.push((piece.trim(piece.ends()[0].clone(),mid.clone())?,depth+1));
            todo.push((piece.trim(mid,piece.ends()[1].clone())?,depth+1));
        }
        Ok(true)
    }
    /// Certified signed area (counter-clockwise positive). The chord wedges are
    /// cancelled in Q before they are enclosed: at a tiny line/arc lens their
    /// sum is exactly zero even far from the coordinate origin.
    pub fn area(&self) -> R<Iv> {
        crate::radical::guard(|| self.area_impl())?
    }
    fn area_impl(&self) -> R<Iv> {
        let chord = self.pieces.iter().fold(crate::radical::Radical::default(), |acc, s| acc + crate::radical::cross(&s.ends()[0].coordinates(), &s.ends()[1].coordinates()));
        let mut a = (chord / q(2.)).enclosure()?;
        for s in &self.pieces {
            a = a + s.segment_area()?;
        }
        finite(a)
    }
    /// The exact signed area when every piece has a rational Green term
    /// (lines and polynomial splines, see `Trimmed::green_exact`); `None` as
    /// soon as one piece has none (a circle, a weighted rational span).
    pub fn area_exact(&self) -> R<Option<Q>> {
        let mut total = Q::zero();
        for s in &self.pieces {
            match s.green_exact()? {
                Some(g) => total += g,
                None => return Ok(None),
            }
        }
        Ok(Some(total))
    }
    /// True when the cycle runs counter-clockwise. A digon of one arc and one
    /// line has zero chord area and takes the arc's sense; otherwise the sign
    /// of the certified area decides, and a straddling enclosure refuses.
    pub fn orientation(&self) -> R<bool> {
        if self.pieces.len() == 2 {
            let mut arcs = self.pieces.iter().filter_map(|s| match s.carrier() {
                Carrier::Circle(c) => Some(c.ccw),
                Carrier::Line | Carrier::BSpline(_) => None,
            });
            if let (Some(ccw), None) = (arcs.next(), arcs.next()) {
                return Ok(ccw);
            }
        }
        let area = self.area()?;
        if area.lo() > 0. {
            Ok(true)
        } else if area.hi() < 0. {
            Ok(false)
        } else {
            Err(Refusal::UnresolvedCycleOrientation)
        }
    }
    /// First moments of area about the axes, certified: the exact chord wedge
    /// terms summed in Q, and each arc's segment moment relative to its centre.
    pub fn moments(&self) -> R<[Iv; 2]> {
        crate::radical::guard(|| self.moments_impl())?
    }
    fn moments_impl(&self) -> R<[Iv; 2]> {
        let mut m = [Iv::point(0.); 2];
        let mut exact = [crate::radical::Radical::default(), crate::radical::Radical::default()];
        for s in &self.pieces {
            let (e, arc) = s.moment_terms()?;
            for k in 0..2 {
                if let Some(arc) = &arc {
                    m[k] = m[k] + arc[k];
                }
                exact[k] = &exact[k] + &e[k];
            }
        }
        for k in 0..2 {
            m[k] = m[k] + exact[k].enclosure()?;
        }
        Ok(m)
    }
    fn piece_enclosures(&self) -> R<&Vec<[crate::numeric::P; 2]>> {
        self.enclosures.get_or_init(|| self.pieces.iter().map(|piece| {
            let mut bounds=piece.bounds()?;
            for end in piece.ends() {
                for (k,e) in end.enclosure()?.iter().enumerate() {
                    bounds[0][k]=bounds[0][k].min(e.lo());
                    bounds[1][k]=bounds[1][k].max(e.hi());
                }
            }
            Ok(bounds.map(|p|p.map(q)))
        }).collect::<R<Vec<_>>>()).as_ref().map_err(Clone::clone)
    }
    /// Certified outward bounds of carrier extrema AND exact endpoints. Rounded
    /// serialization caches alone are not sufficient for trimmed-piece bounds.
    pub fn bounds(&self) -> R<[[f64; 2]; 2]> {
        let mut out = [[f64::INFINITY; 2], [f64::NEG_INFINITY; 2]];
        for b in self.piece_enclosures()? {
            for k in 0..2 {
                out[0][k] = out[0][k].min(enclose(&b[0][k])?.lo());
                out[1][k] = out[1][k].max(enclose(&b[1][k])?.hi());
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trimmed::fixtures::*;

    fn square(s: f64) -> Cycle {
        Cycle::polygon(&[[0., 0.], [s, 0.], [s, s], [0., s]]).unwrap()
    }
    fn capsule(radius: f64) -> Cycle {
        Cycle::new(vec![
            line([1.,1.-radius],[3.,1.-radius]),
            arc([3.,1.],radius*radius,[3.,1.-radius],[3.,1.+radius],true),
            line([3.,1.+radius],[1.,1.+radius]),
            arc([1.,1.],radius*radius,[1.,1.+radius],[1.,1.-radius],true),
        ])
    }
    #[test]
    fn circular_region_requires_one_exact_closed_carrier_and_handles_trimmed_arcs() {
        let halves=Cycle::new(vec![arc([0.,0.],1.,[1.,0.],[-1.,0.],true),arc([0.,0.],1.,[-1.,0.],[1.,0.],true)]);
        assert_eq!(halves.circular_region(),Some(([q(0.),q(0.)],q(1.))));
        let ring=Cycle::new(vec![Trimmed::ring([q(0.),q(0.)],q(1.),ExactPoint::from_f64([1.,0.]),true).unwrap()]);
        assert_eq!(ring.circular_region(),halves.circular_region());
        assert!(halves.reversed().circular_region().is_none());
        assert!(capsule(1.).circular_region().is_none());
        assert!(Cycle::new(vec![halves.pieces()[0].clone()]).circular_region().is_none());
    }
    #[test]
    fn rectangle_membership_is_strict_at_curved_and_linear_boundaries() {
        let disc=Cycle::new(vec![Trimmed::ring([q(0.),q(0.)],q(1.),ExactPoint::from_f64([1.,0.]),true).unwrap()]);
        let b=[[q(1.),q(0.)],[q(2.),q(0.)]];
        assert_eq!(disc.rectangle_membership(&b,false).unwrap(),None);
        assert_eq!(disc.rectangle_membership(&b,true).unwrap(),Some(false));
        let b=[[q(-0.25),q(-0.25)],[q(0.25),q(0.25)]];
        assert_eq!(disc.rectangle_membership(&b,false).unwrap(),Some(true));
        let b=[[q(0.5),q(0.5)],[q(1.5),q(1.5)]];
        assert_eq!(disc.rectangle_membership(&b,false).unwrap(),None);
        let poly=square(2.);
        assert_eq!(poly.rectangle_membership(&[[q(0.5),q(0.5)],[q(1.5),q(1.5)]],false).unwrap(),Some(true));
        assert_eq!(poly.rectangle_membership(&[[q(0.),q(0.)],[q(0.5),q(0.5)]],false).unwrap(),None);
    }
    #[test]
    fn boundary_enclosure_proves_nested_curves_but_not_contact_or_a_crossing() {
        let outer=capsule(1.);
        let inner=capsule(0.75);
        assert!(outer.contains_region_enclosure(&inner,&[q(0.01),q(0.01)]).unwrap());
        assert!(!outer.contains_region_enclosure(&outer,&[q(0.),q(0.)]).unwrap());
        assert!(!outer.contains_region_enclosure(&inner,&[q(-0.01),q(0.01)]).unwrap());
        assert!(!outer.contains_region_enclosure(&inner,&[q(0.3),q(0.3)]).unwrap());
        let moved=inner.mapped(&PlaneMap::isometry([q(0.5),q(0.)],[q(1.),q(0.)],[q(0.),q(1.)]).unwrap()).unwrap();
        assert!(!outer.contains_region_enclosure(&moved,&[q(0.01),q(0.01)]).unwrap());
        let concave=Cycle::polygon(&[[0.,0.],[3.,0.],[3.,3.],[2.,3.],[2.,1.],[1.,1.],[1.,3.],[0.,3.]]).unwrap();
        let crosses=Cycle::polygon(&[[0.5,1.5],[2.5,1.5],[2.5,2.5],[0.5,2.5]]).unwrap();
        assert!(!concave.contains_region_enclosure(&crosses,&[q(0.),q(0.)]).unwrap());
    }
    #[test]
    fn public_cycle_measures_return_arithmetic_refusals() {
        let v = q(1.) + Q::new(1.into(), q(2.).numer().pow(9000));
        let points = [ExactPoint::from_rational([v.clone(), q(0.)]),
            ExactPoint::from_rational([q(0.), v]), ExactPoint::from_f64([0., 0.])];
        let cycle = Cycle::new((0..3).map(|i| Trimmed::new(
            [points[i].clone(), points[(i + 1) % 3].clone()], Carrier::Line).unwrap()).collect());
        assert_eq!(cycle.area().unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(cycle.orientation().unwrap_err(), Refusal::RadicalBudget);
        assert_eq!(cycle.moments().unwrap_err(), Refusal::RadicalBudget);
        let inner = Cycle::polygon(&[[0.2,0.2],[0.4,0.2],[0.4,0.4],[0.2,0.4]]).unwrap();
        assert_eq!(cycle.contains_region_enclosure(&inner,&[q(0.),q(0.)]).unwrap_err(), Refusal::RadicalBudget);
    }

    #[test]
    fn polygon_refuses_degenerate_input_by_name() {
        assert_eq!(Cycle::polygon(&[[0., 0.], [1., 1.]]).unwrap_err(), Refusal::DegeneratePolygon);
        let flat = Cycle::polygon(&[[0., 0.], [1., 1.], [2., 2.]]).unwrap_err();
        assert_eq!(flat.name(), "prism-stack/degenerate-polygon");
    }
    #[test]
    fn polygon_orients_counter_clockwise() {
        let cw = Cycle::polygon(&[[0., 0.], [0., 2.], [2., 2.], [2., 0.]]).unwrap();
        assert!(cw.orientation().unwrap());
        assert_eq!(cw.area().unwrap().m, 4.);
        let ccw = square(2.);
        assert_eq!(ccw.area().unwrap().m, 4.);
        assert!(!ccw.reversed().orientation().unwrap());
        assert_eq!(ccw.reversed().area().unwrap().m, -4.);
    }
    #[test]
    fn winding_and_contains_treat_the_boundary_as_inside_only_for_contains() {
        let s = square(2.);
        let at = |x, y| ExactPoint::from_f64([x, y]);
        assert_eq!(s.winding(&at(1., 1.)).unwrap(), 1);
        assert_eq!(s.winding(&at(3., 1.)).unwrap(), 0);
        assert_eq!(s.winding(&at(-1., 0.)).unwrap(), 0, "level with a vertex, left of the square");
        assert_eq!(s.winding(&at(-1., 2.)).unwrap(), 0, "level with the upper vertices");
        for p in [at(0., 0.), at(2., 2.), at(1., 0.), at(0., 1.), at(1., 1.)] {
            assert!(s.contains(&p).unwrap(), "{p:?}");
        }
        assert!(!s.contains(&at(3., 3.)).unwrap() && !s.contains(&at(-1., 1.)).unwrap());
        assert_eq!(s.reversed().winding(&at(1., 1.)).unwrap(), -1);
    }
    #[test]
    fn a_line_arc_digon_takes_the_arcs_sense_and_a_lens_has_its_segment_area() {
        // Half disc of radius 1: arc over the top from (1,0) to (-1,0) plus its chord.
        let half = Cycle::new(vec![
            arc([0., 0.], 1., [1., 0.], [-1., 0.], true),
            line([-1., 0.], [1., 0.]),
        ]);
        assert!(half.orientation().unwrap());
        let a = half.area().unwrap();
        assert!((a.m - std::f64::consts::FRAC_PI_2).abs() <= a.r + 1e-14);
        assert!(!half.reversed().orientation().unwrap());
        // A circular digon of two arcs is a full disc.
        let disc = Cycle::new(vec![
            arc([0., 0.], 1., [1., 0.], [-1., 0.], true),
            arc([0., 0.], 1., [-1., 0.], [1., 0.], true),
        ]);
        assert!((disc.area().unwrap().m - std::f64::consts::PI).abs() < 1e-12);
        assert!(disc.orientation().unwrap());
    }
    #[test]
    fn moments_of_a_half_disc_match_the_closed_form() {
        // First moments of the upper half disc: Mx = int x dA = 0, My = int y dA = 2 r^3 / 3.
        let half = Cycle::new(vec![
            arc([0., 0.], 1., [1., 0.], [-1., 0.], true),
            line([-1., 0.], [1., 0.]),
        ]);
        let m = half.moments().unwrap();
        assert!(m[0].m.abs() <= m[0].r + 1e-14);
        assert!((m[1].m - 2. / 3.).abs() <= m[1].r + 1e-14);
        // A square's moments are exact: side 2, centroid (1,1), area 4.
        let m = square(2.).moments().unwrap();
        assert_eq!((m[0].m, m[1].m), (4., 4.));
    }
    #[test]
    fn certified_bounds_include_rational_trim_ends_not_only_their_rounded_caches() {
        let a=ExactPoint::from_rational([q(1.)/q(3.),q(2.)/q(7.)]);
        let b=ExactPoint::from_rational([q(5.)/q(3.),q(9.)/q(7.)]);
        let cycle=Cycle::new(vec![Trimmed::new([a.clone(),b.clone()],Carrier::Line).unwrap(),Trimmed::new([b.clone(),a.clone()],Carrier::Line).unwrap()]);
        let bounds=cycle.bounds().unwrap();
        for p in [a,b] {for k in 0..2 {assert!(q(bounds[0][k])<=p.rat().unwrap()[k] && q(bounds[1][k])>=p.rat().unwrap()[k]);}}
    }
    #[test]
    fn bounds_cover_every_piece() {
        let half = Cycle::new(vec![
            arc([0., 0.], 1., [1., 0.], [-1., 0.], true),
            line([-1., 0.], [1., 0.]),
        ]);
        let b = half.bounds().unwrap();
        assert!(b[0][0] <= -1. && b[1][0] >= 1. && b[0][1] <= 0. && b[1][1] >= 1.);
    }
    #[test]
    fn mapping_through_a_mirror_keeps_the_cycle_counter_clockwise() {
        let half = Cycle::new(vec![
            arc([0., 0.], 1., [1., 0.], [-1., 0.], true),
            line([-1., 0.], [1., 0.]),
        ]);
        let mirror = PlaneMap::isometry([q(0.), q(0.)], [q(-1.), q(0.)], [q(0.), q(1.)]).unwrap();
        let m = half.mapped(&mirror).unwrap();
        assert!(m.orientation().unwrap());
        assert!((m.area().unwrap().m - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
        let shift = PlaneMap::isometry([q(5.), q(0.)], [q(1.), q(0.)], [q(0.), q(1.)]).unwrap();
        let s = half.mapped(&shift).unwrap();
        assert!(s.contains(&ExactPoint::from_f64([5., 0.5])).unwrap());
        assert!(!s.contains(&ExactPoint::from_f64([0., 0.5])).unwrap());
    }
}

#[cfg(test)]
mod radical_winding_tests {
    use super::*;
    use crate::radical::Radical;
    use crate::numeric::q;
    #[test]
    fn line_cycle_winding_accepts_exact_quadratic_witnesses() {
        let root=Radical::quadratic(q(0.),q(1.),q(2.)).unwrap();
        let point=ExactPoint::from_coordinates([root.clone(),root]).unwrap();
        let square=Cycle::new(vec![Trimmed::line([0.,0.],[2.,0.]),Trimmed::line([2.,0.],[2.,2.]),Trimmed::line([2.,2.],[0.,2.]),Trimmed::line([0.,2.],[0.,0.])]);
        assert_eq!(square.winding(&point).unwrap(),1);
        assert_eq!(square.reversed().winding(&point).unwrap(),-1);
        let outside=ExactPoint::from_coordinates([point.coordinates()[0].clone()+q(2.),point.coordinates()[1].clone()]).unwrap();
        assert_eq!(square.winding(&outside).unwrap(),0);
    }
}
