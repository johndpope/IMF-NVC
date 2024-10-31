use wasm_bindgen::prelude::*;
use web_sys::{Worker, MessageEvent};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum PlayerStatus {
    Idle = 0,
    Ready = 1,
    Playing = 2,
    Pause = 3,
    Destroyed = 4,
}

#[wasm_bindgen]
pub struct Player {
    status: PlayerStatus,
    worker: Option<Worker>,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl Player {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Result<Player, JsValue> {
        let worker = Worker::new("./decoder.worker.js")?;
        
        let player = Player {
            status: PlayerStatus::Idle,
            worker: Some(worker),
            width,
            height,
        };

        Ok(player)
    }

    #[wasm_bindgen]
    pub fn initialize(&mut self) -> Result<(), JsValue> {
        if let Some(worker) = &self.worker {
            let msg = JsValue::from_str("initialize");
            worker.post_message(&msg)?;
            self.status = PlayerStatus::Ready;
        }
        Ok(())
    }

    #[wasm_bindgen]
    pub fn start(&mut self) -> Result<(), JsValue> {
        if self.status != PlayerStatus::Ready {
            return Err(JsValue::from_str("Player not ready"));
        }

        if let Some(worker) = &self.worker {
            let msg = JsValue::from_str("start");
            worker.post_message(&msg)?;
            self.status = PlayerStatus::Playing;
        }
        Ok(())
    }

    #[wasm_bindgen]
    pub fn pause(&mut self) -> Result<(), JsValue> {
        if self.status != PlayerStatus::Playing {
            return Err(JsValue::from_str("Player not playing"));
        }

        if let Some(worker) = &self.worker {
            let msg = JsValue::from_str("pause");
            worker.post_message(&msg)?;
            self.status = PlayerStatus::Pause;
        }
        Ok(())
    }
}