<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$config = storage_bootstrap_api();
storage_require_post();
$rawPaths = [];
if (isset($_POST['paths'])) {
    if (is_array($_POST['paths'])) {
        $rawPaths = $_POST['paths'];
    } elseif (is_string($_POST['paths']) && trim($_POST['paths']) !== '') {
        $rawPaths = [$_POST['paths']];
    }
} else {
    $payload = storage_read_json_body();
    $rawPaths = is_array($payload['paths'] ?? null) ? $payload['paths'] : [];
}

$paths = array_values(array_unique(array_map(
    static fn ($path) => storage_validate_path((string) $path),
    $rawPaths
)));

if (!$paths) {
    storage_json_response(['deleted' => [], 'missing' => []]);
    exit;
}

$authorizedBySecret = storage_service_secret_is_valid($config);
$auth = $authorizedBySecret ? null : storage_authenticate_user($config);
$userId = $authorizedBySecret ? '' : (string) ($auth['user']['id'] ?? '');

$deleted = [];
$missing = [];

foreach ($paths as $storagePath) {
    if (!$authorizedBySecret && storage_owner_id($storagePath) !== $userId) {
        storage_fail('DELETE_NOT_ALLOWED', 403);
    }

    $absolutePath = storage_absolute_path($config, $storagePath);
    if (!is_file($absolutePath)) {
        $missing[] = $storagePath;
        continue;
    }

    if (!@unlink($absolutePath)) {
        storage_fail('DELETE_FAILED', 500);
    }

    storage_cleanup_empty_directories($config, $storagePath);
    $deleted[] = $storagePath;
}

storage_json_response([
    'deleted' => $deleted,
    'missing' => $missing,
]);
