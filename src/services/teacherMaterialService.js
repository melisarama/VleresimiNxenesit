import { supabaseClient } from '../lib/supabaseClient.js?v=20260927-storage-fix';
import {
  createSignedMaterialDownloadUrl,
  deleteMaterialFiles,
  uploadMaterialFile
} from '../lib/materialStorage.js?v=20260927-storage-fix';

export const MATERIAL_BUCKET = 'class-materials';
export const MAX_MATERIAL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_MATERIAL_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function throwOnError(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

function safeFileName(name) {
  const extension = name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : '';
  const stem = name
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'material';
  return `${stem}${extension}`;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Imazhi nuk mundi te kompresohej.'))), type, quality);
  });
}

export async function prepareMaterialFile(file) {
  if (!ACCEPTED_MATERIAL_TYPES.includes(file.type)) throw new Error(`${file.name}: formati nuk mbeshtetet.`);
  if (!file.type.startsWith('image/') && file.size > MAX_MATERIAL_FILE_BYTES) throw new Error(`${file.name}: PDF-ja tejkalon kufirin 10 MB.`);
  if (file.type.startsWith('image/') && file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error(`${file.name}: fotografia tejkalon kufirin 25 MB para kompresimit.`);
  if (!file.type.startsWith('image/')) return { file, originalName: file.name, originalSize: file.size, compressed: false };

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const maxDimension = 1920;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasBlob(canvas, 'image/webp', 0.8);
    if (blob.size >= file.size) {
      if (file.size > MAX_MATERIAL_FILE_BYTES) throw new Error(`${file.name}: fotografia mbetet mbi 10 MB pas kompresimit.`);
      return { file, originalName: file.name, originalSize: file.size, compressed: false };
    }
    if (blob.size > MAX_MATERIAL_FILE_BYTES) throw new Error(`${file.name}: fotografia mbetet mbi 10 MB pas kompresimit.`);
    const compressedName = `${file.name.replace(/\.[^.]+$/, '')}.webp`;
    return {
      file: new File([blob], compressedName, { type: 'image/webp', lastModified: file.lastModified }),
      originalName: file.name,
      originalSize: file.size,
      compressed: true
    };
  } catch (error) {
    if (file.size > MAX_MATERIAL_FILE_BYTES) throw error;
    console.warn('Image compression skipped:', error);
    return { file, originalName: file.name, originalSize: file.size, compressed: false };
  } finally {
    bitmap?.close?.();
  }
}

export async function prepareMaterialFiles(files, onProgress = () => {}) {
  const prepared = [];
  for (let index = 0; index < files.length; index += 1) {
    onProgress(`Duke pergatitur ${index + 1} nga ${files.length}...`);
    prepared.push(await prepareMaterialFile(files[index]));
  }
  return prepared;
}

export async function fetchTeacherMaterials(teacherId) {
  const [materialsResult, warningsResult] = await Promise.all([
    supabaseClient
      .from('class_materials')
      .select('id,teacher_id,subject_id,class_id,audience,title,description,expires_at,warning_sent_at,created_at,subjects(id,name),classes(id,name),class_material_files(id,storage_path,original_name,mime_type,byte_size,original_byte_size),class_material_recipients(student_id)')
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false }),
    supabaseClient
      .from('material_retention_warnings')
      .select('id,material_id,expires_at,read_at,created_at')
      .eq('teacher_id', teacherId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
  ]);

  return {
    materials: throwOnError(materialsResult, 'Materialet nuk munden te ngarkoheshin.'),
    warnings: throwOnError(warningsResult, 'Paralajmerimet nuk munden te ngarkoheshin.')
  };
}

export async function publishTeacherMaterial(
  { teacherId, schoolId, subjectId, classId, audience, title, description, notifyInApp, retentionDays, recipientIds, preparedFiles },
  onProgress = () => {}
) {
  if (![90, 120].includes(retentionDays)) throw new Error('Zgjidhni ruajtjen 90 ose 120 dite.');

  const expiresAt = new Date(Date.now() + retentionDays * 86400000).toISOString();
  const materialId = throwOnError(await supabaseClient.rpc('publish_teacher_material', {
    target_subject: subjectId,
    target_class: audience === 'class' ? classId : null,
    target_audience: audience,
    material_title: title,
    material_description: description,
    notify_parent: notifyInApp,
    target_expires_at: expiresAt,
    recipient_ids: [...new Set(recipientIds)]
  }), 'Materiali nuk mundi te krijohej.');

  const uploadedPaths = [];
  try {
    for (let index = 0; index < preparedFiles.length; index += 1) {
      const prepared = preparedFiles[index];
      const uploadName = `${crypto.randomUUID()}-${safeFileName(prepared.file.name)}`;
      const storagePath = `${schoolId}/${teacherId}/${materialId}/${uploadName}`;
      onProgress(`Duke ngarkuar ${index + 1} nga ${preparedFiles.length}...`);
      await uploadMaterialFile(storagePath, prepared.file);
      uploadedPaths.push(storagePath);
      throwOnError(await supabaseClient.from('class_material_files').insert({
        material_id: materialId,
        storage_path: storagePath,
        original_name: prepared.originalName,
        mime_type: prepared.file.type,
        byte_size: prepared.file.size,
        original_byte_size: prepared.originalSize
      }), 'Te dhenat e skedarit nuk munden te ruheshin.');
    }
    return materialId;
  } catch (error) {
    if (uploadedPaths.length) {
      try {
        await deleteMaterialFiles(uploadedPaths);
      } catch (cleanupError) {
        console.warn('Material storage cleanup failed:', cleanupError);
      }
    }
    await supabaseClient.from('class_materials').delete().eq('id', materialId);
    throw error;
  }
}

export async function createMaterialDownloadUrl(storagePath) {
  return createSignedMaterialDownloadUrl(storagePath);
}

export async function deleteTeacherMaterial(material) {
  const paths = (material.class_material_files || []).map(file => file.storage_path);
  if (paths.length) await deleteMaterialFiles(paths);
  throwOnError(await supabaseClient.from('class_materials').delete().eq('id', material.id), 'Materiali nuk mundi te fshihej.');
}

export async function markRetentionWarningRead(warningId) {
  throwOnError(
    await supabaseClient.from('material_retention_warnings').update({ read_at: new Date().toISOString() }).eq('id', warningId),
    'Paralajmerimi nuk mundi te perditesohej.'
  );
}
