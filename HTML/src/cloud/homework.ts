/**
 * 作业发布 / 接收（码制协议 v2，SSIO KV 单后端）——
 * 自 electron/homework/index.ts 平移：node:crypto HMAC → Web Crypto（码制不变，已分发的码继续有效）。
 *
 * syncCode（8位）= 接收码；publishCode（12位）= syncCode + HMAC-SHA256 校验位 4 位。
 * 存储：SSIO KV `homework/<syncCode>.json`（SSIO_KEYS.homework）。
 * 接收匹配链：手选 > courseKey > guid > 同名。
 */
import { kvGetJson, kvPutJson, kvGet, SSIO_KEYS } from './ssioClient';
import { computeCourseKey, generateGuid } from '../api/dbHandlers';

export const SYNCED_SOURCE_TAG = 'github'; // 历史字面量，语义=「非本地」，勿改（老库存量值）
export const CODE_SECRET = 'StarOS-Homework-Code-v1';
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const SYNC_CODE_LEN = 8;
const PUBLISH_CODE_LEN = 12;

export interface HomeworkEntry {
  id: string;
  title: string;
  content: string;
  type?: string;
  sessionDate: string;
  sessionTime?: string | null;
  dueDate?: number | null;
  publisher: string;
  publishedAt: number;
  updatedAt: number;
}

export interface HomeworkFile {
  syncCode: string;
  courseName: string;
  courseGuid?: string;
  courseKey?: string;
  entries: HomeworkEntry[];
  updatedAt: number;
}

function normalizeSyncCode(raw: string): string | null {
  const s = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== SYNC_CODE_LEN) return null;
  if (![...s].every((c) => CODE_ALPHABET.includes(c))) return null;
  return s;
}

function randomCode(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function bytesToCode(bytes: Uint8Array, len: number): string {
  return [...bytes].slice(0, len).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function hmacHex(msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(CODE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

export function generateCodePair(): { syncCode: string; publishCode: string } {
  const syncCode = randomCode(SYNC_CODE_LEN);
  return { syncCode, publishCode: '' /* 异步派生见 derivePublishCode */ };
}

/** publishCode = syncCode(8位) + HMAC-SHA256 校验位(4位) */
export async function derivePublishCode(syncCode: string): Promise<string> {
  const s = (syncCode || '').trim().toUpperCase();
  const mac = await hmacHex(`publish:${s}`);
  return s + bytesToCode(mac, PUBLISH_CODE_LEN - SYNC_CODE_LEN);
}

/** 校验发布码并提取 syncCode；非法返回 null */
export async function parsePublishCode(raw: string): Promise<string | null> {
  const p = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length !== PUBLISH_CODE_LEN) return null;
  if (![...p].every((c) => CODE_ALPHABET.includes(c))) return null;
  const syncCode = p.slice(0, SYNC_CODE_LEN);
  if ((await derivePublishCode(syncCode)) !== p) return null;
  return syncCode;
}

export async function generateCodePairAsync(): Promise<{ syncCode: string; publishCode: string }> {
  const syncCode = randomCode(SYNC_CODE_LEN);
  return { syncCode, publishCode: await derivePublishCode(syncCode) };
}

/** 拉取作业包（码不存在返回 null） */
export async function fetchBundle(syncCode: string): Promise<HomeworkFile | null> {
  const f = await kvGetJson<HomeworkFile>(SSIO_KEYS.homework(syncCode));
  if (f && Array.isArray(f.entries) && f.syncCode === syncCode) return f;
  return null;
}

/** 发布条目到 SSIO（upsert 进 bundle） */
export async function publishEntries(
  syncCode: string,
  course: { name: string; guid?: string | null },
  entries: Array<{ title: string; content: string; type?: string; sessionDate: string; sessionTime?: string | null; dueDate?: number | null }>,
  publisher: string,
): Promise<{ ok: boolean; error?: string; entriesPublished?: number; bundleCreated?: boolean }> {
  const existing = await fetchBundle(syncCode);
  const now = Date.now();
  const bundle: HomeworkFile = existing ?? {
    syncCode,
    courseName: course.name,
    courseGuid: course.guid ?? undefined,
    courseKey: await computeCourseKey(course.name, ''),
    entries: [],
    updatedAt: now,
  };
  let published = 0;
  for (const e of entries) {
    const id = `${e.sessionDate}:${hashStr(e.title)}`;
    const hit = bundle.entries.find((x) => x.id === id || (x.title === e.title && x.sessionDate === e.sessionDate));
    const entry: HomeworkEntry = {
      id: hit?.id ?? id,
      title: e.title,
      content: e.content,
      type: e.type ?? 'homework',
      sessionDate: e.sessionDate,
      sessionTime: e.sessionTime ?? null,
      dueDate: e.dueDate ?? null,
      publisher,
      publishedAt: hit?.publishedAt ?? now,
      updatedAt: now,
    };
    if (hit) Object.assign(hit, entry);
    else bundle.entries.push(entry);
    published++;
  }
  bundle.entries.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
  bundle.updatedAt = now;
  await kvPutJson(SSIO_KEYS.homework(syncCode), bundle);
  return { ok: true, entriesPublished: published, bundleCreated: !existing };
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export { normalizeSyncCode };
