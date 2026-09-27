//! Gate-3 (Fable) adversarial regressions against the public wonky-brep API.
//! Drop-in file: no production seams, no snapshots, no golden inventories.
use wonky_brep::*;
use wonky_num::{v3, P3};

/// Cuboid(2,6,5) plus an independent probe box whose vertex 0 sits at `sample`,
/// then one determinant-one linear map applied to every source datum: points,
/// curve endpoints, plane origins, and plane normals via the inverse transpose.
/// Edge 0 of the cuboid is (0,0,0)->(0,6,0) before the map.
fn probe_body(
    sample: P3,
    map: impl Fn(P3) -> P3,
    normal_map: impl Fn(P3) -> P3,
) -> (Brep, VertexId) {
    let mut d = Brep::cuboid(v3(2., 6., 5.)).unwrap().to_draft();
    let probe = Brep::cuboid(v3(0.125, 0.125, 0.125)).unwrap();
    let src = probe.topology();
    let vm: Vec<_> = src
        .vertices
        .iter()
        .map(|v| d.add_vertex(v.point.add(sample)))
        .collect();
    let mut faces = Vec::new();
    for face in &src.faces {
        let Surface::Plane { origin, normal } = src.surfaces[face.surface.0];
        let s = d.add_plane(origin.add(sample), normal);
        let vs: Vec<_> = src.loops[face.loops[0].0]
            .coedges
            .iter()
            .map(|c| {
                let c = &src.coedges[c.0];
                vm[src.edges[c.edge.0].vertices
                    [usize::from(c.orientation == Orientation::Reversed)]
                .0]
            })
            .collect();
        faces.push(d.add_polygon(s, Orientation::Forward, &vs).unwrap());
    }
    let shell = ShellId(d.shells.len());
    d.shells.push(Shell { faces });
    d.solids.push(Solid {
        shells: vec![shell],
    });
    for v in &mut d.vertices {
        v.point = map(v.point);
    }
    for c in &mut d.curves {
        let Curve::Line { a, b } = c;
        *a = map(*a);
        *b = map(*b);
    }
    for s in &mut d.surfaces {
        let Surface::Plane { origin, normal } = s;
        *origin = map(*origin);
        *normal = normal_map(*normal);
    }
    (d.finish().unwrap(), vm[0])
}

fn decided(contained: bool) -> Result<IncidenceDecision> {
    Ok(IncidenceDecision {
        incidence: if contained {
            Incidence::Contained
        } else {
            Incidence::NotContained
        },
        evidence: Evidence::ExactSourcePredicate,
    })
}

/// Collinearity in 3D needs all three cross-product components. For an edge
/// direction with exactly one zero component, an off-line probe inside the
/// edge's bounding box is visible in exactly ONE projected orientation, so a
/// membership test that drops any single projection fabricates `Contained`.
#[test]
fn trimmed_line_membership_needs_every_projected_orientation() {
    // (name, map, inverse-transpose normal map, mapped edge direction,
    //  source-frame off-line probe whose image sits inside the mapped bbox).
    let cases: [(&str, fn(P3) -> P3, fn(P3) -> P3, P3, P3); 3] = [
        (
            "edge (6,0,6): only the zx projection detects",
            |p| v3(p.y, p.z, p.x + p.y),
            |n| v3(n.y - n.x, n.z, n.x),
            v3(6., 0., 6.),
            v3(3., 1.5, 0.),
        ),
        (
            "edge (6,6,0): only the xy projection detects",
            |p| v3(p.x + p.y, p.y, p.z),
            |n| v3(n.x, n.y - n.x, n.z),
            v3(6., 6., 0.),
            v3(-3., 4.5, 0.),
        ),
        (
            "edge (0,6,6): only the yz projection detects",
            |p| v3(p.x, p.y, p.z + p.y),
            |n| v3(n.x, n.y - n.z, n.z),
            v3(0., 6., 6.),
            v3(0., 1.5, 3.),
        ),
    ];
    for (name, map, normal_map, direction, off_line) in cases {
        let (b, probe) = probe_body(off_line, map, normal_map);
        let d = b.topology();
        let [a, e] = d.edges[0].vertices.map(|v| d.vertices[v.0].point);
        assert_eq!(e.sub(a), direction, "{name}: fixture edge direction");
        let p = d.vertices[probe.0].point;
        // The probe really is inside the closed bounding box of the edge and
        // really is off the line (nonzero cross product), by construction.
        for (pi, (ai, ei)) in [p.x, p.y, p.z]
            .into_iter()
            .zip([a.x, a.y, a.z].into_iter().zip([e.x, e.y, e.z]))
        {
            assert!(ai.min(ei) <= pi && pi <= ai.max(ei), "{name}: probe bbox");
        }
        assert_ne!(
            p.sub(a).cross(e.sub(a)),
            v3(0., 0., 0.),
            "{name}: probe off line"
        );
        assert_eq!(b.vertex_on_edge(probe, EdgeId(0)), decided(false), "{name}");
        // Positive control in the same frame: the edge midpoint is Contained.
        let (b, probe) = probe_body(v3(0., 3., 0.), map, normal_map);
        assert_eq!(
            b.vertex_on_edge(probe, EdgeId(0)),
            decided(true),
            "{name}: midpoint"
        );
    }
}

/// Unit cube, every quad fanned into two triangles, each triangle with its own
/// exactly computed carrier plane, vertex 6 relocated to `corner`.
fn triangulated_cube_with_corner(corner: P3) -> Draft {
    let cube = Brep::cuboid(v3(1., 1., 1.)).unwrap();
    let src = cube.topology();
    let mut d = Draft::new();
    for (i, v) in src.vertices.iter().enumerate() {
        d.add_vertex(if i == 6 { corner } else { v.point });
    }
    let mut faces = Vec::new();
    for face in &src.faces {
        let vs: Vec<_> = src.loops[face.loops[0].0]
            .coedges
            .iter()
            .map(|c| {
                let c = &src.coedges[c.0];
                src.edges[c.edge.0].vertices[usize::from(c.orientation == Orientation::Reversed)]
            })
            .collect();
        for i in 1..vs.len() - 1 {
            let tri = [vs[0], vs[i], vs[i + 1]];
            let [a, b, c] = tri.map(|v| d.vertices[v.0].point);
            // Dyadic coordinates: this cross product is exact in binary64.
            let normal = b.sub(a).cross(c.sub(a));
            let s = d.add_plane(a, normal);
            faces.push(d.add_polygon(s, Orientation::Forward, &tri).unwrap());
        }
    }
    d.shells.push(Shell { faces });
    d.solids.push(Solid {
        shells: vec![ShellId(0)],
    });
    d
}

/// The convex domain is what makes the coplanar-overlap injectivity argument
/// sound. A closed, consistently oriented, manifold shell whose faces are all
/// planar convex triangles but whose body is NOT convex must be refused by
/// name, not certified with a volume.
#[test]
fn nonconvex_and_inverted_shells_are_refused_by_name_not_certified() {
    // Positive control: the same fixture with the original corner is a cube.
    let cube = triangulated_cube_with_corner(v3(1., 1., 1.))
        .finish()
        .unwrap();
    let vol = cube.volume(SolidId(0)).unwrap();
    assert!(vol.lo() <= 1. && 1. <= vol.hi(), "{vol:?}");
    // Corner 6 pushed inward along the diagonal: a notch, every face still a
    // planar convex triangle, edges manifold, links connected, volume positive.
    let notched = triangulated_cube_with_corner(v3(0.75, 0.75, 0.75));
    match notched.finish() {
        Err(Error::Unsupported("nonconvex or inward shell")) => {}
        Ok(b) => panic!(
            "nonconvex notch certified with volume {:?}",
            b.volume(SolidId(0))
        ),
        Err(e) => panic!("wrong refusal for nonconvex notch: {e:?}"),
    }
    // Every face turned inward: effective coedge senses stay opposite, so only
    // the halfspace audit names this before any volume sign is computed.
    let mut inverted = Brep::cuboid(v3(1., 1., 1.)).unwrap().to_draft();
    for f in &mut inverted.faces {
        f.orientation = f.orientation.reversed();
    }
    assert_eq!(
        inverted.finish().err(),
        Some(Error::Unsupported("nonconvex or inward shell"))
    );
}
