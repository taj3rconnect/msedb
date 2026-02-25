Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName "taj@aptask.com" -ShowBanner:$false -Device
Write-Host "Connected to Exchange Online"

# List existing org apps
Write-Host "Listing existing org add-ins..."
$apps = Get-App -OrganizationApp
$apps | Format-Table AppId, DisplayName, Enabled

# Find and remove existing MSEDB app
$existing = $apps | Where-Object { $_.DisplayName -like "*MSEDB*" -or $_.DisplayName -like "*Email Manager*" }
if ($existing) {
    foreach ($app in $existing) {
        Write-Host "Removing: $($app.DisplayName) ($($app.AppId))"
        Remove-App -Identity $app.AppId -OrganizationApp -Confirm:$false
        Write-Host "Removed."
    }
} else {
    Write-Host "No existing MSEDB add-in found."
}

Write-Host "Installing fresh add-in..."
$manifest = [System.IO.File]::ReadAllBytes("/home/admin/claude/MSEDB/addin/manifest.xml")
New-App -FileData $manifest -OrganizationApp -DefaultStateForUser Enabled -ProvidedTo Everyone
Write-Host "Done!"

Disconnect-ExchangeOnline -Confirm:$false
