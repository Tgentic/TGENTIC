// MCP (Model Context Protocol) over streamable HTTP — a real service endpoint,
// not a declaration stub. Tools read the Receipts state layer directly:
// scores come from the same contract that counts them, never from a cache we
// could skew. Declared as each agent's `MCP` service in the ERC-8004 file.

import { getAddress, isAddress, parseAbi } from "viem";
import { assessAgent } from "./heuristics.js";

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
];

const validAgent = (a) => typeof a === "string" && isAddress(a);

async function callTool(ctx, name, args = {}) {
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
    case "resources/list": return result(id, { resources: [] });
    case "prompts/list": return result(id, { prompts: [] });
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
