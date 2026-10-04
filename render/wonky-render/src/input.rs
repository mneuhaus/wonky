use crate::Request;
use num_traits::ToPrimitive;
use wonky_geom::{
    import::{source_digest, ImportDraft, Limits, Source},
    model::{Bounds, Curve3, VertexId},
};
pub fn load(file: &str, req: &mut Request) -> Result<(), String> {
    if std::fs::metadata(file)
        .map_err(|e| format!("render/read:{e}"))?
        .len()
        > 256 * 1024 * 1024
    {
        return Err("render/input-budget-exceeded".into());
    }
    req.vertices.clear();
    req.triangles.clear();
    req.edges.clear();
    let bytes = std::fs::read(file).map_err(|e| format!("render/read:{e}"))?;
    match std::path::Path::new(file)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "stl" => stl(&bytes, req)?,
        "step" | "stp" => step(&bytes, req)?,
        _ => return Err("render/input-format-unavailable".into()),
    }
    req.bounds = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for p in &req.vertices {
        for k in 0..3 {
            req.bounds[0][k] = req.bounds[0][k].min(p[k]);
            req.bounds[1][k] = req.bounds[1][k].max(p[k]);
        }
    }
    Ok(())
}
fn stl(bytes: &[u8], req: &mut Request) -> Result<(), String> {
    let count = if bytes.len() >= 84 {
        u32::from_le_bytes(bytes[80..84].try_into().unwrap()) as usize
    } else {
        0
    };
    if count > 0 && count <= 5_000_000 && bytes.len() == 84 + count * 50 {
        for t in bytes[84..].chunks_exact(50) {
            let base = req.vertices.len();
            for p in t[12..48].chunks_exact(12) {
                req.vertices.push(std::array::from_fn(|k| {
                    f32::from_le_bytes(p[k * 4..k * 4 + 4].try_into().unwrap()) as f64
                }));
            }
            req.triangles.push([base, base + 1, base + 2]);
        }
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| "render/stl-invalid")?;
        let mut in_facet = false;
        let mut points = Vec::new();
        let mut ended = false;
        for line in text.lines() {
            let tokens: Vec<_> = line.split_whitespace().collect();
            match tokens.first().copied() {
                Some("facet") => {
                    if in_facet {
                        return Err("render/stl-invalid".into());
                    }
                    in_facet = true;
                    points.clear();
                }
                Some("vertex") => {
                    if !in_facet || tokens.len() != 4 {
                        return Err("render/stl-invalid".into());
                    }
                    let mut p = [0.; 3];
                    for k in 0..3 {
                        p[k] = tokens[k + 1].parse().map_err(|_| "render/stl-invalid")?;
                    }
                    points.push(p);
                }
                Some("endfacet") => {
                    if !in_facet || points.len() != 3 {
                        return Err("render/stl-invalid".into());
                    }
                    let b = req.vertices.len();
                    req.vertices.extend(&points);
                    req.triangles.push([b, b + 1, b + 2]);
                    in_facet = false;
                }
                Some("endsolid") => ended = true,
                Some("solid" | "outer" | "endloop") | None => {}
                _ => return Err("render/stl-invalid".into()),
            }
        }
        if in_facet || !ended || req.triangles.is_empty() {
            return Err("render/stl-invalid".into());
        }
    }
    // STL carries no exact B-rep feature edges. Never synthesize them by angle.
    Ok(())
}
fn step(bytes: &[u8], req: &mut Request) -> Result<(), String> {
    let imported = ImportDraft::step(
        bytes,
        Source {
            digest: source_digest(bytes),
            revision: None,
            instance_path: vec![],
        },
        Limits::default(),
    )
    .and_then(|d| d.check())
    .map_err(|e| e.name)?;
    let model = imported.model();
    let d = model.draft();
    for (i, _) in d.vertices.iter().enumerate() {
        let p = model
            .key(VertexId(i as u32))
            .rational()
            .map_err(|e| e.0.to_string())?;
        let p = d.placement.point(p);
        let mut out = [0.; 3];
        for k in 0..3 {
            out[k] = p[k].to_f64().ok_or("render/step-coordinate-range")?;
        }
        req.vertices.push(out);
    }
    for e in &d.edges {
        if !matches!(d.curves[e.curve.index()].geometry, Curve3::Line { .. }) {
            return Err("render/step-curved-tessellation-unavailable".into());
        }
        if let Bounds::Segment(ids) = e.bounds {
            req.edges.push(ids.map(|id| id.index()).to_vec());
        } else {
            return Err("render/step-ring-tessellation-unavailable".into());
        }
    }
    for face in &d.faces {
        let plane = d.surfaces[face.surface.index()]
            .carrier
            .plane()
            .map_err(|e| e.0.to_string())?;
        let chart = d
            .vertices
            .iter()
            .enumerate()
            .map(|(i, _)| {
                let p = model
                    .key(VertexId(i as u32))
                    .rational()
                    .map_err(|e| e.0.to_string())?;
                let q = plane.chart(p).map_err(|e| e.0.to_string())?;
                Ok([
                    q[0].to_f64().ok_or("render/step-coordinate-range")?,
                    q[1].to_f64().ok_or("render/step-coordinate-range")?,
                ])
            })
            .collect::<Result<Vec<_>, String>>()?;
        let loops = face
            .loops
            .iter()
            .map(|l| {
                d.loops[l.index()]
                    .coedges
                    .iter()
                    .map(|id| {
                        let c = &d.coedges[id.index()];
                        let ids = &req.edges[c.edge.index()];
                        ids[if c.forward { 0 } else { 1 }]
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let mut triangles = wonky_ops::mesh::triangulate_loops(&chart, &loops).map_err(|e| e.0)?;
        if !face.forward {
            for t in &mut triangles {
                t.swap(1, 2);
            }
        }
        req.triangles.extend(triangles);
    }
    Ok(())
}
