// Shared GPU scene: PNG and interactive viewer draw the same surfaces and B-rep edges.
use crate::{Request, Vertex};
use wgpu::util::DeviceExt;
pub struct Scene {
    triangles: wgpu::Buffer,
    lines: wgpu::Buffer,
    triangle_count: u32,
    pub line_count: u32,
    uniforms: Vec<(wgpu::Buffer, wgpu::BindGroup)>,
    surface: wgpu::RenderPipeline,
    edge: wgpu::RenderPipeline,
}
impl Scene {
    pub fn new(
        device: &wgpu::Device,
        req: &Request,
        matrices: &[glam::Mat4],
        format: wgpu::TextureFormat,
    ) -> Self {
        let origin = glam::DVec3::from_array(std::array::from_fn(|k| {
            req.bounds[0][k] * 0.5 + req.bounds[1][k] * 0.5
        }));
        let mut triangles = Vec::with_capacity(req.triangles.len() * 3);
        for ids in &req.triangles {
            let p = ids.map(|i| glam::DVec3::from_array(req.vertices[i]));
            let n = (p[1] - p[0])
                .cross(p[2] - p[0])
                .normalize_or_zero()
                .as_vec3()
                .to_array();
            for v in p {
                triangles.push(Vertex {
                    position: (v - origin).as_vec3().to_array(),
                    normal: n,
                });
            }
        }
        let mut lines = Vec::new();
        for edge in &req.edges {
            for ids in edge.windows(2) {
                for i in ids {
                    lines.push(Vertex {
                        position: (glam::DVec3::from_array(req.vertices[*i]) - origin)
                            .as_vec3()
                            .to_array(),
                        normal: [0., 0., 1.],
                    });
                }
            }
        }
        let buffer = |label, data: &[Vertex]| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytemuck::cast_slice(data),
                usage: wgpu::BufferUsages::VERTEX,
            })
        };
        let tri_buffer = buffer("surfaces", &triangles);
        let line_buffer = buffer(
            "B-rep edges",
            if lines.is_empty() {
                &triangles[..1]
            } else {
                &lines
            },
        );
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let uniforms: Vec<_> = matrices
            .iter()
            .map(|c| {
                let b = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: None,
                    contents: bytemuck::cast_slice(&c.to_cols_array()),
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: b.as_entire_binding(),
                    }],
                });
                (b, group)
            })
            .collect();
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None,
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = |edge: bool| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: None,
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vertex"),
                    compilation_options: Default::default(),
                    buffers: &[wgpu::VertexBufferLayout {
                        array_stride: 24,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x3],
                    }],
                },
                primitive: wgpu::PrimitiveState {
                    topology: if edge {
                        wgpu::PrimitiveTopology::LineList
                    } else {
                        wgpu::PrimitiveTopology::TriangleList
                    },
                    cull_mode: if edge { None } else { Some(wgpu::Face::Back) },
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: !edge,
                    depth_compare: wgpu::CompareFunction::LessEqual,
                    stencil: Default::default(),
                    bias: if edge {
                        wgpu::DepthBiasState {
                            constant: -2,
                            slope_scale: -1.,
                            clamp: 0.,
                        }
                    } else {
                        Default::default()
                    },
                }),
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(if edge { "edge" } else { "surface" }),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview: None,
                cache: None,
            })
        };

        let surface = pipeline(false);
        let edge = pipeline(true);
        Self {
            triangles: tri_buffer,
            lines: line_buffer,
            triangle_count: triangles.len() as u32,
            line_count: lines.len() as u32,
            uniforms,
            surface,
            edge,
        }
    }
    pub fn camera(&self, queue: &wgpu::Queue, matrix: glam::Mat4) {
        queue.write_buffer(
            &self.uniforms[0].0,
            0,
            bytemuck::cast_slice(&matrix.to_cols_array()),
        );
    }
    pub fn draw(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        color: &wgpu::TextureView,
        depth: &wgpu::TextureView,
        size: [u32; 2],
        atlas: u32,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Wonky surfaces + exact B-rep feature edges"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: color,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.95,
                        g: 0.95,
                        b: 0.95,
                        a: 0.,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        for (i, (_, uniform)) in self.uniforms.iter().enumerate() {
            let x = (i as u32 % atlas) * size[0];
            let y = (i as u32 / atlas) * size[1];
            pass.set_viewport(x as f32, y as f32, size[0] as f32, size[1] as f32, 0., 1.);
            pass.set_scissor_rect(x, y, size[0], size[1]);
            pass.set_bind_group(0, uniform, &[]);
            pass.set_pipeline(&self.surface);
            pass.set_vertex_buffer(0, self.triangles.slice(..));
            pass.draw(0..self.triangle_count, 0..1);
            if self.line_count > 0 {
                pass.set_pipeline(&self.edge);
                pass.set_vertex_buffer(0, self.lines.slice(..));
                pass.draw(0..self.line_count, 0..1);
            }
        }
    }
}
