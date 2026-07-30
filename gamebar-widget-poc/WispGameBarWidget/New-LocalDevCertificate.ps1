[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$pfxPath = Join-Path $PSScriptRoot 'WispGameBarWidget_LocalDevKey.pfx'
$cerPath = Join-Path $PSScriptRoot 'WispGameBarWidget_LocalDevKey.cer'

foreach ($path in @($pfxPath, $cerPath)) {
    if ((Test-Path -LiteralPath $path) -and -not $Force) {
        throw "Refusing to overwrite '$path'. Re-run with -Force to rotate the local test certificate."
    }
}

$rsa = [System.Security.Cryptography.RSA]::Create(2048)
try {
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=SolithLocalDevPoc',
        $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    )

    $request.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new(
            $false, $false, 0, $true
        )
    )
    $request.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
            [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,
            $true
        )
    )

    $oids = [System.Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3', 'Code Signing'))
    $request.CertificateExtensions.Add(
        [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true)
    )

    $certificate = $request.CreateSelfSigned(
        [DateTimeOffset]::Now.AddMinutes(-5),
        [DateTimeOffset]::Now.AddYears(1)
    )
    try {
        [System.IO.File]::WriteAllBytes(
            $pfxPath,
            $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, '')
        )
        [System.IO.File]::WriteAllBytes(
            $cerPath,
            $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        )
        Write-Host "Created local-only signing certificate $($certificate.Thumbprint)."
    }
    finally {
        $certificate.Dispose()
    }
}
finally {
    $rsa.Dispose()
}
