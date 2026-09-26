<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

echo json_encode([
    'service' => 'iliria-storage-api',
    'status' => 'ok',
    'endpoints' => [
        'upload' => '/upload.php',
        'delete' => '/delete.php',
        'sign_download' => '/sign-download.php',
        'download' => '/download.php',
    ],
], JSON_UNESCAPED_SLASHES);
