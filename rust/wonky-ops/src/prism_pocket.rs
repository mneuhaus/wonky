//! Closed-ring polygon pockets in axial profiles. Source frame relations and
//! floor heights are rational; WC0 coordinates are replay-owned observations.
//! Crossing trims are deliberately outside this arrangement.
use crate::{
    arc_profile::{dot, enclose, q, ArcPrism, Profile},
    cylinder::Spec,
    polyhedron::Refused,
    prism_holes::{b, exact_float, no, Base, R},
};
use num_rational::BigRational as Q;
use num_traits::Signed;
use wonky_contract::*;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};

#[derive(Clone, Debug)]
pub(crate) struct Pocket {
    pub prism: ArcPrism,
    pub levels: [Q; 2],
    pub entry: usize,
    pub cap: usize,
}
fn intersects(a: &wc::Trimmed, b: &wc::Trimmed) -> R<bool> {
    match a.contacts(b) {
        Ok(hits) => Ok(!hits.is_empty()),
        Err(wc::Refusal::OverlappingLines | wc::Refusal::OverlappingArcs) => Ok(true),
        Err(e) => Err(e.into()),
    }
}
pub(crate) fn classify(base: &Base, tools: &[Base]) -> R<Option<Pocket>> {
    if tools.is_empty() {
        return Ok(None);
    }
    if tools.len() != 1 {
        return Err(no("pocket-count"));
    }
    let (axis, bounds) = base.axis_levels()?;
    if axis != 2 {
        return Err(no("pocket-axis"));
    }
    let source = &tools[0];
    let mut prism = source.profile().ok_or_else(|| no("pocket-profile"))?;
    if prism.profile.segments().iter().any(wc::Trimmed::is_curved) {
        return Err(no("pocket-curved-profile"));
    }
    let relation = crate::construction_geom::frame(base.frame())?
        .relation_from(&crate::construction_geom::frame(source.frame())?);
    relation
        .require_isometry()
        .map_err(|e| Refused(e.0.into()))?;
    let z = relation.map.vector(&[q(0.), q(0.), q(1.)]);
    if z != [q(0.), q(0.), q(1.)] {
        return Err(no("pocket-frame-axis"));
    }
    let map = |p: [f64; 2]| -> R<[f64; 2]> {
        let p = relation.map.point(&[q(p[0]), q(p[1]), q(0.)]);
        Ok([exact_float(&p[0])?, exact_float(&p[1])?])
    };
    prism.profile = Profile::from_pieces(
        prism
            .profile
            .segments()
            .iter()
            .map(|s| Ok(wc::Trimmed::line(map(s.cache()[0])?, map(s.cache()[1])?)))
            .collect::<R<Vec<_>>>()?,
    );
    let raw = prism
        .levels
        .map(|h| relation.map.point(&[q(0.), q(0.), q(h)])[2].clone());
    let entry = if raw[0] <= q(bounds[0]) && raw[1] > q(bounds[0]) && raw[1] < q(bounds[1]) {
        0
    } else if raw[1] >= q(bounds[1]) && raw[0] > q(bounds[0]) && raw[0] < q(bounds[1]) {
        1
    } else {
        return Err(no("pocket-not-single-end"));
    };
    let levels = [
        raw[0].clone().max(q(bounds[0])),
        raw[1].clone().min(q(bounds[1])),
    ];
    // The cache is only serialized/exported. Reject collisions; ordering and
    // containment below always use the exact rational levels.
    prism.levels = [enclose(&levels[0])?.mid(), enclose(&levels[1])?.mid()];
    if prism.levels[0] >= prism.levels[1]
        || prism.levels[1 - entry] == bounds[entry]
        || prism.levels[1 - entry] == bounds[1 - entry]
    {
        return Err(no("pocket-level-cache-collision"));
    }
    if let Base::Cylinder(c) = base {
        let center = [q(c.spec.bottom[0]), q(c.spec.bottom[1])];
        let r2 = q(c.spec.radius) * q(c.spec.radius);
        if prism.profile.segments().iter().any(|s| {
            let d = s.ends()[0].difference_rational(&center);
            wonky_curve::radical::dot(&d, &d) >= wonky_curve::radical::Radical::from(r2.clone())
        }) {
            return Err(no("pocket-side-contact-or-crossing"));
        }
    } else {
        let outer = base.profile().ok_or_else(|| no("pocket-target-profile"))?;
        if outer.profile.segments().iter().any(wc::Trimmed::is_curved) {
            return Err(no("pocket-target-curved-profile"));
        }
        for s in prism.profile.segments() {
            if !outer.contains(&s.ends()[0])? {
                return Err(no("pocket-side-contact-or-crossing"));
            }
            for t in outer.profile.segments() {
                if intersects(s, t)? {
                    return Err(no("pocket-side-contact-or-crossing"));
                }
            }
        }
    }
    let cap = crate::prism_holes::base_caps(base)?[entry];
    Ok(Some(Pocket {
        prism,
        levels,
        entry,
        cap,
    }))
}
pub(crate) fn clip(pocket: Option<&Pocket>, holes: &mut Vec<Spec>) -> R<Vec<[Q; 2]>> {
    let mut kept = vec![];
    let mut levels = vec![];
    for h in holes.iter() {
        let mut z = [q(h.bottom[2]), q(h.top[2])];
        if let Some(p) = pocket {
            if z[0] < p.levels[1] && z[1] > p.levels[0] {
                let center = [q(h.bottom[0]), q(h.bottom[1])];
                let r2 = q(h.radius) * q(h.radius);
                if !p.prism.contains(&wc::ExactPoint::from_rational(center.clone()))?
                    || !p.prism.profile.clears_disc(&center, &r2)?
                {
                    return Err(no("pocket-bore-contact-or-crossing"));
                }
                if p.entry == 0 {
                    z[0] = z[0].clone().max(p.levels[1].clone());
                } else {
                    z[1] = z[1].clone().min(p.levels[0].clone());
                }
            }
        }
        if z[0] >= z[1] {
            continue;
        }
        let mut s = *h;
        s.bottom[2] = enclose(&z[0])?.mid();
        s.top[2] = enclose(&z[1])?.mid();
        if s.bottom[2] >= s.top[2] {
            return Err(no("pocket-level-cache-collision"));
        }
        kept.push(s);
        levels.push(z);
    }
    *holes = kept;
    Ok(levels)
}

pub(crate) fn sew(body: &mut Body, pocket: &Pocket) -> R<()> {
    let lines = pocket
        .prism
        .profile
        .segments()
        .iter()
        .map(|s| [s.cache()[0][0], s.cache()[0][1], s.cache()[1][0], s.cache()[1][1]])
        .collect::<Vec<_>>();
    let seed = crate::arc_profile::build(
        body.key.clone(),
        crate::affine::Affine::IDENTITY,
        &lines,
        &[],
        1.,
        false,
    )?;
    let source = crate::arc_profile_brep::construct(
        body.key.clone(),
        seed.frames,
        seed.constructions,
        &pocket.prism,
    )?;
    let prov = Provenance::Construction {
        node: NodeId(body.constructions.len() as u32 - 1),
    };
    let (vo, eo, co, po, uo, lo) = (
        body.vertices.len() as u32,
        body.edges.len() as u32,
        body.curves.len() as u32,
        body.pcurves.len() as u32,
        body.coedges.len() as u32,
        body.loops.len() as u32,
    );
    let mut surfaces = vec![];
    for (i, mut s) in source.surfaces.into_iter().enumerate() {
        if i == pocket.entry {
            surfaces.push(body.faces[pocket.cap].surface);
        } else {
            surfaces.push(SurfaceId(body.surfaces.len() as u32));
            s.provenance = prov.clone();
            body.surfaces.push(s);
        }
    }
    for mut v in source.vertices {
        v.provenance = prov.clone();
        body.vertices.push(v);
    }
    for mut c in source.curves {
        c.provenance = prov.clone();
        for s in &mut c.supports {
            s.surface = surfaces[s.surface.0 as usize];
            s.pcurve.0 += po;
        }
        body.curves.push(c);
    }
    for mut e in source.edges {
        e.curve.0 += co;
        for v in &mut e.vertices {
            v.0 += vo;
        }
        body.edges.push(e);
    }
    for mut pc in source.pcurves {
        let old = pc.surface.0 as usize;
        pc.surface = surfaces[old];
        pc.curve.0 += co;
        if old == pocket.entry {
            // Pull both line endpoints into the retained cap's own plane chart.
            let SurfaceGeometry::Plane { origin, normal, x } =
                &body.surfaces[pc.surface.0 as usize].geometry
            else {
                return Err(no("pocket-cap"));
            };
            let x = x.map(|v| q(v.get()));
            let n = normal.map(|v| q(v.get()));
            let y = wonky_geom::cross(&n, &x);
            if wonky_geom::dot(&x, &x) != q(1.) || wonky_geom::dot(&y, &y) != q(1.) {
                return Err(no("pocket-cap-chart"));
            }
            let edge = body
                .edges
                .iter()
                .find(|e| e.curve == pc.curve)
                .ok_or_else(|| no("pocket-edge"))?;
            let point = |v: VertexId| -> R<Vector2> {
                let p = body.vertices[v.0 as usize].point;
                let d = std::array::from_fn(|k| q(p[k].get()) - q(origin[k].get()));
                Ok([
                    b(exact_float(&wonky_geom::dot(&d, &x))?)?,
                    b(exact_float(&wonky_geom::dot(&d, &y))?)?,
                ])
            };
            pc.geometry = PcurveGeometry::Line {
                a: point(edge.vertices[0])?,
                b: point(edge.vertices[1])?,
            };
        }
        body.pcurves.push(pc);
    }
    for mut u in source.coedges {
        u.edge.0 += eo;
        u.pcurve.0 += po;
        u.forward = !u.forward;
        body.coedges.push(u);
    }
    for (i, mut lp) in source.loops.into_iter().enumerate() {
        lp.outer = i != pocket.entry;
        lp.coedges.reverse();
        for u in &mut lp.coedges {
            u.0 += uo;
        }
        body.loops.push(lp);
    }
    for (i, mut f) in source.faces.into_iter().enumerate() {
        if i == pocket.entry {
            body.faces[pocket.cap].loops.push(LoopId(lo + i as u32));
        } else {
            f.surface = surfaces[i];
            f.forward = !f.forward;
            for l in &mut f.loops {
                l.0 += lo;
            }
            body.shells[0].faces.push(FaceId(body.faces.len() as u32));
            body.faces.push(f);
        }
    }
    Ok(())
}
impl Pocket {
    pub fn observe(
        &self,
        scale: Iv,
        volume: &mut Iv,
        moment: &mut [Iv; 3],
        areas: &mut Vec<Iv>,
        perimeters: &mut Vec<Iv>,
    ) -> R<()> {
        let i = Iv::point;
        let area = self.prism.profile.area()?;
        let height = enclose(&(&self.levels[1] - &self.levels[0]))?;
        let first = self.prism.profile.cycle().moments()?;
        let cut = area * height;
        *volume = *volume - cut;
        for k in 0..2 {
            moment[k] = moment[k] - first[k] * height;
        }
        moment[2] = moment[2] - cut * enclose(&((&self.levels[0] + &self.levels[1]) / q(2.)))?;
        let lengths = self.prism.lengths()?;
        let length = lengths.iter().fold(i(0.), |a, &b| a + b);
        let cap = area * scale * i(1e6);
        areas[self.cap] = areas[self.cap] - cap;
        perimeters[self.cap] = perimeters[self.cap] + length * scale * i(1000.);
        areas.push(cap);
        perimeters.push(length * scale * i(1000.));
        for l in lengths {
            areas.push(l * height * scale * i(1e6));
            perimeters.push(i(2.) * (l + height) * scale * i(1000.));
        }
        Ok(())
    }
    pub fn void_distance(&self, p: &[Q; 3], holes: &[Spec], levels: &[[Q; 2]]) -> R<Option<Iv>> {
        if p[2] < self.levels[0] || p[2] > self.levels[1] || p[2] == self.levels[1 - self.entry] {
            return Ok(None);
        }
        let xy = [p[0].clone(), p[1].clone()];
        if !self.prism.contains(&wc::ExactPoint::from_rational(xy.clone()))? {
            return Ok(None);
        }
        let dz = enclose(&(&p[2] - &self.levels[1 - self.entry]).abs())?;
        let mut d = dz;
        for (h, z) in holes.iter().zip(levels) {
            // Only bores ending on this floor remove its projected nearest point.
            let floor = &self.levels[1 - self.entry];
            if &z[0] != floor && &z[1] != floor {
                continue;
            }
            let v = [&p[0] - q(h.bottom[0]), &p[1] - q(h.bottom[1])];
            let d2 = dot(&v, &v);
            let r2 = q(h.radius) * q(h.radius);
            if d2 < r2 {
                let radial = enclose(&(r2 - &d2))? / (Iv::point(h.radius) + enclose(&d2)?.sqrt());
                d = (dz * dz + radial * radial).sqrt();
                break;
            }
        }
        for s in self.prism.profile.segments() {
            let gap = s.distance(&wc::ExactPoint::from_rational(xy.clone()))?;
            if gap.lo() <= 0. {
                return Ok(None);
            }
            d = d.min(gap);
        }
        Ok(Some(d))
    }
}
