import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLO_SMOKE_BLOG_URL,
  COLO_SMOKE_RSS_URL,
  SNIPPET_MAX_CHARS,
  buildColoSmokeOutlookSnapshot,
  decodeBasicEntities,
  fetchColoSmokeOutlook,
  htmlToSnippet,
  parseColoSmokeRss,
} from '../scripts/fetch/adapters/colo-smoke-outlook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures/colo-smoke-outlook-rss.xml');

/** @type {typeof globalThis.fetch | undefined} */
let originalFetch;

describe('colo-smoke-outlook helpers', () => {
  it('decodes basic entities', () => {
    assert.equal(decodeBasicEntities('It&#39;s &amp; &lt;ok&gt;'), "It's & <ok>");
    assert.equal(decodeBasicEntities('&#x41;'), 'A');
  });

  it('does not double-unescape ampersand-prefixed entities', () => {
    assert.equal(decodeBasicEntities('&amp;quot;'), '&quot;');
    assert.equal(decodeBasicEntities('&amp;lt;'), '&lt;');
    assert.equal(decodeBasicEntities('&amp;amp;'), '&amp;');
  });

  it('strips Blogspot-escaped HTML into a capped snippet', () => {
    const escaped =
      '&lt;p&gt;Air quality remains a concern across large parts of Colorado. It&#39;s a complex scenario.&lt;/p&gt;' +
      '&lt;p&gt;' +
      'x'.repeat(800) +
      '&lt;/p&gt;';
    const snippet = htmlToSnippet(escaped, 120);
    assert.ok(!snippet.includes('<'));
    assert.ok(!snippet.includes('&lt;'));
    assert.match(snippet, /Air quality remains/);
    assert.ok(snippet.endsWith('…'));
    assert.ok(snippet.length <= 121);
  });

  it('returns empty snippet for blank input', () => {
    assert.equal(htmlToSnippet(''), '');
    assert.equal(htmlToSnippet('   <p></p>  '), '');
  });
});

describe('parseColoSmokeRss', () => {
  it('parses the latest item from the fixture feed', async () => {
    const xml = await readFile(fixturePath, 'utf8');
    const post = parseColoSmokeRss(xml);
    assert.ok(post);
    assert.match(post.title, /Potential for heavy smoke/);
    assert.equal(
      post.url,
      'https://colosmokeoutlook.blogspot.com/2026/08/potential-for-heavy-smoke-continues-for.html',
    );
    assert.equal(post.publishedAt, '2026-08-05T14:41:51.000Z');
    assert.match(post.guid ?? '', /post-2663325136394421981/);
    assert.match(post.snippet, /Air quality remains a concern/);
    assert.ok(!post.snippet.includes('<'));
    assert.ok(post.snippet.length <= SNIPPET_MAX_CHARS + 1);
    assert.ok(!post.title.includes('Older post'));
  });

  it('returns null when feed has no items', () => {
    assert.equal(parseColoSmokeRss('<rss><channel></channel></rss>'), null);
  });

  it('falls back to blog home when item link is missing', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Smoke note</title><description>&lt;p&gt;Hello&lt;/p&gt;</description></item>
    </channel></rss>`;
    const post = parseColoSmokeRss(xml);
    assert.ok(post);
    assert.equal(post.url, COLO_SMOKE_BLOG_URL);
    assert.equal(post.snippet, 'Hello');
  });
});

describe('buildColoSmokeOutlookSnapshot', () => {
  it('shapes the public JSON contract', () => {
    const snap = buildColoSmokeOutlookSnapshot({
      title: 'Test title',
      url: 'https://colosmokeoutlook.blogspot.com/2026/08/test.html',
      publishedAt: '2026-08-05T14:41:51.000Z',
      snippet: 'Hello smoke',
      guid: 'guid-1',
      fetchedAt: '2026-08-05T16:00:00.000Z',
    });
    assert.equal(snap.generatedAt, '2026-08-05T16:00:00.000Z');
    assert.equal(snap.title, 'Test title');
    assert.equal(snap.snippet, 'Hello smoke');
    assert.equal(snap.source.name, 'CDPHE Colorado Smoke Blog');
    assert.equal(snap.source.homeUrl, COLO_SMOKE_BLOG_URL);
    assert.equal(snap.source.feedUrl, COLO_SMOKE_RSS_URL);
  });
});

describe('fetchColoSmokeOutlook', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('returns ok snapshot from mocked RSS', async () => {
    const xml = await readFile(fixturePath, 'utf8');
    globalThis.fetch = async (input) => {
      assert.match(String(input), /feeds\/posts\/default/);
      return new Response(xml, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      });
    };
    const result = await fetchColoSmokeOutlook();
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 1);
    assert.ok(result.snapshot);
    assert.match(String(result.snapshot.title), /Potential for heavy smoke/);
    assert.equal(result.bySlug.size, 0);
  });

  it('returns error on HTTP failure', async () => {
    globalThis.fetch = async () => new Response('nope', { status: 503 });
    const result = await fetchColoSmokeOutlook();
    assert.equal(result.status, 'error');
    assert.equal(result.snapshot, null);
    assert.match(String(result.error), /HTTP 503/);
  });

  it('returns error when RSS has no usable item', async () => {
    globalThis.fetch = async () =>
      new Response('<rss><channel></channel></rss>', {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      });
    const result = await fetchColoSmokeOutlook();
    assert.equal(result.status, 'error');
    assert.equal(result.snapshot, null);
    assert.match(String(result.error), /no usable/);
  });
});
