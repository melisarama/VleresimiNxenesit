<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$config = storage_bootstrap_api();
storage_require_post();
$auth = storage_authenticate_user($config);
$storagePath = storage_validate_path((string) ($_POST['storage_path'] ?? ''));

if (storage_owner_id($storagePath) !== (string) $auth['user']['id']) {
    storage_fail('UPLOAD_NOT_ALLOWED', 403);
}

if (!isset($_FILES['material_file']) || !is_array($_FILES['material_file'])) {
    storage_fail('FILE_MISSING', 400);
}

$file = $_FILES['material_file'];
if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    storage_fail('UPLOAD_FAILED', 400);
}

$tmpPath = (string) ($file['tmp_name'] ?? '');
if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
    storage_fail('UPLOAD_FAILED', 400);
}

$size = (int) filesize($tmpPath);
$limit = (int) ($config['max_upload_bytes'] ?? 0);
if ($limit > 0 && $size > $limit) {
    storage_fail('FILE_TOO_LARGE', 413);
}

$target = storage_absolute_path($config, $storagePath, true);
if (!move_uploaded_file($tmpPath, $target)) {
    storage_fail('UPLOAD_FAILED', 500);
}

storage_json_response([
    'ok' => true,
    'storagePath' => $storagePath,
    'bytes' => filesize($target),
]);
