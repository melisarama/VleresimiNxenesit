<?php
declare(strict_types=1);

return [
    'public_base_url' => 'https://storage.iliriadigital.com',
    'storage_root' => __DIR__ . '/files',
    'supabase_url' => 'https://fmrmhaujktucffeyezrh.supabase.co',
    'supabase_publishable_key' => 'sb_publishable_rRWXe_5ru2b--_F0OCpHSA_czwrbGgK',
    'service_secret' => 'storage-service-7f4f6f2e2d5a4f4aa3b1f3d9c1e8a6b2',
    'download_ttl_seconds' => 120,
    'max_upload_bytes' => 10 * 1024 * 1024,
    'allowed_origins' => [
        'https://iliriadigital.com',
        'https://www.iliriadigital.com',
        'https://vleresiminxenesit.vercel.app',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
    ],
];
