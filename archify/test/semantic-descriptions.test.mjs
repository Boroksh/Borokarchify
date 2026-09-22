import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-descriptions-'));
const description = 'Explains this item responsibility in the generated diagram.';
const detailHref = '../details/item.html';
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const cases = [
  { type: 'architecture', example: 'web-app.architecture.json', collection: 'components' },
  { type: 'workflow', example: 'agent-tool-call.workflow.json', collection: 'nodes' },
  { type: 'sequence', example: 'async-job-roundtrip.sequence.json', collection: 'participants' },
  { type: 'dataflow', example: 'event-stream.dataflow.json', collection: 'nodes' },
  { type: 'lifecycle', example: 'agent-run.lifecycle.json', collection: 'states' },
];

function render(entry, value, href) {
  const source = path.join(tmp, `${entry.type}-${Math.random().toString(16).slice(2)}.json`);
  const output = path.join(tmp, `${path.basename(source, '.json')}.html`);
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', entry.example), 'utf8'));
  diagram[entry.collection][0].description = value;
  if (href !== undefined) diagram[entry.collection][0].detail_href = href;
  fs.writeFileSync(source, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'renderers', entry.type, `render-${entry.type}.mjs`),
    source,
    output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  return { ...result, output };
}

for (const entry of cases) {
  test(`${entry.type} exposes semantic descriptions in the passport`, () => {
    const result = render(entry, description);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const html = fs.readFileSync(result.output, 'utf8');
    assert.match(html, new RegExp(`data-node-description="${description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  });

  test(`${entry.type} rejects an empty semantic description`, () => {
    const result = render(entry, '');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /description|minLength|fewer than 1/);
  });

  test(`${entry.type} exposes a native eye for safe detail links`, () => {
    const result = render(entry, description, detailHref);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const html = fs.readFileSync(result.output, 'utf8');
    assert.match(html, /data-node-detail-href="\.\.\/details\/item\.html"/);
    assert.match(html, /<a class="node-detail-link" data-node-detail-link="" href="\.\.\/details\/item\.html"/);
  });

  test(`${entry.type} rejects executable detail links`, () => {
    const result = render(entry, description, 'javascript:alert(1)');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /detail_href|pattern/);
  });
}

test('all diagram types show semantic descriptions in the interactive passport', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    for (const entry of cases) {
      const result = render(entry, description, detailHref);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
      await browser.cdp.send('Page.navigate', { url: pathToFileURL(result.output).href }, sessionId);
      await loaded;
      const response = await browser.cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const node = document.querySelector('[data-node-description]');
          const eye = node.querySelector('[data-node-detail-link]');
          const panel = document.getElementById('focus-chip');
          let eyeActivated = false;
          eye.addEventListener('click', event => {
            event.preventDefault();
            eyeActivated = true;
          }, { once: true });
          eye.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          const panelStayedClosed = panel.hidden;
          node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          const field = document.getElementById('focus-description');
          return {
            eyeActivated,
            panelStayedClosed,
            panelOpened: !panel.hidden,
            text: field.textContent,
            hidden: field.hidden,
            href: eye.getAttribute('href')
          };
        })()`,
        returnByValue: true,
      }, sessionId);
      assert.equal(response.exceptionDetails, undefined);
      assert.deepEqual(response.result.value, {
        eyeActivated: true,
        panelStayedClosed: true,
        panelOpened: true,
        text: description,
        hidden: false,
        href: detailHref,
      }, entry.type);
    }
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
