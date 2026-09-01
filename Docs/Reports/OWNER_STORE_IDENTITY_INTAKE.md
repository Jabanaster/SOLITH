# SOLITH — Owner Store-Identity Intake

Purpose: the exact, minimal set of values the owner must obtain from Microsoft Partner Center and return before an MSIX/Store build can proceed. Nothing below is a password, credential, or MFA code — none of that should ever be shared with an agent or stored in this repository.

## Required values

```text
SOLITH_MSIX_IDENTITY_NAME=
SOLITH_MSIX_PUBLISHER=
SOLITH_MSIX_PUBLISHER_DISPLAY_NAME=
```

Where to find each, in Partner Center:

- `SOLITH_MSIX_IDENTITY_NAME` — Partner Center → App identity → **Package/Identity/Name**.
- `SOLITH_MSIX_PUBLISHER` — Partner Center → App identity → **Package/Identity/Publisher** (the full `CN=...` string).
- `SOLITH_MSIX_PUBLISHER_DISPLAY_NAME` — Partner Center → App identity → **Publisher display name**.

## How to supply these

Set them as local environment variables before running `npm run build:msix`, e.g. (PowerShell):

```powershell
$env:SOLITH_MSIX_IDENTITY_NAME = "..."
$env:SOLITH_MSIX_PUBLISHER = "..."
$env:SOLITH_MSIX_PUBLISHER_DISPLAY_NAME = "..."
npm run build:msix
```

Do not commit these values into the repository or any tracked file.

## What is NOT requested here

- No Microsoft account password
- No MFA/2FA code
- No Partner Center login session or cookie
- No payment/tax profile details

## Status

`OWNER STORE-IDENTITY INTAKE PREPARED — VALUES NOT YET SUPPLIED`
