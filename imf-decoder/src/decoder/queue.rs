use std::collections::VecDeque;
use super::frame::Frame;
use crate::utils::metrics::Metrics;

pub struct Queue {
    input_queue: VecDeque<Frame>,
    processing_queue: VecDeque<Frame>,
    output_queue: VecDeque<Frame>,
    max_size: usize,
    batch_size: usize,
    metrics: Metrics,
}

impl Queue {
    pub fn new(max_size: usize, batch_size: usize) -> Self {
        Self {
            input_queue: VecDeque::with_capacity(max_size),
            processing_queue: VecDeque::with_capacity(batch_size),
            output_queue: VecDeque::with_capacity(max_size),
            max_size,
            batch_size,
            metrics: Metrics::new(),
        }
    }

    pub fn push(&mut self, frame: Frame) -> bool {
        if self.input_queue.len() < self.max_size {
            self.input_queue.push_back(frame);
            self.metrics.record_queue_size(self.input_queue.len());
            true
        } else {
            false
        }
    }

    pub fn process_batch(&mut self) -> Vec<Frame> {
        let start_time = web_sys::window()
            .unwrap()
            .performance()
            .unwrap()
            .now();

        let mut batch = Vec::new();
        while batch.len() < self.batch_size && !self.input_queue.is_empty() {
            if let Some(frame) = self.input_queue.pop_front() {
                batch.push(frame);
            }
        }

        let processing_time = web_sys::window()
            .unwrap()
            .performance()
            .unwrap()
            .now() - start_time;
        
        self.metrics.record_processing_time(processing_time);
        batch
    }
}
