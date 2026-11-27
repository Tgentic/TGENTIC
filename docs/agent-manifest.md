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
| `version` | Monotonically increasing integer. Consumers take the highest version whose signature verifies — this is what makes key rotation possible later. |
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
claiming an identity the signer does not control is worthless.

## What shipped

- `gate/src/manifest.js` — canonicalization, validation, sign, verify
- `tools/sign-manifest.mjs` / `tools/verify-manifest.mjs`
- `manifests/` — signed manifests for our 7 mainnet agents, each signed by
  its own agent wallet (agentIds 26520–26526, the same ones on 8004scan)
- `test/manifest.js` — round-trip, tamper, foreign-key and delegated-key cases

## What this is NOT (honest scope)

- The manifest is **self-asserted metadata** — the signature proves "the
  holder of this key wrote this", not that the claims inside are true.
  Reputation still comes only from receipts.
- `version` ordering is a convention for consumers; nothing on-chain
  enforces it yet. Registry anchoring (posting manifest hashes into
  ERC-8004 metadata or a small anchor contract) is a later item.
- Key rotation machinery itself is Step 6's next item — the `signingKeys`
  field exists now so rotation does not require a format change later.
