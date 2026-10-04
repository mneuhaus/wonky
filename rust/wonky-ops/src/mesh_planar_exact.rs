//! Export the authenticated rational planar boundary, rounding only after
//! contour topology and diagonals have been decided in its exact world chart.
use crate::{
    mesh::{no, Mesh, MeshEdge, R},
    mesh_triangulate::{self, PlanarPoint},
    planar_geometry::{self, P},
    polyhedron::Audited,
};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use std::collections::BTreeSet;
use wonky_num::Sign;
type P2 = [Q; 2];
fn side(a: &P2, b: &P2, c: &P2) -> Q {
    (&b[0] - &a[0]) * (&c[1] - &a[1]) - (&b[1] - &a[1]) * (&c[0] - &a[0])
}
fn sign(q: Q) -> Sign {
    if q.is_positive() {
        Sign::Positive
    } else if q.is_negative() {
        Sign::Negative
    } else {
        Sign::Zero
    }
}
fn on(a: &P2, b: &P2, p: &P2) -> bool {
    side(a, b, p).is_zero()
        && (0..2).all(|k| {
            p[k] >= a[k].clone().min(b[k].clone()) && p[k] <= a[k].clone().max(b[k].clone())
        })
}
fn location(points: &[P2], cycle: &[usize], p: &P2) -> R<bool> {
    let mut winding = 0;
    for i in 0..cycle.len() {
        let (a, b) = (&points[cycle[i]], &points[cycle[(i + 1) % cycle.len()]]);
        if on(a, b, p) {
            return Err(no("point-on-contour"));
        }
        let s = side(a, b, p);
        if a[1] <= p[1] && b[1] > p[1] && s.is_positive() {
            winding += 1;
        }
        if a[1] > p[1] && b[1] <= p[1] && s.is_negative() {
            winding -= 1;
        }
    }
    Ok(winding != 0)
}
impl PlanarPoint for P2 {
    fn orientation(a: &Self, b: &Self, c: &Self) -> R<Sign> {
        Ok(sign(side(a, b, c)))
    }
    fn obstructs(a: &Self, b: &Self, c: &Self, d: &Self) -> R<bool> {
        if a == c || a == d || b == c || b == d {
            return Ok([c, d].iter().any(|&p| p != a && p != b && on(a, b, p))
                || [a, b].iter().any(|&p| p != c && p != d && on(c, d, p))
                || (a == c && b == d)
                || (a == d && b == c));
        }
        let (ac, ad, ca, cb) = (
            sign(side(a, b, c)),
            sign(side(a, b, d)),
            sign(side(c, d, a)),
            sign(side(c, d, b)),
        );
        Ok((ac != Sign::Zero
            && ad != Sign::Zero
            && ac != ad
            && ca != Sign::Zero
            && cb != Sign::Zero
            && ca != cb)
            || on(a, b, c)
            || on(a, b, d)
            || on(c, d, a)
            || on(c, d, b))
    }
    fn area_sign(points: &[Self], cycle: &[usize]) -> R<i32> {
        let area: Q = (0..cycle.len())
            .map(|i| {
                let (a, b) = (&points[cycle[i]], &points[cycle[(i + 1) % cycle.len()]]);
                &a[0] * &b[1] - &a[1] * &b[0]
            })
            .sum();
        Ok(if area.is_positive() {
            1
        } else if area.is_negative() {
            -1
        } else {
            0
        })
    }
    fn midpoint_inside(points: &[Self], cycle: &[usize], a: usize, b: usize) -> R<bool> {
        let two = Q::from_integer(2.into());
        let p = std::array::from_fn(|k| (&points[a][k] + &points[b][k]) / &two);
        match location(points, cycle, &p) {
            Err(e) if e == no("point-on-contour") => Ok(false),
            result => result,
        }
    }
    fn in_circle(a: &Self, b: &Self, c: &Self, d: &Self) -> R<Sign> {
        let [a, b, c] = [a, b, c].map(|p| [&p[0] - &d[0], &p[1] - &d[1]]);
        let cross = |p: &P2, q: &P2| &p[0] * &q[1] - &p[1] * &q[0];
        let lift = |p: &P2| &p[0] * &p[0] + &p[1] * &p[1];
        Ok(sign(
            lift(&a) * cross(&b, &c) + lift(&b) * cross(&c, &a) + lift(&c) * cross(&a, &b),
        ))
    }
    fn simple(points: &[Self], cycle: &[usize]) -> R<()> {
        for i in 0..cycle.len() {
            let (a, b) = (&points[cycle[i]], &points[cycle[(i + 1) % cycle.len()]]);
            if a == b {
                return Err(no("non-simple-contour"));
            }
            for j in i + 1..cycle.len() {
                let (c, d) = (&points[cycle[j]], &points[cycle[(j + 1) % cycle.len()]]);
                let adjacent = j == i + 1 || (i == 0 && j + 1 == cycle.len());
                if (!adjacent && (a == c || a == d || b == c || b == d))
                    || Self::obstructs(a, b, c, d)?
                {
                    return Err(no("non-simple-contour"));
                }
            }
        }
        Ok(())
    }
    fn locate(points: &[Self], cycle: &[usize], p: &Self) -> R<bool> {
        location(points, cycle, p)
    }
}
fn normal(points: &[P], cycle: &[usize]) -> P {
    let mut n = std::array::from_fn(|_| Q::zero());
    for i in 1..cycle.len() - 1 {
        let c = planar_geometry::cross(
            &planar_geometry::sub(&points[cycle[i]], &points[cycle[0]]),
            &planar_geometry::sub(&points[cycle[i + 1]], &points[cycle[0]]),
        );
        for k in 0..3 {
            n[k] += &c[k];
        }
    }
    n
}
pub(crate) fn tessellate(a: &Audited, deviation_mm: f64) -> R<Mesh> {
    let points = planar_geometry::world_points(a, 1000.)?;
    let mut mesh = Mesh {
        brep_vertices: points.len(),
        ..Default::default()
    };
    let mut unique = BTreeSet::new();
    let budget = planar_geometry::q(deviation_mm) / Q::from_integer(2.into());
    for p in &points {
        let v = planar_geometry::point(p)?;
        let error: Q = (0..3)
            .map(|k| (&p[k] - planar_geometry::q(v[k])).abs())
            .sum();
        if error > budget {
            return Err(no("arrangement-vertex-budget/vertex-precision-budget"));
        }
        if !unique.insert(v.map(|x| if x == 0. { 0 } else { x.to_bits() })) {
            return Err(no("vertex-rounding-collision"));
        }
        mesh.vertices.push(v);
    }
    for (id, face) in a.body.faces.iter().enumerate() {
        let mut loops = Vec::new();
        let mut outer = 0;
        for lp in &face.loops {
            let cycle = a.face_loops[lp.0 as usize].clone();
            if cycle.len() < 3 {
                return Err(no("invalid-contour"));
            }
            if a.body.loops[lp.0 as usize].outer {
                outer += 1;
                loops.insert(0, cycle);
            } else {
                loops.push(cycle);
            }
        }
        if outer != 1 {
            return Err(no("one-outer-loop-required"));
        }
        let n = normal(&points, &loops[0]);
        let drop = (0..3).max_by_key(|&k| n[k].abs()).unwrap();
        if n[drop].is_zero() {
            return Err(no("zero-plane-normal"));
        }
        if loops.iter().flatten().any(|&k| {
            !planar_geometry::dot(&n, &planar_geometry::sub(&points[k], &points[loops[0][0]]))
                .is_zero()
        }) {
            return Err(no("non-planar-source"));
        }
        let projected: Vec<P2> = points
            .iter()
            .map(|p| [p[(drop + 1) % 3].clone(), p[(drop + 2) % 3].clone()])
            .collect();
        let rounded: Vec<P2> = mesh
            .vertices
            .iter()
            .map(|p| {
                [
                    planar_geometry::q(p[(drop + 1) % 3]),
                    planar_geometry::q(p[(drop + 2) % 3]),
                ]
            })
            .collect();
        // The rounded boundary must remain embedded as well as keeping all
        // triangle signs. No retriangulation or weld repairs an export witness.
        mesh_triangulate::validate_loops(&rounded, &loops)
            .map_err(|_| no("vertex-rounding-contour-topology"))?;
        let reverse = (P2::area_sign(&projected, &loops[0])? < 0)
            ^ a.frame.reversed().map_err(|_| no("frame-orientation"))?;
        for mut t in mesh_triangulate::triangulate_loops(&projected, &loops)? {
            if P2::orientation(&rounded[t[0]], &rounded[t[1]], &rounded[t[2]])? != Sign::Positive {
                return Err(no("vertex-rounding-triangle-inversion"));
            }
            if reverse {
                t.swap(1, 2);
            }
            mesh.triangles.push(t);
            mesh.faces.push(id as u32);
        }
    }
    mesh.edges = a
        .body
        .edges
        .iter()
        .map(|e| {
            if e.vertices.len() != 2 {
                return Err(no("line-endpoints"));
            }
            Ok(MeshEdge {
                vertices: e.vertices.iter().map(|v| v.0 as usize).collect(),
                closed: false,
            })
        })
        .collect::<R<_>>()?;
    crate::mesh::check_watertight(&mesh)?;
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn q(n: i64, d: i64) -> Q {
        Q::new(n.into(), d.into())
    }
    #[test]
    fn rational_holes_collinear_vertices_and_delaunay() {
        let points: Vec<P2> = [
            [0, 0],
            [6, 0],
            [12, 0],
            [12, 12],
            [0, 12],
            [2, 2],
            [2, 4],
            [4, 4],
            [4, 2],
            [7, 6],
            [7, 9],
            [10, 9],
            [10, 6],
        ]
        .map(|p| p.map(|x| q(x, 3)))
        .to_vec();
        let loops = vec![vec![0, 1, 2, 3, 4], vec![5, 6, 7, 8], vec![9, 10, 11, 12]];
        let triangles = mesh_triangulate::triangulate_loops(&points, &loops).unwrap();
        assert_eq!(triangles.len(), 15);
        let area: Q = triangles
            .iter()
            .map(|t| side(&points[t[0]], &points[t[1]], &points[t[2]]))
            .sum();
        assert_eq!(area, q(262, 9));
        let mut edges = std::collections::BTreeMap::new();
        for t in &triangles {
            for k in 0..3 {
                *edges.entry((t[k], t[(k + 1) % 3])).or_insert(0) += 1;
            }
        }
        for c in &loops {
            for k in 0..c.len() {
                assert_eq!(edges.get(&(c[k], c[(k + 1) % c.len()])), Some(&1));
            }
        }
        for (&(a, b), &count) in &edges {
            assert_eq!(count, 1);
            if edges.contains_key(&(b, a)) {
                let w = *triangles
                    .iter()
                    .find(|t| {
                        t.contains(&a)
                            && t.contains(&b)
                            && t.iter()
                                .position(|&x| x == a)
                                .is_some_and(|i| t[(i + 1) % 3] == b)
                    })
                    .unwrap()
                    .iter()
                    .find(|&&x| x != a && x != b)
                    .unwrap();
                let x = *triangles
                    .iter()
                    .find(|t| {
                        t.contains(&a)
                            && t.contains(&b)
                            && t.iter()
                                .position(|&x| x == b)
                                .is_some_and(|i| t[(i + 1) % 3] == a)
                    })
                    .unwrap()
                    .iter()
                    .find(|&&x| x != a && x != b)
                    .unwrap();
                if side(&points[a], &points[x], &points[w]).is_positive()
                    && side(&points[x], &points[b], &points[w]).is_positive()
                {
                    assert_ne!(
                        P2::in_circle(&points[a], &points[b], &points[w], &points[x]).unwrap(),
                        Sign::Positive
                    );
                }
            }
        }
    }
    #[test]
    fn rational_sub_ulp_contour_is_not_a_rounded_polygon() {
        let one = q(1, 1);
        let small = Q::new(1.into(), num_bigint::BigInt::from(1u64) << 60);
        let points = vec![
            [one.clone(), q(0, 1)],
            [&one + &small, q(0, 1)],
            [&one + &small, q(1, 3)],
            [one, q(1, 3)],
        ];
        let t = mesh_triangulate::triangulate_loops(&points, &[vec![0, 1, 2, 3]]).unwrap();
        assert_eq!(t.len(), 2);
        let area: Q = t
            .iter()
            .map(|t| side(&points[t[0]], &points[t[1]], &points[t[2]]))
            .sum();
        assert_eq!(area, small * q(2, 3));
    }
    #[test]
    fn reflected_rational_shell_retains_outward_orientation() {
        use crate::{orthogonal, placement::Post, planar_shell, polyhedron};
        use wonky_contract::{BodyKey, SurfaceGeometry};
        let key = BodyKey {
            id: [91, 2, 3, 4],
            revision: 0,
        };
        let base = orthogonal::cuboid(key.clone(), [0.; 3], [0.016, 0.016, 0.008])
            .unwrap()
            .check()
            .unwrap();
        let base = polyhedron::audit(&base).unwrap();
        let top=base.body.faces.iter().position(|f| matches!(&base.body.surfaces[f.surface.0 as usize].geometry,SurfaceGeometry::Plane {normal,..} if normal[2].get()==1.)).unwrap();
        let body = planar_shell::shell(&base, top, 0.0001).unwrap();
        let placed = crate::pattern::place_body(
            &body,
            key,
            &Post::Rows {
                translation: [0.023, -0.011, 0.007],
                rows: [[-1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            },
        )
        .unwrap()
        .check()
        .unwrap();
        let a = polyhedron::audit(&placed).unwrap();
        assert!(a.frame.reversed().unwrap());
        let mesh = crate::mesh::tessellate(&placed, 0.005).unwrap();
        let volume: f64 = mesh
            .triangles
            .iter()
            .map(|t| {
                let [a, b, c] = t.map(|i| mesh.vertices[i]);
                a[0] * (b[1] * c[2] - b[2] * c[1])
                    + a[1] * (b[2] * c[0] - b[0] * c[2])
                    + a[2] * (b[0] * c[1] - b[1] * c[0])
            })
            .sum::<f64>()
            / 6.;
        assert!((volume - a.volume_mm3().unwrap()).abs() < 1e-9);
        crate::mesh::binary_stl(&[mesh], 0.005).unwrap();
    }
    #[test]
    fn rational_invalid_contours_refuse() {
        let points: Vec<P2> = [[0, 0], [4, 4], [0, 4], [4, 0]]
            .map(|p| p.map(|x| q(x, 3)))
            .to_vec();
        assert_eq!(
            mesh_triangulate::triangulate_loops(&points, &[vec![0, 1, 2, 3]]).unwrap_err(),
            no("non-simple-contour")
        );
        let points: Vec<P2> = [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [5, 5],
            [5, 6],
            [6, 6],
            [6, 5],
        ]
        .map(|p| p.map(|x| q(x, 3)))
        .to_vec();
        assert_eq!(
            mesh_triangulate::triangulate_loops(&points, &[vec![0, 1, 2, 3], vec![4, 5, 6, 7]])
                .unwrap_err(),
            no("invalid-hole-nesting")
        );
    }
}
