    use wasm_bindgen::prelude::*;
    use web_sys::HtmlCanvasElement;
    use serde::{Serialize, Deserialize};
    use std::rc::Rc;
    use std::cell::RefCell;
    use wgpu::*;
    use std::cell::Cell;
    use log::{info, error, debug};
    use wgpu::util::DeviceExt;
    use web_sys::window;
    use wasm_bindgen::prelude::*;
    use wasm_bindgen::JsCast;
    use crate::decoder::{Frame, Queue as FrameQueue};
    use std::sync::{Arc, Mutex, Weak};
    use reqwest;
    use serde_json::Value;
    use wasm_bindgen_futures::spawn_local;
    use web_sys::console;
    use gloo_timers::future::TimeoutFuture;
    use crate::imf_render::RenderContext;

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


    #[wasm_bindgen]
    pub struct IMFDecoder {
        width: u32,
        height: u32,
        frame_queue: FrameQueue,
        canvas: Option<HtmlCanvasElement>,
        render_context: Option<RenderContext>,
        animation_id: Option<i32>,
        animation_closure: Option<Closure<dyn FnMut(f64)>>,
        is_running: Rc<Cell<bool>>,
        diagnostic_mode: bool,
        reference_data: Option<ReferenceData>,
        frame_count: u64,
        last_frame_time: f64,
        inner: Arc<Mutex<IMFDecoderInner>>,

    }
    impl Drop for IMFDecoder {
        fn drop(&mut self) {
            self.stop_player_loop();
            // Ensure WebGPU resources are properly cleaned up
            self.render_context = None;
        }
    }

    struct IMFDecoderInner {
        is_running: Rc<Cell<bool>>,
        width: u32,
        height: u32,
        frame_queue: FrameQueue,
    }
    

    // Helper struct to store animation state
    struct AnimationState {
        closure: Option<Closure<dyn FnMut(f64)>>,
        id: Option<i32>,
        last_frame_time: f64,
        frame_count: u64,
    }


    #[wasm_bindgen]
    impl IMFDecoder {

        
        #[wasm_bindgen(constructor)]
        pub fn new(width: u32, height: u32) -> Result<IMFDecoder, JsValue> {
            let _ = console_error_panic_hook::set_once();
            let _ = wasm_logger::init(wasm_logger::Config::default());
            
            const QUEUE_SIZE: usize = 60;
            const BATCH_SIZE: usize = 4;
            
            let inner = IMFDecoderInner {
                width,
                height,
                frame_queue: FrameQueue::new(QUEUE_SIZE, BATCH_SIZE),
                is_running: Rc::new(Cell::new(false)),
            };

            Ok(IMFDecoder {
                width,
                height,
                frame_queue: FrameQueue::new(QUEUE_SIZE, BATCH_SIZE),
                canvas: None,
                render_context: None,
                animation_id: None,
                reference_data: None,
                diagnostic_mode: false,
                frame_count: 0,
                last_frame_time: 0.0,
                animation_closure: None,
                is_running: Rc::new(Cell::new(false)),
                inner: Arc::new(Mutex::new(inner)),
            })
        }


        #[wasm_bindgen]
        pub async fn initialize_render_context(&mut self, canvas: HtmlCanvasElement) -> Result<String, JsValue> {
            self.canvas = Some(canvas.clone());
            
            match RenderContext::create_from_canvas(canvas, self.width, self.height).await {
                Ok(context) => {
                    self.render_context = Some(context);
                    Ok("WebGPU context initialized successfully".to_string())
                },
                Err(e) => Err(JsValue::from_str(&format!("Failed to initialize WebGPU context: {:?}", e)))
            }
        }


        pub async fn load_reference_data(&mut self, video_id: u32) -> Result<String, JsValue> {
            info!("Loading reference data for video {}", video_id);
            
            let client = reqwest::Client::new();
            let url = format!("https:/chat.covershot.ai/videos/{}/reference", video_id);
            
            match client.get(&url)
                .header("Accept", "application/json")
                .send()
                .await {
                    Ok(response) => {
                        if response.status().is_success() {
                            match response.json::<ReferenceData>().await {
                                Ok(ref_data) => {
                                    // Validate shapes
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

                                    self.reference_data = Some(ref_data);
                                    Ok("Reference data loaded successfully".to_string())
                                },
                                Err(e) => Err(JsValue::from_str(&format!("Failed to parse reference data: {}", e)))
                            }
                        } else {
                            Err(JsValue::from_str(&format!("Failed to fetch reference data: {}", response.status())))
                        }
                    },
                    Err(e) => Err(JsValue::from_str(&format!("Network error: {}", e)))
                }
        }

        // Add method to fetch bulk tokens
        pub async fn fetch_bulk_tokens(&mut self, video_id: u32, start_frame: usize, end_frame: usize) 
            -> Result<String, JsValue> {
            info!("Fetching bulk tokens for video {} (frames {}-{})", video_id, start_frame, end_frame);
            
            let client = reqwest::Client::new();
            let url = format!(
                "https://chat.covershot.ai/videos/{}/tokens?start={}&end={}", 
                video_id, start_frame, end_frame
            );
            
            match client.get(&url)
                .header("Accept", "application/json")
                .send()
                .await {
                    Ok(response) => {
                        if response.status().is_success() {
                            match response.json::<BulkTokenResponse>().await {
                                Ok(token_data) => {
                                    // Convert tokens to frames and add to queue
                                    for (frame_index, token) in token_data.tokens {
                                        let mut frame = Frame::new(self.width as usize, self.height as usize);
                                        let frame_data: Vec<u8> = token.iter().map(|&x| x as u8).collect();
                                        frame.set_data(frame_data);
                                        self.frame_queue.push(frame);
                                    }

                                    Ok(format!(
                                        "Processed {} frames ({}/{})", 
                                        token_data.tokens.len(),
                                        token_data.metadata.processed_frames,
                                        token_data.metadata.total_frames
                                    ))
                                },
                                Err(e) => Err(JsValue::from_str(&format!("Failed to parse token data: {}", e)))
                            }
                        } else {
                            Err(JsValue::from_str(&format!("Failed to fetch tokens: {}", response.status())))
                        }
                    },
                    Err(e) => Err(JsValue::from_str(&format!("Network error: {}", e)))
                }
        }

        
        pub fn process_tokens(&mut self, tokens: JsValue) -> Result<String, JsValue> {
            info!("Starting token processing...");
            
            let token_data: BulkTokenResponse = serde_wasm_bindgen::from_value(tokens)?;
            let token_count = token_data.tokens.len();
        
            info!("Processing {} tokens", token_count);
            
            // Store len before moving tokens
            let total_frames = token_count;
            
            // Iterate over references to avoid moving ownership
            for (&frame_idx, token) in token_data.tokens.iter() {
                info!("Processing token with frame index {}", frame_idx);
                let mut frame = Frame::new(self.width as usize, self.height as usize);
                let frame_data: Vec<u8> = token.iter().map(|&x| x as u8).collect();
                frame.set_data(frame_data);
                self.frame_queue.push(frame);
            }
            
            Ok(format!("Successfully processed {} tokens", total_frames))
        }
    
    
        // Fixed background token fetching with proper ownership
        pub async fn start_background_token_fetching(&mut self, video_id: u32, start_frame: usize) {
            let is_running = self.is_running.clone();
            let decoder = self.clone(); // Implement Clone for IMFDecoder
            
            spawn_local(async move {
                let chunk_size = 100;
                let mut current_start = start_frame;
                
                while is_running.get() {
                    match decoder.fetch_bulk_tokens(video_id, current_start, current_start + chunk_size - 1).await {
                        Ok(_) => {
                            current_start += chunk_size;
                            TimeoutFuture::new(1000).await;
                        },
                        Err(e) => {
                            console::error_1(&format!("Background token fetching error: {:?}", e).into());
                            break;
                        }
                    }
                }
            });
        }

        async fn background_token_fetch_loop(
            decoder: Arc<Mutex<IMFDecoderInner>>,
            video_id: u32,
            mut start_frame: usize,
        ) {
            let chunk_size = 100;
            
            while {
                let is_running = decoder.lock().unwrap().is_running.get();
                is_running
            } {
                let result = {
                    let mut decoder = decoder.lock().unwrap();
                    decoder.fetch_bulk_tokens(video_id, start_frame, start_frame + chunk_size - 1).await
                };
    
                match result {
                    Ok(_) => {
                        start_frame += chunk_size;
                        TimeoutFuture::new(1000).await;
                    },
                    Err(e) => {
                        console::error_1(&format!("Background token fetching error: {:?}", e).into());
                        break;
                    }
                }
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
        pub async fn start_playback(&mut self, video_id: u32) -> Result<(), JsValue> {
            info!("Starting playback for video {}", video_id);

            // Load reference data first
            self.load_reference_data(video_id).await?;

            // Prefetch initial frames
            let prefetch_size = (self.frame_queue.get_max_size() as f32 * 1.5) as usize;
            self.fetch_bulk_tokens(video_id, 0, prefetch_size - 1).await?;

            // Start background fetching
            self.start_background_token_fetching(video_id, prefetch_size);

            // Start player loop
            self.start_player_loop()?;

            Ok(())
        }

        #[wasm_bindgen]
        pub fn start_player_loop(&mut self) -> Result<(), JsValue> {
            if self.is_running.get() {
                return Ok(());
            }

            self.is_running.set(true);
            let is_running = self.is_running.clone();
            
            // Create decoder pointer
            let decoder_ptr = self as *mut IMFDecoder;

            // Create and store the closure directly
            let closure = Closure::new(move |timestamp: f64| {
                if !is_running.get() {
                    return;
                }

                // Process frame
                let decoder = unsafe { &mut *decoder_ptr };
                decoder.animation_frame_callback(timestamp);

                // Schedule next frame
                if is_running.get() {
                    if let Some(window) = web_sys::window() {
                        if let Some(animation_id) = decoder.animation_id {
                            let _ = window.request_animation_frame(
                                decoder.animation_closure.as_ref().unwrap().as_ref().unchecked_ref()
                            );
                        }
                    }
                }
            });

            // Start animation loop
            if let Some(window) = web_sys::window() {
                let id = window.request_animation_frame(
                    closure.as_ref().unchecked_ref()
                )?;
                
                self.animation_id = Some(id);
                // Store the closure directly without cloning
                self.animation_closure = Some(closure);
            }

            Ok(())
        }


        fn animation_frame_callback(&mut self, timestamp: f64) {
            let delta = timestamp - self.last_frame_time;
            
            if delta >= 16.666 {  // Target ~60 FPS
                self.last_frame_time = timestamp;
                
                if let Err(e) = self.render_frame() {
                    error!("Render error: {:?}", e);
                } else {
                    self.frame_count += 1;
                }
                
                if self.diagnostic_mode {
                    self.update_metrics();
                }
            }
        }

        #[wasm_bindgen]
        pub fn stop_player_loop(&mut self) {
            debug!("Stopping player loop");
            
            // Set running flag to false first
            self.is_running.set(false);
            
            // Cancel animation frame
            if let Some(id) = self.animation_id.take() {
                if let Some(window) = web_sys::window() {
                    let _ = window.cancel_animation_frame(id);
                    debug!("Cancelled animation frame {}", id);
                }
            }
            
            // Clean up closure
            self.animation_closure = None;
            
            info!("Player loop stopped successfully");
        }

        fn render_frame(&mut self) -> Result<(), JsValue> {
            let context = self.render_context.as_ref()
                .ok_or_else(|| JsValue::from_str("Render context not initialized"))?;

            // Get frame data
            let frame = if let Some(frame) = self.frame_queue.process_next() {
                frame
            } else {
                // Create a dummy frame if no frame is available
                let dummy_data = vec![0u8; (self.width * self.height * 4) as usize];
                let mut frame = Frame::new(self.width as usize, self.height as usize);
                frame.set_data(dummy_data);
                frame
            };

            // Write to source texture
            context.queue.write_texture(
                ImageCopyTexture {
                    texture: &context.source_texture,
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

            // Create command encoder
            let mut encoder = context.device.create_command_encoder(&CommandEncoderDescriptor {
                label: Some("Render Encoder"),
            });

            // Record render pass
            {
                let mut render_pass = encoder.begin_render_pass(&RenderPassDescriptor {
                    label: Some("Main Render Pass"),
                    color_attachments: &[Some(RenderPassColorAttachment {
                        view: &context.output_texture_view,
                        resolve_target: None,
                        ops: Operations {
                            load: LoadOp::Clear(Color::BLACK),
                            store: true,
                        },
                    })],
                    depth_stencil_attachment: None,
                });

                render_pass.set_pipeline(&context.pipeline);
                render_pass.set_bind_group(0, &context.bind_group, &[]);
                render_pass.set_vertex_buffer(0, context.vertex_buffer.slice(..));
                render_pass.draw(0..4, 0..1);
            }

            // Submit commands
            context.queue.submit(std::iter::once(encoder.finish()));
            Ok(())
        }


        fn update_metrics(&mut self) {
            if let Some(window) = web_sys::window() {
                if let Some(_performance) = window.performance() {  // Fixed unused variable warning
                    let now = _performance.now();
                    let frame_time = now - self.last_frame_time;
                    self.last_frame_time = now;

                    let fps = 1000.0 / frame_time;
                    let (input_size, processing_size, output_size) = self.frame_queue.get_queue_sizes();
                    
                    debug!("Performance metrics:");
                    debug!("  - Frame time: {:.2}ms", frame_time);
                    debug!("  - FPS: {:.2}", fps);
                    debug!("  - Queue sizes - Input: {}, Processing: {}, Output: {}", 
                        input_size, processing_size, output_size);
                    
                    if self.frame_count % 60 == 0 {
                        info!("Performance report:");
                        info!("  - Average FPS: {:.2}", fps);
                        info!("  - Frame time: {:.2}ms", frame_time);
                        info!("  - Frames processed: {}", self.frame_count);
                        info!("  - Queue utilization: {}/{}", 
                            input_size + processing_size + output_size,
                            self.frame_queue.get_max_size());
                    }
                }
            }
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


    impl Clone for IMFDecoder {
        fn clone(&self) -> Self {
            Self {
                width: self.width,
                height: self.height,
                frame_queue: self.frame_queue.clone(), // Implement Clone for FrameQueue
                canvas: self.canvas.clone(),
                render_context: None, // Don't clone render context
                animation_id: None,
                animation_closure: None,
                is_running: self.is_running.clone(),
                diagnostic_mode: self.diagnostic_mode,
                reference_data: self.reference_data.clone(),
                frame_count: self.frame_count,
                last_frame_time: self.last_frame_time,
            }
        }
    }