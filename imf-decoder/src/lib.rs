use wasm_bindgen::prelude::*;

// Initialize console error panic hook
#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}

// Decoder struct and implementation
#[wasm_bindgen]
pub struct Decoder {
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl Decoder {
    // Constructor must be marked as constructor
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        console_error_panic_hook::set_once();
        Self {
            width,
            height,
        }
    }

    // Add a test method
    #[wasm_bindgen]
    pub fn test(&self) -> String {
        format!("Decoder working! Size: {}x{}", self.width, self.height)
    }
}

// Add a factory function as alternative to constructor
#[wasm_bindgen]
pub fn create_decoder(width: u32, height: u32) -> Decoder {
    Decoder::new(width, height)
}