import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app, settings } from '../server.ts';

const TEST_ADMIN_PASSWORD = 'admin-skills-test-secret';
let server: http.Server;
let baseUrl: string;
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let initialSettingsBackup: any;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
  initialSettingsBackup = JSON.parse(JSON.stringify(settings));

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  if (initialSettingsBackup) {
    Object.assign(settings, initialSettingsBackup);
  }
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
});

describe('Skills Import System Fixes', () => {
  test('Express body limit handles payloads > 100kb without 413 Payload Too Large', async () => {
    const originalPrompt = settings.system_prompt;
    try {
      // Large payload ~250kb
      const largeContent = 'A'.repeat(250 * 1024);
      const res = await originalFetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
        },
        body: JSON.stringify({
          ...settings,
          system_prompt: largeContent
        })
      });

      assert.notEqual(res.status, 413, 'Should not return 413 Payload Too Large');
      assert.equal(res.status, 200, 'Settings save should succeed with large payload');
    } finally {
      settings.system_prompt = originalPrompt;
    }
  });

  test('/api/admin/skills/import preserves full content (>1000 chars) and extracts YAML name', async () => {
    const longBody = 'Detailed instructions '.repeat(100); // > 2000 chars
    const fullMarkdown = `---
name: yaml-extracted-skill
description: Test skill
---
# Secondary Heading

${longBody}`;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : (input as any).url || input.toString();
      if (urlStr.includes('sample-skill/SKILL.md')) {
        return new Response(fullMarkdown, { status: 200 });
      }
      return originalFetch(input, init);
    };

    const res = await originalFetch(`${baseUrl}/api/admin/skills/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
      },
      body: JSON.stringify({
        url: 'https://raw.githubusercontent.com/test/repo/main/skills/sample-skill/SKILL.md'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.importedCount, 1);
    assert.equal(data.name, 'yaml-extracted-skill');

    const parsedSkills = JSON.parse(data.skills);
    const importedSkill = parsedSkills.find((s: any) => s.name === 'yaml-extracted-skill');
    assert.ok(importedSkill, 'Imported skill should be found in skills array');
    assert.equal(importedSkill.content, fullMarkdown, 'Content must NOT be truncated');
    assert.ok(importedSkill.content.length > 2000, 'Content length must be > 2000 chars');
  });

  test('/api/admin/skills/import extracts folder name when file is SKILL.md without YAML name', async () => {
    const markdown = `Just some instructions without frontmatter or heading.\nSecond line.`;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : (input as any).url || input.toString();
      if (urlStr.includes('awesome-agent/SKILL.md')) {
        return new Response(markdown, { status: 200 });
      }
      return originalFetch(input, init);
    };

    const res = await originalFetch(`${baseUrl}/api/admin/skills/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
      },
      body: JSON.stringify({
        url: 'https://raw.githubusercontent.com/test/repo/main/skills/awesome-agent/SKILL.md'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'awesome-agent');
  });

  test('/api/admin/skills/repo filters files and limits to 200', async () => {
    const mockTree: any[] = [];
    // 300 valid skill files
    for (let i = 0; i < 300; i++) {
      mockTree.push({
        path: `plugins/core/skills/skill-${i}/SKILL.md`,
        type: 'blob',
        size: 100
      });
    }
    // 100 non-skill files
    for (let i = 0; i < 100; i++) {
      mockTree.push({
        path: `src/components/File${i}.tsx`,
        type: 'blob',
        size: 200
      });
      mockTree.push({
        path: `docs/readme${i}.md`,
        type: 'blob',
        size: 200
      });
    }

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : (input as any).url || input.toString();
      if (urlStr.includes('api.github.com/repos/test-org/test-repo/git/trees/')) {
        return new Response(JSON.stringify({ tree: mockTree }), { status: 200 });
      }
      return originalFetch(input, init);
    };

    const res = await originalFetch(`${baseUrl}/api/admin/skills/repo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
      },
      body: JSON.stringify({
        url: 'https://github.com/test-org/test-repo'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.files.length, 200, 'Should be capped at 200 files');
    assert.ok(data.files.every((f: any) => f.path.includes('skills/')), 'All files must match skill criteria');
  });

  test('/api/admin/skills/import-batch imports multiple skills and preserves full content', async () => {
    const longContent1 = 'Content 1 '.repeat(150);
    const longContent2 = 'Content 2 '.repeat(150);

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : (input as any).url || input.toString();
      if (urlStr.includes('skill-a.md')) {
        return new Response(`# Skill Alpha\n${longContent1}`, { status: 200 });
      }
      if (urlStr.includes('skill-b.md')) {
        return new Response(`name: skill-beta\n---\n${longContent2}`, { status: 200 });
      }
      if (urlStr.includes('broken-url.md')) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
      return originalFetch(input, init);
    };

    const res = await originalFetch(`${baseUrl}/api/admin/skills/import-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
      },
      body: JSON.stringify({
        urls: [
          'https://raw.githubusercontent.com/test/repo/main/skill-a.md',
          'https://raw.githubusercontent.com/test/repo/main/skill-b.md',
          'https://raw.githubusercontent.com/test/repo/main/broken-url.md'
        ]
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.importedCount, 2);
    assert.equal(data.failedCount, 1);
    assert.ok(data.errors.length > 0);

    const parsedSkills = JSON.parse(data.skills);
    const skillA = parsedSkills.find((s: any) => s.name === 'Skill Alpha');
    const skillB = parsedSkills.find((s: any) => s.name === 'skill-beta');

    assert.ok(skillA, 'Skill Alpha must be imported');
    assert.ok(skillB, 'skill-beta must be imported');
    assert.equal(skillA.content, `# Skill Alpha\n${longContent1}`, 'Content must NOT be truncated');
    assert.equal(skillB.content, `name: skill-beta\n---\n${longContent2}`, 'Content must NOT be truncated');
  });

  test('/api/admin/skills/import-batch returns 400 when all URLs fail', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };

    const res = await originalFetch(`${baseUrl}/api/admin/skills/import-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_ADMIN_PASSWORD}`
      },
      body: JSON.stringify({
        urls: ['https://raw.githubusercontent.com/test/repo/main/non-existent.md']
      })
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'Ни один навык не был импортирован');
    assert.equal(data.failedCount, 1);
  });
});
