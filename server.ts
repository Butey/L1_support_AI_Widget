import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
import { AppSettings, AnalyticsRecord, KnowledgeBaseItem } from "./src/types";

if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
}
dotenv.config();

const app = express();
app.set('trust proxy', true);
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Headers for Iframe Embedding.
//
// SECURITY NOTE: this app is always fetched/embedded from the SAME origin
// that serves it (the widget iframe's src points back at this server, and
// the React admin UI is served by this same Express app), so cross-origin
// fetch/XHR access is never legitimately required. We previously sent
// `Access-Control-Allow-Origin: *`, which let ANY third-party website's
// JavaScript call our JSON APIs (including /api/settings, which can return
// raw Gemini/Omnidesk/BookStack credentials when ADMIN_PASSWORD is unset -
// the documented default). We no longer send permissive CORS headers.
// `frame-ancestors` controls who is allowed to <iframe> this app. The
// widget (WidgetUI) posts drafted ticket replies up to `window.parent` via
// `postMessage(..., '*')`, so whoever is allowed to embed the widget can
// receive that content. Once an Omnidesk domain is configured in Settings
// we restrict embedding to that domain; until then we fall back to `*` so
// the widget still works out of the box, but this is only safe for local
// testing/demoing - configure omnidesk_domain before going to production.
app.use((req, res, next) => {
  const configuredDomain = (settings.omnidesk_domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  const frameAncestors = configuredDomain ? `'self' https://${configuredDomain}` : '*';
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
  // NOTE: Cloud Run preview URLs automatically add X-Frame-Options SAMEORIGIN.
  // When deployed to your own VPS, this will allow embedding.
  res.removeHeader('X-Frame-Options');
  next();
});

// Persistence configuration
const STORAGE_DIR = path.join(process.cwd(), 'storage');
const SETTINGS_FILE = path.join(STORAGE_DIR, 'settings.json');
const KB_FILE = path.join(STORAGE_DIR, 'kb.json');
const ANALYTICS_FILE = path.join(STORAGE_DIR, 'analytics.json');
export const RECOGNIZED_IMAGES_FILE = path.join(STORAGE_DIR, 'recognized_images.json');
export const CONVERSATIONS_FILE = path.join(STORAGE_DIR, 'conversations.json');

export const MAX_IMAGE_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MAX_IMAGE_CACHE_RECORDS = 1000; // LRU cap

export interface ConversationMessage {
  id: string;
  timestamp: string;
  role: 'user' | 'assistant';
  staffEmail?: string;
  userQuery?: string;
  replyText: string;
  suggestions?: any[];
  escalation?: any;
  classification?: any;
  imagesAnalyzed?: number;
  imagesCached?: number;
}

export interface TicketConversation {
  caseNumber: string;
  caseId?: string;
  summary?: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export const conversationsCache = new Map<string, TicketConversation>();

export interface RecognizedImageRecord {
  fileId?: string | number;
  url?: string;
  fileName: string;
  fileSize?: number;
  hash?: string;
  caseNumber?: string;
  recognizedAt?: string;
  visualDescription: string;
}

// In-memory cache for recognized image visual descriptions with secondary indexes
export const recognizedImagesCache = new Map<string, RecognizedImageRecord>();
export const recognizedImagesFileIdIndex = new Map<string, string>();
export const recognizedImagesUrlIndex = new Map<string, string>();
export const recognizedImagesHashIndex = new Map<string, string>();
export const recognizedImagesCompositeIndex = new Map<string, string>();

export function getAttachmentCacheKey(att: any, caseNumber?: string): string {
  if (!att) return '';
  if (typeof att === 'string') return att;

  const item = att.message_attachment || att.attachment || att;
  const fileId = item.fileId || item.file_id || item.id;
  if (fileId !== undefined && fileId !== null && String(fileId).trim() !== '') {
    return `id_${String(fileId).trim()}`;
  }

  const rawCase = caseNumber || item.caseNumber || item.case_number;
  const effectiveCase = rawCase ? String(rawCase).replace(/^[№#\s]+/, '').trim() : undefined;
  const fileName = item.fileName || item.file_name || item.name;
  const fileSize = item.fileSize !== undefined ? item.fileSize : (item.file_size !== undefined ? item.file_size : (item.size !== undefined ? item.size : item.sizeBytes));

  if (effectiveCase && fileName && fileSize !== undefined) {
    return `case_${effectiveCase}_${fileName}_${fileSize}`;
  }

  const url = item.url || item.content_url;
  if (url && typeof url === 'string' && url.trim() !== '') {
    return `url_${url.trim()}`;
  }

  const hash = item.hash;
  if (hash && typeof hash === 'string' && hash.trim() !== '') {
    return `hash_${hash.trim()}`;
  }

  if (effectiveCase && fileName) {
    return `case_${effectiveCase}_${fileName}`;
  }

  if (fileName) {
    return `file_${fileName}_${fileSize !== undefined ? fileSize : 0}`;
  }

  return '';
}

export function findInRecognizedCache(att: any, caseNumber?: string): RecognizedImageRecord | null {
  if (!att) return null;

  const rawCase = caseNumber || (typeof att === 'object' ? (att.caseNumber || att.case_number) : undefined);
  const effectiveCase = rawCase ? String(rawCase).replace(/^[№#\s]+/, '').trim() : undefined;

  const checkRecordMatch = (rec: RecognizedImageRecord | null | undefined): RecognizedImageRecord | null => {
    if (!rec) return null;
    // TICKET ISOLATION: if effectiveCase is specified, the record MUST belong to the same case!
    if (effectiveCase && rec.caseNumber) {
      const recCase = String(rec.caseNumber).replace(/^[№#\s]+/, '').trim();
      if (recCase && recCase !== effectiveCase) {
        // Cross-ticket match prohibited!
        return null;
      }
    }
    return rec;
  };

  if (typeof att === 'string') {
    const trimmed = att.trim();
    if (recognizedImagesCache.has(trimmed)) {
      return checkRecordMatch(recognizedImagesCache.get(trimmed));
    }
    if (recognizedImagesHashIndex.has(trimmed)) {
      const pk = recognizedImagesHashIndex.get(trimmed)!;
      return checkRecordMatch(recognizedImagesCache.get(pk));
    }
    if (recognizedImagesFileIdIndex.has(trimmed)) {
      const pk = recognizedImagesFileIdIndex.get(trimmed)!;
      return checkRecordMatch(recognizedImagesCache.get(pk));
    }
    if (recognizedImagesUrlIndex.has(trimmed)) {
      const pk = recognizedImagesUrlIndex.get(trimmed)!;
      return checkRecordMatch(recognizedImagesCache.get(pk));
    }
    return null;
  }

  const item = att.message_attachment || att.attachment || att;

  // 1. By hash
  const hash = item.hash;
  if (hash && typeof hash === 'string') {
    const trimmedHash = hash.trim();
    if (recognizedImagesHashIndex.has(trimmedHash)) {
      const pk = recognizedImagesHashIndex.get(trimmedHash)!;
      const rec = checkRecordMatch(recognizedImagesCache.get(pk));
      if (rec) return rec;
    }
    if (recognizedImagesCache.has(`hash_${trimmedHash}`)) {
      const rec = checkRecordMatch(recognizedImagesCache.get(`hash_${trimmedHash}`));
      if (rec) return rec;
    }
  }

  // 2. By fileId / file_id / id
  const fileId = item.fileId || item.file_id || item.id;
  if (fileId !== undefined && fileId !== null && String(fileId).trim() !== '') {
    const fileIdStr = String(fileId).trim();
    if (recognizedImagesFileIdIndex.has(fileIdStr)) {
      const pk = recognizedImagesFileIdIndex.get(fileIdStr)!;
      const rec = checkRecordMatch(recognizedImagesCache.get(pk));
      if (rec) return rec;
    }
    if (recognizedImagesCache.has(`id_${fileIdStr}`)) {
      const rec = checkRecordMatch(recognizedImagesCache.get(`id_${fileIdStr}`));
      if (rec) return rec;
    }
  }

  // 3. By URL
  const url = item.url || item.content_url;
  if (url && typeof url === 'string' && url.trim() !== '') {
    const urlStr = url.trim();
    if (recognizedImagesUrlIndex.has(urlStr)) {
      const pk = recognizedImagesUrlIndex.get(urlStr)!;
      const rec = checkRecordMatch(recognizedImagesCache.get(pk));
      if (rec) return rec;
    }
    if (recognizedImagesCache.has(`url_${urlStr}`)) {
      const rec = checkRecordMatch(recognizedImagesCache.get(`url_${urlStr}`));
      if (rec) return rec;
    }
  }

  // 4. By composite key (caseNumber + fileName + fileSize)
  const fileName = item.fileName || item.file_name || item.name;
  const fileSize = item.fileSize !== undefined ? item.fileSize : (item.file_size !== undefined ? item.file_size : (item.size !== undefined ? item.size : item.sizeBytes));

  if (effectiveCase && fileName) {
    if (fileSize !== undefined) {
      const compKey = `case_${effectiveCase}_${fileName}_${fileSize}`;
      if (recognizedImagesCompositeIndex.has(compKey)) {
        const pk = recognizedImagesCompositeIndex.get(compKey)!;
        const rec = checkRecordMatch(recognizedImagesCache.get(pk));
        if (rec) return rec;
      }
      if (recognizedImagesCache.has(compKey)) {
        const rec = checkRecordMatch(recognizedImagesCache.get(compKey));
        if (rec) return rec;
      }
    }
    const compKey0 = `case_${effectiveCase}_${fileName}_0`;
    if (recognizedImagesCompositeIndex.has(compKey0)) {
      const pk = recognizedImagesCompositeIndex.get(compKey0)!;
      const rec = checkRecordMatch(recognizedImagesCache.get(pk));
      if (rec) return rec;
    }
    if (recognizedImagesCache.has(compKey0)) {
      const rec = checkRecordMatch(recognizedImagesCache.get(compKey0));
      if (rec) return rec;
    }
  }

  // 5. Fallback: try getAttachmentCacheKey
  const fallbackKey = getAttachmentCacheKey(item, caseNumber);
  if (fallbackKey && recognizedImagesCache.has(fallbackKey)) {
    return checkRecordMatch(recognizedImagesCache.get(fallbackKey));
  }

  return null;
}

export function saveRecognizedImages(): void {
  try {
    const now = Date.now();
    let uniqueRecords = Array.from(new Set(recognizedImagesCache.values()));
    // TTL eviction (14 days)
    uniqueRecords = uniqueRecords.filter(rec => {
      if (!rec.recognizedAt) return true;
      const recTime = new Date(rec.recognizedAt).getTime();
      return isNaN(recTime) || (now - recTime) < MAX_IMAGE_CACHE_AGE_MS;
    });
    // LRU cap: max 1000 records
    if (uniqueRecords.length > MAX_IMAGE_CACHE_RECORDS) {
      uniqueRecords.sort((a, b) => new Date(b.recognizedAt || 0).getTime() - new Date(a.recognizedAt || 0).getTime());
      uniqueRecords = uniqueRecords.slice(0, MAX_IMAGE_CACHE_RECORDS);
    }
    const tempFile = `${RECOGNIZED_IMAGES_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(uniqueRecords, null, 2), 'utf-8');
    fs.renameSync(tempFile, RECOGNIZED_IMAGES_FILE);
  } catch (err) {
    console.error(`[Persistence] FAILED to write recognized images to ${RECOGNIZED_IMAGES_FILE}:`, err);
  }
}

export function clearTicketImagesCache(caseNumber: string): number {
  const cleanCase = String(caseNumber).replace(/^[№#\s]+/, '').trim();
  if (!cleanCase) return 0;
  let deletedCount = 0;
  for (const [key, rec] of Array.from(recognizedImagesCache.entries())) {
    if (rec.caseNumber && String(rec.caseNumber).replace(/^[№#\s]+/, '').trim() === cleanCase) {
      recognizedImagesCache.delete(key);
      deletedCount++;
    }
  }
  for (const [key] of Array.from(recognizedImagesCompositeIndex.entries())) {
    if (key.startsWith(`case_${cleanCase}_`)) {
      recognizedImagesCompositeIndex.delete(key);
    }
  }
  saveRecognizedImages();
  return deletedCount;
}

// ─── Conversation History Persistence ──────────────────────────────────────────
export function saveConversations(): void {
  try {
    const list = Array.from(new Set(conversationsCache.values()));
    const tempFile = `${CONVERSATIONS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tempFile, CONVERSATIONS_FILE);
  } catch (err) {
    console.error(`[Persistence] FAILED to write conversations to ${CONVERSATIONS_FILE}:`, err);
  }
}

export function loadConversations(): void {
  try {
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      const raw = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8').trim();
      if (raw) {
        const list: TicketConversation[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.caseNumber) {
              const clean = String(item.caseNumber).replace(/^[№#\s]+/, '').trim();
              conversationsCache.set(clean, item);
              const noHyphens = clean.replace(/-/g, '');
              if (noHyphens !== clean) {
                conversationsCache.set(noHyphens, item);
              }
            }
            if (item && item.caseId) {
              const cleanId = String(item.caseId).trim();
              if (cleanId) {
                conversationsCache.set(cleanId, item);
              }
            }
            if (!item.summary && item.messages && item.messages.length > 0) {
              item.summary = buildConversationSummary(item.messages);
            }
          }
          console.log(`[Conversations] Loaded ${conversationsCache.size} conversation index entries from disk.`);
        }
      }
    }
  } catch (err) {
    console.error(`[Conversations] Error loading conversations from ${CONVERSATIONS_FILE}:`, err);
  }
}

export function getTicketConversation(caseIdentifier: string): TicketConversation | null {
  if (!caseIdentifier) return null;
  const clean = String(caseIdentifier).replace(/^[№#\s]+/, '').trim();
  if (!clean) return null;

  // 1. Direct cache lookup
  if (conversationsCache.has(clean)) {
    return conversationsCache.get(clean)!;
  }

  // 2. Lookup without hyphens (e.g. 495685067 vs 495-685067)
  const noHyphens = clean.replace(/-/g, '');
  if (conversationsCache.has(noHyphens)) {
    return conversationsCache.get(noHyphens)!;
  }

  // 3. Scan values for caseId or caseNumber match
  for (const conv of conversationsCache.values()) {
    if (conv.caseNumber === clean || conv.caseId === clean) {
      conversationsCache.set(clean, conv);
      return conv;
    }
    if (conv.caseNumber && conv.caseNumber.replace(/-/g, '') === noHyphens) {
      conversationsCache.set(clean, conv);
      return conv;
    }
  }

  return null;
}

export function buildConversationSummary(messages: ConversationMessage[]): string {
  if (!messages || messages.length === 0) return '';

  const turnsCount = messages.length;
  const userQueries = messages
    .map(m => m.userQuery?.trim())
    .filter((q): q is string => Boolean(q));

  const lastMsg = messages[messages.length - 1];
  const parts: string[] = [];

  const turnsWord = turnsCount === 1 ? 'обращение' : (turnsCount < 5 ? 'обращения' : 'обращений');
  parts.push(`Ранее в виджете зафиксировано ${turnsCount} ${turnsWord}.`);

  if (userQueries.length > 0) {
    const recentQueries = userQueries.slice(-3).map(q => `«${q.length > 70 ? q.slice(0, 67) + '...' : q}»`).join('; ');
    parts.push(`Обсуждались темы: ${recentQueries}.`);
  }

  if (lastMsg.replyText) {
    const cleanReply = lastMsg.replyText
      .replace(/:::[\s\S]*?:::/g, '')
      .replace(/[#*`_~]/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
    if (cleanReply) {
      const snippet = cleanReply.length > 160 ? cleanReply.slice(0, 157) + '...' : cleanReply;
      parts.push(`Итог последнего ответа: ${snippet}`);
    }
  }

  const hasDrafts = messages.some(m => Array.isArray(m.suggestions) && m.suggestions.length > 0);
  if (hasDrafts) {
    parts.push('Сформирован черновик ответа клиенту.');
  }

  const lastWithClassification = [...messages].reverse().find(m => m.classification?.fields && Object.keys(m.classification.fields).length > 0);
  if (lastWithClassification?.classification?.readable) {
    const classSummary = Object.entries(lastWithClassification.classification.readable)
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    parts.push(`Классификация: ${classSummary}.`);
  }

  const lastWithEscalation = [...messages].reverse().find(m => m.escalation?.required);
  if (lastWithEscalation) {
    parts.push(lastWithEscalation.escalation.notePushed ? 'Заметка эскалации отправлена в Omnidesk.' : 'Требуется эскалация.');
  }

  return parts.join(' ');
}

export function addTicketConversationMessage(
  caseIdentifier: string,
  message: Partial<ConversationMessage> & { replyText: string },
  caseId?: string
): void {
  const clean = String(caseIdentifier).replace(/^[№#\s]+/, '').trim();
  const cleanCaseId = caseId ? String(caseId).trim() : undefined;
  if (!clean && !cleanCaseId) return;

  const targetKey = clean || cleanCaseId || 'OMNIDESK_ACTIVE_TICKET';

  let conv = getTicketConversation(targetKey);
  if (!conv && cleanCaseId) {
    conv = getTicketConversation(cleanCaseId);
  }

  if (!conv) {
    conv = {
      caseNumber: clean || cleanCaseId || 'OMNIDESK_ACTIVE_TICKET',
      caseId: cleanCaseId,
      updatedAt: new Date().toISOString(),
      messages: []
    };
  }

  if (cleanCaseId && !conv.caseId) {
    conv.caseId = cleanCaseId;
  }
  if (clean && clean !== 'OMNIDESK_ACTIVE_TICKET' && (conv.caseNumber === 'OMNIDESK_ACTIVE_TICKET' || !conv.caseNumber)) {
    conv.caseNumber = clean;
  }

  const newMsg: ConversationMessage = {
    id: message.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: message.timestamp || new Date().toISOString(),
    role: message.role || 'assistant',
    staffEmail: message.staffEmail,
    userQuery: message.userQuery,
    replyText: message.replyText || '',
    suggestions: message.suggestions,
    escalation: message.escalation,
    classification: message.classification,
    imagesAnalyzed: message.imagesAnalyzed,
    imagesCached: message.imagesCached
  };

  conv.messages.push(newMsg);
  if (conv.messages.length > 50) {
    conv.messages = conv.messages.slice(-50);
  }
  conv.summary = buildConversationSummary(conv.messages);
  conv.updatedAt = new Date().toISOString();

  // Index in cache under all known aliases
  conversationsCache.set(targetKey, conv);
  if (conv.caseNumber) {
    conversationsCache.set(conv.caseNumber, conv);
    const noHyphens = conv.caseNumber.replace(/-/g, '');
    if (noHyphens !== conv.caseNumber) {
      conversationsCache.set(noHyphens, conv);
    }
  }
  if (conv.caseId) {
    conversationsCache.set(conv.caseId, conv);
  }

  saveConversations();
}

export function clearTicketConversation(caseIdentifier: string): boolean {
  if (!caseIdentifier) return false;
  const clean = String(caseIdentifier).replace(/^[№#\s]+/, '').trim();
  if (!clean) return false;

  const conv = getTicketConversation(clean);
  if (!conv) {
    const existed = conversationsCache.delete(clean);
    if (existed) saveConversations();
    return existed;
  }

  let removed = false;
  for (const [key, value] of conversationsCache.entries()) {
    if (value === conv || key === clean || key === conv.caseNumber || (conv.caseId && key === conv.caseId)) {
      conversationsCache.delete(key);
      removed = true;
    }
  }
  if (removed) saveConversations();
  return removed;
}

function internalRecordRecognizedImage(record: RecognizedImageRecord, shouldSave = true): void {
  if (!record || !record.fileName) return;

  const rawCase = record.caseNumber;
  const cleanCase = rawCase ? String(rawCase).replace(/^[№#\s]+/, '').trim() : undefined;
  const fileIdStr = (record.fileId !== undefined && record.fileId !== null && String(record.fileId).trim() !== '')
    ? String(record.fileId).trim()
    : undefined;
  const urlStr = (record.url && typeof record.url === 'string' && record.url.trim() !== '')
    ? record.url.trim()
    : undefined;
  const hashStr = (record.hash && typeof record.hash === 'string' && record.hash.trim() !== '')
    ? record.hash.trim()
    : undefined;
  const compKey = (cleanCase && record.fileName)
    ? `case_${cleanCase}_${record.fileName}_${record.fileSize !== undefined ? record.fileSize : 0}`
    : undefined;

  const primaryKey = fileIdStr
    ? `id_${fileIdStr}`
    : (hashStr
        ? `hash_${hashStr}`
        : (urlStr
            ? `url_${urlStr}`
            : (compKey || `file_${record.fileName}_${record.fileSize || 0}`)));

  const existing = recognizedImagesCache.get(primaryKey);
  const updated: RecognizedImageRecord = {
    ...existing,
    ...record,
    caseNumber: cleanCase || record.caseNumber || existing?.caseNumber,
    fileId: record.fileId ?? existing?.fileId,
    url: record.url ?? existing?.url,
    hash: record.hash ?? existing?.hash,
    fileSize: record.fileSize ?? existing?.fileSize,
    recognizedAt: record.recognizedAt || existing?.recognizedAt || new Date().toISOString(),
    visualDescription: record.visualDescription || existing?.visualDescription || ''
  };

  recognizedImagesCache.set(primaryKey, updated);

  if (fileIdStr) {
    recognizedImagesFileIdIndex.set(fileIdStr, primaryKey);
    recognizedImagesCache.set(`id_${fileIdStr}`, updated);
  }
  if (urlStr) {
    recognizedImagesUrlIndex.set(urlStr, primaryKey);
    recognizedImagesCache.set(`url_${urlStr}`, updated);
  }
  if (hashStr) {
    recognizedImagesHashIndex.set(hashStr, primaryKey);
    recognizedImagesCache.set(`hash_${hashStr}`, updated);
  }
  if (compKey) {
    recognizedImagesCompositeIndex.set(compKey, primaryKey);
    recognizedImagesCache.set(compKey, updated);
  }

  if (shouldSave) {
    saveRecognizedImages();
  }
}

export function recordRecognizedImage(record: RecognizedImageRecord): void {
  internalRecordRecognizedImage(record, true);
}

export function loadRecognizedImages(): void {
  try {
    if (fs.existsSync(RECOGNIZED_IMAGES_FILE)) {
      const raw = fs.readFileSync(RECOGNIZED_IMAGES_FILE, 'utf-8').trim();
      if (raw) {
        const records: RecognizedImageRecord[] = JSON.parse(raw);
        if (Array.isArray(records)) {
          for (const rec of records) {
            internalRecordRecognizedImage(rec, false);
          }
          console.log(`[ImageCache] Loaded ${records.length} recognized images from disk.`);
        }
      }
    }
  } catch (err) {
    console.error(`[ImageCache] Error loading recognized images from ${RECOGNIZED_IMAGES_FILE}:`, err);
  }
}

export function clearRecognizedImagesCache(): void {
  recognizedImagesCache.clear();
  recognizedImagesFileIdIndex.clear();
  recognizedImagesUrlIndex.clear();
  recognizedImagesHashIndex.clear();
  recognizedImagesCompositeIndex.clear();
}

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// DOCKER PERMISSIONS FIX: docker-compose.yml bind-mounts a host directory
// onto ./storage (`- ./storage:/app/storage`) so settings/API keys survive
// container restarts. On a fresh VPS the host-side `storage/` folder
// doesn't exist yet, so Docker auto-creates it owned by root; a bind mount
// keeps that host ownership visible inside the container, shadowing
// whatever the image had there. The app process is normally started as the
// unprivileged `node` user (see Dockerfile), which then has no permission
// to write into a root-owned bind-mounted directory - every
// fs.writeFileSync() below failed with EACCES, silently (only logged to
// console.error), so settings/API keys looked like they reset on every
// restart even though nothing in the app logic was actually resetting
// them. If Docker happens to start us as root (uid 0) - which it will if
// this exact scenario recurs - fix ownership of the storage dir here, then
// immediately drop to the unprivileged `node` account (uid/gid 1000 in the
// official node:*-slim images) for the rest of the process lifetime; we
// should never serve HTTP requests as root. This is a no-op everywhere
// else (local dev, non-Docker deployments, non-root containers).
if (process.env.NODE_ENV !== 'test' && process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) {
  try {
    fs.chownSync(STORAGE_DIR, 1000, 1000);
    process.setgid?.(1000);
    process.setuid?.(1000);
    console.log('[Startup] Was running as root (likely a fresh Docker bind mount) - fixed /app/storage ownership and dropped to uid/gid 1000.');
  } catch (err) {
    console.error('[Startup] Failed to fix storage ownership / drop root privileges. Settings may fail to save - check that the host ./storage folder is writable by uid 1000.', err);
  }
}

// In-memory data store (simulating a DB)
let settings: AppSettings = {
  llm_endpoint: "gemini",
  model_name: "gemini-3.5-flash",
  custom_models: "",
  api_key: process.env.GEMINI_API_KEY || "",
  api_key_pool: "",
  system_prompt: "You are the L1 Support AI Assistant. Your role is to help support engineers provide fast, accurate, and empathetic assistance based on verified documentation.\n\nSOURCES AND CONTEXT:\nYou must answer questions using verified information from official documentation and the connected Knowledge Base.\n\nSTRICT RULES OF RELIABILITY:\n- Never invent features or technical details.\n- Never speculate.\n- If information is unavailable or uncertain in the provided context, you must explicitly state that the information is not found in known documentation.\n\nRESPONSE FORMAT AND STYLE:\n- Prefer concise, structured responses.\n- Use step-by-step instructions where applicable.\n- Include configuration examples and code blocks if documented.\n- Always reply in Russian unless requested otherwise.",
  temperature: 0.7,
  top_p: 0.95,
  max_tokens: 2048,
  skills: JSON.stringify([
    {
      id: "s1",
      name: "Technical Support Expert",
      content: "# Technical Support Skill\n- Priority: High\n- Capabilities: Troubleshooting, Documentation lookup, Ticket classification\n- Guidelines: Be concise, use professional tone, always verify user ID.",
      enabled: true,
      source: "integrated",
      imported_at: new Date().toISOString()
    },
    {
      id: "s2",
      name: "Agentic Optimization",
      content: "# Agentic Optimization Skill\n- Capabilities: Chain-of-thought verification, Self-correction, Resource allocation\n- Goal: Minimize token usage while maximizing accuracy.",
      enabled: true,
      source: "integrated",
      imported_at: new Date().toISOString()
    }
  ], null, 2),
  mcp_servers: "{}",
  context_files: "/data/knowledge_index.bin",
  skill_import_url: "https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/plugins/agentic-awesome-skills-claude/skills/customer-support/SKILL.md",
  skill_repo_url: "https://github.com/sickn33/antigravity-awesome-skills",
  bookstack_url: "",
  bookstack_token_id: "",
  bookstack_token_secret: "",
  omnidesk_api_key: "",
  omnidesk_email: "",
  omnidesk_domain: "support.omnidesk.ru",
  enable_context: true,
  notification_channels: {
    telegram: { enabled: false, chat_id: "" },
    gotify: { enabled: false, url: "" }
  },
  theme: 'dark',
  language: 'ru',
  quick_actions: JSON.stringify([
    { icon: '📊', ru: 'Анализ кейса', en: 'Analyze Case', prompt: 'Проанализируй этот тикет и дай краткую сводку.' },
    { icon: '❓', ru: 'Что запросить', en: 'What to ask', prompt: 'Что еще нужно запросить у клиента для решения вопроса?' },
    { icon: '✂️', ru: 'Сократить', en: 'Shorten', prompt: 'Сократи предложенный ответ, сделай его более лаконичным.' },
    { icon: '📝', ru: 'Формально', en: 'Formal', prompt: 'Перепиши ответ в более формальном и деловом стиле.' },
    { icon: '🌐', ru: 'На English', en: 'To English', prompt: 'Переведи ответ на английский язык.' },
    { icon: '💡', ru: 'Просто', en: 'Simple', prompt: 'Объясни решение простыми словами, без сложных терминов.' }
  ])
};

let analyticsLogs: AnalyticsRecord[] = [];
let knowledgeBase: KnowledgeBaseItem[] = [
  { id: '1', title: 'BookStack Integration', content: 'BookStack can be integrated via webhooks and custom widgets.', tags: ['integration', 'bookstack'] },
  { id: '2', title: 'Resetting Password', content: 'To reset the password, go to settings and click on "Forgot Password".', tags: ['account', 'security'] }
];

// Load persisted data if available
const loadData = () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8').trim();
      if (raw) {
        settings = { ...settings, ...JSON.parse(raw) };
        // Upgrade system prompt if it contains old default value
        if (settings.system_prompt && settings.system_prompt.startsWith("You are a helpful technical support assistant")) {
          settings.system_prompt = "You are the L1 Support AI Assistant. Your role is to help support engineers provide fast, accurate, and empathetic assistance based on verified documentation.\n\nSOURCES AND CONTEXT:\nYou must answer questions using verified information from official documentation and the connected Knowledge Base.\n\nSTRICT RULES OF RELIABILITY:\n- Never invent features or technical details.\n- Never speculate.\n- If information is unavailable or uncertain in the provided context, you must explicitly state that the information is not found in known documentation.\n\nRESPONSE FORMAT AND STYLE:\n- Prefer concise, structured responses.\n- Use step-by-step instructions where applicable.\n- Include configuration examples and code blocks if documented.\n- Always reply in Russian unless requested otherwise.";
          saveData();
        }
      }
    }
    if (fs.existsSync(KB_FILE)) {
      const raw = fs.readFileSync(KB_FILE, 'utf-8').trim();
      if (raw) {
        knowledgeBase = JSON.parse(raw);
      }
    }
    if (fs.existsSync(ANALYTICS_FILE)) {
      const raw = fs.readFileSync(ANALYTICS_FILE, 'utf-8').trim();
      if (raw) {
        analyticsLogs = JSON.parse(raw);
        console.log(`[Persistence] Loaded ${analyticsLogs.length} analytics records from disk.`);
      }
    }
  } catch (err) {
    console.error('Error loading persisted data:', err);
  }
};

const saveAnalyticsData = () => {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analyticsLogs, null, 2));
  } catch (err) {
    console.error(`[Persistence] FAILED to write analytics to ${STORAGE_DIR}:`, err);
  }
};

const saveData = () => {
  if (process.env.NODE_ENV === 'test') {
    return; // Prevent test suites from modifying production data files on disk
  }
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    fs.writeFileSync(KB_FILE, JSON.stringify(knowledgeBase, null, 2));
    saveAnalyticsData();
  } catch (err) {
    console.error(`[Persistence] FAILED to write settings/knowledge base to ${STORAGE_DIR} - changes will be LOST on restart. Underlying error:`, err);
  }
};

loadData();
loadRecognizedImages();
loadConversations();

// API Key Rotation Helpers
let lastUsedKeyIndex = 0;

// Cascading model fallback chain: ordered from most capable/stable to lightest.
// When a model hits rate limits, the system tries the next model in the chain.
const MODEL_FALLBACK_CHAIN: string[] = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

/** Check if an error is a rate-limit / quota / overload error */
function isRateLimitError(err: any): boolean {
  const msg = (err?.message || err?.toString() || '').toLowerCase();
  const status = err?.status || err?.httpStatusCode || 0;
  return (
    status === 429 ||
    status === 503 ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('quota') ||
    msg.includes('high demand') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('too many requests')
  );
}

/** Get the list of fallback models to try after the given model */
function getFallbackModels(currentModel: string): string[] {
  const idx = MODEL_FALLBACK_CHAIN.indexOf(currentModel);
  if (idx === -1) return MODEL_FALLBACK_CHAIN;
  return MODEL_FALLBACK_CHAIN.slice(idx + 1);
}

// Cascading model fallback chain for image/multimodal requests:
// Routes immediately to lightweight, high-throughput models (3.5-flash-lite, 3.1-flash-lite)
// to prevent rate limits, thinking latency, and quota exhaustion on heavier models.
export const IMAGE_MODEL_FALLBACK_CHAIN: string[] = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

/** Get the list of fallback models to try after the given model for image requests */
export function getFallbackModelsForImages(currentModel: string): string[] {
  const idx = IMAGE_MODEL_FALLBACK_CHAIN.indexOf(currentModel);
  if (idx === -1) return IMAGE_MODEL_FALLBACK_CHAIN;
  return IMAGE_MODEL_FALLBACK_CHAIN.slice(idx + 1);
}

/** Determine the target model: image requests immediately use fast multimodal model (3.5-flash-lite) */
export function selectModelForRequest(baseModel: string, hasImages: boolean, isCustom: boolean = false): string {
  if (isCustom) return baseModel;
  if (hasImages) {
    return baseModel === 'gemini-3.1-flash-lite' ? 'gemini-3.1-flash-lite' : 'gemini-3.5-flash-lite';
  }
  return baseModel || 'gemini-3.8-flash';
}

function getModelGenerationConfig(modelName: string, baseConfig: any = {}): any {
  const config = { ...baseConfig };
  if (!modelName.includes('lite') && !modelName.startsWith('gemma')) {
    config.thinkingConfig = { thinkingBudget: 0 };
  } else {
    delete config.thinkingConfig;
  }
  return config;
}

const maskApiKey = (key: string): string => {
  if (!key) return "N/A";
  if (key.length <= 10) return "***";
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
};

// Mask a settings field that may contain one secret ("api_key") or a
// newline/comma/semicolon separated list of secrets ("api_key_pool") before
// it's ever sent to the browser. `/api/settings` used to echo these back
// verbatim to anyone who could reach it - see the SECRET_FIELDS handling in
// the settings routes below for how the masked value round-trips safely.
const maskSecretField = (value: string): string => {
  if (!value) return "";
  return value
    .split(/[\n,;]+/)
    .map(v => v.trim())
    .filter(v => v.length > 0)
    .map(maskApiKey)
    .join('\n');
};

// Settings fields that hold credentials and must never be returned raw
// from the API - only masked, or omitted entirely.
const SECRET_SETTINGS_FIELDS: (keyof AppSettings)[] = [
  'api_key', 'api_key_pool', 'omnidesk_api_key', 'bookstack_token_secret'
];

const getApiKeysPool = (): string[] => {
  const keys: string[] = [];
  
  // 1. Primary key
  const primaryKey = settings.api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
  if (primaryKey && primaryKey.trim()) {
    keys.push(primaryKey.trim());
  }
  
  // 2. Backup pool keys
  if (settings.api_key_pool) {
    const backupKeys = settings.api_key_pool
      .split(/[\n,;]+/)
      .map(k => k.trim())
      .filter(k => k.length > 0);
      
    for (const key of backupKeys) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  
  return keys;
};

// Gemini Initialization
let ai = new GoogleGenAI({
  apiKey: settings.api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper for logging
// analyticsLogs is an in-memory array with no persistence and, previously,
// no upper bound - every /api/chat call (reachable without auth whenever
// ADMIN_PASSWORD is unset) appended to it forever, so a long-running
// deployment would leak memory until it crashed. Cap it to the most recent
// entries.
const MAX_ANALYTICS_LOGS = 5000;

let analyticsSaveTimeout: NodeJS.Timeout | null = null;
const debouncedSaveAnalytics = () => {
  if (analyticsSaveTimeout) clearTimeout(analyticsSaveTimeout);
  analyticsSaveTimeout = setTimeout(() => {
    saveAnalyticsData();
  }, 1000);
};

const logAnalytics = (action: AnalyticsRecord['action'], metadata: any) => {
  const record: AnalyticsRecord = {
    id: Math.random().toString(36).substr(2, 9),
    action,
    metadata,
    timestamp: new Date().toISOString()
  };
  analyticsLogs.push(record);
  if (analyticsLogs.length > MAX_ANALYTICS_LOGS) {
    analyticsLogs.splice(0, analyticsLogs.length - MAX_ANALYTICS_LOGS);
  }
  debouncedSaveAnalytics();
  console.log(`[Analytics] ${action}:`, metadata);
};

// --- API Routes ---

// Constant-time compare so an attacker can't guess the admin password byte
// by byte via response latency.
const secureCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return next();

  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${adminPassword}`;
  if (secureCompare(authHeader, expected)) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
};

// Widget Shared Secret Authentication
// All widget-facing endpoints require a shared secret passed via X-Widget-Secret (or X-Omni-Widget-Secret)
// header or query parameter (ws/secret) matching WIDGET_SECRET in environment. Requests with missing or invalid secret return 401.
// Bearer admin password (or query param token) is also accepted for administrator dashboard widget preview & standalone windows.
const requireWidgetAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const widgetSecret = process.env.WIDGET_SECRET || process.env.OMNI_WIDGET_SECRET;
  const rawSecret = req.headers['x-widget-secret'] || req.headers['x-omni-widget-secret'] || req.query.secret || req.query.ws || req.query.widget_secret;
  const clientSecret = Array.isArray(rawSecret) ? rawSecret[0] : (typeof rawSecret === 'string' ? rawSecret : undefined);

  if (widgetSecret && typeof clientSecret === 'string' && secureCompare(clientSecret, widgetSecret)) {
    return next();
  }

  // Also allow admin auth (Bearer admin password or query token) so admin panel widget preview & popups work
  const adminPassword = process.env.ADMIN_PASSWORD;
  const authHeader = req.headers.authorization || '';
  const rawQueryToken = req.query.token || req.query.admin_token;
  const queryToken = typeof rawQueryToken === 'string' ? rawQueryToken : (Array.isArray(rawQueryToken) && typeof rawQueryToken[0] === 'string' ? rawQueryToken[0] : undefined);
  if (adminPassword) {
    if (authHeader && secureCompare(authHeader, `Bearer ${adminPassword}`)) {
      return next();
    }
    if (queryToken && secureCompare(queryToken, adminPassword)) {
      return next();
    }
  }

  return res.status(401).json({ error: "Unauthorized: Missing or invalid widget secret" });
};

app.post("/api/auth/login", (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return res.json({ success: true, token: "no-password-required" });

  const { password } = req.body;
  if (typeof password === 'string' && secureCompare(password, adminPassword)) {
    return res.json({ success: true, token: password });
  }
  return res.status(401).json({ error: "Invalid password" });
});

app.get("/api/auth/status", (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  res.json({ required: !!adminPassword });
});

// Auto-config endpoint for widget interface and standalone windows
app.get("/api/widget/config", (req, res) => {
  const widgetSecret = process.env.WIDGET_SECRET || process.env.OMNI_WIDGET_SECRET || '';
  const adminPassword = process.env.ADMIN_PASSWORD;

  const authHeader = req.headers.authorization || '';
  const rawQueryToken = req.query.token || req.query.admin_token;
  const queryToken = typeof rawQueryToken === 'string' ? rawQueryToken : (Array.isArray(rawQueryToken) && typeof rawQueryToken[0] === 'string' ? rawQueryToken[0] : undefined);
  const rawWs = req.headers['x-widget-secret'] || req.headers['x-omni-widget-secret'] || req.query.ws || req.query.secret;
  const ws = typeof rawWs === 'string' ? rawWs : (Array.isArray(rawWs) && typeof rawWs[0] === 'string' ? rawWs[0] : undefined);

  const isAdmin = !adminPassword || 
    (adminPassword && authHeader && secureCompare(authHeader, `Bearer ${adminPassword}`)) ||
    Boolean(adminPassword && queryToken && secureCompare(queryToken, adminPassword));

  const isWidget = Boolean(widgetSecret && ws && secureCompare(ws, widgetSecret));

  // Also allow requests originating from same server domain or localhost
  const host = req.headers.host || '';
  const referer = req.headers.referer || '';
  const origin = req.headers.origin || '';
  const isSameOrigin = Boolean((referer && host && referer.includes(host)) || (origin && host && origin.includes(host)));

  if (isAdmin || isWidget || isSameOrigin) {
    return res.json({
      widgetSecret,
      omnideskDomain: settings.omnidesk_domain || ''
    });
  }

  return res.status(401).json({ error: "Unauthorized" });
});

async function resolveCaseId(caseNumber: string, staffEmail?: string): Promise<string | null> {
  if (!settings.omnidesk_domain || !settings.omnidesk_api_key || !settings.omnidesk_email) return null;
  const caseIdMatch = caseNumber.match(/([0-9-]+)$/);
  if (!caseIdMatch) return null;
  let caseId = caseIdMatch[1];
  
  if (caseId.includes('-')) {
    try {
      const effectiveEmail = (staffEmail && staffEmail.trim()) ? staffEmail.trim() : settings.omnidesk_email;
      const domain = settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const auth = Buffer.from(`${effectiveEmail}:${settings.omnidesk_api_key}`).toString('base64');
      const searchRes = await fetch(`https://${domain}/api/cases.json?case_number=${caseId}`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const casesArray = Array.isArray(searchData) ? searchData : Object.values(searchData).filter((v: any) => v && v.case);
        const caseObj = casesArray.find((c: any) => c.case && String(c.case.case_number) === String(caseId));
        if (caseObj && caseObj.case) {
          return caseObj.case.case_id.toString();
        }
        return null;
      }
      return null;
    } catch (e) {
      console.error('Error resolving caseId:', e);
      return null;
    }
  }
  return caseId;
}

interface TicketAttachment {
  file_id?: number;
  file_name: string;
  file_size?: number;
  mime_type: string;
  url: string;
  from_role: 'CLIENT' | 'STAFF';
}

interface TicketFetchResult {
  success: boolean;
  status: number;
  data?: {
    subject: string;
    description: string;
    messages?: string[];
    case_id?: number | string;
    case_number?: string;
    has_staff_reply?: boolean;
    attachments?: TicketAttachment[];
    labels?: string[];
    has_presale_label?: boolean;
  };
  error?: string;
}

async function verifyAndFetchOmnideskTicket(caseNumber: string, staffEmail?: string): Promise<TicketFetchResult> {
  if (!settings.omnidesk_domain || !settings.omnidesk_api_key || !settings.omnidesk_email) {
    return { success: false, status: 503, error: "Omnidesk API is not configured in Settings" };
  }

  try {
    const effectiveEmail = (staffEmail && staffEmail.trim()) ? staffEmail.trim() : settings.omnidesk_email;
    const caseId = await resolveCaseId(caseNumber, effectiveEmail);
    if (!caseId) {
      return { success: false, status: 403, error: "Access denied or ticket not found in Omnidesk" };
    }
    
    const domain = settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${effectiveEmail}:${settings.omnidesk_api_key}`).toString('base64');

    const caseRes = await fetch(`https://${domain}/api/cases/${caseId}.json`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!caseRes.ok) {
      return { success: false, status: 403, error: "Access denied to ticket in Omnidesk" };
    }
    const caseData = await caseRes.json();
    const caseInfo = caseData.case || {};

    const extractedLabels: string[] = [];
    const rawLabels = caseInfo.labels || caseInfo.labels_list || caseInfo.label_titles || caseInfo.tags || [];
    if (Array.isArray(rawLabels)) {
      for (const item of rawLabels) {
        if (typeof item === 'string') {
          extractedLabels.push(item);
        } else if (item && typeof item === 'object') {
          if (item.label_title) extractedLabels.push(String(item.label_title));
          else if (item.title) extractedLabels.push(String(item.title));
          else if (item.name) extractedLabels.push(String(item.name));
        }
      }
    } else if (typeof rawLabels === 'string') {
      extractedLabels.push(...rawLabels.split(',').map(s => s.trim()).filter(Boolean));
    }

    const hasPresaleLabel = extractedLabels.some(l => /(?:1\s*[\.\-]?\s*пресейл|1\s*[\.\-]?\s*presale|presale)/i.test(l));
    
    const msgsRes = await fetch(`https://${domain}/api/cases/${caseId}/messages.json?limit=100&order=desc`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    let description = '';
    let rawMessages: string[] = [];
    let hasStaffReply = false;
    const ticketAttachments: TicketAttachment[] = [];
    if (msgsRes.ok) {
      const msgsData = await msgsRes.json();
      let msgsArray: any[] = [];
      if (Array.isArray(msgsData)) {
        msgsArray = msgsData;
      } else if (msgsData._embedded?.messages) {
        msgsArray = msgsData._embedded.messages;
      } else if (typeof msgsData === 'object' && msgsData !== null) {
        msgsArray = Object.values(msgsData).filter((v: any) => v && typeof v === 'object' && (v.message || v.content || v.content_html));
      }
      
      const unwrapMsgs = msgsArray.map((m: any) => m.message || m);
      hasStaffReply = unwrapMsgs.some((m: any) => !m.user_id || m.staff_id);
      // order=desc was requested, reverse to chronological order
      unwrapMsgs.reverse();

      // Extract image attachments from messages
      for (const msg of unwrapMsgs) {
        const role: 'CLIENT' | 'STAFF' = msg.user_id ? 'CLIENT' : 'STAFF';
        const rawAtts = Array.isArray(msg.attachments)
          ? msg.attachments
          : (typeof msg.attachments === 'object' && msg.attachments !== null
              ? Object.values(msg.attachments)
              : []);
        for (const att of rawAtts as any[]) {
          if (att && att.url && att.mime_type) {
            ticketAttachments.push({
              file_id: att.file_id,
              file_name: att.file_name || 'attachment',
              file_size: att.file_size || 0,
              mime_type: String(att.mime_type).toLowerCase().trim(),
              url: att.url,
              from_role: role
            });
          }
        }
      }

      rawMessages = unwrapMsgs.map((msg: any) => {
        return msg.content_html ? msg.content_html.replace(/<[^>]+>/g, ' ').trim() : (msg.content || '').trim();
      }).filter((t: string) => Boolean(t && t.length > 0));

      description = unwrapMsgs.map((msg: any) => {
        const text = msg.content_html ? msg.content_html.replace(/<[^>]+>/g, '') : (msg.content || '');
        return `${msg.user_id ? 'CLIENT' : 'STAFF'}: ${text}`;
      }).join('\n\n');
    }
    
    return {
      success: true,
      status: 200,
      data: {
        subject: caseInfo.subject || '',
        description: description || 'No messages found.',
        messages: rawMessages,
        case_id: caseInfo.case_id || caseId,
        case_number: caseInfo.case_number ? String(caseInfo.case_number) : String(caseNumber),
        has_staff_reply: hasStaffReply,
        attachments: ticketAttachments,
        labels: extractedLabels,
        has_presale_label: hasPresaleLabel
      }
    };
  } catch (err: any) {
    console.error('Error verifying Omnidesk ticket:', err);
    return { success: false, status: 403, error: "Access denied to ticket in Omnidesk" };
  }
}

// ─── Ticket Auto-Classification ───────────────────────────────────────────────
// Uses LLM to analyze ticket text and classify into Omnidesk custom fields,
// then pushes the classification to Omnidesk via PUT /api/cases/[id].json.
//
// Target fields (Omnidesk custom fields):
//   cf_10240 - Тип обращения:                       1=Обслуживание, 2=Изменения, 3=Сбой, 4=Запрос, 5=Другой
//   cf_9968  - Категория:                            1=ПО, 2=АО, 3=Сервисы и доступы, 4=Информация и документация,
//                                                    5=Логика автоматизации, 6=Интеграции, 7=Другое, 8=Процессные
//   cf_10048 - Компонент ПО:                         1=Инструмент разработки, 10=Transfer, 9=Приложения, 6=Сервер,
//                                                    2=Прошивки, 7=Драйверы, 8=Протоколы и интерфейсы
//   cf_10049 - Компонент АО:                         1=Сервер (HS/ProAV/UMC), 2=Сценарные выключатели, 3=Панели,
//                                                    4=Рамки, 5=Датчики, 6=Модули, 7=Блоки питания, 8=Пульт управления
//   cf_10069 - Направление автоматизации:            1=Домашняя (Home/Bus77/KNX), 2=Коммерческая (ProAV/i3Pro/ЛК),
//                                                    3=Автоматизация зданий (SCADA/BMS)
//   cf_10704 - Продукт:                              1=SmartPro, 2=SmartLite, 7=Bus Home, 4=KNX Home Server,
//                                                    5=KNX IP Interface, 3=SCADA, 6=Cloud IoT
//   cf_10065 - Продуктовые решения:                  1=Климат, 2=Щиты, 3=Освещение, 4=Шторы, 5=Протечки, 6=ЭУИ,
//                                                    7=Project Tool (UX/UI), 8=Studio Bus77 (UX/UI),
//                                                    9=Bus77 Home (UX/UI), 10=Bus77 Lite (UX/UI), 11=i3KNX (UX/UI),
//                                                    12=Решение любое/Не определено
//   cf_10171 - Первопричина обращения:               1=Техническая проблема (сбой системы, баги), 2=Ошибка пользователя,
//                                                    3=Отсутствие документации, 4=Проблема интеграции, 5=Системные ограничения,
//                                                    6=Отсутствие автоматизации, 7=Сложность процесса, 8=Прочее
//   cf_10239 - Статус объекта автоматизации:         1=Эксплуатация, 2=Сдача, 4=Пусконаладочные работы, 6=Тестирование, 5=Не определен
//   cf_10240 - Тип обращения:                       1=Обслуживание, 2=Изменения, 3=Сбой, 4=Запрос, 5=Другой
//   cf_9968  - Категория:                            1=ПО, 2=АО, 3=Сервисы, 4=Документация, 5=Логика, 6=Интеграции, 7=Другое, 8=Процессные
//   cf_10048 - Компонент ПО (при cf_9968 == 1):      1=Инструмент разработки, 10=Transfer, 9=Приложения, 6=Сервер,
//                                                    2=Прошивки, 7=Драйверы, 8=Протоколы и интерфейсы
//   cf_10049 - Компонент АО (при cf_9968 == 2):      1=Сервер (HS/ProAV/UMC), 2=Сценарные выключатели, 3=Панели,
//                                                    4=Рамки, 5=Датчики, 6=Модули, 7=Блоки питания, 8=Пульт управления
//   cf_10050 - Компонент сервисов (при cf_9968 == 3): 1=Лицензии, 2=Аккаунт/ЛК, 3=Облако, 4=Объект
//   cf_10051 - Компонент документации (при cf_9968 == 4): 3=Документация по продукту, 6=Инструкция по настройке, 7=Контакты, 8=Загрузки
//   cf_10468 - Компонент логики (при cf_9968 == 5):  1=Java-Script, 2=Панельный проект, 3=Серверный проект
//   cf_10469 - Компонент интеграции (при cf_9968 == 6): 1=Голосовые помощники, 2=API, 3=Протоколы, 4=Драйверы
//   cf_10069 - Направление автоматизации:            1=Домашняя (Home/Bus77/KNX), 2=Коммерческая (ProAV/i3Pro/ЛК),
//                                                    3=Автоматизация зданий (SCADA/BMS)
//   cf_10704 - Продукт:                              1=SmartPro, 2=SmartLite, 7=Bus Home, 4=KNX Home Server,
//                                                    5=KNX IP Interface, 3=SCADA, 6=Cloud IoT
//   cf_10065 - Продуктовые решения:                  1=Климат, 2=Щиты, 3=Освещение, 4=Шторы, 5=Протечки, 6=ЭУИ,
//                                                    7=Project Tool (UX/UI), 8=Studio Bus77 (UX/UI),
//                                                    9=Bus77 Home (UX/UI), 10=Bus77 Lite (UX/UI), 11=i3KNX (UX/UI),
//                                                    12=Решение любое/Не определено
//   cf_10171 - Первопричина обращения:               1=Техническая проблема, 2=Ошибка пользователя,
//                                                    3=Отсутствие документации, 4=Проблема интеграции, 5=Системные ограничения,
//                                                    6=Отсутствие автоматизации, 7=Сложность процесса, 8=Прочее
//   cf_10239 - Статус объекта автоматизации:         1=Эксплуатация, 2=Сдача, 4=Пусконаладочные работы, 6=Тестирование, 5=Не определен
//   cf_10272 - Имя объекта автоматизации в облаке:   (текстовое поле - название объекта в Cloud IoT, если указано)
//   cf_10879 - Аппаратная платформа:                 1=UMC C3, 2=HSS, 3=Raspberry Pi / WB, 4=ПК Win, 5=ПК Linux, 6=UMC C2,
//                                                    7=ProAV Adv, 8=WB 8, 9=ProAV Basic, 10=Nuc Win, 11=Nuc Linux
//   cf_11129 - Протокол:                             1=TCP, 2=Serial
//   cf_11135 - Модель панели:                        1=P6, 2=P8, 3=P10, 4=P7, 5=Qbic, 6=HDL
//   cf_11134 - Интерфейс подключения питания:        1=Блок питания, 2=PoE
//   cf_10928 - Модель оборудования:                  (текстовое поле - точная модель стороннего или фирменного оборудования/шлюза)
//   cf_10705 - Серийный номер:                       (текстовое поле - S/N устройства)
//   cf_10878 - HWID сервера:                         (текстовое поле - HWID hex-строка)
//   cf_10709 - Версия сборки сервера:                (текстовое поле - версия сборки сервера)
//   cf_10896 - Версия приложения:                    (текстовое поле - версия ClientApp/Studio IDE)
//   cf_11130 - Интерфейс подключения:                (текстовое поле - KNX, Modbus RTU, BACnet, CAN)
//   cf_10792 - Версия прошивки устройства:           (текстовое поле - версия прошивки физического устройства)

interface ClassificationFieldMeta {
  title: string;
  type?: 'select' | 'text';
  options?: Record<string, string>;
  description?: string;
}

const CLASSIFICATION_FIELDS: Record<string, ClassificationFieldMeta> = {
  // Базовая квалификация
  cf_10240: {
    title: "Тип обращения",
    type: "select",
    options: { "1": "Обслуживание", "2": "Изменения", "3": "Сбой", "4": "Запрос", "5": "Другой" }
  },
  cf_9968: {
    title: "Категория",
    type: "select",
    options: { "1": "Программное обеспечение", "2": "Аппаратное обеспечение", "3": "Сервисы и доступы", "4": "Информация и документация", "5": "Логика автоматизации (настройка логики)", "6": "Интеграции", "7": "Другое", "8": "Процессные (тесты, уведомления)" }
  },
  // Зависящие от категории поля компонентов (заполняется только один компонент, соответствующий выбранной категории):
  cf_10048: {
    title: "Компонент ПО",
    type: "select",
    options: { "1": "Инструмент разработки (Studio IDE/ProjectTools/SCADAStudio)", "10": "Инструмент загрузки проектов (Transfer Tool)", "9": "Приложения (SmartClient/KNXClient/BusHome/SmartLite/SCADA-BMS)", "6": "Сервер (SmartPro/SmartLite/KNX Home/Bus Home/SCADA)", "2": "Прошивки устройств", "7": "Драйверы", "8": "Протоколы и интерфейсы" },
    description: "Компонент ПО. Заполнять ТОЛЬКО если Категория (cf_9968) = 1 (Программное обеспечение). Иначе null."
  },
  cf_10049: {
    title: "Компонент АО",
    type: "select",
    options: { "1": "Сервер (HS/ProAV/UMC)", "2": "Сценарные выключатели", "3": "Панели", "4": "Рамки", "5": "Датчики", "6": "Модули", "7": "Блоки питания", "8": "Пульт управления" },
    description: "Компонент АО. Заполнять ТОЛЬКО если Категория (cf_9968) = 2 (Аппаратное обеспечение). Иначе null."
  },
  cf_10050: {
    title: "Компонент сервисов",
    type: "select",
    options: { "1": "Лицензии", "2": "Аккаунт и личный кабинет", "3": "Облако", "4": "Объект" },
    description: "Компонент сервисов. Заполнять ТОЛЬКО если Категория (cf_9968) = 3 (Сервисы и доступы). Иначе null."
  },
  cf_10051: {
    title: "Компонент документации",
    type: "select",
    options: { "3": "Документация по продукту", "6": "Инструкция по настройке", "7": "Контакты", "8": "Загрузки" },
    description: "Компонент документации. Заполнять ТОЛЬКО если Категория (cf_9968) = 4 (Информация и документация). Иначе null."
  },
  cf_10468: {
    title: "Компонент настройки логики",
    type: "select",
    options: { "1": "Java-Script", "2": "Панельный проект", "3": "Серверный проект" },
    description: "Компонент настройки логики. Заполнять ТОЛЬКО если Категория (cf_9968) = 5 (Логика автоматизации). Иначе null."
  },
  cf_10469: {
    title: "Компонент интеграции",
    type: "select",
    options: { "1": "Голосовые помощники", "2": "API", "3": "Протоколы", "4": "Драйверы" },
    description: "Компонент интеграции. Заполнять ТОЛЬКО если Категория (cf_9968) = 6 (Интеграции). Иначе null."
  },
  // Общие классификационные поля
  cf_10069: {
    title: "Направление автоматизации",
    type: "select",
    options: { "1": "Домашняя автоматизация (Home/Bus/KNX)", "2": "Коммерческая автоматизация (ProAV/SmartPro/ЛК)", "3": "Автоматизация зданий (SCADA/BMS)" },
    description: "Направление автоматизации (1=Домашняя автоматизация, 2=Коммерческая автоматизация, 3=Автоматизация зданий). ВАЖНО: Если продукт SmartPro (cf_10704=1) или в тикете упоминается Pro-версия (SmartPro / ProAV) — это ВСЕГДА 2 (Коммерческая автоматизация), даже если используется KNX или объект жилой. 1=Домашняя автоматизация только для Bus Home, SmartLite, KNX Home Server (без Pro). 3=Автоматизация зданий для SCADA/BMS."
  },
  cf_10704: {
    title: "Продукт",
    type: "select",
    options: { "1": "SmartPro", "2": "SmartLite", "7": "Bus Home", "4": "KNX Home Server", "5": "KNX IP Interface", "3": "SCADA", "6": "Cloud IoT", "0": "Не определен" },
    description: "Продукт платформы (1=SmartPro, 2=SmartLite, 7=Bus Home, 4=KNX Home Server, 5=KNX IP Interface, 3=SCADA, 6=Cloud IoT, 0=Не определен). Если упоминается Pro-версия, SmartPro — продукт ВСЕГДА 1 (SmartPro)."
  },
  cf_10065: {
    title: "Продуктовые решения",
    type: "select",
    options: { "1": "Климат", "2": "Щиты", "3": "Освещение", "4": "Шторы", "5": "Протечки", "6": "ЭУИ", "7": "Project Tool (UX/UI)", "8": "Studio IDE (UX/UI)", "9": "Bus Home (UX/UI)", "10": "SmartLite (UX/UI)", "11": "KNX Client (UX/UI)", "12": "Решение любое/Не определено" },
    description: "Продуктовое решение (Климат, Освещение, Щиты, Шторы, Протечки, ЭУИ, интерфейсы Bus/KNX/Project Tool или 12=Решение любое/Не определено)."
  },
  cf_10171: {
    title: "Первопричина обращения",
    type: "select",
    options: { "1": "Техническая проблема (сбой системы, баги)", "2": "Ошибка пользователя (неверное использование функционала)", "3": "Отсутствие документации или инструкций", "4": "Проблема интеграции с внешними системами", "5": "Системные ограничения", "6": "Отсутствие автоматизации", "7": "Сложность процесса", "8": "Прочее" },
    description: "Первопричина возникновения проблемы или вопроса."
  },
  cf_10239: {
    title: "Статус объекта автоматизации",
    type: "select",
    options: { "1": "Эксплуатация", "2": "Сдача", "4": "Пусконаладочные работы", "6": "Тестирование", "5": "Не определен" },
    description: "Статус/стадия объекта автоматизации (заполнять ТОЛЬКО при наличии явных данных в тикете, иначе null)."
  },
  cf_10272: {
    title: "Имя объекта автоматизации в облаке",
    type: "text",
    description: "Название объекта автоматизации в облачной платформе Cloud IoT (заполнять ТОЛЬКО при явном наличии данных в обращении, иначе null)."
  },
  // Условные поля оборудования, аппаратных платформ, протоколов и моделей:
  cf_10879: {
    title: "Аппаратная платформа",
    type: "select",
    options: {
      "1": "UMC C3",
      "2": "Server Hub (Pro Server)",
      "3": "Raspberry Pi; WB 6, 7;",
      "4": "ПК с Win",
      "5": "ПК с Linux",
      "6": "Compact Controller",
      "7": "ProAV Processor Advanced",
      "8": "Edge Controller v8",
      "9": "ProAV Processor Basic",
      "10": "Nuc Win",
      "11": "Nuc Linux"
    },
    description: "Аппаратная платформа сервера. Заполнять, если в тикете упоминается платформа: Raspberry Pi/RPi (3), WB (3), UMC C3 (1), Compact Controller (6), Server Hub (2), ПК на Windows (4), ПК на Linux (5), Intel NUC (10 или 11). Иначе null."
  },
  cf_11129: {
    title: "Протокол",
    type: "select",
    options: { "1": "TCP", "2": "Serial" },
    description: "Сетевой протокол подключения (1=TCP, 2=Serial). Заполнять, если в обращении указан способ связи с оборудованием или драйвером (например 'подключение по TCP' -> 1, 'подключение по Serial/RS485/COM' -> 2). Иначе null."
  },
  cf_11135: {
    title: "Модель панели",
    type: "select",
    options: { "1": "P6", "2": "P8", "3": "P10", "4": "P7", "5": "Qbic", "6": "HDL" },
    description: "Модель сенсорной панели (P6, P8, P10, P7, Qbic, HDL). Заполнять ТОЛЬКО если речь идет о сенсорной панели и указана её модель. Иначе null."
  },
  cf_11134: {
    title: "Интерфейс подключения питания",
    type: "select",
    options: { "1": "Блок питания", "2": "PoE" },
    description: "Интерфейс подключения питания устройства или панели (1=Блок питания, 2=PoE). Заполнять ТОЛЬКО при наличии данных, иначе null."
  },
  cf_10928: {
    title: "Модель оборудования",
    type: "text",
    description: "Точная модель физического оборудования, модуля, датчика или шлюза стороннего либо фирменного производителя (например 'Zenio KIPI SC', 'I-CAN-MODBAS', 'FM-402-1W', 'DM-060'), если прямо названа в тикете. Иначе null."
  },
  cf_10705: {
    title: "Серийный номер",
    type: "text",
    description: "Серийный номер оборудования (S/N), если прямо указан клиентом (например 'P80002954', '28417'). Иначе null."
  },
  cf_10878: {
    title: "HWID сервера",
    type: "text",
    description: "HWID сервера (32-значный hex-хеш оборудования, если указан клиентом). Иначе null."
  },
  cf_10709: {
    title: "Версия сборки сервера",
    type: "text",
    description: "Номер версии или сборки сервера (например '1.3.85.42497'), если прямо указан. Иначе null."
  },
  cf_10896: {
    title: "Версия приложения",
    type: "text",
    description: "Версия клиентского приложения или Studio IDE (например '2.081.42742', '1.3.88'), если указана. Иначе null."
  },
  cf_11130: {
    title: "Интерфейс подключения",
    type: "text",
    description: "Интерфейс или шина подключения (например 'KNX', 'Modbus RTU', 'BACnet', 'CAN'), если указан в обращении. Иначе null."
  },
  cf_10792: {
    title: "Версия прошивки устройства",
    type: "text",
    description: "Версия прошивки физического устройства, если прямо указана клиентом. Иначе null."
  }
};

// Поля, которые категорически исключены из классификации:
// группа (group, group_id), статус обращения (status, status_id, cf_5317, cf_10459),
// статус клиента (cf_5286), сумма покупок (cf_5285, cf_5287), тип (cf_5288),
// компания (cf_5289), оценка ToV (cf_11185, cf_11193), ссылка на аудит (cf_11462).
// Поле "Продукт" (cf_10704) обязательно заполняется.
export const EXCLUDED_CLASSIFICATION_FIELDS = new Set([
  'cf_5285', // Сумма покупок
  'cf_5286', // Статус клиента
  'cf_5287', // Сумма покупок в статусе
  'cf_5288', // Тип
  'cf_5289', // Компания
  'cf_5317', // Статус обращения
  'cf_10459', // Статус обращения
  'cf_11185', // Оценка tov [omni]
  'cf_11193', // Оценка tov [custom]
  'cf_11462', // Ссылка на аудит
  'group',
  'group_id',
  'status',
  'status_id',
]);

// Single Server-Side Allowlist Validation for Omnidesk Custom Fields
export function validateClassificationFields(
  rawFields: Record<string, any>
): { valid: boolean; fields: Record<string, string>; errors: string[] } {
  const fields: Record<string, string> = {};
  const errors: string[] = [];

  if (!rawFields || typeof rawFields !== 'object') {
    return { valid: false, fields, errors: ['Invalid fields object'] };
  }

  for (const [key, rawVal] of Object.entries(rawFields)) {
    if (EXCLUDED_CLASSIFICATION_FIELDS.has(key)) {
      errors.push(`Field ${key} is strictly excluded from classification`);
      continue;
    }

    const meta = CLASSIFICATION_FIELDS[key as keyof typeof CLASSIFICATION_FIELDS];
    if (!meta) {
      errors.push(`Field ${key} is not an allowed classification field`);
      continue;
    }

    if (rawVal === null || rawVal === undefined || rawVal === '') {
      continue;
    }

    const strVal = String(rawVal).trim();
    if (!strVal || strVal.toLowerCase() === 'null' || strVal.toLowerCase() === 'undefined') {
      continue;
    }

    if (meta.type === 'text' || !meta.options) {
      // Sanitize string value: single-line, max length 200 chars
      const sanitizedText = strVal.replace(/[\r\n\t]+/g, ' ').slice(0, 200).trim();
      if (sanitizedText) {
        fields[key] = sanitizedText;
      }
    } else {
      // Select option: STRICT validation against meta.options
      // 1. Direct option key match (e.g. "1", "2", "0")
      if (Object.prototype.hasOwnProperty.call(meta.options, strVal)) {
        fields[key] = strVal;
      } else {
        // 2. Exact or normalized match by option label text
        const lowerVal = strVal.toLowerCase();
        const matchedEntry = Object.entries(meta.options).find(
          ([, label]) => {
            const l = label.toLowerCase();
            return l === lowerVal || l.startsWith(lowerVal) || lowerVal.startsWith(l);
          }
        );
        if (matchedEntry) {
          fields[key] = matchedEntry[0];
        } else {
          // Strictly reject invalid option! NO regex /^\d+$/ fallback!
          errors.push(`Value "${strVal}" is not a valid option for ${meta.title} (${key})`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    fields,
    errors
  };
}

/**
 * Корпоративные бизнес-правила классификации:
 * Если продукт SmartPro (cf_10704 = 1) или в тикете/сообщениях/контексте вообще упоминается "SmartPro / Pro-версия" —
 * направление автоматизации (cf_10069) ВСЕГДА и БЕЗУСЛОВНО является "2" (Коммерческая автоматизация (ProAV/SmartPro/ЛК)),
 * даже если упоминается KNX, квартира или умный дом.
 * Если упоминается SmartPro / Pro-версия, а продукт не был задан или был "0" (Не определен) — продукт (cf_10704) выставляется в "1" (SmartPro).
 */
function applyClassificationBusinessRules(
  fields: Record<string, string>,
  ticketContext?: { subject?: string; description?: string; messages?: string[]; reasoning?: string }
): Record<string, string> {
  const allTexts: string[] = [];
  if (ticketContext) {
    if (ticketContext.subject) allTexts.push(ticketContext.subject);
    if (ticketContext.description) allTexts.push(ticketContext.description);
    if (ticketContext.messages && Array.isArray(ticketContext.messages)) {
      allTexts.push(...ticketContext.messages);
    }
    if (ticketContext.reasoning) allTexts.push(ticketContext.reasoning);
  }
  if (fields.cf_10928) allTexts.push(fields.cf_10928);
  if (fields.cf_10896) allTexts.push(fields.cf_10896);

  const fullText = allTexts.join(' ');
  const SMART_PRO_REGEX = /(?:\b(?:smart|pro|cloud|i3)[\s\-_.]*(?:pro|про)\b|\bpro[\s\-_.]*av\b|\bsmartpro\b)/i;
  const mentionsSmartPro = SMART_PRO_REGEX.test(fullText);

  // Если упоминается SmartPro / Pro, а продукт не был указан или был 0, ставим SmartPro (1)
  if (mentionsSmartPro && (!fields.cf_10704 || fields.cf_10704 === '0')) {
    fields.cf_10704 = '1';
  }

  // Бизнес-правило: если продукт SmartPro (cf_10704 = 1) или вообще упоминается SmartPro —
  // направление автоматизации (cf_10069) ВСЕГДА "2" (Коммерческая автоматизация (ProAV/SmartPro/ЛК))
  if (fields.cf_10704 === '1' || mentionsSmartPro) {
    fields.cf_10069 = '2';
  }

  return fields;
}

const classifiedTickets = new Set<string>();

async function classifyTicket(
  caseId: string,
  subject: string,
  description: string,
  messages: string[]
): Promise<{ fields: Record<string, string>; reasoning: string } | null> {
  try {
    const pool = getApiKeysPool();
    if (pool.length === 0) {
      console.error('[Classify] No API key available');
      return null;
    }

    const fieldDescriptions = Object.entries(CLASSIFICATION_FIELDS)
      .filter(([fieldId]) => !EXCLUDED_CLASSIFICATION_FIELDS.has(fieldId))
      .map(([fieldId, meta]) => {
        if (meta.type === 'text' || !meta.options) {
          return `### ${meta.title} (${fieldId})\n  Тип: текстовая строка (укажи точное название строкой или null, если не указано в тикете)\n  Описание: ${meta.description || meta.title}`;
        }
        const opts = Object.entries(meta.options)
          .map(([k, v]) => `  ${k} = ${v}`)
          .join('\n');
        const desc = meta.description ? `  Описание: ${meta.description}\n` : '';
        return `### ${meta.title} (${fieldId})\n${desc}${opts}`;
      })
      .join('\n\n');

    const classifyPrompt = `Ты — классификатор тикетов технической поддержки.
Проанализируй текст обращения и определи значения для каждого из следующих полей.

ИЕРАРХИЯ И ПРАВИЛА ЗАПОЛНЕНИЯ:
1. Категория (cf_9968) и зависящие от неё поля компонентов (заполняй СТРОГО один соответствующий компонент, остальные компоненты ДОЛЖНЫ быть null):
   - Если cf_9968 = "1" (ПО) -> заполни cf_10048 ("Компонент ПО"). Поля cf_10049, cf_10050, cf_10051, cf_10468, cf_10469 верни null.
   - Если cf_9968 = "2" (АО) -> заполни cf_10049 ("Компонент АО"). Поля cf_10048, cf_10050, cf_10051, cf_10468, cf_10469 верни null.
   - Если cf_9968 = "3" (Сервисы и доступы) -> заполни cf_10050 ("Компонент сервисов": 1=Лицензии, 2=Аккаунт/ЛК, 3=Облако, 4=Объект). Поля cf_10048, cf_10049, cf_10051, cf_10468, cf_10469 верни null.
   - Если cf_9968 = "4" (Информация и документация) -> заполни cf_10051 ("Компонент документации": 3=Документация, 6=Инструкция, 7=Контакты, 8=Загрузки). Остальные компоненты верни null.
   - Если cf_9968 = "5" (Логика автоматизации) -> заполни cf_10468 ("Компонент настройки логики": 1=JS, 2=Панельный проект, 3=Серверный проект). Остальные компоненты верни null.
   - Если cf_9968 = "6" (Интеграции) -> заполни cf_10469 ("Компонент интеграции": 1=Голосовые помощники, 2=API, 3=Протоколы, 4=Драйверы). Остальные компоненты верни null.
   - Если категория или компонент не могут быть точно определены по контексту — верни null. Не делай необоснованных предположений.

2. Условные поля окружения, оборудования и протоколов (заполнять ТОЛЬКО при наличии явных данных в тикете, иначе null):
   - "cf_10879" (Аппаратная платформа): если упомянута серверная/аппаратная платформа (Raspberry Pi/RPi -> 3, Edge Controller -> 3 или 8, Controller Pro -> 1, Compact Controller -> 6, Server Hub -> 2, ПК с Win -> 4, ПК с Linux -> 5, Nuc Win -> 10, Nuc Linux -> 11). Пример из кейса 810-499430: "Server Hub, установленый на RPi" -> 3. Если платформа не указана — верни null.
   - "cf_11129" (Протокол): сетевой протокол взаимодействия с оборудованием (1=TCP, 2=Serial). Пример из кейса 810-499430: "Подключение по TCP" -> 1. Если не указан — верни null.
   - "cf_11135" (Модель панели): модель сенсорной панели (1=P6, 2=P8, 3=P10, 4=P7, 5=Qbic, 6=HDL). Заполнять только при явном указании модели панели, иначе null.
   - "cf_11134" (Интерфейс подключения питания): 1=Блок питания, 2=PoE. Если не указан — null.
   - "cf_10928" (Модель оборудования): строка с названием конкретной модели оборудования, модуля, датчика или стороннего шлюза. Пример из кейса 810-499430: "шлюз в KNX - Zenio KIPI SC" -> "Zenio KIPI SC". Если модель не названа — null.
   - "cf_10705" (Серийный номер): строка серийного номера (S/N), если прямо указан. Иначе null.
   - "cf_10878" (HWID сервера): hex-идентификатор HWID сервера, если прямо указан. Иначе null.
   - "cf_10709" (Версия сборки сервера): версия сборки сервера (например "1.3.85.42497"), если прямо указана. Иначе null.
   - "cf_10896" (Версия приложения): версия приложения или Studio IDE (например "2.081.42742"), если прямо указана. Иначе null.
   - "cf_11130" (Интерфейс подключения): интерфейс шины или сети (например "KNX", "Modbus RTU", "BACnet"), если прямо указан. Иначе null.
   - "cf_10792" (Версия прошивки устройства): версия прошивки физического устройства, если прямо указана. Иначе null.

3. Общие поля квалификации:
   - "cf_10704" (Продукт): определи продукт из списка (1=SmartPro, 2=SmartLite, 7=Bus Home, 4=KNX Home Server, 5=KNX IP Interface, 3=SCADA, 6=Cloud IoT) или "0" ("Не определен") / null, если продукт из контекста неясен или неизвестен. Если в обращении упоминается "SmartPro", "ProAV" — продукт ВСЕГДА 1 ("SmartPro"). ЗАПРЕЩЕНО выдумывать или угадывать продукт, если о нем нет прямых свидетельств.
   - "cf_10069" (Направление автоматизации):
     * "2" = Коммерческая автоматизация (ProAV/SmartPro/ЛК): СТРОГО выбирай "2", если продукт SmartPro (cf_10704 = 1) ИЛИ если в тикете вообще упоминается "SmartPro", "ProAV"! Это строгое правило: даже если в обращении упоминается KNX, квартира или умный дом — при использовании или упоминании Pro / SmartPro направлением ВСЕГДА является Коммерческая автоматизация ("2")!
     * "1" = Домашняя автоматизация (Home/Bus/KNX): выбирай ТОЛЬКО для домашних решений без Pro (Bus Home, SmartLite, KNX Home Server).
     * "3" = Автоматизация зданий (SCADA/BMS): выбирай для проектов на базе SCADA и диспетчеризации зданий (BMS).
   - "cf_10239" (Статус объекта автоматизации): 1=Эксплуатация, 2=Сдача, 4=Пусконаладочные работы, 6=Тестирование. Заполнять ТОЛЬКО при наличии явных данных в тикете о стадии или статусе объекта. Если данных нет — верни null.
   - "cf_10065" (Продуктовые решения): выбери подходящее продуктовое решение (Климат, Освещение, Щиты, Шторы, Протечки, ЭУИ, интерфейс) или 12 ("Решение любое/Не определено").
   - "cf_10171" (Первопричина обращения): выбери первопричину сбоя или вопроса (1=Техническая проблема, 2=Ошибка пользователя, 3=Отсутствие документации, 4=Проблема интеграции, 5=Системные ограничения, 6=Отсутствие автоматизации, 7=Сложность процесса, 8=Прочее).
   - "cf_10272" (Имя объекта автоматизации в облаке): верни строку с точным названием объекта в облаке Cloud IoT, если оно прямо названо в тексте/теме тикета. Если не названо — верни null.

4. СТРОГО НЕ ЗАПОЛНЯТЬ И НЕ ИЗМЕНЯТЬ (ИСКЛЮЧЕННЫЕ ПОЛЯ):
   - Поля "Группа" (group, group_id), "Статус обращения" (status, status_id, cf_5317, cf_10459), "Статус" (cf_5286), "Сумма покупок", "Тип", "Компания", "Оценка ToV", "Ссылка на аудит" — КАТЕГОРИЧЕСКИ НЕ заполняются и НЕ изменяются!

- Для полей со списком вариантов верни ТОЛЬКО числовой ключ (ID) из списка вариантов.
- Если любое поле не применимо, не подтверждено фактами или данные отсутствуют — верни null для этого поля.

${fieldDescriptions}

---

ТИКЕТ:
Тема: ${subject}
Описание: ${description}
${messages.length > 0 ? `\nСообщения:\n${messages.slice(0, 5).join('\n---\n')}` : ''}

---

Ответь СТРОГО в формате JSON без комментариев:
{
  "cf_10240": <число или null>,
  "cf_9968": <число или null>,
  "cf_10048": <число или null>,
  "cf_10049": <число или null>,
  "cf_10050": <число или null>,
  "cf_10051": <число или null>,
  "cf_10468": <число или null>,
  "cf_10469": <число или null>,
  "cf_10069": <число или null>,
  "cf_10704": <число или null>,
  "cf_10065": <число или null>,
  "cf_10171": <число или null>,
  "cf_10239": <число или null>,
  "cf_10272": <строка или null>,
  "cf_10879": <число или null>,
  "cf_11129": <число или null>,
  "cf_11135": <число или null>,
  "cf_11134": <число или null>,
  "cf_10928": <строка или null>,
  "cf_10705": <строка или null>,
  "cf_10878": <строка или null>,
  "cf_10709": <строка или null>,
  "cf_10896": <строка или null>,
  "cf_11130": <строка или null>,
  "cf_10792": <строка или null>,
  "reasoning": "<краткое обоснование на русском, 1-2 предложения>"
}`;

    let isCustom = false;
    let customModelConfig: any = null;
    if (settings.custom_models && settings.custom_models.startsWith('[')) {
      try {
        const parsed = JSON.parse(settings.custom_models);
        customModelConfig = parsed.find((m: any) => m.model_id === settings.model_name);
        if (customModelConfig) isCustom = true;
      } catch (e) {}
    }

    let responseText = '';
    let success = false;
    const startIndex = lastUsedKeyIndex % pool.length;
    lastUsedKeyIndex = (startIndex + 1) % pool.length;

    for (let i = 0; i < pool.length; i++) {
      const currentIdx = (startIndex + i) % pool.length;
      const activeKey = pool[currentIdx];
      const masked = maskApiKey(activeKey);

      try {
        if (isCustom && customModelConfig) {
          const endpoint = customModelConfig.base_url.replace(/\/$/, '') + '/chat/completions';
          const resOpenAI = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${activeKey}`
            },
            body: JSON.stringify({
              model: customModelConfig.model_id,
              messages: [{ role: 'user', content: classifyPrompt }],
              response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(30000)
          });

          if (!resOpenAI.ok) {
            const errBody = await resOpenAI.text();
            throw new Error(`OpenAI-compatible API Error: ${resOpenAI.status} - ${errBody}`);
          }

          const dataOpenAI = await resOpenAI.json();
          responseText = dataOpenAI.choices?.[0]?.message?.content || '';
          success = true;
        } else {
          const activeAi = new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });

          let response;
          try {
            const baseClassifyConfig = {
              temperature: 0.1,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json'
            };
            response = await activeAi.models.generateContent({
              model: settings.model_name || 'gemini-3.8-flash',
              contents: classifyPrompt,
              config: getModelGenerationConfig(settings.model_name || 'gemini-3.8-flash', baseClassifyConfig)
            });
          } catch (apiError: any) {
            if (isRateLimitError(apiError)) {
              const fallbacks = getFallbackModels(settings.model_name || 'gemini-3.8-flash');
              for (const fbModel of fallbacks) {
                try {
                  console.log(`[Classify] Quota/demand fallback to ${fbModel}...`);
                  response = await activeAi.models.generateContent({
                    model: fbModel,
                    contents: classifyPrompt,
                    config: getModelGenerationConfig(fbModel, {
                      temperature: 0.1,
                      maxOutputTokens: 1024,
                      responseMimeType: 'application/json'
                    })
                  });
                  if (response) break;
                } catch (fbErr: any) {
                  console.warn(`[Classify] Fallback model ${fbModel} failed:`, fbErr.message);
                }
              }
            }
            if (!response) throw apiError;
          }

          responseText = (response as any).text
            ?? (response as any).candidates?.[0]?.content?.parts?.[0]?.text
            ?? '';
          success = true;
        }

        if (success) {
          console.log(`[Classify] LLM call succeeded with key index ${currentIdx} (${masked})`);
          break;
        }
      } catch (keyErr: any) {
        console.error(`[Classify] Error with key index ${currentIdx} (${masked}):`, keyErr.message || keyErr);
      }
    }

    if (!success || !responseText) {
      console.error('[Classify] Failed to get response from any LLM key');
      return null;
    }

    const cleanJson = responseText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
    let parsed: any = null;
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch {}
    }
    if (!parsed) {
      try { parsed = JSON.parse(cleanJson); } catch {}
    }

    let fields: Record<string, string> = {};
    if (parsed && typeof parsed === 'object') {
      const validated = validateClassificationFields(parsed);
      fields = validated.fields;
    } else {
      // Resilient regex fallback if JSON was slightly truncated or had syntax issues
      const candidateFields: Record<string, any> = {};
      for (const [fieldId, meta] of Object.entries(CLASSIFICATION_FIELDS)) {
        if (EXCLUDED_CLASSIFICATION_FIELDS.has(fieldId)) continue;
        if (meta.type === 'text' || !meta.options) {
          const m = cleanJson.match(new RegExp(`"${fieldId}"\\s*:\\s*"([^"]+)"`));
          if (m && m[1]) candidateFields[fieldId] = m[1];
        } else {
          const m = cleanJson.match(new RegExp(`"${fieldId}"\\s*:\\s*(?:"([^"]+)"|(\\d+))`));
          const rawVal = m?.[1] || m?.[2];
          if (rawVal) candidateFields[fieldId] = rawVal;
        }
      }
      const validated = validateClassificationFields(candidateFields);
      fields = validated.fields;
    }

    const reasoning = parsed?.reasoning || (cleanJson.match(/"reasoning"\s*:\s*"([^"]+)"/)?.[1] || '');

    fields = applyClassificationBusinessRules(fields, {
      subject,
      description,
      messages,
      reasoning
    });

    if (Object.keys(fields).length === 0) {
      console.error('[Classify] No valid fields found in LLM response:', responseText);
      return null;
    }

    return {
      fields,
      reasoning
    };
  } catch (err) {
    console.error('[Classify] LLM classification error:', err);
    return null;
  }
}

async function pushClassificationToOmnidesk(
  caseNumber: string,
  fields: Record<string, string>,
  staffEmail?: string
): Promise<{ success: boolean; error?: string }> {
  if (!settings.omnidesk_domain || !settings.omnidesk_api_key || !settings.omnidesk_email) {
    return { success: false, error: 'Omnidesk credentials not configured' };
  }

  // Strict server-side allowlist validation before pushing!
  const validation = validateClassificationFields(fields);
  if (Object.keys(validation.fields).length === 0) {
    return { success: false, error: 'No valid classification fields to push' };
  }
  const cleanFields = validation.fields;

  try {
    const effectiveEmail = (staffEmail && staffEmail.trim()) ? staffEmail.trim() : settings.omnidesk_email;
    const domain = settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${effectiveEmail}:${settings.omnidesk_api_key}`).toString('base64');

    let resolvedId = await resolveCaseId(caseNumber, effectiveEmail);
    if (!resolvedId) {
      resolvedId = caseNumber.replace(/\D/g, '');
    }
    if (!resolvedId) {
      if (caseNumber === 'OMNIDESK_ACTIVE_TICKET') {
        console.log('[Classify] Mock ticket OMNIDESK_ACTIVE_TICKET - simulated push');
        return { success: true };
      }
      return { success: false, error: `Cannot resolve case number: ${caseNumber}` };
    }

    const customFields: Record<string, string> = {};
    for (const [fieldId, value] of Object.entries(cleanFields)) {
      if (EXCLUDED_CLASSIFICATION_FIELDS.has(fieldId)) continue;
      if (fieldId === 'group' || fieldId === 'group_id' || fieldId === 'status' || fieldId === 'status_id') continue;
      customFields[fieldId] = value;
    }

    // Если продукт SmartPro (1) — направление автоматизации строго Коммерческая автоматизация (2)
    if (customFields.cf_10704 === '1') {
      customFields.cf_10069 = '2';
    }

    const body: Record<string, any> = {
      case: {
        custom_fields: customFields
      }
    };
    // Ensure standard group and status fields can never be touched or modified in Omnidesk
    delete (body.case as any).group_id;
    delete (body.case as any).group;
    delete (body.case as any).status;
    delete (body.case as any).status_id;

    console.log(`[Classify] Pushing classification to Omnidesk case ${resolvedId}:`, JSON.stringify(customFields));

    const omniRes = await fetch(`https://${domain}/api/cases/${resolvedId}.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });

    if (!omniRes.ok) {
      const errText = await omniRes.text();
      console.error(`[Classify] Omnidesk PUT failed (${omniRes.status}):`, errText);
      return { success: false, error: `Omnidesk API ${omniRes.status}: ${errText}` };
    }

    console.log(`[Classify] Successfully classified case ${resolvedId}`);
    return { success: true };
  } catch (err: any) {
    console.error('[Classify] Push to Omnidesk error:', err);
    return { success: false, error: err.message };
  }
}

async function autoClassifyTicket(
  caseId: string,
  subject: string,
  description: string,
  messages: string[] = [],
  staffEmail?: string
): Promise<void> {
  if (classifiedTickets.has(caseId)) {
    return;
  }
  classifiedTickets.add(caseId);

  const result = await classifyTicket(caseId, subject, description, messages);
  if (!result || Object.keys(result.fields).length === 0) {
    classifiedTickets.delete(caseId);
    return;
  }

  const pushResult = await pushClassificationToOmnidesk(caseId, result.fields, staffEmail);
  if (!pushResult.success) {
    console.error(`[Classify] Failed to push classification for case ${caseId}:`, pushResult.error);
    classifiedTickets.delete(caseId);
  } else {
    const fieldSummary = Object.entries(result.fields)
      .map(([k, v]) => {
        const meta = CLASSIFICATION_FIELDS[k as keyof typeof CLASSIFICATION_FIELDS];
        const valLabel = meta?.options ? (meta.options[v] || v) : v;
        return `${meta?.title || k}: ${valLabel}`;
      })
      .join(', ');
    console.log(`[Classify] Case ${caseId} classified: ${fieldSummary} | ${result.reasoning}`);
    logAnalytics('api_call', {
      endpoint: '/classify',
      caseId,
      classification: result.fields,
      reasoning: result.reasoning
    });
  }
}

function sanitizeCustomerDraft(text: string): string {
  if (!text) return '';
  
  let sanitized = text;

  // 1. Strip :::writing{...} directives and ::: block wrappers
  sanitized = sanitized
    .replace(/:::writing\{[^}]*\}[\r\n]*/gi, '')
    .replace(/:::[\w-]*[\r\n]*/gi, '')
    .replace(/[\r\n]*:::$/g, '')
    .replace(/[\r\n]*:::/g, '');

  // 2. Strip code fences (e.g. ```text ... ``` or ``` ... ```) if wrapped around response
  sanitized = sanitized
    .replace(/^```(?:text|markdown|html)?\s*[\r\n]/i, '')
    .replace(/[\r\n]\s*```\s*$/i, '');

  // 3. Strip internal headers and operator notes if leaked into customer draft
  sanitized = sanitized
    .replace(/###\s*(?:Комментарий для сотрудника|Внутренний комментарий|Анализ|Аудит)[^\n]*\n[\s\S]*?(?=(?:Здравствуйте|Добрый день|Приветствую|Уважаем|\n\n[А-ЯA-Z]))/i, '')
    .replace(/###\s*(?:Ответ клиенту|Готовый ответ|Сообщение клиенту|Draft Response)[^\n]*\n/gi, '')
    .replace(/\*\*(?:To|Re|Channel|Tone):\*\*[^\n]*\n/gi, '')
    .replace(/###\s*Notes for You[^\n]*\n[\s\S]*$/gi, '');

  // 4. Markdown links pointing to BookStack: [Link Text](http.../books/...) -> Link Text
  sanitized = sanitized.replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]*(?:bookstack|mytunnel\.org|\/books\/|\/shelves\/|\/pages\/)[^\s)]*\)/gi, '$1');
  
  // 5. Bare BookStack URLs: http://bookstack.mytunnel.org/... -> remove completely
  sanitized = sanitized.replace(/https?:\/\/[^\s)]*(?:bookstack|mytunnel\.org)[^\s)\]]*/gi, '');
  
  // If settings.bookstack_url is configured, strip it too
  if (settings.bookstack_url) {
    try {
      const bsHost = new URL(settings.bookstack_url).host;
      if (bsHost) {
        const escapedHost = bsHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(new RegExp(`\\[([^\\]]+)\\]\\(https?:\\/\\/[^\\s)]*${escapedHost}[^\\s)]*\\)`, 'gi'), '$1');
        sanitized = sanitized.replace(new RegExp(`https?:\\/\\/[^\\s)]*${escapedHost}[^\\s)\\]]*`, 'gi'), '');
      }
    } catch {}
  }
  
  // 6. Apply deterministic stop-word and banned phrase filters (support-stop-words / стоп-слова)
  sanitized = applyStopWordFilters(sanitized);

  sanitized = sanitized
    .replace(/\s*\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
    
  return sanitized;
}

export function applyStopWordFilters(text: string): string {
  if (!text) return '';

  // Preserve inline code and code blocks so technical identifiers, logs or snippets are untouched
  const codeBlocks: string[] = [];
  let filtered = text.replace(/(`{1,3})[\s\S]*?\1/gu, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // 1. Rule 8: "К сожалению" (в начале фразы, строки или предложения)
  // "К сожалению, это баг" -> "Благодарим за информацию! Передадим команде на исправление."
  filtered = filtered.replace(/(^|[\r\n]+|[.!?]\s+)К\s+сожалению,\s*это\s+баг[.!?,]?\s*/giu, '$1Благодарим за информацию! Передадим команде на исправление. ');
  filtered = filtered.replace(/(^|[\r\n]+|[.!?]\s+)К\s+сожалению,\s*/giu, '$1Благодарим за обращение! ');

  // 2. Rule 3: "Вы должны" / "Вам надо" / "Вам нужно" / "Вы обязаны"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Вы\s+должны\s+перезагрузить\s+сервер(?![\p{L}\p{N}_])/giu, 'Предлагаем выполнить перезагрузку сервера')
    .replace(/(?<![\p{L}\p{N}_])Вы\s+должны(?![\p{L}\p{N}_])/gu, 'Рекомендуем')
    .replace(/(?<![\p{L}\p{N}_])вы\s+должны(?![\p{L}\p{N}_])/gu, 'рекомендуем')
    .replace(/(?<![\p{L}\p{N}_])Вам\s+надо(?![\p{L}\p{N}_])/gu, 'Предлагаем')
    .replace(/(?<![\p{L}\p{N}_])вам\s+надо(?![\p{L}\p{N}_])/gu, 'предлагаем')
    .replace(/(?<![\p{L}\p{N}_])Вам\s+нужно(?![\p{L}\p{N}_])/gu, 'Предлагаем')
    .replace(/(?<![\p{L}\p{N}_])вам\s+нужно(?![\p{L}\p{N}_])/gu, 'предлагаем')
    .replace(/(?<![\p{L}\p{N}_])Вы\s+обязаны(?![\p{L}\p{N}_])/gu, 'Рекомендуем')
    .replace(/(?<![\p{L}\p{N}_])вы\s+обязаны(?![\p{L}\p{N}_])/gu, 'рекомендуем');

  // 3. Rule 11: "Как я уже говорил" / "Я же писал выше" / "Я уже писал вам" / "Я уже писал"
  filtered = filtered.replace(/(?<![\p{L}\p{N}_])Я\s+уже\s+писал\s+вам,\s*нажмите\b/giu, 'Продублирую: для продолжения нажмите, пожалуйста,');
  filtered = filtered.replace(/(?<![\p{L}\p{N}_])(?:Как\s+я\s+уже\s+говорил|Я\s+же\s+писал\s+выше|Я\s+уже\s+писал(?:\s+вам)?(?:\s+об\s+этом)?)[,:]?\s*/giu, 'Продублирую: ');

  // 4. Rule 10: "Читайте инструкцию" / "Это написано в справке" / "Посмотрите в инструкции"
  filtered = filtered.replace(/(?<![\p{L}\p{N}_])(?:Читайте\s+инструкцию|Посмотрите\s+в\s+инструкции)[,.]?\s*/giu, 'Делюсь ссылкой на пошаговую инструкцию и готов помочь с каждым шагом: ');
  filtered = filtered.replace(/(?<![\p{L}\p{N}_])Это\s+написано\s+в\s+справке[,.]?\s*/giu, 'Делюсь ссылкой на справочный материал и готов помочь с каждым шагом: ');

  // 5. Rule 9: "Вы меня не поняли" / "Вы не правы"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Вы\s+меня\s+не\s+поняли(?![\p{L}\p{N}_])/gu, 'Позвольте пояснить подробнее')
    .replace(/(?<![\p{L}\p{N}_])вы\s+меня\s+не\s+поняли(?![\p{L}\p{N}_])/gu, 'позвольте пояснить подробнее')
    .replace(/(?<![\p{L}\p{N}_])Вы\s+не\s+правы(?![\p{L}\p{N}_])/gu, 'Давайте уточним детали')
    .replace(/(?<![\p{L}\p{N}_])вы\s+не\s+правы(?![\p{L}\p{N}_])/gu, 'давайте уточним детали');

  // 6. Rule 12: "Это не наша зона ответственности" / "Мы этим не занимаемся" / "Это не в нашей компетенции"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])(?:Это\s+не\s+наша\s+зона\s+ответственности|Это\s+не\s+в\s+нашей\s+компетенции|Мы\s+этим\s+не\s+занимаемся)(?![\p{L}\p{N}_])/giu, 'Сориентирую, какие шаги можно предпринять дальше');

  // 7. Rule 7: Жаргон/сленг: "крашится" -> "завершает работу", "глючит" -> "работает некорректно"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Сервер\s+крашится(?![\p{L}\p{N}_])/giu, 'На сервере происходит незапланированное завершение работы')
    .replace(/(?<![\p{L}\p{N}_])Крашится(?![\p{L}\p{N}_])/gu, 'Завершает работу')
    .replace(/(?<![\p{L}\p{N}_])крашится(?![\p{L}\p{N}_])/gu, 'завершает работу')
    .replace(/(?<![\p{L}\p{N}_])Крашатся(?![\p{L}\p{N}_])/gu, 'Завершают работу')
    .replace(/(?<![\p{L}\p{N}_])крашатся(?![\p{L}\p{N}_])/gu, 'завершают работу')
    .replace(/(?<![\p{L}\p{N}_])Глючит(?![\p{L}\p{N}_])/gu, 'Работает некорректно')
    .replace(/(?<![\p{L}\p{N}_])глючит(?![\p{L}\p{N}_])/gu, 'работает некорректно')
    .replace(/(?<![\p{L}\p{N}_])Глючат(?![\p{L}\p{N}_])/gu, 'Работают некорректно')
    .replace(/(?<![\p{L}\p{N}_])глючат(?![\p{L}\p{N}_])/gu, 'работают некорректно');

  // 8. Rule 4: "Не знаю" / "Не могу помочь"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Не\s+знаю,\s*как\s+это\s+исправить(?![\p{L}\p{N}_])/giu, 'Согласую с разработчиками и вернусь с решением')
    .replace(/(?<![\p{L}\p{N}_])Не\s+знаю(?![\p{L}\p{N}_])/gu, 'Уточню у команды')
    .replace(/(?<![\p{L}\p{N}_])не\s+знаю(?![\p{L}\p{N}_])/gu, 'уточню у команды')
    .replace(/(?<![\p{L}\p{N}_])Не\s+могу\s+помочь(?![\p{L}\p{N}_])/gu, 'Уточню у команды и вернусь с ответом')
    .replace(/(?<![\p{L}\p{N}_])не\s+могу\s+помочь(?![\p{L}\p{N}_])/gu, 'уточню у команды и вернусь с ответом');

  // 9. Rule 5: "Сложно" / "Невозможно"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Это\s+невозможно\s+исправить(?![\p{L}\p{N}_])/giu, 'Доработаем функционал в следующих обновлениях')
    .replace(/(?<![\p{L}\p{N}_])Это\s+невозможно\s+сделать(?![\p{L}\p{N}_])/giu, 'Предлагаю альтернативное решение')
    .replace(/(?<![\p{L}\p{N}_])Невозможно(?![\p{L}\p{N}_])/gu, 'Потребует времени')
    .replace(/(?<![\p{L}\p{N}_])невозможно(?![\p{L}\p{N}_])/gu, 'потребует времени');

  // 10. Rules on blame & accusatory language
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Вы\s+неправильно\s+настроили\s+драйвер(?![\p{L}\p{N}_])/giu, 'Проверим настройки драйвера вместе')
    .replace(/(?<![\p{L}\p{N}_])Вы\s+неправильно\s+настроили(?![\p{L}\p{N}_])/gu, 'Предлагаем вместе проверить настройки')
    .replace(/(?<![\p{L}\p{N}_])вы\s+неправильно\s+настроили(?![\p{L}\p{N}_])/gu, 'предлагаем вместе проверить настройки')
    .replace(/(?<![\p{L}\p{N}_])Ваша\s+ошибка(?![\p{L}\p{N}_])/giu, 'Нестандартное поведение')
    .replace(/(?<![\p{L}\p{N}_])ваша\s+ошибка(?![\p{L}\p{N}_])/giu, 'нестандартное поведение')
    .replace(/(?<![\p{L}\p{N}_])Ошибка\s+пользователя(?![\p{L}\p{N}_])/giu, 'Особенность настройки')
    .replace(/(?<![\p{L}\p{N}_])ошибка\s+пользователя(?![\p{L}\p{N}_])/giu, 'особенность настройки')
    .replace(/(?<![\p{L}\p{N}_])проблема\s+на\s+вашей\s+стороне(?![\p{L}\p{N}_])/giu, 'вопрос в настройках конфигурации')
    .replace(/(?<![\p{L}\p{N}_])Проблема\s+на\s+вашей\s+стороне(?![\p{L}\p{N}_])/giu, 'Вопрос в настройках конфигурации');

  // 11. Rule 1: "Проблема"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Проблема\s+из-за\s+старой\s+версии(?![\p{L}\p{N}_])/giu, 'Обновление версии улучшит работу')
    .replace(/(?<![\p{L}\p{N}_])проблема\s+из-за\s+старой\s+версии(?![\p{L}\p{N}_])/giu, 'обновление версии улучшит работу')
    .replace(/(?<![\p{L}\p{N}_])У\s+вас\s+проблема\s+с(?![\p{L}\p{N}_])/gu, 'Разберём ситуацию с')
    .replace(/(?<![\p{L}\p{N}_])у\s+вас\s+проблема\s+с(?![\p{L}\p{N}_])/gu, 'разберём ситуацию с')
    .replace(/(?<![\p{L}\p{N}_])Проблема\s+из-за(?![\p{L}\p{N}_])/gu, 'Ситуация возникла из-за')
    .replace(/(?<![\p{L}\p{N}_])проблема\s+из-за(?![\p{L}\p{N}_])/gu, 'ситуация возникла из-за')
    .replace(/(?<![\p{L}\p{N}_])для\s+решения\s+проблемы(?![\p{L}\p{N}_])/gu, 'для решения вопроса')
    .replace(/(?<![\p{L}\p{N}_])Для\s+решения\s+проблемы(?![\p{L}\p{N}_])/gu, 'Для решения вопроса')
    .replace(/(?<![\p{L}\p{N}_])в\s+решении\s+проблемы(?![\p{L}\p{N}_])/gu, 'в решении вопроса')
    .replace(/(?<![\p{L}\p{N}_])проблем(?:а|у|ы|ой|е)(?![\p{L}\p{N}_])/giu, (match) => {
      const lower = match.toLowerCase();
      let repl = 'вопрос';
      if (lower === 'проблема') repl = 'ситуация';
      else if (lower === 'проблему') repl = 'вопрос';
      else if (lower === 'проблемы') repl = 'вопросы';
      else if (lower === 'проблемой') repl = 'вопросом';
      else if (lower === 'проблеме') repl = 'вопросу';
      return match[0] === match[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl;
    });

  // 12. Rule 6: "Срочно"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Срочно\s+обновите\s+лицензию\b/giu, 'Обновление лицензии решит вопрос')
    .replace(/(?<![\p{L}\p{N}_])Срочно\s+обновите(?![\p{L}\p{N}_])/gu, 'Рекомендуем в первую очередь обновить')
    .replace(/(?<![\p{L}\p{N}_])срочно\s+обновите(?![\p{L}\p{N}_])/gu, 'рекомендуем в первую очередь обновить')
    .replace(/(?<![\p{L}\p{N}_])Срочно(?![\p{L}\p{N}_])/gu, 'В первую очередь')
    .replace(/(?<![\p{L}\p{N}_])срочно(?![\p{L}\p{N}_])/gu, 'в первую очередь');

  // 13. Rule 2: "Ошибка" / "Баг"
  filtered = filtered
    .replace(/(?<![\p{L}\p{N}_])Это\s+ошибка\s+в\s+приложении(?![\p{L}\p{N}_])/giu, 'Обнаружено нестандартное поведение приложения')
    .replace(/(?<![\p{L}\p{N}_])баг(а|ом|у|е|и|ов|ами|ах)?(?![\p{L}\p{N}_])/giu, (match, suffix) => {
      const isCap = match[0] === match[0].toUpperCase();
      let repl = 'сбой';
      if (suffix === 'и' || suffix === 'ов' || suffix === 'ами' || suffix === 'ах') {
        repl = suffix === 'ов' ? 'сбоев' : (suffix === 'ами' ? 'сбоями' : 'сбои');
      } else if (suffix === 'а') {
        repl = 'сбоя';
      } else if (suffix === 'ом') {
        repl = 'сбоем';
      } else if (suffix === 'у') {
        repl = 'сбою';
      } else if (suffix === 'е') {
        repl = 'сбое';
      }
      return isCap ? repl[0].toUpperCase() + repl.slice(1) : repl;
    });

  // Restore code blocks
  filtered = filtered.replace(/__CODE_BLOCK_(\d+)__/gu, (_, idx) => codeBlocks[Number(idx)] || '');

  // Normalize capital letters after punctuation
  filtered = filtered.replace(/([.!?]\s+)([а-яa-z])/gu, (m, p1, p2) => p1 + p2.toUpperCase());

  return filtered;
}

function detectFirstResponse(
  ticketCtx?: { has_staff_reply?: boolean; description?: string; messages?: any[] },
  query?: string,
  hist?: any[]
): boolean {
  if (ticketCtx?.has_staff_reply === false) {
    return true;
  }
  if (ticketCtx?.has_staff_reply === true) {
    if (query && /перв(?:ый|ого|ому|ом)\s+ответ|first\s+response/i.test(query)) {
      return true;
    }
    return false;
  }
  if (ticketCtx?.description && /\bSTAFF\s*:/i.test(ticketCtx.description)) {
    if (query && /перв(?:ый|ого|ому|ом)\s+ответ|first\s+response/i.test(query)) {
      return true;
    }
    return false;
  }
  if (query && /перв(?:ый|ого|ому|ом)\s+ответ|first\s+response/i.test(query)) {
    return true;
  }
  if (!hist || hist.length === 0) {
    return true;
  }
  return false;
}

function formatCustomerDraft(text: string, caseNumber?: string, isFirstResponse?: boolean): string {
  if (!text) return '';

  let sanitized = sanitizeCustomerDraft(text);
  if (!sanitized) return '';

  const cleanCase = (caseNumber || '')
    .replace(/^[№#\s]+/, '')
    .replace(/\s+/g, '')
    .trim();

  // If no case number or it's the mock placeholder without a real number, strip placeholders and stray symbols
  if (!cleanCase || cleanCase === 'OMNIDESK_ACTIVE_TICKET' || cleanCase === 'N/A') {
    return sanitized
      .replace(/(?:№|#)\s*\[?(?:номер\s+обращения|номер\s+тикета|номер\s+заявки|номер\s+кейса|номер|case_number|ticket_number|ticket\s+number|case\s+number|XXX-XXXXXX|\.{2,}|…|___+)\]?/gi, '')
      .replace(/\[(?:номер\s+обращения|номер\s+тикета|номер\s+заявки|номер\s+кейса|case_number|ticket_number|ticket\s+number|case\s+number)\]/gi, '')
      .replace(/\{(?:case_number|ticket_number)\}/gi, '')
      .replace(/(?:обращени[яеюи]|тикет[аеу]|заявк[еуи])\s*[#№](?!\w)/gi, (m, p) => p)
      .replace(/(?:inquiry|ticket|case)\s*[#№](?!\w)/gi, (m, p) => p)
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  // 1. Replace explicit placeholders and convert existing № symbols before the ticket number to #
  // Placeholder patterns:
  // [номер обращения], [номер тикета], [номер заявки], [номер кейса]
  // {case_number}, {ticket_number}, [case_number], [ticket_number], [ticket number], [case number]
  // #XXX-XXXXXX, №XXX-XXXXXX, XXX-XXXXXX (when associated with обращение/тикет), №..., #...
  sanitized = sanitized
    .replace(/(?:№|#)\s*\[?(?:номер\s+обращения|номер\s+тикета|номер\s+заявки|номер\s+кейса|номер|case_number|ticket_number|ticket\s+number|case\s+number|XXX-XXXXXX|\.{2,}|…|___+)\]?/gi, `#${cleanCase}`)
    .replace(/\[(?:номер\s+обращения|номер\s+тикета|номер\s+заявки|номер\s+кейса|case_number|ticket_number|ticket\s+number|case\s+number)\]/gi, `#${cleanCase}`)
    .replace(/\{(?:case_number|ticket_number)\}/gi, `#${cleanCase}`)
    .replace(/(обращени[яеюи]|тикет[аеу]|заявк[еуи])\s*(?:№|#)?\s*XXX-XXXXXX/gi, `$1 #${cleanCase}`)
    .replace(/(?:inquiry|ticket|case)\s*(?:#|№)?\s*XXX-XXXXXX/gi, `inquiry #${cleanCase}`);

  // If № was already written before cleanCase (e.g. №810-499430), convert it to #810-499430
  const escapedCase = cleanCase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  sanitized = sanitized
    .replace(new RegExp(`№\\s*#?\\s*${escapedCase}`, 'gi'), `#${cleanCase}`)
    .replace(new RegExp(`##+${escapedCase}`, 'gi'), `#${cleanCase}`)
    .replace(/№\s*№\s*/g, '#')
    .replace(/№\s*#/g, '#');

  // Check if case number is already mentioned in the draft (formatted with # or as number)
  const hasCaseNumber = sanitized.includes(`#${cleanCase}`) || sanitized.includes(cleanCase);

  // If first response and case number is still not present, insert it
  if (isFirstResponse && !hasCaseNumber) {
    // 2. Try inserting into existing inquiry phrase if present without number
    const inquiryRegex = /(^|[^а-яa-z0-9_])(по\s+вашему\s+обращению|по\s+обращению|ваше\s+обращение|в\s+обращении|по\s+тикету|в\s+тикете|regarding\s+your\s+inquiry|regarding\s+your\s+ticket|regarding\s+the\s+ticket)(?![а-яa-z0-9_]|\s*[#№]?\s*\d)/i;
    if (inquiryRegex.test(sanitized)) {
      sanitized = sanitized.replace(inquiryRegex, `$1$2 #${cleanCase}`);
    } else {
      // 3. Insert after greeting or at the beginning
      const greetingMatch = sanitized.match(/^(\s*(?:Здравствуйте|Добрый день|Добрый вечер|Приветствую|Уважаем[^\n,!]*|Hello|Hi|Dear\s+[^\n,!]*)[^\n]*[!\.\?]\s*[\r\n]*)/i);
      if (greetingMatch) {
        const greeting = greetingMatch[0].trim();
        const rest = sanitized.substring(greetingMatch[0].length).trim();
        const isEnglish = /^(?:Hello|Hi|Dear)/i.test(greeting);
        const ticketRef = isEnglish
          ? `Regarding your inquiry #${cleanCase}:`
          : `По вашему обращению #${cleanCase}:`;
        sanitized = `${greeting}\n\n${ticketRef}\n${rest}`;
      } else {
        const isEnglish = /^[a-zA-Z\s,.'"-]+$/.test(sanitized.slice(0, 30));
        const ticketRef = isEnglish
          ? `Regarding inquiry #${cleanCase}:`
          : `По вашему обращению #${cleanCase}:`;
        sanitized = `${ticketRef}\n\n${sanitized}`;
      }
    }
  }

  // Ensure any remaining № before cleanCase is normalized to # and clean up any stray orphan #
  sanitized = sanitized
    .replace(new RegExp(`№\\s*#?\\s*${escapedCase}`, 'gi'), `#${cleanCase}`)
    .replace(new RegExp(`##+${escapedCase}`, 'gi'), `#${cleanCase}`)
    .replace(/(?:обращени[яеюи]|тикет[аеу]|заявк[еуи])\s*[#№](?!\w)/gi, (m, p) => p)
    .replace(/(?:inquiry|ticket|case)\s*[#№](?!\w)/gi, (m, p) => p)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return sanitized;
}

app.post("/api/omnidesk/cases/:caseNumber/messages", requireWidgetAuth, async (req, res) => {
  const { caseNumber } = req.params;
  const { content } = req.body;
  const rawStaffEmail = req.headers['x-staff-email'] || req.body?.staffEmail || req.body?.staff_email;
  const staffEmail = Array.isArray(rawStaffEmail) ? rawStaffEmail[0] : (typeof rawStaffEmail === 'string' ? rawStaffEmail : undefined);

  if (!content) {
    return res.status(400).json({ error: "Content is required" });
  }
  if (!settings.omnidesk_domain || !settings.omnidesk_api_key || !settings.omnidesk_email) {
    return res.status(503).json({ error: "Omnidesk API is not configured in Settings" });
  }

  try {
    const effectiveEmail = staffEmail?.trim() || settings.omnidesk_email;
    const verifyResult = await verifyAndFetchOmnideskTicket(caseNumber, effectiveEmail);
    if (!verifyResult.success) {
      return res.status(403).json({ error: verifyResult.error || "Access denied to ticket in Omnidesk" });
    }

    const resolvedId = await resolveCaseId(caseNumber, effectiveEmail);
    if (!resolvedId) {
      return res.status(403).json({ error: "Could not resolve case ID" });
    }

    const domain = settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${effectiveEmail}:${settings.omnidesk_api_key}`).toString('base64');

    const omniRes = await fetch(`https://${domain}/api/cases/${resolvedId}/messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          content: content
        }
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (omniRes.ok) {
      const data = await omniRes.json();
      return res.json({ success: true, data });
    } else {
      if (omniRes.status === 401 || omniRes.status === 403 || omniRes.status === 404) {
        return res.status(403).json({ error: "Access denied to ticket in Omnidesk" });
      }
      const errText = await omniRes.text();
      return res.status(omniRes.status).json({ error: errText });
    }
  } catch (error: any) {
    console.error("Error adding message via Omnidesk API:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Deduplication cache for escalation notes (caseId -> { hash, timestamp })
const recentEscalationNotes = new Map<string, { hash: string; timestamp: number }>();

async function addOmnideskNote(
  caseNumber: string,
  content: string,
  staffEmail?: string,
  staffId?: string | number
): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
  if (!content || !content.trim()) {
    return { success: false, status: 400, error: "Content is required" };
  }
  if (!settings.omnidesk_domain || !settings.omnidesk_api_key || !settings.omnidesk_email) {
    return { success: false, status: 503, error: "Omnidesk API is not configured in Settings" };
  }

  if (caseNumber === 'OMNIDESK_ACTIVE_TICKET') {
    console.log('[Omnidesk Note] Mock ticket OMNIDESK_ACTIVE_TICKET - simulated note created');
    return { success: true, data: { mock: true, content: content.trim() } };
  }

  try {
    const authEmail = (staffEmail && staffEmail.trim()) ? staffEmail.trim() : settings.omnidesk_email;
    let resolvedId = await resolveCaseId(caseNumber, authEmail);
    if (!resolvedId) {
      resolvedId = caseNumber.replace(/\D/g, '');
    }
    if (!resolvedId) {
      return { success: false, status: 403, error: "Could not resolve case ID" };
    }

    const domain = settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${authEmail}:${settings.omnidesk_api_key}`).toString('base64');

    const notePayload: any = {
      content: content.trim()
    };
    if (staffId) {
      notePayload.staff_id = staffId;
    } else if (authEmail) {
      notePayload.staff_email = authEmail;
    }

    const omniRes = await fetch(`https://${domain}/api/cases/${resolvedId}/notes.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        note: notePayload
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (omniRes.ok) {
      const data = await omniRes.json();
      console.log(`[Omnidesk Note] Successfully added note to case ${resolvedId}`);
      return { success: true, data };
    } else {
      if (omniRes.status === 401 || omniRes.status === 403 || omniRes.status === 404) {
        return { success: false, status: 403, error: "Access denied to ticket in Omnidesk" };
      }
      const errText = await omniRes.text();
      console.error(`[Omnidesk Note] Failed to add note to case ${resolvedId} (${omniRes.status}):`, errText);
      return { success: false, status: omniRes.status, error: errText };
    }
  } catch (error: any) {
    console.error("[Omnidesk Note] Error adding note via Omnidesk API:", error);
    return { success: false, status: 500, error: error.message };
  }
}

app.post("/api/omnidesk/cases/:caseNumber/notes", requireWidgetAuth, async (req, res) => {
  const { caseNumber } = req.params;
  const { content, staff_id, staff_email } = req.body;
  const rawStaffEmail = req.headers['x-staff-email'] || staff_email || req.body?.staffEmail;
  const effectiveStaffEmail = Array.isArray(rawStaffEmail) ? rawStaffEmail[0] : (typeof rawStaffEmail === 'string' ? rawStaffEmail : undefined);

  if (!content) {
    return res.status(400).json({ error: "Content is required" });
  }

  const authEmail = effectiveStaffEmail?.trim() || settings.omnidesk_email;
  const isMock = caseNumber === 'OMNIDESK_ACTIVE_TICKET';
  if (!isMock) {
    const verifyResult = await verifyAndFetchOmnideskTicket(caseNumber, authEmail);
    if (!verifyResult.success) {
      return res.status(403).json({ error: verifyResult.error || "Access denied to ticket in Omnidesk" });
    }
  }

  const result = await addOmnideskNote(caseNumber, content, authEmail, staff_id);
  if (result.success) {
    return res.json({ success: true, data: result.data });
  } else {
    return res.status(result.status || 500).json({ error: result.error });
  }
});

// Manual classification API endpoint
app.post("/api/omnidesk/cases/:caseNumber/classify", requireWidgetAuth, async (req, res) => {
  const { caseNumber } = req.params;
  const { force } = req.body || {};
  const rawStaffEmail = req.headers['x-staff-email'] || req.body?.staffEmail || req.body?.staff_email;
  const staffEmail = Array.isArray(rawStaffEmail) ? rawStaffEmail[0] : (typeof rawStaffEmail === 'string' ? rawStaffEmail : undefined);

  if (!settings.omnidesk_domain || !settings.omnidesk_api_key || !settings.omnidesk_email) {
    return res.status(503).json({ error: 'Omnidesk not configured' });
  }

  try {
    const effectiveEmail = staffEmail?.trim() || settings.omnidesk_email;
    if (force) classifiedTickets.delete(caseNumber);

    const ticketResult = await verifyAndFetchOmnideskTicket(caseNumber, effectiveEmail);
    if (!ticketResult.success || !ticketResult.data) {
      return res.status(ticketResult.status || 403).json({ error: ticketResult.error || 'Ticket not found or Omnidesk unavailable' });
    }

    const { subject, description, messages = [] } = ticketResult.data;

    const result = await classifyTicket(
      caseNumber,
      subject || '',
      description || '',
      messages
    );

    if (!result || Object.keys(result.fields).length === 0) {
      return res.json({ classified: false, message: 'Не удалось классифицировать тикет' });
    }

    // Build human-readable classification
    const readable: Record<string, string> = {};
    for (const [fieldId, value] of Object.entries(result.fields)) {
      const meta = CLASSIFICATION_FIELDS[fieldId as keyof typeof CLASSIFICATION_FIELDS];
      if (meta) {
        readable[meta.title] = meta.options ? (meta.options[value] || `unknown(${value})`) : value;
      }
    }

    // Push to Omnidesk
    const pushResult = await pushClassificationToOmnidesk(caseNumber, result.fields, effectiveEmail);

    if (pushResult.success) {
      classifiedTickets.add(caseNumber);
    }

    logAnalytics('api_call', {
      endpoint: '/classify',
      caseId: caseNumber,
      classification: result.fields,
      reasoning: result.reasoning,
      pushed: pushResult.success
    });

    res.json({
      classified: true,
      fields: result.fields,
      readable,
      reasoning: result.reasoning,
      pushed: pushResult.success,
      pushError: pushResult.error
    });
  } catch (err: any) {
    console.error('Classification endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm and apply classification fields to Omnidesk (Human-in-the-loop)
app.post("/api/omnidesk/cases/:caseNumber/classify/apply", requireWidgetAuth, async (req, res) => {
  const { caseNumber } = req.params;
  const { fields } = req.body || {};
  const rawStaffEmail = req.headers['x-staff-email'] || req.body?.staffEmail || req.body?.staff_email;
  const staffEmail = Array.isArray(rawStaffEmail) ? rawStaffEmail[0] : (typeof rawStaffEmail === 'string' ? rawStaffEmail : undefined);

  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'fields object is required' });
  }

  const validation = validateClassificationFields(fields);
  if (!validation.valid && Object.keys(validation.fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided', details: validation.errors });
  }

  // Бизнес-правило: если продукт SmartPro (1) — направление автоматизации строго Коммерческая автоматизация (2)
  if (validation.fields.cf_10704 === '1') {
    validation.fields.cf_10069 = '2';
  }

  const effectiveEmail = staffEmail?.trim() || settings.omnidesk_email;
  const pushResult = await pushClassificationToOmnidesk(caseNumber, validation.fields, effectiveEmail);

  if (!pushResult.success) {
    return res.status(500).json({ error: pushResult.error || 'Failed to apply classification to Omnidesk' });
  }

  classifiedTickets.add(caseNumber);
  logAnalytics('api_call', {
    endpoint: '/classify/apply',
    caseId: caseNumber,
    fields: validation.fields,
    staffEmail: effectiveEmail
  });

  res.json({
    success: true,
    appliedFields: validation.fields,
    errors: validation.errors.length > 0 ? validation.errors : undefined
  });
});

// Clear screenshot cache for a specific ticket
app.delete("/api/omnidesk/cases/:caseNumber/images-cache", requireWidgetAuth, (req, res) => {
  const { caseNumber } = req.params;
  const removedCount = clearTicketImagesCache(caseNumber);
  res.json({ success: true, caseNumber, removedCount });
});

// GET conversation history for a specific ticket
app.get("/api/omnidesk/cases/:caseNumber/history", requireWidgetAuth, async (req, res) => {
  const caseNumber = String(req.params.caseNumber);
  const conv = getTicketConversation(caseNumber);
  const summary = conv ? (conv.summary || buildConversationSummary(conv.messages)) : '';

  let hasPresaleLabel = false;
  let labels: string[] = [];
  try {
    const rawStaffEmail = req.headers['x-staff-email'] || req.query?.staff_email;
    const staffEmail = typeof rawStaffEmail === 'string' ? rawStaffEmail : (Array.isArray(rawStaffEmail) && typeof rawStaffEmail[0] === 'string' ? rawStaffEmail[0] : undefined);
    if (caseNumber && caseNumber !== 'OMNIDESK_ACTIVE_TICKET') {
      const ticketRes = await verifyAndFetchOmnideskTicket(caseNumber, staffEmail);
      if (ticketRes.success && ticketRes.data) {
        hasPresaleLabel = Boolean(ticketRes.data.has_presale_label);
        labels = ticketRes.data.labels || [];
      }
    }
  } catch (e) {
    // Non-blocking fallback for history
  }

  res.json({
    caseNumber,
    caseId: conv?.caseId || undefined,
    updatedAt: conv?.updatedAt || null,
    messagesCount: conv?.messages?.length || 0,
    summary,
    messages: conv?.messages || [],
    labels,
    has_presale_label: hasPresaleLabel
  });
});

// GET ticket details and labels for a specific ticket
app.get("/api/omnidesk/cases/:caseNumber/details", requireWidgetAuth, async (req, res) => {
  const caseNumber = String(req.params.caseNumber);
  const rawStaffEmail = req.headers['x-staff-email'] || req.query?.staff_email;
  const staffEmail = typeof rawStaffEmail === 'string' ? rawStaffEmail : (Array.isArray(rawStaffEmail) && typeof rawStaffEmail[0] === 'string' ? rawStaffEmail[0] : undefined);

  const ticketResult = await verifyAndFetchOmnideskTicket(caseNumber, staffEmail);
  if (!ticketResult.success) {
    return res.status(ticketResult.status || 404).json({ error: ticketResult.error || "Ticket not found" });
  }

  res.json({
    case_number: ticketResult.data?.case_number || caseNumber,
    case_id: ticketResult.data?.case_id,
    subject: ticketResult.data?.subject,
    labels: ticketResult.data?.labels || [],
    has_presale_label: Boolean(ticketResult.data?.has_presale_label)
  });
});

// POST append manual or custom message to ticket conversation history
app.post("/api/omnidesk/cases/:caseNumber/history", requireWidgetAuth, (req, res) => {
  const { caseNumber } = req.params;
  const { role, replyText, userQuery, suggestions, escalation, classification, caseId } = req.body || {};

  if (!replyText && !userQuery) {
    return res.status(400).json({ error: 'replyText or userQuery is required' });
  }

  const rawStaffEmail = req.headers['x-staff-email'] || req.body?.staffEmail || req.body?.staff_email;
  const staffEmail = Array.isArray(rawStaffEmail) ? rawStaffEmail[0] : (typeof rawStaffEmail === 'string' ? rawStaffEmail : undefined);

  const message: ConversationMessage = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: new Date().toISOString(),
    role: role === 'user' ? 'user' : 'assistant',
    staffEmail,
    userQuery,
    replyText: replyText || '',
    suggestions,
    escalation,
    classification
  };

  addTicketConversationMessage(caseNumber, message, caseId);
  res.json({ success: true, message });
});

// DELETE conversation history for a specific ticket
app.delete("/api/omnidesk/cases/:caseNumber/history", requireWidgetAuth, (req, res) => {
  const { caseNumber } = req.params;
  clearTicketConversation(caseNumber);
  res.json({ success: true, caseNumber });
});

// GET all ticket conversations (admin only)
app.get("/api/omnidesk/conversations", requireAuth, (req, res) => {
  const list = Array.from(conversationsCache.values());
  res.json({ conversations: list, count: list.length });
});

// ─── Skill Router (Dynamic Skill Selection) ──────────────────────────────────
export function selectRelevantSkills(
  allSkills: any[],
  queryText: string | { subject?: string; description?: string; messages?: any[] } = '',
  ticketContext?: { subject?: string; description?: string; messages?: any[] },
  maxSkills: number = 3
): any[] {
  if (!Array.isArray(allSkills) || allSkills.length === 0) return [];

  if (typeof queryText === 'object' && queryText !== null && !ticketContext) {
    ticketContext = queryText;
    queryText = '';
  }

  const enabledSkills = allSkills.filter(s => s && s.enabled !== false && (s.content || s.name));
  if (enabledSkills.length <= 1) return enabledSkills;

  const combinedText = [
    typeof queryText === 'string' ? queryText : '',
    ticketContext?.subject || '',
    ticketContext?.description || '',
    ...(ticketContext?.messages || []).map((m: any) => typeof m === 'string' ? m : (m?.content || ''))
  ].join(' ').toLowerCase();

  // Keyword rules for known skills
  const SKILL_RULES: Record<string, { triggers: RegExp; baseScore: number; isCore?: boolean }> = {
    'customer-support': {
      triggers: /.*/,
      baseScore: 100,
      isCore: true
    },
    'support-stop-words': {
      triggers: /.*/,
      baseScore: 100,
      isCore: true
    },
    'support-escalation': {
      triggers: /(?:эскалаци|переда(?:й|ть|ча)|разработч|продукт|пресейл|коммерци|сервисный\s+центр|сц|отдел\s+продаж|баг|дефект|заметк|внутренн(?:яя|юю)\s+заметк|2-?я?\s+лини)/i,
      baseScore: 50
    },
    'network-troubleshooting': {
      triggers: /(?:сеть|сетев|ip|tcp|udp|dhcp|роутер|маршрутизатор|шлюз|порт|пинг|ping|dns|mikrotik|wi-?fi|ethernet|соединени)/i,
      baseScore: 40
    },
    'modbus-knx-protocols': {
      triggers: /(?:knx|modbus|bacnet|dali|dmx|zigbee|z-?wave|rs-?485|mqtt|протокол|интерфейс\s+подключени)/i,
      baseScore: 40
    },
    'ui-ux-design': {
      triggers: /(?:интерфейс|дизайн|кнопк|виджет|верстк|шрифт|стил|css|svg|разрешени|экран|панел)/i,
      baseScore: 30
    },
    'server-hardware': {
      triggers: /(?:umc|rpi|raspberry|wiren\s*board|wb|nuc|желез|памят|cpu|перегрев|питани|poe|прошивк|hwid)/i,
      baseScore: 40
    },
    'support-incident': {
      triggers: /(?:инцидент|несколько\s+авар|масштабн(?:ый|ый\s+сбой)|чп\b|срыв\s+срок|критичн(?:ый|ые)\s+срок|подтверждённые\s+обещания|рабочая\s+группа|финансов(?:ые|ый)\s+последстви|репутацион)/i,
      baseScore: 60
    },
    'support-postmortem': {
      triggers: /(?:post\s*mortem|постмортем|разбор\s+авар|корнев(?:ая|ой)\s+причин|почему\s+произошло|исикав|таймлайн\s+авар|что\s+(?:сделать|можно\s+сделать)\s+чтобы\s+не\s+повторил|превентивн)/i,
      baseScore: 70
    },
    'support-qa-testing': {
      triggers: /(?:тест[- ]?кейс|test\s*case|тест[- ]?план|test\s*plan|отчёт\s+о\s+тестировании|testing\s+report|чек[- ]?лист\s+проверок|регрессионн(?:ый|ое)\s+тест|тестовая\s+документация|оформить\s+тест|написать\s+тест(?:-кейс|-план))/i,
      baseScore: 70
    }
  };

  const scoredSkills: { skill: any; score: number; isCore: boolean }[] = [];

  for (const s of enabledSkills) {
    const skillName = (s.name || '').toLowerCase().trim();
    const rule = SKILL_RULES[skillName];

    let score = 0;
    let isCore = false;

    if (rule?.isCore || skillName.includes('customer-support') || skillName.includes('stop-words')) {
      isCore = true;
      score = 1000;
    } else {
      if (skillName && combinedText.includes(skillName.replace(/-/g, ' '))) {
        score += 80;
      }
      if (rule && rule.triggers.test(combinedText)) {
        score += rule.baseScore;
      }
      const nameParts = skillName.split(/[-_\s]+/).filter((p: string) => p.length > 3);
      for (const part of nameParts) {
        if (combinedText.includes(part)) {
          score += 20;
        }
      }
    }

    if (isCore || score > 0) {
      scoredSkills.push({ skill: s, score, isCore });
    }
  }

  const core = scoredSkills.filter(x => x.isCore).map(x => x.skill);
  const others = scoredSkills
    .filter(x => !x.isCore && x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.skill);

  const selected = [...core, ...others.slice(0, maxSkills)];
  if (selected.length === 0 && enabledSkills.length > 0) {
    return [enabledSkills[0]];
  }

  return selected;
}

// ─── Ticket Image Attachments ─────────────────────────────────────────────────
export const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif'
]);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_REQUEST = 5;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

export interface LoadedImagePart {
  fileName: string;
  file_name?: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
  hash?: string;
  fileId?: string | number;
  file_id?: string | number;
  url?: string;
}

export async function loadTicketImageAttachments(
  attachments: TicketAttachment[] | any[],
  authHeader?: string,
  omnideskDomain?: string
): Promise<LoadedImagePart[]> {
  const domainClean = (omnideskDomain || settings.omnidesk_domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const effectiveAuth = authHeader || ((settings.omnidesk_email && settings.omnidesk_api_key) ? Buffer.from(`${settings.omnidesk_email}:${settings.omnidesk_api_key}`).toString('base64') : '');

  const normalizedAtts = (attachments || []).map((raw: any) => {
    const item = raw.message_attachment || raw.attachment || raw;
    return {
      file_id: item.file_id || item.id,
      file_name: item.file_name || item.name || 'attachment',
      file_size: item.file_size || item.size || 0,
      mime_type: String(item.mime_type || item.content_type || '').toLowerCase().trim(),
      url: item.url || item.content_url || '',
      from_role: item.from_role || 'CLIENT'
    };
  });

  const imageAtts = normalizedAtts
    .filter(a => SUPPORTED_IMAGE_MIMES.has(a.mime_type))
    .filter(a => !a.file_size || a.file_size <= MAX_IMAGE_SIZE_BYTES)
    .slice(-MAX_IMAGES_PER_REQUEST);

  if (imageAtts.length === 0) return [];

  const results: LoadedImagePart[] = [];
  let totalBytes = 0;

  await Promise.all(
    imageAtts.map(async (att) => {
      try {
        if (domainClean && process.env.NODE_ENV !== 'test') {
          try {
            const attUrl = new URL(att.url);
            const host = attUrl.hostname.toLowerCase();
            const allowed = host.includes(domainClean.split('.')[0]) ||
                            host.endsWith('omnidesk.ru') ||
                            host.includes('omnidesk') ||
                            host.includes('amazonaws.com') ||
                            host.includes('yandexcloud.net');
            if (!allowed) {
              console.warn(`[ImageLoad] SSRF blocked: ${att.url}`);
              return;
            }
          } catch {}
        }

        const headers: Record<string, string> = {};
        if (effectiveAuth) {
          headers['Authorization'] = `Basic ${effectiveAuth}`;
        }

        const res = await fetch(att.url, {
          headers,
          signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
          console.warn(`[ImageLoad] HTTP ${res.status} for ${att.file_name}`);
          return;
        }

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
          console.warn(`[ImageLoad] Skipping ${att.file_name}: ${buffer.byteLength} bytes > limit`);
          return;
        }

        totalBytes += buffer.byteLength;
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
          console.warn(`[ImageLoad] Total limit reached, skipping ${att.file_name}`);
          return;
        }

        const mime = att.mime_type === 'image/jpg' ? 'image/jpeg' : att.mime_type;
        const hash = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
        results.push({
          fileName: att.file_name,
          file_name: att.file_name,
          mimeType: mime,
          base64: Buffer.from(buffer).toString('base64'),
          sizeBytes: buffer.byteLength,
          hash,
          fileId: att.file_id,
          file_id: att.file_id,
          url: att.url
        });
        console.log(`[ImageLoad] Loaded ${att.file_name} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
      } catch (err: any) {
        console.error(`[ImageLoad] Error: ${att.file_name}:`, err.message);
      }
    })
  );

  return results;
}

// Suggestions Engine
app.post("/api/chat", requireWidgetAuth, async (req, res) => {
  const { ticketContext, history, userQuery } = req.body;
  const rawStaffEmail = req.headers['x-staff-email'] || req.body?.staffEmail || req.body?.staff_email;
  const staffEmail = Array.isArray(rawStaffEmail) ? rawStaffEmail[0] : (typeof rawStaffEmail === 'string' ? rawStaffEmail : undefined);
  const reqStart = Date.now();

  let actualTicketContext = ticketContext;
  if (ticketContext?.id) {
    const isMock = ticketContext.id === 'OMNIDESK_ACTIVE_TICKET';
    if (!isMock) {
      const ticketResult = await verifyAndFetchOmnideskTicket(ticketContext.id, staffEmail);
      if (!ticketResult.success) {
        // Return 403 immediately without executing LLM and without leaking ticket data
        return res.status(403).json({ error: ticketResult.error || "Access denied to ticket in Omnidesk" });
      }
      actualTicketContext = { ...ticketContext, ...ticketResult.data };
    }
  }

  const rawCaseNumber = actualTicketContext?.case_number || actualTicketContext?.id || ticketContext?.case_number || ticketContext?.id || '';
  const effectiveCaseNumber = (rawCaseNumber && rawCaseNumber !== 'OMNIDESK_ACTIVE_TICKET')
    ? String(rawCaseNumber).replace(/^[№#\s]+/, '').trim()
    : (ticketContext?.case_number && ticketContext.case_number !== 'OMNIDESK_ACTIVE_TICKET'
        ? String(ticketContext.case_number).replace(/^[№#\s]+/, '').trim()
        : '');

  const isFirstResponse = detectFirstResponse(actualTicketContext, userQuery, history);

  // Deduplicate and load images from ticket attachments for multimodal analysis
  const alreadyRecognizedImages: RecognizedImageRecord[] = [];
  const unrecognizedAttachments: any[] = [];
  const seenCachedKeys = new Set<string>();

  if (actualTicketContext?.attachments && actualTicketContext.attachments.length > 0) {
    for (const att of actualTicketContext.attachments) {
      const cached = findInRecognizedCache(att, effectiveCaseNumber);
      if (cached) {
        const cacheKey = getAttachmentCacheKey(cached, effectiveCaseNumber) || cached.fileName;
        if (!seenCachedKeys.has(cacheKey)) {
          seenCachedKeys.add(cacheKey);
          alreadyRecognizedImages.push(cached);
        }
      } else {
        unrecognizedAttachments.push(att);
      }
    }
  }

  let loadedImages: LoadedImagePart[] = [];
  if (unrecognizedAttachments.length > 0) {
    try {
      const imgEmail = (staffEmail?.trim()) || settings.omnidesk_email;
      const imgAuth = (imgEmail && settings.omnidesk_api_key) ? Buffer.from(`${imgEmail}:${settings.omnidesk_api_key}`).toString('base64') : '';
      const downloadedImages = await loadTicketImageAttachments(
        unrecognizedAttachments, imgAuth, settings.omnidesk_domain
      );

      for (const img of downloadedImages) {
        let cachedByHash: RecognizedImageRecord | null = null;
        if (img.hash) {
          cachedByHash = findInRecognizedCache({ hash: img.hash }, effectiveCaseNumber);
        }
        if (cachedByHash) {
          const cacheKey = getAttachmentCacheKey(cachedByHash, effectiveCaseNumber) || cachedByHash.fileName;
          if (!seenCachedKeys.has(cacheKey)) {
            seenCachedKeys.add(cacheKey);
            alreadyRecognizedImages.push(cachedByHash);
          }
        } else {
          loadedImages.push(img);
        }
      }

      if (loadedImages.length > 0) {
        console.log(`[Vision] Loaded ${loadedImages.length} new images from ticket ${effectiveCaseNumber}`);
      }
    } catch (imgErr: any) {
      console.error('[Vision] Image loading failed, continuing text-only:', imgErr.message);
    }
  }

  if (alreadyRecognizedImages.length > 0) {
    console.log(`[Vision] Using ${alreadyRecognizedImages.length} cached image descriptions for ticket ${effectiveCaseNumber}`);
  }

  try {
    let dynamicKnowledge = '';
    
    // Dynamically search BookStack if configured
    if (settings.bookstack_url && settings.bookstack_token_id && settings.bookstack_token_secret) {
      try {
        const searchQuery = encodeURIComponent(userQuery || actualTicketContext?.subject || 'help');
        const searchRes = await fetch(`${settings.bookstack_url.replace(/\/$/, '')}/api/search?query=${searchQuery}&count=3`, {
          headers: {
            'Authorization': `Token ${settings.bookstack_token_id}:${settings.bookstack_token_secret}`
          },
          signal: AbortSignal.timeout(10000)
        });
        
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const pages = (searchData.data || []).filter((item: any) => item.type === 'page').slice(0, 3);
          
          for (const page of pages) {
            const pageRes = await fetch(`${settings.bookstack_url.replace(/\/$/, '')}/api/pages/${page.id}`, {
              headers: {
                'Authorization': `Token ${settings.bookstack_token_id}:${settings.bookstack_token_secret}`
              },
              signal: AbortSignal.timeout(10000)
            });
            if (pageRes.ok) {
              const pageData = await pageRes.json();
              let cleanContent = pageData.markdown || pageData.html || '';
              if (!pageData.markdown && pageData.html) {
                cleanContent = pageData.html.replace(/<[^>]*>?/gm, '');
              }
              let pageUrl = '';
              let bookSlug = '';
              if (pageData.book_id) {
                try {
                  const bookRes = await fetch(`${settings.bookstack_url.replace(/\/$/, '')}/api/books/${pageData.book_id}`, {
                    headers: {
                      'Authorization': `Token ${settings.bookstack_token_id}:${settings.bookstack_token_secret}`
                    },
                    signal: AbortSignal.timeout(5000)
                  });
                  if (bookRes.ok) {
                    const bookData = await bookRes.json();
                    if (bookData && bookData.slug) {
                      bookSlug = bookData.slug;
                    }
                  }
                } catch (e) {
                  console.error("Failed to fetch book slug dynamically during search:", e);
                }
              }

              if (bookSlug) {
                pageUrl = `${settings.bookstack_url.replace(/\/$/, '')}/books/${bookSlug}/page/${pageData.slug || pageData.id}`;
              } else if (pageData.url) {
                try {
                  const urlObj = new URL(pageData.url);
                  pageUrl = `${settings.bookstack_url.replace(/\/$/, '')}${urlObj.pathname}`;
                } catch (e) {
                  const path = pageData.url.startsWith('/') ? pageData.url : `/${pageData.url}`;
                  pageUrl = `${settings.bookstack_url.replace(/\/$/, '')}${path}`;
                }
              } else {
                pageUrl = `${settings.bookstack_url.replace(/\/$/, '')}/books/${pageData.book_id}/page/${pageData.slug || pageData.id}`;
              }
              dynamicKnowledge += `- BookStack Article "${pageData.name}" (Direct URL: ${pageUrl}): ${cleanContent.substring(0, 2000)}\n`;
            }
          }
        }
      } catch (err) {
        console.error("BookStack Dynamic Search Error:", err);
      }
    }

    // Parse and inject relevant skills via Skill Router into system instructions
    let activeSkillsContext = '';
    try {
      const allSkills = JSON.parse(settings.skills || '[]');
      if (Array.isArray(allSkills)) {
        const relevantSkills = selectRelevantSkills(allSkills, userQuery, actualTicketContext, 3);
        if (relevantSkills.length > 0) {
          activeSkillsContext = '\n\n=== ACTIVE AGENT SKILLS / CAPABILITIES (ROUTED) ===\n' +
            relevantSkills.map((s: any) => `### Skill: ${s.name || 'Unnamed'}\n${s.content || ''}`).join('\n\n') +
            '\n=== END ACTIVE SKILLS ===\n';
          console.log(`[Skill Router] Injected ${relevantSkills.length} skills: ${relevantSkills.map((s: any) => s.name).join(', ')}`);
        }
      }
    } catch (e) {
      console.error("Failed to parse active skills:", e);
    }

    const prompt = `
=== MASTER SYSTEM INSTRUCTIONS (HIGHEST PRIORITY) ===
${settings.system_prompt}${activeSkillsContext}
=====================================================

USER ROLE AND IDENTITY:
- The person chatting with you directly is an INTERNAL OPERATOR / SUPPORT ENGINEER (a colleague), NOT a customer.
- Treat direct queries from this chat as questions from the operator.

Relevant Knowledge Base (INTERNAL - for operator notes only, NEVER expose BookStack URLs to customer):
${knowledgeBase.map(item => `- ${item.title}: ${item.content}`).join('\n')}
${dynamicKnowledge}

Ticket Context:
${effectiveCaseNumber ? `Ticket Number: #${effectiveCaseNumber}\n` : ''}Subject: ${actualTicketContext?.subject || 'N/A'}
Description: ${actualTicketContext?.description || 'N/A'}
Is First Response: ${isFirstResponse ? 'YES' : 'NO'}
${alreadyRecognizedImages.length > 0 ? `\n--- ПРИКРЕПЛЕННЫЕ ИЗОБРАЖЕНИЯ (РАНЕЕ УЖЕ РАСПОЗНАНЫ В ЭТОМ ТИКЕТЕ) ---\n${alreadyRecognizedImages.map(img => `• Файл: ${img.fileName}${img.fileId ? ` (ID: ${img.fileId})` : ''}\n  Извлеченные визуальные факты и ошибки: ${img.visualDescription}`).join('\n')}\n` : ''}${loadedImages.length > 0 ? `\nAttached Screenshots (${loadedImages.length}):\n${loadedImages.map((img, i) => `- Image #${i + 1}: ${img.fileName} (${img.mimeType}, ${(img.sizeBytes / 1024).toFixed(0)} KB)`).join('\n')}\nCRITICAL: The images above are included as inlineData in this multimodal request. Analyze all error messages, UI elements, stack traces, and logs visible in the screenshots. Use visual evidence in your technical analysis and customer drafts.\n` : ''}
Chat History with Operator: ${JSON.stringify(history)}

Latest Query from Operator: "${userQuery || 'Подготовь черновик ответа клиенту по этому тикету.'}"

INSTRUCTIONS & GUIDELINES:
1. MASTER PROMPT PRIORITY:
   - All rules, stop-words, prohibitions, tone instructions, and format requirements from MASTER SYSTEM INSTRUCTIONS above have ABSOLUTE HIGHEST PRIORITY and override any other default behavior.
   - If MASTER SYSTEM INSTRUCTIONS specifies a persona, communication style (e.g. Caveman style, extreme conciseness), or forbidden words/phrases, you MUST STRICTLY FOLLOW IT.

2. STRICT ROLE SEPARATION:
   - "reply" field — DIRECT RESPONSE TO THE OPERATOR (colleague):
     * Answer the operator's query or provide recommendations/analysis for the ticket.
     * Follow the tone, style, and constraints defined in MASTER SYSTEM INSTRUCTIONS.
     * Internal BookStack/wiki links are allowed here.
   
   - "suggestions" array — CUSTOMER-FACING DRAFTS (if applicable for the ticket):
     * Professional, accurate drafts to be sent to the customer in the ticket.
     * ABSOLUTE BAN on internal links (BookStack, internal wikis).
     * Must strictly follow all stop-words and negative constraints from MASTER SYSTEM INSTRUCTIONS.
     * If the operator asked a purely general question not requiring a customer draft, you may return an empty suggestions array [].

   - "escalation" object — OMNIDESK NOTE (skill support-escalation):
     * Evaluate whether escalation to another team (developers, hardware service, presale, sales) is required:
       "used": true/false (true if escalation was evaluated),
       "required": true/false (STRICTLY TRUE ONLY if escalation to another team or developer is actually REQUIRED or explicitly requested by the operator. If the issue is handled on 1st line or escalation is NOT needed, this MUST BE false!),
       "note_content": "CRITICAL: If required is false, keep this EMPTY (\"\"). If and ONLY IF required is true, write the exact internal note for Omnidesk with clear sections: 'Что есть' (all confirmed facts, versions, tested steps, logs/files) and 'Чего не хватает' (critical gaps, missing info for target team, questions for client)."

3. RESPONSE FORMAT — ABSOLUTELY CRITICAL:
   - Output ONLY valid JSON in the exact format:
     {
       "reply": "Direct response or analysis for the operator",
       "escalation": {
         "used": false,
         "required": false,
         "note_content": ""
       },
       "suggestions": [
         { "title": "Short title", "text": "Customer-facing draft text", "type": "Draft" }
       ]${loadedImages.length > 0 ? `,
       "image_descriptions": [
         { "fileName": "...", "description": "..." }
       ]` : ''}
     }
${loadedImages.length > 0 ? `   - "image_descriptions" array:
     * For each newly attached image provided in inlineData, return its file name and detailed description of visual facts, extracted text, UI elements, and error codes in JSON field "image_descriptions": [{ "fileName": "...", "description": "..." }].
     * ОБРАБОТКА НЕЧИТАЕМЫХ / РАЗМЫТЫХ СКРИНШОТОВ:
       Если текст, код, логи, схема или элементы интерфейса на скриншоте нечитаемы, размыты, обрезаны или имеют низкое разрешение:
       1) Обязательно прямо укажи это в анализе для оператора (в поле "reply"): 'На прикрепленном скриншоте [имя файла] текст/ошибка не читается из-за низкого разрешения/размытия'.
       2) В черновике ответа клиенту (в "suggestions") вежливо попроси клиента прислать полноразмерный четкий скриншот, скопированный текст ошибки или текстовый лог.
       3) КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать или угадывать текст ошибки, код или стек вызовов, если они не видны отчетливо.
` : ''}
   - CUSTOMER DRAFT PURITY & CLEANLINESS:
     * In "suggestions", each draft "text" MUST be 100% clean final text ready to send to the customer.
     * NEVER wrap the draft in :::writing directives, ::: tags, or markdown code blocks (\`\`\`text...\`\`\`).
     * NEVER include internal operator comments, headers (like "### Комментарий", "## Draft Response", "To:", "Tone:"), or notes inside the customer draft.
     * Put any internal analysis, classification, and diagnostics in "reply", and pure customer response in "suggestions".
     * FIRST RESPONSE & TICKET NUMBER:
       - If this is a first response (Is First Response: YES, or when composing the initial reply to a customer's inquiry), the customer draft MUST explicitly mention the ticket number using # (e.g. "По вашему обращению #${effectiveCaseNumber || 'XXX-XXXXXX'}..." or "Ваше обращение #${effectiveCaseNumber || 'XXX-XXXXXX'} принято в работу...").
       - Always use the actual ticket number from Ticket Context prefixed with # (${effectiveCaseNumber ? `#${effectiveCaseNumber}` : '#XXX-XXXXXX'}). Never use the "№" symbol and never leave placeholders like "[номер обращения]", "[номер тикета]", or "{case_number}".
     * STOP-WORDS & CUSTOMER COMMUNICATION RULES (support-stop-words / стоп-слова):
       STRICT COMPLIANCE REQUIRED for all text in "suggestions":
       1. "Проблема" -> Заменяй на: "ситуация", "вопрос", "момент" (Вместо "У вас проблема с драйвером" -> "Разберём ситуацию с драйвером"). Не пиши "для решения проблемы".
       2. "Ошибка" / "Баг" -> Заменяй на: "особенность", "нестандартное поведение", "сбой" (Вместо "Это ошибка в приложении" -> "Обнаружено нестандартное поведение приложения"). Слово "баг" запрещено!
       3. "Вы должны" / "Вам надо" -> Заменяй на: "Рекомендуем", "Предлагаем", "Для решения стоит...".
       4. "Не знаю" / "Не могу помочь" -> Заменяй на: "Уточню у команды", "Изучу вопрос", "Вернусь с ответом через N минут".
       5. "Сложно" / "Невозможно" -> Заменяй на: "Потребует времени", "Реализуем в ближайших версиях", "Проработаем вариант".
       6. "Срочно" (если не критично) -> Заменяй на: "Приоритетно", "В первую очередь".
       7. Жаргон / Сленг ("глючит", "крашится") -> Заменяй на: "работает некорректно", "завершает работу".
       8. "К сожалению" (в начале фразы) -> Заменяй на: "Благодарим за терпение", "Сейчас разберёмся".
       9. "Вы меня не поняли" / "Вы не правы" -> Заменяй на: "Позвольте пояснить подробнее", "Давайте уточним детали".
       10. "Читайте инструкцию" / "Это написано в справке" -> Заменяй на: "Направил ссылку на руководство, давайте разберём его вместе".
       11. "Как я уже говорил" / "Я же писал выше" -> Заменяй на: "Продублирую ключевые шаги для удобства", "Напомню порядок действий".
       12. "Это не наша зона ответственности" / "Мы этим не занимаемся" -> Заменяй на: "Подскажу, к кому обратиться / сориентирую по альтернативным решениям".
       - ПРАВИЛА «КАК ПРАВИЛЬНО»:
         * Вместо обвинений (❌ "Вы неправильно настроили драйвер") -> ✅ "Проверим настройки драйвера вместе".
         * Вместо негатива (❌ "Проблема из-за старой версии") -> ✅ "Обновление версии улучшит работу".
         * Вместо тупиков (❌ "Это невозможно сделать") -> ✅ "Предлагаю альтернативное решение".
         * Вместо раздражения (❌ "Я уже писал вам, нажмите...") -> ✅ "Продублирую: для продолжения нажмите, пожалуйста...".
`;

    let isCustom = false;
    let customModelConfig: any = null;
    if (settings.custom_models && settings.custom_models.startsWith('[')) {
      try {
        const parsed = JSON.parse(settings.custom_models);
        customModelConfig = parsed.find((m: any) => m.model_id === settings.model_name);
        if (customModelConfig) isCustom = true;
      } catch (e) {}
    }

    const pool = getApiKeysPool();
    if (pool.length === 0) {
      return res.status(400).json({ error: "API key is not configured. Please set it in the Settings panel or in your environment variables." });
    }

    let responseText = '{}';
    let success = false;
    let lastError: any = null;
    let actualModelUsed = selectModelForRequest(settings.model_name, loadedImages.length > 0, isCustom);

    const startIndex = lastUsedKeyIndex % pool.length;
    lastUsedKeyIndex = (startIndex + 1) % pool.length;

    for (let i = 0; i < pool.length; i++) {
      const currentIdx = (startIndex + i) % pool.length;
      const activeKey = pool[currentIdx];
      const masked = maskApiKey(activeKey);
      
      console.log(`[Rotation] Attempting LLM call using key index ${currentIdx} (${masked})`);
      
      try {
        if (isCustom && customModelConfig) {
          const endpoint = customModelConfig.base_url.replace(/\/$/, '') + '/chat/completions';
          const messagesPayload: any[] = [];
          const effectiveSystemPrompt = (settings.system_prompt && settings.system_prompt.trim())
            ? (settings.system_prompt.trim() + (activeSkillsContext ? activeSkillsContext : ''))
            : (activeSkillsContext ? activeSkillsContext.trim() : '');
          if (effectiveSystemPrompt) {
            messagesPayload.push({ role: 'system', content: effectiveSystemPrompt });
          }
          if (loadedImages.length > 0) {
            const userContent: any[] = [{ type: 'text', text: prompt }];
            for (const img of loadedImages) {
              userContent.push({
                type: 'image_url',
                image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
              });
            }
            messagesPayload.push({ role: 'user', content: userContent });
          } else {
            messagesPayload.push({ role: 'user', content: prompt });
          }

          const resOpenAI = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${activeKey}`
            },
            body: JSON.stringify({
              model: customModelConfig.model_id,
              messages: messagesPayload,
              temperature: settings.temperature !== undefined && !isNaN(Number(settings.temperature)) ? Math.max(0, Math.min(2, Number(settings.temperature))) : 0.5,
              response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(60000)
          });
          
          if (!resOpenAI.ok) {
            const errBody = await resOpenAI.text();
            throw new Error(`OpenAI-compatible API Error: ${resOpenAI.status} - ${errBody}`);
          }
          
          const dataOpenAI = await resOpenAI.json();
          responseText = dataOpenAI.choices?.[0]?.message?.content || '{}';
          success = true;
        } else {
          const activeAi = new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });
          
          const baseGenerateConfig: any = {
            responseMimeType: 'application/json',
            maxOutputTokens: Math.max(4096, Number(settings.max_tokens || 4096))
          };
          const effectiveSystemInstruction = (settings.system_prompt && settings.system_prompt.trim())
            ? (settings.system_prompt.trim() + (activeSkillsContext ? activeSkillsContext : ''))
            : (activeSkillsContext ? activeSkillsContext.trim() : '');
          if (effectiveSystemInstruction) {
            baseGenerateConfig.systemInstruction = effectiveSystemInstruction;
          }
          if (settings.temperature !== undefined && !isNaN(Number(settings.temperature))) {
            baseGenerateConfig.temperature = Math.max(0, Math.min(2, Number(settings.temperature)));
          }

          const targetModel = selectModelForRequest(settings.model_name, loadedImages.length > 0, isCustom);
          if (loadedImages.length > 0 && !isCustom && settings.model_name !== targetModel) {
            console.log(`[Vision] Image attachments detected (${loadedImages.length}): routing immediately to ${targetModel} (bypassing ${settings.model_name} rate limits)`);
          }
          actualModelUsed = targetModel;

          let response;
          try {
            response = await activeAi.models.generateContent({
              model: targetModel,
              contents: loadedImages.length > 0
                ? [...loadedImages.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })), prompt]
                : prompt,
              config: getModelGenerationConfig(targetModel, baseGenerateConfig)
            });
          } catch (apiError: any) {
            if (apiError.message && (apiError.message.includes("API Key not found") || apiError.message.includes("API key not valid"))) {
              throw new Error("The Gemini API key currently configured is invalid or has been revoked.");
            }
            
            if (isRateLimitError(apiError)) {
              // Cascade through fallback chain (uses image-optimized chain when images are present)
              const fallbacks = loadedImages.length > 0
                ? getFallbackModelsForImages(targetModel)
                : getFallbackModels(targetModel);
              let fallbackSuccess = false;
              
              for (const fallbackModel of fallbacks) {
                try {
                  console.log(`[Fallback] ${targetModel} hit rate limit. Trying ${fallbackModel}...`);
                  response = await activeAi.models.generateContent({
                    model: fallbackModel,
                    contents: loadedImages.length > 0
                ? [...loadedImages.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })), prompt]
                : prompt,
                    config: getModelGenerationConfig(fallbackModel, baseGenerateConfig)
                  });
                  actualModelUsed = fallbackModel;
                  fallbackSuccess = true;
                  console.log(`[Fallback] Successfully fell back to ${fallbackModel}`);
                  break;
                } catch (fallbackError: any) {
                  console.warn(`[Fallback] ${fallbackModel} failed:`, fallbackError.message || fallbackError);
                  // Retry without thinkingConfig in case model rejected thinkingConfig (400)
                  try {
                    const noThinking = { ...baseGenerateConfig };
                    delete noThinking.thinkingConfig;
                    response = await activeAi.models.generateContent({
                      model: fallbackModel,
                      contents: loadedImages.length > 0
                ? [...loadedImages.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })), prompt]
                : prompt,
                      config: noThinking
                    });
                    actualModelUsed = fallbackModel;
                    fallbackSuccess = true;
                    console.log(`[Fallback] Successfully fell back to ${fallbackModel} (standard config)`);
                    break;
                  } catch (retryErr: any) {
                    console.warn(`[Fallback] ${fallbackModel} standard config also failed:`, retryErr.message || retryErr);
                  }
                  // Continue to next fallback in chain
                }
              }
              
              if (!fallbackSuccess) {
                throw new Error(`All models in fallback chain exhausted. Original error: ${apiError.message}`);
              }
            } else {
              throw apiError;
            }
          }
          responseText = response.text || '{}';
          success = true;
        }

        if (success) {
          console.log(`[Rotation] LLM call succeeded with key index ${currentIdx} (${masked})`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.error(`[Rotation] Error with key index ${currentIdx} (${masked}):`, err.message || err);
      }
    }

    if (!success) {
      throw lastError || new Error("All API keys in the pool failed to generate content.");
    }

    let data;
    let cleanText = (responseText || '{}').trim();
    try {
      // 1. Strip thought/reasoning tags (including unclosed tags)
      cleanText = cleanText.replace(/<(thought|thinking|reasoning|cot)>[\s\S]*?<\/\1>/gi, '');
      cleanText = cleanText.replace(/<(thought|thinking|reasoning|cot)>[\s\S]*/gi, '');
      cleanText = cleanText.trim();
      
      // 2. Strip markdown code blocks
      let jsonText = cleanText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      
      // 3. Extract JSON object boundary
      let objStart = -1;
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      for (let ci = 0; ci < jsonText.length; ci++) {
        const ch = jsonText[ci];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === '\\' && inString) { escapeNext = true; continue; }
        if (ch === '"' && !escapeNext) { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') {
          if (depth === 0) objStart = ci;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && objStart !== -1) {
            jsonText = jsonText.substring(objStart, ci + 1);
            break;
          }
        }
      }
      
      data = JSON.parse(jsonText || '{}');
      const safeData: any = {
        reply: data.reply || data.response || data.answer || '',
        escalation: data.escalation || null,
        suggestions: data.suggestions || [],
        image_descriptions: Array.isArray(data.image_descriptions) ? data.image_descriptions : []
      };
      data = safeData;
    } catch (parseError) {
      console.error('Failed to parse LLM response as JSON:', responseText);
      let fallbackReply = '';
      let fallbackSuggestions: any[] = [];
      let fallbackEscalation: any = null;
      let fallbackImageDescriptions: any[] = [];
      try {
        // Try closed reply first
        const replyMatch = cleanText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (replyMatch) {
          fallbackReply = replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        } else {
          // If truncated / unclosed quote, extract up to next key or end
          const unclosedMatch = cleanText.match(/"reply"\s*:\s*"([\s\S]*?)(?:",\s*"suggestions"|"$|$)/);
          if (unclosedMatch) {
            fallbackReply = unclosedMatch[1]
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\t/g, '\t');
          }
        }
        const sugMatch = cleanText.match(/"suggestions"\s*:\s*(\[[\s\S]*?\])(?:\s*\}|$)/);
        if (sugMatch) {
          try { fallbackSuggestions = JSON.parse(sugMatch[1]); } catch {}
        }
        const escMatch = cleanText.match(/"escalation"\s*:\s*(\{[^}]*\})/);
        if (escMatch) {
          try { fallbackEscalation = JSON.parse(escMatch[1]); } catch {}
        }
        const imgDescMatch = cleanText.match(/"image_descriptions"\s*:\s*(\[[\s\S]*?\])(?:\s*\}|$)/);
        if (imgDescMatch) {
          try { fallbackImageDescriptions = JSON.parse(imgDescMatch[1]); } catch {}
        }
      } catch {}

      // Clean up fallbackReply if it looks like raw JSON
      if (!fallbackReply && cleanText) {
        fallbackReply = cleanText
          .replace(/^\s*\{\s*"reply"\s*:\s*"/i, '')
          .replace(/"\s*,?\s*"suggestions"[\s\S]*$/i, '')
          .replace(/"\s*\}?\s*$/i, '')
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"');
      }

      data = {
        reply: fallbackReply || 'Анализирую контекст.',
        escalation: fallbackEscalation,
        suggestions: fallbackSuggestions,
        image_descriptions: fallbackImageDescriptions
      };
    }

    // Auto-extract customer draft into suggestions if suggestions is empty but reply contains :::writing block
    if ((!data.suggestions || data.suggestions.length === 0) && data.reply && data.reply.includes(':::writing')) {
      const writingBlockMatch = data.reply.match(/:::writing\{[^}]*\}\s*([\s\S]*?)\s*:::/i);
      if (writingBlockMatch && writingBlockMatch[1].trim()) {
        data.suggestions = [{
          title: "Ответ клиенту",
          text: formatCustomerDraft(writingBlockMatch[1].trim(), effectiveCaseNumber, isFirstResponse),
          type: "Draft"
        }];
        data.reply = data.reply.replace(/:::writing\{[^}]*\}\s*[\s\S]*?\s*:::/gi, '').trim();
      }
    }

    // Strip any residual :::writing tags or leaked JSON quotes from operator reply
    if (data.reply) {
      data.reply = data.reply
        .replace(/:::writing\{[^}]*\}[\r\n]*/gi, '')
        .replace(/:::[\w-]*[\r\n]*/gi, '')
        .replace(/[\r\n]*:::/g, '')
        .trim();
    }

    logAnalytics('chat_request', { ticketId: actualTicketContext?.id, latencyMs: Date.now() - reqStart });

    // Handle inline classification if operator asked to classify
    let inlineClassification: any = null;
    const isClassificationQuery = /классифи|classify|категори/i.test(userQuery || '');
    if (isClassificationQuery && actualTicketContext?.id && actualTicketContext?.subject) {
      try {
        const classResult = await classifyTicket(
          actualTicketContext.id,
          actualTicketContext.subject,
          actualTicketContext.description || '',
          actualTicketContext.messages || []
        );
        if (classResult && Object.keys(classResult.fields).length > 0) {
          const readable: Record<string, string> = {};
          for (const [fieldId, value] of Object.entries(classResult.fields)) {
            const meta = CLASSIFICATION_FIELDS[fieldId as keyof typeof CLASSIFICATION_FIELDS];
            if (meta) {
              readable[meta.title] = meta.options ? (meta.options[value] || `unknown(${value})`) : value;
            }
          }
          const pushRes = await pushClassificationToOmnidesk(actualTicketContext.id, classResult.fields, staffEmail);
          inlineClassification = {
            fields: classResult.fields,
            readable,
            reasoning: classResult.reasoning,
            pushed: pushRes.success,
            pushError: pushRes.error
          };
        }
      } catch (classErr) {
        console.warn('[Chat] Inline classification error:', classErr);
      }
    }

    // Trigger auto-classification in background if ticket context is present
    if (actualTicketContext?.id && actualTicketContext?.subject) {
      const msgs = actualTicketContext.messages || [];
      autoClassifyTicket(
        actualTicketContext.id,
        actualTicketContext.subject,
        actualTicketContext.description || '',
        msgs,
        staffEmail
      ).catch(err => console.error('[Classify] Background auto-classify error:', err));
    }

    // ─── Escalation Note Processing (support-escalation) ───────────────────────────
    // When the support-escalation skill is used and prepares a comment for the employee,
    // this comment must also be left as an internal note in Omnidesk.
    // If escalation is required, the note must state "Что есть" and "Чего не хватает".
    let escalationResult: {
      used: boolean;
      required: boolean;
      notePushed?: boolean;
      noteError?: string;
      noteContent?: string;
    } | null = null;

    let isEscalationUsed = Boolean(data.escalation && data.escalation.used);
    let isEscalationRequired = Boolean(data.escalation && data.escalation.required);
    let escalationNoteContent = (data.escalation && typeof data.escalation.note_content === 'string')
      ? data.escalation.note_content.trim()
      : '';

    const explicitEscalationRequested = /(?:эскалируй|эскалаци|переда(?:й|ть)\s+(?:в\s+)?(?:разработк|продукт|пресейл|коммерци|сц|отдел\s+продаж)|состав(?:ь|ить)\s+заметк)/i.test(userQuery || '');
    const negativeEscalation = /(?:эскалаци[яи]|передача).*?(?:не\s+требуется|не\s+нужна|нет)|эскалация:\s*нет|готовность эскалации:\s*не\s+требуется/i.test(data.reply || '');

    if (negativeEscalation && !explicitEscalationRequested) {
      isEscalationRequired = false;
    }

    // Fallback heuristic detection if LLM did not explicitly populate the escalation JSON object:
    if (!isEscalationUsed && data.reply) {
      const explicitNeedInReply = /(?:эскалаци[яи]|передача).*?требуется:\s*(?:да|нужно|подтвердить)|готовность эскалации:\s*готова|(?:требуется|необходима)\s+(?:срочная\s+)?эскалаци/i.test(data.reply);
      if (explicitNeedInReply || explicitEscalationRequested) {
        isEscalationUsed = true;
        isEscalationRequired = true;
        escalationNoteContent = data.reply;
      }
    }

    // SCENARIO A: Note is generated and posted to Omnidesk ONLY AND EXCLUSIVELY when escalation IS REQUIRED!
    if (isEscalationRequired && escalationNoteContent.trim().length > 0) {
      escalationResult = {
        used: true,
        required: true,
        noteContent: escalationNoteContent
      };

      if (actualTicketContext?.id) {
        const caseId = String(actualTicketContext.id);
        const noteHash = `${caseId}:${escalationNoteContent.trim()}`;
        const lastNote = recentEscalationNotes.get(caseId);
        const now = Date.now();

        if (lastNote && lastNote.hash === noteHash && (now - lastNote.timestamp) < 60000) {
          console.log(`[Escalation Note] Skipping duplicate note for case ${caseId}`);
          escalationResult.notePushed = true;
        } else {
          try {
            console.log(`[Escalation Note] Escalation REQUIRED! Adding note to Omnidesk case ${caseId}`);
            const noteRes = await addOmnideskNote(caseId, escalationNoteContent, staffEmail);
            if (noteRes.success) {
              escalationResult.notePushed = true;
              recentEscalationNotes.set(caseId, { hash: noteHash, timestamp: now });
              logAnalytics('api_call', {
                endpoint: '/escalation/note',
                caseId,
                required: true,
                success: true
              });
            } else {
              escalationResult.notePushed = false;
              escalationResult.noteError = noteRes.error;
              console.warn(`[Escalation Note] Failed to add note for case ${caseId}:`, noteRes.error);
            }
          } catch (noteErr: any) {
            escalationResult.notePushed = false;
            escalationResult.noteError = noteErr.message;
            console.error(`[Escalation Note] Exception adding note to case ${caseId}:`, noteErr);
          }
        }
      }
    } else {
      // Escalation NOT required: DO NOT POST ANY NOTE TO OMNIDESK!
      escalationResult = {
        used: isEscalationUsed,
        required: false,
        noteContent: ''
      };
    }

    // Record recognized image descriptions for newly analyzed images
    if (loadedImages.length > 0) {
      for (const img of loadedImages) {
        const foundDesc = Array.isArray(data.image_descriptions)
          ? data.image_descriptions.find((d: any) =>
              d && (d.fileName === img.fileName || d.fileName === img.file_name || d.file_name === img.fileName)
            )
          : null;
        const visualDescription = (foundDesc?.description || foundDesc?.visualDescription || data.reply || '').trim();

        recordRecognizedImage({
          fileId: img.fileId || img.file_id,
          url: img.url,
          fileName: img.fileName,
          fileSize: img.sizeBytes,
          hash: img.hash,
          caseNumber: effectiveCaseNumber,
          recognizedAt: new Date().toISOString(),
          visualDescription
        });
      }
    }

    const finalReply = data.reply || "Анализирую контекст.";
    const finalSuggestions = (data.suggestions || []).map((s: any) => ({
      id: Math.random().toString(36).substr(2, 5),
      title: s.title || "Draft",
      text: formatCustomerDraft(s.text || '', effectiveCaseNumber, isFirstResponse),
      type: s.type || "Draft",
      model: actualModelUsed,
      confidence: 0.9,
      created_at: new Date().toISOString()
    }));

    const effectiveCaseId = actualTicketContext?.id ? String(actualTicketContext.id).trim() : undefined;
    const saveCaseKey = effectiveCaseNumber || effectiveCaseId || 'OMNIDESK_ACTIVE_TICKET';

    addTicketConversationMessage(saveCaseKey, {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      role: 'assistant',
      staffEmail: staffEmail || undefined,
      userQuery: userQuery || undefined,
      replyText: finalReply,
      suggestions: finalSuggestions,
      escalation: escalationResult || undefined,
      classification: inlineClassification || undefined,
      imagesAnalyzed: loadedImages.length,
      imagesCached: alreadyRecognizedImages.length
    }, effectiveCaseId);

    res.json({
      reply: finalReply,
      actual_model: actualModelUsed,
      fallback_used: actualModelUsed !== settings.model_name,
      images_analyzed: loadedImages.length,
      image_files: loadedImages.map(i => i.fileName),
      images_cached: alreadyRecognizedImages.length,
      cached_image_files: alreadyRecognizedImages.map(i => i.fileName),
      classification: inlineClassification,
      escalation: escalationResult,
      suggestions: finalSuggestions,
      case_number: effectiveCaseNumber || undefined,
      case_id: effectiveCaseId || undefined,
      labels: actualTicketContext?.labels || [],
      has_presale_label: Boolean(actualTicketContext?.has_presale_label)
    });
  } catch (error: any) {
    console.error("AI Generation Error:", error);
    logAnalytics('chat_request', { ticketId: actualTicketContext?.id, latencyMs: Date.now() - reqStart, error: true });
    res.status(500).json({ error: error.message });
  }
});

// Analytics API
app.get("/api/analytics", requireAuth, (req, res) => {
  res.json(analyticsLogs);
});

// Client-side analytics events from widget.
// Whitelist actions so this endpoint can only log known event types.
app.post("/api/analytics/event", requireWidgetAuth, (req, res) => {
  const allowed = ['suggestion_applied', 'suggestion_rejected'];
  const { action, metadata } = req.body || {};
  if (!allowed.includes(action)) return res.status(400).json({ error: 'invalid action' });
  logAnalytics(action, metadata || {});
  res.json({ ok: true });
});

// Omnidesk JS Widget
app.get("/api/omnidesk/widget.js", (req, res) => {
  const widgetUrl = `${req.protocol}://${req.get('host')}/?mode=widget`;
  const jsContent = `
(function() {
  console.log('OmniAI Widget: Script loaded');
  
  function initWidget() {
    if (document.getElementById('omniai-widget-container')) {
      return true; // Already initialized
    }
    
    // Try to find the ticket response area to inject below it
    var renderTarget = document.getElementById('reply_wrapper') ||
                       document.querySelector('.reply-wrapper') ||
                       document.getElementById('reply_block') ||
                       document.getElementById('msg_form') ||
                       document.querySelector('.msg-form') ||
                       document.getElementById('response_answer_area') || 
                       document.querySelector('.request-area') || 
                       document.querySelector('#case_message_area') ||
                       document.querySelector('.case-content');
    
    if (renderTarget) {
      console.log('OmniAI Widget: Found target container, injecting iframe');
      var container = document.createElement('div');
      container.id = 'omniai-widget-container';
      container.style.marginTop = '20px';
      container.style.marginBottom = '40px';
      container.style.width = '100%';
      container.style.clear = 'both';
      
      var iframe = document.createElement('iframe');
      iframe.src = '${widgetUrl}';
      iframe.style.width = '100%';
      iframe.style.height = '600px';
      iframe.style.border = 'none';
      iframe.style.display = 'block';
      iframe.style.borderRadius = '12px';
      iframe.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
      
      container.appendChild(iframe);
      
      // Insert after the target if possible
      if (renderTarget.parentNode) {
          renderTarget.parentNode.insertBefore(container, renderTarget.nextSibling);
      } else {
          renderTarget.appendChild(container);
      }
      return true;
    }
    
    return false;
  }

  // Attempt immediately
  if (!initWidget()) {
    console.log('OmniAI Widget: Target not found yet, starting polling...');
    // If not found, poll the DOM (for SPAs or async loading)
    var attempts = 0;
    var interval = setInterval(function() {
      attempts++;
      if (initWidget() || attempts > 20) { // Try for 10 seconds (20 * 500ms)
        if (attempts > 20 && !document.getElementById('omniai-widget-container')) {
           console.log('OmniAI Widget: Giving up on finding target, injecting to body');
           var bodyTarget = document.body;
           if(bodyTarget) {
               // Fallback: just append it somewhere visible
               var container = document.createElement('div');
               container.id = 'omniai-widget-container';
               container.style.position = 'fixed';
               container.style.bottom = '20px';
               container.style.right = '20px';
               container.style.width = '400px';
               container.style.height = '600px';
               container.style.zIndex = '999999';
               container.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';
               container.style.borderRadius = '12px';
               container.style.overflow = 'hidden';
               container.style.backgroundColor = '#ffffff';
               
               var iframe = document.createElement('iframe');
               iframe.src = '${widgetUrl}';
               iframe.style.width = '100%';
               iframe.style.height = '100%';
               iframe.style.border = 'none';
               
               container.appendChild(iframe);
               bodyTarget.appendChild(container);
           }
        }
        clearInterval(interval);
      }
    }, 500);
  }
})();
`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(jsContent);
});

// Settings API
const maskedSettingsPatch = () => {
  const effectiveKey = settings.api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";
  return {
    api_key: maskSecretField(effectiveKey),
    api_key_pool: maskSecretField(settings.api_key_pool || ""),
    omnidesk_api_key: maskSecretField(settings.omnidesk_api_key || ""),
    bookstack_token_secret: maskSecretField(settings.bookstack_token_secret || "")
  };
};

app.get("/api/settings", requireWidgetAuth, (req, res) => {
  res.json({
    ...settings,
    ...maskedSettingsPatch()
  });
});

app.post("/api/settings", requireAuth, (req, res) => {
  const previousEffectiveKey = settings.api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

  // The client only ever sees masked secrets (see GET /api/settings). If a
  // field comes back unchanged - i.e. it still holds the mask we sent - the
  // user didn't edit it, so don't clobber the real stored secret with the
  // masked placeholder. Only fields the user actually retyped go through.
  const incoming: Record<string, any> = { ...req.body };
  const currentMasked = maskedSettingsPatch();
  for (const field of SECRET_SETTINGS_FIELDS) {
    if (field in incoming && incoming[field] === (currentMasked as any)[field]) {
      delete incoming[field];
    }
  }

  settings = { ...settings, ...incoming };

  if (settings.api_key === process.env.GEMINI_API_KEY || settings.api_key === process.env.VITE_GEMINI_API_KEY) {
    settings.api_key = "";
  }

  const effectiveKey = settings.api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

  if (effectiveKey !== previousEffectiveKey || !ai) {
    ai = new GoogleGenAI({
      apiKey: effectiveKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
  }
  saveData();
  logAnalytics('api_call', { endpoint: '/api/settings', method: 'POST' });
  res.json({ status: "ok", settings: { ...settings, ...maskedSettingsPatch() } });
});

// Knowledge Base API
app.get("/api/knowledge-base", requireAuth, (req, res) => {
  res.json(knowledgeBase);
});

// Helper to extract a human-readable skill name from content or url
function extractSkillName(url: string, content: string): string {
  let name = url.split('?')[0].split('/').pop() || 'Unknown Skill';
  const yamlNameMatch = content.match(/(?:^|\n)name:\s*"?([^"\n\r]+)"?/);
  const firstHeadingMatch = content.match(/^#\s+([^\n\r]+)/m);

  if (yamlNameMatch && yamlNameMatch[1].trim()) {
    name = yamlNameMatch[1].trim();
  } else if (firstHeadingMatch && firstHeadingMatch[1].trim()) {
    name = firstHeadingMatch[1].trim();
  } else if (name.toLowerCase() === 'skill.md' || name.toLowerCase() === 'skill.json') {
    const parts = url.split('?')[0].split('/');
    if (parts.length > 1) {
      name = parts[parts.length - 2];
    }
  }
  return name;
}

// Admin Skill Import API
app.post("/api/admin/skills/import", requireAuth, async (req, res) => {
  const { url, type } = req.body;
  logAnalytics('api_call', { endpoint: '/api/admin/skills/import', url, type });

  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'OmniAI-App' } });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
    
    const content = await response.text();
    
    let currentSkills = [];
    try {
      currentSkills = JSON.parse(settings.skills || "[]");
    } catch {
      currentSkills = [];
    }

    const name = extractSkillName(url, content);

    const newSkill = {
      id: Math.random().toString(36).substr(2, 5),
      name: name,
      content: content,
      enabled: true,
      source: url,
      imported_at: new Date().toISOString()
    };

    currentSkills.push(newSkill);
    const updatedSkills = JSON.stringify(currentSkills, null, 2);
    settings.skills = updatedSkills;
    saveData();
    
    res.json({ skills: updatedSkills, importedCount: 1, name });
  } catch (error: any) {
    console.error("Import Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin Repo Skills Fetch API
app.post("/api/admin/skills/repo", requireAuth, async (req, res) => {
  const { url } = req.body;
  try {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      // If it's not a GitHub repo, try to fetch it as a custom catalog (e.g., Nvidia NIM or custom JSON)
      const catRes = await fetch(url);
      if (catRes.ok) {
        const data = await catRes.json();
        const items = Array.isArray(data) ? data : (data.files || data.skills || data.models || []);
        
        if (items && items.length > 0) {
          const files = items.map((item: any) => ({
            path: item.name || item.path || item.id,
            url: item.url || item.download_url || url + '/' + (item.id || item.path)
          }));
          return res.json({ files, owner: 'custom', repo: 'catalog', branch: 'main' });
        }
      }
      return res.status(400).json({ error: "Invalid GitHub URL or Unsupported Catalog Format" });
    }
    const [, owner, repoName] = match;
    const repo = repoName.replace(/\.git$/, '');
    
    let apiReq = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`, {
      headers: { 'User-Agent': 'OmniAI-App' }
    });
    let branch = 'main';
    
    if (!apiReq.ok) {
      apiReq = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/master?recursive=1`, {
        headers: { 'User-Agent': 'OmniAI-App' }
      });
      branch = 'master';
      if (!apiReq.ok) {
         return res.status(400).json({ error: "Could not fetch repository tree" });
      }
    }
    
    const data = await apiReq.json();
    const files = (data.tree || []).filter((t: any) => {
      if (t.type !== 'blob') return false;
      if (!t.path.endsWith('.md') && !t.path.endsWith('.json')) return false;

      const lowerPath = t.path.toLowerCase();
      return lowerPath.includes('/skills/') ||
             lowerPath.startsWith('skills/') ||
             lowerPath.endsWith('skill.md') ||
             lowerPath.endsWith('skill.json');
    }).slice(0, 200);

    res.json({ files, owner, repo, branch });
  } catch(error: any) {
    console.error("Repo Fetch Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin Repo Skills Batch Import API
app.post("/api/admin/skills/import-batch", requireAuth, async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Ни один навык не был импортирован", failedCount: 0, errors: ["No URLs provided"] });
  }

  try {
    let currentSkills = [];
    try {
      currentSkills = JSON.parse(settings.skills || "[]");
    } catch {
      currentSkills = [];
    }

    let importedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const url of urls) {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'OmniAI-App' } });
        if (response.ok) {
          const content = await response.text();
          const name = extractSkillName(url, content);

          currentSkills.push({
            id: Math.random().toString(36).substr(2, 5),
            name: name,
            content: content,
            enabled: true,
            source: url,
            imported_at: new Date().toISOString()
          });
          importedCount++;
        } else {
          failedCount++;
          errors.push(`${url}: ${response.statusText || response.status}`);
        }
      } catch (err: any) {
        console.error(`Failed to fetch ${url}`, err);
        failedCount++;
        errors.push(`${url}: ${err.message}`);
      }
    }

    if (importedCount === 0) {
      return res.status(400).json({ error: "Ни один навык не был импортирован", failedCount, errors });
    }

    const updatedSkills = JSON.stringify(currentSkills, null, 2);
    settings.skills = updatedSkills;
    saveData();
    res.json({ skills: updatedSkills, importedCount, failedCount, errors });
  } catch (error: any) {
    console.error("Batch Import Error:", error);
    res.status(500).json({ error: error.message });
  }
});


// Admin BookStack Sync API
app.post("/api/admin/bookstack/sync", requireAuth, async (req, res) => {
  const { url, id } = req.body;
  // The Admin UI only ever displays the masked form of bookstack_token_secret
  // (see /api/settings). If the user didn't retype it, req.body.secret will
  // still be that masked placeholder - fall back to the real stored secret
  // instead of authenticating against BookStack with the mask itself.
  let secret = req.body.secret;
  if (secret === maskSecretField(settings.bookstack_token_secret || "")) {
    secret = settings.bookstack_token_secret;
  }
  logAnalytics('api_call', { endpoint: '/api/admin/bookstack/sync', url });

  if (!url || !id || !secret) {
    return res.status(400).json({ error: "Missing BookStack credentials" });
  }

  try {
    let allPages: any[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    // Fetch all pages (pagination) but DO NOT fetch full HTML/Markdown content
    while (hasMore) {
      const response = await fetch(`${url.replace(/\/$/, '')}/api/pages?count=${limit}&offset=${offset}`, {
        headers: {
          'Authorization': `Token ${id}:${secret}`
        }
      });

      if (!response.ok) throw new Error(`BookStack Error: ${response.statusText}`);
      
      const data = await response.json();
      const pagesList = data.data || [];
      allPages = allPages.concat(pagesList);
      
      if (offset + limit >= (data.total || 0) || pagesList.length === 0) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }
    
    // Remove old bookstack items from local KB
    knowledgeBase.splice(0, knowledgeBase.length, ...knowledgeBase.filter(item => !item.tags.includes('bookstack')));
    
    // Pre-fetch all books to build a map of book_id -> book_slug
    const bookIdToSlug: Record<number, string> = {};
    try {
      let booksOffset = 0;
      let booksLimit = 100;
      let hasMoreBooks = true;
      while (hasMoreBooks) {
        const booksResponse = await fetch(`${url.replace(/\/$/, '')}/api/books?count=${booksLimit}&offset=${booksOffset}`, {
          headers: {
            'Authorization': `Token ${id}:${secret}`
          }
        });
        if (!booksResponse.ok) {
          console.error(`Failed to fetch BookStack books: ${booksResponse.statusText}`);
          break;
        }
        const booksData = await booksResponse.json();
        const booksList = booksData.data || [];
        for (const book of booksList) {
          if (book.id && book.slug) {
            bookIdToSlug[book.id] = book.slug;
          }
        }
        if (booksOffset + booksLimit >= (booksData.total || 0) || booksList.length === 0) {
          hasMoreBooks = false;
        } else {
          booksOffset += booksLimit;
        }
      }
    } catch (err) {
      console.error("Error pre-fetching BookStack books for slug map:", err);
    }

    // Store lightweight indices (title + link only)
    for (const page of allPages) {
      let pageUrl = '';
      const bookSlug = bookIdToSlug[page.book_id];
      if (bookSlug) {
        pageUrl = `${url.replace(/\/$/, '')}/books/${bookSlug}/page/${page.slug || page.id}`;
      } else if (page.url) {
        try {
          const urlObj = new URL(page.url);
          pageUrl = `${url.replace(/\/$/, '')}${urlObj.pathname}`;
        } catch (e) {
          const path = page.url.startsWith('/') ? page.url : `/${page.url}`;
          pageUrl = `${url.replace(/\/$/, '')}${path}`;
        }
      } else {
        pageUrl = `${url.replace(/\/$/, '')}/books/${page.book_id}/page/${page.slug || page.id}`;
      }

      knowledgeBase.push({
        id: `bookstack-${page.id}`,
        title: page.name,
        content: `BookStack Article ID: ${page.id}. Read more at: ${pageUrl}`,
        tags: ['bookstack']
      });
    }
    
    saveData();
    
    res.json({ 
      success: true, 
      count: allPages.length,
      message: `Successfully indexed ${allPages.length} articles from BookStack. Full content will be fetched dynamically via RAG.`
    });
  } catch (error: any) {
    console.error("BookStack Sync Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Omnidesk ticket learning endpoint
app.post("/api/admin/tickets/learn", requireAuth, async (req, res) => {
  const { periodDays = 30, limit = 5 } = req.body;
  logAnalytics('api_call', { endpoint: '/api/admin/tickets/learn', periodDays, limit });

  const hasConfig = settings.omnidesk_domain && settings.omnidesk_api_key && settings.omnidesk_email;

  if (!hasConfig) {
    // Demo / Fallback Mode when Omnidesk is not configured
    console.log("[Ticket Learning] Omnidesk not configured. Running in Demo Mode.");
    
    const demoTickets = [
      {
        id: "demo-t1",
        subject: "Проблема с подключением к SCADA серверу",
        messages: [
          { role: "CLIENT", text: "Здравствуйте! Не могу подключиться к SCADA серверу со смартфона. Пишет ошибку Connection Refused. На самом сервере всё запущено." },
          { role: "STAFF", text: "Добрый день! Проверьте, разрешен ли порт 8000 (или тот, который вы указали в настройках) в брандмауэре операционной системы сервера. Также убедитесь, что смартфон находится в той же локальной сети, либо настроен проброс портов на роутере." },
          { role: "CLIENT", text: "Да, действительно брандмауэр блокировал порт 8000. Отключил или добавил правило — теперь всё подключается моментально! Спасибо!" }
        ]
      },
      {
        id: "demo-t2",
        subject: "Сброс пароля от учетной записи девелопера",
        messages: [
          { role: "CLIENT", text: "Привет! Забыл пароль от кабинета разработчика. Ссылка на сброс не приходит на почту dev@company.com. Что делать?" },
          { role: "STAFF", text: "Приветствую! Проверьте папку 'Спам' или 'Рассылки'. Если письма там нет, возможно ваш почтовый сервер блокирует наши домены example.com. Мы отправили вам временный пароль вручную. Смените его в профиле сразу после входа." },
          { role: "CLIENT", text: "Нашел в спаме! Спасибо за оперативный ответ, временный пароль подошел, сменил на свой." }
        ]
      },
      {
        id: "demo-t3",
        subject: "Таймаут опроса Modbus устройств",
        messages: [
          { role: "CLIENT", text: "При опросе модулей Modbus RTU через шлюз контроллера часто возникают ошибки таймаута в логах. Период опроса стоит 100мс." },
          { role: "STAFF", text: "Здравствуйте! Период опроса 100мс слишком мал для шины RS-485, особенно если на ней висит несколько устройств. Рекомендуется увеличить период опроса (Poll Interval) до 500-1000мс и убедиться, что установлены согласующие резисторы 120 Ом на концах линии." },
          { role: "CLIENT", text: "Поставил 800мс и доставил терминаторы — ошибки полностью пропали! Спасибо за совет." }
        ]
      }
    ];

    const results = [];
    const pool = getApiKeysPool();
    
    for (const ticket of demoTickets) {
      try {
        const prompt = `
          Проанализируй следующий тикет поддержки и составь на его основе качественную статью для Базы Знаний.
          Статья должна содержать Краткое описание проблемы и Пошаговое решение.
          
          Тема тикета: ${ticket.subject}
          Диалог:
          ${ticket.messages.map(m => `${m.role}: ${m.text}`).join('\n')}
          
          Верни ответ в формате JSON:
          {
            "title": "Краткое техническое название проблемы",
            "content": "Подробное описание проблемы и пошаговая инструкция по решению."
          }
        `;
        
        let title = `Решение: ${ticket.subject}`;
        let content = ticket.messages.map(m => `${m.role}: ${m.text}`).join('\n\n');
        
        if (pool.length > 0) {
          try {
            const activeAi = new GoogleGenAI({ apiKey: pool[0] });
            const response = await activeAi.models.generateContent({
              model: settings.model_name,
              contents: prompt,
              config: { responseMimeType: 'application/json' }
            });
            const text = response.text || '{}';
            const parsed = JSON.parse(text);
            if (parsed.title) title = parsed.title;
            if (parsed.content) content = parsed.content;
          } catch (llmErr) {
            console.error("LLM Generation in Demo Learn failed, using local generation fallback:", llmErr);
          }
        }
        
        const newItem: KnowledgeBaseItem = {
          id: `learned-demo-${ticket.id}`,
          title: title,
          content: content,
          tags: ['learned-ticket', 'demo-case']
        };
        
        const existingIdx = knowledgeBase.findIndex(item => item.id === newItem.id);
        if (existingIdx !== -1) {
          knowledgeBase[existingIdx] = newItem;
        } else {
          knowledgeBase.push(newItem);
        }
        results.push(newItem);
      } catch (err) {
        console.error("Error analyzing demo ticket:", err);
      }
    }
    
    saveData();
    // Simulate real network delay for UX satisfaction
    await new Promise(resolve => setTimeout(resolve, 2000));
    return res.json({ success: true, count: results.length, isDemo: true, items: results });
  }

  // Real Omnidesk integration mode
  try {
    const domain = settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const auth = Buffer.from(`${settings.omnidesk_email}:${settings.omnidesk_api_key}`).toString('base64');

    console.log(`[Ticket Learning] Fetching cases from https://${domain}/api/cases.json`);
    const casesRes = await fetch(`https://${domain}/api/cases.json?limit=50`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!casesRes.ok) {
      const errText = await casesRes.text();
      throw new Error(`Omnidesk API returned ${casesRes.status}: ${errText}`);
    }

    const casesData = await casesRes.json();
    let casesArray: any[] = [];
    if (Array.isArray(casesData)) {
      casesArray = casesData;
    } else if (typeof casesData === 'object' && casesData !== null) {
      casesArray = Object.values(casesData).filter((v: any) => v && v.case);
    }

    // Filter closed/resolved cases
    const eligibleCases = casesArray
      .map((c: any) => c.case || c)
      .filter((c: any) => {
        const isResolved = c.status === 'resolved' || c.status === 'closed';
        if (!isResolved) return false;
        
        // Filter by date
        const createdAt = new Date(c.created_at);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - periodDays);
        return createdAt >= cutoffDate;
      })
      .slice(0, limit); // Respect limit

    console.log(`[Ticket Learning] Found ${eligibleCases.length} eligible resolved cases within ${periodDays} days.`);

    const results = [];
    const pool = getApiKeysPool();

    for (const kase of eligibleCases) {
      const caseId = kase.case_id;
      const caseNumber = kase.case_number;
      
      // Fetch messages
      const msgsRes = await fetch(`https://${domain}/api/cases/${caseId}/messages.json`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      if (!msgsRes.ok) continue;

      const msgsData = await msgsRes.json();
      let msgsArray: any[] = [];
      if (Array.isArray(msgsData)) {
        msgsArray = msgsData;
      } else if (msgsData._embedded?.messages) {
        msgsArray = msgsData._embedded.messages;
      } else if (typeof msgsData === 'object' && msgsData !== null) {
        msgsArray = Object.values(msgsData).filter((v: any) => v && (v.message || v));
      }

      const dialogue = msgsArray.map((m: any) => {
        const msg = m.message || m;
        const text = msg.content_html ? msg.content_html.replace(/<[^>]+>/g, '') : (msg.content || '');
        return `${msg.user_id ? 'CLIENT' : 'STAFF'}: ${text}`;
      }).join('\n\n');

      let title = `Решение тикета #${caseNumber}: ${kase.subject}`;
      let content = dialogue;

      if (pool.length > 0 && dialogue.trim().length > 50) {
        try {
          const prompt = `
            Проанализируй диалог технической поддержки и сформируй на его основе полезную статью для Базы Знаний.
            Выдели ключевую проблему клиента и итоговое решение, которое помогло.
            Избегай лишней вежливости и приветствий, пиши кратко и по делу.
            
            Тема: ${kase.subject}
            История обращений:
            ${dialogue}
            
            Выведи строго валидный JSON в формате:
            {
              "title": "Понятное и емкое техническое название проблемы",
              "content": "Суть проблемы и конкретные шаги, которые привели к решению."
            }
          `;

          const activeAi = new GoogleGenAI({ apiKey: pool[0] });
          const response = await activeAi.models.generateContent({
            model: settings.model_name,
            contents: prompt,
            config: { responseMimeType: 'application/json' }
          });
          const text = response.text || '{}';
          const parsed = JSON.parse(text);
          if (parsed.title) title = parsed.title;
          if (parsed.content) content = parsed.content;
        } catch (err) {
          console.error(`[Ticket Learning] Failed to use LLM for case ${caseNumber}:`, err);
        }
      }

      const newItem: KnowledgeBaseItem = {
        id: `learned-ticket-${caseNumber}`,
        title: title,
        content: content,
        tags: ['learned-ticket', `case-${caseNumber}`]
      };

      // Push and update
      const existingIdx = knowledgeBase.findIndex(item => item.id === newItem.id);
      if (existingIdx !== -1) {
        knowledgeBase[existingIdx] = newItem;
      } else {
        knowledgeBase.push(newItem);
      }
      results.push(newItem);
    }

    saveData();
    res.json({ success: true, count: results.length, isDemo: false, items: results });
  } catch (error: any) {
    console.error("Real Ticket Learning Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/knowledge-base", requireAuth, (req, res) => {
  const newItem = { id: Math.random().toString(36).substr(2, 9), ...req.body };
  knowledgeBase.push(newItem);
  saveData();
  res.json(newItem);
});

app.post("/api/knowledge-base/scrape", requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText} (${response.status})`);
    }
    const html = await response.text();

    // Extract title from <title> tag
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : url;
    title = title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean html body content
    let bodyText = html;
    bodyText = bodyText.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '');
    bodyText = bodyText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '');
    bodyText = bodyText.replace(/<!--([\s\S]*?)-->/g, '');
    bodyText = bodyText.replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>|<\/tr>/gi, '\n');
    bodyText = bodyText.replace(/<[^>]*>/g, ' ');
    bodyText = bodyText
      .replace(/&nbsp;/g, ' ')
      .replace(/\r\n|\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n\n')
      .trim();

    // Limit length to avoid too large prompts
    const maxLen = 15000;
    const content = bodyText.length > maxLen ? bodyText.substring(0, maxLen) + "\n\n[Content truncated due to length limits...]" : bodyText;

    const newItem = {
      id: `link-${Math.random().toString(36).substr(2, 9)}`,
      title: title || `Imported URL: ${url}`,
      content: `Source Link: ${url}\n\n${content}`,
      tags: ['link', 'imported']
    };

    knowledgeBase.push(newItem);
    saveData();

    res.json(newItem);
  } catch (error: any) {
    console.error("Scraping Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/knowledge-base/:id", requireAuth, (req, res) => {
  const index = knowledgeBase.findIndex(item => item.id === req.params.id);
  if (index !== -1) {
    knowledgeBase[index] = { ...knowledgeBase[index], ...req.body };
    saveData();
    res.json(knowledgeBase[index]);
  } else {
    res.status(404).json({ error: "Item not found" });
  }
});

app.delete("/api/knowledge-base/:id", requireAuth, (req, res) => {
  const index = knowledgeBase.findIndex(item => item.id === req.params.id);
  if (index !== -1) {
    knowledgeBase.splice(index, 1);
    saveData();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Item not found" });
  }
});

// Export Reports (Simulated)
app.get("/api/export/csv", requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=analytics_report.csv');
  const csv = "timestamp,action,metadata\n" + 
    analyticsLogs.map(l => `${l.timestamp},${l.action},"${JSON.stringify(l.metadata).replace(/"/g, '""')}"`).join('\n');
  res.send(csv);
});

// Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    }));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export {
  app,
  startServer,
  requireWidgetAuth,
  verifyAndFetchOmnideskTicket,
  addOmnideskNote,
  settings,
  classifyTicket,
  applyClassificationBusinessRules,
  CLASSIFICATION_FIELDS,
  sanitizeCustomerDraft,
  formatCustomerDraft,
  detectFirstResponse
};
