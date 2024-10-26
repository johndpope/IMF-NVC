use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Decoder {
    // Your decoder implementation
}

#[wasm_bindgen]
impl Decoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self { }
    }
}

#[wasm_bindgen]
pub fn initialize() {
    console_error_panic_hook::set_once();
}