use serde::{Serialize, Deserialize};
use wasm_bindgen::prelude::*;
use web_sys::console;

// Reference data structures
#[derive(Serialize, Deserialize)]
struct ReferenceFeature {
    tensor: Vec<f32>,
    shape: Vec<usize>,
}

#[derive(Serialize, Deserialize)]
struct ReferenceData {
    features: Vec<ReferenceFeature>,
    token: Vec<f32>,
}

// Frame token structure
#[derive(Serialize, Deserialize)]
struct FrameToken {
    token: Vec<f32>,
    frame_index: usize,
}

// Diagnostic info structure
#[derive(Serialize, Deserialize)]
struct DiagnosticInfo {
    frame_index: usize,
    token_size: usize,
    processing_time_ms: f64,
    memory_usage: usize,
}

#[wasm_bindgen]
pub struct Decoder {
    width: u32,
    height: u32,
    reference_data: Option<ReferenceData>,
    diagnostic_mode: bool,
}

#[wasm_bindgen]
impl Decoder {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        console_error_panic_hook::set_once();
        Self {
            width,
            height,
            reference_data: None,
            diagnostic_mode: false,
        }
    }

    // Enable/disable diagnostic mode
    #[wasm_bindgen]
    pub fn set_diagnostic_mode(&mut self, enabled: bool) {
        self.diagnostic_mode = enabled;
    }

    // Set reference data for the session
    #[wasm_bindgen]
    pub fn set_reference_data(&mut self, data: JsValue) -> Result<(), JsValue> {
        let start_time = web_sys::window()
            .unwrap()
            .performance()
            .unwrap()
            .now();

        // Log start of reference data processing
        console::log_1(&"Processing reference data...".into());

        // Deserialize reference data
        let ref_data: ReferenceData = serde_wasm_bindgen::from_value(data)?;
        
        // Validate reference features
        for (i, feature) in ref_data.features.iter().enumerate() {
            let expected_size: usize = feature.shape.iter().product();
            if feature.tensor.len() != expected_size {
                return Err(format!(
                    "Invalid tensor size for feature {}: expected {}, got {}",
                    i, expected_size, feature.tensor.len()
                ).into());
            }
            
            console::log_2(
                &format!("Feature {} validated: ", i).into(),
                &format!("shape: {:?}, size: {}", feature.shape, feature.tensor.len()).into()
            );
        }

        self.reference_data = Some(ref_data);

        let end_time = web_sys::window()
            .unwrap()
            .performance()
            .unwrap()
            .now();

        console::log_1(&format!(
            "Reference data processed in {}ms",
            end_time - start_time
        ).into());

        Ok(())
    }

    // Process bulk tokens
    #[wasm_bindgen]
    pub fn process_bulk_tokens(&mut self, tokens: JsValue) -> Result<JsValue, JsValue> {
        let start_time = web_sys::window()
            .unwrap()
            .performance()
            .unwrap()
            .now();

        // Deserialize tokens
        let frame_tokens: Vec<FrameToken> = serde_wasm_bindgen::from_value(tokens)?;
        
        let mut results = Vec::new();

        // Process each token
        for token in frame_tokens {
            let token_start = web_sys::window()
                .unwrap()
                .performance()
                .unwrap()
                .now();

            if self.diagnostic_mode {
                // In diagnostic mode, just collect token info
                let diagnostic = DiagnosticInfo {
                    frame_index: token.frame_index,
                    token_size: token.token.len(),
                    processing_time_ms: web_sys::window()
                        .unwrap()
                        .performance()
                        .unwrap()
                        .now() - token_start,
                    memory_usage: std::mem::size_of::<FrameToken>() + token.token.capacity() * std::mem::size_of::<f32>(),
                };

                console::log_2(
                    &"Frame diagnostic:".into(),
                    &format!(
                        "Frame {}: {} tokens, {}ms processing time",
                        token.frame_index,
                        token.token.len(),
                        diagnostic.processing_time_ms
                    ).into()
                );

                results.push(diagnostic);
            } else {
                // Here you would implement actual frame reconstruction
                // For now, we'll just pass through the token data
                results.push(token);
            }
        }

        let total_time = web_sys::window()
            .unwrap()
            .performance()
            .unwrap()
            .now() - start_time;

        console::log_1(&format!(
            "Processed {} tokens in {}ms",
            results.len(),
            total_time
        ).into());

        Ok(serde_wasm_bindgen::to_value(&results)?)
    }

    // Check if reference data is set
    #[wasm_bindgen]
    pub fn has_reference_data(&self) -> bool {
        self.reference_data.is_some()
    }

    // Get reference data info (for debugging)
    #[wasm_bindgen]
    pub fn get_reference_data_info(&self) -> Result<JsValue, JsValue> {
        if let Some(ref ref_data) = self.reference_data {
            let info = {
                let features_info: Vec<_> = ref_data.features
                    .iter()
                    .map(|f| format!("shape: {:?}, size: {}", f.shape, f.tensor.len()))
                    .collect();
                
                format!(
                    "Reference data loaded: {} features, token size: {}",
                    features_info.len(),
                    ref_data.token.len()
                )
            };
            Ok(JsValue::from_str(&info))
        } else {
            Ok(JsValue::from_str("No reference data loaded"))
        }
    }
}