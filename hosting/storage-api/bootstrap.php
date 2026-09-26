<?php
declare(strict_types=1);

function storage_config(): array
{
    static $config = null;
    if ($config !== null) return $config;

    $configFile = __DIR__ . '/config.php';
    if (!is_file($configFile)) {
        storage_json_response(['error' => 'CONFIG_MISSING'], 500);
        exit;
    }

    $config = require $configFile;
    return is_array($config) ? $config : [];
}

function storage_json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
}

function storage_fail(string $code, int $status): void
{
    storage_json_response(['error' => $code], $status);
    exit;
}

function storage_set_cors(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigins = $config['allowed_origins'] ?? ['*'];

    if (in_array('*', $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: *');
    } elseif ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Vary: Origin');
    }

    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Storage-Service-Secret');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}

function storage_bootstrap_api(): array
{
    $config = storage_config();
    storage_set_cors($config);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    return $config;
}

function storage_require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        storage_fail('METHOD_NOT_ALLOWED', 405);
    }
}

function storage_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') return [];

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) storage_fail('INVALID_JSON', 400);
    return $decoded;
}

function storage_bearer_token(): string
{
    $header = '';

    foreach ([
        $_SERVER['HTTP_AUTHORIZATION'] ?? null,
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
        $_SERVER['REDIRECT_REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    ] as $candidate) {
        if (is_string($candidate) && trim($candidate) !== '') {
            $header = $candidate;
            break;
        }
    }

    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $name => $value) {
            if (is_string($name) && strcasecmp($name, 'Authorization') === 0 && is_string($value) && trim($value) !== '') {
                $header = $value;
                break;
            }
        }
    }

    if ($header === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $name => $value) {
            if (is_string($name) && strcasecmp($name, 'Authorization') === 0 && is_string($value) && trim($value) !== '') {
                $header = $value;
                break;
            }
        }
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        storage_fail('UNAUTHORIZED', 401);
    }
    return trim($matches[1]);
}

function storage_service_secret_is_valid(array $config): bool
{
    $expected = (string) ($config['service_secret'] ?? '');
    $provided = (string) ($_SERVER['HTTP_X_STORAGE_SERVICE_SECRET'] ?? '');
    return $expected !== '' && $provided !== '' && hash_equals($expected, $provided);
}

function storage_http_request(string $method, string $url, array $headers = [], ?string $body = null): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADER => false,
        ];
        if ($body !== null) {
            $options[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($ch, $options);
        $responseBody = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => is_string($responseBody) ? $responseBody : ''];
    }

    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body ?? '',
            'ignore_errors' => true,
        ],
    ]);
    $responseBody = file_get_contents($url, false, $context);
    $statusLine = $http_response_header[0] ?? '';
    preg_match('/\s(\d{3})\s/', $statusLine, $matches);

    return [
        'status' => isset($matches[1]) ? (int) $matches[1] : 0,
        'body' => is_string($responseBody) ? $responseBody : '',
    ];
}

function storage_fetch_user(array $config, string $accessToken): array
{
    $response = storage_http_request('GET', rtrim((string) $config['supabase_url'], '/') . '/auth/v1/user', [
        'Accept: application/json',
        'Authorization: Bearer ' . $accessToken,
        'apikey: ' . (string) $config['supabase_publishable_key'],
    ]);
    if ($response['status'] !== 200) storage_fail('UNAUTHORIZED', 401);

    $user = json_decode($response['body'], true);
    if (!is_array($user) || empty($user['id'])) storage_fail('UNAUTHORIZED', 401);
    return $user;
}

function storage_authenticate_user(array $config): array
{
    $token = storage_bearer_token();
    $user = storage_fetch_user($config, $token);
    return ['token' => $token, 'user' => $user];
}

function storage_query_accessible_file(array $config, string $accessToken, string $storagePath): array
{
    $query = http_build_query([
        'select' => 'storage_path,original_name,mime_type',
        'storage_path' => 'eq.' . $storagePath,
        'limit' => 1,
    ], '', '&', PHP_QUERY_RFC3986);

    $response = storage_http_request(
        'GET',
        rtrim((string) $config['supabase_url'], '/') . '/rest/v1/class_material_files?' . $query,
        [
            'Accept: application/json',
            'Authorization: Bearer ' . $accessToken,
            'apikey: ' . (string) $config['supabase_publishable_key'],
        ]
    );

    if ($response['status'] >= 400) storage_fail('DOWNLOAD_NOT_ALLOWED', 403);
    $rows = json_decode($response['body'], true);
    if (!is_array($rows) || empty($rows[0]['storage_path'])) storage_fail('DOWNLOAD_NOT_ALLOWED', 403);
    return $rows[0];
}

function storage_validate_path(string $storagePath): string
{
    $normalized = trim(str_replace('\\', '/', $storagePath));
    $normalized = preg_replace('~/+~', '/', $normalized ?? '');

    if ($normalized === '' || str_starts_with($normalized, '/') || str_contains($normalized, '..')) {
        storage_fail('INVALID_PATH', 400);
    }

    if (!preg_match('~^[A-Za-z0-9/_\.-]+$~', $normalized)) {
        storage_fail('INVALID_PATH', 400);
    }

    return $normalized;
}

function storage_owner_id(string $storagePath): string
{
    $parts = explode('/', $storagePath);
    return $parts[1] ?? '';
}

function storage_root(array $config): string
{
    $configuredRoot = (string) ($config['storage_root'] ?? (__DIR__ . '/files'));
    $fallbackRoot = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'iliriadigital-storage';

    foreach (array_unique([$configuredRoot, $fallbackRoot]) as $root) {
        if ($root === '') continue;
        if (!is_dir($root) && !mkdir($root, 0775, true) && !is_dir($root)) {
            continue;
        }

        $resolved = realpath($root);
        if ($resolved !== false && is_writable($resolved)) {
            return $resolved;
        }
    }

    storage_fail('STORAGE_ROOT_UNAVAILABLE', 500);
}

function storage_absolute_path(array $config, string $storagePath, bool $ensureParent = false): string
{
    $root = storage_root($config);
    $absolute = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $storagePath);
    $directory = dirname($absolute);

    if ($ensureParent && !is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        storage_fail('STORAGE_DIRECTORY_UNAVAILABLE', 500);
    }

    return $absolute;
}

function storage_signature(array $config, array $payload): string
{
    $secret = (string) ($config['service_secret'] ?? '');
    if ($secret === '') storage_fail('SIGNING_SECRET_MISSING', 500);
    return hash_hmac('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES), $secret);
}

function storage_download_name(string $value): string
{
    $trimmed = trim($value);
    if ($trimmed === '') return 'material';
    return preg_replace('/[\r\n"]+/', '', $trimmed) ?: 'material';
}

function storage_download_mime(string $value): string
{
    $trimmed = trim($value);
    return $trimmed !== '' ? $trimmed : 'application/octet-stream';
}

function storage_cleanup_empty_directories(array $config, string $storagePath): void
{
    $root = storage_root($config);
    $directory = dirname(storage_absolute_path($config, $storagePath));
    while ($directory !== $root && str_starts_with($directory, $root)) {
        if (@rmdir($directory) === false) break;
        $directory = dirname($directory);
    }
}
