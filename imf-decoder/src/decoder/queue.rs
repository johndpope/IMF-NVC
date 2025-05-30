use std::collections::VecDeque;
// use web_sys::Performance;
use super::frame::Frame;

#[derive(Debug, Default)]
pub struct QueueMetrics {
    frames_processed: usize,
    frames_dropped: usize,
    processing_times: Vec<f64>,
    queue_utilization: f32,
    last_process_time: f64,
}

pub struct Queue {
    input_queue: VecDeque<Frame>,
    processing_queue: VecDeque<Frame>,
    output_queue: VecDeque<Frame>,
    max_size: usize,
    batch_size: usize,
    metrics: QueueMetrics,
}

#[derive(Debug)]
pub struct QueueStats {
    pub frames_processed: usize,
    pub frames_dropped: usize,
    pub average_processing_time: f64,
    pub queue_utilization: f32,
    pub input_queue_size: usize,
    pub processing_queue_size: usize,
    pub output_queue_size: usize,
    pub last_process_time: f64,
    pub max_size: usize,
    pub batch_size: usize,
}

impl Queue {
    pub fn new(max_size: usize, batch_size: usize) -> Self {
        Self {
            input_queue: VecDeque::with_capacity(max_size),
            processing_queue: VecDeque::with_capacity(batch_size),
            output_queue: VecDeque::with_capacity(max_size),
            max_size,
            batch_size,
            metrics: QueueMetrics::default(),
        }
    }

    pub fn push(&mut self, frame: Frame) -> bool {
        if self.input_queue.len() < self.max_size {
            self.input_queue.push_back(frame);
            self.update_metrics();
            true
        } else {
            self.metrics.frames_dropped += 1;
            false
        }
    }

    pub fn process_next(&mut self) -> Option<Frame> {
        let start_time = web_sys::window()
            .and_then(|w| w.performance())
            .map(|p| p.now())
            .unwrap_or(0.0);

        let result = if let Some(frame) = self.input_queue.pop_front() {
            self.processing_queue.push_back(frame.clone());
            self.process_frame()
        } else {
            None
        };

        // Record processing time
        if let Some(window) = web_sys::window() {
            if let Some(perf) = window.performance() {
                let processing_time = perf.now() - start_time;
                self.metrics.processing_times.push(processing_time);
                self.metrics.last_process_time = processing_time;

                // Keep only last 100 measurements
                if self.metrics.processing_times.len() > 100 {
                    self.metrics.processing_times.remove(0);
                }
            }
        }

        if result.is_some() {
            self.metrics.frames_processed += 1;
        }

        self.update_metrics();
        result
    }

    fn process_frame(&mut self) -> Option<Frame> {
        self.processing_queue.pop_front().map(|frame| {
            self.output_queue.push_back(frame.clone());
            frame
        })
    }

    pub fn process_batch(&mut self) -> Vec<Frame> {
        let mut batch = Vec::with_capacity(self.batch_size);
        while batch.len() < self.batch_size && !self.input_queue.is_empty() {
            if let Some(frame) = self.process_next() {
                batch.push(frame);
            }
        }
        batch
    }

    // Metrics and Stats Methods
    pub fn get_metrics(&self) -> QueueStats {
        QueueStats {
            frames_processed: self.metrics.frames_processed,
            frames_dropped: self.metrics.frames_dropped,
            average_processing_time: self.get_average_processing_time(),
            queue_utilization: self.metrics.queue_utilization,
            input_queue_size: self.input_queue.len(),
            processing_queue_size: self.processing_queue.len(),
            output_queue_size: self.output_queue.len(),
            last_process_time: self.metrics.last_process_time,
            max_size: self.max_size,
            batch_size: self.batch_size,
        }
    }

    // Getters for bindings.rs
    pub fn get_size(&self) -> usize {
        self.input_queue.len()
    }

    pub fn get_max_size(&self) -> usize {
        self.max_size
    }

    pub fn get_batch_size(&self) -> usize {
        self.batch_size
    }

    pub fn get_queue_sizes(&self) -> (usize, usize, usize) {
        (
            self.input_queue.len(),
            self.processing_queue.len(),
            self.output_queue.len()
        )
    }

    pub fn get_frames_processed(&self) -> usize {
        self.metrics.frames_processed
    }

    pub fn get_frames_dropped(&self) -> usize {
        self.metrics.frames_dropped
    }

    pub fn get_processing_time(&self) -> f64 {
        self.metrics.last_process_time
    }

    // Utility Methods
    fn get_average_processing_time(&self) -> f64 {
        if self.metrics.processing_times.is_empty() {
            0.0
        } else {
            let sum: f64 = self.metrics.processing_times.iter().sum();
            sum / self.metrics.processing_times.len() as f64
        }
    }

    fn update_metrics(&mut self) {
        let total_frames = self.input_queue.len() + self.processing_queue.len() + self.output_queue.len();
        self.metrics.queue_utilization = total_frames as f32 / (self.max_size * 3) as f32;
    }

    // Queue State Methods
    pub fn is_empty(&self) -> bool {
        self.input_queue.is_empty() && 
        self.processing_queue.is_empty() && 
        self.output_queue.is_empty()
    }

    pub fn is_full(&self) -> bool {
        self.input_queue.len() >= self.max_size
    }

    pub fn remaining_capacity(&self) -> usize {
        self.max_size - self.input_queue.len()
    }

    pub fn clear(&mut self) {
        self.input_queue.clear();
        self.processing_queue.clear();
        self.output_queue.clear();
        self.metrics = QueueMetrics::default();
    }
}

impl Drop for Queue {
    fn drop(&mut self) {
        self.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_capacity() {
        let mut queue = Queue::new(5, 2);
        assert_eq!(queue.remaining_capacity(), 5);
        assert_eq!(queue.get_max_size(), 5);
        
        let frame = Frame::new(640, 480);
        assert!(queue.push(frame.clone()));
        assert_eq!(queue.get_size(), 1);
        assert_eq!(queue.remaining_capacity(), 4);
    }

    #[test]
    fn test_batch_processing() {
        let mut queue = Queue::new(10, 3);
        
        for _ in 0..5 {
            let frame = Frame::new(640, 480);
            queue.push(frame);
        }

        let batch = queue.process_batch();
        assert_eq!(batch.len(), 3);
        
        let stats = queue.get_metrics();
        assert_eq!(stats.frames_processed, 3);
        assert_eq!(queue.get_frames_processed(), 3);
    }

    #[test]
    fn test_queue_overflow() {
        let mut queue = Queue::new(2, 1);
        
        let frame1 = Frame::new(640, 480);
        let frame2 = Frame::new(640, 480);
        let frame3 = Frame::new(640, 480);
        
        assert!(queue.push(frame1));
        assert!(queue.push(frame2));
        assert!(!queue.push(frame3));
        assert!(queue.is_full());
        
        let stats = queue.get_metrics();
        assert_eq!(stats.frames_dropped, 1);
        assert_eq!(queue.get_frames_dropped(), 1);
    }

    #[test]
    fn test_queue_metrics() {
        let mut queue = Queue::new(5, 2);
        assert_eq!(queue.get_metrics().queue_utilization, 0.0);
        
        let frame = Frame::new(640, 480);
        queue.push(frame);
        
        let metrics = queue.get_metrics();
        assert!(metrics.queue_utilization > 0.0);
        assert_eq!(metrics.frames_processed, 0);
        assert_eq!(metrics.frames_dropped, 0);
    }
}