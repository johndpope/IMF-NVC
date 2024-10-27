// types.rs - Shared type definitions
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct ReferenceFeature {
    pub tensor: Vec<f32>,
    pub shape: Vec<usize>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ReferenceData {
    pub features: Vec<ReferenceFeature>,
    pub token: Vec<f32>,
}

#[derive(Serialize, Deserialize)]
pub struct FrameToken {
    pub token: Vec<f32>,
    pub frame_index: usize,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BulkTokenResponse {
    pub tokens: std::collections::HashMap<usize, Vec<f32>>,
    pub metadata: TokenMetadata,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TokenMetadata {
    pub total_frames: usize,
    pub processed_frames: usize,
}

#[derive(Serialize, Deserialize)]
pub struct TensorData {
    pub data: Vec<f32>,
    pub shape: Vec<usize>,
}