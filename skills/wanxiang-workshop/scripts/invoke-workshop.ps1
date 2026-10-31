param(
  [ValidateSet('health','snapshot','schema','info','revision','command','upload')][string]$Endpoint='snapshot',
  [string]$Operation,
  [string]$ArgumentsFile,
  [string]$ImagePath,
  [string]$WorldId,
  [string]$Generation,
  [string]$OutputFile,
  [string]$DescriptorPath
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'connection-errors.ps1')
$utf8=New-Object System.Text.UTF8Encoding($false)
if(-not $DescriptorPath){
  $DescriptorPath=$env:WANXIANG_CONNECTION_FILE
  if(-not $DescriptorPath){$DescriptorPath=$env:OC_STUDIO_CONNECTION_FILE}
  if(-not $DescriptorPath){
    $profileDirectory=$env:WANXIANG_USER_DATA_DIR
    if(-not $profileDirectory){$profileDirectory=$env:OC_STUDIO_USER_DATA_DIR}
    if(-not $profileDirectory){
      $legacyProfile=Join-Path $env:APPDATA 'oc-studio'
      if(Test-Path -LiteralPath $legacyProfile -PathType Container){$profileDirectory=$legacyProfile}
      else{$profileDirectory=Join-Path $env:APPDATA 'wanxiang'}
    }
    $DescriptorPath=Join-Path $profileDirectory 'connection.json'
  }
}
if(-not (Test-Path -LiteralPath $DescriptorPath -PathType Leaf)){throw '[CONNECTION_DESCRIPTOR_MISSING] 未找到指定连接文件。请从软件设置核对实际路径与服务状态；不能仅据文件缺失判断软件未运行。'}
try{$descriptorText=[IO.File]::ReadAllText($DescriptorPath,$utf8)}catch{throw '[CONNECTION_DESCRIPTOR_UNREADABLE] 连接文件无法读取，请核对路径和文件读取权限。'}
try{$connection=$descriptorText|ConvertFrom-Json;$address=[Uri]$connection.baseUrl}catch{throw '[CONNECTION_DESCRIPTOR_INVALID] 连接文件格式不正确，请从软件设置核对路径并重新读取；不要输出文件内容。'}
if(-not $address.IsAbsoluteUri -or $address.Scheme -ne 'http' -or $address.Host -ne '127.0.0.1' -or $address.AbsolutePath -ne '/' -or $address.UserInfo -or $address.Query -or $address.Fragment -or $connection.token -notmatch '^[a-f0-9]{64}$' -or -not $connection.instanceId){throw '[CONNECTION_DESCRIPTOR_INVALID] 连接文件格式不正确，请核对实际程序的连接文件。'}
$base=$address.GetLeftPart([UriPartial]::Authority)
try{$health=Invoke-RestMethod -Uri ($base+'/api/v1/health') -TimeoutSec 5 -Method Get}catch{throw (Format-WorkshopTransportFailure -Failure $_ -Context '健康检查')}
if($health.ok -ne $true -or $health.value.name -ne '万象工坊'){throw '[CONNECTION_HEALTH_INVALID] 本机端口有响应，但不是有效的万象工坊健康响应。请核对实际程序的服务状态与连接文件。'}
if($health.value.instanceId -ne $connection.instanceId){throw '[CONNECTION_INSTANCE_MISMATCH] 连接文件与响应实例不匹配。请从目标程序的软件设置重新确认连接文件；核对前不发送认证或内容请求。'}
$headers=@{Authorization=('Bearer '+$connection.token)}
if($Generation){
  if($Generation -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'){throw 'Generation 必须取自用于本次编辑的 snapshot.generation。'}
  $headers['X-Wanxiang-Generation']=$Generation
}
$parameters=@{Uri=($base+'/api/v1/'+$Endpoint);Method='Get';Headers=$headers;TimeoutSec=30}
if($Endpoint -eq 'command'){
  if($Operation -notmatch '^[a-zA-Z][a-zA-Z0-9]+$' -or -not $ArgumentsFile){throw '请提供 Operation 和 ArgumentsFile。'}
  $arguments=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $ArgumentsFile).Path,$utf8)
  if(-not $arguments.TrimStart().StartsWith('[')){throw 'ArgumentsFile 必须是 JSON 参数数组。'}
  $null=$arguments|ConvertFrom-Json
  $parameters.Uri=$base+'/api/v1/commands/'+$Operation
  $envelope='{"args":'+$arguments
  if($Generation){$envelope+=',"generation":"'+$Generation+'"'}
  $envelope+='}'
  $parameters.Method='Post';$parameters.ContentType='application/json; charset=utf-8';$parameters.Body=$utf8.GetBytes($envelope)
  if($Operation -in @('createBackupBaseline','runIncrementalBackup','previewBackupRestore','restoreBackup','deleteBackupPoint')){$parameters.TimeoutSec=600}
}elseif($Endpoint -eq 'upload'){
  if(-not $WorldId -or -not $ImagePath){throw '请提供 WorldId 和 ImagePath。'}
  $file=Get-Item -LiteralPath $ImagePath
  if($file.PSIsContainer -or $file.Length -gt 25MB){throw '请选择不超过 25 MB 的图片。'}
  $parameters.Uri=$base+'/api/v1/assets?worldId='+[Uri]::EscapeDataString($WorldId)+'&name='+[Uri]::EscapeDataString($file.Name)
  $parameters.Method='Post';$parameters.ContentType='application/octet-stream';$parameters.Body=[IO.File]::ReadAllBytes($file.FullName)
}
try{$result=Invoke-RestMethod @parameters}catch{
  $requestFailure=$_;$detail=$requestFailure.ErrorDetails.Message
  # Windows PowerShell 5.1 does not populate ErrorDetails for every HTTP error.
  # Read a bounded body only to recover our JSON business error, never echo it.
  if(-not $detail -and $requestFailure.Exception -is [Net.WebException] -and $requestFailure.Exception.Response){
    try{
      $reader=[IO.StreamReader]::new($requestFailure.Exception.Response.GetResponseStream(),$utf8)
      try{$buffer=New-Object char[] 65537;$count=$reader.ReadBlock($buffer,0,$buffer.Length);if($count -le 65536){$detail=[string]::new($buffer,0,$count)}}finally{$reader.Dispose()}
    }catch{ }
  }
  if($detail){
    try{$failure=$detail|ConvertFrom-Json}catch{$failure=$null}
    if($failure.error.code -match '^[A-Z][A-Z0-9_]{0,63}$' -and $failure.error.message -is [string]){throw ($failure.error.code+': '+$failure.error.message.Replace($connection.token,'[已隐藏]'))}
  }
  $message=Format-WorkshopTransportFailure -Failure $requestFailure -Context '接口请求'
  if($Endpoint -in @('command','upload')){$message+=' 请求可能已经送达；连接恢复后先读回核对结果，不自动重发保存、上传或恢复操作。'}
  throw $message
}
if(-not $result.ok){throw ($result.error.code+': '+$result.error.message)}
$json=ConvertTo-Json -InputObject $result -Depth 100
if($OutputFile){[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile),$json,$utf8)}else{$json}
