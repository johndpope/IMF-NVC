use wasm_bindgen::prelude::*;
use web_sys::console;
use crate::decoder::{Frame, Queue, WebGLDecoder};
use serde::{Serialize, Deserialize};

#[wasm_bindgen(start)]
pub fn bind_wasm() {
    console_error_panic_hook::set_once();
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
pub struct Decoder {
    width: u32,
    height: u32,
    queue: Queue,
    webgl: WebGLDecoder,
    reference_data: Option<ReferenceData>,
    diagnostic_mode: bool,
}

#[wasm_bindgen]
impl Decoder {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<Decoder, JsValue> {
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
        format!("Decoder working! Size: {}x{}", self.width, self.height)
    }

    #[wasm_bindgen]
    pub fn diagnostic_mode(&self) -> bool {
        self.diagnostic_mode
    }

    #[wasm_bindgen(setter)]
    pub fn set_diagnostic_mode(&mut self, value: bool) {
        self.diagnostic_mode = value;
        console::log_1(&format!("Diagnostic mode set to: {}", value).into());
    }

    #[wasm_bindgen]
    pub fn set_reference_data(&mut self, data: JsValue) -> Result<String, JsValue> {
        console::log_1(&"Processing reference data...".into());
        
        match serde_wasm_bindgen::from_value::<ReferenceData>(data) {
            Ok(ref_data) => {
                self.reference_data = Some(ref_data);
                Ok("Reference data set successfully".to_string())
            }
            Err(err) => Err(JsValue::from_str(&format!("Failed to parse reference data: {}", err)))
        }
    }

    #[wasm_bindgen]
    pub fn process_tokens(&mut self, tokens: JsValue) -> Result<String, JsValue> {
        match serde_wasm_bindgen::from_value::<Vec<FrameToken>>(tokens) {
            Ok(frame_tokens) => {
                for token in frame_tokens {
                    let mut frame = Frame::new(self.width as usize, self.height as usize);
                    frame.set_data(token.token.into_iter().map(|x| x as u8).collect());
                    self.queue.push(frame);
                }
                Ok(format!("Processed tokens successfully"))
            }
            Err(err) => Err(JsValue::from_str(&format!("Failed to process tokens: {}", err)))
        }
    }

    #[wasm_bindgen]
    pub fn process_batch(&mut self) -> Result<String, JsValue> {
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