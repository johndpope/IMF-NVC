use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wasm_bindgen::JsCast;
use serde::{Serialize, Deserialize};
use std::sync::Arc;
use std::rc::Rc;
use std::cell::RefCell;
use wgpu::*;
use log::{info, error};
use wgpu::util::DeviceExt;
use crate::decoder::{Frame, Queue as FrameQueue};
// Remove duplicate imports and update WebGPU imports
use wgpu::{
    Instance, InstanceDescriptor, Backends, SurfaceConfiguration,
    TextureUsages, PresentMode, CompositeAlphaMode, Features, Limits,
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

struct RenderContext {
    device: Arc<Device>,
    queue: Arc<Queue>,
    pipeline: RenderPipeline,
    vertex_buffer: Buffer,
    staging_belt: wgpu::util::StagingBelt,
    format: TextureFormat,
    texture: Texture,
    texture_view: TextureView,
}

impl RenderContext {
    async fn new_from_canvas(
        canvas: HtmlCanvasElement,
        width: u32,
        height: u32,
    ) -> Result<Self, JsValue> {
        // Create instance
        let instance = Instance::new(InstanceDescriptor {
            backends: Backends::all(),
            dx12_shader_compiler: Default::default(),
        });
    
        // Create surface from canvas
        let surface = instance
            .create_surface_from_canvas(canvas)
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
    
        // Log adapter features and limits
        web_sys::console::log_1(&"Adapter acquired".into());
        web_sys::console::log_1(&format!("Adapter Features: {:?}", adapter.features()).into());
        web_sys::console::log_1(&format!("Adapter Limits: {:?}", adapter.limits()).into());
    
        // Use minimal features and limits suitable for WebGL2 compatibility
        let required_features = Features::empty();
        let required_limits = Limits::downlevel_webgl2_defaults();
    
        // Clamp the limits to what the adapter supports
        let limits = required_limits.using_resolution(adapter.limits());
    
        // Log requested features and limits
        web_sys::console::log_1(&format!("Requested Features: {:?}", required_features).into());
        web_sys::console::log_1(&format!("Requested Limits: {:?}", limits).into());
    
        // Request device with adjusted limits
        let (device, queue) = adapter
            .request_device(
                &DeviceDescriptor {
                    label: None,
                    features: required_features,
                    limits,
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to create device: {:?}", e)))?;

        let device = Arc::new(device);
        let queue = Arc::new(queue);
        
        // Surface configuration
        let surface_caps = surface.get_capabilities(&adapter);
        let format = surface_caps.formats[0];
    
        let surface_config = SurfaceConfiguration {
            usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC,
            format,
            width,
            height,
            present_mode: PresentMode::Fifo,
            alpha_mode: CompositeAlphaMode::Auto,
            view_formats: vec![],
        };
    
        surface.configure(&device, &surface_config);
    
        // Create and return the render context
        Ok(Self::new(device.clone(), queue.clone(), width, height))
    }
    
    fn new(device: Arc<Device>, queue: Arc<Queue>, width: u32, height: u32) -> Self {
        let format = TextureFormat::Bgra8UnormSrgb;

        let shader = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("Shader"),
            source: ShaderSource::Wgsl(include_str!("../../shaders/shader.wgsl").into()),
        });

        let texture = device.create_texture(&TextureDescriptor {
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
            usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let texture_view = texture.create_view(&TextureViewDescriptor::default());

        let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("Pipeline Layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
            label: Some("Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[],
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
            primitive: PrimitiveState::default(),
            depth_stencil: None,
            multisample: MultisampleState::default(),
            multiview: None,
        });

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Vertex Buffer"),
            contents: bytemuck::cast_slice(&[-1.0f32, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]),
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
            texture,
            texture_view,
        }
    }
}


#[wasm_bindgen]
pub struct IMFDecoder {
    width: u32,
    height: u32,
    frame_queue: FrameQueue,
    canvas: Option<HtmlCanvasElement>,
    render_context: Option<RenderContext>,
    animation_id: Option<i32>,
    reference_data: Option<ReferenceData>,
    diagnostic_mode: bool,
    frame_count: u64,
    last_frame_time: f64,
    animation_closure: Option<Closure<dyn FnMut()>>,
}

#[wasm_bindgen]
impl IMFDecoder {

    
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<IMFDecoder, JsValue> {
        console_error_panic_hook::set_once();
        wasm_logger::init(wasm_logger::Config::default());
        info!("Creating IMFDecoder with dimensions {}x{}", width, height);

        Ok(Self {
            width,
            height,
            frame_queue: FrameQueue::new(60, 4),
            canvas: None,
            render_context: None,
            animation_id: None,
            reference_data: None,
            diagnostic_mode: false,
            frame_count: 0,
            last_frame_time: 0.0,
            animation_closure: None,
        })
    }


    #[wasm_bindgen]
    pub async fn initialize_render_context(&mut self, canvas: HtmlCanvasElement) -> Result<String, JsValue> {
        self.canvas = Some(canvas.clone());
        
        match RenderContext::new_from_canvas(canvas, self.width, self.height).await {
            Ok(context) => {
                self.render_context = Some(context);
                Ok("WebGPU context initialized successfully".to_string())
            },
            Err(e) => Err(JsValue::from_str(&format!("Failed to initialize WebGPU context: {:?}", e)))
        }
    }

    #[wasm_bindgen]
    pub fn get_capabilities(&self) -> JsValue {
        let capabilities = js_sys::Object::new();
        
        js_sys::Reflect::set(
            &capabilities,
            &"version".into(),
            &"1.0.0".into()
        ).unwrap();

        js_sys::Reflect::set(
            &capabilities,
            &"dimensions".into(),
            &format!("{}x{}", self.width, self.height).into()
        ).unwrap();

        // Create features array
        let features = js_sys::Array::new();
        features.push(&"WebGPU".into());
        features.push(&"Tensor Processing".into());
        features.push(&"Frame Queue".into());

        js_sys::Reflect::set(
            &capabilities,
            &"features".into(),
            &features
        ).unwrap();

        // Create methods array
        let methods = js_sys::Array::new();
        methods.push(&"test".into());
        methods.push(&"start_player_loop".into());
        methods.push(&"stop_player_loop".into());
        methods.push(&"set_reference_data".into());
        methods.push(&"process_tokens".into());
        methods.push(&"process_batch".into());

        js_sys::Reflect::set(
            &capabilities,
            &"methods".into(),
            &methods
        ).unwrap();

        // Add performance capabilities
        let performance = js_sys::Object::new();
        js_sys::Reflect::set(
            &performance,
            &"maxQueueSize".into(),
            &(60_i32).into()
        ).unwrap();
        js_sys::Reflect::set(
            &performance,
            &"batchSize".into(),
            &(4_i32).into()
        ).unwrap();
        js_sys::Reflect::set(
            &performance,
            &"targetFPS".into(),
            &(60_i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &capabilities,
            &"performance".into(),
            &performance
        ).unwrap();

        // Add diagnostic info
        let diagnostics = js_sys::Object::new();
        js_sys::Reflect::set(
            &diagnostics,
            &"frameCounter".into(),
            &(self.frame_count as i32).into()
        ).unwrap();
        js_sys::Reflect::set(
            &diagnostics,
            &"diagnosticMode".into(),
            &self.diagnostic_mode.into()
        ).unwrap();

        js_sys::Reflect::set(
            &capabilities,
            &"diagnostics".into(),
            &diagnostics
        ).unwrap();

        capabilities.into()
    }

    #[wasm_bindgen]
    pub fn test(&self) -> String {
        let msg = format!("IMFDecoder working! Size: {}x{}", self.width, self.height);
        info!("{}", msg);
        msg
    }

    #[wasm_bindgen]
    pub fn get_status(&self) -> JsValue {
        let status = js_sys::Object::new();

        // Basic status
        js_sys::Reflect::set(
            &status,
            &"initialized".into(),
            &self.render_context.is_some().into()
        ).unwrap();

        js_sys::Reflect::set(
            &status,
            &"running".into(),
            &self.animation_id.is_some().into()
        ).unwrap();

        // Performance metrics
        let metrics = js_sys::Object::new();
        js_sys::Reflect::set(
            &metrics,
            &"frameCount".into(),
            &(self.frame_count as i32).into()
        ).unwrap();
        
        if let Some(window) = web_sys::window() {
            if let Some(perf) = window.performance() {
                js_sys::Reflect::set(
                    &metrics,
                    &"lastFrameTime".into(),
                    &self.last_frame_time.into()
                ).unwrap();
            }
        }

        js_sys::Reflect::set(&status, &"metrics".into(), &metrics).unwrap();

        // Queue status using correct method names
        let queue_status = js_sys::Object::new();
        let (input_size, processing_size, output_size) = self.frame_queue.get_queue_sizes();
        
        js_sys::Reflect::set(
            &queue_status,
            &"inputQueueSize".into(),
            &(input_size as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"processingQueueSize".into(),
            &(processing_size as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"outputQueueSize".into(),
            &(output_size as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"maxSize".into(),
            &(self.frame_queue.get_max_size() as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"batchSize".into(),
            &(self.frame_queue.get_batch_size() as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"isFull".into(),
            &self.frame_queue.is_full().into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"isEmpty".into(),
            &self.frame_queue.is_empty().into()
        ).unwrap();

        // Add additional metrics
        js_sys::Reflect::set(
            &queue_status,
            &"framesProcessed".into(),
            &(self.frame_queue.get_frames_processed() as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"framesDropped".into(),
            &(self.frame_queue.get_frames_dropped() as i32).into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"processingTime".into(),
            &self.frame_queue.get_processing_time().into()
        ).unwrap();

        // Add queue stats
        let stats = self.frame_queue.get_metrics();
        let queue_metrics = js_sys::Object::new();
        
        js_sys::Reflect::set(
            &queue_metrics,
            &"averageProcessingTime".into(),
            &stats.average_processing_time.into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_metrics,
            &"queueUtilization".into(),
            &stats.queue_utilization.into()
        ).unwrap();

        js_sys::Reflect::set(
            &queue_status,
            &"metrics".into(),
            &queue_metrics
        ).unwrap();

        js_sys::Reflect::set(&status, &"queue".into(), &queue_status).unwrap();

        // Debug info
        let debug = js_sys::Object::new();
        js_sys::Reflect::set(
            &debug,
            &"diagnosticMode".into(),
            &self.diagnostic_mode.into()
        ).unwrap();

        js_sys::Reflect::set(&status, &"debug".into(), &debug).unwrap();

        status.into()
    }

    #[wasm_bindgen]
    pub fn start_player_loop(&mut self) -> Result<(), JsValue> {
        // Create a shared reference to self
        let decoder = Rc::new(RefCell::new(self as *mut IMFDecoder));
        let decoder_clone = decoder.clone();

        // Create the animation frame closure
        let closure = Closure::wrap(Box::new(move || {
            let decoder = unsafe { &mut *decoder_clone.borrow().clone() };
            
            if let Err(e) = decoder.render_frame() {
                error!("Render error: {:?}", e);
            }

            // Request next frame
            if let Some(window) = web_sys::window() {
                if let Ok(id) = window.request_animation_frame(
                    decoder.animation_closure.as_ref().unwrap().as_ref().unchecked_ref()
                ) {
                    decoder.animation_id = Some(id);
                }
            }
            
            decoder.frame_count += 1;
        }) as Box<dyn FnMut()>);

        // Start the animation loop
        let window = web_sys::window()
            .ok_or_else(|| JsValue::from_str("No window found"))?;

        let id = window.request_animation_frame(closure.as_ref().unchecked_ref())?;
        
        self.animation_id = Some(id);
        self.animation_closure = Some(closure);

        Ok(())
    }

    fn render_frame(&mut self) -> Result<(), JsValue> {
        let context = self.render_context.as_ref()
            .ok_or_else(|| JsValue::from_str("Render context not initialized"))?;

        if let Some(frame) = self.frame_queue.process_next() {
            // Create command encoder
            let mut encoder = context.device.create_command_encoder(&CommandEncoderDescriptor {
                label: Some("Render Encoder"),
            });

            // Update texture with frame data
            context.queue.write_texture(
                ImageCopyTexture {
                    texture: &context.texture,
                    mip_level: 0,
                    origin: Origin3d::ZERO,
                    aspect: TextureAspect::All,
                },
                &frame.data,
                ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(self.width * 4),
                    rows_per_image: Some(self.height),
                },
                Extent3d {
                    width: self.width,
                    height: self.height,
                    depth_or_array_layers: 1,
                },
            );

            // Render pass
            {
                let mut render_pass = encoder.begin_render_pass(&RenderPassDescriptor {
                    label: Some("Main Render Pass"),
                    color_attachments: &[Some(RenderPassColorAttachment {
                        view: &context.texture_view,
                        resolve_target: None,
                        ops: Operations {
                            load: LoadOp::Clear(Color::BLACK),
                            store: true,
                        },
                    })],
                    depth_stencil_attachment: None,
                });

                render_pass.set_pipeline(&context.pipeline);
                render_pass.set_vertex_buffer(0, context.vertex_buffer.slice(..));
                render_pass.draw(0..4, 0..1);
            }

            // Submit commands
            context.queue.submit(std::iter::once(encoder.finish()));

            if self.diagnostic_mode {
                self.update_metrics();
            }
        }

        Ok(())
    }

    fn update_metrics(&mut self) {
        if let Some(window) = web_sys::window() {
            if let Some(performance) = window.performance() {
                let now = performance.now();
                let frame_time = now - self.last_frame_time;
                self.last_frame_time = now;

                let fps = 1000.0 / frame_time;
                info!("Frame {}: {:.2} FPS (frame time: {:.2}ms)", 
                    self.frame_count, fps, frame_time);
            }
        }
    }
    
    #[wasm_bindgen]
    pub fn stop_player_loop(&mut self) {
        if let Some(id) = self.animation_id.take() {
            if let Some(window) = web_sys::window() {
                let _ = window.cancel_animation_frame(id);
            }
        }
        self.animation_closure = None;
        info!("Player loop stopped");
    }


    #[wasm_bindgen(getter)]
    pub fn diagnostic_mode(&self) -> bool {
        self.diagnostic_mode
    }

    #[wasm_bindgen(setter)]
    pub fn set_diagnostic_mode(&mut self, value: bool) {
        self.diagnostic_mode = value;
        info!("Diagnostic mode set to: {}", value);
    }

    #[wasm_bindgen]
    pub fn set_reference_data(&mut self, data: JsValue) -> Result<String, JsValue> {
        info!("Setting reference data...");
        
        let ref_data: ReferenceData = serde_wasm_bindgen::from_value(data)?;
        
        let expected_shapes = vec![
            vec![1, 128, 64, 64],
            vec![1, 256, 32, 32],
            vec![1, 512, 16, 16],
            vec![1, 512, 8, 8],
        ];

        for (feature, expected) in ref_data.features.iter().zip(expected_shapes.iter()) {
            if feature.shape != *expected {
                return Err(JsValue::from_str(&format!(
                    "Invalid tensor shape: {:?}, expected: {:?}", 
                    feature.shape, expected
                )));
            }
        }

        if ref_data.token.len() != 32 {
            return Err(JsValue::from_str("Reference token must be length 32"));
        }

        self.reference_data = Some(ref_data);
        Ok("Reference data set successfully".to_string())
    }

    #[wasm_bindgen]
    pub fn process_tokens(&mut self, tokens: JsValue) -> Result<String, JsValue> {
        info!("Processing tokens...");
        
        let frame_tokens: Vec<FrameToken> = serde_wasm_bindgen::from_value(tokens)?;
        let token_count = frame_tokens.len();
        
        for token in frame_tokens {
            let mut frame = Frame::new(self.width as usize, self.height as usize);
            frame.set_data(token.token.iter().map(|&x| x as u8).collect());
            self.frame_queue.push(frame);
        }
        
        Ok(format!("Processed {} tokens successfully", token_count))
    }

    #[wasm_bindgen]
    pub fn process_batch(&mut self) -> Result<String, JsValue> {
        info!("Processing batch...");
        let processed = self.frame_queue.process_batch();
        Ok(format!("Processed batch: {} frames", processed.len()))
    }

    #[wasm_bindgen]
    pub fn get_reference_status(&self) -> String {
        match &self.reference_data {
            Some(ref_data) => format!(
                "Reference data loaded: {} features",
                ref_data.features.len()
            ),
            None => "No reference data loaded".to_string(),
        }
    }
}

impl Drop for IMFDecoder {
    fn drop(&mut self) {
        self.stop_player_loop();
    }
}

// Helper struct for passing tensor data between Rust and JavaScript
#[derive(Serialize, Deserialize)]
struct TensorData {
    data: Vec<f32>,
    shape: Vec<usize>,
}

// JavaScript bindings for IMF operations
#[wasm_bindgen]
extern "C" {
    // Define JavaScript functions that will be called from Rust
    #[wasm_bindgen(js_namespace = tf, js_name = tensor)]
    fn create_tensor(data: &[f32], shape: &[usize]) -> JsValue;

    #[wasm_bindgen(js_namespace = tf, js_name = tidy)]
    fn tensor_tidy(callback: &Closure<dyn FnMut() -> JsValue>) -> JsValue;
}