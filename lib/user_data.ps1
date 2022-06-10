<powershell>
# SQL server configuration
New-NetFirewallRule -DisplayName 'Allow local VPC' -Direction Inbound -LocalAddress 10.0.0.0/8 -LocalPort Any -Action Allow
Install-WindowsFeature -Name Failover-Clustering -IncludeManagementTools

#domain join with secret from secret manager
Import-Module AWSPowerShell
[string]$SecretAD  = "AWSADAdminPassword"
$SecretObj = Get-SECSecretValue -SecretId $SecretAD
[PSCustomObject]$Secret = ($SecretObj.SecretString  | ConvertFrom-Json)
$password   = $Secret.password | ConvertTo-SecureString -asPlainText -Force
$username   = $Secret.username + "@" + $Secret.domain
$credential = New-Object System.Management.Automation.PSCredential($username,$password)
# net use w: \\nucleix.com\share /user:admin 9h7HYIK2I74R7JgET4VelGbWQuIr015a
net use w: \\$\share /user:$Secret.username $Secret.password
Add-Computer -DomainName $Secret.Domain -Credential $credential -Restart -Force
</powershell>