// MCP (Model Context Protocol) over streamable HTTP — a real service endpoint,
// not a declaration stub. Tools read the Receipts state layer directly:
// scores come from the same contract that counts them, never from a cache we
// could skew. Declared as each agent's `MCP` service in the ERC-8004 file.

import { getAddress, isAddress, parseAbi } from "viem";
import { assessAgent, DEFAULT_FROM_BLOCK, LOG_BLOCK_RANGE } from "./heuristics.js";
import { manifestHash } from "./manifest.js";

// Official ERC-8004 IdentityRegistry on 4663 — resolves agentId → owner address.
const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const identityAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

const receiptsAbi = parseAbi([
  "function score(address) view returns (uint256)",
  "function bond(address) view returns (uint256)",
  "function receipts(address) view returns (uint256)",
  "function payers(address) view returns (uint256)",
  "function reputation(address) view returns (uint256)",
]);

const SERVER_INFO = { name: "tgentic-mcp", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "get_agent_score",
    description: "An agent's counted reputation on TGENTIC: raw reputation, receipts, unique payers, locked USDG bond, and the bond-gated score — read live from the Receipts contract.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string", description: "0x agent address" } },
      required: ["agent"],
    },
  },
  {
    name: "get_agent_risk",
    description: "Manipulation heuristics over an agent's receipts: payer concentration, timing regularity, amount cycling. Flags are heuristics, not verdicts.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string", description: "0x agent address" } },
      required: ["agent"],
    },
  },
  {
    name: "get_agent_identity",
    description: "Resolve who an agent is to what it earned, in one lookup: ERC-8004 agentId or address → verified manifest (name, endpoints, signing keys) plus counted score, receipts, payers and bond.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "0x agent address" },
        agentId: { type: "integer", description: "ERC-8004 tokenId — resolved via the IdentityRegistry" },
      },
    },
  },
];

const RESOURCES = [
  {
    uri: "resource://tgentic/leaderboard/latest",
    name: "TGENTIC counted leaderboard",
    description: "Bond-gated scores for every agent with counted reputation, read live from the Receipts contract.",
    mimeType: "application/json",
  },
];

const PROMPTS = [
  {
    name: "audit_agent",
    description: "Assess an agent's reputation evidence: pull its counted score, then run the manipulation heuristics before trusting the number.",
    arguments: [{ name: "agent", description: "0x agent address to audit", required: true }],
  },
];

const validAgent = (a) => typeof a === "string" && isAddress(a);

async function callTool(ctx, name, args = {}) {
  if (name === "get_agent_identity") {
    // agentId → registry ownerOf; agent → direct. Either way the answer is
    // one object: who this is (verified manifest, when published) and what
    // it earned (the same contract read as get_agent_score).
    let agent;
    if (validAgent(args.agent)) agent = getAddress(args.agent.toLowerCase());
    else if (Number.isInteger(args.agentId)) {
      try {
        agent = getAddress((await ctx.publicClient.readContract({ address: ctx.identityRegistry ?? IDENTITY_REGISTRY, abi: identityAbi, functionName: "ownerOf", args: [BigInt(args.agentId)] })).toLowerCase());
      } catch { throw new Error(`agentId ${args.agentId} is not registered on the identity registry`); }
    } else throw new Error("send agent (0x address) or agentId (integer)");
    const read = (fn) => ctx.publicClient.readContract({ address: ctx.tgentic, abi: receiptsAbi, functionName: fn, args: [agent] });
    const [score, bond, receipts, payers, reputation] = await Promise.all(
      ["score", "bond", "receipts", "payers", "reputation"].map(read),
    );
    const m = ctx.manifests?.byAgent?.get(agent.toLowerCase()) ?? null;
    return {
      agent,
      agentId: m?.agentId ?? (Number.isInteger(args.agentId) ? args.agentId : null),
      manifest: m ? { name: m.name, version: m.version, endpoints: m.endpoints, signingKeys: m.signingKeys, issuedAt: m.issuedAt, manifestHash: manifestHash(m), demo: m.demo === true, verified: true } : null,
      score: score.toString(), reputation: reputation.toString(), receipts: receipts.toString(), payers: payers.toString(), bond: bond.toString(), counted: score > 0n,
    };
  }
  if (!validAgent(args.agent)) throw new Error("agent must be a 0x address");
  const agent = getAddress(args.agent.toLowerCase());
  if (name === "get_agent_score") {
    const read = (fn) => ctx.publicClient.readContract({ address: ctx.tgentic, abi: receiptsAbi, functionName: fn, args: [agent] });
    const [score, bond, receipts, payers, reputation] = await Promise.all(
      ["score", "bond", "receipts", "payers", "reputation"].map(read),
    );
    return { agent, score: score.toString(), reputation: reputation.toString(), receipts: receipts.toString(), payers: payers.toString(), bond: bond.toString(), counted: score > 0n };
  }
  if (name === "get_agent_risk") {
    return assessAgent(ctx.publicClient, { address: ctx.tgentic, agent, fromBlock: ctx.detectFromBlock });
  }
  throw new Error(`unknown tool ${name}`);
}

const talliedAbi = parseAbi([
  "event Tallied(address indexed agent, address indexed payer, bytes32 indexed txHash, uint256 amount, uint8 rating)",
]);

/** The leaderboard resource: every agent with a counted receipt, by score. */
async function readResource(ctx, uri) {
  if (uri !== RESOURCES[0].uri) throw new Error(`unknown resource ${uri}`);
  const logs = await ctx.publicClient.getLogs({ address: ctx.tgentic, events: talliedAbi, fromBlock: ctx.detectFromBlock ?? DEFAULT_FROM_BLOCK, blockRange: LOG_BLOCK_RANGE });
  const agents = [...new Set(logs.map((l) => l.args.agent))].slice(0, 50);
  const rows = await Promise.all(agents.map(async (agent) => ({
    agent,
    score: (await ctx.publicClient.readContract({ address: ctx.tgentic, abi: receiptsAbi, functionName: "score", args: [agent] })).toString(),
    receipts: (await ctx.publicClient.readContract({ address: ctx.tgentic, abi: receiptsAbi, functionName: "receipts", args: [agent] })).toString(),
  })));
  rows.sort((a, b) => (BigInt(b.score) > BigInt(a.score) ? 1 : -1));
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ agents: rows, source: ctx.tgentic }) }] };
}

const result = (id, r) => ({ jsonrpc: "2.0", id, result: r });
const error = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Handle one parsed JSON-RPC message. Returns a response object or null for notifications. */
async function handleMessage(ctx, m) {
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string")
    return error(m?.id ?? null, -32600, "invalid request");
  const { id, method, params } = m;
  if (method.startsWith("notifications/")) return null; // notifications get 202, no body
  switch (method) {
    case "ping": return result(id ?? null, {});
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case "tools/list": return result(id, { tools: TOOLS });
    case "resources/list": return result(id, { resources: RESOURCES });
    case "resources/read": {
      try {
        return result(id, await readResource(ctx, params?.uri));
      } catch (e) {
        return error(id, -32602, e?.message ?? "resource read failed");
      }
    }
    case "prompts/list": return result(id, { prompts: PROMPTS });
    case "prompts/get": {
      if (params?.name !== "audit_agent") return error(id, -32602, `unknown prompt ${params?.name}`);
      const agent = params?.arguments?.agent ?? "<agent>";
      return result(id, {
        description: PROMPTS[0].description,
        messages: [{ role: "user", content: { type: "text", text:
          `Audit agent ${agent} on TGENTIC. 1) Call get_agent_score for the bond-gated score and receipt counts. ` +
          `2) Call get_agent_risk for payer-concentration, timing and amount-cycling heuristics. ` +
          `3) Report both — a flag is a reason to look closer, not a verdict.` } }],
      });
    }
    case "logging/setLevel": return result(id, {});
    case "tools/call": {
      try {
        const out = await callTool(ctx, params?.name, params?.arguments);
        return result(id, { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
      } catch (e) {
        return error(id, -32602, e?.message ?? "tool call failed");
      }
    }
    default: return error(id ?? null, -32601, `method not found: ${method}`);
  }
}

/**
 * POST /mcp handler. Accepts a single JSON-RPC message or an array (batch).
 * @returns {{status:number, body?:object}}
 */
export async function handleMcp(ctx, parsedBody) {
  if (Array.isArray(parsedBody)) {
    if (parsedBody.length === 0) return { status: 400, body: error(null, -32600, "empty batch") };
    const responses = (await Promise.all(parsedBody.map((m) => handleMessage(ctx, m)))).filter(Boolean);
    return responses.length ? { status: 200, body: responses } : { status: 202 };
  }
  const r = await handleMessage(ctx, parsedBody);
  return r === null ? { status: 202 } : { status: 200, body: r };
}
