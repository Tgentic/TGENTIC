import type { Chain, PublicClient } from "viem";

export const chain: Chain;

export interface Addresses {
  tally: `0x${string}`;
  deployBlock: bigint;
  v1: `0x${string}`;
  v1DeployBlock: bigint;
  policy: `0x${string}`;
  heuristics: `0x${string}`;
  bondToken: `0x${string}`;
}
export const addresses: Addresses;

export interface CreateClientOptions {
  /** JSON-RPC endpoint (default: the public Robinhood Chain RPC) */
  rpcUrl?: string;
  /** an EIP-1193 provider to ride instead of http */
  provider?: unknown;
  /** tally contract address (default: mainnet v2 Receipts) */
  address?: `0x${string}`;
  /** getLogs lower bound */
  deployBlock?: bigint;
  /** max blocks per getLogs page (default 8M, under the RPC's ~10M cap) */
  blockRange?: bigint;
}

export interface Score {
  agent: `0x${string}`;
  score: bigint;
  reputation: bigint;
  paid: bigint;
  receipts: bigint;
  payers: bigint;
  bond: bigint;
  unlockAt: bigint;
  minBond: bigint;
  /** whether the bond meets the minimum — the gate for a public score */
  counted: boolean;
}

export interface Receipt {
  payer: `0x${string}`;
  amount: bigint;
  rating: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
  logTransactionHash: `0x${string}`;
}

export interface RecentReceipt extends Receipt {
  agent: `0x${string}`;
}

export interface RiskResult {
  agent: string;
  receipts: number;
  payers: number;
  topPayerShareBps: number;
  topPayer: string;
  topAmount: string;
  topAmountCount: number;
  intervalCount: number;
  flags: string[];
  flagged: boolean;
}

export interface BoardRow extends Score {
  flags: string[];
}

export interface VerifyResult extends Score {
  flags: string[];
  flagged: boolean;
  topPayerShareBps: number;
}

export interface TGClient {
  score(agent: string): Promise<Score>;
  receipts(agent: string): Promise<Receipt[]>;
  risk(agent: string): Promise<RiskResult>;
  recent(n?: number): Promise<RecentReceipt[]>;
  top(limit?: number): Promise<BoardRow[]>;
  verify(agent: string): Promise<VerifyResult>;
}

export function createClient(opts?: CreateClientOptions): TGClient;

export function computeFlags(
  logs: Array<{ blockNumber: bigint; payer: string; amount: bigint; txHash?: string }>,
  agent: string,
): RiskResult;
