# Agent manifests — signed identity for scored agents (Step 6)

A tally answers "how much was earned". A manifest answers "who earned it".

Each scored agent may publish a **signed manifest**: a JSON document binding
its name, service endpoints and authorized signing keys to the agent address —
the same address the receipts tally. The signature is a plain EIP-191
`personal_sign`, so anyone can verify it offline with no RPC and no trust in
our gate.

## Format (`tgentic/agent-manifest/1`)

```json
{
  "type": "tgentic/agent-manifest/1",
  "version": 1,
  "chainId": 4663,
  "agent": "0x…",
  "agentId": 26520,
  "name": "…",
  "endpoints": [{ "name": "web", "url": "https://…" }],
  "signingKeys": ["0x…"],
  "issuedAt": "2026-11-27T04:32:05.114Z",
  "signature": "0x…"
}
```

| Field | Meaning |
|---|---|
| `version` | Monotonically increasing integer. Consumers take the highest version in the trust chain — see "Key rotation" below. |
| `agent` | The tally identity. Receipts, bonds and scores all key off this address. |
| `agentId` | ERC-8004 tokenId on this chain, when registered — links the manifest into the discovery layer. Optional. |
| `signingKeys` | Addresses allowed to act for this agent. The recovered signer must be `agent` itself **or** one of these — that is the whole rotation story: the old key signs the new manifest that introduces the new key. |
| `signature` | `personal_sign` over the canonical manifest (every field except `signature`, keys sorted at every depth). |

## Verifying

```bash
node tools/verify-manifest.mjs manifests/0x….json   # → {"ok":true,"signer":"0x…"}
```

Or programmatically — `gate/src/manifest.js` exports `verifyManifest`,
`validateManifest`, `manifestMessage`, `newManifest`, `signManifest`.
Verification is pure ecrecover: no client, no network, no secrets.

## Signing

```bash
AGENT_KEY=0x… node tools/sign-manifest.mjs --agent 0x… --agent-id 26520 \
  --name "my agent" --endpoint web=https://example.com
```

The key comes from the environment and is never written. The script refuses
to sign if `AGENT_KEY` does not resolve to the `--agent` address — a manifest
claiming an identity the signer does not control is worthless. For rotation,
pass `--version <n>` and `--signer 0x<delegated-key>`; the self-sign check is
then relaxed because the signing key legitimately differs from `agent`.

## Key rotation — the trust chain

`resolveManifests()` resolves the current manifest from every version an
agent has published:

- The first valid version must be signed by `agent` or a key it declares.
- Each later version must be signed by a key the **previously accepted**
  version authorized — "the old key signs in the new key".
- A version signed by an unauthorized key does not extend the chain; the
  trusted tip stays at the last accepted version.
- The `agent` address itself is always authorized — it anchors the identity
  and is the recovery path if a delegated key goes rogue.

`loadManifestStore(dir)` loads a directory of manifests through this rule at
gate boot, so the store only ever holds trusted tips. `manifests/` may carry
several files per agent (`0x<addr>.json`, `0x<addr>.v2.json`, …).

## Binding identity to payments

The tally endpoint accepts an optional `manifest` field. When present, the
payer's feedback signature must also bind `manifestHash` (keccak256 over the
canonical manifest) — the rating is then committed to *who the agent is*,
not just an address. Binding to a superseded version is rejected with
`MANIFEST_STALE`. Fully backwards compatible: no manifest, no binding.

## Resolving identity in one call

- MCP tool `get_agent_identity` — `agent` or `agentId` → verified manifest
  (name, endpoints, signingKeys, hash) plus live score, receipts, payers,
  bond. `agentId` resolves through the ERC-8004 IdentityRegistry `ownerOf`.
- `GET /manifest/<addr>` on the gate — plain-HTTP manifest lookup.

## What shipped

- `gate/src/manifest.js` — canonicalization, validation, sign, verify,
  `manifestHash`, `resolveManifests` (rotation chain), `loadManifestStore`
- `tools/sign-manifest.mjs` (`--version`/`--signer` for rotation) /
  `tools/verify-manifest.mjs` (single file or chain-resolved dir)
- `manifests/` — signed manifests for our 7 mainnet agents, each signed by
  its own agent wallet (agentIds 26520–26526, the same ones on 8004scan)
- Gate: `GET /manifest/<addr>`, manifest-bound tally signatures
- MCP: `get_agent_identity` tool
- `test/manifest.js` — round-trip, tamper, foreign-key, delegated-key and
  rotation-chain cases; `test/mcp.js`, `test/gate.js` cover the endpoint
  and the binding rules

## What this is NOT (honest scope)

- The manifest is **self-asserted metadata** — the signature proves "the
  holder of this key wrote this", not that the claims inside are true.
  Reputation still comes only from receipts.
- Nothing on-chain anchors `version` ordering yet — the trust chain is a
  consumer-side convention enforced by the gate and SDK. Registry anchoring
  (posting manifest hashes into ERC-8004 metadata or a small anchor
  contract) is a later item.
