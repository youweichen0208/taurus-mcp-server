param(
  [Parameter(Mandatory = $true)][string]$Service,
  [Parameter(Mandatory = $true)][string]$Account,
  [switch]$WithSecurityToken
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TaurusCredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref Credential credential, UInt32 flags);
}
'@

function Save-CredentialValue([string]$Key, [string]$Label) {
  $secure = Read-Host "Enter $Label" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
  try {
    $value = [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)
    $bytes = [Text.Encoding]::Unicode.GetBytes($value)
    $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
      $credential = New-Object TaurusCredentialWriter+Credential
      $credential.Type = 1
      $credential.TargetName = "$Service/$Account/$Key"
      $credential.CredentialBlobSize = $bytes.Length
      $credential.CredentialBlob = $blob
      $credential.Persist = 2
      $credential.UserName = $Account
      if (-not [TaurusCredentialWriter]::CredWrite([ref]$credential, 0)) { throw "CredWriteW failed." }
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
      [Array]::Clear($bytes, 0, $bytes.Length)
    }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
  }
}

Save-CredentialValue "access-key-id" "Huawei Cloud access key ID"
Save-CredentialValue "secret-access-key" "Huawei Cloud secret access key"
if ($WithSecurityToken) { Save-CredentialValue "security-token" "Huawei Cloud security token" }
