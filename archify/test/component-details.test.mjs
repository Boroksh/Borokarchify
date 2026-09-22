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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-component-details-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

function architecture(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Component details', quality_profile: 'showcase' },
    components: [{
      id: 'worker',
      type: 'backend',
      label: 'Worker',
      sublabel: 'Execution engine',
      description: 'Consumes pending executions, runs DAG tasks, monitors heartbeats and records logs.',
      detail_href: './worker/process-runner.html',
      pos: [80, 80],
      size: [180, 72],
      ...overrides,
    }],
  };
}

function run(command, input) {
  const source = path.join(tmp, `${command}-${Math.random().toString(16).slice(2)}.architecture.json`);
  const output = path.join(tmp, `${path.basename(source, '.architecture.json')}.html`);
  fs.writeFileSync(source, JSON.stringify(input));
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    command,
    'architecture',
    source,
    ...(command === 'render' ? [output] : []),
    '--quality',
    'showcase',
  ], { cwd: skillRoot, encoding: 'utf8' });
  return { ...result, output };
}

test('architecture components expose descriptions and native eye detail links', () => {
  const result = run('render', architecture());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(result.output, 'utf8');

  assert.match(html, /data-node-description="Consumes pending executions, runs DAG tasks, monitors heartbeats and records logs\."/);
  assert.match(html, /data-node-detail-href="\.\/worker\/process-runner\.html"/);
  assert.match(html, /<a class="node-detail-link" data-node-detail-link="" href="\.\/worker\/process-runner\.html" aria-label="Open detailed diagram for Worker">/);
  assert.match(html, /<path d="M2\.4 8s2\.1-3\.2/);
  assert.match(html, /id="focus-description" hidden/);
  assert.match(html, /node\.getAttribute\('data-node-description'\)/);
  assert.doesNotMatch(html, />Open detail</);
});

test('architecture component descriptions remain optional for existing inputs', () => {
  const result = run('validate', architecture({ description: undefined, detail_href: undefined }));
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('detail_href rejects executable URL schemes', () => {
  const result = run('validate', architecture({ detail_href: 'javascript:alert(1)' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /detail_href|pattern/);
});

test('the eye opens detail independently from the component focus interaction', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const result = run('render', architecture());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(result.output).href }, sessionId);
    await loaded;
    const response = await browser.cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const node = document.querySelector('[data-node-id="worker"]');
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
        return {
          eyeActivated,
          panelStayedClosed,
          panelOpened: !panel.hidden,
          description: document.getElementById('focus-description').textContent,
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
      description: 'Consumes pending executions, runs DAG tasks, monitors heartbeats and records logs.',
      href: './worker/process-runner.html',
    });
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
