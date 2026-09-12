$script:GenerationTasks = @{}
$script:GenerationTaskStatuses = @("pending", "processing", "succeeded", "failed", "cancelled")
$script:GenerationTaskDataDir = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "data"
$script:GenerationTaskStorePath = Join-Path $script:GenerationTaskDataDir "generation-tasks.json"

function Convert-TaskToOrdered {
    param($Task)

    return [ordered]@{
        id = [string]$Task.id
        provider = [string]$Task.provider
        modelId = [string]$Task.modelId
        modelDisplayName = [string]$Task.modelDisplayName
        taskType = [string]$Task.taskType
        prompt = [string]$Task.prompt
        params = $Task.params
        status = [string]$Task.status
        providerTaskId = [string]$Task.providerTaskId
        resultUrl = [string]$Task.resultUrl
        resultRaw = $Task.resultRaw
        errorMessage = [string]$Task.errorMessage
        createdAt = [string]$Task.createdAt
        updatedAt = [string]$Task.updatedAt
    }
}

function Ensure-GenerationTaskStore {
    try {
        if (-not (Test-Path -LiteralPath $script:GenerationTaskDataDir)) {
            New-Item -ItemType Directory -Path $script:GenerationTaskDataDir -Force | Out-Null
        }
        if (-not (Test-Path -LiteralPath $script:GenerationTaskStorePath)) {
            [System.IO.File]::WriteAllText($script:GenerationTaskStorePath, "[]", [System.Text.Encoding]::UTF8)
        }
    }
    catch {
        throw "Failed to prepare generation task store '$script:GenerationTaskStorePath': $($_.Exception.Message)"
    }
}

function Save-GenerationTasks {
    try {
        Ensure-GenerationTaskStore
        $items = @()
        foreach ($task in $script:GenerationTasks.Values) {
            $items += ,(Convert-TaskToOrdered $task)
        }
        $items = @($items | Sort-Object createdAt -Descending)
        $json = ConvertTo-Json -InputObject @($items) -Depth 100
        if ([string]::IsNullOrWhiteSpace($json)) { $json = "[]" }
        [System.IO.File]::WriteAllText($script:GenerationTaskStorePath, $json, [System.Text.Encoding]::UTF8)
    }
    catch {
        throw "Failed to write generation task store '$script:GenerationTaskStorePath': $($_.Exception.Message)"
    }
}

function Initialize-GenerationTaskStore {
    try {
        Ensure-GenerationTaskStore

        $raw = [System.IO.File]::ReadAllText($script:GenerationTaskStorePath, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { $raw = "[]" }
        $items = $raw | ConvertFrom-Json
        $script:GenerationTasks = @{}
        foreach ($item in @($items)) {
            if ($null -eq $item -or [string]::IsNullOrWhiteSpace([string]$item.id)) { continue }
            $task = Convert-TaskToOrdered $item
            if ([string]::IsNullOrWhiteSpace($task.status) -or ($script:GenerationTaskStatuses -notcontains $task.status)) {
                $task.status = "pending"
            }
            $script:GenerationTasks[$task.id] = $task
        }
    }
    catch {
        throw "Failed to read generation task store '$script:GenerationTaskStorePath': $($_.Exception.Message)"
    }
}

function Get-GenerationTasks {
    Initialize-GenerationTaskStore
    return @($script:GenerationTasks.Values | Sort-Object createdAt -Descending)
}

function New-GenerationTask {
    param(
        [string]$Provider,
        [string]$ModelId,
        [string]$ModelDisplayName,
        [string]$TaskType,
        [string]$Prompt,
        $Params
    )

    Initialize-GenerationTaskStore
    $now = (Get-Date).ToString("o")
    $id = [guid]::NewGuid().ToString("N")
    $task = [ordered]@{
        id = $id
        provider = $Provider
        modelId = $ModelId
        modelDisplayName = $ModelDisplayName
        taskType = $TaskType
        prompt = $Prompt
        params = $Params
        status = "pending"
        providerTaskId = ""
        resultUrl = ""
        resultRaw = $null
        errorMessage = ""
        createdAt = $now
        updatedAt = $now
    }
    $script:GenerationTasks[$id] = $task
    Save-GenerationTasks
    return $task
}

function Update-GenerationTask {
    param(
        [string]$Id,
        [hashtable]$Changes
    )

    $task = $script:GenerationTasks[$Id]
    if ($null -eq $task) { return $null }
    foreach ($key in $Changes.Keys) {
        if ($key -eq "status" -and ($script:GenerationTaskStatuses -notcontains [string]$Changes[$key])) {
            throw "Invalid generation task status '$($Changes[$key])'."
        }
        $task[$key] = $Changes[$key]
    }
    $task.updatedAt = (Get-Date).ToString("o")
    $script:GenerationTasks[$Id] = $task
    Save-GenerationTasks
    return $task
}

function Get-GenerationTask {
    param([string]$Id)
    Initialize-GenerationTaskStore
    return $script:GenerationTasks[$Id]
}

Ensure-GenerationTaskStore
