# Third-Party Trainer Quarantine Architecture

Status: **Design only — locked at analysis-only Phase 4**  
Execution status: **No third-party trainer binary execution authorized**  
Primary strategy: **Extract declarative definitions and execute them through Solith's native engine**

## 1. Purpose

This document defines how Solith may safely consume useful information from third-party trainer
ecosystems without automatically trusting or executing their binaries. It also defines the only
acceptable containment direction if a future, separately authorized pilot genuinely requires a
third-party executable.

The architecture is zero-trust: a known publisher, valid signature, familiar filename, clean
antivirus scan, or previously accepted version is evidence, not proof of safety.

## 2. Governing constraints

- Offline and single-player gameplay only.
- No anti-cheat bypass, stealth, or debugger-based bypass.
- No kernel drivers or packet capture.
- No automatic download, update, installation, or execution of third-party binaries.
- No arbitrary URLs or remotely granted trust.
- No execution approval based only on filename, domain, or publisher.
- No unverified control becomes executable in Solith.
- Any byte change produces a new artifact identity and invalidates prior review.
- Failure or uncertainty at a safety gate blocks the operation.

## 3. Practical constraint: the privilege and observability conflict

A conventional restricted-token broker is not a generally compatible trainer host:

- Trainers may require access rights unavailable to a stripped token, especially when the game
  runs elevated or inside a WinGDK boundary.
- Commercial protectors and packers can prevent meaningful static inspection.
- Antivirus products commonly classify trainer behavior as a game-hacking tool even when the
  binary is not otherwise malicious.
- Granting elevation or debug privilege to recover compatibility would weaken the containment
  boundary the broker is intended to provide.

Therefore Solith must not spend engineering effort attempting to make arbitrary commercial
trainers work inside a weak user-mode sandbox. The earlier restricted execution broker remains a
threat-model reference, not an implementation commitment.

## 4. Product modes

### Mode A — Metadata and definition import (default)

Solith may import declarative, reviewable data from approved sources:

- Cheat Engine `.CT` tables.
- Open-source trainer definitions and configuration files.
- Pointer chains, offsets, exact AOB signatures, data types, and value constraints.
- Game/version metadata, authorship, provenance, and source hashes.

Imported controls enter the catalog as unverified and non-executable. They become executable only
after Solith's existing per-control verification and certification process succeeds.

### Mode B — Quarantine analysis

An explicitly selected artifact may be downloaded into non-executable quarantine for analysis.
Permitted operations include hashing, Authenticode verification, PE metadata inspection, local
malware scanning, provenance recording, and extraction of legally usable declarative data.

Mode B must never launch the artifact, load its DLLs, invoke its installer, or follow instructions
embedded in the artifact.

### Mode C — Disposable virtualized execution (future, separately authorized)

If binary execution is ever approved, the game and trainer must run together inside a disposable
Windows Sandbox or Hyper-V virtual machine. The VM, not a custom Solith broker, provides the
primary isolation boundary.

Mode C is not authorized by this specification. It requires a separate threat review, a named
trainer hash, a named offline game/version, and explicit user approval.

## 5. Preferred data path

```text
Approved declarative source
        |
        v
Parser with strict size/schema limits
        |
        v
Normalized non-executable definition
        |
        v
Provenance + hash + trust label
        |
        v
Native Solith scan / pointer verification
        |
        v
Per-control evidence and certification
        |
        v
Solith-controlled offline execution
```

This keeps process access, online-session enforcement, audit logging, value validation, and the
kill switch inside Solith's trusted codebase.

## 6. Definition extraction requirements

Every importer must:

1. Enforce bounded file sizes and parsing depth.
2. Treat scripts, auto-assembler blocks, and embedded binaries as inert data.
3. Reject external includes, network references, and executable payload extraction.
4. Preserve the original artifact hash and source provenance.
5. Normalize pointer paths and AOBs without enabling them.
6. Mark unknown data types, offsets, modules, or version constraints as unresolved.
7. Prevent imported content from setting its own trust or certification level.
8. Require manual review before a definition enters the research catalog.
9. Require live, offline verification before any control becomes executable.

## 7. Quarantine analysis pipeline

```text
User-selected allowlisted HTTPS source
        |
        v
Bounded download to quarantine
        |
        v
SHA-256/SHA-512 identity and recheck
        |
        v
Authenticode and provenance report
        |
        v
Static metadata and local AV analysis
        |
        +---- policy failure ----> blocked artifact
        |
        v
Analysis-only report / declarative extraction
```

### Source controls

- HTTPS only, with exact hostname allowlisting.
- No IP-literal, loopback, private-network, or user-info URLs.
- Redirects only to separately allowlisted hostnames.
- Strict timeout, redirect-count, and response-size limits.
- No browser cookies, saved credentials, or ambient authentication.
- Remote data cannot add a trusted publisher or source.

### Artifact identity

Record at minimum:

- SHA-256 and SHA-512.
- Exact byte length.
- Requested and final URLs.
- Download timestamp.
- Authenticode status, signer, certificate thumbprint, and timestamp status.
- PE architecture, requested execution level, product version, and original filename.
- Scanner name, engine/signature version, time, and result.

Any identity change invalidates every prior decision.

### Hard-block findings

- Driver or service installation.
- Scheduled tasks, startup persistence, or security-setting modification.
- Credential, browser-profile, or unrelated save access.
- Packet capture or network interception.
- Anti-cheat termination, tampering, bypass, or stealth behavior.
- Download-and-execute behavior.
- Access to unrelated processes.
- Invalid, unexpected, or changed signing identity where signing is required.

A clean scan never upgrades an artifact from analysis-only to executable.

## 8. Disposable VM execution concept

If a later authorization enables Mode C, use this lifecycle:

1. Create a disposable Windows Sandbox or Hyper-V image from a known baseline.
2. Disable networking before introducing the artifact.
3. Transfer the hash-pinned game build and trainer through controlled, read-only staging.
4. Verify both hashes again inside the guest.
5. Start local guest monitoring and audit collection.
6. Run both the game and trainer inside the same guest.
7. Provide a host-side emergency stop that destroys the VM.
8. Export only an explicitly approved, sanitized audit report.
9. Destroy the VM and all writable disks after the session.

Host game directories must not be mounted writable. Personal saves, credentials, browser data,
SSH keys, Solith databases, and host user directories must not be exposed to the guest.

### VM limitations

- Windows Sandbox and Hyper-V availability varies by Windows edition and configuration.
- GPU acceleration and game compatibility may be insufficient.
- DRM, WinGDK, launchers, and licensing may prevent operation in a disposable guest.
- A trainer may still harm data inside the guest.
- VM isolation reduces host risk; it does not make prohibited trainer behavior acceptable.

If the game and trainer cannot operate within the VM boundary, Mode C fails closed. Solith must not
fall back to elevated host execution.

## 9. Delivery plan

### Phase 0 — Charter and threat model

- Approve this document and an explicit data-handling policy.
- Define allowed sources, prohibited capabilities, retention, privacy, and licensing requirements.
- Add no download or execution code.

### Phase 1 — Declarative importer hardening

- Harden existing `.CT` import with bounded parsing and inert script treatment.
- Add normalized provenance and artifact hashes.
- Ensure imported trust levels cannot exceed `community` / `research`.
- Add negative fixtures for embedded payloads, external includes, and malformed tables.

### Phase 2 — Native verification workflow

- Convert imported AOBs and pointer paths into non-executable research candidates.
- Require exact game/module fingerprinting.
- Record scan evidence and patch-drift behavior.
- Promote controls only through the existing certification process.

### Phase 3 — Analysis-only quarantine

- Implement source allowlisting and safe bounded downloads.
- Add immutable artifact storage and hash identity.
- Add Authenticode, PE metadata, and local Defender adapters.
- Produce deterministic, user-readable risk reports.
- Keep the operating system execute bit/ACL restricted where practical.

### Phase 4 — Analysis-only pilot lock

- Evaluate a small, explicitly approved sample without execution.
- Measure parser coverage, false positives, provenance quality, and legal constraints.
- Decide whether Mode A provides sufficient value.
- Do not build a restricted execution broker during this phase.

### Phase 5 — Virtualization feasibility study

- Confirm Windows editions, Sandbox/Hyper-V APIs, GPU support, WinGDK behavior, and licensing.
- Use harmless internal fixtures only.
- Demonstrate network-disabled creation, hash re-verification, emergency destruction, and cleanup.
- Produce a go/no-go report before any real trainer pilot.

### Phase 6 — Single-artifact VM pilot (requires new authorization)

- One explicitly named trainer artifact and SHA-256.
- One explicitly named offline game build and SHA-256.
- No anti-cheat, multiplayer, driver, packet-capture, stealth, or persistence behavior.
- Independent security review and tested recovery procedure.

## 10. Acceptance criteria for the current scope

The analysis-only architecture is acceptable when:

- No imported artifact can execute through the parser or catalog.
- Imported definitions cannot self-certify.
- Every imported field retains provenance.
- Hash changes invalidate previous analysis.
- Malformed or oversized artifacts fail closed.
- Embedded executable/script content remains inert.
- No network access occurs unless the user explicitly initiates an allowlisted analysis download.
- No source can remotely grant itself trust.
- Native Solith execution still requires offline verification and per-control certification.
- The full test suite leaves tracked fixtures unchanged.

## 11. Go/no-go decision

Proceed now with Mode A and, after review, Mode B. Keep the program locked at the analysis-only
pilot through Phase 4. Do not build the restricted execution broker.

Consider Mode C only if declarative extraction cannot meet a documented product need and the
virtualization feasibility study proves that host isolation, offline enforcement, cleanup, game
compatibility, and licensing can all be satisfied. Otherwise, reject third-party binary execution
and continue expanding Solith's native verified engine.
