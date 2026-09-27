//! Contracts of the public line-region and point-location APIs, independent of
//! extrusion's axis-prism admission. Contacts are exact, including signed zero.
use wonky_num::p2;
use wonky_sketch::region::{lines_region, locate, on_segment, simple_polygon, Location};
use wonky_sketch::Refusal;

#[test]
fn segment_contacts_do_not_depend_on_order_or_direction() {
    // One contact only: endpoint on interior, proper crossing, or overlap.
    // Permuting both segments prevents an unrelated contact from masking a miss.
    let contacts = [
        [[0., 0.], [4., 0.], [2., 0.], [2., 3.]],
        [[0., 0.], [4., 0.], [2., -3.], [2., 3.]],
        [[0., 0.], [4., 0.], [2., 0.], [6., 0.]],
        [[0., 0.], [4., 0.], [0., 0.], [2., 0.]],
        [[0., 0.], [0., 4.], [0., 0.], [0., 2.]],
        [[0., 0.], [4., 4.], [0., 0.], [2., 2.]],
        [[0., 0.], [4., 0.], [0., 0.], [4., 0.]],
    ];
    for c in contacts {
        for swap in [false, true] {
            for ra in [false, true] {
                for rb in [false, true] {
                    let mut s = [[p2(c[0][0], c[0][1]), p2(c[1][0], c[1][1])], [p2(c[2][0], c[2][1]), p2(c[3][0], c[3][1])]];
                    if ra {
                        s[0].reverse();
                    }
                    if rb {
                        s[1].reverse();
                    }
                    if swap {
                        s.reverse();
                    }
                    assert_eq!(lines_region(&s), Err(Refusal::UnsupportedIntersection), "{s:?}");
                }
            }
        }
    }
    // Collinear but disjoint: zeros in the orientation tests do not imply contact.
    for s in [
        [[p2(0., 0.), p2(1., 0.)], [p2(2., 0.), p2(3., 0.)]],
        [[p2(0., 0.), p2(0., 1.)], [p2(0., 2.), p2(0., 3.)]],
    ] {
        let r = lines_region(&s).unwrap();
        assert_eq!((r.loops.len(), r.open_wires), (0, 2));
    }
}

#[test]
fn simple_polygon_and_location_have_independent_geometric_contracts() {
    let triangle = [p2(0., 0.), p2(4., 0.), p2(0., 4.)];
    assert_eq!(simple_polygon(&triangle), Ok(()));
    assert_eq!(simple_polygon(&triangle[..2]), Err(Refusal::Degenerate));
    assert_eq!(
        simple_polygon(&[p2(0., 0.), p2(2., 2.), p2(2., 0.), p2(0., 2.)]),
        Err(Refusal::UnsupportedIntersection)
    );
    assert_eq!(
        simple_polygon(&[p2(0., 0.), p2(4., 0.), p2(2., 0.), p2(0., 4.)]),
        Err(Refusal::UnsupportedIntersection)
    );
    for (a, b, q, expected) in [
        (p2(0., 0.), p2(4., 0.), p2(2., 0.), true),
        (p2(0., 0.), p2(4., 0.), p2(4., 0.), true),
        (p2(0., 0.), p2(4., 0.), p2(5., 0.), false),
        (p2(0., 0.), p2(4., 4.), p2(2., 1.), false),
    ] {
        assert_eq!(on_segment(a, b, q), Ok(expected));
    }
    for points in [triangle.to_vec(), triangle.into_iter().rev().collect::<Vec<_>>()] {
        for (q, expected) in [
            (p2(1., 1.), Location::Inside),
            (p2(0., 2.), Location::Boundary),
            (p2(2., 2.), Location::Boundary),
            (p2(0., 0.), Location::Boundary),
            (p2(5., 0.), Location::Outside),
            (p2(-1., 0.), Location::Outside),
            (p2(0., 5.), Location::Outside),
            (p2(-1., 4.), Location::Outside),
        ] {
            assert_eq!(locate(&points, q), Ok(expected), "{points:?} at {q:?}");
        }
    }
}

#[test]
fn regions_keep_exact_vertices_and_oriented_segment_uses() {
    // Clockwise, mixed signed zeros, shuffled edges. The output cycle's uses
    // must reconstruct its CCW points, not merely the same unoriented area.
    let s = [[p2(-0., 0.), p2(0., 2.)], [p2(3., 0.), p2(0., -0.)], [p2(0., 2.), p2(3., 0.)]];
    let r = lines_region(&s).unwrap();
    assert_eq!((r.loops.len(), r.open_wires), (1, 0));
    let l = &r.loops[0];
    for (k, &(edge, forward)) in l.uses.iter().enumerate() {
        let (a, b) = if forward { (s[edge][0], s[edge][1]) } else { (s[edge][1], s[edge][0]) };
        assert_eq!(l.points[k], a);
        assert_eq!(l.points[(k + 1) % l.points.len()], b);
    }
    let area: f64 = l
        .points
        .iter()
        .enumerate()
        .map(|(k, a)| {
            let b = l.points[(k + 1) % l.points.len()];
            a.x * b.y - b.x * a.y
        })
        .sum();
    assert_eq!(area, 6.);
}
