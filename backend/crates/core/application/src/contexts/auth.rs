#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThrottleSettings {
    pub max_failures: u32,
    pub failure_window_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FailureWindow {
    pub count: u32,
    pub window_started_ms: i64,
}

pub fn failure_is_recent(failures: FailureWindow, settings: ThrottleSettings, now_ms: i64) -> bool {
    now_ms - failures.window_started_ms < settings.failure_window_ms
}

pub fn throttled(failures: Option<FailureWindow>, settings: ThrottleSettings, now_ms: i64) -> bool {
    failures.is_some_and(|failures| {
        failures.count >= settings.max_failures && failure_is_recent(failures, settings, now_ms)
    })
}

pub fn next_failure(failures: Option<FailureWindow>, settings: ThrottleSettings, now_ms: i64) -> FailureWindow {
    let current = failures
        .filter(|failures| failure_is_recent(*failures, settings, now_ms))
        .unwrap_or(FailureWindow { count: 0, window_started_ms: now_ms });
    FailureWindow { count: current.count + 1, ..current }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionDecision {
    Expired,
    Keep,
    RenewUntil(i64),
}

pub fn session_decision(expires_at_ms: i64, now_ms: i64, session_ttl_ms: i64) -> SessionDecision {
    if expires_at_ms <= now_ms {
        return SessionDecision::Expired;
    }
    let renewed = now_ms + session_ttl_ms;
    let refresh_after_ms = (session_ttl_ms / 2).min(60 * 60 * 1000);
    if renewed - expires_at_ms >= refresh_after_ms {
        SessionDecision::RenewUntil(renewed)
    } else {
        SessionDecision::Keep
    }
}
