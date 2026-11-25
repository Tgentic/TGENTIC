#!/usr/bin/env python3
"""TGENTIC immune layer — repo self-defense scanner.

Checks a repository for the attack surfaces that matter to this project:

  secrets    private keys, API tokens, JWTs — in the working tree AND every commit
  tracked    files that must never be tracked (.env, node_modules, build output)
  gitignore  .gitignore coverage of the sensitive paths
  lockfiles  every lockfile dependency carries an integrity hash
  supply     dependency names against a known-malicious list + typosquat heuristics
  authors    commit authors against an allowlist (unexpected identity = red flag)
  plaintext  http:// URLs in production code (TLS downgrade surface)

Usage:
  python3 tools/immune.py            # full scan (history + tree)
  python3 tools/immune.py --fast     # HEAD only (pre-push mode)
  python3 tools/immune.py --allow-author "Name <email>"

Exit code 0 = clean, 1 = findings, 2 = usage error.
Stdlib only: no network access, no dependencies.
"""

import argparse
import json
import os
import re
import subprocess
import sys

FAILED = []

SECRET_PATTERNS = [
    ("evm-private-key", re.compile(r"0x[0-9a-fA-F]{64}\b"), "CRITICAL"),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "CRITICAL"),
    ("openai-or-generic-api-key", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"), "CRITICAL"),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "CRITICAL"),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."), "HIGH"),
]

# Known public hex values that look like keys to the regex above but are not secrets:
# the secp256k1 half-order constant (standard ECDSA malleability guard — split in two so
# this file does not flag itself) and on-chain identifiers stored under identifier-shaped
# JSON keys (transaction hashes are 32 bytes, the same shape as a private key).
_HALF_ORDER = "7fffffffffffffffffffffffffffffff" + "5d576e7357a4501ddfe92f46681b20a0"
# Verifiably public chain artifacts (on the public explorer / in event signatures),
# not secrets: the secp256k1 half-order, our mainnet payment + tally txs, and the
# Tallied event topic hash that test fixtures legitimately embed.
SAFE_HEX_VALUES = {
    "0x" + _HALF_ORDER,
    "0x44d4be1951fe871593f4e4dd25d9b34c2f048150fa707bb721b84284f0736096",
    "0x2d475b2ab23a66c9bdf6c5608b247e2b81d272c6e9e5e2cc8af32509e34b9daf",
    "0x9daa2ff566b975dcfccd8073c33e394c4596081ec4ea918cb29f390268ab2a9e",
}
JSON_IDENTIFIER_KEY = re.compile(r'"(receipts|policy|wire|heuristic\w*|deploy\w*|tx\w*|\w*hash\w*|\w*root|block\w*|proof\w*|verifier\w*)"\s*:', re.IGNORECASE)


def is_false_positive_hex(value, line):
    if value.lower() in SAFE_HEX_VALUES:
        return True
    return bool(JSON_IDENTIFIER_KEY.search(line))

# Deliberately noisy patterns get a low ceiling: too short = false positives.
SCAN_EXTENSIONS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".sol", ".json",
                   ".md", ".html", ".css", ".yml", ".yaml", ".env", ".sh", ".py", ".txt"}

NEVER_TRACKED = re.compile(r"(^|/)(\.env|node_modules|dist|cache|artifacts|\.DS_Store)(/|$)")

KNOWN_BAD_PACKAGES = {
    # Publicized supply-chain incidents (non-exhaustive, maintained as they surface).
    "event-stream-poc", "flatmap-stream", "crossenv", "bash-code", "electron-native-api",
}

# Common typosquat shapes for this repo's real dependencies.
REAL_PACKAGES = {"express", "viem", "react", "react-dom", "chai", "dotenv"}

# Legit packages whose names merely resemble a real dependency; verified by hand.
VERIFIED_LEGIT = {"preact", "chai-dom", "@privy-io/chains", "@privy-io/react-auth", "react-router-dom", "react-dom"}


def fail(severity, check, message):
    FAILED.append((severity, check, message))
    print(f"  [{severity}] {check}: {message}")


def ok(check, message):
    print(f"  [ok] {check}: {message}")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True).stdout


def iter_tree_files(repo):
    for path in git(repo, "ls-files").splitlines():
        if path.strip():
            yield path


def scan_blob(name, text, origin, quiet=False):
    """Scan one file's content for secrets. Returns count of findings."""
    hits = 0
    for label, pattern, severity in SECRET_PATTERNS:
        for m in pattern.finditer(text):
            if label == "evm-private-key" and is_false_positive_hex(m.group(0), text[:m.start()].split("\n")[-1]):
                continue
            hits += 1
            if not quiet:
                snippet = text[max(0, m.start() - 20):m.end() + 10].replace("\n", " ")
                fail(severity, "secrets", f"{origin}:{name} matches {label} …{snippet}…")
    return hits


def check_secrets_tree(repo):
    print("== secrets: working tree ==")
    found = 0
    for path in iter_tree_files(repo):
        full = os.path.join(repo, path)
        if not os.path.isfile(full):
            continue
        try:
            with open(full, encoding="utf-8", errors="ignore") as fh:
                found += scan_blob(path, fh.read(), "tree")
        except OSError:
            pass
    if not found:
        ok("secrets", f"no secret patterns in {sum(1 for _ in iter_tree_files(repo))} tracked files")


def check_secrets_history(repo):
    print("== secrets: full history ==")
    commits = git(repo, "rev-list", "--all").split()
    found = 0
    for commit in commits:
        # git grep every pattern per commit; cheap enough for a small repo.
        for label, pattern, severity in SECRET_PATTERNS:
            regex = pattern.pattern
            out = git(repo, "grep", "-lE", regex, commit, "--", ".")
            for line in out.strip().splitlines():
                _, _, path = line.partition(":")
                content = git(repo, "show", f"{commit}:{path}")
                if not content or scan_blob(path, content, "history", quiet=True) == 0:
                    continue  # every match in the file was a filtered false positive
                fail(severity, "secrets-history", f"{commit[:8]} {path} matches {label}")
                found += 1
    if not found:
        ok("secrets-history", f"clean across {len(commits)} commits")


def check_never_tracked(repo):
    print("== tracked files ==")
    found = 0
    for path in iter_tree_files(repo):
        if NEVER_TRACKED.search(path) and not path.endswith((".env.example",)):
            fail("HIGH", "tracked", f"{path} must never be tracked")
            found += 1
    if not found:
        ok("tracked", "no .env / node_modules / build output tracked")


def check_gitignore(repo):
    print("== .gitignore ==")
    gi = os.path.join(repo, ".gitignore")
    if not os.path.isfile(gi):
        fail("MEDIUM", "gitignore", "missing .gitignore")
        return
    text = open(gi, encoding="utf-8").read()
    for needed in (".env", "node_modules"):
        if needed not in text:
            fail("MEDIUM", "gitignore", f"does not cover {needed}")
        else:
            ok("gitignore", f"covers {needed}")


def check_lockfiles(repo):
    print("== lockfiles ==")
    locks = [p for p in iter_tree_files(repo) if p.endswith("package-lock.json")]
    if not locks:
        fail("MEDIUM", "lockfiles", "no package-lock.json found")
        return
    for lock in locks:
        try:
            data = json.load(open(os.path.join(repo, lock), encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            fail("HIGH", "lockfiles", f"{lock} unreadable: {e}")
            continue
        deps = data.get("packages", {})
        missing_integrity = bad_names = 0
        for pkg_path, meta in deps.items():
            if not pkg_path:  # the root entry
                continue
            name = pkg_path.split("node_modules/")[-1]
            if "integrity" not in meta and "link" not in meta:
                fail("HIGH", "lockfiles", f"{lock}: {name} has no integrity hash")
                missing_integrity += 1
            if name in KNOWN_BAD_PACKAGES:
                fail("CRITICAL", "supply", f"{lock}: {name} is a known-malicious package")
                bad_names += 1
            base = name.split("/")[-1]
            if name in VERIFIED_LEGIT or base in VERIFIED_LEGIT:
                continue
            for real in REAL_PACKAGES:
                if base != real and (base.startswith(real) or base.endswith(real)) and len(base) <= len(real) + 3:
                    fail("MEDIUM", "supply", f"{lock}: {name} looks like a typosquat of {real}")
                    bad_names += 1
        total = len(deps)
        if not missing_integrity and not bad_names:
            ok("lockfiles", f"{lock}: {total} packages, all with integrity hashes")


def check_authors(repo, allowed):
    print("== commit authors ==")
    authors = set()
    for line in git(repo, "log", "--format=%an <%ae>").splitlines():
        authors.add(line.strip())
    unexpected = authors - set(allowed) if allowed else set()
    if allowed and unexpected:
        for a in sorted(unexpected):
            fail("HIGH", "authors", f"unexpected commit author: {a}")
    else:
        for a in sorted(authors):
            print(f"  [ok] authors: {a}")


def check_plaintext_urls(repo):
    print("== plaintext URLs in production code ==")
    found = 0
    for path in iter_tree_files(repo):
        if os.path.splitext(path)[1] not in {".js", ".jsx", ".mjs"}:
            continue
        if "/test/" in path or path.endswith(".test.js"):
            continue
        full = os.path.join(repo, path)
        if not os.path.isfile(full):
            continue
        for i, line in enumerate(open(full, encoding="utf-8", errors="ignore"), 1):
            for m in re.finditer(r"http://[^\s\"'`]+", line):
                url = m.group(0)
                if any(h in url for h in ("localhost", "127.0.0.1", "0.0.0.0", "hardhat")) or url.startswith("http://www.w3.org/"):
                    continue  # dev hosts and XML namespaces are not network calls
                fail("MEDIUM", "plaintext-url", f"{path}:{i} {url}")
                found += 1
    if not found:
        ok("plaintext-url", "no http:// URLs outside localhost in production code")


def main():
    ap = argparse.ArgumentParser(description="TGENTIC immune layer scanner")
    ap.add_argument("repo", nargs="?", default=".", help="repository path (default: cwd)")
    ap.add_argument("--fast", action="store_true", help="skip history scan (pre-push mode)")
    ap.add_argument("--allow-author", action="append", default=[],
                    help="expected commit author 'Name <email>' (repeatable)")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    if not os.path.isdir(os.path.join(repo, ".git")):
        print(f"not a git repository: {repo}", file=sys.stderr)
        sys.exit(2)

    print(f"TGENTIC immune layer — scanning {repo}{' (fast mode)' if args.fast else ''}\n")
    check_secrets_tree(repo)
    if not args.fast:
        check_secrets_history(repo)
    check_never_tracked(repo)
    check_gitignore(repo)
    check_lockfiles(repo)
    check_authors(repo, args.allow_author)
    check_plaintext_urls(repo)

    print()
    if FAILED:
        counts = {}
        for severity, _, _ in FAILED:
            counts[severity] = counts.get(severity, 0) + 1
        summary = ", ".join(f"{n} {s}" for s, n in sorted(counts.items()))
        print(f"IMMUNE STATUS: {len(FAILED)} finding(s) — {summary}")
        sys.exit(1)
    print("IMMUNE STATUS: clean — no findings")
    sys.exit(0)


if __name__ == "__main__":
    main()
