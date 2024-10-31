use wasm_bindgen::prelude::*;

pub mod decoder;
pub mod utils;
pub mod wasm;

// Re-export for JavaScript
pub use wasm::bindings::*;

// Initialize panic hook
#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}