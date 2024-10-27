// network.rs - Network operations
use wasm_bindgen::prelude::*;
use crate::types::*;

pub struct NetworkClient {
    client: reqwest::Client,
    base_url: String,
}

impl NetworkClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.to_string(),
        }
    }

    pub async fn fetch_reference_data(&self, video_id: u32) -> Result<ReferenceData, JsValue> {
        let url = format!("{}/videos/{}/reference", self.base_url, video_id);
        // Move reference data fetching logic here
    }

    pub async fn fetch_bulk_tokens(
        &self, 
        video_id: u32, 
        start_frame: usize, 
        end_frame: usize
    ) -> Result<BulkTokenResponse, JsValue> {
        let url = format!(
            "{}/videos/{}/tokens?start={}&end={}", 
            self.base_url, video_id, start_frame, end_frame
        );
        // Move bulk token fetching logic here
    }
}