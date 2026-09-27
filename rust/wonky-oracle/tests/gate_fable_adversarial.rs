//! Gate (Fable) adversarial cases for point_in_polygon: query points that share
//! a vertex height (half-open crossing rule) and points collinear with an edge
//! line but outside the edge segment (boundary needs the segment bounds).
//! Expected values are derived by hand from the even-odd definition.
use wonky_oracle::*;

fn q(x: f64, y: f64) -> P2 {
    point2([x, y]).unwrap()
}

#[test]
fn point_in_polygon_at_vertex_heights_and_on_edge_lines() {
    // Triangle: base on y = 0, apex (1, 2).
    let triangle = vec![q(0.0, 0.0), q(2.0, 0.0), q(1.0, 2.0)];
    // Left of the base, at base height: outside, not boundary.
    assert_eq!(
        point_in_polygon(&q(-1.0, 0.0), &triangle),
        Ok(Containment::Outside)
    );
    assert_eq!(
        point_in_polygon(&q(3.0, 0.0), &triangle),
        Ok(Containment::Outside)
    );
    // At the apex height, beside the apex: outside.
    assert_eq!(
        point_in_polygon(&q(0.0, 2.0), &triangle),
        Ok(Containment::Outside)
    );
    // Inside, at a height between vertices.
    assert_eq!(
        point_in_polygon(&q(1.0, 0.5), &triangle),
        Ok(Containment::Inside)
    );

    // Rectangle [0,4] x [0,3]: points on the edge *lines* but off the segments.
    let rect = vec![q(0.0, 0.0), q(4.0, 0.0), q(4.0, 3.0), q(0.0, 3.0)];
    for (x, y) in [
        (5.0, 0.0),
        (-1.0, 0.0),
        (5.0, 3.0),
        (-1.0, 3.0),
        (4.0, 4.0),
        (0.0, -1.0),
    ] {
        assert_eq!(
            point_in_polygon(&q(x, y), &rect),
            Ok(Containment::Outside),
            "({x}, {y})"
        );
    }
    // Interior points at vertex heights.
    assert_eq!(
        point_in_polygon(&q(2.0, 3.0), &rect),
        Ok(Containment::Boundary)
    );
    assert_eq!(
        point_in_polygon(&q(4.0, 1.5), &rect),
        Ok(Containment::Boundary)
    );

    // L-shape: interior point at the height of the inner corner vertices.
    let concave = vec![
        q(0.0, 0.0),
        q(3.0, 0.0),
        q(3.0, 1.0),
        q(1.0, 1.0),
        q(1.0, 3.0),
        q(0.0, 3.0),
    ];
    assert_eq!(
        point_in_polygon(&q(0.5, 1.0), &concave),
        Ok(Containment::Inside)
    );
    assert_eq!(
        point_in_polygon(&q(2.0, 1.0), &concave),
        Ok(Containment::Boundary)
    );
    assert_eq!(
        point_in_polygon(&q(4.0, 1.0), &concave),
        Ok(Containment::Outside)
    );
    assert_eq!(
        point_in_polygon(&q(2.0, 3.0), &concave),
        Ok(Containment::Outside)
    );
    assert_eq!(
        point_in_polygon(&q(0.5, 3.0), &concave),
        Ok(Containment::Boundary)
    );
}
