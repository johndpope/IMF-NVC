use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, CanvasRenderingContext2d, ImageData};
use wasm_bindgen::JsCast;
use serde::{Serialize, Deserialize};
use log::{info, error, debug};
use wasm_bindgen::Clamped;
use crate::decoder::{Frame, Queue as FrameQueue};
use std::cell::RefCell;
use std::rc::Rc;
// use web_sys::window;
use wasm_bindgen::JsValue;


// Add this type alias to make the closure type more readable
type AnimationCallback = Rc<RefCell<Option<Closure<dyn FnMut()>>>>;

#[wasm_bindgen]
pub struct IMFDecoder {
    width: u32,
    height: u32,
    frame_queue: FrameQueue,
    canvas: Option<HtmlCanvasElement>,
    context: Option<CanvasRenderingContext2d>,
    animation_id: RefCell<Option<i32>>,  // Changed to RefCell
    reference_data: Option<ReferenceData>,
    diagnostic_mode: bool,
    debug_mode: bool,
    frame_count: RefCell<u64>,
    last_frame_time: RefCell<f64>,
    max_frames: u64, 
    is_playing: RefCell<bool>,  // Added missing field


}

struct AnimationFrame {
    closure: Closure<dyn FnMut()>,
    id: i32,
}
impl Drop for AnimationFrame {
    fn drop(&mut self) {
        if let Some(window) = web_sys::window() {
            let _ = window.cancel_animation_frame(self.id);
        }
    }
}


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

#[wasm_bindgen]
impl IMFDecoder {

    
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<IMFDecoder, JsValue> {
        let _ = console_error_panic_hook::set_once();
        let _ = wasm_logger::init(wasm_logger::Config::default());
        
        info!("Creating IMFDecoder with dimensions {}x{}", width, height);

        Ok(Self {
            width,
            height,
            frame_queue: FrameQueue::new(10000, 4),
            canvas: None,
            context: None,
            animation_id: RefCell::new(None),
            reference_data: None,
            diagnostic_mode: false,
            debug_mode: false,
            frame_count: RefCell::new(0),
            last_frame_time: RefCell::new(0.0),
            max_frames: 300,
            is_playing: RefCell::new(false),  // Initialize is_playing

        })
    }

    #[wasm_bindgen(getter)]
    pub fn debug_mode(&self) -> bool {
        self.debug_mode
    }

    #[wasm_bindgen(setter)]
    pub fn set_debug_mode(&mut self, value: bool) {
        self.debug_mode = value;
        info!("Debug mode set to: {}", value);
    }

    // Method to check debug status - useful for verification
    #[wasm_bindgen]
    pub fn is_debug_mode(&self) -> bool {
        self.debug_mode
    }

    #[wasm_bindgen]
    pub fn enable_debug_mode(&mut self) {
        self.debug_mode = true;
        info!("Debug mode enabled");
    }

    #[wasm_bindgen]
    pub fn disable_debug_mode(&mut self) {
        self.debug_mode = false;
        info!("Debug mode disabled");
    }
 
    pub fn start_player_loop(&mut self) -> Result<(), JsValue> {
        if !*self.is_playing.borrow() {
            *self.is_playing.borrow_mut() = true;
            self.schedule_next_frame()?;
        }
        Ok(())
    }
    
    fn schedule_next_frame(&self) -> Result<(), JsValue> {
        if *self.is_playing.borrow() {
            if let Some(window) = web_sys::window() {
                let this = self as *const IMFDecoder;
                
                let closure = Closure::once_into_js(move || {
                    let decoder = unsafe { &*this };
                    if *decoder.is_playing.borrow() {
                        if let Err(e) = decoder.render_frame() {
                            error!("Render error: {:?}", e);
                            return;
                        }
                        
                        let _ = decoder.schedule_next_frame();
                    }
                });
    
                let id = window.request_animation_frame(closure.as_ref().unchecked_ref())?;
                *self.animation_id.borrow_mut() = Some(id);
            }
        }
        Ok(())
    }


    fn generate_debug_pattern(&self) -> Vec<u8> {
        let mut frame_data = vec![0u8; (self.width * self.height * 4) as usize];
        let time = (*self.frame_count.borrow() as f64) * 0.05;
        
        for y in 0..self.height {
            for x in 0..self.width {
                let idx = ((y * self.width + x) * 4) as usize;
                
                let r = ((((x as f64) * 0.01 + time).sin() + 1.0) * 127.5) as u8;
                let g = ((((y as f64) * 0.01 + time).cos() + 1.0) * 127.5) as u8;
                let b = (((((x + y) as f64) * 0.01 + time).sin() + 1.0) * 127.5) as u8;
                
                frame_data[idx] = r;
                frame_data[idx + 1] = g;
                frame_data[idx + 2] = b;
                frame_data[idx + 3] = 255;
            }
        }
        frame_data
    }

    #[wasm_bindgen]
    pub async fn initialize_render_context(&mut self, canvas: HtmlCanvasElement) -> Result<String, JsValue> {
        // Store canvas dimensions
        self.width = canvas.width();
        self.height = canvas.height();
        
        // Get and store 2D context
        let context = canvas
            .get_context("2d")?
            .unwrap()
            .dyn_into::<CanvasRenderingContext2d>()?;

        // Store both canvas and context
        self.canvas = Some(canvas);
        self.context = Some(context);
        
        info!("2D context initialized with canvas dimensions {}x{}", self.width, self.height);
        Ok("2D context initialized successfully".to_string())
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
            &"diagnosticMode".into(),
            &self.diagnostic_mode.into()
        ).unwrap();

        js_sys::Reflect::set(
            &capabilities,
            &"diagnostics".into(),
            &diagnostics
        ).unwrap();

        js_sys::Reflect::set(
            &diagnostics,
            &"frameCount".into(),
            &JsValue::from_f64(*self.frame_count.borrow() as f64)
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

        js_sys::Reflect::set(
            &status,
            &"initialized".into(),
            &(self.canvas.is_some() && self.context.is_some()).into()
        ).unwrap();
    
        js_sys::Reflect::set(
            &status,
            &"running".into(),
            &self.animation_id.borrow().is_some().into()  // Fixed is_some() call
        ).unwrap();
    

        // Performance metrics
        let metrics = js_sys::Object::new();
        js_sys::Reflect::set(
            &metrics,
            &"frameCount".into(),
            &JsValue::from_f64(*self.frame_count.borrow() as f64)
        ).unwrap();
        
   
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
    pub fn stop_player_loop(&self) {
        *self.is_playing.borrow_mut() = false;
        if let Some(id) = self.animation_id.borrow_mut().take() {
            if let Some(window) = web_sys::window() {
                window.cancel_animation_frame(id);
            }
        }
        debug!("Animation stopped");
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
        info!("Starting token processing...");
        
        let frame_tokens: Vec<FrameToken> = match serde_wasm_bindgen::from_value::<Vec<FrameToken>>(tokens) {
            Ok(t) => {
                info!("Successfully deserialized {} tokens", t.len());
                t
            },
            Err(e) => {
                error!("Failed to deserialize tokens: {:?}", e);
                return Err(JsValue::from_str(&format!("Token deserialization failed: {:?}", e)));
            }
        };
        
        let token_count = frame_tokens.len();
        info!("Processing {} tokens", token_count);
        
        for (idx, token) in frame_tokens.iter().enumerate() {
            info!("Processing token {}/{} with frame index {}", idx + 1, token_count, token.frame_index);
            debug!("Token data length: {}", token.token.len());
            
            let mut frame = Frame::new(self.width as usize, self.height as usize);
            let frame_data: Vec<u8> = token.token.iter().map(|&x| x as u8).collect();
            debug!("Converted frame data length: {}", frame_data.len());
            
            frame.set_data(frame_data);
            debug!("Frame data set, pushing to queue");
            
            self.frame_queue.push(frame);
        }
        
        info!("Token processing complete");
        Ok(format!("Successfully processed {} tokens", token_count))
    }



    fn render_frame(&self) -> Result<(), JsValue> {
        if let Some(context) = &self.context {
            // Generate frame data
            let frame_data = self.generate_debug_pattern();
            
            // Create and render ImageData
            let image_data = ImageData::new_with_u8_clamped_array_and_sh(
                Clamped(&frame_data),
                self.width,
                self.height
            )?;
            
            context.put_image_data(&image_data, 0.0, 0.0)?;
            
            // Update frame counter
            let mut frame_count = self.frame_count.borrow_mut();
            *frame_count = (*frame_count + 1) % self.max_frames;
        }
        Ok(())
    }

    fn update_metrics(&self) {
        // if let Some(window) = web_sys::window() {
        //     if let Some(performance) = window.performance() {
        //         let now = performance.now();
        //         // let frame_time = now - self.last_frame_time.get();
        //         // self.last_frame_time.set(now);

        //         let fps = 1000.0 / frame_time;
        //         let frame_count = self.frame_count.get();
                
        //         info!("Frame {} metrics:", frame_count);
        //         debug!("  - Frame time: {:.2}ms", frame_time);
        //         debug!("  - FPS: {:.2}", fps);
        //         debug!("  - Queue status: {:?}", self.frame_queue.get_queue_sizes());
                
        //         if frame_count % 60 == 0 {
        //             info!("Performance report:");
        //             info!("  - Average FPS: {:.2}", fps);
        //             info!("  - Frame time: {:.2}ms", frame_time);
        //             info!("  - Frames processed: {}", frame_count);
        //         }
        //     }
        // }
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