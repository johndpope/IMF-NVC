use std::sync::atomic::{AtomicUsize, Ordering};

pub struct Memory {
    allocated: AtomicUsize,
    peak: AtomicUsize,
}

impl Memory {
    pub fn new() -> Self {
        Self {
            allocated: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        }
    }

    pub fn allocate(&self, size: usize) {
        let new_allocated = self.allocated.fetch_add(size, Ordering::SeqCst) + size;
        let mut peak = self.peak.load(Ordering::SeqCst);
        while new_allocated > peak {
            match self.peak.compare_exchange(
                peak,
                new_allocated,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => break,
                Err(x) => peak = x,
            }
        }
    }

    pub fn deallocate(&self, size: usize) {
        self.allocated.fetch_sub(size, Ordering::SeqCst);
    }
}