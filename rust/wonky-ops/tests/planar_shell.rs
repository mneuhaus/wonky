//! Primary owner-boundary contracts: independent shell closed forms, exact
//! finite-face selection/ties, and construction-bound rejection of corruption.
//! These operations are absent from the inherited box Boolean coverage.
use wonky_contract::{Binary64, Body, BodyKey, Operation, SurfaceGeometry};
use wonky_ops::{
    affine::Affine,
    orthogonal, planar_shell,
    polyhedron::{audit, Audited},
    step,
};

fn audited(b: Body) -> Audited {
    audit(&b.check().unwrap()).unwrap()
}
fn box_at(lo: [f64; 3], hi: [f64; 3], frame: Affine) -> Audited {
    let b = audited(
        orthogonal::cuboid(
            BodyKey {
                id: [13, 2, 3, 4],
                revision: 0,
            },
            lo,
            hi,
        )
        .unwrap(),
    );
    if frame == Affine::IDENTITY {
        b
    } else {
        audited(orthogonal::transform(&b, frame).unwrap())
    }
}
fn side(a: &Audited, axis: usize, end: usize) -> usize {
    a.body
        .faces
        .iter()
        .position(|f| {
            matches!(&a.body.surfaces[f.surface.0 as usize].geometry,
        SurfaceGeometry::Plane { normal,.. } if normal[axis].get() == if end==0 {-1.}else{1.})
        })
        .unwrap()
}
fn close(got: f64, want: f64) {
    assert!(
        (got - want).abs() <= want.abs() * 2e-14 + 1e-9,
        "got {got}, want {want}"
    );
}

#[test]
fn all_six_openings_obey_independent_volume_area_and_topology_formulas() {
    for scale in [0.5, 1., 2., 8.] {
        for lengths in [[8., 12., 16.], [20., 28., 12.], [12., 12., 12.]] {
            let d = lengths.map(|x| x * scale / 1024.);
            let lo = [-32., 8., -16.].map(|x| x / 1024.);
            let hi = [0, 1, 2].map(|k| lo[k] + d[k]);
            let t = scale / 1024.;
            let original = box_at(lo, hi, Affine::IDENTITY);
            for axis in 0..3 {
                for end in 0..2 {
                    let body =
                        planar_shell::shell(&original, side(&original, axis, end), t).unwrap();
                    let w = wonky_wire::v3::encode(&body).unwrap();
                    let a = audit(&wonky_wire::v3::decode(&w).unwrap()).unwrap();
                    let inner = [0, 1, 2].map(|k| d[k] - if k == axis { t } else { 2. * t });
                    close(
                        a.volume_mm3().unwrap(),
                        (d.iter().product::<f64>() - inner.iter().product::<f64>()) * 1e9,
                    );
                    let pair_area = |x: [f64; 3]| 2. * (x[0] * x[1] + x[0] * x[2] + x[1] * x[2]);
                    close(
                        a.face_areas_mm2().unwrap().iter().sum(),
                        (pair_area(d) + pair_area(inner)
                            - 2. * inner[(axis + 1) % 3] * inner[(axis + 2) % 3])
                            * 1e6,
                    );
                    let topo = a.topology();
                    assert_eq!(
                        (
                            topo.faces,
                            topo.edges,
                            topo.vertices,
                            topo.loops,
                            topo.genus
                        ),
                        (11, 24, 16, 12, 0)
                    );
                    assert!(a.bound_to_construction);
                    assert_eq!(a.body.key.revision, 1);
                    assert_eq!(a.orthogonal.as_ref().unwrap().source_bbox(), [lo, hi]);
                    assert!(!step::write(&[("shell".into(), &a)], "shell")
                        .unwrap()
                        .is_empty());
                }
            }
        }
    }
}

#[test]
fn exact_face_selection_has_finite_trim_distances_and_inclusive_ties() {
    let a = box_at([0.; 3], [2., 4., 6.], Affine::IDENTITY);
    let faces: Vec<_> = (0..6).collect();
    let x0 = side(&a, 0, 0);
    let x1 = side(&a, 0, 1);
    let y1 = side(&a, 1, 1);
    assert_eq!(
        planar_shell::closest_faces(&a, &faces, [0., 2., 3.], 0.).unwrap(),
        [x0]
    );
    let mid = planar_shell::closest_faces(&a, &faces, [1., 2., 3.], 0.).unwrap();
    assert_eq!(mid.len(), 2);
    assert!(mid.contains(&x0) && mid.contains(&x1));
    let edge = planar_shell::closest_faces(&a, &faces, [3., 5., 3.], 0.).unwrap();
    assert_eq!(edge.len(), 2);
    assert!(edge.contains(&x1) && edge.contains(&y1));
    // Distances from this outside point to x0 and x1 are 3 and 1.
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], [3., 2., 3.], 2.)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], [3., 2., 3.], 2f64.next_down()).unwrap(),
        [x1]
    );
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], [3., 2., 3.], 2f64.next_up())
            .unwrap()
            .len(),
        2
    );
    // Both squared distances are nonzero and have an irrational square root:
    // near-ties here exercise the radical comparison rather than residual<=0.
    let diagonal = planar_shell::closest_faces(&a, &[x0, x1], [3., 5., 3.], 1.75).unwrap();
    assert_eq!(diagonal.len(), 2); // sqrt(10)-sqrt(2) < 1.75
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], [3., 5., 3.], 1.7).unwrap(),
        [x1]
    );
    assert!(planar_shell::closest_faces(&a, &[], [0.; 3], 0.)
        .unwrap()
        .is_empty());
    assert!(planar_shell::closest_faces(&a, &[], [0.; 3], f64::NAN).is_err());
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], [-1., -1., 3.], 1.8)
            .unwrap()
            .len(),
        2
    );
    let shifted = box_at([-2., -4., -6.], [0.; 3], Affine::IDENTITY);
    assert_eq!(
        planar_shell::closest_faces(&shifted, &(0..6).collect::<Vec<_>>(), [-1., -2., -3.], 0.)
            .unwrap()
            .len(),
        2
    );
    assert!(planar_shell::closest_faces(&a, &[999], [0.; 3], 0.)
        .unwrap_err()
        .0
        .contains("face-reference"));
}

#[test]
fn distant_signed_permutation_preserves_shell_and_world_point_basis() {
    let frame = Affine {
        origin: [131072.25, -65536.5, 16384.125],
        x: [0., 0., 1.],
        z: [0., -1., 0.],
    };
    let a = box_at([0.; 3], [0.016, 0.016, 0.008], frame);
    let face = side(&a, 2, 1);
    let p = frame.apply([0.008, 0.008, 0.008], 1., true).unwrap();
    assert_eq!(
        planar_shell::closest_faces(&a, &(0..6).collect::<Vec<_>>(), p, 1e-8).unwrap(),
        [face]
    );
    let shell = audited(planar_shell::shell(&a, face, 0.002).unwrap());
    close(shell.volume_mm3().unwrap(), 1184.);
    close(shell.face_areas_mm2().unwrap().iter().sum(), 1312.);
}

#[test]
fn offset_collapse_and_invalid_inputs_refuse_while_rational_offsets_replay() {
    let a = box_at([0.; 3], [2., 4., 6.], Affine::IDENTITY);
    let face = side(&a, 2, 1);
    for t in [0., -1., f64::NAN, f64::INFINITY] {
        assert!(planar_shell::shell(&a, face, t)
            .unwrap_err()
            .0
            .contains("nonpositive-thickness"));
    }
    assert!(planar_shell::shell(&a, face, 1.)
        .unwrap_err()
        .0
        .contains("collapsed-cavity"));
    let body = planar_shell::shell(&a,face,0.1).unwrap();
    let result = audited(body.clone());
    close(result.volume_mm3().unwrap(),(2.*4.*6.-1.8*3.8*5.9)*1e9);
    assert_eq!((result.topology().faces,result.topology().edges,result.topology().vertices),(11,24,16));
    assert!(step::write(&[("rational shell".into(),&result)],"shell").is_ok());
    let mut bad = body.clone();
    let coordinate = bad.vertices.iter_mut().flat_map(|v| &mut v.point).find(|c| c.get() != 0.).unwrap();
    *coordinate = Binary64::new(coordinate.get().next_up()).unwrap();
    assert!(audit(&bad.check().unwrap()).is_err());
    let mut bad = body;
    bad.constructions.last_mut().unwrap().parameters[0] = Binary64::new(0.1f64.next_up()).unwrap();
    assert!(audit(&bad.check().unwrap()).is_err());
    assert!(planar_shell::shell(&a, 999, 0.25)
        .unwrap_err()
        .0
        .contains("face-reference"));
    for t in [-1., f64::NAN, f64::INFINITY] {
        assert!(planar_shell::closest_faces(&a, &[face], [0.; 3], t).is_err());
    }
    assert!(planar_shell::closest_faces(&a, &[face], [f64::NAN, 0., 0.], 0.).is_err());
    let mut overflow = a.clone();
    overflow.body.key.revision = u32::MAX;
    assert!(planar_shell::shell(&overflow, face, 0.25)
        .unwrap_err()
        .0
        .contains("revision-range"));
}

#[test]
fn source_lineage_and_inward_thickness_are_not_relabelled_as_interpreter_inputs() {
    let a = box_at([0.; 3], [2., 4., 6.], Affine::IDENTITY);
    let shell = planar_shell::shell(&a, side(&a, 2, 1), 0.25).unwrap();
    let i = shell
        .constructions
        .iter()
        .position(|n| n.operation == Operation::Shell {})
        .unwrap();
    assert_eq!(i, a.body.constructions.len());
    // Planted negative: a different but otherwise valid shell thickness must
    // not validate the original boundary. Guards must replay construction.
    let mut changed = shell.clone();
    changed.constructions[i].parameters[0] = Binary64::new(0.5).unwrap();
    assert!(audit(&changed.check().unwrap())
        .unwrap_err()
        .0
        .contains("boundary-not-construction"));
    let mut removed = shell.clone();
    removed.constructions[i].parameters[1] = Binary64::new(0.).unwrap();
    assert!(audit(&removed.check().unwrap()).is_err());
    for side in [-1., 0.5, 5.5, 6.] {
        let mut bad = shell.clone();
        bad.constructions[i].parameters[1] = Binary64::new(side).unwrap();
        assert!(audit(&bad.check().unwrap()).is_err());
    }
    let mut extra_parent = shell.clone();
    extra_parent.constructions[i]
        .parents
        .push(wonky_contract::NodeId(0));
    assert!(audit(&extra_parent.check().unwrap()).is_err());
    let mut extra_parameter = shell.clone();
    extra_parameter.constructions[i]
        .parameters
        .push(Binary64::new(0.).unwrap());
    assert!(audit(&extra_parameter.check().unwrap()).is_err());
    let b = audited(shell);
    assert!(planar_shell::shell(&b, 0, 0.25)
        .unwrap_err()
        .0
        .contains("non-box-source"));
    let mut changed = b.body.clone();
    if let wonky_contract::Frame::Interpreter { x, .. } = &mut changed.frames[1] {
        x[0] = Binary64::new(1.001).unwrap();
    }
    assert!(audit(&changed.check().unwrap())
        .unwrap_err()
        .0
        .contains("world-metric-distortion"));
}

#[test]
fn shell_host_protocol_validates_inputs_and_transports_the_audited_boundary() {
    use wonky_ops::host::{
        host_op, MAGIC, OP_CLOSEST_BOX_FACES, OP_SHELL, STATUS_MALFORMED, STATUS_OK,
        STATUS_REFUSED, VERSION,
    };
    fn real(out: &mut Vec<u32>, x: f64) {
        out.push(x.to_bits() as u32);
        out.push((x.to_bits() >> 32) as u32);
    }
    let a = box_at([0.; 3], [2., 4., 6.], Affine::IDENTITY);
    let face = side(&a, 2, 1);
    let w = wonky_wire::v3::encode(&a.body).unwrap();
    let mut pick = vec![MAGIC, VERSION, OP_CLOSEST_BOX_FACES, w.len() as u32];
    pick.extend(&w);
    for x in [1., 2., 6., 0.] {
        real(&mut pick, x);
    }
    pick.push(6);
    pick.extend(0..6);
    let selected = host_op(&pick);
    assert_eq!(selected, vec![STATUS_OK, face as u32]);
    let mut shell = vec![MAGIC, VERSION, OP_SHELL, w.len() as u32];
    shell.extend(&w);
    shell.push(face as u32);
    real(&mut shell, 0.25);
    let reply = host_op(&shell);
    assert_eq!(reply[0], STATUS_OK);
    let built = audit(&wonky_wire::v3::decode(&reply[1..]).unwrap()).unwrap();
    close(
        built.volume_mm3().unwrap(),
        (2. * 4. * 6. - 1.5 * 3.5 * 5.75) * 1e9,
    );
    let mut bad = pick.clone();
    bad.push(0);
    assert_eq!(host_op(&bad)[0], STATUS_MALFORMED);
    let mut bad = shell.clone();
    bad.push(0);
    assert_eq!(host_op(&bad)[0], STATUS_MALFORMED);
    shell.truncate(shell.len() - 2);
    real(&mut shell, -0.25);
    assert_eq!(host_op(&shell)[0], STATUS_REFUSED);
    pick.truncate(pick.len() - 6);
    pick.extend([999; 6]);
    assert_eq!(host_op(&pick)[0], STATUS_REFUSED);
}

#[test]
fn source_thickness_survives_nonisometric_placement_and_wire_replay() {
    let s = 1. + 2f64.powi(-42);
    // x and the derived y both scale by s, hence determinant = s². Thickness
    // is deliberately SOURCE metric; demanding equal world thickness is wrong.
    let frame = Affine {
        origin: [64., -32., 16.],
        x: [s, 0., 0.],
        ..Affine::IDENTITY
    };
    let original = box_at([0.; 3], [2., 4., 6.], frame);
    let body = planar_shell::shell(&original, side(&original, 2, 1), 0.25).unwrap();
    let wire = wonky_wire::v3::encode(&body).unwrap();
    let a = audit(&wonky_wire::v3::decode(&wire).unwrap()).unwrap();
    close(
        a.volume_mm3().unwrap(),
        (2. * 4. * 6. - 1.5 * 3.5 * 5.75) * s * s * 1e9,
    );
    let t = a.topology();
    assert_eq!((t.faces, t.edges, t.vertices, t.loops), (11, 24, 16, 12));
    assert!(a.bound_to_construction);
    let mut bad = a.body.clone();
    let node = bad
        .constructions
        .iter_mut()
        .find(|n| matches!(n.operation, Operation::Shell {}))
        .unwrap();
    node.parameters[0] = Binary64::new(0.5).unwrap();
    assert!(audit(&bad.check().unwrap())
        .unwrap_err()
        .0
        .contains("boundary-not-construction"));
}

#[test]
fn face_selection_uses_exact_world_metric_and_finite_affine_trims() {
    let s = 1. + 2f64.powi(-42);
    let a = box_at(
        [0.; 3],
        [2., 4., 6.],
        Affine {
            x: [s, 0., 0.],
            ..Affine::IDENTITY
        },
    );
    let x0 = side(&a, 0, 0);
    let x1 = side(&a, 0, 1);
    let p = [3. * s, 2. * s, 3.];
    // World distance difference is 2*s, not source difference 2.
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], p, 2.).unwrap(),
        [x1]
    );
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], p, 2. * s)
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        planar_shell::closest_faces(&a, &[x0, x1], p, (2. * s).next_down()).unwrap(),
        [x1]
    );
    let h = 2f64.powi(-42);
    let shear = box_at(
        [0.; 3],
        [2., 4., 6.],
        Affine {
            z: [h, 0., 1.],
            ..Affine::IDENTITY
        },
    );
    let x0 = side(&shear, 0, 0);
    let z0 = side(&shear, 2, 0);
    // Below the trims: distance² to x0's bottom edge is 1+h²; to the
    // interior of z0 it is 1. Rounded f64 squares would invent a tie here.
    assert_eq!(
        planar_shell::closest_faces(&shear, &[x0, z0], [h, 2., -1.], 0.).unwrap(),
        [z0]
    );
    assert_eq!(
        planar_shell::closest_faces(&shear, &[x0, z0], [h, 2., -1.], h * h)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn rational_shells_preserve_exact_volume_and_vertices_through_boolean_replay() {
    use num_rational::BigRational as Q;
    use wonky_geom::model::VertexDef;
    let q = |x| Q::from_float(x).unwrap();
    let hi = [0.04, 0.03, 0.02];
    let original = box_at([0.; 3], hi, Affine::IDENTITY);
    let tool = box_at([0.1; 3], [0.2; 3], Affine::IDENTITY);
    for opening in 0..6 {
        let shell = audited(
            planar_shell::shell(&original, side(&original, opening / 2, opening % 2), 0.002)
                .unwrap(),
        );
        let outer = hi.map(q).into_iter().product::<Q>();
        let inner = (0..3)
            .map(|k| q(hi[k]) - q(0.002) * q(if k == opening / 2 { 1. } else { 2. }))
            .product::<Q>();
        let want = (outer - inner) * q(6.);
        let exact = shell.model().unwrap();
        assert_eq!(exact.volume6().unwrap(), vec![want.clone()]);
        let offset = q(hi[0]) - q(0.002);
        if opening != 1 {
            assert!(exact
                .draft()
                .vertices
                .iter()
                .any(|v| matches!(&v.def, VertexDef::Rational(p) if p[0] == offset)));
        }
        let output = orthogonal::boolean(
            BodyKey {
                id: [99, 2, 3, 4],
                revision: 0,
            },
            1,
            &[shell, tool.clone()],
        )
        .unwrap();
        assert_eq!(output.len(), 1);
        let result = audited(output.into_iter().next().unwrap());
        assert_eq!(result.model().unwrap().volume6().unwrap(), vec![want]);
    }
}

#[test]
fn rational_boundaries_retain_authority_through_placement_and_boolean() {
    let original = box_at([0.; 3], [0.04, 0.03, 0.02], Affine::IDENTITY);
    let shell = audited(planar_shell::shell(&original, side(&original, 2, 1), 0.002).unwrap());
    let identity = [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]];
    let shifted =
        wonky_ops::pattern::copy(&shell, shell.body.key.clone(), identity, [1., 2., 3.]).unwrap();
    assert_eq!(
        shifted.model().unwrap().volume6().unwrap(),
        shell.model().unwrap().volume6().unwrap()
    );
    close(shifted.volume_mm3().unwrap(), shell.volume_mm3().unwrap());
    assert!(step::write(&[("shifted shell".into(), &shifted)], "shifted").is_ok());
    let tool = box_at([4.; 3], [5.; 3], Affine::IDENTITY);
    let result = orthogonal::boolean(
        BodyKey {
            id: [101, 2, 3, 4],
            revision: 0,
        },
        1,
        &[shifted, tool],
    )
    .unwrap();
    let result = audited(result.into_iter().next().unwrap());
    close(result.volume_mm3().unwrap(), shell.volume_mm3().unwrap());
    let mut corrupted = result.body;
    let source = corrupted
        .constructions
        .iter_mut()
        .find(|n| n.operation == Operation::Shell {})
        .unwrap();
    source.parameters[0] = Binary64::new(0.002f64.next_up()).unwrap();
    assert!(audit(&corrupted.check().unwrap()).is_err());
}

#[test]
fn rational_shell_mesh_preserves_every_opening_and_rejects_unreplayed_caches() {
    use wonky_ops::mesh::{binary_stl, tessellate};
    let broad_shear = Affine {
        x: [1., 0.125, 0.],
        ..Affine::IDENTITY
    };
    let base = box_at([0.; 3], [0.016, 0.016, 0.008], Affine::IDENTITY);
    assert_eq!(
        orthogonal::transform(&base, broad_shear).unwrap_err().0,
        "orthogonal/non-rigid-placement"
    );
    let shell = audited(planar_shell::shell(&base, side(&base, 2, 1), 0.0001).unwrap());
    assert_eq!(
        orthogonal::transform(&shell, broad_shear).unwrap_err().0,
        "pattern/metric-not-near-isometric"
    );
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [0.023, -0.011, 0.007],
            x: [1., 2f64.powi(-42), 0.],
            z: [0., 0., 1.],
        },
    ] {
        let source = box_at([0.; 3], [0.016, 0.016, 0.008], Affine::IDENTITY);
        for axis in 0..3 {
            for end in 0..2 {
                let body = planar_shell::shell(&source, side(&source, axis, end), 0.0001).unwrap();
                // Retain the exact, admitted near-isometric affine source map.
                let body = if frame == Affine::IDENTITY {
                    body
                } else {
                    orthogonal::transform(&audited(body), frame).unwrap()
                };
                let checked = body.clone().check().unwrap();
                let mesh = tessellate(&checked, 0.005).unwrap();
                assert_eq!(mesh.vertices.len(), 16);
                assert_eq!(mesh.triangles.len(), 28);
                assert_eq!(mesh.faces.len(), 28);
                assert_eq!(mesh.edges.len(), 24);
                let stl = binary_stl(&[mesh.clone()], 0.005).unwrap();
                assert_eq!(stl.len(), 84 + 50 * 28);
                let volume: f64 = mesh
                    .triangles
                    .iter()
                    .map(|t| {
                        let [a, b, c] = t.map(|i| mesh.vertices[i]);
                        (a[0] * (b[1] * c[2] - b[2] * c[1])
                            + a[1] * (b[2] * c[0] - b[0] * c[2])
                            + a[2] * (b[0] * c[1] - b[1] * c[0]))
                            / 6.
                    })
                    .sum();
                close(volume, audit(&checked).unwrap().volume_mm3().unwrap());
                assert!(tessellate(&checked, 1e-30)
                    .unwrap_err()
                    .0
                    .contains("precision-budget"));
                let mut corrupted = body;
                let coordinate = corrupted
                    .vertices
                    .iter_mut()
                    .flat_map(|v| v.point.iter_mut())
                    .find(|x| x.get() != 0.)
                    .unwrap();
                *coordinate = Binary64::new(coordinate.get().next_up()).unwrap();
                assert!(tessellate(&corrupted.check().unwrap(), 0.005).is_err());
            }
        }
    }
}
