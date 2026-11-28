import type { Chain, PublicClient } from "viem";

export const chain: Chain;

export interface Addresses {
  tally: `0x${string}`;
  deployBlock: bigint;
  receipts: `0x${string}`;
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
  /** tally contract address (default: mainnet v1) */
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

// ---- gate client (the public HTTP surface) ----

export interface AgentRow {
  agent: string;
  score: string;
  reputation: string;
  receipts: string;
  payers: string;
  bond: string;
  counted: boolean;
  flagged: boolean;
  flags: string[];
  name?: string;
  manifestVerified?: boolean;
}

export interface AgentQuery {
  minScore?: string | number;
  minReceipts?: string | number;
  flagged?: boolean;
  sort?: "score" | "receipts" | "payers";
  limit?: number;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

export interface AuditReport {
  type: string;
  auditor: { name: string; agent: string; agentId?: number };
  subject: { agent: string; manifest: unknown };
  financials: { score: string; reputation: string; receipts: string; payers: string; bond: string; counted: boolean };
  risk: { flagged: boolean; flags: string[]; topPayerShareBps: number; topAmount: string; intervalCount: number };
  summary: string;
  issuedAt: string;
  signature: string;
}

export interface TallyEvent {
  type: "tally";
  agent: string;
  payer: string;
  amount: string;
  rating: number;
  txHash: string;
  blockNumber: string;
  tallyTx: string;
}

export interface GateClient {
  agents(q?: AgentQuery): Promise<{ agents: AgentRow[]; total: number; source: string }>;
  agent(a: string): Promise<AgentRow>;
  risk(a: string): Promise<RiskResult>;
  manifest(a: string): Promise<unknown>;
  manifests(): Promise<{ manifests: unknown[] }>;
  health(): Promise<{ ok: boolean; chainId: number; manifests: number }>;
  auditOffer(a: string): Promise<PaymentRequirements>;
  buyAudit(a: string, walletClient: { signTypedData(args: unknown): Promise<string>; account?: { address: string } }, account?: string): Promise<{ report: AuditReport; settle: SettleResult | null }>;
  events(onTally: (ev: TallyEvent) => void, opts?: { signal?: AbortSignal }): Promise<{ close(): Promise<void> }>;
}

export function createGateClient(opts?: { gateUrl?: string; fetchImpl?: typeof fetch }): GateClient;
