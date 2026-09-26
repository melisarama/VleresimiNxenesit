<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$config = storage_bootstrap_api();
storage_require_post();
$auth = storage_authenticate_user($config);

$storagePathValue = $_POST['storage_path'] ?? null;
if (!is_string($storagePathValue) || trim($storagePathValue) === '') {
    $payload = storage_read_json_body();
    $storagePathValue = (string) ($payload['storagePath'] ?? '');
}

$storagePath = storage_validate_path((string) $storagePathValue);
$file = storage_query_accessible_file($config, (string) $auth['token'], $storagePath);

$expires = time() + max(30, (int) ($config['download_ttl_seconds'] ?? 120));
$downloadPayload = [
    'path' => $storagePath,
    'expires' => $expires,
    'name' => storage_download_name((string) ($file['original_name'] ?? basename($storagePath))),
    'mime' => storage_download_mime((string) ($file['mime_type'] ?? 'application/octet-stream')),
];

$signature = storage_signature($config, $downloadPayload);
$url = rtrim((string) ($config['public_base_url'] ?? ''), '/') . '/download.php?' . http_build_query([
    'path' => $downloadPayload['path'],
    'expires' => $downloadPayload['expires'],
    'name' => $downloadPayload['name'],
    'mime' => $downloadPayload['mime'],
    'sig' => $signature,
], '', '&', PHP_QUERY_RFC3986);

storage_json_response([
    'downloadUrl' => $url,
    'expiresAt' => gmdate('c', $expires),
]);
