use serde::{Serialize, Deserialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Frame {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
    pub timestamp: f64,
    pub is_keyframe: bool,
}

impl Frame {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            data: vec![0; width * height * 4],
            timestamp: 0.0,
            is_keyframe: false,
        }
    }

    pub fn set_data(&mut self, data: Vec<u8>) {
        assert_eq!(data.len(), self.width * self.height * 4);
        self.data = data;
    }
}