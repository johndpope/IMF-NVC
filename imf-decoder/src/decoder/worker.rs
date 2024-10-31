use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use web_sys::WorkerGlobalScope;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum DecoderStatus {
    Idle = 0,
    Initializing = 1,
    Inited = 2,
    Ready = 3,
    Open = 4,
    Pause = 5,
    Closed = 6,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum DecodeMessage {
    DecoderCreated = 0,
    DecoderInit = 1,
    DecoderInited = 2,
    WasmLoaded = 3,
    DecoderReady = 4,
    DecoderOpenError = 5,
    DecoderStart = 6,
    DecoderStarted = 7,
    DecoderPause = 8,
    DecoderPaused = 9,
    DecoderClose = 10,
    DecoderClosed = 11,
    DecodeVideoBuffer = 12,
    DecodedVideoFrame = 13,
}

#[wasm_bindgen]
pub struct DecoderWorker {
    status: DecoderStatus,
    decoder: IMFDecoder,
    scope: WorkerGlobalScope,
}

#[wasm_bindgen]
impl DecoderWorker {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<DecoderWorker, JsValue> {
        let scope = js_sys::global().unchecked_into::<WorkerGlobalScope>();
        let decoder = IMFDecoder::new(1920, 1080)?;
        
        let worker = DecoderWorker {
            status: DecoderStatus::Idle,
            decoder,
            scope,
        };

        worker.post_message(DecodeMessage::DecoderCreated);
        Ok(worker)
    }

    fn post_message(&self, msg: DecodeMessage) {
        let msg_val = serde_wasm_bindgen::to_value(&msg).unwrap();
        self.scope.post_message(&msg_val).unwrap();
    }

    #[wasm_bindgen]
    pub fn initialize(&mut self) -> Result<(), JsValue> {
        self.status = DecoderStatus::Initializing;
        self.post_message(DecodeMessage::DecoderInit);
        
        // Initialize decoder
        self.decoder.test();
        
        self.status = DecoderStatus::Inited;
        self.post_message(DecodeMessage::DecoderInited);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn start(&mut self) -> Result<(), JsValue> {
        if self.status != DecoderStatus::Ready {
            return Err(JsValue::from_str("Decoder not ready"));
        }

        self.status = DecoderStatus::Open;
        self.post_message(DecodeMessage::DecoderStarted);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn pause(&mut self) -> Result<(), JsValue> {
        if self.status != DecoderStatus::Open {
            return Err(JsValue::from_str("Decoder not running"));
        }

        self.status = DecoderStatus::Pause;
        self.post_message(DecodeMessage::DecoderPaused);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn process_frame(&mut self, frame_data: JsValue) -> Result<(), JsValue> {
        if self.status != DecoderStatus::Open {
            return Err(JsValue::from_str("Decoder not running"));
        }

        self.decoder.process_tokens(frame_data)?;
        self.decoder.process_batch()?;
        
        self.post_message(DecodeMessage::DecodedVideoFrame);
        Ok(())
    }
}