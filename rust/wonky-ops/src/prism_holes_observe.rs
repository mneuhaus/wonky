//! Enclosed measures and exact source-chart membership of sewn axial holes.
use crate::{
    arc_profile::{enclose, q},
    cylinder::{enclosed, finite},
    prism_holes::{no, Base, PrismHoles, R},
    probe_exact,
};
use wonky_contract::*;
use wonky_num::{Iv, Scalar};
fn i(x: f64) -> Iv {
    Iv::point(x)
}
type Measures = (Iv, [Iv; 3], Vec<Iv>, Vec<Iv>);
/// Volume, first moments, face areas and face perimeters (body face order) of
/// an unholed single-profile base, in source units scaled to mm observations.
pub(crate) fn base_measures(base: &Base, axis: usize, levels: [f64; 2], scale: Iv) -> R<Measures> {
    let pi = crate::analytic_pi::pi();
    let height = i(levels[1]) - i(levels[0]);
    let (area, first_moment) = if let Some(p) = base.profile() {
        (
            p.profile.area()?,
            p.profile.cycle().moments()?,
        )
    } else if let Base::Cylinder(c) = base {
        let a = pi * i(c.spec.radius) * i(c.spec.radius);
        (
            a,
            [
                a * i(c.spec.bottom[(axis + 1) % 3]),
                a * i(c.spec.bottom[(axis + 2) % 3]),
            ],
        )
    } else {
        return Err(no("target-carrier"));
    };
    let volume = area * height;
    let mut moment = [i(0.); 3];
    moment[axis] = volume * (i(levels[0]) + i(levels[1])) / i(2.);
    moment[(axis + 1) % 3] = first_moment[0] * height;
    moment[(axis + 2) % 3] = first_moment[1] * height;
    let (areas, perimeters) = match base {
        Base::Planar(a) => {
            if let Some(p) = base.profile() {
                let lens = p.lengths()?;
                let side_areas = lens
                    .iter()
                    .map(|&l| l * height * scale * i(1e6))
                    .collect::<Vec<_>>();
                let cap = area * scale * i(1e6);
                let length = lens.iter().fold(i(0.), |a, &b| a + b);
                let cap_ids = crate::prism_holes::base_caps(base)?;
                let mut areas = vec![i(0.); a.body.faces.len()];
                let mut perims = vec![i(0.); a.body.faces.len()];
                let mut side = 0;
                // Polygon side order follows the region; the box constructor
                // uses a different face order, so read its exact slab dimensions.
                if let Some(cells) = &a.orthogonal {
                    let bounds = cells.boxes[0];
                    let d = [0, 1, 2].map(|k| i(bounds[1][k]) - i(bounds[0][k]));
                    for (f, face) in a.body.faces.iter().enumerate() {
                        let SurfaceGeometry::Plane { normal, .. } =
                            &a.body.surfaces[face.surface.0 as usize].geometry
                        else {
                            return Err(no("target-carrier"));
                        };
                        let k = normal
                            .iter()
                            .position(|v| v.get() != 0.)
                            .ok_or_else(|| no("target-carrier"))?;
                        areas[f] = d[(k + 1) % 3] * d[(k + 2) % 3] * scale * i(1e6);
                        perims[f] = i(2.)
                            * (d[(k + 1) % 3] + d[(k + 2) % 3])
                            * scale
                            * i(1000.);
                    }
                } else {
                    for f in 0..areas.len() {
                        if cap_ids.contains(&f) {
                            areas[f] = cap;
                            perims[f] = length * scale * i(1000.)
                        } else {
                            areas[f] = side_areas[side];
                            perims[f] =
                                i(2.) * (lens[side] + height) * scale * i(1000.);
                            side += 1
                        }
                    }
                }
                (areas, perims)
            } else {
                return Err(no("target-carrier"));
            }
        }
        Base::Cylinder(c) => {
            let ring = i(2.) * pi * i(c.spec.radius);
            let cap = area * scale * i(1e6);
            (
                vec![cap, cap, ring * height * scale * i(1e6)],
                vec![
                    ring * scale * i(1000.),
                    ring * scale * i(1000.),
                    i(2.) * (ring + height) * scale * i(1000.),
                ],
            )
        }
        Base::Revolved(_) => return Err(no("target-carrier")),
    };

    Ok((volume, moment, areas, perimeters))
}
impl PrismHoles {
    fn scale(&self) -> R<Iv> {
        let d = self
            .base
            .frame()
            .orthonormality_defect()
            .map_err(|_| no("frame-range"))?;
        if d > 1e-9 {
            return Err(no("non-near-rigid-frame"));
        }
        Ok(Iv {
            m: 1.,
            r: (3. * d).next_up(),
        })
    }
    fn det(&self) -> R<Iv> {
        Ok(enclosed(
            &self
                .base
                .frame()
                .det_exact()
                .map_err(|_| no("frame-range"))?,
        ))
    }
    pub(crate) fn measures(&self) -> R<(Iv, Iv, Vec<f64>, Vec<f64>, [f64; 3])> {
        let (axis, levels) = self.base.axis_levels()?;
        let pi = crate::analytic_pi::pi();
        let scale = self.scale()?;
        let (mut volume, mut moment, mut areas, mut perimeters) = match &self.base {
            Base::Planar(a) if a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() > 1) => {
                crate::prism_holes_cells::measures(a, scale)?
            }
            _ => base_measures(&self.base, axis, levels, scale)?,
        };
        if let Some(pocket) = &self.pocket {
            pocket.observe(scale, &mut volume, &mut moment, &mut areas, &mut perimeters)?;
        }
        for (index, hole) in self.holes.iter().enumerate() {
            let levels = &self.hole_levels[index];
            let h = enclose(&(&levels[1] - &levels[0]))?;
            let disc = pi * i(hole.radius) * i(hole.radius);
            let cut = disc * h;
            volume = volume - cut;
            for k in 0..3 {
                let center = if k == axis {
                    enclose(&((&levels[0] + &levels[1]) / q(2.)))?
                } else {
                    i(hole.bottom[k])
                };
                moment[k] = moment[k] - cut * center;
            }
            let ring = i(2.) * pi * i(hole.radius) * scale * i(1000.);
            let cap = disc * scale * i(1e6);
            for side in 0..2 {
                if let Some(face) = self.caps[index][side] {
                    areas[face] = areas[face] - cap;
                    perimeters[face] = perimeters[face] + ring
                } else {
                    areas.push(cap);
                    perimeters.push(ring)
                }
            }
            areas.push(ring * h * i(1000.));
            perimeters.push(i(2.) * (ring + h * scale * i(1000.)));
        }
        for (index, hole) in self.meridians.iter().enumerate() {
            let o = hole.observe(pi, scale)?;
            volume = volume - o.volume;
            for k in 0..3 {
                moment[k] = moment[k]
                    - if k == axis { o.axial_moment } else { o.volume * i(hole.centre[k]) };
            }
            for side in 0..2 {
                if let (Some(face), Some(r)) = (self.meridian_caps[index][side], o.cap_rings[side]) {
                    areas[face] = areas[face] - pi * i(r) * i(r) * scale * i(1e6);
                    perimeters[face] = perimeters[face] + i(2.) * pi * i(r) * scale * i(1000.);
                }
            }
            areas.extend(o.areas);
            perimeters.extend(o.perimeters);
        }
        let mut center = [0.; 3];
        for k in 0..3 {
            center[k] = finite(moment[k] / volume)?.m
        }
        let center = self
            .base
            .frame()
            .apply(center, 1000., true)
            .map_err(|_| no("centroid-range"))?;
        volume = finite(volume * self.det()? * i(1e9))?;
        let total = finite(areas.iter().fold(i(0.), |a, &b| a + b))?;
        if volume.lo() <= 0.
            || volume.r / volume.m > 1e-9
            || total.lo() <= 0.
            || total.r / total.m > 1e-9
        {
            return Err(no("observation-width"));
        }
        Ok((
            volume,
            total,
            areas.into_iter().map(|v| v.m).collect(),
            perimeters.into_iter().map(|v| v.m).collect(),
            center,
        ))
    }
    pub fn tolerance_mm(&self) -> R<f64> {
        let (lo, hi) = self.base.bbox(None)?;
        let mag = lo.into_iter().chain(hi).fold(0_f64, |a, b| a.max(b.abs()));
        Ok((self.base.tolerance()? + 128. * f64::EPSILON * mag).next_up())
    }
    pub fn probe(&self, point: [f64; 3]) -> R<(f64, bool, f64)> {
        let p = probe_exact::local_point(self.base.frame(), point).map_err(no)?;
        let (axis, levels) = self.base.axis_levels()?;
        let radial = [p[(axis + 1) % 3].clone(), p[(axis + 2) % 3].clone()];
        let in_cells = if let Base::Planar(a) = &self.base {
            a.orthogonal
                .as_ref()
                .filter(|c| c.boxes.len() > 1)
                .map(|c| {
                    c.boxes
                        .iter()
                        .any(|b| (0..3).all(|k| q(b[0][k]) <= p[k] && p[k] <= q(b[1][k])))
                })
        } else {
            None
        };
        let in_profile = if let Some(inside) = in_cells {
            inside
        } else if let Some(profile) = self.base.profile() {
            profile.contains(&wonky_curve::ExactPoint::from_rational(radial.clone()))?
        } else if let Base::Cylinder(c) = &self.base {
            let a = &radial[0] - q(c.spec.bottom[(axis + 1) % 3]);
            let b = &radial[1] - q(c.spec.bottom[(axis + 2) % 3]);
            &a * &a + &b * &b <= q(c.spec.radius) * q(c.spec.radius)
        } else {
            return Err(no("target-carrier"));
        };
        if !in_profile || p[axis] < q(levels[0]) || p[axis] > q(levels[1]) {
            let d = finite(self.outside_distance(&p)? * self.scale()? * i(1000.))?;
            if d.lo() <= 0. {
                return Err(no("probe-distance-unresolved"));
            }
            return Ok((d.m, false, d.r));
        }
        if let Some(pocket) = &self.pocket {
            if let Some(d) = pocket.void_distance(&p, &self.holes, &self.hole_levels)? {
                let d = finite(d * self.scale()? * i(1000.))?;
                return Ok((d.m, false, d.r));
            }
        }
        for (index, h) in self.holes.iter().enumerate() {
            let [lo, hi] = self.hole_levels[index].clone();
            if p[axis] < lo
                || p[axis] > hi
                || (p[axis] == lo && self.caps[index][0].is_none())
                || (p[axis] == hi && self.caps[index][1].is_none())
            {
                continue;
            }
            let u = &radial[0] - q(h.bottom[(axis + 1) % 3]);
            let v = &radial[1] - q(h.bottom[(axis + 2) % 3]);
            let d2 = &u * &u + &v * &v;
            let r = q(h.radius);
            if d2 >= &r * &r {
                continue;
            }
            // Rationalized positive gap, avoiding cancellation next to the wall.
            let mut distance = enclose(&(&r * &r - &d2))? / (i(h.radius) + enclose(&d2)?.sqrt());
            if self.caps[index][0].is_none() {
                distance = distance.min(enclose(&(&p[axis] - lo))?)
            }
            if self.caps[index][1].is_none() {
                distance = distance.min(enclose(&(hi - &p[axis]))?)
            }
            distance = finite(distance * self.scale()? * i(1000.))?;
            return Ok((distance.m, false, distance.r));
        }
        for hole in &self.meridians {
            if let Some(d) = hole.probe(&radial, &p[axis])? {
                let d = finite(d * self.scale()? * i(1000.))?;
                return Ok((d.m, false, d.r));
            }
        }
        Ok((0., true, 0.))
    }
    pub fn measure_json(&self, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> R<String> {
        let (volume, area, areas, perimeters, center) = self.measures()?;
        let (lo, hi) = self.base.bbox(None)?;
        let mapped = if let Some(m) = map {
            let (lo, hi) = self.base.bbox(Some(m))?;
            format!("{{\"min\":{lo:?},\"max\":{hi:?}}}")
        } else {
            "null".into()
        };
        let probes = probes
            .iter()
            .map(|&p| match self.probe(p) {
                Ok((d, inside, b)) => {
                    format!("{{\"distanceMm\":{d:?},\"inside\":{inside},\"boundMm\":{b:?}}}")
                }
                Err(e) => format!("{{\"refused\":\"{}\"}}", e.0),
            })
            .collect::<Vec<_>>()
            .join(",");
        let tolerance = self.tolerance_mm()?;
        let pi = crate::analytic_pi::pi();
        let singular = self
            .meridians
            .iter()
            .map(|h| h.observe(pi, Iv::point(1.)).map(|o| o.apexes))
            .sum::<R<usize>>()?;
        report(&self.body, self.base.frame(), "AxialProfileHoles", (volume, area, &areas, &perimeters, center), (lo, hi), &mapped, tolerance, &probes, singular)
    }
}

/// Canonical topology of an audited sewn boundary. A periodic chart seam is
/// used twice by one face; removing it separates that face's two boundary
/// loops. Its endpoints (and an isolated ring's anchor) are chart artifacts,
/// not physical vertices. Nonperiodic boundaries are unchanged.
/// Returns faces, edges, vertices, loops, ring edges and genus.
pub(crate) fn periodic_topology(b: &Body) -> (usize, usize, usize, usize, usize, i64) {
    let seams = b.edges.iter().enumerate().filter(|(ei, _)| {
        b.faces.iter().any(|f| {
            f.loops.iter().flat_map(|l| &b.loops[l.0 as usize].coedges)
                .filter(|u| b.coedges[u.0 as usize].edge.0 as usize == *ei).count() == 2
        })
    }).map(|(i, _)| i).collect::<Vec<_>>();
    let anchored_ring = |e: &wonky_contract::Edge| e.vertices.len() == 2 && e.vertices[0] == e.vertices[1];
    let hidden = seams.iter().flat_map(|&i| b.edges[i].vertices.iter().map(|v| v.0))
        .chain(b.edges.iter().filter(|e| anchored_ring(e)).map(|e| e.vertices[0].0))
        .filter(|v| {
            // A seam endpoint is a chart artifact only when no ordinary edge
            // uses it. Window boundaries can meet a seam at real vertices.
            b.edges.iter().enumerate().all(|(i, e)|
                !e.vertices.iter().any(|p| p.0 == *v) || seams.contains(&i) || anchored_ring(e))
        })
        .collect::<std::collections::BTreeSet<_>>();
    let (faces, edges, vertices, loops) = (
        b.faces.len(), b.edges.len() - seams.len(), b.vertices.len() - hidden.len(), b.loops.len() + seams.len(),
    );
    let rings = b.edges.iter().filter(|e| e.vertices.is_empty() || anchored_ring(e)).count();
    let euler = vertices as i64 + rings as i64 - edges as i64 + 2 * faces as i64 - loops as i64;
    (faces, edges, vertices, loops, rings, (2 - euler) / 2)
}

/// The shared observation JSON of a sewn plane/cylinder boundary: measures,
/// canonical (seam-quotiented) topology and the exact vertex projection.
#[allow(clippy::too_many_arguments)]
pub(crate) fn report(
    b: &Body,
    frame: &crate::placement::Placement,
    certificate: &str,
    (volume, area, areas, perimeters, center): (Iv, Iv, &[f64], &[f64], [f64; 3]),
    (lo, hi): ([f64; 3], [f64; 3]),
    mapped: &str,
    tolerance: f64,
    probes: &str,
    singular: usize,
) -> R<String> {
    let (faces, edges, vertices, loops, rings, genus) = periodic_topology(b);
    let world = crate::cylinder_chart::vertices_mm(b, frame)?;
    let projected_edges = b
        .edges
        .iter()
        .map(|e| [e.vertices[0].0, e.vertices[1].0])
        .collect::<Vec<_>>();
    let projected_faces = b
        .faces
        .iter()
        .map(|f| {
            format!(
                "[{}]",
                f.loops
                    .iter()
                    .map(|l| format!(
                        "[{}]",
                        b.loops[l.0 as usize]
                            .coedges
                            .iter()
                            .map(|u| {
                                let c = &b.coedges[u.0 as usize];
                                format!("[{},{}]", c.edge.0, c.forward)
                            })
                            .collect::<Vec<_>>()
                            .join(",")
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let projection=format!("{{\"vertices\":{world:?},\"edges\":{projected_edges:?},\"faces\":[{projected_faces}]}}");
    Ok(format!(concat!("{{\"basis\":\"native-f64-construction\",\"certificate\":\"{certificate}\",\"boundToConstruction\":true,",
        "\"volumeMm3\":{:?},\"volumeRelBound\":{:?},\"areaMm2\":{:?},\"areaRelBound\":{:?},\"centroidMm\":{center:?},",
        "\"bboxMm\":{{\"min\":{lo:?},\"max\":{hi:?}}},\"mappedBboxMm\":{mapped},",
        "\"topology\":{{\"bodies\":1,\"shells\":1,\"faces\":{faces},\"edges\":{edges},\"vertices\":{vertices},\"loops\":{loops},\"ringEdges\":{rings},\"genus\":{genus},\"closedToroidalFaces\":0,\"singularPoints\":{singular},\"pinchPoints\":0}},",
        "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":true}},\"toleranceMm\":{tolerance:?},\"probes\":[{probes}],\"faceAreasMm2\":{areas:?},\"facePerimetersMm\":{perimeters:?},\"projection\":{projection}}}"),
        volume.m,volume.r/volume.m,area.m,area.r/area.m,certificate=certificate,center=center,lo=lo,hi=hi,mapped=mapped,faces=faces,edges=edges,vertices=vertices,loops=loops,rings=rings,genus=genus,singular=singular,tolerance=tolerance,probes=probes,areas=areas,perimeters=perimeters,projection=projection))

}
