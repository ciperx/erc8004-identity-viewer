/**
 * Acceptance tests for the ERC-8004 viewer. One test per acceptance item, named A1 to A6.
 * No network: rpc and fetchJson are injected and return hand-built ABI payloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadAgent, resolveTokenUri, decodeDataUri } from './viewer.js';
import { REGISTRIES } from './config.js';

const ADDRESS = '0x' + 'ab'.repeat(20);
const enc = {
  uint: (value) => BigInt(value).toString(16).padStart(64, '0'),
  address: (address) => '0'.repeat(24) + address.replace(/^0x/, ''),
  str: (text) => {
    const bytes = Buffer.from(text, 'utf8');
    const padded = bytes.length ? bytes.toString('hex').padEnd(Math.ceil(bytes.length / 32) * 64, '0') : '';
    return enc.uint(bytes.length) + padded;
  },
};

function returnString(text) {
  return '0x' + enc.uint(32) + enc.str(text);
}

function returnArrayOfAddresses(addresses) {
  return '0x' + enc.uint(32) + enc.uint(addresses.length) + addresses.map(enc.address).join('');
}

function returnSummary(count, value, decimals) {
  const negative = value < 0 ? (1n << 256n) + BigInt(value) : BigInt(value);
  return '0x' + enc.uint(count) + negative.toString(16).padStart(64, '0') + enc.uint(decimals);
}

const registration = { name: 'Kognai test agent', description: 'a test agent', endpoints: [{ name: 'web', url: 'https://example.com' }] };

function makeRpc(handlers) {
  const calls = [];
  const rpc = async (method, params) => {
    const data = params[0].data;
    calls.push({ method, to: params[0].to, data });
    const selector = data.slice(0, 10);
    const handler = handlers[selector];
    if (!handler) throw new Error(`unexpected selector ${selector}`);
    return handler(data);
  };
  return { rpc, calls };
}

test('A1 an existing agent shows owner, tokenURI and the registration file', async () => {
  const { rpc, calls } = makeRpc({
    '0x6352211e': () => '0x' + enc.address(ADDRESS),
    '0xc87b56dd': () => returnString('https://example.com/agent.json'),
  });
  const out = await loadAgent({
    agentId: 7, network: 'base', rpc,
    fetchJson: async (url) => { assert.equal(url, 'https://example.com/agent.json'); return registration; },
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.owner, ADDRESS);
  assert.equal(out.tokenURI, 'https://example.com/agent.json');
  assert.deepEqual(out.registration, registration);
  assert.equal(calls[0].to, REGISTRIES.base.identity);
});

test('A2 ipfs and data tokenURIs are read correctly', async () => {
  assert.equal(resolveTokenUri('ipfs://bafyxyz/meta.json'), 'https://ipfs.io/ipfs/bafyxyz/meta.json');
  const plain = 'data:application/json,' + encodeURIComponent(JSON.stringify(registration));
  assert.deepEqual(decodeDataUri(plain), registration);
  const base64 = 'data:application/json;base64,' + Buffer.from(JSON.stringify(registration)).toString('base64');
  assert.deepEqual(decodeDataUri(base64), registration);

  const uri = 'ipfs://bafyabc/agent.json';
  const { rpc } = makeRpc({
    '0x6352211e': () => '0x' + enc.address(ADDRESS),
    '0xc87b56dd': () => returnString(uri),
  });
  let fetched = null;
  const out = await loadAgent({ agentId: 1, rpc, fetchJson: async (url) => { fetched = url; return registration; } });
  assert.equal(out.status, 'ok');
  assert.equal(fetched, 'https://ipfs.io/ipfs/bafyabc/agent.json');

  const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(registration)).toString('base64');
  const { rpc: rpc2 } = makeRpc({
    '0x6352211e': () => '0x' + enc.address(ADDRESS),
    '0xc87b56dd': () => returnString(dataUri),
  });
  let touched = false;
  const out2 = await loadAgent({ agentId: 1, rpc: rpc2, fetchJson: async () => { touched = true; return null; } });
  assert.equal(out2.status, 'ok');
  assert.deepEqual(out2.registration, registration);
  assert.equal(touched, false, 'a data URI must not trigger a request');
});

test('A3 a missing agent is empty, a failure is an error, and nothing throws', async () => {
  const reverted = makeRpc({ '0x6352211e': () => { throw new Error('execution reverted'); } });
  const empty = await loadAgent({ agentId: 9, rpc: reverted.rpc, fetchJson: async () => null });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.error, undefined);

  const zero = makeRpc({ '0x6352211e': () => '0x' + enc.address('0x' + '00'.repeat(20)) });
  const none = await loadAgent({ agentId: 9, rpc: zero.rpc, fetchJson: async () => null });
  assert.equal(none.status, 'empty');

  const broken = makeRpc({ '0x6352211e': () => { throw new Error('rate limited by upstream'); } });
  const error = await loadAgent({ agentId: 9, rpc: broken.rpc, fetchJson: async () => null });
  assert.equal(error.status, 'error');
  assert.match(String(error.error), /rate limited/);

  const noRpc = await loadAgent({ agentId: 9, fetchJson: async () => null });
  assert.equal(noRpc.status, 'error');
  assert.ok(noRpc.error);
});

test('A4 reputation is summarised, and an agent without feedback says so', async () => {
  const { rpc } = makeRpc({
    '0x6352211e': () => '0x' + enc.address(ADDRESS),
    '0xc87b56dd': () => returnString('https://example.com/agent.json'),
    '0x81bbba58': () => returnSummary(3, 45, 1),
    '0xd9d84224': () => '0x' + enc.uint(32) + enc.uint(96) + enc.uint(64) + enc.uint(0) + enc.uint(0) + enc.uint(2)
      + enc.address(ADDRESS) + enc.address('0x' + 'cd'.repeat(20))
      + enc.uint(0) + enc.uint(0) + enc.uint(0) + enc.uint(0),
  });
  const withFeedback = await loadAgent({ agentId: 3, rpc, fetchJson: async () => registration });
  assert.equal(withFeedback.status, 'ok');
  assert.equal(withFeedback.feedback.count, 3);
  assert.equal(withFeedback.feedback.average, 4.5);

  const quiet = makeRpc({
    '0x6352211e': () => '0x' + enc.address(ADDRESS),
    '0xc87b56dd': () => returnString('https://example.com/agent.json'),
    '0x81bbba58': () => returnSummary(0, 0, 0),
    '0xd9d84224': () => '0x' + enc.uint(32) + enc.uint(64) + enc.uint(96) + enc.uint(128) + enc.uint(160) + enc.uint(0) + enc.uint(0) + enc.uint(0),
  });
  const noFeedback = await loadAgent({ agentId: 3, rpc: quiet.rpc, fetchJson: async () => registration });
  assert.equal(noFeedback.status, 'ok');
  assert.equal(noFeedback.feedback.count, 0);
  assert.deepEqual(noFeedback.feedback.items, []);
});

test('A5 both networks use their own registry addresses', async () => {
  for (const network of ['base', 'base-sepolia']) {
    const { rpc, calls } = makeRpc({
      '0x6352211e': () => '0x' + enc.address(ADDRESS),
      '0xc87b56dd': () => returnString('https://example.com/agent.json'),
    });
    const out = await loadAgent({ agentId: 1, network, rpc, fetchJson: async () => registration });
    assert.equal(out.status, 'ok');
    assert.equal(calls[0].to, REGISTRIES[network].identity);
  }
  assert.notEqual(REGISTRIES.base.identity, REGISTRIES['base-sepolia'].identity);
  assert.equal(REGISTRIES['base-sepolia'].chainId, 84532);
});

test('A6 the page is mobile friendly and honours light and dark', async () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /@media[^{]*max-width/);
  assert.match(html, /prefers-color-scheme/);
});
