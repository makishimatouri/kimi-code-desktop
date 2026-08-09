//! Coordinated Runtime reloads and the turn-start barrier.
//!
//! A raw config save replaces a whole file and rebuilds the single Runtime
//! process. The rebuild must never race a newly accepted turn: accepted turns
//! require an exact terminal event, while an intentional `Stopped` generation
//! does not run the crash-only fail-all path.

use super::session::lock;
#[cfg(test)]
use super::session::SessionSlot;
use super::RuntimeHost;
use crate::runtime::supervisor::{RuntimeSupervisor, ShutdownConfig};
use std::sync::{Arc, RwLockReadGuard};

impl RuntimeHost {
    /// Shared side of the reload barrier. Different sessions may still start
    /// turns concurrently; only a whole-Runtime reload takes exclusive access.
    pub(super) fn turn_start_guard(&self) -> RwLockReadGuard<'_, ()> {
        self.turn_start_gate
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Run a whole-Runtime transaction only while no accepted turn is active.
    /// The exclusive guard stays held for the complete caller operation, so a
    /// new `turn.start` cannot enter after the idle check and before shutdown.
    pub fn run_when_turns_idle<T>(
        &self,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _turn_start_guard = self
            .turn_start_gate
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut busy_sessions: Vec<String> = lock(&self.shared.sessions)
            .iter()
            .filter(|(_, slot)| !slot.in_flight.is_empty())
            .map(|(session_id, _)| session_id.clone())
            .collect();
        busy_sessions.sort();
        if !busy_sessions.is_empty() {
            return Err(format!(
                "Cannot reload Runtime while a turn is active in session(s): {}. Wait for completion and retry the save.",
                busy_sessions.join(", ")
            ));
        }
        operation()
    }

    /// Drain the current generation and lazily rebuild it while holding the
    /// generation mutex across shutdown. Concurrent `ensure_started` callers
    /// therefore observe either the old ready child or the rebuilt child,
    /// never a half-stopped generation.
    pub fn reload_runtime(
        &self,
        shutdown: &ShutdownConfig,
    ) -> Result<Arc<RuntimeSupervisor>, String> {
        let current = self.ensure_started()?;
        {
            let generation = lock(&self.generation);
            let installed = generation
                .as_ref()
                .ok_or_else(|| "runtime generation disappeared before reload".to_string())?;
            if !Arc::ptr_eq(&current, &installed.supervisor) {
                return Err("runtime generation changed before reload; retry the save".to_string());
            }
            installed
                .supervisor
                .shutdown(shutdown)
                .map_err(|err| format!("runtime shutdown before config reload failed: {err}"))?;
        }
        self.ensure_started()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::host::{RuntimeHost, WireSink};
    use std::sync::mpsc;
    use std::time::Duration;

    struct NoopSink;

    impl WireSink for NoopSink {
        fn emit(&self, _session_id: &str, _message: String) {}
    }

    #[test]
    fn reload_transaction_rejects_busy_sessions_before_running() {
        let host = RuntimeHost::with_sink(Arc::new(NoopSink));
        let mut slot = SessionSlot::default();
        slot.in_flight.insert("request-1".to_string());
        lock(&host.shared.sessions).insert("session-busy".to_string(), slot);
        let mut ran = false;

        let error = host
            .run_when_turns_idle(|| {
                ran = true;
                Ok(())
            })
            .expect_err("busy turn must block Runtime reload");

        assert!(!ran);
        assert!(error.contains("session-busy"), "{error}");
        assert!(error.contains("Wait for completion"), "{error}");
    }

    #[test]
    fn reload_transaction_excludes_new_turn_starts_until_completion() {
        let host = Arc::new(RuntimeHost::with_sink(Arc::new(NoopSink)));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let reload_host = Arc::clone(&host);
        let reload = std::thread::spawn(move || {
            reload_host
                .run_when_turns_idle(|| {
                    entered_tx.send(()).expect("announce reload barrier");
                    release_rx.recv().expect("release reload barrier");
                    Ok(())
                })
                .expect("idle reload transaction");
        });
        entered_rx.recv().expect("reload acquired write guard");

        let (turn_tx, turn_rx) = mpsc::channel();
        let turn_host = Arc::clone(&host);
        let turn = std::thread::spawn(move || {
            let _guard = turn_host.turn_start_guard();
            turn_tx.send(()).expect("announce turn guard");
        });
        assert!(turn_rx.recv_timeout(Duration::from_millis(50)).is_err());

        release_tx.send(()).expect("finish reload transaction");
        reload.join().expect("reload thread");
        turn_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("turn start unblocked after reload");
        turn.join().expect("turn thread");
    }
}
