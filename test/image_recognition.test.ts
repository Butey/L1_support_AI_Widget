import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  app,
  settings,
  loadTicketImageAttachments,
  SUPPORTED_IMAGE_MIMES,
  MAX_IMAGES_PER_REQUEST,
  IMAGE_MODEL_FALLBACK_CHAIN,
  getFallbackModelsForImages,
  selectModelForRequest,
  recognizedImagesCache,
  recordRecognizedImage,
  findInRecognizedCache,
  getAttachmentCacheKey,
  clearRecognizedImagesCache,
  loadRecognizedImages,
  saveRecognizedImages,
  RECOGNIZED_IMAGES_FILE,
  RecognizedImageRecord
} from '../server.ts';

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('Image Recognition Tests', () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    process.env.NODE_ENV = 'test';
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    clearRecognizedImagesCache();
    if (fs.existsSync(RECOGNIZED_IMAGES_FILE)) {
      try { fs.unlinkSync(RECOGNIZED_IMAGES_FILE); } catch {}
    }
  });

  it('SUPPORTED_IMAGE_MIMES whitelist', () => {
    assert.ok(SUPPORTED_IMAGE_MIMES.has('image/png'));
    assert.ok(SUPPORTED_IMAGE_MIMES.has('image/jpeg'));
    assert.ok(SUPPORTED_IMAGE_MIMES.has('image/webp'));
    assert.ok(SUPPORTED_IMAGE_MIMES.has('image/heic'));
    assert.ok(SUPPORTED_IMAGE_MIMES.has('image/heif'));
    
    assert.ok(!SUPPORTED_IMAGE_MIMES.has('image/gif'));
    assert.ok(!SUPPORTED_IMAGE_MIMES.has('image/svg+xml'));
    assert.ok(!SUPPORTED_IMAGE_MIMES.has('image/bmp'));
    assert.ok(!SUPPORTED_IMAGE_MIMES.has('application/pdf'));
  });

  it('loadTicketImageAttachments filters by MIME type', async () => {
    globalThis.fetch = async (url) => {
      return {
        ok: true,
        arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
      } as Response;
    };

    const attachments = [
      { message_attachment: { file_name: 'test.png', file_size: 100, content_url: 'http://test/1.png', mime_type: 'image/png' } },
      { message_attachment: { file_name: 'test.gif', file_size: 100, content_url: 'http://test/2.gif', mime_type: 'image/gif' } },
      { message_attachment: { file_name: 'test.pdf', file_size: 100, content_url: 'http://test/3.pdf', mime_type: 'application/pdf' } },
      { message_attachment: { file_name: 'test.jpeg', file_size: 100, content_url: 'http://test/4.jpeg', mime_type: 'image/jpeg' } },
    ];

    const result = await loadTicketImageAttachments(attachments as any);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].file_name, 'test.png');
    assert.strictEqual(result[1].file_name, 'test.jpeg');
  });

  it('loadTicketImageAttachments respects MAX_IMAGES_PER_REQUEST', async () => {
    globalThis.fetch = async (url) => {
      return {
        ok: true,
        arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
      } as Response;
    };

    const attachments = [];
    for (let i = 0; i < MAX_IMAGES_PER_REQUEST + 2; i++) {
      attachments.push({ message_attachment: { file_name: `test${i}.png`, file_size: 100, content_url: `http://test/${i}.png`, mime_type: 'image/png' } });
    }

    const result = await loadTicketImageAttachments(attachments as any);
    assert.strictEqual(result.length, MAX_IMAGES_PER_REQUEST);
    // Should take the LAST N images
    assert.strictEqual(result[0].file_name, `test2.png`);
    assert.strictEqual(result[MAX_IMAGES_PER_REQUEST - 1].file_name, `test${MAX_IMAGES_PER_REQUEST + 1}.png`);
  });

  it('loadTicketImageAttachments skips oversized files', async () => {
    globalThis.fetch = async (url) => {
      return {
        ok: true,
        arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
      } as Response;
    };

    const attachments = [
      { message_attachment: { file_name: 'small.png', file_size: 100, content_url: 'http://test/1.png', mime_type: 'image/png' } },
      { message_attachment: { file_name: 'large.png', file_size: 11 * 1024 * 1024, content_url: 'http://test/2.png', mime_type: 'image/png' } },
    ];

    const result = await loadTicketImageAttachments(attachments as any);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].file_name, 'small.png');
  });

  it('loadTicketImageAttachments handles fetch errors gracefully', async () => {
    globalThis.fetch = async (url) => {
      if (url.toString().includes('error')) {
        throw new Error('Network error');
      }
      return {
        ok: true,
        arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
      } as Response;
    };

    const attachments = [
      { message_attachment: { file_name: 'good1.png', file_size: 100, content_url: 'http://test/1.png', mime_type: 'image/png' } },
      { message_attachment: { file_name: 'error.png', file_size: 100, content_url: 'http://test/error.png', mime_type: 'image/png' } },
      { message_attachment: { file_name: 'good2.png', file_size: 100, content_url: 'http://test/2.png', mime_type: 'image/png' } },
    ];

    const result = await loadTicketImageAttachments(attachments as any);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].file_name, 'good1.png');
    assert.strictEqual(result[1].file_name, 'good2.png');
  });

  it('loadTicketImageAttachments normalizes image/jpg to image/jpeg', async () => {
    globalThis.fetch = async (url) => {
      return {
        ok: true,
        arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
      } as Response;
    };

    const attachments = [
      { message_attachment: { file_name: 'test.jpg', file_size: 100, content_url: 'http://test/1.jpg', mime_type: 'image/jpg' } },
    ];

    const result = await loadTicketImageAttachments(attachments as any);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'image/jpeg');
  });

  it('selectModelForRequest routes image requests directly to 3.5-flash-lite', () => {
    // Normal text requests stay with configured model
    assert.strictEqual(selectModelForRequest('gemini-3.8-flash', false), 'gemini-3.8-flash');
    assert.strictEqual(selectModelForRequest('gemini-3.7-flash', false), 'gemini-3.7-flash');

    // Image requests are routed immediately to gemini-3.5-flash-lite
    assert.strictEqual(selectModelForRequest('gemini-3.8-flash', true), 'gemini-3.5-flash-lite');
    assert.strictEqual(selectModelForRequest('gemini-3.7-flash', true), 'gemini-3.5-flash-lite');
    assert.strictEqual(selectModelForRequest('gemini-3.6-flash', true), 'gemini-3.5-flash-lite');

    // If 3.1-flash-lite was selected, stay with 3.1-flash-lite
    assert.strictEqual(selectModelForRequest('gemini-3.1-flash-lite', true), 'gemini-3.1-flash-lite');

    // Custom models are respected
    assert.strictEqual(selectModelForRequest('custom-vision-model', true, true), 'custom-vision-model');
  });

  it('getFallbackModelsForImages starts from lightweight models', () => {
    assert.strictEqual(IMAGE_MODEL_FALLBACK_CHAIN[0], 'gemini-3.5-flash-lite');
    assert.strictEqual(IMAGE_MODEL_FALLBACK_CHAIN[1], 'gemini-3.1-flash-lite');

    const fallbacksFrom35Lite = getFallbackModelsForImages('gemini-3.5-flash-lite');
    assert.strictEqual(fallbacksFrom35Lite[0], 'gemini-3.1-flash-lite');
    assert.strictEqual(fallbacksFrom35Lite[1], 'gemini-3.5-flash');
  });

  it('saves and finds recognized images in cache by file_id, url, hash, and composite key', () => {
    clearRecognizedImagesCache();

    const sampleRecord: RecognizedImageRecord = {
      fileId: 101,
      url: 'https://omnidesk.ru/att/101.png',
      fileName: 'screenshot_error.png',
      fileSize: 2048,
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      caseNumber: '5555',
      recognizedAt: new Date().toISOString(),
      visualDescription: 'Error 404: Device offline on floor 2'
    };

    recordRecognizedImage(sampleRecord);

    // 1. Find by file_id (both number and object variants)
    const byFileId = findInRecognizedCache({ file_id: 101 });
    assert.ok(byFileId);
    assert.strictEqual(byFileId.visualDescription, 'Error 404: Device offline on floor 2');
    assert.strictEqual(findInRecognizedCache({ fileId: '101' })?.fileName, 'screenshot_error.png');

    // 2. Find by url
    const byUrl = findInRecognizedCache({ url: 'https://omnidesk.ru/att/101.png' });
    assert.ok(byUrl);
    assert.strictEqual(byUrl.visualDescription, 'Error 404: Device offline on floor 2');

    // 3. Find by hash
    const byHash = findInRecognizedCache({ hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    assert.ok(byHash);
    assert.strictEqual(byHash.fileId, 101);

    // 4. Find by composite key (caseNumber + fileName + fileSize)
    const byComposite = findInRecognizedCache({ file_name: 'screenshot_error.png', file_size: 2048 }, '5555');
    assert.ok(byComposite);
    assert.strictEqual(byComposite.visualDescription, 'Error 404: Device offline on floor 2');

    // 5. Test getAttachmentCacheKey priorities
    assert.strictEqual(getAttachmentCacheKey({ file_id: 101 }), 'id_101');
    assert.strictEqual(getAttachmentCacheKey({ file_name: 'test.png', file_size: 500 }, '1234'), 'case_1234_test.png_500');
    assert.strictEqual(getAttachmentCacheKey({ url: 'https://example.com/img.png' }), 'url_https://example.com/img.png');
    assert.strictEqual(getAttachmentCacheKey({ hash: 'abcd1234ef' }), 'hash_abcd1234ef');
  });

  it('skips repeated download for cached images', async () => {
    clearRecognizedImagesCache();

    // Pre-cache an image
    recordRecognizedImage({
      fileId: 201,
      url: 'http://test/cached.png',
      fileName: 'cached.png',
      fileSize: 100,
      visualDescription: 'Previously extracted login screen',
      recognizedAt: new Date().toISOString()
    });

    let fetchCalls = 0;
    globalThis.fetch = async (url) => {
      fetchCalls++;
      return {
        ok: true,
        arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength)
      } as Response;
    };

    const attachments = [
      { message_attachment: { file_id: 201, file_name: 'cached.png', content_url: 'http://test/cached.png', mime_type: 'image/png' } },
      { message_attachment: { file_id: 202, file_name: 'uncached.png', content_url: 'http://test/uncached.png', mime_type: 'image/png' } }
    ];

    // Check against cache first (mirroring /api/chat logic)
    const alreadyRecognizedImages: RecognizedImageRecord[] = [];
    const unrecognizedAttachments: any[] = [];
    for (const att of attachments) {
      const cached = findInRecognizedCache(att, '777');
      if (cached) {
        alreadyRecognizedImages.push(cached);
      } else {
        unrecognizedAttachments.push(att);
      }
    }

    assert.strictEqual(alreadyRecognizedImages.length, 1);
    assert.strictEqual(alreadyRecognizedImages[0].fileId, 201);
    assert.strictEqual(unrecognizedAttachments.length, 1);
    assert.strictEqual(unrecognizedAttachments[0].message_attachment.file_id, 202);

    // Only uncached attachments are downloaded
    const loaded = await loadTicketImageAttachments(unrecognizedAttachments);
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].fileName, 'uncached.png');
    assert.strictEqual(fetchCalls, 1, 'fetch should only be invoked for uncached images');
    assert.ok(loaded[0].hash, 'downloaded image should have sha256 hash computed');
    assert.strictEqual(loaded[0].fileId, 202);
  });

  it('selects base text model when all images are cached (loadedImages.length === 0)', () => {
    // When no new images to process (loadedImages.length === 0), selectModelForRequest returns base model
    const configuredModel = 'gemini-3.8-flash';
    const loadedImagesCount = 0;
    const selectedModel = selectModelForRequest(configuredModel, loadedImagesCount > 0);
    assert.strictEqual(selectedModel, 'gemini-3.8-flash');

    // If new images were present, it would route to gemini-3.5-flash-lite
    const visionModel = selectModelForRequest(configuredModel, true);
    assert.strictEqual(visionModel, 'gemini-3.5-flash-lite');
  });

  it('persists recognized images cache across restarts', () => {
    clearRecognizedImagesCache();

    const record: RecognizedImageRecord = {
      fileId: 999,
      url: 'https://test/persisted.png',
      fileName: 'persisted.png',
      fileSize: 4096,
      hash: 'hash_persisted_test_123',
      caseNumber: 'CASE-100',
      recognizedAt: '2026-09-18T12:00:00.000Z',
      visualDescription: 'Persisted visual description text'
    };

    recordRecognizedImage(record);
    saveRecognizedImages();

    assert.ok(fs.existsSync(RECOGNIZED_IMAGES_FILE), 'cache file should exist on disk');

    // Clear in-memory cache
    clearRecognizedImagesCache();
    assert.strictEqual(findInRecognizedCache({ file_id: 999 }), null);

    // Reload from disk
    loadRecognizedImages();
    const reloaded = findInRecognizedCache({ file_id: 999 });
    assert.ok(reloaded, 'image should be reloaded from disk');
    assert.strictEqual(reloaded.visualDescription, 'Persisted visual description text');
    assert.strictEqual(reloaded.hash, 'hash_persisted_test_123');
    assert.strictEqual(reloaded.caseNumber, 'CASE-100');

    // Cleanup test data
    clearRecognizedImagesCache();
    if (fs.existsSync(RECOGNIZED_IMAGES_FILE)) {
      try { fs.unlinkSync(RECOGNIZED_IMAGES_FILE); } catch {}
    }
  });
});
