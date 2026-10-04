//! Point selection over the exact arrangement of a sketch (qContainsPoint and
//! qClosestTo on `qSketchRegion`), curved regions included. Each selected
//! region is identified by its extruded volume against a closed-form area, so
//! a wrong region cannot pass by index alone. A point on the boundary shared
//! by several regions refuses by name; it never picks one side.
use wonky_contract::{Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    region_query::{CLOSEST, CONTAINS},
    sketch_pick,
    sketch_regions,
};

const DEPTH: f64 = 4.;
const MM3: f64 = 1e9;
const PI: f64 = std::f64::consts::PI;
const TIE: f64 = 1e-8;

fn identity() -> Affine {
    Affine { origin: [0.; 3], x: [1., 0., 0.], z: [0., 0., 1.] }
}
/// World (10, 20 + u, 30 + v) for sketch (u, v): x = +Y, z = +X, y = z cross x = +Z.
fn placed() -> Affine {
    Affine { origin: [10., 20., 30.], x: [0., 1., 0.], z: [1., 0., 0.] }
}
/// Rotation by 60 degrees about Z: cos and sin are not exact in binary64, so the
/// frame's axes are only unit within rounding.
fn turned() -> Affine {
    let (s, c) = (60f64.to_radians().sin(), 60f64.to_radians().cos());
    Affine { origin: [1., -2., 3.], x: [c, s, 0.], z: [0., 0., 1.] }
}
/// The world point of the sketch point (u, v) at height `w` over the plane.
fn world(frame: &Affine, u: f64, v: f64, w: f64) -> [f64; 3] {
    let y = [
        frame.z[1] * frame.x[2] - frame.z[2] * frame.x[1],
        frame.z[2] * frame.x[0] - frame.z[0] * frame.x[2],
        frame.z[0] * frame.x[1] - frame.z[1] * frame.x[0],
    ];
    std::array::from_fn(|k| frame.origin[k] + u * frame.x[k] + v * y[k] + w * frame.z[k])
}
fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<[f64; 4]> {
    vec![[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]
}
struct Sketch {
    lines: Vec<[f64; 4]>,
    arcs: Vec<[f64; 6]>,
    circles: Vec<[f64; 3]>,
}
impl Sketch {
    fn count(&self) -> usize {
        sketch_regions::regions(&self.lines, &self.arcs, &self.circles).unwrap().len()
    }
    fn all(&self) -> Vec<usize> {
        (0..self.count()).collect()
    }
    fn pick(&self, frame: &Affine, among: &[usize], p: [f64; 3], mode: u32) -> Result<Vec<usize>, String> {
        sketch_pick::select(frame, &self.lines, &self.arcs, &self.circles, among, p, mode, TIE).map_err(|e| e.0)
    }
    /// The area of region `k` from its extruded volume.
    fn area(&self, k: usize) -> f64 {
        let body = sketch_regions::extrude(BodyKey { id: [17, 1, 2, 3], revision: 0 }, identity(), &self.lines, &self.arcs, &self.circles, DEPTH, false, k).unwrap();
        volume(&body) / (DEPTH * MM3)
    }
    /// The one region a contains-selection at (u, v) names, by its area.
    fn area_at(&self, frame: &Affine, u: f64, v: f64) -> f64 {
        let got = self.pick(frame, &self.all(), world(frame, u, v, 0.), CONTAINS).unwrap();
        assert_eq!(got.len(), 1, "({u}, {v}) selected {got:?}");
        self.area(got[0])
    }
}
fn volume(body: &Body) -> f64 {
    let solid: Solid = analytic::audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(body).unwrap()).unwrap()).unwrap();
    let s = solid.measure(None, &[]).unwrap();
    let at = s.find("\"volumeMm3\":").unwrap() + "\"volumeMm3\":".len();
    let rest = &s[at..];
    rest[..rest.find(|c: char| c == ',' || c == '}').unwrap()].parse().unwrap()
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() <= expected.abs() * 1e-10, "{actual} != {expected}");
}

/// Two circles of radius 5 about (-3, 0) and (3, 0): they cross exactly at
/// (0, +-4). Lens, and one crescent on each side.
fn two_circles() -> Sketch {
    Sketch { lines: vec![], arcs: vec![], circles: vec![[-3., 0., 5.], [3., 0., 5.]] }
}
fn lens() -> f64 {
    // 2 r^2 acos(d / 2r) - (d / 2) sqrt(4 r^2 - d^2) at r = 5, d = 6
    50. * 0.6f64.acos() - 24.
}
fn crescent() -> f64 {
    25. * PI - lens()
}

#[test]
fn contains_names_the_lens_and_both_crescents_in_every_frame() {
    let s = two_circles();
    assert_eq!(s.count(), 3);
    for frame in [identity(), placed(), turned()] {
        near(s.area_at(&frame, 0., 0.), lens());
        near(s.area_at(&frame, -6., 0.), crescent());
        near(s.area_at(&frame, 6., 0.), crescent());
        near(s.area_at(&frame, 0., 3.5), lens());
    }
}

#[test]
fn a_point_off_every_region_or_over_the_plane_selects_nothing() {
    let s = two_circles();
    let f = identity();
    assert_eq!(s.pick(&f, &s.all(), world(&f, 0., 9., 0.), CONTAINS).unwrap(), Vec::<usize>::new());
    // 1 mm over the plane is far outside the 1e-8 m tie band; 1e-9 m is inside.
    assert_eq!(s.pick(&f, &s.all(), world(&f, 0., 0., 1e-3), CONTAINS).unwrap(), Vec::<usize>::new());
    assert_eq!(s.pick(&f, &s.all(), world(&f, 0., 0., 1e-9), CONTAINS).unwrap().len(), 1);
}

#[test]
fn a_point_on_the_edge_of_one_region_is_inside_it() {
    // (-8, 0) is the far end of the left circle: only the left crescent's edge.
    let s = two_circles();
    near(s.area_at(&identity(), -8., 0.), crescent());
    near(s.area_at(&placed(), 8., 0.), crescent());
}

#[test]
fn a_point_on_an_edge_shared_by_two_regions_refuses_by_name() {
    let s = two_circles();
    for frame in [identity(), placed()] {
        // (1, 3) lies on the left circle inside the right one: the lens and the
        // right crescent share it. (0, 4) is a vertex of all three regions.
        for (u, v) in [(1., 3.), (0., 4.), (0., -4.)] {
            let e = s.pick(&frame, &s.all(), world(&frame, u, v, 0.), CONTAINS).unwrap_err();
            assert_eq!(e, "sketch-region/point-on-boundary", "({u}, {v})");
        }
    }
    // Restricted to one of the two regions, the shared edge is inside it.
    let lens = {
        let f = identity();
        s.pick(&f, &s.all(), world(&f, 0., 0., 0.), CONTAINS).unwrap()[0]
    };
    assert_eq!(s.pick(&identity(), &[lens], world(&identity(), 1., 3., 0.), CONTAINS).unwrap(), vec![lens]);
}

#[test]
fn closest_decides_among_the_candidates_and_keeps_ties() {
    let s = two_circles();
    let f = identity();
    let at = |u, v| world(&f, u, v, 0.);
    let left = s.pick(&f, &s.all(), at(-6., 0.), CONTAINS).unwrap()[0];
    let right = s.pick(&f, &s.all(), at(6., 0.), CONTAINS).unwrap()[0];
    let lens = s.pick(&f, &s.all(), at(0., 0.), CONTAINS).unwrap()[0];
    // Above and left of both: the left crescent is nearer than the lens.
    let mut got = s.pick(&f, &s.all(), at(-1., 10.), CLOSEST).unwrap();
    got.sort();
    assert_eq!(got, vec![left]);
    // Among the lens and the right crescent only, the lens is nearer to a point inside the left one.
    assert_eq!(s.pick(&f, &[lens, right], at(-6., 0.), CLOSEST).unwrap(), vec![lens]);
    // A point on the mirror axis is exactly as far from both crescents: both stay.
    let mut tie = s.pick(&f, &[left, right], at(0., 10.), CLOSEST).unwrap();
    tie.sort();
    let mut both = vec![left, right];
    both.sort();
    assert_eq!(tie, both);
    // Inside a region, that region is the closest, whatever else is near.
    assert_eq!(s.pick(&f, &s.all(), at(0., 0.), CLOSEST).unwrap(), vec![lens]);
    assert!(s.pick(&f, &[], at(0., 0.), CLOSEST).unwrap().is_empty());
}

#[test]
fn closest_from_off_the_plane_uses_the_height() {
    let s = two_circles();
    let f = placed();
    // 1 m over the lens's middle: still the lens (height 1, crescents are farther).
    let got = s.pick(&f, &s.all(), world(&f, 0., 0., 1.), CLOSEST).unwrap();
    assert_eq!(got.len(), 1);
    near(s.area(got[0]), lens());
}

#[test]
fn a_bore_leaves_a_holed_region_and_its_island() {
    // A 10 x 10 square with a disc of radius 2 about (5, 5).
    let s = Sketch { lines: rectangle(0., 0., 10., 10.), arcs: vec![], circles: vec![[5., 5., 2.]] };
    assert_eq!(s.count(), 2);
    for frame in [identity(), placed()] {
        near(s.area_at(&frame, 5., 5.), 4. * PI);
        near(s.area_at(&frame, 1., 1.), 100. - 4. * PI);
        // The bore's edge is shared by both regions: refused, not one side.
        let e = s.pick(&frame, &s.all(), world(&frame, 7., 5., 0.), CONTAINS).unwrap_err();
        assert_eq!(e, "sketch-region/point-on-boundary");
        // The outer edge belongs to the holed region alone.
        near(s.area_at(&frame, 0., 5.), 100. - 4. * PI);
    }
}

#[test]
fn overlapping_rectangles_have_three_regions() {
    let mut lines = rectangle(0., 0., 10., 10.);
    lines.extend(rectangle(5., 5., 15., 15.));
    let s = Sketch { lines, arcs: vec![], circles: vec![] };
    assert_eq!(s.count(), 3);
    for frame in [identity(), placed(), turned()] {
        near(s.area_at(&frame, 2.5, 2.5), 75.);
        near(s.area_at(&frame, 7.5, 7.5), 25.);
        near(s.area_at(&frame, 12.5, 12.5), 75.);
        let e = s.pick(&frame, &s.all(), world(&frame, 5., 7.5, 0.), CONTAINS).unwrap_err();
        assert_eq!(e, "sketch-region/point-on-boundary");
    }
}

#[test]
fn a_distance_the_enclosure_cannot_separate_from_the_tie_refuses_by_name() {
    // Two unit squares one apart; the point is 1/4 right of the first, 3/4 left
    // of the second (sketch metres, identity frame).
    let mut lines = rectangle(0., 0., 1., 1.);
    lines.extend(rectangle(2., 0., 3., 1.));
    let s = Sketch { lines, arcs: vec![], circles: vec![] };
    let f = identity();
    let first = s.pick(&f, &s.all(), world(&f, 0.5, 0.5, 0.), CONTAINS).unwrap();
    let pick = |p: [f64; 3], mode: u32, tie: f64| sketch_pick::select(&f, &s.lines, &s.arcs, &s.circles, &s.all(), p, mode, tie).map_err(|e| e.0);
    let p = world(&f, 1.25, 0.5, 0.);
    // The second square is exactly `tie` farther than the first: undecided.
    assert_eq!(pick(p, CLOSEST, 0.5).unwrap_err(), "sketch-region/tie-undecided");
    // Clearly inside or outside the band, it is decided either way.
    assert_eq!(pick(p, CLOSEST, 0.4).unwrap(), first);
    assert_eq!(pick(p, CLOSEST, 0.6).unwrap().len(), 2);
    // The corner (0, 0) is s*sqrt(2) from (-s, -s): with the tie at the binary64
    // rounding of that irrational distance the certified interval straddles it.
    let s30 = 2f64.powi(-30);
    let corner = world(&f, -s30, -s30, 0.);
    assert_eq!(pick(corner, CONTAINS, s30 * std::f64::consts::SQRT_2).unwrap_err(), "sketch-region/tie-undecided");
    assert_eq!(pick(corner, CONTAINS, s30).unwrap(), Vec::<usize>::new());
    assert_eq!(pick(corner, CONTAINS, 2. * s30).unwrap(), first);
}

#[test]
fn bad_input_is_named() {
    let s = two_circles();
    let f = identity();
    for bad in [vec![3], vec![1, 1]] {
        assert_eq!(s.pick(&f, &bad, [0.; 3], CLOSEST).unwrap_err(), "sketch-region/invalid-candidates");
    }
    assert_eq!(s.pick(&f, &s.all(), [f64::NAN, 0., 0.], CONTAINS).unwrap_err(), "sketch-region/invalid-input");
    let flat = Affine { origin: [0.; 3], x: [1., 0., 0.], z: [1., 0., 0.] };
    assert_eq!(s.pick(&flat, &s.all(), [0.; 3], CONTAINS).unwrap_err(), "sketch-region/degenerate-frame");
}
