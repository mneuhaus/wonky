use super::*;
fn cuboid() -> Request {
    let vertices = vec![
        [1000., 2000., 3000.],
        [1200., 2000., 3000.],
        [1200., 2050., 3000.],
        [1000., 2050., 3000.],
        [1000., 2000., 3100.],
        [1200., 2000., 3100.],
        [1200., 2050., 3100.],
        [1000., 2050., 3100.],
    ];
    let quads = [
        [3, 2, 1, 0],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ];
    let triangles = quads
        .into_iter()
        .flat_map(|q| [[q[0], q[1], q[2]], [q[0], q[2], q[3]]])
        .collect();
    let edges = vec![
        vec![0, 1],
        vec![1, 2],
        vec![2, 3],
        vec![3, 0],
        vec![4, 5],
        vec![5, 6],
        vec![6, 7],
        vec![7, 4],
        vec![0, 4],
        vec![1, 5],
        vec![2, 6],
        vec![3, 7],
    ];
    Request {
        vertices,
        triangles,
        edges,
        bounds: [[1000., 2000., 3000.], [1200., 2050., 3100.]],
        views: vec!["front".into(), "right".into(), "top".into(), "iso".into()],
        resolution: [257, 193],
        atlas: 2,
        perspective: false,
        file: None,
    }
}
fn temp(name: &str) -> String {
    std::env::temp_dir()
        .join(format!("wonky-render-{}-{name}.png", std::process::id()))
        .to_string_lossy()
        .into_owned()
}
#[test]
fn silhouette_fits_independently_projected_exact_bounds_and_repeat_bytes() {
    let req = cuboid();
    validate(&req).unwrap();
    let a = temp("a");
    let b = temp("b");
    let meta = pollster::block_on(render(&req, &a)).unwrap();
    let meta2 = pollster::block_on(render(&req, &b)).unwrap();
    assert_eq!(meta.edges, 12);
    assert_eq!(meta.edge_segments, 12);
    assert_eq!(meta.triangles, 12);
    assert_eq!(std::fs::read(&a).unwrap(), std::fs::read(&b).unwrap());
    assert_eq!(meta.silhouette_bounds_px, meta2.silhouette_bounds_px);
    // Read PNG pixels rather than accepting the renderer's own silhouette report.
    let decoder = png::Decoder::new(std::fs::File::open(&a).unwrap());
    let mut reader = decoder.read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut pixels).unwrap();
    assert_eq!((info.width, info.height), (514, 386));
    for view in 0..4 {
        let mut bbox = [u32::MAX, u32::MAX, 0, 0];
        let mut count = 0;
        for y in 0..193 {
            for x in 0..257 {
                let ox = (view % 2) * 257 + x;
                let oy = (view / 2) * 193 + y;
                if pixels[((oy * info.width + ox) * 4 + 3) as usize] > 0 {
                    count += 1;
                    bbox[0] = bbox[0].min(x);
                    bbox[1] = bbox[1].min(y);
                    bbox[2] = bbox[2].max(x + 1);
                    bbox[3] = bbox[3].max(y + 1);
                }
            }
        }
        assert!(count > 100, "view {view} is empty");
        if view < 3 {
            // Independent scalar projection: exact cuboid dimensions, not camera.matrix.
            let dimensions = [[200., 100.], [50., 100.], [200., 50.]][view as usize];
            let scale = (257_f64 / dimensions[0]).min(193_f64 / dimensions[1]) / 1.1;
            let filled_area = dimensions[0] * scale * dimensions[1] * scale;
            let one_pixel_border = 2. * (dimensions[0] + dimensions[1]) * scale;
            assert!(count as f64 >= filled_area-one_pixel_border,"view {view} does not fill the known cuboid silhouette: {count} pixels, expected area {filled_area}");
            let expected = [
                (257. - dimensions[0] * scale) / 2.,
                (193. - dimensions[1] * scale) / 2.,
                (257. + dimensions[0] * scale) / 2.,
                (193. + dimensions[1] * scale) / 2.,
            ];
            for k in 0..4 {
                assert!(
                    (bbox[k] as f64 - expected[k]).abs() <= 1.,
                    "view {view} bbox {bbox:?} expected {expected:?}"
                );
            }
        }
    }
    std::fs::remove_file(a).unwrap();
    std::fs::remove_file(b).unwrap();
}
#[test]
fn perspective_frames_same_geometry_at_different_scales() {
    for scale in [0.0001, 1., 1e6] {
        let mut req = cuboid();
        for p in &mut req.vertices {
            for k in 0..3 {
                p[k] = (p[k] - [1000., 2000., 3000.][k]) * scale;
            }
        }
        req.bounds = [[0., 0., 0.], [200. * scale, 50. * scale, 100. * scale]];
        req.perspective = true;
        let path = temp(&format!("perspective-{scale}"));
        let meta = pollster::block_on(render(&req, &path)).unwrap();
        assert!(meta.silhouette_bounds_px.iter().all(|b| b.is_some()));
        std::fs::remove_file(path).unwrap();
    }
}
#[test]
fn own_step_import_and_named_refusal() {
    let mut req = cuboid();
    req.vertices.clear();
    req.edges.clear();
    req.triangles.clear();
    let tetra = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/step-import/tetra-si.step"
    );
    input::load(tetra, &mut req).unwrap();
    assert_eq!(req.vertices.len(), 4);
    assert_eq!(req.edges.len(), 6);
    assert_eq!(req.triangles.len(), 4);
    validate(&req).unwrap();
    let path = temp("step");
    let meta = pollster::block_on(render(&req, &path)).unwrap();
    assert!(meta.silhouette_bounds_px.iter().all(|b| b.is_some()));
    std::fs::remove_file(path).unwrap();
    let invalid = temp("invalid").replace(".png", ".step");
    std::fs::write(&invalid, b"not STEP").unwrap();
    let error = input::load(&invalid, &mut req).unwrap_err();
    assert!(error.starts_with("import/"), "{error}");
    std::fs::remove_file(invalid).unwrap();
}
#[test]
fn invalid_layout_indices_and_nonfinite_are_refused() {
    let mut req = cuboid();
    req.atlas = 0;
    assert_eq!(validate(&req).unwrap_err(), "render/invalid-layout");
    req = cuboid();
    req.triangles[0][0] = 100;
    assert_eq!(validate(&req).unwrap_err(), "render/invalid-index");
    req = cuboid();
    req.vertices[0][0] = f64::NAN;
    assert_eq!(validate(&req).unwrap_err(), "render/invalid-geometry");
}
