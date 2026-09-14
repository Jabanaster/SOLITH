//! Cancellation primitive (Stage 1 doc 06 §1.5, Stage 2 mission §15).
//!
//! A `CancellationToken` is a cheap, `Clone`-able, `Send`-able handle around
//! a shared flag. The napi adapter creates one per scan operation, hands a
//! clone to the caller (as an opaque handle a `cancel()` export can flip)
//! and a clone to the background reader loop, which checks it between
//! chunks — never mid-syscall, so a `ReadProcessMemory` call already in
//! flight always completes before cancellation takes effect (this is what
//! makes "no leaked process handle, no hung Promise" achievable: the loop
//! always reaches a clean checkpoint before stopping).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}
