/**
 * ERC-8004 identity viewer logic.
 *
 * Runs unchanged in a browser and in Node 20. Every network touch is injected: `rpc` sends one
 * JSON-RPC call and `fetchJson` fetches a URL, so the whole module is testable without a network.
 *
 * loadAgent never throws. It reports status 'ok', 'empty' (ownerOf reverts or answers the zero
 * address) or 'error' (the RPC or the file failed, with a plain message).
 */

export const SELECTORS = {
  ownerOf: '0x6352211e',
  tokenURI: '0xc87b56dd',
  getSummary: '0x81bbba58',
  readAllFeedback: '0xd9d84224',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

// --- hex helpers ------------------------------------------------------------

const strip0x = (value) => (value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value);

function hexToBytes(hex) {
  const clean = strip0x(hex);
  if (clean.length % 2 !== 0) throw new Error('odd length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function word(bytes, index) {
  const start = index * 32;
  if (start + 32 > bytes.length) throw new Error('read past end of data');
  let value = 0n;
  for (let i = 0; i < 32; i++) value = (value << 8n) | BigInt(bytes[start + i]);
  return value;
}

function addressAt(bytes, index) {
  const start = index * 32;
  return '0x' + bytesToHex(bytes.slice(start + 12, start + 32));
}

function stringAt(bytes, offset) {
  const length = Number(word(bytes, offset / 32));
  const start = offset + 32;
  if (start + length > bytes.length) throw new Error('string past end of data');
  return new TextDecoder().decode(bytes.slice(start, start + length));
}

function encodeUint(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function encodeAddressArray(addresses) {
  let head = encodeUint(addresses.length);
  for (const address of addresses) head += '0'.repeat(24) + strip0x(address);
  return head;
}

function encodeString(value) {
  const bytes = new TextEncoder().encode(value);
  const padded = bytes.length === 0 ? '' : bytesToHex(bytes).padEnd(Math.ceil(bytes.length / 32) * 64, '0');
  return encodeUint(bytes.length) + padded;
}

function readSigned(bytes, index) {
  const raw = word(bytes, index);
  const limit = 1n << 255n;
  return raw >= limit ? raw - (1n << 256n) : raw;
}

// --- tokenURI handling ------------------------------------------------------

export function resolveTokenUri(tokenUri, gateway = IPFS_GATEWAY) {
  if (typeof tokenUri !== 'string' || !tokenUri) return null;
  if (tokenUri.startsWith('ipfs://')) {
    const path = tokenUri.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return gateway.replace(/\/?$/, '/') + path;
  }
  return tokenUri;
}

export function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('data URI without a comma');
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const text = /;base64/i.test(meta) ? atob(payload) : decodeURIComponent(payload);
  return JSON.parse(text);
}

function isDataUri(uri) {
  return typeof uri === 'string' && uri.startsWith('data:');
}

// --- reputation -------------------------------------------------------------

function decodeSummary(ret) {
  const bytes = hexToBytes(ret);
  const count = Number(word(bytes, 0));
  const value = readSigned(bytes, 1);
  const decimals = Number(word(bytes, 2));
  const divisor = 10n ** BigInt(decimals);
  const average = decimals === 0 ? Number(value) : Number(value) / Number(divisor);
  return { count, average, decimals };
}

/** readAllFeedback(uint256,address[],string,string,bool) returns seven parallel arrays. */
function decodeFeedback(ret) {
  const bytes = hexToBytes(ret);
  const clientsOffset = Number(word(bytes, 0));
  const valuesOffset = Number(word(bytes, 2));

  const clientsCount = Number(word(bytes, clientsOffset / 32));
  const clients = [];
  for (let i = 0; i < clientsCount; i++) clients.push(addressAt(bytes, clientsOffset / 32 + 1 + i));

  const valuesCount = Number(word(bytes, valuesOffset / 32));
  const scores = [];
  for (let i = 0; i < valuesCount; i++) scores.push(Number(readSigned(bytes, valuesOffset / 32 + 1 + i)));

  const items = clients.map((client, i) => ({ client, score: scores[i] ?? 0, tags: [] }));
  return items;
}

// --- main -------------------------------------------------------------------

export async function loadAgent(options = {}) {
  const {
    agentId,
    network = 'base',
    identityRegistry,
    reputationRegistry,
    rpc,
    fetchJson,
    registries,
    ipfsGateway = IPFS_GATEWAY,
  } = options;

  const result = {
    status: 'error',
    agentId: agentId === undefined || agentId === null ? null : String(agentId),
    owner: null,
    tokenURI: null,
    registration: null,
    feedback: null,
  };

  const fail = (message) => {
    result.status = 'error';
    result.error = message;
    return result;
  };

  try {
    if (typeof rpc !== 'function') return fail('an rpc function is required');
    if (typeof fetchJson !== 'function') return fail('a fetchJson function is required');
    if (agentId === undefined || agentId === null || agentId === '') return fail('agentId is required');

    const table = registries || (await import('./config.js')).REGISTRIES;
    const net = table[network];
    if (!net) return fail(`unknown network ${network}`);

    const identity = identityRegistry || net.identity;
    const reputation = reputationRegistry || net.reputation;
    const id = String(agentId);
    const data = SELECTORS.ownerOf + encodeUint(id);

    let ownerRaw;
    try {
      ownerRaw = await rpc('eth_call', [{ to: identity, data }, 'latest']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/revert|code 3|invalid opcode/i.test(message)) {
        result.status = 'empty';
        return result;
      }
      return fail(message || 'the rpc call failed');
    }

    const owner = '0x' + strip0x(String(ownerRaw)).slice(-40);
    if (owner.toLowerCase() === ZERO_ADDRESS) {
      result.status = 'empty';
      return result;
    }
    result.owner = owner;

    const uriRaw = await rpc('eth_call', [{ to: identity, data: SELECTORS.tokenURI + encodeUint(id) }, 'latest']);
    const uriBytes = hexToBytes(String(uriRaw));
    const uriOffset = Number(word(uriBytes, 0));
    const tokenUri = stringAt(uriBytes, uriOffset);
    result.tokenURI = tokenUri;

    if (isDataUri(tokenUri)) {
      result.registration = decodeDataUri(tokenUri);
    } else {
      const url = resolveTokenUri(tokenUri, ipfsGateway);
      const registration = await fetchJson(url);
      result.registration = typeof registration === 'string' ? JSON.parse(registration) : registration;
    }

    if (reputation) {
      const feedback = { count: 0, average: 0, items: [] };
      // getSummary(uint256, address[], string, string): 4 head words, then three empty tails.
      const summaryData =
        SELECTORS.getSummary + encodeUint(id) + encodeUint(128) + encodeUint(160) + encodeUint(192)
        + encodeUint(0) + encodeUint(0) + encodeUint(0);
      try {
        const summaryRaw = await rpc('eth_call', [{ to: reputation, data: summaryData }, 'latest']);
        const summary = decodeSummary(String(summaryRaw));
        feedback.count = summary.count;
        feedback.average = summary.average;
      } catch {
        // a registry without getSummary leaves the zeroed summary in place
      }
      try {
        // readAllFeedback(uint256, address[], string, string, bool): 5 head words, then three tails.
        const allData =
          SELECTORS.readAllFeedback + encodeUint(id) + encodeUint(160) + encodeUint(192) + encodeUint(224)
          + encodeUint(1) + encodeUint(0) + encodeUint(0) + encodeUint(0);
        const allRaw = await rpc('eth_call', [{ to: reputation, data: allData }, 'latest']);
        feedback.items = decodeFeedback(String(allRaw));
        if (feedback.count === 0 && feedback.items.length > 0) {
          feedback.count = feedback.items.length;
          const total = feedback.items.reduce((sum, item) => sum + item.score, 0);
          feedback.average = total / feedback.items.length;
        }
      } catch {
        // feedback items are best effort; the summary above still stands
      }
      result.feedback = feedback;
    }

    result.status = 'ok';
    return result;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
