//! Region *selection* policy — deliberately separate from `region.rs`'s
//! enumeration, per Stage 1 doc 06 §2.1 / Stage 2 mission §8: enumeration
//! answers "what regions exist," policy answers "which of those should a
//! particular scan actually read." Baking a fixed protection filter into
//! enumeration itself (as today's TypeScript `getRegions()` implicitly
//! does by only ever being called from writable-scan call sites) would
//! make it impossible for a future scan mode to ask a different question
//! ("show me image-only regions," "show me executable regions for an AOB
//! scan") without duplicating the enumeration loop.

use crate::region::{CommitState, Region, RegionKind};

/// A composable region-selection policy. Each field is an independent
/// filter; a region must satisfy all `Some` fields to be selected (`None`
/// means "no constraint on this dimension"). This is intentionally a plain
/// data struct, not a closure/trait object, so a policy can be constructed,
/// logged, and compared in tests without any dynamic dispatch.
#[derive(Debug, Clone, Default)]
pub struct RegionSelectionPolicy {
    pub require_readable: Option<bool>,
    pub require_writable: Option<bool>,
    pub require_executable: Option<bool>,
    pub allowed_kinds: Option<Vec<RegionKind>>,
    pub allowed_commit_states: Option<Vec<CommitState>>,
    /// Regions larger than this are excluded (mirrors the existing
    /// `maxRegionBytes`-style safety valve from the TypeScript scanner —
    /// kept as a policy knob, not hardcoded, so a future caller can widen
    /// or remove it with evidence rather than editing this crate).
    pub max_region_bytes: Option<u64>,
}

impl RegionSelectionPolicy {
    /// The default policy the current interactive value scanner uses today
    /// (per Stage 1 doc 01 §4): committed, writable, readable regions,
    /// bounded by a 64 MiB per-region ceiling. Provided as a named,
    /// documented default — not because it is the only sane policy, but
    /// because Stage 2's fixtures/tests need *a* concrete policy to exercise
    /// the separation against.
    pub fn default_writable_value_scan() -> Self {
        RegionSelectionPolicy {
            require_readable: Some(true),
            require_writable: Some(true),
            require_executable: None,
            allowed_kinds: None,
            allowed_commit_states: Some(vec![CommitState::Committed]),
            max_region_bytes: Some(64 * 1024 * 1024),
        }
    }

    /// A read-only-oriented policy (readable regions of any writability) —
    /// the shape a future AOB/pattern scan over executable/image regions
    /// would use, included to prove the policy model actually supports more
    /// than one shape, not just the one the current scanner happens to use.
    pub fn readable_any() -> Self {
        RegionSelectionPolicy {
            require_readable: Some(true),
            require_writable: None,
            require_executable: None,
            allowed_kinds: None,
            allowed_commit_states: Some(vec![CommitState::Committed]),
            max_region_bytes: None,
        }
    }

    pub fn matches(&self, region: &Region) -> bool {
        if let Some(req) = self.require_readable {
            if region.is_readable != req {
                return false;
            }
        }
        if let Some(req) = self.require_writable {
            if region.is_writable != req {
                return false;
            }
        }
        if let Some(req) = self.require_executable {
            if region.is_executable != req {
                return false;
            }
        }
        if let Some(kinds) = &self.allowed_kinds {
            if !kinds.contains(&region.kind) {
                return false;
            }
        }
        if let Some(states) = &self.allowed_commit_states {
            if !states.contains(&region.commit_state) {
                return false;
            }
        }
        if let Some(max) = self.max_region_bytes {
            if region.size > max {
                return false;
            }
        }
        true
    }

    /// Splits `regions` into (selected, excluded) — both lists returned
    /// explicitly rather than just the selected set, so a caller building a
    /// completeness record can name every excluded region and why (the
    /// "never silently discard region metadata" requirement extends to
    /// policy exclusion, not just enumeration).
    pub fn partition<'a>(&self, regions: &'a [Region]) -> (Vec<&'a Region>, Vec<&'a Region>) {
        regions.iter().partition(|r| self.matches(r))
    }
}
