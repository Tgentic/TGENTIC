# Security Policy

TGENTIC's core promise is "no receipt, no reputation" — every public claim
must be checkable on chain. We hold our own code to the same standard:
if you find something that breaks it, we want to hear about it before
it becomes public.

## Scope

In scope:

- `contracts/` — `TGENTIC.sol` (v1), `Receipts.sol` + `Policy.sol` (v2),
  `Heuristics.sol` — as deployed on Robinhood Chain mainnet (chain 4663;
  see `deployments/`)
- `gate/` — the verification gate HTTP service (tally submission,
  `/risk`, static serving)
- `sdk/` and `sdk-python/` — client libraries
- `web/` — the public dapp
- Dependencies only where TGENTIC's usage introduces the flaw

The bootstrap receipts currently on mainnet are team-generated test
activity — manipulating them is expected to be possible in ways that
reflect the test nature, not real adoption. Findings are still welcome.

Already documented and **not** new findings (see `docs/security-review.md`):

- The v1 gate key is a single immutable EOA that can still write v1 state
  (v1 is archived; no live surface reads it)
- The v2 verifier set is team-controlled during the transition to
  independent verifiers
- `used[txHash]` is global per tx hash (one agent receipt per facilitator tx)
- Wildcard CORS on the public read API (by design; no credentials involved)
- Bonds sent during a pending unlock are unrecoverable
- Symbolic bond size (0.5 USDG) — a documented design decision, see
  `docs/experiments-step5.md` EXP-C

## Reporting

**Do not open a public issue for security findings.**

Report privately by opening a
[GitHub Security Advisory](https://github.com/Tgentic/TGENTIC/security/advisories/new)
on this repository. Include:

- what you found and where (file/line, contract address, endpoint)
- a minimal reproduction or proof of concept
- the impact if exploited

Please give us a reasonable window to investigate and fix before any
public disclosure. We will acknowledge reports, keep you updated, and
credit you in the fix notes if you want.

## What we verify before acting

We reproduce findings ourselves where possible — the repo's test suite,
fuzz harnesses (`tools/`), and the immune scanner are the first pass.
Reports that are already-covered informational items above will be
acknowledged and closed with a pointer to the documentation.

## Audits

No external audit has been commissioned yet — see
`docs/external-review-brief.md` for the intake package we prepared for
external reviewers. The self-audit and its limits are in
`docs/security-review.md`. "Self-audited" is not "audited"; treat it
accordingly.
