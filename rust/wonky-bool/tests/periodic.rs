use wonky_bool::periodic::{split_band, Source};
use wonky_curve::{radical::Radical, Budget};
use wonky_geom::Q;
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn r(n: i64) -> Radical {
    q(n).into()
}
fn budget() -> Budget {
    Budget {
        segments: 128,
        pieces: 256,
    }
}
fn dirs() -> Vec<[Radical; 2]> {
    vec![[r(0), r(1)], [r(0), r(-1)]]
}

#[test]
fn two_generators_and_two_boundary_rings_make_four_cells_after_one_ring_cut() {
    // Two meridians x=0 cut the circumference in two; one interior latitude
    // cuts height in two. Virtual charts must neither add nor lose a cell.
    let split = split_band(r(0), r(10), &[r(4)], &dirs(), &[], budget()).unwrap();
    assert_eq!(split.cells.len(), 4);
    assert_ne!(split.seam.axis, [q(1), q(0)]); // forced seam through generators re-chosen
    for cell in &split.cells {
        assert_eq!(cell.loops.len(), 1);
        assert_eq!(cell.loops[0].len(), 4);
        for edge in &cell.loops[0] {
            assert!(edge.ends.is_some());
        }
    }
}
#[test]
fn vertex_free_rings_survive_both_chart_seams() {
    let split = split_band(r(0), r(10), &[r(4)], &[], &[], budget()).unwrap();
    assert_eq!(split.cells.len(), 2);
    for cell in &split.cells {
        assert_eq!(cell.loops.len(), 2);
        for lp in &cell.loops {
            assert_eq!(lp.len(), 1);
            let co = &lp[0];
            assert!(co.ends.is_none());
            assert!(matches!(co.source, Source::Ring(_)));
            assert_eq!(co.pieces.len(), 2);
            assert_eq!(co.winding_delta.abs(), 1);
        }
    }
}
#[test]
fn seam_avoids_preexisting_vertices_without_inventing_sections() {
    let split = split_band(r(0), r(10), &[], &[], &dirs(), budget()).unwrap();
    assert_ne!(split.seam.axis, [q(1), q(0)]);
    assert_eq!(split.cells.len(), 1);
    assert_eq!(split.cells[0].loops.len(), 2);
    assert!(split.cells[0].loops.iter().all(|lp| lp[0].ends.is_none()));
}
#[test]
fn sub_nanometre_gap_is_not_welded() {
    let gap = Q::new(1.into(), (1u64 << 30).into());
    let split = split_band(
        r(0),
        r(10),
        &[r(4), Radical::from(q(4) + gap.clone())],
        &[],
        &[],
        budget(),
    )
    .unwrap();
    assert_eq!(
        split.cells.len(),
        3,
        "AC44-scale analytic gap must survive exact stitching"
    );
    let narrow = split
        .cells
        .iter()
        .find(|c| {
            c.witnesses
                .iter()
                .all(|w| w.height > r(4) && w.height < Radical::from(q(4) + gap.clone()))
        })
        .unwrap();
    assert_eq!(narrow.loops.len(), 2);
}
#[test]
fn duplicate_sections_do_not_duplicate_topology() {
    let a = split_band(r(0), r(10), &[r(4)], &dirs(), &[], budget()).unwrap();
    let b = split_band(
        r(0),
        r(10),
        &[r(0), r(4), r(4), r(10)],
        &[dirs(), dirs()].concat(),
        &[],
        budget(),
    )
    .unwrap();
    assert_eq!(a.cells.len(), b.cells.len());
    assert_eq!(a.rings, b.rings);
    assert_eq!(a.generators, b.generators);
}
#[test]
fn quadratic_generators_are_exact_and_do_not_require_float_angles() {
    let h = Q::new(1.into(), 2.into());
    let a = Radical::quadratic(q(0), h.clone(), q(2)).unwrap();
    let split = split_band(
        r(0),
        r(10),
        &[r(4)],
        &[[a.clone(), a.clone()], [-&a, a]],
        &[],
        budget(),
    )
    .unwrap();
    assert_eq!(split.cells.len(), 4);
    assert!(split
        .cells
        .iter()
        .flat_map(|c| &c.loops)
        .flatten()
        .filter_map(|e| e.ends.as_ref())
        .flatten()
        .all(|p| &p.direction[0] * &p.direction[0] + &p.direction[1] * &p.direction[1] == r(1)));
}
#[test]
fn capability_and_budget_errors_are_explicit() {
    assert_eq!(
        split_band(r(10), r(0), &[], &[], &[], budget())
            .unwrap_err()
            .0,
        "boolean/contract-violation:periodic/band"
    );
    assert_eq!(
        split_band(r(0), r(10), &[], &[[r(1), r(1)]], &[], budget())
            .unwrap_err()
            .0,
        "boolean/contract-violation:periodic/unit-direction"
    );
    assert_eq!(
        split_band(r(0), r(10), &[r(11)], &[], &[], budget())
            .unwrap_err()
            .0,
        "boolean/contract-violation:periodic/ring-range"
    );
    assert!(split_band(
        r(0),
        r(10),
        &[],
        &[],
        &[],
        Budget {
            segments: 3,
            pieces: 256
        }
    )
    .is_err());
}

use wonky_bool::periodic;
use wonky_geom::{
    frame::Frame,
    model::{Carrier3, FaceId, Membership, Model, PiValue},
};
fn cylinder(radius: i64, lo: i64, hi: i64, origin: [Q; 3]) -> Model {
    wonky_geom::model::revolution::revolution(
        Frame::identity(),
        Frame::new(origin, Frame::identity().columns().clone()).unwrap(),
        &[
            [q(0), q(lo)],
            [q(radius), q(lo)],
            [q(radius), q(hi)],
            [q(0), q(hi)],
        ],
        1,
    )
    .unwrap()
    .check()
    .unwrap()
}
fn lateral(m: &Model) -> FaceId {
    FaceId(
        m.draft()
            .faces
            .iter()
            .position(|f| {
                matches!(
                    m.draft().surfaces[f.surface.index()].carrier,
                    Carrier3::Cylinder(_) | Carrier3::Cone(_)
                )
            })
            .unwrap() as u32,
    )
}
#[test]
fn g9_sections_are_consumed_in_the_carriers_own_frame() {
    let m = cylinder(2, 0, 10, [q(3), q(4), q(5)]);
    let f = lateral(&m);
    let own = &m.draft().surfaces[m.draft().faces[f.index()].surface.index()].carrier;
    let plane = Carrier3::Plane(wonky_geom::model::Plane3 {
        o: [q(0), q(0), q(9)],
        n: [q(0), q(0), q(1)],
        x: [q(1), q(0), q(0)],
    });
    let sections =
        match wonky_bool::a1::intersect(own, &plane, wonky_alg::Limits::default()).unwrap() {
            wonky_bool::a1::Intersection::Section { branches, .. } => branches,
            wonky_bool::a1::Intersection::Coincident => panic!("transverse plane"),
        };
    let split = periodic::split_face(&m, f, &sections, budget()).unwrap();
    assert_eq!(split.cells.len(), 2);
    assert!(split.rings.contains(&r(4)));
}
#[test]
fn independent_ray_opinion_checks_every_chart_fragment() {
    let m = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    let f = lateral(&m);
    let split = periodic::split_face(&m, f, &[], budget()).unwrap();
    let identical = periodic::classify(&m, f, &split, &m).unwrap();
    assert_eq!(identical, vec![wonky_bool::Class::OnSame]);
    let larger = cylinder(3, -1, 11, [q(0), q(0), q(0)]);
    assert_eq!(
        periodic::classify(&m, f, &split, &larger).unwrap(),
        vec![wonky_bool::Class::In]
    );
    let distant = cylinder(2, 0, 10, [q(20), q(0), q(0)]);
    assert_eq!(
        periodic::classify(&m, f, &split, &distant).unwrap(),
        vec![wonky_bool::Class::Out]
    );
    // Missing section: one chart witness lies in the overlapping cylinder,
    // the other outside. Propagating through its real boundary must refuse.
    let overlapping = cylinder(2, 0, 10, [q(2), q(0), q(0)]);
    assert_eq!(
        periodic::classify(&m, f, &split, &overlapping)
            .unwrap_err()
            .0,
        "boolean/contract-violation:classify/second-opinion"
    );
}
#[test]
fn curved_membership_uses_two_hits_and_exact_ring_trims() {
    let m = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    for reverse in [false, true] {
        assert_eq!(
            m.membership(&[q(0), q(0), q(5)], reverse).unwrap(),
            Membership::Inside
        );
        assert_eq!(
            m.membership(&[q(3), q(0), q(5)], reverse).unwrap(),
            Membership::Outside
        );
        assert_eq!(
            m.membership(&[q(0), q(0), q(11)], reverse).unwrap(),
            Membership::Outside
        );
        for h in [-1, 11] {
            assert_eq!(
                m.membership(&[q(2), q(0), q(h)], reverse).unwrap(),
                Membership::Outside
            );
        }
        assert!(matches!(
            m.membership(&[q(2), q(0), q(5)], reverse).unwrap(),
            Membership::Boundary(_)
        ));
    }
}
#[test]
fn green_measures_full_rings_exactly_and_sectors_by_enclosure() {
    let split = split_band(r(0), r(10), &[r(4)], &[], &[], budget()).unwrap();
    let measures = periodic::angular_area(&split).unwrap();
    let pi: Q = measures
        .iter()
        .map(|m| m.exact.as_ref().unwrap().pi.clone())
        .sum();
    assert_eq!(pi, q(20));
    let split = split_band(r(0), r(10), &[r(4)], &dirs(), &[], budget()).unwrap();
    let measures = periodic::angular_area(&split).unwrap();
    assert!(measures
        .iter()
        .all(|m| m.exact.is_none() && m.enclosure.lo() > 0.));
    let sum = measures
        .iter()
        .fold(wonky_num::Iv::point(0.), |a, m| a + m.enclosure);
    assert!(sum.lo() <= 20. * std::f64::consts::PI && sum.hi() >= 20. * std::f64::consts::PI);
    assert!(sum.hi() - sum.lo() < 1e-10);
}
#[test]
fn green_divergence_matches_cylinder_and_frustum_closed_forms() {
    let cylinder = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    let cone = wonky_geom::model::revolution::revolution(
        Frame::identity(),
        Frame::identity(),
        &[[q(0), q(0)], [q(2), q(0)], [q(4), q(10)], [q(0), q(10)]],
        2,
    )
    .unwrap()
    .check()
    .unwrap();
    for (m, expected, lateral_pi) in [(&cylinder, q(240), q(160)), (&cone, q(560), q(240))] {
        assert_eq!(m.volume6_pi().unwrap()[0].pi, expected);
        let f = lateral(m);
        let split = periodic::split_face(m, f, &[], budget()).unwrap();
        let volume = periodic::volume6(m, f, &split).unwrap();
        assert_eq!(volume[0].exact.as_ref().unwrap().pi, lateral_pi);
        let sliced = split_band(r(0), r(10), &[r(4)], &dirs(), &[], budget()).unwrap();
        let volume = periodic::volume6(m, f, &sliced).unwrap();
        let sum = volume
            .iter()
            .fold(wonky_num::Iv::point(0.), |a, m| a + m.enclosure);
        let expected = wonky_curve::numeric::enclose(&lateral_pi).unwrap() * wonky_curve::pi();
        assert!(sum.lo() <= expected.hi() && sum.hi() >= expected.lo());
    }
}
#[test]
fn machin_pi_enclosures_are_signed_and_tighten_without_float_decisions() {
    let value = PiValue {
        rational: q(10),
        pi: q(-3),
        pi2: q(0),
    };
    let (lo, hi) = value.enclosure(8).unwrap();
    let (a, b) = value.enclosure(16).unwrap();
    assert!(lo < a && b < hi);
    assert!(a < b);
    let positive = PiValue {
        rational: q(-10),
        pi: q(3),
        pi2: q(0),
    };
    let (c, d) = positive.enclosure(16).unwrap();
    assert_eq!((c, d), (-b, -a));
    assert!(value.enclosure(0).is_err());
    assert!(value.enclosure(513).is_err());
}
#[test]
fn a_nonseparating_generator_is_a_slit_with_real_ring_vertices() {
    let split = split_band(r(0), r(10), &[], &[[r(1), r(0)]], &[], budget()).unwrap();
    assert_eq!(split.cells.len(), 1);
    assert_eq!(split.cells[0].loops.len(), 1);
    let lp = &split.cells[0].loops[0];
    assert_eq!(lp.len(), 4); // both sides of slit + two full latitudes
    assert!(lp.iter().all(|e| e.ends.is_some()));
    assert_eq!(
        lp.iter()
            .filter(|e| matches!(e.source, Source::Generator(_)))
            .count(),
        2
    );
}
#[test]
fn parallel_cylinder_sections_split_and_classify_the_actual_lens() {
    let m = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    let other = cylinder(2, 0, 10, [q(2), q(0), q(0)]);
    let f = lateral(&m);
    let g = lateral(&other);
    let a = &m.draft().surfaces[m.draft().faces[f.index()].surface.index()].carrier;
    let b = &other.draft().surfaces[other.draft().faces[g.index()].surface.index()].carrier;
    let branches = match wonky_bool::a1::intersect(a, b, wonky_alg::Limits::default()).unwrap() {
        wonky_bool::a1::Intersection::Section { branches, .. } => branches,
        wonky_bool::a1::Intersection::Coincident => panic!("offset cylinders"),
    };
    let split = periodic::split_face(&m, f, &branches, budget()).unwrap();
    assert_eq!(split.cells.len(), 2);
    let mut classes = periodic::classify(&m, f, &split, &other).unwrap();
    classes.sort();
    let mut expected = vec![wonky_bool::Class::In, wonky_bool::Class::Out];
    expected.sort();
    assert_eq!(classes, expected);
    let sum = periodic::angular_area(&split)
        .unwrap()
        .iter()
        .fold(wonky_num::Iv::point(0.), |a, m| a + m.enclosure);
    assert!(sum.lo() <= 20. * std::f64::consts::PI && sum.hi() >= 20. * std::f64::consts::PI);
}
#[test]
fn frozen_adapter_models_have_equal_general_green_values() {
    // Historical bytes are source coverage, not a claim of a live Boolean
    // shadow run. Every actual family body goes through decode/audit/model.
    let mut count = 0;
    for line in include_str!("../../wonky-ops/tests/data/acid-curved-wc0.txt").lines() {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let mut fields = line.split_whitespace();
        let zone = fields.next().unwrap();
        let variant = fields.next().unwrap();
        let body = fields.next().unwrap();
        let fields: Vec<_> = fields.collect();
        assert_eq!(fields.len(), 3);
        let words: Vec<u32> = fields[2]
            .as_bytes()
            .chunks(8)
            .map(|x| u32::from_str_radix(std::str::from_utf8(x).unwrap(), 16).unwrap())
            .collect();
        let audited = wonky_wire::v3::decode(&words).unwrap();
        let family = wonky_ops::analytic::audit(&audited).unwrap();
        let model = family.model().unwrap();
        let general = periodic::measure_model(&model, budget())
            .unwrap_or_else(|e| panic!("{zone} {variant} {body}: {e:?}"));
        assert_eq!(
            general,
            model.volume6_pi().unwrap(),
            "{zone} {variant} {body}"
        );
        count += 1;
    }
    assert_eq!(count, 36);
}
#[test]
fn affine_placement_preserves_classification_and_own_frame_measures() {
    let mut m = cylinder(2, 0, 10, [q(0), q(0), q(0)]).into_draft();
    let mut other = cylinder(3, -1, 11, [q(0), q(0), q(0)]).into_draft();
    let frame = Frame::new(
        [q(100), q(-20), q(17)],
        [[q(2), q(0), q(0)], [q(1), q(3), q(0)], [q(0), q(0), q(4)]],
    )
    .unwrap();
    m.placement = frame.clone();
    other.placement = frame;
    let m = m.check().unwrap();
    let other = other.check().unwrap();
    let f = lateral(&m);
    let split = periodic::split_face(&m, f, &[], budget()).unwrap();
    assert_eq!(
        periodic::classify(&m, f, &split, &other).unwrap(),
        vec![wonky_bool::Class::In]
    );
    assert_eq!(periodic::measure_model(&m, budget()).unwrap()[0].pi, q(240));
}

#[test]
fn selected_same_carrier_cells_merge_into_vertex_free_rings() {
    let split = split_band(r(0), r(10), &[r(4), r(6)], &dirs(), &[], budget()).unwrap();
    let cells = periodic::merge(&split, &vec![true; split.cells.len()]).unwrap();
    assert_eq!(cells.len(), 1);
    assert_eq!(cells[0].loops.len(), 2);
    assert!(cells[0]
        .loops
        .iter()
        .all(|lp| lp.len() == 1 && lp[0].ends.is_none()));
    assert!(cells[0]
        .loops
        .iter()
        .all(|lp| matches!(lp[0].source, Source::Ring(0) | Source::Ring(1))));
    assert!(periodic::merge(&split, &vec![false; split.cells.len()])
        .unwrap()
        .is_empty());
}
#[test]
fn selected_merge_preserves_an_unselected_exact_gap() {
    let gap = Q::new(1.into(), (1u64 << 30).into());
    let hi = Radical::from(q(4) + gap);
    let split = split_band(r(0), r(10), &[r(4), hi.clone()], &dirs(), &[], budget()).unwrap();
    let keep: Vec<_> = split
        .cells
        .iter()
        .map(|c| !(c.witnesses[0].height > r(4) && c.witnesses[0].height < hi))
        .collect();
    let cells = periodic::merge(&split, &keep).unwrap();
    assert_eq!(cells.len(), 2);
    assert!(cells.iter().all(|c| c.loops.len() == 2));
    let mut rings: Vec<_> = cells
        .iter()
        .flat_map(|c| &c.loops)
        .flatten()
        .map(|e| e.source)
        .collect();
    rings.sort();
    assert_eq!(
        rings,
        vec![
            Source::Ring(0),
            Source::Ring(1),
            Source::Ring(2),
            Source::Ring(3)
        ]
    );
}
#[test]
fn quadratic_latitudes_have_strict_rational_chart_witnesses() {
    let root = Radical::quadratic(q(0), q(1), q(2)).unwrap();
    let gap = Q::new(1.into(), (1u64 << 30).into());
    let top = &root + gap;
    let split = split_band(
        r(0),
        r(10),
        &[root.clone(), top.clone()],
        &dirs(),
        &[],
        budget(),
    )
    .unwrap();
    assert_eq!(split.cells.len(), 6);
    let narrow: Vec<_> = split
        .cells
        .iter()
        .filter(|c| {
            c.witnesses
                .iter()
                .all(|w| w.height > root && w.height < top)
        })
        .collect();
    assert_eq!(narrow.len(), 2);
    assert!(narrow
        .iter()
        .all(|c| c.witnesses.iter().all(|w| w.height.rational().is_some())));
    let measures = periodic::angular_area(&split).unwrap();
    assert!(measures.iter().all(|m| m.enclosure.lo() > 0.));
}
#[test]
fn quadratic_gap_below_binary64_resolution_still_has_a_rational_witness() {
    let root = Radical::quadratic(q(1 << 25), q(1), q(2)).unwrap();
    let gap = Q::new(1.into(), (1u64 << 60).into());
    let top = &root + gap;
    let split = split_band(root.clone(), top.clone(), &[], &[], &[], budget()).unwrap();
    assert_eq!(split.cells.len(), 1);
    assert!(split.cells[0]
        .witnesses
        .iter()
        .all(|w| w.height > root && w.height < top && w.height.rational().is_some()));
}
#[test]
fn oblique_pcurves_and_collapsed_apex_trims_are_named_refusals() {
    let m = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    let f = lateral(&m);
    // This rational affine image lies on the cylinder, but z varies with
    // angle: it cannot be silently replaced by a constant-height latitude.
    let frame = Frame::new(
        [q(0), q(0), q(5)],
        [[q(1), q(0), q(1)], [q(0), q(1), q(0)], [q(0), q(0), q(1)]],
    )
    .unwrap();
    let section = wonky_bool::a1::SectionBranch {
        curve: wonky_bool::a1::Branch::Circle {
            frame,
            height: r(0),
            radius: r(2),
        },
        multiplicity: 1,
    };
    assert_eq!(
        periodic::split_face(&m, f, &[section], budget())
            .unwrap_err()
            .0,
        "boolean/ssi-row-unavailable:circle/non-latitude-chart"
    );
    let apex = wonky_geom::model::revolution::revolution(
        Frame::identity(),
        Frame::identity(),
        &[[q(0), q(0)], [q(2), q(0)], [q(0), q(10)]],
        5,
    )
    .unwrap()
    .check()
    .unwrap();
    assert_eq!(
        periodic::split_face(&apex, lateral(&apex), &[], budget())
            .unwrap_err()
            .0,
        "boolean/chart-singularity:apex"
    );
    let bad = split_band(r(1), r(10), &[], &[], &[], budget()).unwrap();
    assert_eq!(
        periodic::classify(&m, f, &bad, &m).unwrap_err().0,
        "boolean/contract-violation:periodic/split-domain"
    );
    assert_eq!(
        periodic::volume6(&m, f, &bad).unwrap_err().0,
        "boolean/contract-violation:periodic/split-domain"
    );
}

#[test]
fn translated_partial_band_green_includes_exact_transverse_origin_terms() {
    // Right/left semicylinders: integral cos(theta) dtheta = +/-2.
    // Cylinder R=2, H=10: flux6 = 80*pi +/- 80*ox.
    // Frustum r=2+h/5, H=10, oz=5: flux6 = 60*pi +/- 120*ox.
    let cylinder = cylinder(2, 0, 10, [q(3), q(4), q(5)]);
    let frame = Frame::new([q(3), q(4), q(5)], Frame::identity().columns().clone()).unwrap();
    let cone = wonky_geom::model::revolution::revolution(
        Frame::identity(),
        frame,
        &[[q(0), q(0)], [q(2), q(0)], [q(4), q(10)], [q(0), q(10)]],
        9,
    )
    .unwrap()
    .check()
    .unwrap();
    for (m, pi, offset) in [(&cylinder, 80, 240), (&cone, 60, 360)] {
        let f = lateral(m);
        let split = split_band(r(0), r(10), &[], &dirs(), &[], budget()).unwrap();
        let measures = periodic::volume6(m, f, &split).unwrap();
        for (cell, measure) in split.cells.iter().zip(measures) {
            let sign = if cell.witnesses[0].direction[0] > r(0) {
                1
            } else {
                -1
            };
            let expected = PiValue {
                rational: q(sign * offset),
                pi: q(pi),
                pi2: q(0),
            };
            let (lo, hi) = expected.enclosure(16).unwrap();
            assert!(Q::from_float(measure.enclosure.lo()).unwrap() <= lo);
            assert!(Q::from_float(measure.enclosure.hi()).unwrap() >= hi);
            assert!(measure.enclosure.hi() - measure.enclosure.lo() < 1e-9);
        }
    }
}

#[test]
fn operand_sections_partition_trimmed_overlap_without_manual_branches() {
    let m = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    let other = cylinder(2, 3, 7, [q(2), q(0), q(0)]);
    let face = lateral(&m);
    let split =
        periodic::split_against(&m, face, &other, budget(), wonky_alg::Limits::default()).unwrap();
    assert_eq!(split.cells.len(), 6);
    let mut heights = split.rings.clone();
    heights.sort();
    assert_eq!(heights, vec![r(0), r(3), r(7), r(10)]);
    let classes = periodic::classify(&m, face, &split, &other).unwrap();
    assert_eq!(
        classes
            .iter()
            .filter(|&&c| c == wonky_bool::Class::In)
            .count(),
        1
    );
    assert_eq!(
        classes
            .iter()
            .filter(|&&c| c == wonky_bool::Class::Out)
            .count(),
        5
    );
    let keep: Vec<_> = classes
        .iter()
        .map(|&c| c == wonky_bool::Class::In)
        .collect();
    let selected = periodic::merge(&split, &keep).unwrap();
    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].loops.len(), 1);
    assert_eq!(selected[0].loops[0].len(), 4);
    let coincident = cylinder(2, 3, 7, [q(0), q(0), q(0)]);
    let split = periodic::split_against(
        &m,
        face,
        &coincident,
        budget(),
        wonky_alg::Limits::default(),
    )
    .unwrap();
    let classes = periodic::classify(&m, face, &split, &coincident).unwrap();
    assert_eq!(
        classes
            .iter()
            .filter(|&&c| c == wonky_bool::Class::OnSame)
            .count(),
        1
    );
    assert_eq!(
        classes
            .iter()
            .filter(|&&c| c == wonky_bool::Class::Out)
            .count(),
        2
    );
    assert_eq!(
        periodic::split_against(
            &m,
            face,
            &coincident,
            Budget {
                segments: 1,
                pieces: 256
            },
            wonky_alg::Limits::default()
        )
        .unwrap_err()
        .0,
        "boolean/budget-exceeded:periodic-carriers"
    );
}

#[test]
fn redundant_carrier_cuts_merge_and_placement_maps_before_ssi() {
    let m = cylinder(2, 0, 10, [q(0), q(0), q(0)]);
    let other = cylinder(2, 3, 7, [q(20), q(0), q(0)]);
    let face = lateral(&m);
    let split =
        periodic::split_against(&m, face, &other, budget(), wonky_alg::Limits::default()).unwrap();
    assert_eq!(split.cells.len(), 3); // cap carriers over-partition; trims are not fabricated
    let classes = periodic::classify(&m, face, &split, &other).unwrap();
    assert_eq!(classes, vec![wonky_bool::Class::Out; 3]);
    let selected = periodic::merge(&split, &[true; 3]).unwrap();
    assert_eq!(selected.len(), 1);
    assert!(selected[0]
        .loops
        .iter()
        .all(|lp| lp.len() == 1 && lp[0].ends.is_none()));
    let pi: Q = periodic::volume6(&m, face, &split)
        .unwrap()
        .iter()
        .map(|v| v.exact.as_ref().unwrap().pi.clone())
        .sum();
    assert_eq!(pi, q(160));

    let placement = Frame::new(
        [q(100), q(-20), q(17)],
        [[q(2), q(0), q(0)], [q(1), q(3), q(0)], [q(0), q(0), q(4)]],
    )
    .unwrap();
    let mut a = m.into_draft();
    a.placement = placement.clone();
    let mut b = cylinder(2, 0, 10, [q(0), q(0), q(0)]).into_draft();
    b.placement = Frame::new(
        placement.point(&[q(2), q(0), q(0)]),
        placement.columns().clone(),
    )
    .unwrap();
    let a = a.check().unwrap();
    let b = b.check().unwrap();
    let face = lateral(&a);
    let split =
        periodic::split_against(&a, face, &b, budget(), wonky_alg::Limits::default()).unwrap();
    assert_eq!(split.cells.len(), 2);
    let classes = periodic::classify(&a, face, &split, &b).unwrap();
    assert_eq!(
        classes
            .iter()
            .filter(|&&c| c == wonky_bool::Class::In)
            .count(),
        1
    );
    assert_eq!(
        classes
            .iter()
            .filter(|&&c| c == wonky_bool::Class::Out)
            .count(),
        1
    );
}

#[test]
fn radical_plane_consumers_refuse_explicitly_after_carrier_extension() {
    let rational = cylinder(2, 0, 4, [q(0), q(0), q(0)]);
    let row = include_str!("../../wonky-ops/tests/data/acid-planar-wc0.txt")
        .lines().find(|line| line.starts_with("AC11 V0 ")).unwrap();
    let fields: Vec<_> = row.split_whitespace().collect();
    let words: Vec<u32> = fields[5].as_bytes().chunks(8)
        .map(|bytes| u32::from_str_radix(std::str::from_utf8(bytes).unwrap(), 16).unwrap()).collect();
    let decoded = wonky_wire::v3::decode(&words).unwrap();
    let planar = wonky_ops::analytic::audit(&decoded).unwrap().model().unwrap();
    let mut draft = planar.draft().clone();
    for surface in &mut draft.surfaces {
        if let Carrier3::Plane(plane) = &surface.carrier {
            surface.carrier = Carrier3::RadicalPlane(plane.into());
        }
    }
    let other = draft.check().unwrap();
    assert_eq!(
        periodic::split_against(&rational, lateral(&rational), &other, budget(), wonky_alg::Limits::default())
            .unwrap_err().0,
        "model/radical-plane/rational-implicit"
    );
    assert_eq!(
        periodic::measure_model(&other, budget()).unwrap_err().0,
        "model/radical-plane/rational-consumer"
    );
}
