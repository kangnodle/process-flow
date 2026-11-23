use process_flow_application::contexts::auth::{
    FailureWindow, SessionDecision, ThrottleSettings, next_failure, session_decision, throttled,
};

#[test]
fn throttle_window_expires_at_its_exact_boundary() {
    let settings = ThrottleSettings { max_failures: 3, failure_window_ms: 100 };
    let failures = FailureWindow { count: 3, window_started_ms: 10 };
    assert!(throttled(Some(failures), settings, 109));
    assert!(!throttled(Some(failures), settings, 110));
    assert_eq!(next_failure(Some(failures), settings, 110), FailureWindow { count: 1, window_started_ms: 110 });
    assert_eq!(next_failure(Some(failures), settings, 109), FailureWindow { count: 4, window_started_ms: 10 });
}

#[test]
fn session_expiry_and_refresh_boundaries_are_explicit() {
    assert_eq!(session_decision(100, 100, 200), SessionDecision::Expired);
    assert_eq!(session_decision(200, 100, 200), SessionDecision::RenewUntil(300));
    assert_eq!(session_decision(200, 99, 200), SessionDecision::Keep);
    assert_eq!(session_decision(10_000_000, 3_599_999, 10_000_000), SessionDecision::Keep);
    assert_eq!(session_decision(10_000_000, 3_600_000, 10_000_000), SessionDecision::RenewUntil(13_600_000));
}
