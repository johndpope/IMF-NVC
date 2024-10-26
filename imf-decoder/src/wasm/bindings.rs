use wasm_bindgen::prelude::*;
use crate::decoder::{Frame, Queue, WebGLDecoder};
use serde::{Serialize, Deserialize};

// Create helper for logging
macro_rules! console_log {
    ($($t:tt)*) => {
        web_sys::console::log_1(&format!($($t)*).into())
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
pub struct IMFDecoder {
    width: u32,
    height: u32,
    queue: Queue,
    webgl: WebGLDecoder,
    reference_data: Option<ReferenceData>,
    diagnostic_mode: bool,
}

#[wasm_bindgen]
impl IMFDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<IMFDecoder, JsValue> {
        console_log!("Creating new IMF decoder with dimensions {}x{}", width, height);
        console_error_panic_hook::set_once();
        let webgl = WebGLDecoder::new()?;
        
        Ok(Self {
            width,
            height,
            queue: Queue::new(60, 4),
            webgl,
            reference_data: None,
            diagnostic_mode: false,
        })
    }

    #[wasm_bindgen]
    pub fn test(&self) -> String {
        let msg = format!("IMFDecoder working! Size: {}x{}", self.width, self.height);
        console_log!("{}", msg);
        msg
    }

    #[wasm_bindgen(getter)]
    pub fn diagnostic_mode(&self) -> bool {
        self.diagnostic_mode
    }

    #[wasm_bindgen(setter)]
    pub fn set_diagnostic_mode(&mut self, value: bool) {
        self.diagnostic_mode = value;
        console_log!("Diagnostic mode set to: {}", value);
    }

    // Set reference data from TensorFlow.js
    #[wasm_bindgen]
    pub fn set_reference_data(&mut self, data: JsValue) -> Result<String, JsValue> {
        console_log!("Setting reference data...");
        
        let ref_data: ReferenceData = serde_wasm_bindgen::from_value(data)?;
        
        // Validate tensor shapes match IMF requirements
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

        // Validate token size
        if ref_data.token.len() != 32 {
            return Err(JsValue::from_str("Reference token must be length 32"));
        }

        self.reference_data = Some(ref_data);
        Ok("Reference data set successfully".to_string())
    }


    #[wasm_bindgen]
    pub fn process_tokens(&mut self, tokens: JsValue) -> Result<String, JsValue> {
        console_log!("Processing tokens...");
        
        match serde_wasm_bindgen::from_value::<Vec<FrameToken>>(tokens) {
            Ok(frame_tokens) => {
                let token_count = frame_tokens.len();
                
                // Use reference in the loop to avoid moving frame_tokens
                for token in &frame_tokens {
                    let mut frame = Frame::new(self.width as usize, self.height as usize);
                    // Clone the token data since we're working with a reference
                    frame.set_data(token.token.iter().map(|&x| x as u8).collect());
                    self.queue.push(frame);
                }
                
                Ok(format!("Processed {} tokens successfully", token_count))
            }
            Err(err) => Err(JsValue::from_str(&format!("Failed to process tokens: {}", err)))
        }
    }

    #[wasm_bindgen]
    pub fn process_batch(&mut self) -> Result<String, JsValue> {
        console_log!("Processing batch...");
        let processed = self.queue.process_batch();
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