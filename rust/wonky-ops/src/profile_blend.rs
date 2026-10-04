//! Constant blends of extrusion generators at convex analytic profile joints.
//! Fillet centres and normalized tangents are rational. Chamfer setbacks may
//! be quadratic: distance contacts, trim order and reach remain exact. Wider
//! constructions refuse rather than fit a normal or round a contact.
//! Cylinders are the extrusion of a rational-centred circle of radius r;
//! chamfer planes are the extrusion of the exact setback segment. Rounded WC0
//! coordinates are serialization caches authenticated by source replay.
use crate::{
    arc_profile::{self, q, ArcPrism, Profile},
    polyhedron::{Audited, Refused},
};
use num_traits::ToPrimitive;
#[cfg(test)]
use wc::numeric::{cross, dot, exact_root, sub};
#[cfg(test)]
use num_traits::Zero;
#[cfg(test)]
use wonky_blend::profile::{unit,tangent,center_locus};
use wonky_contract::*;
use wonky_curve as wc;
type R<T> = std::result::Result<T, Refused>;
const RULE: u32 = 8;
fn no(s: &str) -> Refused {
    Refused(format!("profile-blend/{s}"))
}
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions.last().is_some_and(|n| {
        n.rule_version == RULE
            && matches!(
                n.operation,
                Operation::Fillet {} | Operation::Intersection {}
            )
    })
}
fn profile(a: &Audited) -> R<ArcPrism> {
    if let Some(s) = &a.arcs {
        if s.rim.is_some() {
            return Err(no("already-blended-cap"));
        }
        return Ok(s.clone());
    }
    if let Some(cells) = &a.orthogonal {
        if cells.boxes.len() != 1 {
            return Err(no("extruded-profile-required"));
        }
        let [lo, hi] = cells.boxes[0];
        let points = [
            [lo[0], lo[1]],
            [hi[0], lo[1]],
            [hi[0], hi[1]],
            [lo[0], hi[1]],
        ];
        return Ok(ArcPrism {
            regularization: None,
            rim: None,
            profile: Profile::from_pieces(
                (0..4)
                    .map(|k| wc::Trimmed::line(points[k], points[(k + 1) % 4]))
                    .collect(),
            ),
            levels: [lo[2], hi[2]],
        });
    }
    if a.axis != 2
        || a.cap.len() < 3
        || a.rounded.is_some()
        || a.corner.is_some()
        || a.chamfer.is_some()
        || a.orthogonal.is_some()
    {
        return Err(no("extruded-profile-required"));
    }
    let pieces = (0..a.cap.len())
        .map(|k| {
            let (p, b) = (a.cap[k], a.cap[(k + 1) % a.cap.len()]);
            wc::Trimmed::line([p.x, p.y], [b.x, b.y])
        })
        .collect();
    Ok(ArcPrism {
        regularization: None,
        rim: None,
        profile: Profile::from_pieces(pieces),
        levels: a.levels,
    })
}
pub(crate) fn admits(a: &Audited, edges: &[usize]) -> bool {
    // Admitted extrusion grammars share the exact profile mechanism. Generator
    // selection must still agree with the source chart, never rounded world points.
    (a.arcs.is_some()
        || (a.axis == 2 && a.cap.len() >= 3 && a.orthogonal.is_none())
        || a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() == 1))
        && !edges.is_empty()
        && a.body
            .constructions
            .last()
            .is_some_and(|n| n.operation == Operation::Extrude {})
        && edges.iter().all(|&i| {
            if let Some(s) = &a.arcs {
                // Source replay authenticates two cap rings followed by one
                // generator per profile corner. Rounded coordinates do not
                // decide which source edge is a generator.
                let n = s.profile.segments().len();
                return (2 * n..3 * n).contains(&i);
            }
            a.body.edges.get(i).is_some_and(|e| {
                e.vertices.len() == 2 && {
                    let p = &a.body.vertices[e.vertices[0].0 as usize].point;
                    let b = &a.body.vertices[e.vertices[1].0 as usize].point;
                    p[0] == b[0] && p[1] == b[1] && p[2] != b[2]
                }
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(coords: [f64; 2]) -> wc::ExactPoint {
        wc::ExactPoint::from_f64(coords)
    }

    #[test]
    fn box_offsets_retain_exact_non_binary64_centres_and_contacts() {
        let prev = wc::Trimmed::line([0.04, 0.], [0.04, 0.03]);
        let next = wc::Trimmed::line([0.04, 0.03], [0., 0.03]);
        let (start, end, arc, convex) = joint(&prev, &next, 0.004, true).unwrap();
        assert!(convex);
        let center = [q(0.04) - q(0.004), q(0.03) - q(0.004)];
        assert_ne!(q(0.04f64 - 0.004), center[0]);
        assert_eq!(start.rat().unwrap(), &[q(0.04), center[1].clone()]);
        assert_eq!(end.rat().unwrap(), &[center[0].clone(), q(0.03)]);
        let wc::Chart::Circle(circle) = arc.chart() else {
            panic!("circle required")
        };
        assert_eq!(circle.c.rat().unwrap(), &center);
        assert_eq!(circle.r2, q(0.004) * q(0.004));
        for contact in [start, end] {
            let d = sub(contact.rat().unwrap(), circle.c.rat().unwrap());
            assert_eq!(dot(&d, &d), circle.r2);
        }
    }

    #[test]
    fn line_circle_fillets_have_exact_contacts_in_both_orders_and_senses() {
        let arc = wc::Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap();
        let line =
            wc::Trimmed::new([point([3., 4.]), point([-3., 4.])], wc::Carrier::Line).unwrap();
        for (prev, next, expected) in [
            (arc.clone(), line.clone(), [[4., 3.], [2., 4.]]),
            (line.clone(), arc.clone(), [[-2., 4.], [-4., 3.]]),
            (line.reversed(), arc.reversed(), [[2., 4.], [4., 3.]]),
            (arc.reversed(), line.reversed(), [[-4., 3.], [-2., 4.]]),
        ] {
            let (start, end, blend, convex) = joint(&prev, &next, 2.5, true).unwrap();
            assert_eq!([start.clone(), end.clone()], expected.map(point));
            let wc::Chart::Circle(circle) = blend.chart() else {
                panic!("not a circle")
            };
            assert_eq!(circle.r2, q(6.25));
            assert_eq!(circle.ccw, convex);
            assert!(cross(
                &tangent(&prev.trim(prev.ends()[0].clone(), start).unwrap(), 1).unwrap(),
                &tangent(&blend, 0).unwrap()
            )
            .is_zero());
            assert!(cross(
                &tangent(&next.trim(end, next.ends()[1].clone()).unwrap(), 0).unwrap(),
                &tangent(&blend, 1).unwrap()
            )
            .is_zero());
        }
    }

    #[test]
    fn circle_circle_fillets_intersect_exact_offset_carriers() {
        let left = wc::Trimmed::arc_through([0., -4.], [2., 0.], [0., 4.]).unwrap();
        let right = wc::Trimmed::arc_through([0., 4.], [-2., 0.], [0., -4.]).unwrap();
        for (prev, next, expected) in [
            (left.clone(), right.clone(), [[1., 3.], [-1., 3.]]),
            (right.clone(), left.clone(), [[-1., -3.], [1., -3.]]),
            (right.reversed(), left.reversed(), [[-1., 3.], [1., 3.]]),
        ] {
            let (start, end, blend, _) = joint(&prev, &next, 1.25, true).unwrap();
            assert_eq!([start, end], expected.map(point));
            let wc::Chart::Circle(circle) = blend.chart() else {
                panic!("not a circle")
            };
            assert_eq!(circle.r2, q(1.5625));
        }
    }

    #[test]
    fn circle_circle_chamfers_use_source_distances_in_both_senses() {
        let left = wc::Trimmed::arc_through([0.,-4.],[2.,0.],[0.,4.]).unwrap();
        let right = wc::Trimmed::arc_through([0.,4.],[-2.,0.],[0.,-4.]).unwrap();
        for width in [0.5,1.25] {
            for (prev,next) in [(left.clone(),right.clone()),(right.clone(),left.clone()),
                (right.reversed(),left.reversed()),(left.reversed(),right.reversed())] {
                let (a,b,chord,convex) = joint(&prev,&next,width,false).unwrap();
                assert_eq!(convex,!matches!(prev.chart(),wc::Chart::Circle(c) if !c.ccw));
                assert!(matches!(chord.chart(),wc::Chart::Line));
                for (source,point) in [(&prev,&a),(&next,&b)] {
                    assert!(source.contains(point).unwrap());
                    assert!(!source.ends().contains(point));
                    let delta = point.difference(&next.ends()[0]);
                    assert_eq!(wc::radical::dot(&delta,&delta),wc::radical::Radical::from(q(width)*q(width)));
                }
            }
        }
    }

    #[test]
    fn curved_chamfer_does_not_require_a_rational_source_radius() {
        let arc = wc::Trimmed::arc_through([-3.,4.],[0.1,-5.],[3.,4.]).unwrap();
        let wc::Chart::Circle(c) = arc.chart() else { panic!("not a circle") };
        assert!(exact_root(&c.r2).is_none());
        let line = wc::Trimmed::line([3.,4.],[-3.,4.]);
        let source = ArcPrism { regularization:None,rim:None,levels:[0.,4.],profile:Profile::from_pieces(vec![arc,line]) };
        let result = modified(&source,&[0,1],0.5,false).unwrap();
        assert_eq!(result.profile.segments().len(),4);
        assert!(result.profile.area().unwrap().lo() > 0.);
        assert!(result.profile.segments().iter().flat_map(|s| s.ends()).any(|p| p.rat().is_err()));
        result.profile.simple().unwrap();
    }

    #[test]
    fn rational_blend_consumers_propagate_quadratic_coordinate_refusal() {
        let points = [[0.,0.],[1.,0.],[1.,1.]].map(|p|
            wc::ExactPoint::from_quadratic(p.map(q),[q(1.),q(0.)],q(2.)).unwrap());
        let prev = wc::Trimmed::new([points[0].clone(),points[1].clone()],wc::Carrier::Line).unwrap();
        let next = wc::Trimmed::new([points[1].clone(),points[2].clone()],wc::Carrier::Line).unwrap();
        let name = wc::Refusal::CrossingNeedsAlgebraicVertex.name();
        assert_eq!(unit(&prev).unwrap_err().0,name);
        assert_eq!(center_locus(&prev,&q(0.1)).unwrap_err().0,name);
        assert_eq!(joint(&prev,&next,0.1,true).unwrap_err().0,name);
    }
    #[test]
    fn curved_fillets_refuse_irrational_contacts_and_face_consumption() {
        let arc = wc::Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap();
        let line =
            wc::Trimmed::new([point([3., 4.]), point([-3., 4.])], wc::Carrier::Line).unwrap();
        // The offset loci meet at (+/-sqrt(8), 3.5). Exact quadratic
        // intersections reach the rational contact consumer's named refusal.
        assert_eq!(
            joint(&arc, &line, 0.5, true).unwrap_err().0,
            wc::Refusal::CrossingNeedsAlgebraicVertex.name()
        );
        assert_eq!(
            joint(&arc, &line, 5., true).unwrap_err().0,
            "profile-blend/offset-curvature-consumed"
        );
        assert_eq!(
            joint(&arc, &line, 4.5, true).unwrap_err().0,
            "profile-blend/adjacent-face-consumed"
        );
        for width in [0.5,2.5] {
            for (prev,next) in [(&arc,&line),(&line,&arc)] {
                let (a,b,chord,convex) = joint(prev,next,width,false).unwrap();
                assert!(convex);
                assert!(matches!(chord.chart(),wc::Chart::Line));
                let corner = next.ends()[0].clone();
                for (source,point) in [(prev,&a),(next,&b)] {
                    assert!(source.contains(point).unwrap());
                    assert!(!source.ends().contains(point));
                    let delta = point.difference(&corner);
                    assert_eq!(wc::radical::dot(&delta,&delta),wc::radical::Radical::from(q(width)*q(width)));
                }
                assert!(a.rat().is_err() || b.rat().is_err());
            }
        }
    }

    #[test]
    fn curved_trim_order_refuses_crossed_or_consumed_setbacks() {
        let arc = wc::Trimmed::arc_through([-3., 4.], [0., -5.], [3., 4.]).unwrap();
        assert!(retained_order(&arc, &[point([-4., 3.]), point([4., 3.])]).is_ok());
        for ends in [
            [point([4., 3.]), point([-4., 3.])],
            [point([4., 3.]), point([4., 3.])],
            [point([-4., 3.]), point([4., 2.])],
        ] {
            assert_eq!(
                retained_order(&arc, &ends).unwrap_err().0,
                "profile-blend/adjacent-face-consumed"
            );
        }
        let poisoned = wc::Trimmed::with_cache(
            arc.ends().clone(),
            [[99., 99.], [-99., -99.]],
            arc.carrier().clone(),
        );
        let line =
            wc::Trimmed::new([point([3., 4.]), point([-3., 4.])], wc::Carrier::Line).unwrap();
        let (start, end, blend, convex) = joint(&poisoned, &line, 2.5, true).unwrap();
        let (expected_start, expected_end, expected_blend, expected_convex) =
            joint(&arc, &line, 2.5, true).unwrap();
        assert_eq!(
            (start, end, convex),
            (expected_start, expected_end, expected_convex)
        );
        assert_eq!(blend.ends(), expected_blend.ends());
        let wc::Chart::Circle(circle) = blend.chart() else {
            panic!("not a circle")
        };
        let wc::Chart::Circle(expected) = expected_blend.chart() else {
            panic!("not a circle")
        };
        assert_eq!(
            (&circle.c, &circle.r2, circle.ccw),
            (&expected.c, &expected.r2, expected.ccw)
        );
    }

    #[test]
    fn generator_admission_uses_source_topology_not_vertex_caches() {
        let body = arc_profile::build(
            BodyKey {
                id: [19; 4],
                revision: 0,
            },
            crate::affine::Affine::IDENTITY,
            &[[0., 0., 4., 0.], [4., 0., 4., 4.], [4., 4., 0., 4.]],
            &[[0., 4., -2., 2., 0., 0.]],
            2.,
            false,
        )
        .unwrap();
        let mut a = crate::polyhedron::audit(&body.check().unwrap()).unwrap();
        let n = a.arcs.as_ref().unwrap().profile.segments().len();
        assert!(admits(&a, &[2 * n]));
        assert!(!admits(&a, &[0]));
        assert!(!admits(&a, &[3 * n]));
        // Deliberately poison only the observation cache. This is a dispatch
        // test, not an assertion that a corrupted body passes the auditor.
        a.body.vertices[n].point[0] = arc_profile::b(123.).unwrap();
        a.body.vertices[1].point = a.body.vertices[0].point;
        a.body.vertices[1].point[2] = arc_profile::b(1.).unwrap();
        assert!(admits(&a, &[2 * n]));
        assert!(!admits(&a, &[0]));
    }
}
/// Compatibility adapter onto the shared, family-independent exact normal
/// section. WC0 profile circles still require rational centres and explicitly
/// refuse the wider quadratic result; no coordinate is rounded to admit it.
pub(crate) fn joint(
    prev: &wc::Trimmed, next: &wc::Trimmed, width: f64, fillet: bool,
) -> R<(wc::ExactPoint, wc::ExactPoint, wc::Trimmed, bool)> {
    if !width.is_finite() || width <= 0. {return Err(no("invalid-size"));}
    let joint=wonky_blend::profile::construct(prev,next,&q(width),fillet)
        .map_err(|e| Refused(e.0))?;
    let section=joint.trimmed().map_err(|e| Refused(e.0))?;
    Ok((joint.springs[0].clone(),joint.springs[1].clone(),section,joint.convex))
}
fn modified(s: &ArcPrism, corners: &[usize], width: f64, fillet: bool) -> R<ArcPrism> {
    use wonky_geom::{frame::Frame, model::{Bounds, EdgeId, Label, extrusion}};
    if !width.is_finite() || width <= 0. { return Err(no("invalid-size")); }
    let model = extrusion::profile(Frame::identity(),Label::Exact,0,s.profile.segments(),s.levels.map(q))
        .and_then(wonky_geom::model::Draft::check).map_err(|e|Refused(e.0.into()))?;
    let mut selected = vec![];
    for &k in corners {
        let xy = s.profile.segments().get(k).ok_or_else(||no("corner-index"))?.ends()[0].coordinates();
        let id = model.draft().edges.iter().enumerate().find_map(|(i,e)| {
            let Bounds::Segment(v) = e.bounds else { return None };
            let [a,b] = v.map(|v|model.key(v).coordinates());
            (a[0]==xy[0] && a[1]==xy[1] && a[0]==b[0] && a[1]==b[1] && a[2]!=b[2]).then_some(EdgeId(i as u32))
        }).ok_or_else(||no("selection-not-in-model"))?;
        selected.push(id);
    }
    let replacement = wonky_blend::profile_model::replace(&model,&selected,&q(width),fillet,1)
        .map_err(|e|Refused(e.0))?;
    if !replacement.convex_joints { return Err(no("non-convex-or-tangent-joint")); }
    let profile = Profile::from_pieces(replacement.legacy_pieces().map_err(|e|Refused(e.0))?);
    profile.simple()?;
    Ok(ArcPrism { profile, ..s.clone() })
}
pub(crate) fn retained_order(seg: &wc::Trimmed, ends: &[wc::ExactPoint; 2]) -> R<()> {
    if ends[0] == ends[1] { return Err(no("adjacent-face-consumed")); }
    for point in ends {
        if !seg.contains(point)? { return Err(no("adjacent-face-consumed")); }
    }
    let ordered = seg.sorted_cuts(ends.to_vec())?;
    if ordered != ends.to_vec() {
        return Err(no("adjacent-face-consumed"));
    }
    Ok(())
}
pub(crate) fn apply(a: &Audited, edges: &[usize], size: f64, fillet: bool) -> R<Body> {
    if let Some(result) = crate::pattern::modify(a, |source| apply(source, edges, size, fillet))? {
        return Ok(result);
    }
    crate::source_frame::SourceMetric::new(&a.frame)?;
    if !admits(a, edges) {
        return Err(no("whole-generator-edges-required"));
    }
    let s = profile(a)?;
    let mut corners = std::collections::BTreeSet::new();
    for &index in edges {
        let e = &a.body.edges[index];
        let k = if a.arcs.is_some() {
            // Arc-profile serialization keeps two vertex rings in profile
            // order. IDs retain the exact corner even when its cache rounds.
            let n = s.profile.segments().len();
            let k = e.vertices[0].0 as usize % n;
            if e.vertices[1].0 as usize % n != k {
                return Err(no("source-vertex-required"));
            }
            k
        } else {
            let p = a.body.vertices[e.vertices[0].0 as usize]
                .point
                .map(|x| x.get());
            let mut found = None;
            for (i, seg) in s.profile.segments().iter().enumerate() {
                if seg.ends()[0].rat()? == &[q(p[0]), q(p[1])] { found = Some(i); break; }
            }
            found.ok_or_else(|| no("source-vertex-required"))?
        };
        corners.insert(k);
    }
    construct(
        a.body.clone(),
        &s,
        &corners.into_iter().collect::<Vec<_>>(),
        size,
        fillet,
    )
}
fn construct(mut body: Body, s: &ArcPrism, corners: &[usize], size: f64, fillet: bool) -> R<Body> {
    let result = modified(s, corners, size, fillet)?;
    if result.profile.segments().iter().flat_map(|s| s.ends()).any(|p| p.rat().is_err()) {
        let Some(Frame::Interpreter { origin,x,z,.. }) = body.frames.get(1) else {
            return Err(no("source-frame"));
        };
        let frame = crate::placement::Placement::from_affine(crate::affine::Affine {
            origin: origin.map(|v| v.get()),x: x.map(|v| v.get()),z: z.map(|v| v.get()),
        }).map_err(|_| no("source-frame"))?;
        let floor = crate::prism_stack::export_resolution_floor(
            &frame,result.profile.segments().iter().flat_map(|s| s.ends()),
            result.profile.segments().iter(),&result.levels.map(q),
        )?;
        result.profile.cycle().certify_resolution(floor)?;
    }
    let root = body.constructions.len() - 1;
    body.constructions.push(Construction {
        operation: if fillet {
            Operation::Fillet {}
        } else {
            Operation::Intersection {}
        },
        rule_version: RULE,
        parents: vec![NodeId(root as u32)],
        frame: FrameId(1),
        parameters: std::iter::once(size)
            .chain(corners.iter().map(|&k| k as f64))
            .map(arc_profile::b)
            .collect::<R<_>>()?,
    });
    crate::arc_profile_brep::construct(body.key, body.frames, body.constructions, &result)
}
/// Both source formats are already accepted extrusion grammars. Rebuild the
/// parent at the same revision and compare its DAG before applying any blend.
fn source(body: &Body) -> R<Audited> {
    let nodes = &body.constructions[..body.constructions.len() - 1];
    let rebuilt = if nodes.len() == 3 && nodes[1].operation == (Operation::Sketch {}) {
        arc_profile::Source::parse(&body.frames, nodes)?.build(body.key.clone())?
    } else if nodes.len() == 2 && nodes[1].operation == (Operation::Extrude {}) {
        let frame = crate::placement::Placement::from_frames(body, FrameId(1))
            .map_err(|_| no("source-frame"))?
            .as_affine()?;
        let mut rebuilt = crate::orthogonal::construct(body.key.clone(), frame, nodes.to_vec(), 1)?;
        if rebuilt.len() != 1 {
            return Err(no("source-grammar"));
        }
        rebuilt.remove(0)
    } else if nodes.len() == 5 && nodes[3].operation == (Operation::Sketch {}) {
        if nodes[1].parameters.len() % 4 != 0 || nodes[2].parameters.len() != 2 {
            return Err(no("source-grammar"));
        }
        let lines = nodes[1]
            .parameters
            .chunks_exact(4)
            .map(|p| [p[0].get(), p[1].get(), p[2].get(), p[3].get()])
            .collect::<Vec<_>>();
        let segs = lines
            .iter()
            .map(|p| [wonky_num::p2(p[0], p[1]), wonky_num::p2(p[2], p[3])])
            .collect::<Vec<_>>();
        let regions =
            wonky_sketch::region::lines_region(&segs).map_err(|_| no("source-regions"))?;
        let points = nodes[3]
            .parameters
            .iter()
            .map(|p| p.get())
            .collect::<Vec<_>>();
        let region = regions
            .loops
            .iter()
            .find(|r| {
                r.points
                    .iter()
                    .flat_map(|p| [p.x, p.y])
                    .eq(points.iter().copied())
            })
            .ok_or_else(|| no("source-region"))?;
        let (Some(Frame::Source { source }), Some(Frame::Interpreter { origin, x, z, .. })) =
            (body.frames.first(), body.frames.get(1))
        else {
            return Err(no("source-frame"));
        };
        crate::extrude::blind_prism(&crate::extrude::Prism {
            key: body.key.clone(),
            source: *source,
            frame: crate::affine::Affine {
                origin: origin.map(|x| x.get()),
                x: x.map(|x| x.get()),
                z: z.map(|x| x.get()),
            },
            segments: &lines,
            region,
            depth: nodes[2].parameters[0].get(),
            reverse: nodes[2].parameters[1].get() == -1.,
        })
        .map_err(|_| no("source-extrusion"))?
    } else {
        return Err(no("source-grammar"));
    };
    if rebuilt.frames != body.frames || rebuilt.constructions != nodes {
        return Err(no("source-grammar-mismatch"));
    }
    crate::polyhedron::audit(&rebuilt.check().map_err(|_| no("source-contract"))?)
}
/// The blend node of `body`: fillet or chamfer, size and profile corners.
fn blend_node(body: &Body) -> R<(bool, f64, Vec<usize>)> {
    let root = body
        .constructions
        .last()
        .ok_or_else(|| no("construction"))?;
    if !candidate(body)
        || root.parents != [NodeId(body.constructions.len() as u32 - 2)]
        || root.frame != FrameId(1)
        || root.parameters.len() < 2
    {
        return Err(no("construction"));
    }
    let corners = root.parameters[1..]
        .iter()
        .map(|p| {
            let f = p.get();
            f.to_usize()
                .filter(|&k| k as f64 == f)
                .ok_or_else(|| no("corner-index"))
        })
        .collect::<R<Vec<_>>>()?;
    Ok((root.operation == Operation::Fillet {}, root.parameters[0].get(), corners))
}
/// The blended body rebuilt from its source nodes alone (the frames and
/// constructions of `body`), exactly as the audit replays it.
pub(crate) fn rebuild(body: &Body) -> R<Body> {
    let (fillet, size, corners) = blend_node(body)?;
    let a = source(body)?;
    construct(a.body.clone(), &profile(&a)?, &corners, size, fillet)
}
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    let (fillet, size, corners) = blend_node(body)?;
    let mut a = source(body)?;
    let s = profile(&a)?;
    let result = modified(&s, &corners, size, fillet)?;
    let expected = construct(a.body.clone(), &s, &corners, size, fillet)?;
    if &expected != body {
        return Err(no("construction-carrier-mismatch"));
    }
    a.body = body.clone();
    a.cap.clear();
    a.arrangement = None;
    a.orthogonal = None;
    a.arcs = Some(result);
    a.face_loops = body
        .loops
        .iter()
        .map(|lp| {
            lp.coedges
                .iter()
                .map(|id| {
                    let co = &body.coedges[id.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    Ok(a)
}
