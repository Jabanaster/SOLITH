#
# Solith Antivirus Notice
#
# This file is intentionally documentation-only. It does not modify Windows
# Defender, Bitdefender, or any other host security policy.
#
# Solith release policy forbids automated host OS security-policy changes. If a
# local security product reports Solith, use the vendor UI to review the alert,
# submit a false-positive report when appropriate, or test inside an isolated VM.
# Do not disable real-time protection as a Solith setup step.
#

Write-Host "Solith does not provide an automated antivirus whitelist script." -ForegroundColor Cyan
Write-Host "This notice is documentation-only and makes no system changes." -ForegroundColor Cyan
Write-Host ""
Write-Host "Recommended safe actions:" -ForegroundColor Yellow
Write-Host "  1. Verify you built or downloaded Solith from the trusted repository."
Write-Host "  2. Review any antivirus alert details before proceeding."
Write-Host "  3. Submit the file to your security vendor as a false positive when appropriate."
Write-Host "  4. Use an isolated VM or Windows Sandbox for release validation."
Write-Host ""
Write-Host "Blocked by policy:" -ForegroundColor Red
Write-Host "  - No automatic Defender exclusions."
Write-Host "  - No host security-policy modification."
Write-Host "  - No disabling real-time protection."
Write-Host ""
Write-Host "See Docs/ANTIVIRUS_SETUP.md for the current safety posture." -ForegroundColor Cyan
