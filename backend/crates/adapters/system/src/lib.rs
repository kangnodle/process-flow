use std::time::{SystemTime, UNIX_EPOCH};

mod storage_locks;

pub use storage_locks::StorageLocks;

use process_flow_application::ports::{Clock, IdGenerator};

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct UuidGenerator;

impl IdGenerator for UuidGenerator {
    fn next_id(&self) -> String {
        uuid::Uuid::new_v4().simple().to_string()
    }
}
