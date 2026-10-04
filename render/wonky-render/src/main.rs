mod camera;
mod input;
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Instant};
mod scene;
mod viewer;
#[derive(Deserialize)]
struct Request {
    vertices: Vec<[f64; 3]>,
    triangles: Vec<[usize; 3]>,
    edges: Vec<Vec<usize>>,
    bounds: [[f64; 3]; 2],
    views: Vec<String>,
    resolution: [u32; 2],
    atlas: u32,
    #[serde(default)]
    perspective: bool,
    #[serde(default)]
    file: Option<String>,
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 3],
    normal: [f32; 3],
}
#[derive(Serialize)]
struct Metadata {
    views: Vec<camera::Camera>,
    triangles: usize,
    edges: usize,
    edge_segments: usize,
    width: u32,
    height: u32,
    silhouette_bounds_px: Vec<Option<[u32; 4]>>,
    timings_ms: Timings,
    adapter: String,
}
#[derive(Default, Serialize)]
struct Timings {
    initialize: f64,
    tessellate: f64,
    upload: f64,
    render: f64,
    readback: f64,
    encode: f64,
}
fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.
}
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--build-identity") {
        println!("{}", env!("WONKY_RENDER_SOURCE_HASH"));
        return;
    }
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(2);
    }
}
fn run() -> Result<(), String> {
    if std::env::args().nth(1).as_deref() == Some("--view") {
        return viewer::run();
    }
    let output = std::env::args().nth(1).ok_or("render/output-required")?;
    let mut json = String::new();
    std::io::stdin()
        .take(256 * 1024 * 1024)
        .read_to_string(&mut json)
        .map_err(|e| e.to_string())?;
    let mut req: Request =
        serde_json::from_str(&json).map_err(|e| format!("render/invalid-input:{e}"))?;
    let t = Instant::now();
    if let Some(file) = req.file.clone() {
        input::load(&file, &mut req)?;
    }
    let tessellate = ms(t);
    validate(&req)?;
    let mut meta = pollster::block_on(render(&req, &output))?;
    meta.timings_ms.tessellate = tessellate;
    println!("{}", serde_json::to_string(&meta).unwrap());
    Ok(())
}
fn validate(req: &Request) -> Result<(), String> {
    if req.views.is_empty()
        || req.views.len() > 16
        || req.atlas == 0
        || req.atlas > 16
        || req.resolution.iter().any(|n| *n < 16 || *n > 4096)
    {
        return Err("render/invalid-layout".into());
    }
    let width = req.resolution[0] * req.atlas;
    let height = req.resolution[1] * (req.views.len() as u32).div_ceil(req.atlas);
    if width > 8192 || height > 8192 {
        return Err("render/image-budget-exceeded".into());
    }
    if req.vertices.is_empty()
        || req.triangles.is_empty()
        || req
            .vertices
            .iter()
            .flatten()
            .chain(req.bounds.iter().flatten())
            .any(|v| !v.is_finite() || v.abs() > 1e30)
        || (0..3).any(|k| req.bounds[0][k] > req.bounds[1][k])
    {
        return Err("render/invalid-geometry".into());
    }
    if req
        .triangles
        .iter()
        .flatten()
        .chain(req.edges.iter().flatten())
        .any(|i| *i >= req.vertices.len())
        || req.edges.iter().any(|e| e.len() < 2)
    {
        return Err("render/invalid-index".into());
    }
    for p in &req.vertices {
        if (0..3).any(|k| p[k] < req.bounds[0][k] - 1e-6 || p[k] > req.bounds[1][k] + 1e-6) {
            return Err("render/bounds-do-not-enclose-mesh".into());
        }
    }
    Ok(())
}
async fn render(req: &Request, output: &str) -> Result<Metadata, String> {
    let initialize_start = Instant::now();
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::METAL | wgpu::Backends::VULKAN,
        ..Default::default()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions::default())
        .await
        .ok_or("render/no-headless-adapter")?;
    let adapter_name = adapter.get_info().name;
    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("wonky renderer"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::MemoryUsage,
            },
            None,
        )
        .await
        .map_err(|e| format!("render/device:{e}"))?;
    let mut timings = Timings {
        initialize: ms(initialize_start),
        ..Default::default()
    };
    let start = Instant::now();
    let cameras = req
        .views
        .iter()
        .map(|v| camera::camera(v, req.perspective, req.bounds, req.resolution))
        .collect::<Result<Vec<_>, _>>()?;
    let scene = scene::Scene::new(
        &device,
        req,
        &cameras.iter().map(|c| c.matrix).collect::<Vec<_>>(),
        wgpu::TextureFormat::Rgba8Unorm,
    );
    let width = req.resolution[0] * req.atlas;
    let height = req.resolution[1] * (req.views.len() as u32).div_ceil(req.atlas);
    let texture = |format, usage| {
        device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        })
    };
    let color = texture(
        wgpu::TextureFormat::Rgba8Unorm,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
    );
    let depth = texture(
        wgpu::TextureFormat::Depth32Float,
        wgpu::TextureUsages::RENDER_ATTACHMENT,
    );
    let color_view = color.create_view(&Default::default());
    let depth_view = depth.create_view(&Default::default());
    let stride = (width * 4).div_ceil(256) * 256;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: stride as u64 * height as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    timings.upload = ms(start);
    let start = Instant::now();
    let mut encoder = device.create_command_encoder(&Default::default());
    scene.draw(
        &mut encoder,
        &color_view,
        &depth_view,
        req.resolution,
        req.atlas,
    );
    queue.submit(Some(encoder.finish()));
    device.poll(wgpu::Maintain::Wait);
    timings.render = ms(start);
    let start = Instant::now();
    let mut copy = device.create_command_encoder(&Default::default());
    copy.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &color,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(stride),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(copy.finish()));
    let (send, recv) = std::sync::mpsc::channel();
    readback.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = send.send(r);
    });
    device.poll(wgpu::Maintain::Wait);
    recv.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("render/readback:{e}"))?;
    let mapped = readback.slice(..).get_mapped_range();
    let pixels: Vec<u8> = mapped
        .chunks(stride as usize)
        .flat_map(|row| row[..width as usize * 4].iter().copied())
        .collect();
    drop(mapped);
    readback.unmap();
    timings.readback = ms(start);
    let start = Instant::now();
    let silhouette = (0..req.views.len())
        .map(|i| {
            let mut bbox = [u32::MAX, u32::MAX, 0, 0];
            let mut any = false;
            for y in 0..req.resolution[1] {
                for x in 0..req.resolution[0] {
                    let ox = (i as u32 % req.atlas) * req.resolution[0] + x;
                    let oy = (i as u32 / req.atlas) * req.resolution[1] + y;
                    if pixels[((oy * width + ox) * 4 + 3) as usize] > 0 {
                        any = true;
                        bbox[0] = bbox[0].min(x);
                        bbox[1] = bbox[1].min(y);
                        bbox[2] = bbox[2].max(x + 1);
                        bbox[3] = bbox[3].max(y + 1);
                    }
                }
            }
            if any {
                Some(bbox)
            } else {
                None
            }
        })
        .collect();
    let file = std::fs::File::create(output).map_err(|e| e.to_string())?;
    let mut png = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    png.set_color(png::ColorType::Rgba);
    png.set_depth(png::BitDepth::Eight);
    let mut writer = png.write_header().map_err(|e| e.to_string())?;
    writer
        .write_image_data(&pixels)
        .map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    timings.encode = ms(start);
    Ok(Metadata {
        views: cameras,
        triangles: req.triangles.len(),
        edges: req.edges.len(),
        edge_segments: scene.line_count as usize / 2,
        width,
        height,
        silhouette_bounds_px: silhouette,
        timings_ms: timings,
        adapter: adapter_name,
    })
}

#[cfg(test)]
mod tests;
