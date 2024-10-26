use wasm_bindgen::prelude::*;
use crate::decoder::{Frame, Queue, WebGLDecoder};

#[wasm_bindgen]
pub fn bind_wasm() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct WasmDecoder {
    queue: Queue,
    webgl: WebGLDecoder,
}

#[wasm_bindgen]
impl WasmDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(max_queue_size: usize, batch_size: usize) -> Result<WasmDecoder, JsValue> {
        let webgl = WebGLDecoder::new()?;
        Ok(Self {
            queue: Queue::new(max_queue_size, batch_size),
            webgl,
        })
    }

    pub fn queue_frames(&mut self, frames_data: JsValue) -> Result<(), JsValue> {
        let frames: Vec<Frame> = serde_wasm_bindgen::from_value(frames_data)?;
        for frame in frames {
            if !self.queue.push(frame) {
                return Err("Queue full".into());
            }
        }
        Ok(())
    }

    pub fn process_batch(&mut self) -> Result<JsValue, JsValue> {
        let processed = self.queue.process_batch();
        Ok(serde_wasm_bindgen::to_value(&processed)?)
    }
}