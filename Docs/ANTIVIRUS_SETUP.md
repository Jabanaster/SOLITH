# Antivirus and False-Positive Handling

Solith does not include an automated antivirus whitelist flow.

This document exists only to explain why local security software may flag a
trainer/save-editor development build and how to respond without weakening host
security policy.

## Policy

Solith release builds and setup scripts must not:

- add Windows Defender exclusions;
- change Bitdefender, Norton, McAfee, Kaspersky, or similar product policy;
- request administrator rights to bypass local security controls;
- disable real-time protection;
- tell users to weaken security settings as a setup requirement.

The historical `scripts/setup-antivirus-whitelist.ps1` path is retained as a
documentation-only notice so old references fail safely.

## Why alerts can happen

Some Solith development features use local process enumeration, bounded
read-only memory inspection, and gated write-policy research code. Security
products may classify those primitives as suspicious because malware can use
similar operating-system APIs.

That does not make an alert harmless. Treat every alert as real until reviewed.

## Safe response

1. Confirm the binary was built from the trusted Solith repository and expected
   commit.
2. Reproduce inside a VM or Windows Sandbox when possible.
3. Review the security product's detection details.
4. Submit the file to the vendor as a false positive if appropriate.
5. Prefer signed release artifacts once signing is available.

## Developer validation

For local release validation, use the packaged smoke tests and clean-clone
verification rather than host security-policy changes:

```powershell
npm ci
npm run build
npm test
npm run test:electron-smoke
npm run test:packaged-smoke
```

If a security product blocks a build artifact, record the detection name,
product version, file hash, and Solith commit in the release notes. Do not add
automatic exclusions to make the validation pass.
