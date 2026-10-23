import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAgent, decodeString, resolveTokenURI, decodeDataJson } from '../viewer.js';

const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');
const addressWord = (a) => '0x' + '0'.repeat(24) + a.replace(/^0x/, '');
const stringWord = (s) => {
  const hex = Buffer.from(s, 'utf8').toString('hex');
  return '0x' + pad((32).toString(16)) + pad((hex.length / 2).toString(16)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};

const REG = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REP = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const OWNER = '0x5033036702CCeeE23b79022e938a41e0452F908a';

function stub({ owner = addressWord(OWNER), uri = stringWord('ipfs://bafyreg'), reg = { name: 'Kognai citizen', description: 'an agent' }, reputation = 0, fail } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(params[0].data.slice(0, 10));
    if (fail === 'revert-owner' && params[0].data.startsWith('0x6352211e')) {
      const err = new Error('execution reverted: no such token'); err.code = 3; throw err;
    }
    if (fail === 'rpc') throw new Error('HTTP 502 from RPC');
    if (params[0].data.startsWith('0x6352211e')) return owner;
    if (params[0].data.startsWith('0xc87b56dd')) return uri;
    if (params[0].data.startsWith('0x4537b764')) return '0x' + pad(reputation.toString(16));
    throw new Error('unexpected call');
  };
  const fetchJson = async (url) => {
    if (fail === 'file') throw new Error('HTTP 404');
    assert.equal(url, 'https://ipfs.io/ipfs/bafyreg');
    return reg;
  };
  return { rpc, fetchJson, calls };
}

test('A1 existing agent shows owner, tokenURI and registration', async () => {
  const { rpc, fetchJson } = stub();
  const out = await loadAgent({ agentId: 1, network: 'base', identityRegistry: REG, reputationRegistry: REP, rpc, fetchJson });
  assert.equal(out.status, 'ok');
  assert.equal(out.owner, OWNER);
  assert.equal(out.tokenURI, 'ipfs://bafyreg');
  assert.equal(out.registration.name, 'Kognai citizen');
});

test('A2 ipfs and data tokenURIs are read', async () => {
  assert.equal(resolveTokenURI('ipfs://bafyreg'), 'https://ipfs.io/ipfs/bafyreg');
  const plain = 'data:application/json,{"name":"inline"}';
  assert.deepEqual(decodeDataJson(plain), { name: 'inline' });
  const b64 = 'data:application/json;base64,' + Buffer.from('{"name":"b64"}').toString('base64');
  assert.deepEqual(decodeDataJson(b64), { name: 'b64' });
  const { rpc } = stub({ uri: stringWord(plain) });
  const out = await loadAgent({ agentId: 2, network: 'base', identityRegistry: REG, rpc, fetchJson: async () => { throw new Error('must not be called'); } });
  assert.equal(out.status, 'ok');
  assert.equal(out.registration.name, 'inline');
});

test('A3 missing agent is empty, failures are errors, nothing throws', async () => {
  const revert = stub({ fail: 'revert-owner' });
  const a = await loadAgent({ agentId: 99, identityRegistry: REG, rpc: revert.rpc, fetchJson: revert.fetchJson });
  assert.equal(a.status, 'empty');

  const zero = stub({ owner: '0x' + '0'.repeat(64) });
  const b = await loadAgent({ agentId: 99, identityRegistry: REG, rpc: zero.rpc, fetchJson: zero.fetchJson });
  assert.equal(b.status, 'empty');

  const broken = stub({ fail: 'rpc' });
  const c = await loadAgent({ agentId: 1, identityRegistry: REG, rpc: broken.rpc, fetchJson: broken.fetchJson });
  assert.equal(c.status, 'error');
  assert.match(c.error, /502/);

  const badFile = stub({ fail: 'file' });
  const d = await loadAgent({ agentId: 1, identityRegistry: REG, rpc: badFile.rpc, fetchJson: badFile.fetchJson });
  assert.equal(d.status, 'error');
  assert.match(d.error, /registration file failed/);
});

test('A4 reputation is summarised and an agent without feedback says so', async () => {
  const none = stub({ reputation: 0 });
  const a = await loadAgent({ agentId: 1, identityRegistry: REG, reputationRegistry: REP, rpc: none.rpc, fetchJson: none.fetchJson });
  assert.deepEqual(a.feedback, { count: 0, average: null, items: [] });
});

test('A5 reads Base and Base Sepolia through the same interface', async () => {
  const { rpc, fetchJson } = stub();
  for (const network of ['base', 'base-sepolia']) {
    const out = await loadAgent({ agentId: 5, network, identityRegistry: REG, rpc, fetchJson });
    assert.equal(out.status, 'ok');
    assert.equal(out.network, network);
  }
});

test('A6 page is mobile ready and light/dark aware', async () => {
  const html = await (await import('node:fs/promises')).readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /viewport/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /max-width:\s*400px|360/);
});
