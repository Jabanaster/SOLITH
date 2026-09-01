# SOLITH MASTER ROADMAP

> **Authority:** This is the authoritative portfolio-level roadmap for SOLITH. It reconciles the product roadmap, security roadmap, Adaptive Wisp workstream, and the governed machine-authority program without erasing their evidence-backed history.
>
> **Evidence review date:** 2026-08-31
>
> **Repository:** `G:\ACTIVE_PROJECTS\SOLITH`
>
> **Product version at review:** `2.4.0-alpha.2` (`package.json`)
>
> **Repository state at review:** `review/gate2-5-doc-audit`, eight commits ahead of its upstream, with pre-existing untracked files. This roadmap does not treat that dirty branch as a release-certified state.

## 1. Status legend

| Status | Meaning |
|---|---|
| **CERTIFIED** | Reproducible build, test, and/or runtime evidence exists for the stated scope and environment. Certification is never inferred from implementation or a tool returning success. |
| **VERIFIED COMPLETE** | Existing repository terminology for a completed, evidence-linked historical scope. Preserved as historical evidence; it is not automatically a current release certification. |
| **IMPLEMENTED — NOT CERTIFIED** | Code exists, but required reproducible or manual evidence is incomplete. |
| **REPORTED COMPLETE — VERIFY** | A report claims completion, but independent/current reproduction is still required. |
| **IN PROGRESS** | Active implementation or evidence work is underway. |
| **BLOCKED** | A named dependency or required acceptance condition prevents closure. |
| **TODO / NOT CERTIFIED** | Planned work with insufficient evidence for certification. |
| **DEFERRED / CONDITIONAL** | Intentionally sequenced later or activated only if a stated condition becomes true. |
| **REGRESSED** | Previously passing scope no longer satisfies its gate. |

Status applies only to the exact scope named. A passing unit test does not certify packaged runtime behavior; a packaged smoke test does not certify every supported machine; source inspection does not substitute for runtime evidence.

## 2. Authority and governance

### 2.1 Document authority

1. `PROJECT_SPEC.md` controls product scope and the Safety Firewall, especially §3.2.
2. This file controls portfolio sequencing and cross-workstream reconciliation.
3. `SOLITH_SECURITY_ROADMAP.md` controls detailed security-gate findings and security release verdicts.
4. `ROADMAP.md` retains detailed product-phase requirements and historical closeout links.
5. `Docs/Architecture/ADAPTIVE_WISP_PLATFORM.md` and `Docs/Architecture/SOLITH_WISP_COMPANION.md` control detailed Wisp design and evidence history.
6. Current source, git state, reproducible tests, packaged runtime evidence, and signed evidence records outrank stale prose.

When documents disagree, do not silently choose the more optimistic status. Reconcile the claim against current source and reproducible evidence, then update the owning documents.

### 2.2 Mandatory execution rule

Every phase and consequential change follows:

```text
AUDIT → RECONCILE → IMPLEMENT → VERIFY → CERTIFY → DOCUMENT → INTEGRATE
```

- **AUDIT:** establish current code, policy, runtime, evidence, and git state.
- **RECONCILE:** map proposed work to proven capability using **PRESERVE / EXTEND / REPLACE / RETIRE**. Default to **PRESERVE / EXTEND** when evidence supports an existing capability.
- **IMPLEMENT:** make the smallest coherent change inside the approved authority boundary.
- **VERIFY:** prove preconditions, behavior, postconditions, negative paths, and cleanup.
- **CERTIFY:** attach reproducible build/test/runtime evidence for the exact claimed scope.
- **DOCUMENT:** record evidence, limitations, environment, commit, and remaining risk.
- **INTEGRATE:** merge only after gates pass and re-run the required checks on the integrated commit.

### 2.3 Non-negotiable governance

- `CERTIFIED` requires reproducible build/test/runtime evidence. Documentation, source presence, a passing typecheck alone, or a successful tool return is insufficient.
- External repositories—including CUA, osquery, Stagehand, Browser Use, Betterleaks, CUA-Bench, and Syncthing—are design references, not wholesale imports. Any adopted pattern must pass SOLITH policy, license, dependency, threat-model, and maintenance review.
- Preserve owner-autonomous behavior where the owner has already granted durable, scoped authority.
- Deletion remains approval- and explanation-protected. No new capability model may weaken destructive-operation safeguards.
- Online/multiplayer, anti-cheat, DRM, credential, protected-target, and other prohibited boundaries remain governed by `PROJECT_SPEC.md`; this roadmap does not override them.
- No major forward phase may erase or bypass existing consent, sender validation, protected-target, emergency-stop, rollback, lifecycle, or audit controls.
- Integration is not certification: the integrated commit must reproduce the applicable evidence.

## 3. Evidence-backed baseline

### 3.1 Preserved historical product phases

The following statuses are preserved from `ROADMAP.md` and its linked closeout reports. They are historical scope statements, not blanket certification of the current dirty branch or future architecture.

| Existing phase | Preserved status | Reconciliation |
|---|---|---|
| Phase 0 — build/gate stabilization | **ACTIVE / NOT CERTIFIED** | Preserve Node 22 requirement, packaged Gate 2.5 evidence, shutdown and overlay lifecycle work. Reconcile current CI failures and branch state before closure. |
| Phase 1 — shell/settings/notifications/banner/grid/title hygiene | **BLOCKED / IMPLEMENTED — NOT CERTIFIED** | Preserve implementation and automated coverage. Seven required process-picker manual cases remain `NOT TESTED`; do not certify. |
| Phase 2 — canonical game model and Game Library | **VERIFIED COMPLETE** | Preserve canonical identity, launcher/install records, and linked Phase 2C evidence. Extend rather than rebuild. |
| Phase 3 — Trainer Library catalog/support states | **VERIFIED COMPLETE** | Preserve support-state, ranking, sorting, filtering, and final-seven closeout evidence. |
| Phase 4 — artwork identity/cache/legal sourcing | **VERIFIED COMPLETE** | Preserve identity-safe artwork, cache, fetch policy, and linked clean-clone/closeout evidence. |
| Phase 5 — popularity/curated/signed catalog | **VERIFIED COMPLETE** | Preserve signed update, rollback, ranking, and closeout work. |
| Phase 6 — trainer/save/discovery gap closeout | **VERIFIED COMPLETE** | Preserve Trainer/Workshop, CT, save/resource, local-AI, and onboarding closeout scope. Do not infer real-game certification beyond evidence. |
| Phase 7 — security/packaging/supply chain/release QA | **REQUIRED / NOT CERTIFIED** | Detailed status remains in `SOLITH_SECURITY_ROADMAP.md`; several later security phases remain pending or partial. |
| Phase 8 — customization | **TODO / NOT CERTIFIED** | Retain as product work and reconcile with Wisp customization where shared schemas are appropriate. |
| Phase 9 — final hands-on acceptance | **DEFERRED / NOT CERTIFIED** | Required manual evidence remains outstanding. |
| Phase 10 — V1 release | **TODO / NOT CERTIFIED** | No public V1 certification is claimed. |

Other preserved evidence includes closed offline metadata persistence and CT ZIP bridge work, the responsive shared tool-page layout, packaged/native write-path and lifecycle evidence, and existing safety/failure-injection tests. These are inputs to SOL-0; they are not permission to mark SOL-0–SOL-8 certified.

### 3.2 Current security and release reality

- `SOLITH_SECURITY_ROADMAP.md` contains a mixture of **VERIFIED COMPLETE**, **REPORTED COMPLETE — VERIFY**, **PARTIAL**, and **PENDING** items. Its detailed verdicts must not be flattened into a global security pass.
- Security Phase 6 privileged IPC work is partial; several later secrets, dependency, native-helper, data-integrity, abuse-test, packaged-certification, and final-verdict gates remain pending.
- The referenced CI watch observed all triggered checks failing on PR #22 at commit `17c6be3949a653824008d9ced132c9336f8e4239`. After the repository became public, GitHub exposed the job annotation: “The job was not started because recent account payments have failed or your spending limit needs to be increased.” Every affected job had zero steps and `runner_id: 0`, proving the red wall was account billing/spending enforcement before runner assignment—not an OSV 2.5.1 or simultaneous repository-code regression. The failed workflows were rerun after the visibility change: Gitleaks, OSV, Semgrep, vendored-memory integrity, PR Static, and PR Windows passed. CI Fast completed install, typecheck, schema, orphan, and build steps and was running the test step at the 2026-08-31 evidence cutoff. **TODO / NOT CERTIFIED:** retain the final CI Fast result before treating PR #22 as fully green.
- The present checkout is not clean and is not the upstream integration point. **TODO / NOT CERTIFIED:** establish a clean, intended integration commit and rerun applicable gates.

## 4. Current Adaptive Wisp workstream

### 4.1 Reconciled status

**Overall: IN PROGRESS — NOT FULLY CERTIFIED.**

The old `ROADMAP.md` label “POST-V1 — WISP / DEFERRED” understates completed branch work. The dedicated `feature/adaptive-wisp-consent-completion` worktree and `Docs/Architecture/ADAPTIVE_WISP_PLATFORM.md` provide evidence-backed progress that must be preserved:

- Adaptive Wisp Increments 4 and 5 are documented complete with regression/security evidence.
- Increment 6 identity/registry work failed an initial independent review, was remediated, and later received a PASS.
- Catalog and production composition Tasks 1–4 reached an unconditional integration PASS.
- Adaptive Wisp Phases 1–2 are documented evidence-complete and unconditionally passed, including consent/security review.
- The pre-Phase-3 regression and integration gate is documented PASS.
- The current branch contains typed profiles, registry/binding/resolution, persistence, live adapter, execution, quick slots/hotkeys, consent proposal/service/audit paths, controlled execution, and extensive tests.

These claims are preserved for their documented scope. They do not certify later visual/host milestones or certify the current main checkout.

### 4.2 Wisp milestone ledger

| Wisp scope | Status | Required next evidence |
|---|---|---|
| Foundation companion, safe allowlist, overlay route/window | **IMPLEMENTED — NOT FULLY CERTIFIED** | Repeat installed-app and real-game overlay checklist on integrated commit. |
| Adaptive platform Phases 1–2 and pre-Phase-3 gate | **CERTIFIED for documented branch scope** | Integrate deliberately, rerun tests and runtime evidence on the merge commit. |
| Consent queue/dialog and controlled execution | **CERTIFIED for documented branch scope** | Reproduce packaged consent path and negative cases after integration. |
| Adaptive placement engine | **TODO / NOT CERTIFIED** | Unit geometry matrix plus DPI/multi-monitor packaged runtime evidence. |
| Basic/Advanced game-aware UI | **TODO / NOT CERTIFIED** | Two-profile behavior and safety acceptance. |
| Per-game control and appearance customization | **TODO / NOT CERTIFIED** | Persistence, migration, reset, invalid-data, and restart evidence. |
| Multi-form/state renderer and neutral pose | **TODO / NOT CERTIFIED** | State transitions, reduced-motion, fallback, overlap, and performance evidence. |
| Optional 3D renderer with 2D fallback | **DEFERRED / NOT CERTIFIED** | Hardware-tier and graceful-degradation evidence if authorized. |
| Xbox Game Bar host transport/runtime prototype | **PARTIAL / NOT FULLY CERTIFIED** | Existing Palworld/runtime and transport artifacts are preserved, but W9–W12 require current integrated, real-supported-game, multi-monitor, scaling, persistence, safety, and performance certification. |
| Full Wisp workstream | **NOT CERTIFIED** | W9–W12 and all mandatory acceptance gates must pass. |

Wisp presentation/customization work must not change authority. A prettier or more proactive Wisp receives no new capability by implication.

## 5. Forward roadmap: governed machine authority

All SOL phases begin **TODO / NOT CERTIFIED** unless a narrower preserved capability is explicitly named. Each phase starts by reconciling existing code and evidence; proven controls are **PRESERVE / EXTEND**, not rebuilt.

### SOL-0 — Baseline and Authority Audit

**Status:** TODO / NOT CERTIFIED

**Objective:** Produce the authoritative, evidence-linked map of SOLITH machine authority before expanding it.

**Requirements**

- Reconfirm authority modes, identities, consent states, owner-autonomous grants, target scope, and risk levels.
- Inventory destructive-operation policy; deletion must remain approval- and explanation-protected.
- Inventory machine scope, computer-control providers, browser implementation, process lifecycle, emergency stop, audit logging, credentials, networking, installation, and settings mutation.
- Map every consequential action class to current policy and implementation.
- Reconcile claims across `PROJECT_SPEC.md`, both roadmaps, Wisp documents, IPC inventories, source, tests, evidence, and the current integrated git state.
- Produce a **PRESERVE / EXTEND / REPLACE / RETIRE** matrix and evidence index.

**Exit gate**

- Every action class has an owner, capability, target, context, risk, decision, implementation path, evidence link, and known gap.
- Deletion, emergency stop, consent, protected-target, cleanup, and audit behavior are reproduced on the intended integration commit.
- Conflicting status claims are corrected in their owning documents.
- **CERTIFIED** only after the audit commands/tests/runtime checks are reproducible from a clean checkout.

**Dependencies:** clean intended baseline; Node 22; access to relevant packaged Windows environment and existing evidence.

### SOL-1 — Governed Computer Control 2.0

**Status:** TODO / NOT CERTIFIED

**Objective:** Introduce capability-scoped authority while preserving already-proven autonomy and safeguards.

**Requirements**

```text
filesystem.read       filesystem.write
process.launch        process.kill
browser.navigate      browser.submit
input.mouse           input.keyboard
network.request       credential.use
software.install      system.settings
destructive.delete
```

Canonical decision:

```text
identity + capability + target + context + risk
    → ALLOW / DENY / REQUIRE APPROVAL
```

- Use typed, centrally evaluated grants with bounded target and lifetime.
- Preserve owner-autonomous behavior where current durable authorization is valid.
- Preserve trusted-sender, process identity, online/protected-target, write-consent, lifecycle-cleanup, and emergency-stop controls.
- `destructive.delete` must never become implicitly autonomous; require clear explanation and approval under the existing deletion policy.
- Deny unknown identities, capabilities, targets, contexts, or stale grants.

**Exit gate**

- Complete policy matrix and negative/abuse test suite.
- No renderer, Wisp, browser page, or external input can mint authority.
- Packaged runtime proves representative ALLOW, DENY, REQUIRE APPROVAL, revocation, expiry, restart, and emergency-stop paths.

**Dependencies:** SOL-0 certified; security authority findings reconciled.

### SOL-2 — Verified Action Runtime

**Status:** TODO / NOT CERTIFIED

**Objective:** Make consequential success mean a proven state change, not a successful tool return.

**Requirements**

```text
Intent
→ Preconditions
→ Authority check
→ Execute
→ Postconditions
→ Evidence
→ Compensation/rollback if supported
```

- Apply to process launch/termination, config changes, browser submission, file writes, installs, settings changes, and other consequential actions.
- Define typed receipts, idempotency, correlation IDs, timeout/cancellation, partial-failure semantics, and rollback limitations.
- Reuse existing operation state machine, atomic write, backup/rollback, consent, and cleanup mechanisms where proven.
- Never claim success solely because a provider returned without error.

**Exit gate**

- Each action family has deterministic pre/postconditions and tamper-resistant evidence.
- Failure injection proves no false success, double application, stale confirmation, or silent partial completion.
- Packaged runtime demonstrates state change and compensation for representative supported actions.

**Dependencies:** SOL-1 certified; existing lifecycle and rollback evidence reconciled.

### SOL-3 — Machine Intelligence Layer

**Status:** TODO / NOT CERTIFIED

**Objective:** Provide normalized machine state without fragile shell-text parsing as the primary interface.

**Reference:** osquery patterns, subject to SOLITH adoption review.

```text
MachineStateService
├── OsqueryProvider
├── WindowsNativeProvider
├── ProcessProvider
├── NetworkProvider
├── HardwareProvider
└── SecurityProvider
```

**Requirements**

- Normalize processes, services, ports, connections, startup items, hardware, users/sessions, installed software, hashes, and security state.
- Define freshness, provenance, confidence, access-denied, unavailable, and partial-result semantics.
- Prefer native/structured providers; constrain and evidence any shell fallback.
- Keep observation separate from mutation authority.

**Exit gate**

- Stable typed schema and provider contract with cross-provider reconciliation tests.
- Representative Windows runtime fixtures prove normalization, refresh, degraded mode, and least privilege.
- No unsupported provider silently fabricates or upgrades state.

**Dependencies:** SOL-0 certified; SOL-1 authority contract stable. SOL-2 receipts recommended for provider lifecycle actions.

### SOL-4 — Browser Control 2.0

**Status:** TODO / NOT CERTIFIED

**Objective:** Deliver governed, observable, deterministic-first browser control.

**References:** Stagehand and Browser Use patterns, after license/security review.

```text
Observe
→ reduce context
→ choose deterministic action
→ semantic fallback
→ execute
→ verify
→ recover
```

**Requirements**

- Accessibility/DOM state first, deterministic selectors where available, screenshot/vision only when needed.
- Separate `browser.navigate` from consequential `browser.submit` and credential use.
- Apply SOLITH authority, domain/target constraints, secret redaction, prompt-injection defenses, and verified postconditions.
- Capture bounded trajectories without leaking credentials or sensitive content.

**Exit gate**

- Reproducible fixtures cover navigation, forms, stale controls, redirects, downloads, dialogs, denial, recovery, and verification failure.
- Submission cannot occur under navigation-only authority.
- Packaged/browser runtime evidence proves safe abort and recovery.

**Dependencies:** SOL-1 and SOL-2 certified; SOL-3 optional for richer host observation.

### SOL-5 — Telemetry and Attribution

**Status:** TODO / NOT CERTIFIED

**Objective:** Correlate system effects to the SOLITH workflow that caused them.

```text
SystemEvent
├── id
├── timestamp
├── source
├── process_identity
├── event_type
├── severity
├── attributes
├── evidence
└── correlation_id
```

**Requirements**

- Normalize process, network, browser, agent-action, resource, and security events.
- Add process → socket → destination attribution and carry action correlation IDs end to end.
- Define retention, redaction, local-first storage, clock/skew, deduplication, and export rules.
- Ensure telemetry is evidence, not an authority source.

**Exit gate**

- “Which SOLITH workflow caused this process to contact this host?” is answerable for supported fixtures.
- Restart, concurrency, missing-event, privacy, and tamper scenarios are tested.
- Local storage and export contain no unapproved secrets.

**Dependencies:** SOL-2 certified; SOL-3 and SOL-4 integrated for complete attribution.

### SOL-6 — Security Validation Pipeline

**Status:** TODO / NOT CERTIFIED

**Objective:** Generalize evidence-aware candidate validation without unsafe probing.

**Reference:** Betterleaks-style detection patterns, after adoption review.

```text
candidate → context → confidence → safe validation → impact → policy response
```

**Requirements**

- Apply to credentials, suspicious executables, network destinations, unsafe child processes, unexpected persistence, and capability misuse.
- Default to non-destructive, local, redacted validation; never transmit a suspected credential merely to test it without explicit governed authority.
- Record confidence and evidence separately from enforcement decisions.
- Connect policy response to revoke/deny/approval/emergency-stop paths without bypassing SOL-1.

**Exit gate**

- Seeded true/false-positive corpus and abuse tests are reproducible.
- Redaction, quarantine/containment, notification, and audit behavior are verified.
- No validator escalates authority or causes unsafe side effects.

**Dependencies:** SOL-1, SOL-2, and SOL-5 certified; SOL-3 feeds structured machine candidates.

### SOL-7 — Computer-Use Evaluation

**Status:** TODO / NOT CERTIFIED

**Objective:** Make computer-use behavior repeatable, measurable, and regression-safe.

**Reference:** CUA-Bench concepts, adapted to SOLITH safety and local fixtures.

**Requirements**

- Build fixtures for app opening, window movement, stale controls, permission denial, recovery, confirmation dialogs, browser forms, emergency stop, and verification failures.
- Store complete trajectories:

```text
initial state
observations
actions
policy decisions
verification
final state
timing
errors
```

- Score task completion, policy correctness, false success, recovery, latency, reproducibility, and evidence completeness.
- Include deterministic mocks and packaged Windows/runtime suites; distinguish simulation from real runtime.

**Exit gate**

- Versioned fixtures run repeatably with documented tolerance and seeded failures.
- Policy violations and false-success claims are hard failures.
- CI and packaged certification retain inspectable, privacy-safe trajectories.

**Dependencies:** SOL-1 through SOL-6 stable enough to evaluate. Initial harness design may begin after SOL-2.

### SOL-8 — Optional Peer/Fleet Architecture

**Status:** DEFERRED / CONDITIONAL / NOT CERTIFIED

**Activation condition:** SOLITH has an approved, concrete multi-machine use case that cannot be served by the single-machine architecture.

**Objective:** Add trusted peer operation without prematurely building distributed infrastructure.

**Requirements**

- Study Syncthing-style trusted replication, device identity, incremental synchronization, revocation, conflict handling, and recovery.
- Preserve per-device authority, local deletion protection, audit provenance, and least privilege.
- Define offline behavior, clock/skew, key rotation, partial fleet failure, and secure bootstrap.
- Do not build etcd/Kubernetes-style infrastructure unless scale and operational evidence justify it.

**Exit gate**

- Approved use case, threat model, data classification, protocol decision, conflict tests, revocation tests, and multi-device runtime evidence.
- Single-machine mode remains fully supported and does not require fleet services.

**Dependencies:** SOL-1, SOL-2, SOL-5, and SOL-6 certified; explicit owner authorization to activate.

## 6. Final target architecture

```text
Owner / agent intent
        ↓
Identity + capability + target + context + risk
        ↓
Capability authority ───────────────→ DENY / REQUIRE APPROVAL
        ↓ ALLOW
Machine observation
        ↓
Verified action runtime
        ↓
Native / browser / Wisp / optional peer driver
        ↓
Postcondition evidence + compensation
        ↓
Telemetry, attribution, security validation, and audit
        ↓
Reproducible computer-use evaluation and certification
```

Cross-cutting controls: Safety Firewall, owner-autonomous scoped grants, deletion approval/explanation, consent, protected-target guards, credential handling, emergency stop, privacy/redaction, lifecycle cleanup, evidence integrity, and versioned schemas.

## 7. Recommended execution order

1. Establish the intended clean integration baseline and reconcile current CI failures.
2. Complete **SOL-0** and publish the authority/evidence/PRESERVE–EXTEND matrix.
3. Close the existing product Phase 1 manual gap and continue required security/release gates without overwriting preserved Phase 2–6 history.
4. Integrate Adaptive Wisp Phases 1–2 deliberately; rerun branch evidence on the integrated commit. Keep later Wisp workstream items explicitly not certified.
5. Execute **SOL-1** capability authority.
6. Execute **SOL-2** verified action runtime.
7. Begin **SOL-7** harness foundations once SOL-2 contracts stabilize so later phases accumulate reproducible trajectories.
8. Execute **SOL-3** machine intelligence.
9. Execute **SOL-4** browser control.
10. Execute **SOL-5** telemetry and attribution.
11. Execute **SOL-6** security validation.
12. Complete **SOL-7** full computer-use evaluation and packaged certification.
13. Resume Wisp W3–W12 against the governed runtime as portfolio priority permits; Wisp authority remains bounded by SOL-1/SOL-2.
14. Activate **SOL-8** only when its multi-machine condition is met.
15. Run final hands-on, clean-machine, installer, security, and release certification on the exact release commit.

Parallel work is allowed only when interfaces and ownership are stable and integration evidence is planned. No parallel feature stream may bypass an unmet authority or release gate.

## 8. Immediate TODO / NOT CERTIFIED register

- [ ] Identify and document the intended integration branch/commit; remove or classify unrelated dirty-tree state.
- [x] Classify the all-red PR #22 observation: GitHub billing/spending enforcement prevented runner assignment; public-repository reruns cleared six completed workflows.
- [ ] Record the final CI Fast rerun result for PR #22; it was executing the standard test suite at the evidence cutoff.
- [ ] Run SOL-0 and create the complete action-policy/evidence matrix.
- [ ] Reconcile `ROADMAP.md`, `SOLITH_SECURITY_ROADMAP.md`, and Wisp status text to this portfolio roadmap after integration.
- [ ] Complete the seven Phase 1 process-picker manual cases.
- [ ] Finish pending/partial security roadmap phases and obtain a final security verdict.
- [ ] Integrate Adaptive Wisp evidence-complete work and rerun tests/runtime checks on the integration commit.
- [ ] Certify Wisp placement, Basic/Advanced UI, per-game customization, multi-form behavior, reduced-motion, multi-monitor, and Game Bar W9–W12; until then the full Wisp workstream is **NOT CERTIFIED**.
- [ ] Implement and certify SOL-1 through SOL-7 in dependency order.
- [ ] Keep SOL-8 deferred until explicitly activated by a real fleet requirement.
- [ ] Complete hands-on, clean-machine, installer, and exact-release-commit certification before any V1 claim.

## 9. Roadmap maintenance rule

At the end of every material SOLITH session:

1. Record the branch, commit, environment, commands, test/runtime results, artifacts, limitations, and dirty-tree classification.
2. Update the owning detailed roadmap first, then reconcile this master roadmap.
3. Never replace `TODO`, `NOT CERTIFIED`, `PARTIAL`, or `REPORTED COMPLETE — VERIFY` with `CERTIFIED` without reproducible evidence.
4. If evidence regresses, mark the scope **REGRESSED** immediately; historical evidence remains historical, not current proof.
5. Preserve completed history. Extend proven controls rather than restarting them under a new phase name.
