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
$DNS = (Get-SSMParameterValue -Name "DnsName").Parameters.Value
echo "echoing net use w: \\$DNS\share /user:$username ${$password| ConvertTo-SecureString -asPlainText -Force}"
net use w: \\$DNS\share /user:$username $password | ConvertTo-SecureString -asPlainText -Force
Add-Computer -DomainName $Secret.Domain -Credential $credential -Restart -Force
</powershell>