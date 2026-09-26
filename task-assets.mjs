import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

const configDirectory = process.env.AI_REVIEWER_CONFIG_DIR || join(homedir(), '.config', 'ai-reviewer');
export const taskAssetsDirectory = process.env.AI_REVIEWER_TASK_ASSETS_DIR || join(configDirectory, 'task-assets');
export const maxTaskImages = 5;
export const maxTaskImageBytes = 5 * 1024 * 1024;
export const maxTaskImageTotalBytes = 20 * 1024 * 1024;

const imageTypes = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

function assertSafeSegment(value, label) {
  if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(String(value)) || value === '.' || value === '..') {
    throw new Error(`Geçersiz ${label}.`);
  }
  return String(value);
}

function taskDirectory(taskId) {
  return join(taskAssetsDirectory, assertSafeSegment(taskId, 'görev kimliği'));
}

function metadataFile(taskId) {
  return join(taskDirectory(taskId), 'assets.json');
}

function hasImageSignature(buffer, type) {
  if (type === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function cleanDisplayName(value, extension) {
  const fallback = `gorsel.${extension}`;
  const name = basename(String(value || fallback)).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || fallback).slice(0, 180);
}

export function decodeTaskImage(input) {
  const data = typeof input?.data === 'string' ? input.data : '';
  const match = data.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match || !imageTypes[match[1]]) throw new Error('Yalnızca PNG, JPEG veya WEBP görselleri eklenebilir.');
  if (input.type && input.type !== match[1]) throw new Error('Görsel türü ile dosya içeriği eşleşmiyor.');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || !hasImageSignature(buffer, match[1])) throw new Error('Görsel dosyası geçerli değil.');
  if (buffer.length > maxTaskImageBytes) throw new Error('Her görsel en fazla 5 MB olabilir.');
  return {
    buffer,
    type: match[1],
    extension: imageTypes[match[1]],
    name: cleanDisplayName(input.name, imageTypes[match[1]])
  };
}

async function loadMetadata(taskId) {
  try {
    const parsed = JSON.parse(await readFile(metadataFile(taskId), 'utf8'));
    return Array.isArray(parsed.attachments) ? parsed.attachments : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function publicAttachment(taskId, attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    url: `/api/workflow/tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(attachment.id)}`
  };
}

export async function saveTaskImages(taskId, images) {
  assertSafeSegment(taskId, 'görev kimliği');
  if (!Array.isArray(images) || !images.length) return [];
  if (images.length > maxTaskImages) throw new Error(`Bir göreve en fazla ${maxTaskImages} görsel eklenebilir.`);
  const decoded = images.map(decodeTaskImage);
  const directory = taskDirectory(taskId);
  const existing = await loadMetadata(taskId);
  if (existing.length + decoded.length > maxTaskImages) throw new Error(`Bir göreve en fazla ${maxTaskImages} görsel eklenebilir.`);
  const totalBytes = existing.reduce((total, image) => total + Number(image.size || 0), 0) + decoded.reduce((total, image) => total + image.buffer.length, 0);
  if (totalBytes > maxTaskImageTotalBytes) throw new Error('Görev görsellerinin toplam boyutu en fazla 20 MB olabilir.');
  await mkdir(directory, { recursive: true });
  const createdAt = new Date().toISOString();
  const attachments = [];
  for (const image of decoded) {
    const id = `${randomUUID()}.${image.extension}`;
    await writeFile(join(directory, id), image.buffer, { mode: 0o444 });
    attachments.push({ id, name: image.name, type: image.type, size: image.buffer.length, createdAt });
  }
  const allAttachments = [...existing, ...attachments];
  const temporaryFile = `${metadataFile(taskId)}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify({ attachments: allAttachments }, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, metadataFile(taskId));
  return attachments.map(attachment => publicAttachment(taskId, attachment));
}

export async function resolveTaskImages(taskId, requested = []) {
  if (!Array.isArray(requested) || !requested.length) return [];
  const attachments = await loadMetadata(taskId);
  return requested.map(item => {
    const id = assertSafeSegment(item?.id, 'görsel kimliği');
    const attachment = attachments.find(candidate => candidate.id === id);
    if (!attachment) throw new Error(`Görev görseli bulunamadı: ${item?.name || id}`);
    return { ...publicAttachment(taskId, attachment), path: join(taskDirectory(taskId), attachment.id) };
  });
}

export async function readTaskImage(taskId, imageId) {
  const [image] = await resolveTaskImages(taskId, [{ id: imageId }]);
  return { ...image, data: await readFile(image.path) };
}

export async function deleteTaskImages(taskId) {
  await rm(taskDirectory(taskId), { recursive: true, force: true });
}
