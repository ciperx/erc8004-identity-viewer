// config.js - ERC-8004 deployments this viewer targets.
// Identity: ERC-721 registry (ownerOf, tokenURI). Reputation: feedback registry.
// Source: EIP-8004 reference deployments, https://github.com/erc-8004/erc-8004-contracts
// Both addresses carry deployed bytecode on Base mainnet (checked with eth_getCode, 2026-10-23).
export const REGISTRIES = {
  base: {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  'base-sepolia': {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
};

export const RPCS = {
  base: 'https://base.gateway.tenderly.co',
  'base-sepolia': 'https://base-sepolia.gateway.tenderly.co',
};

export default REGISTRIES;
