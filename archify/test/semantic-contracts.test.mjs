import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-contracts-'));

const CASES = {
  architecture: ['web-app.architecture.json', 'components'],
  workflow: ['agent-tool-call.workflow.json', 'nodes'],
  sequence: ['cache-miss-request.sequence.json', 'participants'],
  dataflow: ['product-analytics.dataflow.json', 'nodes'],
  lifecycle: ['agent-run.lifecycle.json', 'states'],
};

function candidate(mode, example, collection) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
  const contract = {
    inputs: ['execution request', 'cancellation signal'],
    outputs: ['execution result'],
    errors: ['runtime unavailable'],
  };
  if (mode !== 'architecture') {
    contract.sources = [{ path: 'internal/worker/coordinator.go', line: 40, end_line: 72, label: 'Execute' }];
  }
  Object.assign(source[collection][0], contract);
  const input = path.join(tmp, `${mode}.json`);
  fs.writeFileSync(input, JSON.stringify(source));
  return input;
}

test('all typed renderers preserve semantic contract facts in the node metadata', () => {
  for (const [mode, [example, collection]] of Object.entries(CASES)) {
    const output = path.join(tmp, `${mode}.html`);
    execFileSync(process.execPath, [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      candidate(mode, example, collection),
      output,
    ]);
    const html = fs.readFileSync(output, 'utf8');
    if (mode !== 'architecture') {
      assert.match(html, /data-node-sources="\[\{&quot;path&quot;:&quot;internal\/worker\/coordinator\.go&quot;/, mode);
    }
    assert.match(html, /data-node-inputs="\[&quot;execution request&quot;,&quot;cancellation signal&quot;\]"/, mode);
    assert.match(html, /data-node-outputs="\[&quot;execution result&quot;\]"/, mode);
    assert.match(html, /data-node-errors="\[&quot;runtime unavailable&quot;\]"/, mode);
  }
});

test('Semantic Passport exposes sources, inputs, outputs, and errors on demand', () => {
  const output = path.join(tmp, 'passport.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/workflow/render-workflow.mjs'),
    candidate('passport', CASES.workflow[0], CASES.workflow[1]),
    output,
  ]);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /id="focus-contract" hidden aria-label="Component contract"/);
  assert.match(html, /id="focus-sources-group"[\s\S]*?>Sources</);
  assert.match(html, /id="focus-inputs-group"[\s\S]*?>Inputs</);
  assert.match(html, /id="focus-outputs-group"[\s\S]*?>Outputs</);
  assert.match(html, /id="focus-errors-group"[\s\S]*?>Errors</);
  assert.match(html, /function renderSemanticContract\(node\)/);
  assert.match(html, /parsePassportList\(node, 'data-node-' \+ name\)/);
  assert.match(html, /var contractSearch = \['sources', 'inputs', 'outputs', 'errors'\]/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
