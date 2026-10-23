// viewer.js - ERC-8004 identity and reputation reader. Works in the browser and in Node 20.
const SEL = {
  ownerOf: '0x6352211e',
  tokenURI: '0xc87b56dd',
  feedbackCount: '0x4537b764',
  feedback: '0x2d150457',
};

const strip = (h) => (h.startsWith('0x') ? h.slice(2) : h);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

function hexToBytes(hex) {
  const h = strip(hex);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

export function decodeAddress(hex) {
  const h = strip(hex || '');
  if (h.length < 64) return null;
  const a = '0x' + h.slice(24, 64);
  return /^0x0{40}$/.test(a) ? null : a;
}

export function decodeUint(hex, index = 0) {
  const h = strip(hex || '');
  const part = h.slice(index * 64, (index + 1) * 64);
  if (part.length < 64) return null;
  return BigInt('0x' + part);
}

export function decodeInt(hex, index = 0) {
  const v = decodeUint(hex, index);
  if (v === null) return null;
  const u = BigInt.asUintN(256, v);
  return u >= 1n << 255n ? u - (1n << 256n) : u;
}

export function decodeString(hex) {
  const h = strip(hex || '');
  if (h.length < 128) return '';
  const offset = Number(BigInt('0x' + h.slice(0, 64))) * 2;
  const length = Number(BigInt('0x' + h.slice(offset, offset + 64))) * 2;
  return bytesToText(hexToBytes(h.slice(offset + 64, offset + 64 + length)));
}

const isRevert = (err) =>
  err && (err.code === 3 || /revert/i.test(String(err.message || '') + String(err.data || '')));

const plain = (err) => (err && err.message ? String(err.message) : String(err));

function empty(status, agentId, error) {
  const out = { status, agentId, owner: null, tokenURI: null, registration: null, feedback: null };
  if (error !== undefined) out.error = error;
  return out;
}

export function resolveTokenURI(uri, gateway = 'https://ipfs.io/ipfs/') {
  if (typeof uri !== 'string' || uri.length === 0) return null;
  if (uri.startsWith('ipfs://')) return gateway + uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  return uri;
}

export function decodeDataJson(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('malformed data URI');
  const meta = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = typeof atob === 'function'
      ? atob(body)
      : Buffer.from(body, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(bytesToText(bytes));
  }
  return JSON.parse(decodeURIComponent(body));
}

async function fetchRegistration(uri, fetchJson) {
  if (typeof uri === 'string' && uri.startsWith('data:')) return decodeDataJson(uri);
  const target = resolveTokenURI(uri);
  if (target === null) return null;
  return fetchJson(target);
}

function feedbackFromTuple(hex) {
  // ERC-8004 feedback tuple: (address client, int128 score, uint8 decimals, string tag1, string tag2, ...)
  const client = decodeAddress(hex) || null;
  const raw = decodeInt(hex, 1);
  const decimals = Number(decodeUint(hex, 2) ?? 0n);
  const score = raw === null ? null : Number(raw) / 10 ** decimals;
  let tags = [];
  try {
    const t1 = decodeString('0x' + strip(hex).slice(3 * 64));
    if (t1) tags = [t1];
  } catch (_) {
    tags = [];
  }
  return { client, score, tags };
}

export async function loadAgent({
  agentId,
  network,
  identityRegistry,
  reputationRegistry,
  rpc,
  fetchJson,
}) {
  if (!identityRegistry) return empty('error', agentId, 'identityRegistry is required');
  if (typeof rpc !== 'function') return empty('error', agentId, 'rpc is required');
  if (typeof fetchJson !== 'function') return empty('error', agentId, 'fetchJson is required');

  let ownerRaw;
  try {
    ownerRaw = await rpc('eth_call', [
      { to: identityRegistry, data: SEL.ownerOf + word(agentId) },
      'latest',
    ]);
  } catch (err) {
    if (isRevert(err)) return empty('empty', agentId, 'no agent with this id');
    return empty('error', agentId, plain(err));
  }
  const owner = decodeAddress(ownerRaw);
  if (owner === null) return empty('empty', agentId, 'no agent with this id');

  let uriRaw;
  try {
    uriRaw = await rpc('eth_call', [
      { to: identityRegistry, data: SEL.tokenURI + word(agentId) },
      'latest',
    ]);
  } catch (err) {
    return empty('error', agentId, isRevert(err) ? 'tokenURI reverted' : plain(err));
  }
  const tokenURI = decodeString(uriRaw);
  if (!tokenURI) return empty('error', agentId, 'empty tokenURI');

  let registration;
  try {
    registration = await fetchRegistration(tokenURI, fetchJson);
  } catch (err) {
    const out = empty('error', agentId, 'registration file failed: ' + plain(err));
    out.owner = owner;
    out.tokenURI = tokenURI;
    return out;
  }

  const result = {
    status: 'ok',
    agentId,
    owner,
    tokenURI,
    registration,
    feedback: { count: 0, average: null, items: [] },
    network: network || null,
  };

  if (reputationRegistry) {
    let count = 0n;
    try {
      count = decodeUint(
        await rpc('eth_call', [
          { to: reputationRegistry, data: SEL.feedbackCount + word(agentId) },
          'latest',
        ]),
      ) ?? 0n;
    } catch (_) {
      count = 0n;
    }
    if (count > 0n) {
      const items = [];
      const start = count > 10n ? count - 10n : 0n;
      for (let i = start; i < count; i += 1n) {
        try {
          const hex = await rpc('eth_call', [
            { to: reputationRegistry, data: SEL.feedback + word(agentId) + word(i) },
            'latest',
          ]);
          items.push(feedbackFromTuple(hex));
        } catch (_) {
          // a single unreadable entry never fails the whole view
        }
      }
      const scores = items.map((it) => it.score).filter((s) => typeof s === 'number' && Number.isFinite(s));
      result.feedback = {
        count: Number(count),
        average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
        items,
      };
    }
  }
  return result;
}

export default loadAgent;
