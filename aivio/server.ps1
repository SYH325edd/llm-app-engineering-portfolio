param(
    [int]$Port = 8787,
    [string]$Root = (Join-Path $PSScriptRoot "public")
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

. (Join-Path $PSScriptRoot "server\providers\volcengine.ps1")
. (Join-Path $PSScriptRoot "server\providers\provider-interface.ps1")
. (Join-Path $PSScriptRoot "server\tasks\generation-tasks.ps1")

function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { continue }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

function Read-ConfigJson {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing config file: $Path"
    }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Convert-JsonItems {
    param($Items)
    $result = @()
    if ($null -eq $Items) { return $result }
    foreach ($item in @($Items)) {
        $result += ,(Convert-ToPlain $item)
    }
    return $result
}

function Initialize-ModelConfig {
    $configRoot = Join-Path $PSScriptRoot "config"
    $providerConfig = Read-ConfigJson (Join-Path $configRoot "providers.json")
    $modelConfig = Read-ConfigJson (Join-Path $configRoot "models.json")

    $script:ConfiguredProviders = Convert-JsonItems $providerConfig.providers
    $script:ConfiguredModels = Convert-JsonItems $modelConfig.models
    $script:ConfiguredProviderMap = @{}
    $script:ConfiguredModelMap = @{}

    foreach ($provider in $script:ConfiguredProviders) {
        $script:ConfiguredProviderMap[[string]$provider.key] = $provider
    }
    foreach ($model in $script:ConfiguredModels) {
        $script:ConfiguredModelMap[[string]$model.id] = $model
    }
}

function Get-ConfiguredProvider {
    param([string]$ProviderKey)
    if ([string]::IsNullOrWhiteSpace($ProviderKey)) { return $null }
    return $script:ConfiguredProviderMap[$ProviderKey]
}

function Get-ConfiguredModel {
    param([string]$ModelId)
    if ([string]::IsNullOrWhiteSpace($ModelId)) { return $null }
    return $script:ConfiguredModelMap[$ModelId]
}

function Get-EnabledVideoModels {
    return @($script:ConfiguredModels | Where-Object { $_.enabled -eq $true -and $_.modelType -eq "video" })
}

function Get-ProviderApiKey {
    param($Provider)
    $envName = [string]$Provider.apiKeyEnvName
    if ([string]::IsNullOrWhiteSpace($envName)) {
        throw "Provider '$($Provider.key)' is missing apiKeyEnvName in config/providers.json."
    }
    $apiKey = [Environment]::GetEnvironmentVariable($envName, "Process")
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        $apiKey = [Environment]::GetEnvironmentVariable($envName, "User")
    }
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        $apiKey = [Environment]::GetEnvironmentVariable($envName, "Machine")
    }
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        throw "Missing API key environment variable '$envName'. Create .env from .env.example or set $envName before starting the server."
    }
    return $apiKey
}

function Get-EnvValue {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return "" }
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($Name, "User") }
    if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($Name, "Machine") }
    return $value
}

function Get-RelayApiKeyEnvName {
    param([string]$ProviderId)
    switch ($ProviderId) {
        "github" { return "GITHUB_MODELS_API_KEY" }
        "openai" { return "OPENAI_API_KEY" }
        "volcengine" { return "VOLCENGINE_ARK_API_KEY" }
        "openrouter" { return "OPENROUTER_API_KEY" }
        "deepseek" { return "DEEPSEEK_API_KEY" }
        "qwen" { return "DASHSCOPE_API_KEY" }
        "siliconflow" { return "SILICONFLOW_API_KEY" }
        "moonshot" { return "MOONSHOT_API_KEY" }
        "zhipu" { return "ZHIPU_API_KEY" }
        "baidu-qianfan" { return "QIANFAN_API_KEY" }
        "tencent-hunyuan" { return "HUNYUAN_API_KEY" }
        "minimax" { return "MINIMAX_API_KEY" }
        "stepfun" { return "STEPFUN_API_KEY" }
        "baichuan" { return "BAICHUAN_API_KEY" }
        "lingyiwanwu" { return "LINGYIWANWU_API_KEY" }
        "modelscope" { return "MODELSCOPE_API_KEY" }
        "groq" { return "GROQ_API_KEY" }
        "mistral" { return "MISTRAL_API_KEY" }
        "xai" { return "XAI_API_KEY" }
        "together" { return "TOGETHER_API_KEY" }
        "perplexity" { return "PERPLEXITY_API_KEY" }
        "fireworks" { return "FIREWORKS_API_KEY" }
        "cerebras" { return "CEREBRAS_API_KEY" }
        "nvidia" { return "NVIDIA_API_KEY" }
        "huggingface" { return "HUGGINGFACE_API_KEY" }
        "anthropic" { return "ANTHROPIC_API_KEY" }
        "gemini" { return "GEMINI_API_KEY" }
        "ollama" { return "" }
        "lmstudio" { return "" }
        "vllm" { return "" }
        "llamacpp" { return "" }
        default { return "" }
    }
}

function Get-RelayApiKey {
    param([string]$ProviderId)
    $envName = Get-RelayApiKeyEnvName $ProviderId
    if ([string]::IsNullOrWhiteSpace($envName)) { return "" }
    return Get-EnvValue $envName
}

function Get-ProviderStatus {
    param($Provider)
    $envName = Get-RelayApiKeyEnvName ([string]$Provider.id)
    $requiresKey = -not [string]::IsNullOrWhiteSpace($envName)
    return [ordered]@{
        id = [string]$Provider.id
        name = [string]$Provider.name
        type = [string]$Provider.type
        models = $Provider.models
        enabled = $true
        requiresKey = $requiresKey
        configured = ((-not $requiresKey) -or (-not [string]::IsNullOrWhiteSpace((Get-EnvValue $envName))))
    }
}

Import-DotEnv (Join-Path $PSScriptRoot ".env")

$script:ProviderList = @(
    [ordered]@{ id = "github"; name = "GitHub Models"; type = "openai"; baseUrl = "https://models.github.ai/inference"; models = @("openai/gpt-4.1", "openai/gpt-4o-mini", "meta/Llama-3.3-70B-Instruct") },
    [ordered]@{ id = "openai"; name = "OpenAI"; type = "openai"; baseUrl = "https://api.openai.com/v1"; models = @("gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini") },
    [ordered]@{ id = "volcengine"; name = "Doubao / Volcengine Ark"; type = "openai"; baseUrl = "https://ark.cn-beijing.volces.com/api/v3"; models = @("doubao-seed-1-6-250615", "doubao-seed-1-6-thinking-250615", "doubao-seed-1-6-flash-250615", "doubao-1-5-pro-32k-250115", "doubao-1-5-lite-32k-250115", "doubao-1-5-vision-pro-32k-250115") },
    [ordered]@{ id = "openrouter"; name = "OpenRouter"; type = "openai"; baseUrl = "https://openrouter.ai/api/v1"; models = @("openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5") },
    [ordered]@{ id = "deepseek"; name = "DeepSeek"; type = "openai"; baseUrl = "https://api.deepseek.com/v1"; models = @("deepseek-chat", "deepseek-reasoner") },
    [ordered]@{ id = "qwen"; name = "Qwen DashScope"; type = "openai"; baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"; models = @("qwen-plus", "qwen-max", "qwen-turbo") },
    [ordered]@{ id = "siliconflow"; name = "SiliconFlow"; type = "openai"; baseUrl = "https://api.siliconflow.cn/v1"; models = @("deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct") },
    [ordered]@{ id = "moonshot"; name = "Moonshot"; type = "openai"; baseUrl = "https://api.moonshot.cn/v1"; models = @("moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k") },
    [ordered]@{ id = "zhipu"; name = "Zhipu GLM"; type = "openai"; baseUrl = "https://open.bigmodel.cn/api/paas/v4"; models = @("glm-4", "glm-4-flash") },
    [ordered]@{ id = "baidu-qianfan"; name = "Baidu Qianfan / ERNIE"; type = "openai"; baseUrl = "https://qianfan.baidubce.com/v2"; models = @("ernie-4.5-turbo-128k", "ernie-4.0-turbo-8k", "ernie-speed-128k") },
    [ordered]@{ id = "tencent-hunyuan"; name = "Tencent Hunyuan"; type = "openai"; baseUrl = "https://api.hunyuan.cloud.tencent.com/v1"; models = @("hunyuan-turbos-latest", "hunyuan-large", "hunyuan-a13b") },
    [ordered]@{ id = "minimax"; name = "MiniMax"; type = "openai"; baseUrl = "https://api.minimax.chat/v1"; models = @("MiniMax-Text-01", "MiniMax-M1", "abab6.5s-chat") },
    [ordered]@{ id = "stepfun"; name = "StepFun"; type = "openai"; baseUrl = "https://api.stepfun.com/v1"; models = @("step-2-16k", "step-1-8k", "step-1-flash") },
    [ordered]@{ id = "baichuan"; name = "Baichuan"; type = "openai"; baseUrl = "https://api.baichuan-ai.com/v1"; models = @("Baichuan4", "Baichuan3-Turbo", "Baichuan3-Turbo-128k") },
    [ordered]@{ id = "lingyiwanwu"; name = "01.AI / Yi"; type = "openai"; baseUrl = "https://api.lingyiwanwu.com/v1"; models = @("yi-large", "yi-medium", "yi-lightning") },
    [ordered]@{ id = "modelscope"; name = "ModelScope"; type = "openai"; baseUrl = "https://api-inference.modelscope.cn/v1"; models = @("Qwen/Qwen3-235B-A22B", "deepseek-ai/DeepSeek-V3", "ZhipuAI/GLM-4.5") },
    [ordered]@{ id = "groq"; name = "Groq"; type = "openai"; baseUrl = "https://api.groq.com/openai/v1"; models = @("llama-3.3-70b-versatile", "llama-3.1-8b-instant") },
    [ordered]@{ id = "mistral"; name = "Mistral"; type = "openai"; baseUrl = "https://api.mistral.ai/v1"; models = @("mistral-large-latest", "mistral-small-latest") },
    [ordered]@{ id = "xai"; name = "xAI"; type = "openai"; baseUrl = "https://api.x.ai/v1"; models = @("grok-2-latest", "grok-2-vision-latest") },
    [ordered]@{ id = "together"; name = "Together AI"; type = "openai"; baseUrl = "https://api.together.xyz/v1"; models = @("meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo") },
    [ordered]@{ id = "perplexity"; name = "Perplexity"; type = "openai"; baseUrl = "https://api.perplexity.ai"; models = @("sonar", "sonar-pro") },
    [ordered]@{ id = "fireworks"; name = "Fireworks AI"; type = "openai"; baseUrl = "https://api.fireworks.ai/inference/v1"; models = @("accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3", "accounts/fireworks/models/qwen2p5-72b-instruct") },
    [ordered]@{ id = "cerebras"; name = "Cerebras"; type = "openai"; baseUrl = "https://api.cerebras.ai/v1"; models = @("llama3.1-8b", "llama-3.3-70b", "qwen-3-32b") },
    [ordered]@{ id = "nvidia"; name = "NVIDIA NIM"; type = "openai"; baseUrl = "https://integrate.api.nvidia.com/v1"; models = @("meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct", "qwen/qwen2.5-coder-32b-instruct") },
    [ordered]@{ id = "huggingface"; name = "Hugging Face Router"; type = "openai"; baseUrl = "https://router.huggingface.co/v1"; models = @("meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3") },
    [ordered]@{ id = "anthropic"; name = "Anthropic Claude"; type = "anthropic"; baseUrl = "https://api.anthropic.com/v1"; models = @("claude-3-5-sonnet-latest", "claude-3-5-haiku-latest") },
    [ordered]@{ id = "gemini"; name = "Google Gemini"; type = "gemini"; baseUrl = "https://generativelanguage.googleapis.com/v1beta"; models = @("gemini-1.5-pro", "gemini-1.5-flash") },
    [ordered]@{ id = "ollama"; name = "Ollama Local"; type = "openai"; baseUrl = "http://127.0.0.1:11434/v1"; models = @("llama3.2", "qwen2.5", "deepseek-r1") },
    [ordered]@{ id = "lmstudio"; name = "LM Studio Local"; type = "openai"; baseUrl = "http://127.0.0.1:1234/v1"; models = @("local-model") },
    [ordered]@{ id = "vllm"; name = "vLLM Local"; type = "openai"; baseUrl = "http://127.0.0.1:8000/v1"; models = @("served-model") },
    [ordered]@{ id = "llamacpp"; name = "llama.cpp Local"; type = "openai"; baseUrl = "http://127.0.0.1:8080/v1"; models = @("local-model") },
    [ordered]@{ id = "custom"; name = "Custom OpenAI Compatible"; type = "openai"; baseUrl = ""; models = @("") }
)

$script:ProviderMap = @{}
foreach ($provider in $script:ProviderList) {
    $script:ProviderMap[$provider.id] = $provider
}

function Write-ServerLog {
    param([string]$Message)
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Get-StatusText {
    param([int]$StatusCode)
    switch ($StatusCode) {
        200 { return "OK" }
        204 { return "No Content" }
        400 { return "Bad Request" }
        403 { return "Forbidden" }
        404 { return "Not Found" }
        405 { return "Method Not Allowed" }
        500 { return "Internal Server Error" }
        default { return "OK" }
    }
}

function Send-Bytes {
    param(
        $Context,
        [int]$StatusCode,
        [byte[]]$Bytes,
        [string]$ContentType
    )
    $statusText = Get-StatusText $StatusCode
    $headerText = @(
        "HTTP/1.1 $StatusCode $statusText",
        "Content-Type: $ContentType",
        "Content-Length: $($Bytes.Length)",
        "Access-Control-Allow-Origin: *",
        "Access-Control-Allow-Headers: Authorization, Content-Type, X-Relay-Provider, X-Relay-Base-Url, X-Relay-Api-Type, X-Upstream-API-Key",
        "Access-Control-Allow-Methods: GET, POST, OPTIONS",
        "Cache-Control: no-store",
        "Connection: close",
        "",
        ""
    ) -join "`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
    $Context.Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Bytes.Length -gt 0) {
        $Context.Stream.Write($Bytes, 0, $Bytes.Length)
    }
    $Context.Stream.Flush()
    $Context.Client.Close()
}

function Send-Text {
    param(
        $Context,
        [int]$StatusCode,
        [string]$Text,
        [string]$ContentType = "text/plain; charset=utf-8"
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    Send-Bytes $Context $StatusCode $bytes $ContentType
}

function Send-Json {
    param(
        $Context,
        [int]$StatusCode,
        $Value
    )
    $json = $Value | ConvertTo-Json -Depth 80 -Compress
    Send-Text $Context $StatusCode $json "application/json; charset=utf-8"
}

function Get-HeaderValue {
    param(
        $Request,
        [string]$Name
    )
    $value = $Request.Headers[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    return $value.Trim()
}

function Get-RequestBody {
    param($Request)
    return [string]$Request.Body
}

function Convert-ToPlain {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $hash = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) {
            $hash[$property.Name] = Convert-ToPlain $property.Value
        }
        return $hash
    }
    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string]) -and -not ($Value -is [System.Collections.IDictionary])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(Convert-ToPlain $item)
        }
        return $items
    }
    return $Value
}

Initialize-ModelConfig

function Get-BodyField {
    param(
        $Payload,
        [string]$Name
    )
    if ($null -eq $Payload) { return $null }
    $property = $Payload.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function New-UpstreamPayload {
    param($Payload)
    $skip = @("provider", "apiKey", "baseUrl", "apiType", "path", "relay")
    $body = [ordered]@{}
    foreach ($property in $Payload.PSObject.Properties) {
        if ($skip -contains $property.Name) { continue }
        $body[$property.Name] = Convert-ToPlain $property.Value
    }
    if ($body.Contains("stream")) {
        $body["stream"] = $false
    }
    return $body
}

function Join-ApiPath {
    param(
        [string]$BaseUrl,
        [string]$Path
    )
    $trimmedBase = $BaseUrl.TrimEnd("/")
    $trimmedPath = $Path.TrimStart("/")
    if ($trimmedBase.ToLowerInvariant().EndsWith("/$($trimmedPath.ToLowerInvariant())")) {
        return $trimmedBase
    }
    return "$trimmedBase/$trimmedPath"
}

function Get-TextContent {
    param($Content)
    if ($null -eq $Content) { return "" }
    if ($Content -is [string]) { return $Content }

    $pieces = @()
    if (($Content -is [System.Collections.IEnumerable]) -and -not ($Content -is [string])) {
        foreach ($part in $Content) {
            if ($part -is [string]) {
                $pieces += $part
                continue
            }
            $textProperty = $part.PSObject.Properties["text"]
            if ($null -ne $textProperty) {
                $pieces += [string]$textProperty.Value
                continue
            }
            $typeProperty = $part.PSObject.Properties["type"]
            if (($null -ne $typeProperty) -and ([string]$typeProperty.Value -eq "text")) {
                $pieces += [string]$part.text
            }
        }
        return ($pieces -join "`n")
    }

    $contentText = $Content.PSObject.Properties["text"]
    if ($null -ne $contentText) { return [string]$contentText.Value }
    return [string]$Content
}

function Merge-RoleMessage {
    param(
        [array]$Messages,
        [string]$Role,
        [string]$Content
    )
    if ($Messages.Count -gt 0) {
        $last = $Messages[$Messages.Count - 1]
        if ($last["role"] -eq $Role) {
            $last["content"] = (($last["content"], $Content) -join "`n`n").Trim()
            return $Messages
        }
    }
    return @($Messages + ,([ordered]@{ role = $Role; content = $Content }))
}

function Invoke-UpstreamJson {
    param(
        [string]$Uri,
        [hashtable]$Headers,
        $Payload
    )
    $json = $Payload | ConvertTo-Json -Depth 80 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    try {
        $response = Invoke-WebRequest -Uri $Uri -Method Post -Headers $Headers -Body $bytes -ContentType "application/json" -UseBasicParsing -TimeoutSec 180
        return [ordered]@{
            status = [int]$response.StatusCode
            content = [string]$response.Content
            contentType = "application/json; charset=utf-8"
        }
    }
    catch [System.Net.WebException] {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) {
            $errorBody = [ordered]@{
                error = [ordered]@{
                    message = $_.Exception.Message
                    upstream_url = $Uri
                    hint = "Local relay received the request, but could not connect to the upstream provider. Check Base URL, network, proxy/VPN, firewall, and provider availability from this computer."
                }
            }
            return [ordered]@{
                status = 502
                content = ($errorBody | ConvertTo-Json -Depth 20 -Compress)
                contentType = "application/json; charset=utf-8"
            }
        }

        $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
        try {
            $content = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
            $webResponse.Dispose()
        }

        return [ordered]@{
            status = [int]$webResponse.StatusCode
            content = $content
            contentType = "application/json; charset=utf-8"
        }
    }
}

function Invoke-UpstreamRequest {
    param(
        [string]$Uri,
        [string]$Method,
        [hashtable]$Headers,
        $Payload = $null,
        [string]$ContentType = "application/json"
    )
    $params = @{
        Uri = $Uri
        Method = $Method
        Headers = $Headers
        UseBasicParsing = $true
        TimeoutSec = 180
    }
    if ($null -ne $Payload) {
        if ($Payload -is [string]) {
            $bodyText = $Payload
        }
        else {
            $bodyText = $Payload | ConvertTo-Json -Depth 100 -Compress
        }
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($bodyText)
        $params.ContentType = $ContentType
    }

    try {
        $response = Invoke-WebRequest @params
        return [ordered]@{
            status = [int]$response.StatusCode
            content = [string]$response.Content
            contentType = "application/json; charset=utf-8"
        }
    }
    catch [System.Net.WebException] {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) {
            $errorBody = [ordered]@{
                error = [ordered]@{
                    message = $_.Exception.Message
                    upstream_url = $Uri
                    hint = "Local relay received the request, but could not connect to the upstream provider. Check Base URL, network, proxy/VPN, firewall, and provider availability from this computer."
                }
            }
            return [ordered]@{
                status = 502
                content = ($errorBody | ConvertTo-Json -Depth 20 -Compress)
                contentType = "application/json; charset=utf-8"
            }
        }

        $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
        try {
            $content = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
            $webResponse.Dispose()
        }

        return [ordered]@{
            status = [int]$webResponse.StatusCode
            content = $content
            contentType = "application/json; charset=utf-8"
        }
    }
}

function New-OpenAIHeaders {
    param(
        [string]$ApiKey,
        [string]$ProviderId
    )
    $headers = @{
        "Authorization" = "Bearer $ApiKey"
        "Accept" = "application/json"
    }
    if ($ProviderId -eq "github") {
        $headers["X-GitHub-Api-Version"] = "2026-03-10"
        $headers["Accept"] = "application/vnd.github+json"
    }
    if ($ProviderId -eq "openrouter") {
        $headers["HTTP-Referer"] = "http://localhost:$Port"
        $headers["X-Title"] = "API Relay Console"
    }
    return $headers
}

function Invoke-OpenAICompatible {
    param(
        [string]$ProviderId,
        [string]$BaseUrl,
        [string]$ApiKey,
        $Payload
    )
    $uri = Join-ApiPath $BaseUrl "chat/completions"
    $headers = New-OpenAIHeaders $ApiKey $ProviderId
    return Invoke-UpstreamJson $uri $headers $Payload
}

function Invoke-Anthropic {
    param(
        [string]$BaseUrl,
        [string]$ApiKey,
        $Payload
    )
    $systemParts = @()
    $messages = @()
    foreach ($message in $Payload.messages) {
        $role = [string]$message.role
        $content = (Get-TextContent $message.content).Trim()
        if ([string]::IsNullOrWhiteSpace($content)) { continue }
        if (($role -eq "system") -or ($role -eq "developer")) {
            $systemParts += $content
            continue
        }
        $anthropicRole = "user"
        if ($role -eq "assistant") { $anthropicRole = "assistant" }
        $messages = Merge-RoleMessage $messages $anthropicRole $content
    }

    $body = [ordered]@{
        model = $Payload.model
        max_tokens = 4096
        messages = $messages
    }
    if ($Payload.Contains("max_tokens")) { $body.max_tokens = [int]$Payload.max_tokens }
    if ($Payload.Contains("temperature")) { $body.temperature = $Payload.temperature }
    if ($Payload.Contains("top_p")) { $body.top_p = $Payload.top_p }
    if ($systemParts.Count -gt 0) { $body.system = ($systemParts -join "`n`n") }

    $uri = Join-ApiPath $BaseUrl "messages"
    $headers = @{
        "x-api-key" = $ApiKey
        "anthropic-version" = "2023-06-01"
        "Accept" = "application/json"
    }
    $upstream = Invoke-UpstreamJson $uri $headers $body
    if ($upstream.status -lt 200 -or $upstream.status -ge 300) { return $upstream }

    try {
        $raw = $upstream.content | ConvertFrom-Json
        $text = (($raw.content | ForEach-Object { if ($_.text) { $_.text } }) -join "`n").Trim()
        $inputTokens = 0
        $outputTokens = 0
        if ($raw.usage) {
            if ($raw.usage.input_tokens) { $inputTokens = [int]$raw.usage.input_tokens }
            if ($raw.usage.output_tokens) { $outputTokens = [int]$raw.usage.output_tokens }
        }
        $normalized = [ordered]@{
            id = $raw.id
            object = "chat.completion"
            created = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            model = $raw.model
            choices = @(
                [ordered]@{
                    index = 0
                    message = [ordered]@{ role = "assistant"; content = $text }
                    finish_reason = $raw.stop_reason
                }
            )
            usage = [ordered]@{
                prompt_tokens = $inputTokens
                completion_tokens = $outputTokens
                total_tokens = ($inputTokens + $outputTokens)
            }
            raw = Convert-ToPlain $raw
        }
        $upstream.content = ($normalized | ConvertTo-Json -Depth 80 -Compress)
        return $upstream
    }
    catch {
        return $upstream
    }
}

function Invoke-Gemini {
    param(
        [string]$BaseUrl,
        [string]$ApiKey,
        $Payload
    )
    $systemParts = @()
    $contents = @()
    foreach ($message in $Payload.messages) {
        $role = [string]$message.role
        $content = (Get-TextContent $message.content).Trim()
        if ([string]::IsNullOrWhiteSpace($content)) { continue }
        if (($role -eq "system") -or ($role -eq "developer")) {
            $systemParts += $content
            continue
        }
        $geminiRole = "user"
        if ($role -eq "assistant") { $geminiRole = "model" }
        if (($contents.Count -gt 0) -and ($contents[$contents.Count - 1]["role"] -eq $geminiRole)) {
            $contents[$contents.Count - 1]["parts"] += ,([ordered]@{ text = $content })
        }
        else {
            $contents += ,([ordered]@{ role = $geminiRole; parts = @([ordered]@{ text = $content }) })
        }
    }

    $body = [ordered]@{ contents = $contents }
    if ($systemParts.Count -gt 0) {
        $body.systemInstruction = [ordered]@{ parts = @([ordered]@{ text = ($systemParts -join "`n`n") }) }
    }
    $generationConfig = [ordered]@{}
    if ($Payload.Contains("temperature")) { $generationConfig.temperature = $Payload.temperature }
    if ($Payload.Contains("top_p")) { $generationConfig.topP = $Payload.top_p }
    if ($Payload.Contains("max_tokens")) { $generationConfig.maxOutputTokens = [int]$Payload.max_tokens }
    if ($generationConfig.Count -gt 0) { $body.generationConfig = $generationConfig }

    $model = [string]$Payload.model
    if ($model.StartsWith("models/")) {
        $path = "$($model):generateContent"
    }
    else {
        $path = "models/$($model):generateContent"
    }
    $uri = (Join-ApiPath $BaseUrl $path)
    $separator = "?"
    if ($uri.Contains("?")) { $separator = "&" }
    $uri = "$uri$separator`key=$([Uri]::EscapeDataString($ApiKey))"

    $headers = @{ "Accept" = "application/json" }
    $upstream = Invoke-UpstreamJson $uri $headers $body
    if ($upstream.status -lt 200 -or $upstream.status -ge 300) { return $upstream }

    try {
        $raw = $upstream.content | ConvertFrom-Json
        $candidate = $raw.candidates | Select-Object -First 1
        $text = ""
        if ($candidate.content.parts) {
            $text = (($candidate.content.parts | ForEach-Object { if ($_.text) { $_.text } }) -join "`n").Trim()
        }
        $finishReason = $candidate.finishReason
        $normalized = [ordered]@{
            id = "gemini-$([Guid]::NewGuid().ToString("N"))"
            object = "chat.completion"
            created = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            model = $model
            choices = @(
                [ordered]@{
                    index = 0
                    message = [ordered]@{ role = "assistant"; content = $text }
                    finish_reason = $finishReason
                }
            )
            usage = Convert-ToPlain $raw.usageMetadata
            raw = Convert-ToPlain $raw
        }
        $upstream.content = ($normalized | ConvertTo-Json -Depth 80 -Compress)
        return $upstream
    }
    catch {
        return $upstream
    }
}

function Get-QueryParam {
    param(
        [System.Uri]$Url,
        [string]$Name
    )
    $query = $Url.Query
    if ([string]::IsNullOrWhiteSpace($query)) { return $null }
    $query = $query.TrimStart("?")
    foreach ($pair in ($query -split "&")) {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $parts = $pair.Split("=", 2)
        $key = [Uri]::UnescapeDataString($parts[0])
        if ($key -ne $Name) { continue }
        if ($parts.Count -eq 1) { return "" }
        return [Uri]::UnescapeDataString($parts[1].Replace("+", " "))
    }
    return $null
}

function Get-PayloadText {
    param(
        $Payload,
        [string]$Name,
        [string]$Default = ""
    )
    $value = Get-BodyField $Payload $Name
    if ($null -eq $value) { return $Default }
    return [string]$value
}

function New-GenerationTaskParams {
    param($Payload)
    $skip = @("provider", "apiKey", "baseUrl", "apiType", "path", "relay", "model", "modelId", "prompt")
    $params = [ordered]@{}
    foreach ($property in $Payload.PSObject.Properties) {
        if ($skip -contains $property.Name) { continue }
        $params[$property.Name] = Convert-ToPlain $property.Value
    }
    return $params
}

function Get-ErrorMessageFromValue {
    param($Value)
    if ($null -eq $Value) { return "" }
    try {
        if ($Value.error -and $Value.error.message) { return [string]$Value.error.message }
        if ($Value.message) { return [string]$Value.message }
        if ($Value.errorMessage) { return [string]$Value.errorMessage }
    } catch {}
    if ($Value -is [string]) { return $Value }
    try { return ($Value | ConvertTo-Json -Depth 20 -Compress) } catch { return [string]$Value }
}

function Get-ResultUrlFromValue {
    param($Value)
    if ($null -eq $Value) { return "" }
    try {
        foreach ($name in @("resultUrl", "result_url", "video_url", "url")) {
            $property = $Value.PSObject.Properties[$name]
            if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                return [string]$property.Value
            }
        }
        if ($Value.output) {
            foreach ($name in @("video_url", "result_url", "url")) {
                $property = $Value.output.PSObject.Properties[$name]
                if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                    return [string]$property.Value
                }
            }
            if ($Value.output.video -and $Value.output.video.url) { return [string]$Value.output.video.url }
            if ($Value.output.videos -and $Value.output.videos.Count -gt 0 -and $Value.output.videos[0].url) {
                return [string]$Value.output.videos[0].url
            }
        }
        if ($Value.data -and $Value.data.url) { return [string]$Value.data.url }
    } catch {}
    return ""
}

function Handle-VideoGeneration {
    param($Context)
    $rawBody = Get-RequestBody $Context.Request
    if ([string]::IsNullOrWhiteSpace($rawBody)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Request body is empty." } })
        return
    }
    try { $payload = $rawBody | ConvertFrom-Json }
    catch {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Request body must be valid JSON." } })
        return
    }

    $modelId = Get-BodyField $payload "modelId"
    if ([string]::IsNullOrWhiteSpace($modelId)) { $modelId = Get-BodyField $payload "model" }
    if ([string]::IsNullOrWhiteSpace($modelId)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "modelId is required." } })
        return
    }
    $model = Get-ConfiguredModel $modelId
    if (($null -eq $model) -or ($model.enabled -ne $true) -or ($model.modelType -ne "video")) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Video model '$modelId' is not configured or enabled." } })
        return
    }
    $provider = Get-ConfiguredProvider ([string]$model.provider)
    if (($null -eq $provider) -or ($provider.enabled -ne $true)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Provider '$($model.provider)' is not configured or enabled." } })
        return
    }
    $prompt = Get-PayloadText $payload "prompt"
    if ([string]::IsNullOrWhiteSpace($prompt)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Prompt is required." } })
        return
    }

    try {
        try { $apiKey = Get-ProviderApiKey $provider }
        catch {
            Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = $_.Exception.Message } })
            return
        }
        $taskType = Get-PayloadText $payload "mode" "text-to-video"
        $taskParams = New-GenerationTaskParams $payload
        $task = New-GenerationTask ([string]$provider.key) ([string]$model.id) ([string]$model.displayName) $taskType $prompt $taskParams
        Update-GenerationTask $task.id @{ status = "processing" } | Out-Null

        $result = Invoke-VideoProviderCreate $provider $model $apiKey $payload
        $upstreamEnvelope = $null
        try { $upstreamEnvelope = $result.content | ConvertFrom-Json } catch {}
        $providerTaskId = ""
        if ($null -ne $upstreamEnvelope -and $upstreamEnvelope.provider_task_id) {
            $providerTaskId = [string]$upstreamEnvelope.provider_task_id
        }

        if ([int]$result.status -ge 400) {
            $task = Update-GenerationTask $task.id @{
                status = "failed"
                providerTaskId = $providerTaskId
                resultRaw = $upstreamEnvelope
                errorMessage = Get-ErrorMessageFromValue $upstreamEnvelope
            }
        }
        else {
            $task = Update-GenerationTask $task.id @{
                status = "processing"
                providerTaskId = $providerTaskId
                resultRaw = $upstreamEnvelope
                resultUrl = Get-ResultUrlFromValue $upstreamEnvelope
            }
        }

        $response = [ordered]@{
            task_id = $task.id
            provider_task_id = $providerTaskId
            provider = [string]$provider.key
            modelId = [string]$model.id
            status = $task.status
            task = $task
            upstream = $upstreamEnvelope
        }
        Send-Json $Context ([int]$result.status) $response
    }
    catch {
        Send-Json $Context 500 ([ordered]@{ error = [ordered]@{ message = $_.Exception.Message } })
    }
}

function Handle-VideoTask {
    param(
        $Context,
        [string]$PathTaskId = ""
    )
    $taskId = $PathTaskId
    if ([string]::IsNullOrWhiteSpace($taskId)) {
        $taskId = Get-QueryParam $Context.Request.Url "taskId"
    }
    if ([string]::IsNullOrWhiteSpace($taskId)) {
        try {
            $tasks = Get-GenerationTasks
            Send-Json $Context 200 ([ordered]@{ tasks = $tasks })
        }
        catch {
            Send-Json $Context 500 ([ordered]@{ error = [ordered]@{ message = $_.Exception.Message } })
        }
        return
    }

    try {
        $task = Get-GenerationTask $taskId
        if ($null -eq $task) {
            Send-Json $Context 404 ([ordered]@{ error = [ordered]@{ message = "Local generation task '$taskId' was not found." } })
            return
        }
        if ([string]::IsNullOrWhiteSpace([string]$task.providerTaskId)) {
            Send-Json $Context 200 ([ordered]@{ task_id = $task.id; status = $task.status; task = $task })
            return
        }
        if (@("succeeded", "failed", "cancelled") -contains [string]$task.status) {
            Send-Json $Context 200 ([ordered]@{ task_id = $task.id; status = $task.status; task = $task })
            return
        }

        $provider = Get-ConfiguredProvider ([string]$task.provider)
        if (($null -eq $provider) -or ($provider.enabled -ne $true)) {
            Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Provider '$($task.provider)' is not configured or enabled." } })
            return
        }
        try { $apiKey = Get-ProviderApiKey $provider }
        catch {
            Send-Json $Context 200 ([ordered]@{
                task_id = $task.id
                status = $task.status
                task = $task
                warning = $_.Exception.Message
            })
            return
        }
        $result = Invoke-VideoProviderTask $provider $apiKey ([string]$task.providerTaskId)
        $upstream = $null
        try { $upstream = $result.content | ConvertFrom-Json } catch { $upstream = $result.content }
        if ([int]$result.status -ge 400) {
            $task = Update-GenerationTask $task.id @{
                status = "failed"
                resultRaw = $upstream
                errorMessage = Get-ErrorMessageFromValue $upstream
            }
        }
        else {
            $nextStatus = "processing"
            $rawStatus = ""
            try {
                if ($upstream.status) { $rawStatus = ([string]$upstream.status).ToLowerInvariant() }
                elseif ($upstream.output -and $upstream.output.status) { $rawStatus = ([string]$upstream.output.status).ToLowerInvariant() }
            } catch {}
            if (@("succeeded", "success", "completed", "done") -contains $rawStatus) { $nextStatus = "succeeded" }
            elseif (@("failed", "error") -contains $rawStatus) { $nextStatus = "failed" }
            elseif (@("cancelled", "canceled") -contains $rawStatus) { $nextStatus = "cancelled" }
            $changes = @{
                status = $nextStatus
                resultRaw = $upstream
                resultUrl = Get-ResultUrlFromValue $upstream
            }
            if ($nextStatus -eq "failed") { $changes.errorMessage = Get-ErrorMessageFromValue $upstream }
            $task = Update-GenerationTask $task.id $changes
        }
        Send-Json $Context ([int]$result.status) ([ordered]@{
            task_id = $task.id
            provider_task_id = $task.providerTaskId
            provider = $task.provider
            modelId = $task.modelId
            status = $task.status
            task = $task
            upstream = $upstream
        })
    }
    catch {
        Send-Json $Context 500 ([ordered]@{ error = [ordered]@{ message = $_.Exception.Message } })
    }
}

function Resolve-RelayRequest {
    param(
        $Request,
        $Payload
    )
    $providerId = Get-BodyField $Payload "provider"
    if ([string]::IsNullOrWhiteSpace($providerId)) { $providerId = Get-HeaderValue $Request "X-Relay-Provider" }
    if ([string]::IsNullOrWhiteSpace($providerId)) { $providerId = "custom" }
    $providerId = $providerId.ToLowerInvariant()

    $provider = $script:ProviderMap[$providerId]
    if ($null -eq $provider) {
        $provider = [ordered]@{ id = $providerId; name = $providerId; type = "openai"; baseUrl = ""; models = @() }
    }

    $apiType = Get-BodyField $Payload "apiType"
    if ([string]::IsNullOrWhiteSpace($apiType)) { $apiType = Get-HeaderValue $Request "X-Relay-Api-Type" }
    if ([string]::IsNullOrWhiteSpace($apiType)) { $apiType = $provider.type }
    if ([string]::IsNullOrWhiteSpace($apiType)) { $apiType = "openai" }
    $apiType = $apiType.ToLowerInvariant()

    $baseUrl = $provider.baseUrl
    $apiKey = Get-RelayApiKey $providerId

    return [ordered]@{
        providerId = $providerId
        apiType = $apiType
        baseUrl = $baseUrl
        apiKey = $apiKey
    }
}

function Handle-Relay {
    param($Context)
    $rawBody = Get-RequestBody $Context.Request
    if ([string]::IsNullOrWhiteSpace($rawBody)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Request body is empty." } })
        return
    }

    try {
        $payload = $rawBody | ConvertFrom-Json
    }
    catch {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Request body must be valid JSON." } })
        return
    }

    $relay = Resolve-RelayRequest $Context.Request $payload
    if ([string]::IsNullOrWhiteSpace($relay.baseUrl)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Base URL is required for this provider." } })
        return
    }
    if ([string]::IsNullOrWhiteSpace($relay.apiKey)) {
        $envName = Get-RelayApiKeyEnvName $relay.providerId
        $message = "Provider is not configured. Please contact the administrator."
        if (-not [string]::IsNullOrWhiteSpace($envName)) {
            $message = "Provider is not configured. Missing environment variable '$envName'."
        }
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = $message } })
        return
    }

    $upstreamPayload = New-UpstreamPayload $payload
    if (-not $upstreamPayload.Contains("model") -or [string]::IsNullOrWhiteSpace([string]$upstreamPayload.model)) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Model is required." } })
        return
    }
    if (-not $upstreamPayload.Contains("messages")) {
        Send-Json $Context 400 ([ordered]@{ error = [ordered]@{ message = "Messages are required." } })
        return
    }

    Write-ServerLog ("relay {0} -> {1}" -f $relay.providerId, $upstreamPayload.model)
    switch ($relay.apiType) {
        "anthropic" { $upstream = Invoke-Anthropic $relay.baseUrl $relay.apiKey $upstreamPayload }
        "gemini" { $upstream = Invoke-Gemini $relay.baseUrl $relay.apiKey $upstreamPayload }
        default { $upstream = Invoke-OpenAICompatible $relay.providerId $relay.baseUrl $relay.apiKey $upstreamPayload }
    }

    Send-Text $Context ([int]$upstream.status) ([string]$upstream.content) ([string]$upstream.contentType)
}

function Get-ContentType {
    param([string]$Path)
    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    switch ($extension) {
        ".html" { return "text/html; charset=utf-8" }
        ".css" { return "text/css; charset=utf-8" }
        ".js" { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".svg" { return "image/svg+xml" }
        ".png" { return "image/png" }
        ".jpg" { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".ico" { return "image/x-icon" }
        default { return "application/octet-stream" }
    }
}

function Serve-StaticFile {
    param($Context)
    $requestPath = [Uri]::UnescapeDataString($Context.Request.Url.AbsolutePath.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }

    $rootFull = [System.IO.Path]::GetFullPath($Root)
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $requestPath))
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Text $Context 403 "Forbidden"
        return
    }
    if (-not [System.IO.File]::Exists($candidate)) {
        Send-Text $Context 404 "Not found"
        return
    }
    $bytes = [System.IO.File]::ReadAllBytes($candidate)
    Send-Bytes $Context 200 $bytes (Get-ContentType $candidate)
}

if (-not [System.IO.Directory]::Exists($Root)) {
    throw "Public root not found: $Root"
}

function Find-HeaderEnd {
    param(
        [byte[]]$Bytes,
        [int]$Length
    )
    if ($Length -lt 4) { return -1 }
    for ($i = 0; $i -le ($Length - 4); $i++) {
        if (($Bytes[$i] -eq 13) -and ($Bytes[$i + 1] -eq 10) -and ($Bytes[$i + 2] -eq 13) -and ($Bytes[$i + 3] -eq 10)) {
            return $i
        }
    }
    return -1
}

function Read-HttpRequest {
    param(
        [System.Net.Sockets.TcpClient]$Client,
        [int]$Port
    )
    $stream = $Client.GetStream()
    $buffer = New-Object byte[] 8192
    $memory = New-Object System.IO.MemoryStream
    $headerEnd = -1

    while ($headerEnd -lt 0) {
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { return $null }
        $memory.Write($buffer, 0, $read)
        $current = $memory.ToArray()
        $headerEnd = Find-HeaderEnd $current $current.Length
        if ($current.Length -gt 1048576) { throw "Request headers are too large." }
    }

    $allBytes = $memory.ToArray()
    $headerText = [System.Text.Encoding]::ASCII.GetString($allBytes, 0, $headerEnd)
    $lines = $headerText -split "`r`n"
    if ($lines.Count -eq 0) { return $null }

    $requestParts = $lines[0].Split(" ")
    if ($requestParts.Count -lt 2) { throw "Invalid HTTP request line." }
    $method = $requestParts[0].ToUpperInvariant()
    $target = $requestParts[1]
    if ([string]::IsNullOrWhiteSpace($target)) { $target = "/" }

    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $colon = $line.IndexOf(":")
        if ($colon -le 0) { continue }
        $name = $line.Substring(0, $colon).Trim()
        $value = $line.Substring($colon + 1).Trim()
        $headers[$name] = $value
    }

    $contentLength = 0
    if ($headers.ContainsKey("Content-Length")) {
        [int]::TryParse([string]$headers["Content-Length"], [ref]$contentLength) | Out-Null
    }

    $bodyBytes = New-Object byte[] $contentLength
    $bodyStart = $headerEnd + 4
    $alreadyRead = [Math]::Max(0, $allBytes.Length - $bodyStart)
    if ($alreadyRead -gt 0 -and $contentLength -gt 0) {
        $copyLength = [Math]::Min($alreadyRead, $contentLength)
        [Array]::Copy($allBytes, $bodyStart, $bodyBytes, 0, $copyLength)
    }

    $offset = [Math]::Min($alreadyRead, $contentLength)
    while ($offset -lt $contentLength) {
        $read = $stream.Read($bodyBytes, $offset, $contentLength - $offset)
        if ($read -le 0) { break }
        $offset += $read
    }

    $body = ""
    if ($contentLength -gt 0) {
        $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $contentLength)
    }

    $url = [Uri]("http://127.0.0.1:$Port$target")
    return [pscustomobject]@{
        Client = $Client
        Stream = $stream
        Request = [pscustomobject]@{
            HttpMethod = $method
            Url = $url
            Headers = $headers
            Body = $body
        }
    }
}

function Handle-HttpContext {
    param($Context)
    if ($Context.Request.HttpMethod -eq "OPTIONS") {
        Send-Text $Context 204 ""
        return
    }

    $path = $Context.Request.Url.AbsolutePath
    if (($Context.Request.HttpMethod -eq "GET") -and ($path -eq "/api/health")) {
        Send-Json $Context 200 ([ordered]@{ ok = $true; port = $Port; time = (Get-Date).ToString("o") })
        return
    }
    if (($Context.Request.HttpMethod -eq "GET") -and ($path -eq "/api/providers")) {
        $providers = @()
        foreach ($provider in $script:ProviderList) {
            $providers += ,(Get-ProviderStatus $provider)
        }
        Send-Json $Context 200 ([ordered]@{ providers = $providers; relayEndpoint = "http://127.0.0.1:$Port/v1/chat/completions" })
        return
    }
    if (($Context.Request.HttpMethod -eq "GET") -and ($path -eq "/api/models")) {
        Send-Json $Context 200 ([ordered]@{ models = Get-EnabledVideoModels })
        return
    }
    if (($Context.Request.HttpMethod -eq "GET") -and ($path -eq "/api/video/providers")) {
        $providers = @()
        foreach ($provider in $script:ConfiguredProviders) {
            $providerModels = @()
            foreach ($model in $script:ConfiguredModels) {
                if (($model.provider -eq $provider.key) -and ($model.enabled -eq $true)) {
                    $providerModels += ,([ordered]@{
                        id = [string]$model.id
                        displayName = [string]$model.displayName
                        modelType = [string]$model.modelType
                        inputType = [string]$model.inputType
                        outputType = [string]$model.outputType
                    })
                }
            }
            $publicProvider = [ordered]@{
                provider = [string]$provider.key
                displayName = [string]$provider.displayName
                enabled = [bool]$provider.enabled
                models = $providerModels
                capabilities = @("video")
            }
            $providers += ,$publicProvider
        }
        Send-Json $Context 200 ([ordered]@{ providers = $providers; createEndpoint = "http://127.0.0.1:$Port/api/video/generations"; taskEndpoint = "http://127.0.0.1:$Port/api/video/tasks" })
        return
    }
    if (($Context.Request.HttpMethod -eq "POST") -and (($path -eq "/api/chat/completions") -or ($path -eq "/v1/chat/completions"))) {
        Handle-Relay $Context
        return
    }
    if (($Context.Request.HttpMethod -eq "POST") -and ($path -eq "/api/video/generations")) {
        Handle-VideoGeneration $Context
        return
    }
    if (($Context.Request.HttpMethod -eq "GET") -and ($path -eq "/api/video/tasks")) {
        Handle-VideoTask $Context
        return
    }
    if (($Context.Request.HttpMethod -eq "GET") -and ($path -match "^/api/video/tasks/([^/]+)$")) {
        Handle-VideoTask $Context ([Uri]::UnescapeDataString($Matches[1]))
        return
    }

    if ($Context.Request.HttpMethod -eq "GET") {
        Serve-StaticFile $Context
        return
    }

    Send-Json $Context 405 ([ordered]@{ error = [ordered]@{ message = "Method not allowed." } })
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
$listener.Start()
$prefix = "http://127.0.0.1:$Port/"
Write-ServerLog "API relay console is running at $prefix"
Write-ServerLog "Press Ctrl+C to stop."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $context = $null
        try {
            $context = Read-HttpRequest $client $Port
            if ($null -eq $context) {
                $client.Close()
                continue
            }
            Handle-HttpContext $context
        }
        catch {
            try {
                if ($null -ne $context) {
                    Send-Json $context 500 ([ordered]@{ error = [ordered]@{ message = $_.Exception.Message } })
                }
                else {
                    $client.Close()
                }
            }
            catch {
                $client.Close()
            }
        }
    }
}
finally {
    $listener.Stop()
}
