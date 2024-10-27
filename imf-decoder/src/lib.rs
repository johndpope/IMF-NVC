use wasm_bindgen::prelude::*;

pub mod decoder;
pub mod utils;
pub mod wasm;
pub mod imf_render;
pub mod types;

// Re-export for JavaScript
pub use wasm::bindings::*;
pub use types::*;

#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}