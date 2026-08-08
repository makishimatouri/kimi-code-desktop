//! Source Runtime (runtime-v1) client module.
//!
//! - `protocol`: typed envelopes, handshake params, and the `RuntimeInfo`
//!   readiness gate.
//! - `codec`: request encoding and the size-capped stdio JSONL frame decoder.
//! - `supervisor`: single runtime child-process lifecycle (spawn, pending
//!   table, handshake/shutdown orchestration, fail-closed faults).
//! - `pump` (crate-private): stdio pump threads, response routing, and the
//!   fail-closed path used by `supervisor`.
//! - `client`: typed calls for the runtime-v1 method surface over the
//!   supervisor pending table (the M3 parity families included).
//! - `translate`: runtime-v1 events to Desktop wire messages (the UI
//!   compatibility surface; generic fallback for unknown payloads).
//! - `readiness`: artifact/manifest/handshake validation with actionable
//!   errors.
//! - `host`: M4 desktop-semantic singleton (`RuntimeHost`) — spawn
//!   resolution, lazy lifecycle with fail-closed rebuild, the single-point
//!   event pump, session/lease bookkeeping, and the injectable wire sink.
//!
//! `host` is managed as Tauri state (`.manage` in `lib.rs`) and every
//! command family runs through it; the M4 cutover removed the ACP managers
//! and the external-CLI adapters.

pub mod client;
pub mod codec;
pub mod host;
pub mod migrate;
pub mod protocol;
pub(crate) mod pump;
pub mod readiness;
pub mod supervisor;
pub mod translate;

pub use client::RuntimeClient;
pub use protocol::{
    EventFrame, HelloParams, OutputFrame, ProtocolFault, ResponseFrame, RuntimeInfo,
    RUNTIME_PROTOCOL,
};
pub use readiness::{check_readiness, ReadinessError, ReadinessErrorKind, ReadinessReport};
pub use supervisor::{
    HandshakeConfig, RuntimeError, RuntimeSupervisor, ShutdownConfig, SpawnConfig, SupervisorState,
};
pub use translate::{
    synthesize_approval_resolved, synthesize_turn_begin, translate_event, WireTranslator,
};

use std::time::{SystemTime, UNIX_EPOCH};

/// Wall-clock millis since the Unix epoch for desktop-local timestamps,
/// shared by the host session table and the config/goal stores.
pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Command-level error mapping shared by the command families: a runtime
/// `Rejected` (well-formed `ok: false`) surfaces its code and message
/// verbatim, which the frontend tolerates as a displayable error; fatal
/// failures (protocol, io, timeout, unexpected exit, readiness) surface as
/// an operation failure.
pub(crate) fn runtime_error_message(operation: &str, err: RuntimeError) -> String {
    match err {
        RuntimeError::Rejected(body) => {
            format!("{operation} rejected: {}: {}", body.code, body.message)
        }
        other => format!("{operation} failed: {other}"),
    }
}
