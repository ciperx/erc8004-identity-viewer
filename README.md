# ERC-8004 identity viewer

A static page that reads an agent's ERC-8004 identity, its registration file and its reputation
feedback, on Base and Base Sepolia. No backend, no build step, no runtime dependency.

## Files

| File | What it is |
|---|---|
| `index.html` | the page (root, mobile first, light and dark) |
| `viewer.js` | `loadAgent`, `resolveTokenUri`, `decodeDataUri`: runs in the browser and in Node 20 |
| `config.js` | `REGISTRIES` for both networks, with the source of each address |
| `viewer.test.mjs` | six tests, one per acceptance item A1 to A6, no network |

## Interface

```js
import { loadAgent } from './viewer.js';

const out = await loadAgent({ agentId: 1, network: 'base', rpc, fetchJson });
// { status, agentId, owner, tokenURI, registration, feedback, error? }
```

`rpc(method, params)` sends one JSON-RPC call and throws an Error carrying the JSON-RPC code and
message when the call fails. `fetchJson(url)` fetches the registration file. `reputationRegistry`
is optional. `loadAgent` never throws: `status` is `ok`, `empty` (ownerOf reverts or answers the
zero address) or `error` with a plain message.

## Registry addresses and their source

Both registries sit at CREATE2-deterministic addresses, so the mainnet pair is identical across
chains and the testnet pair uses the `0x8004A818` / `0x8004B663` prefix.

| Network | Identity | Reputation |
|---|---|---|
| Base (8453) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Base Sepolia (84532) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

Source: the `erc-8004/erc-8004-contracts` README (Base Mainnet and Base Sepolia sections),
cross-checked against `erc-8004.quicknode.com/docs/contracts`. All four were verified on chain
with `eth_getCode`: each returns 130 bytes of code, which is the EIP-1167 proxy these
deterministic deployments use.

## What the page shows

The registration's name, description, image, endpoints and supported trust, plus the reputation
as count, average and the latest entries. An agent with no feedback says so explicitly.

## Run the tests

```bash
node --test viewer.test.mjs
```

Six tests, one per acceptance item, all offline: the rpc and fetchJson are injected and return
hand-built ABI payloads. They cover an existing agent, `ipfs://` and `data:` tokenURIs, the empty
and error states, the reputation summary with and without feedback, both networks, and a static
check that the page carries a viewport meta tag and a light and dark colour scheme.
