function Invoke-VideoProviderCreate {
    param(
        $Provider,
        $Model,
        [string]$ApiKey,
        $Payload
    )

    switch ([string]$Provider.adapter) {
        "volcengine" { return Invoke-VolcengineVideoCreate $Provider $Model $ApiKey $Payload }
        default { throw "Unsupported video provider adapter: $($Provider.adapter)" }
    }
}

function Invoke-VideoProviderTask {
    param(
        $Provider,
        [string]$ApiKey,
        [string]$ProviderTaskId
    )

    switch ([string]$Provider.adapter) {
        "volcengine" { return Invoke-VolcengineVideoTask $Provider $ApiKey $ProviderTaskId }
        default { throw "Unsupported video provider adapter: $($Provider.adapter)" }
    }
}
