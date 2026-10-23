# ERC-8004 identity viewer

Static page that reads an agent's ERC-8004 identity (owner plus registration file) and its
reputation feedback, on Base and Base Sepolia. No backend, no wallet, no key.

## Files

- `index.html` - the page. Open it from any static host, or `npx serve .` locally.
- `viewer.js` - the logic as an ES module. Runs unchanged in the browser and in Node 20.
- `config.js` - the registries per network and the public RPC endpoints.

## API

`loadAgent({agentId, network, identityRegistry, reputationRegistry, rpc, fetchJson})`
returns `{status, agentId, owner, tokenURI, registration, feedback, error?}`.

- `status` is `ok`, `empty` (`ownerOf` reverts or returns the zero address) or `error`
  (the RPC or the registration file failed, with a plain message). It never throws.
- `rpc(method, params)` sends one JSON-RPC call; on a failed call it throws an `Error`
  that carries the JSON-RPC code and message.
- `fetchJson(url)` fetches the registration file. `ipfs://` is mapped to an https gateway,
  and `data:application/json` URIs (base64 or not) are decoded without a request.
- `feedback` is `{count, average, items: [{client, score, tags}]}`, read from the reputation
  registry when one is passed, empty otherwise.

## Registries

| Network | Identity (ERC-721) | Reputation |
|---|---|---|
| Base (8453) | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 | 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 |
| Base Sepolia (84532) | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 | 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 |

Source: the EIP-8004 reference deployments published with the drafts
(https://github.com/erc-8004/erc-8004-contracts). Both addresses were confirmed to carry
deployed bytecode on Base mainnet with `eth_getCode` on 2026-10-23. On Base Sepolia the same
addresses are used once that deployment is published; until then the page reports the empty
state for them instead of inventing data.

## Tests

`npm test` runs `node --test test/`, offline, with the RPC and the gateway stubbed.
Each test is named after the acceptance item it proves (A1 to A6).

## House rules

Latin digits only, no long dashes in visible text, no secrets in code or logs.
