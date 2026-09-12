function Get-VolcengineVideoHeaders {
    param([string]$ApiKey)
    return @{
        "Accept" = "application/json"
        "Authorization" = "Bearer $ApiKey"
    }
}

function New-VolcengineVideoBody {
    param(
        $Model,
        $Payload
    )

    $mode = Get-PayloadText $Payload "mode" "text-to-video"
    $prompt = Get-PayloadText $Payload "prompt"
    $content = @()
    if (-not [string]::IsNullOrWhiteSpace($prompt)) {
        $content += ,([ordered]@{ type = "text"; text = $prompt })
    }

    $imageUrl = Get-PayloadText $Payload "imageUrl"
    if (-not [string]::IsNullOrWhiteSpace($imageUrl)) {
        $role = "first_frame"
        if ($mode -eq "reference-image") { $role = "reference_image" }
        $content += ,([ordered]@{ type = "image_url"; image_url = [ordered]@{ url = $imageUrl }; role = $role })
    }

    $endImageUrl = Get-PayloadText $Payload "endImageUrl"
    if (-not [string]::IsNullOrWhiteSpace($endImageUrl)) {
        $content += ,([ordered]@{ type = "image_url"; image_url = [ordered]@{ url = $endImageUrl }; role = "last_frame" })
    }

    $body = [ordered]@{
        model = [string]$Model.id
        content = $content
    }

    $ratio = Get-PayloadText $Payload "ratio"
    if (-not [string]::IsNullOrWhiteSpace($ratio)) { $body.ratio = $ratio }
    $duration = Get-PayloadText $Payload "duration"
    if (-not [string]::IsNullOrWhiteSpace($duration)) { $body.duration = [int]$duration }
    $resolution = Get-PayloadText $Payload "resolution"
    if (-not [string]::IsNullOrWhiteSpace($resolution)) { $body.resolution = $resolution }
    $seed = Get-PayloadText $Payload "seed"
    if (-not [string]::IsNullOrWhiteSpace($seed)) { $body.seed = [int]$seed }

    $generateAudio = Get-BodyField $Payload "generateAudio"
    if ($null -ne $generateAudio) { $body.generate_audio = [bool]$generateAudio }
    $watermark = Get-BodyField $Payload "watermark"
    if ($null -ne $watermark) { $body.watermark = [bool]$watermark }

    return $body
}

function Get-VolcengineTaskIdFromResponse {
    param($Content)
    try {
        $json = $Content | ConvertFrom-Json
        foreach ($path in @("id", "task_id", "request_id", "name")) {
            $property = $json.PSObject.Properties[$path]
            if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                return [string]$property.Value
            }
        }
        if ($json.output -and $json.output.task_id) { return [string]$json.output.task_id }
        if ($json.data -and $json.data.task_id) { return [string]$json.data.task_id }
        if ($json.uuid) { return [string]$json.uuid }
        if ($json.prompt_id) { return [string]$json.prompt_id }
    }
    catch {}
    return ""
}

function Invoke-VolcengineVideoCreate {
    param(
        $Provider,
        $Model,
        [string]$ApiKey,
        $Payload
    )

    $headers = Get-VolcengineVideoHeaders $ApiKey
    $uri = Join-ApiPath ([string]$Provider.baseUrl) "contents/generations/tasks"
    $body = New-VolcengineVideoBody $Model $Payload

    Write-ServerLog ("volcengine video create {0}" -f $Model.id)
    $result = Invoke-UpstreamRequest $uri "POST" $headers $body
    $providerTaskId = Get-VolcengineTaskIdFromResponse $result.content
    $envelope = [ordered]@{
        provider = [string]$Provider.key
        adapter = [string]$Provider.adapter
        provider_task_id = $providerTaskId
        status = $result.status
        upstream = $null
    }
    try { $envelope.upstream = ($result.content | ConvertFrom-Json) }
    catch { $envelope.upstream = $result.content }
    $result.content = ($envelope | ConvertTo-Json -Depth 100 -Compress)
    return $result
}

function Invoke-VolcengineVideoTask {
    param(
        $Provider,
        [string]$ApiKey,
        [string]$ProviderTaskId
    )

    $headers = Get-VolcengineVideoHeaders $ApiKey
    $uri = Join-ApiPath ([string]$Provider.baseUrl) "contents/generations/tasks/$ProviderTaskId"
    Write-ServerLog ("volcengine video task {0}" -f $ProviderTaskId)
    return Invoke-UpstreamRequest $uri "GET" $headers
}
