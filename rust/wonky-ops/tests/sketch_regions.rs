//! Sketch regions from the one arrangement: circles crossing and nesting,
//! holed faces, chains with circle bores. Volumes are exact closed forms from
//! first principles (areas of discs, lenses and polygons times exact depths);
//! what the arrangement or the stack cannot decide refuses by name.
use wonky_contract::{Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    sketch_regions::{self, Region},
};

fn key() -> BodyKey {
    BodyKey { id: [16, 1, 8, 2], revision: 0 }
}
const PI: f64 = std::f64::consts::PI;
const MM3: f64 = 1e9;
const DEPTH: f64 = 4.;

fn solid(body: &Body) -> Solid {
    analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(body).unwrap()).unwrap()).unwrap()
}
fn volume(body: &Body) -> f64 {
    let s = solid(body).measure(None, &[]).unwrap();
    let at = s.find("\"volumeMm3\":").unwrap() + "\"volumeMm3\":".len();
    let rest = &s[at..];
    rest[..rest.find(|c: char| c == ',' || c == '}').unwrap()].parse().unwrap()
}
fn near(actual: f64, area: f64) {
    let expected = area * DEPTH * MM3;
    assert!((actual - expected).abs() <= expected.abs() * 1e-12, "{actual} != {expected}");
}
fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<[f64; 4]> {
    vec![[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
}
fn extrude(frame: Affine, lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]], region: usize) -> Result<Body, String> {
    sketch_regions::extrude(key(), frame, lines, arcs, circles, DEPTH, false, region).map_err(|e| e.0)
}
fn regions(lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]]) -> Vec<Region> {
    sketch_regions::regions(lines, arcs, circles).unwrap()
}
/// Areas of every region, sorted, through the extrusion volumes.
fn areas(frame: Affine, lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]]) -> Vec<f64> {
    let n = regions(lines, arcs, circles).len();
    let mut out = (0..n)
        .map(|k| volume(&extrude(frame, lines, arcs, circles, k).unwrap()) / (DEPTH * MM3))
        .collect::<Vec<_>>();
    out.sort_by(|a, b| a.partial_cmp(b).unwrap());
    out
}
fn close(actual: &[f64], expected: &[f64]) {
    assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
    for (a, e) in actual.iter().zip(expected) {
        assert!((a - e).abs() <= e.abs() * 1e-12, "{actual:?} vs {expected:?}");
    }
}
fn rotated() -> Affine {
    // Exact quarter turn about z, moved: x -> +y.
    Affine { origin: [3., -2., 7.], x: [0., 1., 0.], z: [0., 0., 1.] }
}

#[test]
fn two_overlapping_circles_give_a_lens_and_two_crescents() {
    // Radius 5 about (-3,0) and (3,0) cross at (0, +-4).
    let circles = [[-3., 0., 5.], [3., 0., 5.]];
    let lens = 2. * (25. * (0.6f64).acos() - 12.);
    let crescent = 25. * PI - lens;
    let regions = regions(&[], &[], &circles);
    assert_eq!(regions.len(), 3);
    assert!(regions.iter().all(|r| !r.inner));
    let expected = [lens, crescent, crescent];
    close(&areas(Affine::IDENTITY, &[], &[], &circles), &expected);
    // The same sketch in an exactly rotated, moved frame is the same solids.
    close(&areas(rotated(), &[], &[], &circles), &expected);
}

#[test]
fn nested_rectangles_give_a_frame_and_its_island() {
    let mut lines = rectangle(0., 0., 24., 18.);
    lines.extend(rectangle(6., 5., 18., 13.));
    let regions = regions(&lines, &[], &[]);
    assert_eq!(regions.len(), 2);
    assert_eq!(regions.iter().filter(|r| r.inner).count(), 1);
    assert_eq!(regions[0].adjacent, vec![1]);
    close(&areas(Affine::IDENTITY, &lines, &[], &[]), &[96., 24. * 18. - 96.]);
    close(&areas(rotated(), &lines, &[], &[]), &[96., 24. * 18. - 96.]);
}

#[test]
fn nested_islands_are_inner_and_decided() {
    // A plate, a bore, and a square boss inside the bore: the ring and the
    // square each fill a hole exactly, so both readings of filterInnerLoops
    // drop them.
    let mut lines = rectangle(-20., -20., 20., 20.);
    lines.extend(rectangle(-2., -2., 2., 2.));
    let regions = regions(&lines, &[], &[[0., 0., 5.]]);
    assert_eq!(regions.len(), 3);
    assert_eq!(regions.iter().filter(|r| r.inner).count(), 2);
    assert!(regions.iter().all(|r| !r.contested), "{regions:?}");
}

#[test]
fn a_hole_of_two_overlapping_bores_leaves_the_inner_filter_undecided() {
    // The plate's hole is the outline of both discs; its lens and crescents lie
    // in the hole, but none of them is bounded by it alone.
    let lines = rectangle(-20., -20., 20., 20.);
    let circles = [[-3., 0., 5.], [3., 0., 5.]];
    let regions = regions(&lines, &[], &circles);
    assert_eq!(regions.len(), 4);
    let contested = regions.iter().filter(|r| r.contested).count();
    assert_eq!(contested, 3, "{regions:?}");
    // The holed plate itself is decided and still extrudes exactly.
    let plate = regions.iter().position(|r| !r.contested).unwrap();
    assert!(!regions[plate].inner);
    let lens = 2. * (25. * (0.6f64).acos() - 12.);
    near(volume(&extrude(Affine::IDENTITY, &lines, &[], &circles, plate).unwrap()), 1600. - (50. * PI - lens));
}

#[test]
fn plate_with_three_bores_has_one_holed_region_and_three_islands() {
    let lines = rectangle(0., 0., 32., 24.);
    let circles = [[8., 8., 2.], [24., 8., 2.], [16., 16., 2.]];
    let regions = regions(&lines, &[], &circles);
    assert_eq!(regions.len(), 4);
    assert_eq!(regions.iter().filter(|r| r.inner).count(), 3);
    assert!(regions.iter().all(|r| !r.contested));
    let holed = regions.iter().position(|r| !r.inner).unwrap();
    let body = extrude(Affine::IDENTITY, &lines, &[], &circles, holed).unwrap();
    near(volume(&body), 32. * 24. - 3. * PI * 4.);
    close(&areas(Affine::IDENTITY, &lines, &[], &circles), &[4. * PI, 4. * PI, 4. * PI, 32. * 24. - 12. * PI]);
}

#[test]
fn hexagon_with_a_central_bore_and_an_obround_with_a_bore() {
    // Hexagon across flats 12 (side 12/sqrt 3 needs no exact corner: it is a
    // set of binary64 corners; only the bore area is exact).
    let h = 6. / 3f64.sqrt();
    let corners = [[2. * h, 0.], [h, 6.], [-h, 6.], [-2. * h, 0.], [-h, -6.], [h, -6.]];
    let lines = (0..6).map(|i| [corners[i][0], corners[i][1], corners[(i + 1) % 6][0], corners[(i + 1) % 6][1]]).collect::<Vec<_>>();
    let hex = regions(&lines, &[], &[[0., 0., 1.5]]);
    assert_eq!(hex.len(), 2);
    let holed = hex.iter().position(|r| !r.inner).unwrap();
    let body = extrude(Affine::IDENTITY, &lines, &[], &[[0., 0., 1.5]], holed).unwrap();
    assert!(volume(&body) > 0.);
    // Obround: arcs about (7,9) and (19,9), r 5, tangent lines; bore r 1 at (7,9).
    let lines = [[7., 4., 19., 4.], [19., 14., 7., 14.]];
    let arcs = [[7., 14., 2., 9., 7., 4.], [19., 4., 24., 9., 19., 14.]];
    let regions = regions(&lines, &arcs, &[[7., 9., 1.]]);
    assert_eq!(regions.len(), 2);
    let holed = regions.iter().position(|r| !r.inner).unwrap();
    let obround = 12. * 10. + 25. * PI;
    near(volume(&extrude(Affine::IDENTITY, &lines, &arcs, &[[7., 9., 1.]], holed).unwrap()), obround - PI);
}

#[test]
fn concentric_circles_are_a_ring_and_a_disc() {
    let circles = [[0., 0., 9.], [0., 0., 3.]];
    let regions = regions(&[], &[], &circles);
    assert_eq!(regions.len(), 2);
    close(&areas(Affine::IDENTITY, &[], &[], &circles), &[9. * PI, 72. * PI]);
    close(&areas(rotated(), &[], &[], &circles), &[9. * PI, 72. * PI]);
}

#[test]
fn region_bodies_are_audited_and_reversible() {
    let circles = [[-3., 0., 5.], [3., 0., 5.]];
    let up = extrude(Affine::IDENTITY, &[], &[], &circles, 0).unwrap();
    let down = sketch_regions::extrude(key(), Affine::IDENTITY, &[], &[], &circles, DEPTH, true, 0).unwrap();
    assert_eq!(volume(&up), volume(&down));
}

#[test]
fn internally_tangent_circles_refuse_instead_of_giving_two_regions() {
    // Radius 5 about the origin and radius 3 about (2,0) touch at (5,0) from
    // inside: the contact has no decided branch order.
    let circles = [[0., 0., 5.], [2., 0., 3.]];
    let refusal = sketch_regions::regions(&[], &[], &circles).err().expect("a refusal, never two regions");
    assert!(refusal.0.contains("tangent"), "{}", refusal.0);
    assert!(extrude(Affine::IDENTITY, &[], &[], &circles, 0).unwrap_err().contains("tangent"));
}

#[test]
fn a_cell_that_is_not_one_connected_body_refuses_by_name() {
    // A 6 x 20 strip across a radius-5 disc leaves two lobes with the same
    // membership: one region alone cannot be told from the other by Booleans.
    let lines = rectangle(-3., -10., 3., 10.);
    let circles = [[0., 0., 5.]];
    let regions = regions(&lines, &[], &circles);
    assert_eq!(regions.len(), 5);
    let refused = (0..5).filter_map(|k| extrude(Affine::IDENTITY, &lines, &[], &circles, k).err()).collect::<Vec<_>>();
    assert!(refused.iter().all(|r| r.contains("multiple-result-bodies")), "{refused:?}");
    assert!(!refused.is_empty());
}

#[test]
fn open_wires_and_loose_lines_are_not_closed_chains() {
    let open = [[0., 0., 10., 0.], [10., 0., 10., 10.], [10., 10., 0., 10.]];
    assert!(sketch_regions::regions(&open, &[], &[[20., 0., 2.]]).unwrap_err().0.contains("not-closed-chains"));
    // Two rectangles whose sides cross without sharing endpoints are two
    // simple cycles: the arrangement finds the overlap.
    let mut lines = rectangle(0., 0., 10., 10.);
    lines.extend(rectangle(5., 5., 15., 15.));
    assert_eq!(regions(&lines, &[], &[]).len(), 3);
    close(&areas(Affine::IDENTITY, &lines, &[], &[]), &[25., 75., 75.]);
}

#[test]
fn every_region_body_replays_from_its_construction() {
    // decode + audit rebuilds the Boolean from its sources: a wrong or stale
    // node would fail here.
    let circles = [[-3., 0., 5.], [3., 0., 5.]];
    for k in 0..3 {
        let body = extrude(Affine::IDENTITY, &[], &[], &circles, k).unwrap();
        // Whatever family owns the body, it replays from its construction.
        assert!(matches!(solid(&body), Solid::PrismStack(_) | Solid::Lens(_)));
    }
}

#[test]
fn a_placed_region_body_keeps_its_exact_volume_and_replays() {
    // opTransform of an extruded region: the Boolean of the moved operands.
    let lines = rectangle(0., 0., 32., 24.);
    let circles = [[16., 12., 3.]];
    let holed = regions(&lines, &[], &circles).iter().position(|r| !r.inner).unwrap();
    let body = extrude(Affine::IDENTITY, &lines, &[], &circles, holed).unwrap();
    let moved = solid(&body).transform(rotated()).unwrap();
    near(volume(&moved), 32. * 24. - 9. * PI);
    assert!(matches!(solid(&moved), Solid::PrismStack(_)));
    // Both exact post maps stay symbolic and replay through the shared stack.
    let again = solid(&moved).transform(rotated()).unwrap();
    near(volume(&again), 32. * 24. - 9. * PI);
    assert!(matches!(solid(&again), Solid::PrismStack(_)));
}

/// Distance reported for the probe `p` (millimetres in and out).
fn probe_distance(body: &Body, p: [f64; 3]) -> (f64, bool) {
    let s = solid(body).measure(None, &[p]).unwrap();
    let at = s.find("\"probes\"").expect("probes") + 1;
    let rest = &s[at..];
    assert!(!rest.contains("\"refused\""), "{s}");
    let field = |name: &str| {
        let from = rest.find(&format!("\"{name}\":")).expect(name) + name.len() + 3;
        let tail = &rest[from..];
        tail[..tail.find(|c: char| c == ',' || c == '}').unwrap()].to_string()
    };
    (field("distanceMm").parse().unwrap(), field("inside") == "true")
}

#[test]
fn a_crescent_region_answers_outside_probes_with_its_exact_distance() {
    // Region 0 is the left disc minus the right disc.
    let circles = [[-3., 0., 5.], [3., 0., 5.]];
    let body = extrude(Affine::IDENTITY, &[], &[], &circles, 0).unwrap();
    assert!(matches!(solid(&body), Solid::PrismStack(_)));
    let close = |d: f64, e: f64| assert!((d - e).abs() <= e * 1e-9, "{d} != {e}");
    // Left of the crescent's tip at x = -8, inside the slab: 4 m.
    let (d, inside) = probe_distance(&body, [-12000., 0., 2000.]);
    assert!(!inside);
    close(d, 4000.);
    // Above the top face as well: sqrt(4^2 + 2^2) m.
    close(probe_distance(&body, [-12000., 0., 6000.]).0, 20f64.sqrt() * 1000.);
    // In the lens (inside both discs, so outside the crescent): the nearest
    // point of the crescent is (-2, 0) on the right circle, 2 m away.
    close(probe_distance(&body, [0., 0., 2000.]).0, 2000.);
    // A probe inside the crescent is inside.
    assert!(probe_distance(&body, [-6000., 0., 2000.]).1);
}

#[test]
fn a_placed_ring_replays_and_keeps_its_exact_volume() {
    // Concentric circles: a coaxial pipe. Its placement moves the source
    // cylinders and arranges them again, so the moved body audits.
    let circles = [[0., 0., 9.], [0., 0., 3.]];
    let ring = regions(&[], &[], &circles).iter().position(|r| !r.inner).unwrap();
    let body = extrude(Affine::IDENTITY, &[], &[], &circles, ring).unwrap();
    assert!(matches!(solid(&body), Solid::Coaxial(_)));
    let moved = solid(&body).transform(rotated()).unwrap();
    near(volume(&moved), 72. * PI);
    assert!(matches!(solid(&moved), Solid::Coaxial(_)));
}

#[test]
fn a_bore_drawn_as_two_half_arcs_is_the_circle_of_its_arcs() {
    let lines = rectangle(0., 0., 32., 24.);
    let halves = [[20., 12., 16., 16., 12., 12.], [12., 12., 16., 8., 20., 12.]];
    let expected = [16. * PI, 32. * 24. - 16. * PI];
    close(&areas(Affine::IDENTITY, &lines, &halves, &[]), &expected);
    close(&areas(rotated(), &lines, &halves, &[]), &expected);
    // The second half drawn the other way round is the same loop.
    let turned = [halves[0], [20., 12., 16., 8., 12., 12.]];
    close(&areas(Affine::IDENTITY, &lines, &turned, &[]), &expected);
    let holed = regions(&lines, &halves, &[]).iter().position(|r| !r.inner).unwrap();
    let body = extrude(Affine::IDENTITY, &lines, &halves, &[], holed).unwrap();
    near(volume(&body), 32. * 24. - 16. * PI);
}

#[test]
fn two_arcs_that_are_not_one_circle_or_not_a_loop_refuse_by_name() {
    // A lens of two arcs of different circles is not a chain of this grammar.
    let lens = [[0., 0., 2., 1., 4., 0.], [4., 0., 2., -3., 0., 0.]];
    assert!(sketch_regions::regions(&[], &lens, &[[20., 0., 2.]]).is_err());
    // Two arcs sharing one end only are an open wire.
    let open = [[0., 0., 2., 2., 4., 0.], [4., 0., 6., -2., 8., 0.]];
    assert!(sketch_regions::regions(&[], &open, &[[20., 0., 2.]]).unwrap_err().0.contains("not-closed-chains"));
    // A circle whose exact radius is not a binary64 value (r^2 = 2) has no circle source.
    let odd = [[1., 1., -1., 1., -1., -1.], [-1., -1., 1., -1., 1., 1.]];
    assert!(sketch_regions::regions(&[], &odd, &[]).unwrap_err().0.contains("two-arc-circle-inexact"));
}

#[test]
fn overhanging_lines_split_closed_boundaries_and_replay_exact_cells() {
    for r in [5., 5.025] {
        let lines = [[-6., 0., 6., 0.]];
        let circles = [[0., 0., r]];
        let rs = regions(&lines, &[], &circles);
        assert_eq!(rs.len(), 2);
        assert_eq!(rs[0].adjacent, vec![1]);
        assert_eq!(rs[1].adjacent, vec![0]);
        close(&areas(Affine::IDENTITY, &lines, &[], &circles), &[PI*r*r/2.;2]);
        for k in 0..2 {
            let body = extrude(Affine::IDENTITY, &lines, &[], &circles, k).unwrap();
            assert_eq!(body.faces.len(), 4, "two caps, one analytic half-cylinder and the diameter wall");
            let upper = probe_distance(&body, [0., 2000., 2000.]).1;
            let lower = probe_distance(&body, [0., -2000., 2000.]).1;
            assert_ne!(upper, lower, "a half-disc contains exactly one side");
            for index in [-1., 0.5] {
                let mut malformed = body.clone();
                malformed.constructions[1].parameters[0] = wonky_contract::Binary64::new(index).unwrap();
                assert!(malformed.check().is_err(), "rule-4 selection must be a nonnegative integer");
            }
            let mut bad_count = body.clone();
            // Interpreter layout: four header words + the four line words.
            bad_count.constructions[0].parameters[8] = wonky_contract::Binary64::new(2.).unwrap();
            assert!(analytic::audit(&bad_count.check().unwrap()).is_err(), "malformed circle source must refuse");
            let mut planted = body.clone();
            planted.constructions[1].parameters[0] = wonky_contract::Binary64::new((1-k) as f64).unwrap();
            let checked = planted.check().unwrap();
            assert!(analytic::audit(&checked).is_err(), "a stale selected-region source must not audit");
        }
    }
    let mut lines = rectangle(0., 0., 20., 10.);
    lines.push([10., -2., 10., 12.]);
    close(&areas(Affine::IDENTITY, &lines, &[], &[]), &[100., 100.]);
    for k in 0..2 {
        let body = extrude(Affine::IDENTITY, &lines, &[], &[], k).unwrap();
        assert_eq!(body.faces.len(), 6);
        assert_ne!(probe_distance(&body, [5000.,5000.,2000.]).1, probe_distance(&body, [15000.,5000.,2000.]).1);
    }
}

#[test]
fn incomplete_cuts_do_not_invent_regions_and_disconnected_wires_refuse() {
    let circles = [[0.,0.,5.]];
    assert_eq!(regions(&[[-6.,0.,0.,0.]], &[], &circles).len(), 1);
    assert!(sketch_regions::regions(&[[20.,0.,30.,0.]], &[], &circles).unwrap_err().0.contains("not-closed-chains"));
    assert!(sketch_regions::regions(&[[-6.,0.,6.,0.]], &[], &[]).unwrap_err().0.contains("not-closed-chains"));
    assert!(sketch_regions::regions(&[[0.,0.,0.,0.]], &[], &circles).is_err());
    assert!(sketch_regions::regions(&[[-6.,0.,6.,0.]], &[], &[[f64::NAN,0.,5.]]).is_err());
}

#[test]
fn split_regions_use_the_same_mechanism_for_oblique_and_off_centre_cuts() {
    let circles = [[0.,0.,5.]];
    // Oblique diameter has rational contacts (+-4,+-3), no axis special case.
    close(&areas(Affine::IDENTITY, &[[-8.,-6.,8.,6.]], &[], &circles), &[12.5*PI;2]);
    // Off-centre chord: one minor and one major circular segment.
    let minor = 25.*(3_f64/5.).acos()-12.;
    close(&areas(Affine::IDENTITY, &[[-6.,3.,6.,3.]], &[], &circles), &[minor,25.*PI-minor]);
    let mut lines = rectangle(0.,0.,20.,10.);
    lines.push([-2.,-1.,22.,11.]);
    close(&areas(Affine::IDENTITY, &lines, &[], &[]), &[100.;2]);
    // An unrelated collinear wire must not be considered attached merely
    // because its supporting carrier matches the diameter.
    assert!(sketch_regions::regions(&[[-6.,0.,6.,0.],[20.,0.,30.,0.]], &[], &circles).is_err());
}

#[test]
fn pinched_exteriors_refuse_but_interior_multiway_cuts_are_regular() {
    let mut touching = rectangle(0.,0.,10.,10.);
    touching.extend(rectangle(10.,10.,20.,20.));
    assert_eq!(sketch_regions::regions(&touching, &[], &[]).unwrap_err().0, "sketch-regions/vertex-touching-cells");
    let mut grid = rectangle(0.,0.,20.,20.);
    grid.extend([[10.,-2.,10.,22.],[-2.,10.,22.,10.]]);
    close(&areas(Affine::IDENTITY, &grid, &[], &[]), &[100.;4]);
}
