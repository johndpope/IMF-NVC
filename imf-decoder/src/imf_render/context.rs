use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use std::sync::Arc;
use wgpu::*;
use log::{info, error, debug};
use serde::{Serialize, Deserialize};
use wgpu::util::DeviceExt; // Add this import

pub struct RenderContext {
    pub device: Arc<Device>,
    pub queue: Arc<Queue>,
    pub pipeline: RenderPipeline,
    pub vertex_buffer: Buffer,
    pub staging_belt: wgpu::util::StagingBelt,
    pub format: TextureFormat,
    pub source_texture: Texture,
    pub source_texture_view: TextureView,
    pub output_texture: Texture,
    pub output_texture_view: TextureView,
    pub bind_group: BindGroup,
}

// Remove duplicate imports and update WebGPU imports
use wgpu::{
    Instance, InstanceDescriptor, Backends, SurfaceConfiguration,
    TextureUsages, PresentMode, Features, Limits,
    RequestAdapterOptions, PowerPreference, DeviceDescriptor
};

#[derive(Serialize, Deserialize, Debug)]
struct ReferenceFeature {
    tensor: Vec<f32>,
    shape: Vec<usize>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ReferenceData {
    features: Vec<ReferenceFeature>,
    token: Vec<f32>,
}

#[derive(Serialize, Deserialize)]
struct FrameToken {
    token: Vec<f32>,
    frame_index: usize,
}



#[derive(Serialize, Deserialize, Debug)]
struct BulkTokenResponse {
    tokens: std::collections::HashMap<usize, Vec<f32>>,
    metadata: TokenMetadata,
}

#[derive(Serialize, Deserialize, Debug)]
struct TokenMetadata {
    total_frames: usize,
    processed_frames: usize,
}


impl RenderContext {

    fn new(device: Arc<Device>, queue: Arc<Queue>, width: u32, height: u32) -> Self {
        let format = TextureFormat::Bgra8UnormSrgb;

        // Create vertex buffer layout
        let vertex_buffers = [VertexBufferLayout {
            array_stride: 16,
            step_mode: VertexStepMode::Vertex,
            attributes: &[
                VertexAttribute {
                    format: VertexFormat::Float32x2,
                    offset: 0,
                    shader_location: 0,
                },
                VertexAttribute {
                    format: VertexFormat::Float32x2,
                    offset: 8,
                    shader_location: 1,
                },
            ],
        }];

        // Create shader
        let shader = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("Shader"),
            source: ShaderSource::Wgsl(r#"
                struct VertexInput {
                    @location(0) position: vec2<f32>,
                    @location(1) tex_coords: vec2<f32>,
                };

                struct VertexOutput {
                    @builtin(position) clip_position: vec4<f32>,
                    @location(0) tex_coords: vec2<f32>,
                };

                @group(0) @binding(0) var t_diffuse: texture_2d<f32>;
                @group(0) @binding(1) var s_diffuse: sampler;

                @vertex
                fn vs_main(in: VertexInput) -> VertexOutput {
                    var out: VertexOutput;
                    out.tex_coords = in.tex_coords;
                    out.clip_position = vec4<f32>(in.position, 0.0, 1.0);
                    return out;
                }

                @fragment
                fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                    return textureSample(t_diffuse, s_diffuse, in.tex_coords);
                }
            "#.into()),
        });

        // Create sampler
        let sampler = device.create_sampler(&SamplerDescriptor {
            label: Some("Main Sampler"),
            address_mode_u: AddressMode::ClampToEdge,
            address_mode_v: AddressMode::ClampToEdge,
            address_mode_w: AddressMode::ClampToEdge,
            mag_filter: FilterMode::Linear,
            min_filter: FilterMode::Nearest,
            mipmap_filter: FilterMode::Nearest,
            ..Default::default()
        });

        // Create source texture
        let source_texture = device.create_texture(&TextureDescriptor {
            label: Some("Source Texture"),
            size: Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Create output texture
        let output_texture = device.create_texture(&TextureDescriptor {
            label: Some("Output Texture"),
            size: Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format,
            usage: TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });

        // Create texture views
        let source_texture_view = source_texture.create_view(&TextureViewDescriptor {
            label: Some("Source Texture View"),
            format: Some(format),
            dimension: Some(TextureViewDimension::D2),
            aspect: TextureAspect::All,
            base_mip_level: 0,
            mip_level_count: None,
            base_array_layer: 0,
            array_layer_count: None,
        });

        let output_texture_view = output_texture.create_view(&TextureViewDescriptor {
            label: Some("Output Texture View"),
            format: Some(format),
            dimension: Some(TextureViewDimension::D2),
            aspect: TextureAspect::All,
            base_mip_level: 0,
            mip_level_count: None,
            base_array_layer: 0,
            array_layer_count: None,
        });

        // Create bind group layout
        let bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Texture Bind Group Layout"),
            entries: &[
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        // Create bind group
        let bind_group = device.create_bind_group(&BindGroupDescriptor {
            label: Some("Texture Bind Group"),
            layout: &bind_group_layout,
            entries: &[
                BindGroupEntry {
                    binding: 0,
                    resource: BindingResource::TextureView(&source_texture_view),
                },
                BindGroupEntry {
                    binding: 1,
                    resource: BindingResource::Sampler(&sampler),
                },
            ],
        });

        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        // Create render pipeline
        let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
            label: Some("Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &vertex_buffers,
            },
            fragment: Some(FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(ColorTargetState {
                    format,
                    blend: Some(BlendState::REPLACE),
                    write_mask: ColorWrites::ALL,
                })],
            }),
            primitive: PrimitiveState {
                topology: PrimitiveTopology::TriangleStrip,
                strip_index_format: None,
                front_face: FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: MultisampleState::default(),
            multiview: None,
        });

        // Create vertex buffer
        let vertex_buffer_data = [
            -1.0f32, -1.0, 0.0, 1.0,
            1.0, -1.0, 1.0, 1.0,
            -1.0, 1.0, 0.0, 0.0,
            1.0, 1.0, 1.0, 0.0,
        ];

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Vertex Buffer"),
            contents: bytemuck::cast_slice(&vertex_buffer_data),
            usage: BufferUsages::VERTEX,
        });
        let staging_belt = wgpu::util::StagingBelt::new(1024);

        Self {
            device,
            queue,
            pipeline,
            vertex_buffer,
            staging_belt,
            format,
            source_texture,
            source_texture_view,
            output_texture,
            output_texture_view,
            bind_group,
        }
    }

   pub async fn create_from_canvas(canvas: HtmlCanvasElement, width: u32, height: u32) -> Result<Self, JsValue> {
        // Create instance
        let instance = Instance::new(InstanceDescriptor {
            backends: Backends::all(),
            dx12_shader_compiler: Default::default(),
        });
    
        // Create surface from canvas
        let surface = instance.create_surface_from_canvas(canvas)
            .map_err(|e| JsValue::from_str(&format!("Failed to create surface: {:?}", e)))?;
    
        // Request adapter
        let adapter = instance
            .request_adapter(&RequestAdapterOptions {
                power_preference: PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
            })
            .await
            .ok_or_else(|| JsValue::from_str("Failed to get WebGPU adapter"))?;
    
        web_sys::console::log_1(&"Adapter acquired".into());
        
        // Request device
        let (device, queue) = adapter
            .request_device(
                &DeviceDescriptor {
                    label: None,
                    features: Features::empty(),
                    limits: Limits::downlevel_webgl2_defaults()
                        .using_resolution(adapter.limits()),
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to create device: {:?}", e)))?;

        let device = Arc::new(device);
        let queue = Arc::new(queue);
        
        // Configure surface using device and adapter capabilities
        let surface_caps = surface.get_capabilities(&adapter);
        let format = surface_caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(surface_caps.formats[0]);
            
        // Configure surface
        let config = SurfaceConfiguration {
            usage: TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: PresentMode::Fifo,
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
        };
    
        surface.configure(&device, &config);
        
        // Create RenderContext using primary constructor
        Ok(Self::new(device.clone(), queue.clone(), width, height))
    }
    
    
}