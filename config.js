/**
 * ERC-8004 registry addresses.
 *
 * Both registries sit at CREATE2-deterministic addresses, so the mainnet pair is identical
 * across chains; the testnet pair uses the 0x8004A818 / 0x8004B663 prefix instead.
 *
 * Source: github.com/erc-8004/erc-8004-contracts README (Base Mainnet and Base Sepolia
 * sections), cross-checked against erc-8004.quicknode.com/docs/contracts and verified on
 * chain with eth_getCode: all four addresses return 130 bytes of code (EIP-1167 proxies).
 */
export const REGISTRIES = {
  base: {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
  },
  'base-sepolia': {
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    chainId: 84532,
    rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
  },
};

export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
