// Native presentation only: geometry is supplied by the existing Rust B-rep path.
use crate::{camera, input, scene::Scene, validate, Request};
use glam::{Mat4, Quat, Vec3};
use serde::Deserialize;
use std::{io::BufRead, sync::Arc, time::Instant};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

#[derive(Deserialize)]
struct Update {
    revision: u64,
    #[serde(default)]
    request: Option<Request>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    elapsed_ms: f64,
}
enum Event {
    Update(Update),
    End,
    Error(String),
}
struct Navigation {
    rotation: Quat,
    pan: [f32; 2],
    zoom: f32,
}
impl Navigation {
    fn new() -> Self {
        let mut n = Self {
            rotation: Quat::IDENTITY,
            pan: [0.; 2],
            zoom: 1.,
        };
        n.preset("iso");
        n
    }
    fn preset(&mut self, name: &str) {
        let (direction, up) = match name {
            "front" => (Vec3::NEG_Y, Vec3::Z),
            "right" => (Vec3::X, Vec3::Z),
            "top" => (Vec3::Z, Vec3::Y),
            _ => (Vec3::new(1., -1., 1.).normalize(), Vec3::Z),
        };
        let right = (-direction).cross(up).normalize();
        let up = right.cross(-direction).normalize();
        self.rotation = Quat::from_mat3(&glam::Mat3::from_cols(right, up, direction));
        self.pan = [0.; 2];
        self.zoom = 1.;
    }
    fn orbit(&mut self, delta: [f32; 2]) {
        self.rotation = (Quat::from_rotation_z(-delta[0] * 0.008)
            * self.rotation
            * Quat::from_rotation_x(-delta[1] * 0.008))
        .normalize();
    }
    fn pan(&mut self, delta: [f32; 2], size: [u32; 2]) {
        self.pan[0] += 2. * delta[0] / size[0] as f32;
        self.pan[1] -= 2. * delta[1] / size[1] as f32;
    }
    fn zoom(&mut self, delta: f32) {
        self.zoom = (self.zoom * (delta * 0.1).exp()).clamp(0.01, 100.);
    }
    fn matrix(&self, bounds: [[f64; 3]; 2], size: [u32; 2]) -> Result<Mat4, String> {
        let c = camera::camera_direction(
            "orbit",
            false,
            bounds,
            size,
            self.rotation * Vec3::Z,
            self.rotation * Vec3::Y,
        )?;
        Ok(
            Mat4::from_translation(Vec3::new(self.pan[0], self.pan[1], 0.))
                * Mat4::from_scale(Vec3::new(self.zoom, self.zoom, 1.))
                * c.matrix,
        )
    }
}
struct Gpu {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    depth: wgpu::Texture,
}
impl Gpu {
    async fn new(window: Arc<Window>) -> Result<Self, String> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::METAL | wgpu::Backends::VULKAN,
            ..Default::default()
        });
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| format!("view/surface:{e}"))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            })
            .await
            .ok_or("view/no-adapter")?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Wonky native viewer"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::MemoryUsage,
                },
                None,
            )
            .await
            .map_err(|e| format!("view/device:{e}"))?;
        let size = window.inner_size();
        let config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .ok_or("view/surface-format")?;
        surface.configure(&device, &config);
        let depth = Self::depth(&device, &config);
        Ok(Self {
            surface,
            device,
            queue,
            config,
            depth,
        })
    }
    fn depth(device: &wgpu::Device, c: &wgpu::SurfaceConfiguration) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("viewer depth"),
            size: wgpu::Extent3d {
                width: c.width,
                height: c.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    }
    fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 {
            return;
        }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
        self.depth = Self::depth(&self.device, &self.config);
    }
}
struct App {
    initial_size: [u32; 2],
    window: Option<Arc<Window>>,
    gpu: Option<Gpu>,
    scene: Option<Scene>,
    bounds: [[f64; 3]; 2],
    navigation: Navigation,
    cursor: Option<[f32; 2]>,
    button: Option<MouseButton>,
    shift: bool,
    revision: u64,
    scene_revision: u64,
    display_label: &'static str,
    ready: Option<Update>,
    failure: Option<String>,
    frames: u32,
    frame_limit: Option<u32>,
    minimized: bool,
}
impl App {
    fn fail(&mut self, event_loop: &ActiveEventLoop, e: String) {
        eprintln!("{e}");
        self.failure = Some(e);
        event_loop.exit();
    }
    fn update(&mut self, mut update: Update) -> Result<(), String> {
        if update.revision < self.revision {
            return Ok(());
        }
        self.revision = update.revision;
        let Some(gpu) = &self.gpu else {
            self.ready = Some(update);
            return Ok(());
        };
        if let Some(mut req) = update.request.take() {
            let t = Instant::now();
            let is_stl = req
                .file
                .as_ref()
                .is_some_and(|p| p.to_lowercase().ends_with(".stl"));
            if let Some(file) = req.file.clone() {
                input::load(&file, &mut req)?;
            }
            validate(&req)?;
            // Preserve camera on reload. The scene is replaced only after full validation.
            if self.scene.is_none() {
                self.navigation.preset(&req.views[0]);
            }
            let matrix = self
                .navigation
                .matrix(req.bounds, [gpu.config.width, gpu.config.height])?;
            self.scene = Some(Scene::new(&gpu.device, &req, &[matrix], gpu.config.format));
            self.bounds = req.bounds;
            self.scene_revision = update.revision;
            self.display_label = if is_stl {
                "STL mesh · B-rep edges unavailable"
            } else {
                "B-rep display tolerance 0.02 mm"
            };
            update.elapsed_ms += t.elapsed().as_secs_f64() * 1000.;
            update.status = "ready".into();
        }
        if let Some(window) = &self.window {
            window.set_title(&format!("Wonky · r{} {} · showing r{} · {} · drag orbit / right-drag pan / scroll zoom · 1 front 2 right 3 top 4 iso",update.revision,update.status,self.scene_revision,self.display_label));
            window.request_redraw();
        }
        println!(
            "{}",
            serde_json::json!({"type":"status","revision":update.revision,"status":update.status,"elapsedMs":update.elapsed_ms})
        );
        Ok(())
    }
    fn draw(&mut self) -> Result<bool, String> {
        let (Some(gpu), Some(scene)) = (&mut self.gpu, &self.scene) else {
            return Ok(false);
        };
        let frame = match gpu.surface.get_current_texture() {
            Ok(f) => f,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                gpu.resize(gpu.config.width, gpu.config.height);
                return Ok(false);
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(false),
            Err(e) => return Err(format!("view/present:{e}")),
        };
        scene.camera(
            &gpu.queue,
            self.navigation
                .matrix(self.bounds, [gpu.config.width, gpu.config.height])?,
        );
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        scene.draw(
            &mut encoder,
            &frame.texture.create_view(&Default::default()),
            &gpu.depth.create_view(&Default::default()),
            [gpu.config.width, gpu.config.height],
            1,
        );
        gpu.queue.submit(Some(encoder.finish()));
        frame.present();
        self.frames += 1;
        if self.frame_limit.is_some_and(|n| self.frames < n) {
            if let Some(w) = &self.window {
                w.request_redraw();
            }
        }
        println!(
            "{}",
            serde_json::json!({"type":"frame","revision":self.scene_revision,"statusRevision":self.revision,"frame":self.frames,"width":gpu.config.width,"height":gpu.config.height,"scaleFactor":self.window.as_ref().map(|w|w.scale_factor()),"visible":self.window.as_ref().and_then(|w|w.is_visible())})
        );
        Ok(true)
    }
}
impl ApplicationHandler<Event> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = match event_loop.create_window(
            Window::default_attributes()
                .with_title("Wonky · building")
                .with_inner_size(winit::dpi::LogicalSize::new(
                    self.initial_size[0] as f64,
                    self.initial_size[1] as f64,
                )),
        ) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                self.fail(event_loop, format!("view/window:{e}"));
                return;
            }
        };
        match pollster::block_on(Gpu::new(window.clone())) {
            Ok(gpu) => {
                self.gpu = Some(gpu);
                self.window = Some(window);
            }
            Err(e) => {
                self.fail(event_loop, e);
                return;
            }
        }
        if let Some(update) = self.ready.take() {
            if let Err(e) = self.update(update) {
                self.fail(event_loop, e);
            }
        }
    }
    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: Event) {
        match event {
            Event::End => event_loop.exit(),
            Event::Error(e) => self.fail(event_loop, e),
            Event::Update(u) => {
                if let Err(e) = self.update(u) {
                    self.fail(event_loop, e)
                }
            }
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(s) => {
                self.minimized = s.width == 0 || s.height == 0;
                if let Some(g) = &mut self.gpu {
                    g.resize(s.width, s.height)
                }
            }
            WindowEvent::ModifiersChanged(m) => self.shift = m.state().shift_key(),
            WindowEvent::MouseInput { state, button, .. } => {
                self.button = if state == ElementState::Pressed {
                    Some(button)
                } else {
                    None
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let p = [position.x as f32, position.y as f32];
                if let Some(last) = self.cursor {
                    let delta = [p[0] - last[0], p[1] - last[1]];
                    if self.button == Some(MouseButton::Left) && !self.shift {
                        self.navigation.orbit(delta)
                    } else if self.button.is_some() {
                        if let Some(g) = &self.gpu {
                            self.navigation
                                .pan(delta, [g.config.width, g.config.height])
                        }
                    }
                }
                self.cursor = Some(p);
            }
            WindowEvent::CursorLeft { .. } => self.cursor = None,
            WindowEvent::MouseWheel { delta, .. } => self.navigation.zoom(match delta {
                MouseScrollDelta::LineDelta(_, y) => y,
                MouseScrollDelta::PixelDelta(p) => p.y as f32 / 40.,
            }),
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                if let PhysicalKey::Code(code) = event.physical_key {
                    match code {
                        KeyCode::Digit1 => self.navigation.preset("front"),
                        KeyCode::Digit2 => self.navigation.preset("right"),
                        KeyCode::Digit3 => self.navigation.preset("top"),
                        KeyCode::Digit4 | KeyCode::KeyF => self.navigation.preset("iso"),
                        KeyCode::Escape => event_loop.exit(),
                        _ => {}
                    }
                }
            }
            WindowEvent::RedrawRequested => {
                if !self.minimized {
                    match self.draw() {
                        Err(e) => self.fail(event_loop, e),
                        Ok(true) => {
                            if self.frame_limit.is_some_and(|n| self.frames >= n) {
                                event_loop.exit()
                            }
                        }
                        _ => {}
                    }
                }
                return;
            }
            _ => return,
        }
        if let Some(w) = &self.window {
            w.request_redraw();
        }
    }
}
pub fn run() -> Result<(), String> {
    let size = std::env::args().nth(2).unwrap_or_else(|| "960x720".into());
    let (width, height) = size.split_once('x').ok_or("view/invalid-window-size")?;
    let initial_size = [
        width
            .parse::<u32>()
            .map_err(|_| "view/invalid-window-size")?,
        height
            .parse::<u32>()
            .map_err(|_| "view/invalid-window-size")?,
    ];
    if initial_size.iter().any(|v| *v < 16 || *v > 4096) {
        return Err("view/invalid-window-size".into());
    }
    let mut builder = EventLoop::<Event>::with_user_event();
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Regular);
    }
    let event_loop = builder
        .build()
        .map_err(|e| format!("view/event-loop:{e}"))?;
    let proxy = event_loop.create_proxy();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let event = match line {
                Ok(s) => match serde_json::from_str::<Update>(&s) {
                    Ok(u) => Event::Update(u),
                    Err(e) => Event::Error(format!("view/invalid-update:{e}")),
                },
                Err(e) => Event::Error(format!("view/input:{e}")),
            };
            if proxy.send_event(event).is_err() {
                return;
            }
        }
        let _ = proxy.send_event(Event::End);
    });
    let mut app = App {
        initial_size,
        window: None,
        gpu: None,
        scene: None,
        bounds: [[0.; 3]; 2],
        navigation: Navigation::new(),
        cursor: None,
        button: None,
        shift: false,
        revision: 0,
        scene_revision: 0,
        display_label: "building",
        ready: None,
        failure: None,
        frames: 0,
        frame_limit: std::env::var("WONKY_VIEW_SMOKE_FRAMES")
            .ok()
            .and_then(|s| s.parse().ok()),
        minimized: false,
    };
    event_loop
        .run_app(&mut app)
        .map_err(|e| format!("view/event-loop:{e}"))?;
    if let Some(e) = app.failure {
        return Err(e);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_presets_orbit_pan_zoom() {
        let bounds = [[-10., -20., -5.], [10., 20., 5.]];
        let mut n = Navigation::new();
        for name in ["front", "right", "top", "iso"] {
            n.preset(name);
            let expected = camera::camera(name, false, bounds, [800, 600])
                .unwrap()
                .matrix;
            assert!(n
                .matrix(bounds, [800, 600])
                .unwrap()
                .abs_diff_eq(expected, 1e-5));
        }
        let initial = n.matrix(bounds, [800, 600]).unwrap();
        n.orbit([30., 20.]);
        assert!(!n
            .matrix(bounds, [800, 600])
            .unwrap()
            .abs_diff_eq(initial, 1e-5));
        n.pan([40., 30.], [800, 600]);
        assert_eq!(n.pan, [0.1, -0.1]);
        n.zoom(3.);
        assert!(n.zoom > 1.);
        for _ in 0..1000 {
            n.orbit([6., 3.]);
            n.zoom(-2.);
        }
        assert!(n.matrix(bounds, [1, 10000]).unwrap().is_finite());
        assert_eq!(n.zoom, 0.01);
    }
}
