# Contributing

Thanks for looking in. The bar is simple: keep the framework honest —
a score must always trace back to a real payment.

## Before you start

- Node.js 20 or later.
- `npm install` at the root, `npm test` — everything must stay green.
- Each sub-app (`gate/`, `web/`, `agent-example/`) has its own
  `package.json` and installs separately.

## Working on it

- Keep commits focused; write the message in English.
- Follow the existing style: small functions, comments only where the
  intent is not obvious.
- Never commit secrets. `.env` files are ignored; copy the matching
  `.env.example` instead. `tools/immune.py` scans the tree and history
  — run it before opening a pull request:

  ```bash
  python3 tools/immune.py --fast
  ```

## Pull requests

- One change per pull request, with tests where behavior changes.
- Contract or gate changes must keep the full suite green
  (`npm test`, `cd agent-example && npm test`, `cd web && npm run build`).
- Describe what problem the change solves and how you verified it.

## Where to discuss

- Bugs and feature requests: open an issue.
- Security findings: please open a private report instead of a public
  issue if the details could put live deployments at risk.
