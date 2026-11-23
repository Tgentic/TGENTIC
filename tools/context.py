#!/usr/bin/env python3
"""TGENTIC context tool — print what this repository is, where things live,
and what state the framework is in, without reading every file.

Built for two readers: a new contributor deciding where to start, and an
AI agent (or script) that needs the project context in one call. Reads
only the working tree — no network, no dependencies beyond the standard
library.

Usage:
  python3 tools/context.py          # human-readable briefing
  python3 tools/context.py --json   # the same facts as JSON
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# What each part of the repository is, in one line each.
COMPONENTS = {
    "contracts": "Solidity: TGENTIC.sol (tally + bond + slash) and MockToken.sol (tests only).",
    "gate": "Node verifier service: checks a USDG tx hash on chain, verifies the payer's signature, then tallies. Serves web/dist in the single-container deploy.",
    "agent-example": "A minimal x402-paid agent (express + official @x402/* packages) that charges USDG per job.",
    "web": "Landing page + dapp (React, viem, Privy login): lookup, leaderboard, bond.",
    "test": "Hardhat suites: contract behavior and the gate's HTTP + verification paths.",
    "scripts": "Deploy scripts (mainnet 4663 / testnet 46630) and a full testnet demo flow.",
    "deployments": "Addresses written by the deploy scripts, one JSON per chain.",
    "tools": "Repo tooling: immune.py (security scan) and this context briefing.",
}

# How the pieces connect, in payment order.
FLOW = [
    "client asks an agent for a job -> agent answers HTTP 402: pay first (x402)",
    "payer signs a gasless USDG transfer -> facilitator settles it -> tx hash",
    "payer signs a 1-5 rating over (chain, agent, tx, rating)",
    "gate verifies the tx on chain + the signature -> tally(agent, payer, tx, amount, rating)",
    "score is only readable while the agent's bond stays at or above minBond",
]

SKIP_DIRS = {".git", "node_modules", "dist", "cache", "artifacts", "__pycache__", ".github"}


def roadmap_state():
    """Phases and per-phase progress parsed from ROADMAP.md."""
    path = ROOT / "ROADMAP.md"
    if not path.exists():
        return []
    phases = []
    current = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## Step"):
            title = line.removeprefix("## ").strip()
            current = {"title": title, "shipped": "shipped" in title.lower(), "done": 0, "total": 0}
            phases.append(current)
        elif current is not None and line.startswith("- ["):
            current["total"] += 1
            current["done"] += line.startswith("- [x]")
    return phases


def changelog_version():
    path = ROOT / "CHANGELOG.md"
    if not path.exists():
        return None
    m = re.search(r"^## (\S+)", path.read_text(encoding="utf-8"), re.MULTILINE)
    return m.group(1) if m else None


def count_tests():
    """Count `it(...)` cases across the suites."""
    total = 0
    for pattern in ("test/*.js", "agent-example/test/*.js"):
        for f in ROOT.glob(pattern):
            total += len(re.findall(r"\bit\s*\(", f.read_text(encoding="utf-8")))
    return total


def detect(paths):
    return [p for p in paths if (ROOT / p).exists()]


def build_facts():
    phases = roadmap_state()
    return {
        "project": "TGENTIC",
        "tagline": "No receipt, no reputation.",
        "what": "On-chain reputation framework for AI agents: a score only counts work someone actually paid for.",
        "version": changelog_version(),
        "license": "MIT" if (ROOT / "LICENSE").exists() else None,
        "ci": ".github/workflows/test.yml" if (ROOT / ".github" / "workflows" / "test.yml").exists() else None,
        "tests_declared": count_tests(),
        "steps": [
            {
                "title": p["title"],
                "status": ("shipped" if p["shipped"] else
                           "in progress" if p["done"] else "planned"),
                "progress": f"{p['done']}/{p['total']}",
            }
            for p in phases
        ],
        "components": {k: v for k, v in COMPONENTS.items() if (ROOT / k).exists()},
        "flow": FLOW,
        "entrypoints": {
            "run tests": "npm install && npm test",
            "run the gate": "cd gate && cp .env.example .env && npm start",
            "run the agent example": "cd agent-example && cp .env.example .env && npm start",
            "run the dapp": "cd web && npm install && npm run dev",
            "security scan": "python3 tools/immune.py",
            "this briefing": "python3 tools/context.py",
        },
        "present": detect(["CONTRIBUTING.md", "ROADMAP.md", "CHANGELOG.md", "LICENSE", ".env.example"]),
    }


def human(facts):
    out = [f"TGENTIC — {facts['tagline']}", "", facts["what"], ""]
    out.append(f"version: {facts['version']}   license: {facts['license']}   CI: {'yes' if facts['ci'] else 'no'}   tests declared: {facts['tests_declared']}")
    out.append("")
    out.append("steps:")
    for p in facts["steps"]:
        out.append(f"  [{'x' if p['status'] == 'shipped' else ' '}] {p['title']}  ({p['status']}, {p['progress']} items)")
    out.append("")
    out.append("how a payment becomes reputation:")
    for step in facts["flow"]:
        out.append(f"  1. {step}" if step == facts["flow"][0] else f"     {step}")
    out.append("")
    out.append("repository map:")
    for name, desc in facts["components"].items():
        out.append(f"  {name + ':':15} {desc}")
    out.append("")
    out.append("start here:")
    for label, cmd in facts["entrypoints"].items():
        out.append(f"  {label + ':':20} {cmd}")
    out.append("")
    out.append(f"docs present: {', '.join(facts['present'])}")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="TGENTIC project context briefing.")
    ap.add_argument("--json", action="store_true", help="output JSON instead of text")
    args = ap.parse_args()
    facts = build_facts()
    print(json.dumps(facts, indent=2) if args.json else human(facts))


if __name__ == "__main__":
    main()
