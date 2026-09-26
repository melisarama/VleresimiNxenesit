import { storageApiBaseUrl, supabaseClient } from './supabaseClient.js';

const MATERIAL_BUCKET = 'class-materials';

function throwOnError(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

async function currentAccessToken() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw new Error(error.message || 'Sesioni nuk mundi te verifikohej.');
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesioni ka skaduar. Kycuni perseri.');
  return token;
}

async function parseStorageResponse(response, fallback) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    throw new Error((!response.ok && text) ? text : fallback);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || fallback);
  }

  return payload || {};
}

async function storageRequest(path, { method = 'POST', json, formData, fallback } = {}) {
  if (!storageApiBaseUrl) throw new Error('Storage i jashtem nuk eshte i konfiguruar.');

  const headers = new Headers({
    Authorization: `Bearer ${await currentAccessToken()}`
  });

  let body;
  if (formData) {
    body = formData;
  } else {
    headers.set('Content-Type', 'application/json; charset=utf-8');
    body = JSON.stringify(json || {});
  }

  const response = await fetch(`${storageApiBaseUrl}${path}`, {
    method,
    headers,
    body
  });

  return parseStorageResponse(response, fallback);
}

export async function uploadMaterialFile(storagePath, file) {
  if (!storageApiBaseUrl) {
    throwOnError(
      await supabaseClient.storage.from(MATERIAL_BUCKET).upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      }),
      `${file.name} nuk mundi te ngarkohej.`
    );
    return;
  }

  const formData = new FormData();
  formData.set('storage_path', storagePath);
  formData.set('material_file', file, file.name);
  const result = await storageRequest('/upload.php', {
    formData,
    fallback: `${file.name} nuk mundi te ngarkohej.`
  });
  if (result?.storagePath !== storagePath) throw new Error(`${file.name} nuk mundi te ngarkohej.`);
}

export async function createSignedMaterialDownloadUrl(storagePath) {
  if (!storageApiBaseUrl) {
    return throwOnError(
      await supabaseClient.storage.from(MATERIAL_BUCKET).createSignedUrl(storagePath, 60),
      'Lidhja e shkarkimit nuk mundi te krijohej.'
    ).signedUrl;
  }

  const formData = new FormData();
  formData.set('storage_path', storagePath);
  const result = await storageRequest('/sign-download.php', {
    formData,
    fallback: 'Lidhja e shkarkimit nuk mundi te krijohej.'
  });
  if (!result?.downloadUrl) throw new Error('Lidhja e shkarkimit nuk mundi te krijohej.');
  return result.downloadUrl;
}

export async function deleteMaterialFiles(paths) {
  if (!paths.length) return;

  if (!storageApiBaseUrl) {
    throwOnError(
      await supabaseClient.storage.from(MATERIAL_BUCKET).remove(paths),
      'Skedaret nuk munden te fshiheshin.'
    );
    return;
  }

  const formData = new FormData();
  for (const path of paths) formData.append('paths[]', path);

  await storageRequest('/delete.php', {
    formData,
    fallback: 'Skedaret nuk munden te fshiheshin.'
  });
}
