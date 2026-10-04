use glam::{Mat4, Vec3};
use serde::Serialize;
#[derive(Serialize)]
pub struct Camera {
    pub view: String,
    pub projection: String,
    pub projected_bounds_px: [f32; 4],
    #[serde(skip)]
    pub matrix: Mat4,
}
// Projected bounding-box fit adapted from look; see ../NOTICE.
// Wonky coordinates are millimetres, Z up, front looking along +Y.
pub fn camera(
    name: &str,
    perspective: bool,
    bounds: [[f64; 3]; 2],
    size: [u32; 2],
) -> Result<Camera, String> {
    let direction = match name {
        "front" => Vec3::NEG_Y,
        "right" => Vec3::X,
        "top" => Vec3::Z,
        "iso" => Vec3::new(1., -1., 1.).normalize(),
        _ => return Err("render/unknown-view".into()),
    };
    let up = if name == "top" { Vec3::Y } else { Vec3::Z };
    camera_direction(name, perspective, bounds, size, direction, up)
}
pub fn camera_direction(
    name: &str,
    perspective: bool,
    bounds: [[f64; 3]; 2],
    size: [u32; 2],
    direction: Vec3,
    up: Vec3,
) -> Result<Camera, String> {
    // Recenter in f64 before GPU conversion; small distant parts retain their shape.
    let origin: [f64; 3] = std::array::from_fn(|k| bounds[0][k] * 0.5 + bounds[1][k] * 0.5);
    let min = Vec3::from_array(std::array::from_fn(|k| (bounds[0][k] - origin[k]) as f32));
    let max = Vec3::from_array(std::array::from_fn(|k| (bounds[1][k] - origin[k]) as f32));
    let center = (min + max) * 0.5;
    let radius = (max - min).length() * 0.5;
    if !radius.is_finite() || radius <= 0. {
        return Err("render/degenerate-bounds".into());
    }
    let forward = -direction;
    let right = forward.cross(up).normalize();
    let camera_up = right.cross(forward).normalize();
    let aspect = size[0] as f32 / size[1] as f32;
    let corners: Vec<_> = [min.x, max.x]
        .into_iter()
        .flat_map(|x| {
            [min.y, max.y]
                .into_iter()
                .flat_map(move |y| [min.z, max.z].into_iter().map(move |z| Vec3::new(x, y, z)))
        })
        .collect();
    let half_x = corners
        .iter()
        .map(|p| (*p - center).dot(right).abs())
        .fold(0., f32::max);
    let half_y = corners
        .iter()
        .map(|p| (*p - center).dot(camera_up).abs())
        .fold(0., f32::max);
    let (distance, projection) = if perspective {
        let fov = 35_f32.to_radians();
        let limiting = (fov * 0.5).min(((fov * 0.5).tan() * aspect).atan());
        let d = radius * 1.1 / limiting.sin();
        (
            d,
            Mat4::perspective_rh(
                fov,
                aspect,
                (d - radius * 1.5).max(radius * 0.001),
                d + radius * 2.,
            ),
        )
    } else {
        let h = half_y.max(half_x / aspect).max(radius * 0.0001) * 1.1;
        (
            radius * 3.,
            Mat4::orthographic_rh(-h * aspect, h * aspect, -h, h, radius * 0.01, radius * 8.),
        )
    };
    #[cfg(feature = "plant-fixed-distance")]
    let distance = {
        let _ = distance;
        3.0
    };
    let matrix = projection * Mat4::look_at_rh(center + direction * distance, center, up);
    if !matrix.is_finite() {
        return Err("render/camera-nonfinite".into());
    }
    let mut bbox = [
        f32::INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NEG_INFINITY,
    ];
    for p in corners {
        let q = matrix * p.extend(1.);
        let x = (q.x / q.w + 1.) * 0.5 * size[0] as f32;
        let y = (1. - q.y / q.w) * 0.5 * size[1] as f32;
        bbox[0] = bbox[0].min(x);
        bbox[1] = bbox[1].min(y);
        bbox[2] = bbox[2].max(x);
        bbox[3] = bbox[3].max(y);
    }
    Ok(Camera {
        view: name.into(),
        projection: if perspective {
            "perspective"
        } else {
            "orthographic"
        }
        .into(),
        projected_bounds_px: bbox,
        matrix,
    })
}
