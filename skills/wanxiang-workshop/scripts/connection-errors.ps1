# Compatible with Windows PowerShell 5.1 and PowerShell 7. Do not emit exception
# messages, URLs, response bodies or request headers: they may contain credentials.
function Get-WorkshopTransportFailure {
  param([Parameter(Mandatory=$true)][System.Management.Automation.ErrorRecord]$Failure)
  $queue=New-Object 'System.Collections.Generic.Queue[System.Exception]'
  $seen=New-Object 'System.Collections.Generic.HashSet[System.Exception]'
  $types=@();$socketCodes=@();$nativeCodes=@();$webStatuses=@();$httpStatuses=@()
  $denied=$false;$refused=$false;$timedOut=$false;$cancelled=$false
  $queue.Enqueue($Failure.Exception)
  while($queue.Count -gt 0 -and $seen.Count -lt 32){
    $exception=$queue.Dequeue()
    if(-not $seen.Add($exception)){continue}
    $types+=$exception.GetType().FullName
    if($exception -is [System.UnauthorizedAccessException] -or $exception.HResult -eq -2147024891){$denied=$true}
    if($exception -is [System.TimeoutException]){$timedOut=$true}
    if($exception -is [System.OperationCanceledException]){$cancelled=$true}
    if($exception -is [System.Net.Sockets.SocketException]){
      $socketCodes+=[string]$exception.SocketErrorCode
      if($exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AccessDenied){$denied=$true}
      if($exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::ConnectionRefused){$refused=$true}
      if($exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::TimedOut){$timedOut=$true}
    }
    if($exception -is [System.ComponentModel.Win32Exception]){
      $nativeCodes+=[int]$exception.NativeErrorCode
      if($exception.NativeErrorCode -in @(5,10013)){$denied=$true}
    }
    if($exception -is [System.Net.WebException]){
      $webStatuses+=[string]$exception.Status
      if($exception.Status -eq [System.Net.WebExceptionStatus]::Timeout){$timedOut=$true}
      if($exception.Status -eq [System.Net.WebExceptionStatus]::RequestCanceled){$cancelled=$true}
    }
    # PS 5.1 uses WebException.Response; PS 7 uses HttpResponseException.Response
    # or HttpRequestException.StatusCode. Never inspect their text or headers.
    try {
      if($exception.PSObject.Properties['Response'] -and $null -ne $exception.Response -and $exception.Response.PSObject.Properties['StatusCode']){$httpStatuses+=[int]$exception.Response.StatusCode}
      if($exception.PSObject.Properties['StatusCode'] -and $null -ne $exception.StatusCode){$httpStatuses+=[int]$exception.StatusCode}
    } catch { }
    if($exception.InnerException){$queue.Enqueue($exception.InnerException)}
    if($exception -is [System.AggregateException]){foreach($inner in $exception.InnerExceptions){$queue.Enqueue($inner)}}
  }
  $code='CONNECTION_FAILED';$message='本机 API 请求失败，原因尚未确定。请核对软件设置中的服务状态和连接文件；不能据此判断软件未运行。'
  if($denied){
    $code='CONNECTION_ACCESS_DENIED';$message='本机端口访问被操作系统或执行环境拒绝，不能据此判断软件未运行。请核对执行权限和软件设置中的服务状态。'
  }elseif($refused){
    $code='CONNECTION_REFUSED';$message='连接文件指定的本机端口拒绝连接，服务可能尚未就绪、已经退出或连接文件已过期。请核对实际程序的服务状态与连接文件。'
  }elseif($timedOut){
    $code='CONNECTION_TIMEOUT';$message='本机 API 请求超时，尚不能判断服务是否运行。请核对服务状态；若涉及保存，先读取实际结果再决定是否重试。'
  }elseif($cancelled){
    $code='CONNECTION_CANCELLED';$message='本机 API 请求已取消，也可能由请求超时触发，不能据此判断软件未运行。请核对服务状态和实际结果。'
  }elseif($httpStatuses.Count -gt 0){
    $code='CONNECTION_HTTP_ERROR';$message='本机端口已返回 HTTP 错误。请按状态码核对接口和认证；这与套接字权限被拒绝不同，不表示软件未运行。'
  }
  $diagnostics=@('异常类型='+((@($types|Select-Object -Unique)) -join ' -> '))
  if($socketCodes.Count){$diagnostics+='SocketError='+((@($socketCodes|Select-Object -Unique)) -join ',')}
  if($nativeCodes.Count){$diagnostics+='NativeError='+((@($nativeCodes|Select-Object -Unique)) -join ',')}
  if($webStatuses.Count){$diagnostics+='WebStatus='+((@($webStatuses|Select-Object -Unique)) -join ',')}
  if($httpStatuses.Count){$diagnostics+='HTTP='+((@($httpStatuses|Select-Object -Unique)) -join ',')}
  return [pscustomobject]@{Code=$code;Message=$message;Diagnostics=($diagnostics -join '; ')}
}

function Format-WorkshopTransportFailure {
  param([Parameter(Mandatory=$true)][System.Management.Automation.ErrorRecord]$Failure,[string]$Context='接口请求')
  $diagnosis=Get-WorkshopTransportFailure -Failure $Failure
  return ('['+$diagnosis.Code+'] '+$Context+'：'+$diagnosis.Message+' 诊断：'+$diagnosis.Diagnostics)
}
