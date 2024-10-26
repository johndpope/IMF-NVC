pub mod metrics;
pub mod memory;

pub use metrics::Metrics;
pub use memory::Memory;

// utils/metrics.rs
pub struct Metrics {
    frame_times: Vec<f64>,
    queue_sizes: Vec<usize>,
    processing_times: Vec<f64>,
    window_size: usize,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            frame_times: Vec::new(),
            queue_sizes: Vec::new(),
            processing_times: Vec::new(),
            window_size: 60,
        }
    }

    pub fn record_frame_time(&mut self, time: f64) {
        self.frame_times.push(time);
        if self.frame_times.len() > self.window_size {
            self.frame_times.remove(0);
        }
    }

    pub fn record_queue_size(&mut self, size: usize) {
        self.queue_sizes.push(size);
        if self.queue_sizes.len() > self.window_size {
            self.queue_sizes.remove(0);
        }
    }

    pub fn record_processing_time(&mut self, time: f64) {
        self.processing_times.push(time);
        if self.processing_times.len() > self.window_size {
            self.processing_times.remove(0);
        }
    }

    pub fn get_average_fps(&self) -> f64 {
        if self.frame_times.is_empty() {
            return 0.0;
        }
        1000.0 / (self.frame_times.iter().sum::<f64>() / self.frame_times.len() as f64)
    }
}