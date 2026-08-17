$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:PORT) { [int]$env:PORT } else { 8080 }
$htmlPath = Join-Path $root 'index.html'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Import-DotEnv {
    $envPath = Join-Path $root '.env'
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { return }
    foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
        $name, $value = $trimmed.Split('=', 2)
        $name = $name.Trim()
        $value = $value.Trim().Trim('"').Trim("'")
        if ($name -and [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

function Get-BrowserConfigScript {
    $url = [Environment]::GetEnvironmentVariable('SUPABASE_URL')
    $key = [Environment]::GetEnvironmentVariable('SUPABASE_PUBLISHABLE_KEY')
    if ([string]::IsNullOrWhiteSpace($url) -or [string]::IsNullOrWhiteSpace($key)) {
        return "window.MESIMI_CONFIG = { supabaseUrl: '', supabasePublishableKey: '' };"
    }
    $data = @{
        supabaseUrl = $url
        supabasePublishableKey = $key
    } | ConvertTo-Json -Compress
    return "window.MESIMI_CONFIG = $data;"
}

Import-DotEnv

function Send-Response {
    param($Stream, [int]$Status, [string]$StatusText, [string]$ContentType, [byte[]]$Body)
    $header = "HTTP/1.1 $Status $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($Body, 0, $Body.Length)
    $Stream.Flush()
}

function Send-Json {
    param($Stream, [int]$Status, [hashtable]$Data)
    $statusText = if ($Status -eq 200) { 'OK' } elseif ($Status -eq 400) { 'Bad Request' } elseif ($Status -eq 503) { 'Service Unavailable' } else { 'Internal Server Error' }
    $bytes = $utf8.GetBytes(($Data | ConvertTo-Json -Depth 6 -Compress))
    Send-Response $Stream $Status $statusText 'application/json; charset=utf-8' $bytes
}

function Get-StaticContentType {
    param([string]$Path)
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.svg' { 'image/svg+xml' }
        '.pdf' { 'application/pdf' }
        default { 'application/octet-stream' }
    }
}

function Try-Send-StaticFile {
    param($Stream, [string]$RequestPath)
    $normalized = [System.Uri]::UnescapeDataString(($RequestPath -split '\?')[0].TrimStart('/')).Replace('\', '/')
    if ($normalized -eq 'src/config.js') {
        Send-Response $Stream 200 'OK' 'application/javascript; charset=utf-8' ($utf8.GetBytes((Get-BrowserConfigScript)))
        return $true
    }
    $relative = $normalized.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (
        $relative.StartsWith('css' + [System.IO.Path]::DirectorySeparatorChar) -or
        $relative.StartsWith('src' + [System.IO.Path]::DirectorySeparatorChar) -or
        $relative.StartsWith('public' + [System.IO.Path]::DirectorySeparatorChar)
    )) {
        return $false
    }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not $candidate.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        return $false
    }
    Send-Response $Stream 200 'OK' (Get-StaticContentType $candidate) ([System.IO.File]::ReadAllBytes($candidate))
    return $true
}

function Get-SupportReply {
    param([string]$Message)
    if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) { throw 'GEMINI_API_KEY_MISSING' }

    $model = if ([string]::IsNullOrWhiteSpace($env:GEMINI_MODEL)) { 'gemini-2.5-flash' } else { $env:GEMINI_MODEL.Trim() }
    $systemInstruction = @"
Ti je një asistent pedagogjik në kohë reale për mësimdhënës në Kosovë. Përgjigju vetëm në shqip, qartë dhe shkurt, duke u bazuar drejtpërdrejt në situatën e fundit të shkruar nga mësimdhënësi.

Jep hapa që mësimdhënësi mund t'i zbatojë menjëherë në klasë. Mos vendos diagnoza, mos e fajëso fëmijën dhe mos paraqit një shkak si të sigurt. Përmend shkurt shkaqe të mundshme vetëm kur ndihmon, si mbingarkesa shqisore, frustrimi, lodhja, vështirësia me detyrën ose nevoja për komunikim.

Përdor këtë format:
1. Një ose dy fjali të lidhura vetëm me sjelljen e përshkruar dhe shkaqet e mundshme.
2. Titulli "Çfarë të bëni tani:" dhe saktësisht 3 hapa konkretë me pika. Jep edhe fjalë të sakta që mësimdhënësi mund t'i thotë kur kjo ndihmon.
3. Një fjali shumë të shkurtër për çfarë të vëzhgohet më pas.

Mos përdor hyrje të përgjithshme, mos përsërit modele të gatshme dhe mos kërko të dhëna personale ose mjekësore. Nëse ka rrezik të menjëhershëm, dhunë, vetëlëndim ose rrezik për të tjerët, udhëzo fillimisht sigurimin e fëmijës, aktivizimin e protokollit të mbrojtjes së shkollës dhe kontaktimin e shërbimeve emergjente lokale. Këshilla nuk zëvendëson profesionistët ose procedurat e shkollës.
"@
    $requestBody = @{
        system_instruction = @{ parts = @(@{ text = $systemInstruction }) }
        contents = @(@{ parts = @(@{ text = $Message }) })
    } | ConvertTo-Json -Depth 6
    $url = "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=$($env:GEMINI_API_KEY)"
    $response = Invoke-RestMethod -Method Post -Uri $url -Headers @{ 'Content-Type' = 'application/json' } -Body $utf8.GetBytes($requestBody) -TimeoutSec 60

    $reply = $response.candidates[0].content.parts[0].text
    if (-not $reply) { throw 'Gemini AI nuk ktheu tekst.' }
    return $reply.Trim()
}

try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $listener.Start()
    Write-Host "Local server is running at http://localhost:$port/"
    if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
        Write-Warning 'AI support is not configured. Set GEMINI_API_KEY in .env and restart this server.'
    } else {
        Write-Host 'AI support is configured for Gemini AI.'
    }

    while ($true) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 40
            continue
        }
        $client = $listener.AcceptTcpClient()
        $reader = $null
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 15000
            $reader = [System.IO.StreamReader]::new($stream, $utf8, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue }
            $requestParts = $requestLine -split ' '
            $method = $requestParts[0].ToUpperInvariant()
            $path = ($requestParts[1] -split '\?')[0]
            $contentLength = 0
            while ($true) {
                $line = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($line)) { break }
                if ($line -match '^Content-Length:\s*(\d+)') { $contentLength = [int]$Matches[1] }
            }

            if ($method -eq 'POST' -and $path -eq '/api/support') {
                try {
                    $chars = New-Object char[] $contentLength
                    $offset = 0
                    while ($offset -lt $contentLength) {
                        $count = $reader.Read($chars, $offset, $contentLength - $offset)
                        if ($count -le 0) { break }
                        $offset += $count
                    }
                    $payload = (-join $chars[0..([Math]::Max(0, $offset - 1))]) | ConvertFrom-Json
                    $message = $utf8.GetString([Convert]::FromBase64String([string]$payload.messageBase64))
                    if ([string]::IsNullOrWhiteSpace($message) -or $message.Length -gt 2000) {
                        Send-Json $stream 400 @{ error = 'Shkruani një situatë me më pak se 2000 shkronja.' }
                    } else {
                        Send-Json $stream 200 @{ reply = (Get-SupportReply $message.Trim()) }
                    }
                } catch {
                    if ($_.Exception.Message -eq 'GEMINI_API_KEY_MISSING') {
                        Send-Json $stream 503 @{ error = 'AI nuk është konfiguruar. Vendosni GEMINI_API_KEY në .env dhe rinisni serverin.' }
                    } else {
                        Write-Warning "AI request failed: $($_.Exception.Message)"
                        Send-Json $stream 503 @{ error = 'Asistenti AI nuk mundi të përgjigjet tani. Kontrolloni lidhjen dhe çelësin API.' }
                    }
                }
            } elseif ($method -eq 'GET' -and (Try-Send-StaticFile $stream $path)) {
                continue
            } else {
                Send-Response $stream 200 'OK' 'text/html; charset=utf-8' ([System.IO.File]::ReadAllBytes($htmlPath))
            }
        } catch {
            Write-Warning "Request failed: $($_.Exception.Message)"
        } finally {
            if ($reader) { $reader.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
