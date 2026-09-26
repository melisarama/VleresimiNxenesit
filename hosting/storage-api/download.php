<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$config = storage_config();
$storagePath = storage_validate_path((string) ($_GET['path'] ?? ''));
$expires = (int) ($_GET['expires'] ?? 0);
$name = storage_download_name((string) ($_GET['name'] ?? basename($storagePath)));
$mime = storage_download_mime((string) ($_GET['mime'] ?? 'application/octet-stream'));
$signature = (string) ($_GET['sig'] ?? '');

if ($expires < time()) {
    storage_fail('DOWNLOAD_LINK_EXPIRED', 403);
}

$payload = [
    'path' => $storagePath,
    'expires' => $expires,
    'name' => $name,
    'mime' => $mime,
];

if ($signature === '' || !hash_equals(storage_signature($config, $payload), $signature)) {
    storage_fail('INVALID_SIGNATURE', 403);
}

$absolutePath = storage_absolute_path($config, $storagePath);
if (!is_file($absolutePath)) {
    storage_fail('FILE_NOT_FOUND', 404);
}

header('Content-Type: ' . $mime);
header('Content-Length: ' . (string) filesize($absolutePath));
header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($name));
header('X-Content-Type-Options: nosniff');
readfile($absolutePath);
