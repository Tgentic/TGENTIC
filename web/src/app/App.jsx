import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";
import { api as chainApi } from "./chain.js";
import { flagsFor, FLAG_TEXT } from "./flags.js";
import { HAS_PRIVY } from "./privy.js";
import { useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { api as demoApi } from "./demo.js";
import { mountField } from "../field.js";
import { frameSVG } from "../icons.js";
import { footerHTML } from "../links.js";
import { mountLogoform } from "../logoform.js";
import { Identicon, MarkLoader, PixelBar, PixelIcon, RatingPips, Scramble } from "./pixel.jsx";

// Sample data: automatic on the local dev server (npm run dev) while no contract is configured, unlabeled, for previewing.
// In production builds it is only reachable via ?demo and always labeled, so made-up data never looks real on the public site.
const DEMO = new URLSearchParams(location.search).has("demo") || (import.meta.env.DEV && !chainApi.deployed);
const SHOW_DEMO_LABEL = DEMO && !import.meta.env.DEV;
const api = DEMO ? demoApi : chainApi;
if (DEMO && import.meta.env.DEV) console.info("TGENTIC: local preview with sample data (dev server only, never in a production build).");

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (v, d = 6) => Number(formatUnits(v, d)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tok = (v, d) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const msg = (e) => e?.shortMessage || e?.message || "Unknown error";

function useRoute() {
  const parse = () => { const [n = "lookup", p = ""] = location.hash.replace(/^#\/?/, "").split("/"); return [n || "lookup", p]; };
  const [r, setR] = useState(parse);
  useEffect(() => { const f = () => { setR(parse()); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return r;
}

/** Run an async function and track its state: loading | error | done. */
function useLoad(fn, deps) {
  const [st, setSt] = useState({ s: "loading" });
  const run = () => { setSt({ s: "loading" }); fn().then((data) => setSt({ s: "done", data }), (e) => setSt({ s: "error", text: msg(e) })); };
  useEffect(run, deps);
  return [st, run];
}

const Loading = ({ what }) => <div className="state loading" role="status"><MarkLoader /><span>Reading {what} from the chain…</span></div>;
const Failed = ({ text, retry }) => (
  <div className="state err" role="alert"><p>Could not read the chain: {text}</p>{retry && <button className="btn btn-line" onClick={retry}>Try again</button>}</div>
);
function NotDeployed() {
  return (
    <div className="state" role="status">
      <h2>Contract not deployed yet</h2>
      <p>There is no contract address to read from. Set <code>VITE_TGENTIC_ADDRESS</code> and <code>VITE_DEPLOY_BLOCK</code> in <code>web/.env</code>, or open the <a href="?demo#/lookup">demo</a> to see the dapp with sample data.</p>
    </div>
  );
}
const TxLink = ({ hash }) => (api.explorer ? <a href={`${api.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{short(hash)}</a> : <span className="mute">{short(hash)}</span>);

/* ------------------------------- Lookup ------------------------------- */

function Band({ children }) {
  const ref = useRef(null);
  useEffect(() => (ref.current ? mountField(ref.current, { markFrac: 0.9, minScale: 1, lift: 0, waveY: 0.82 }) : undefined), []);
  return <section className="band"><canvas ref={ref} className="band-field" aria-hidden="true" /><div className="band-copy">{children}</div></section>;
}

function Search() {
  const [q, setQ] = useState("");
  const [bad, setBad] = useState(false);
  const go = (e) => { e.preventDefault(); const t = q.trim(); if (!isAddress(t)) return setBad(true); location.hash = `#/lookup/${getAddress(t)}`; };
  return (
    <form className="search" onSubmit={go}>
      <label htmlFor="agent">Agent address</label>
      <div className="search-row">
        <input id="agent" value={q} onChange={(e) => { setQ(e.target.value); setBad(false); }} placeholder="0x…" autoComplete="off" spellCheck="false" aria-describedby="agent-help" aria-invalid={bad} disabled={!api.deployed} />
        <button className="btn btn-blue" type="submit" disabled={!api.deployed}>Look up</button>
      </div>
      <p id="agent-help" className={`hint ${bad ? "err-text" : ""}`}>{bad ? "That is not a valid address." : "A wallet address starting with 0x, 42 characters."}</p>
      {api.demoAgents && (
        <div className="samples"><span className="hint">Top agents</span>{api.demoAgents.slice(0, 4).map((a) => (
          <a key={a} className="sample" href={`#/lookup/${a}`}><Identicon address={a} size={22} /><span>{short(a)}</span></a>
        ))}</div>
      )}
    </form>
  );
}

function Recent() {
  const [st, retry] = useLoad(() => api.recent(8), []);
  return (
    <section className="block" aria-labelledby="h-recent">
      <h2 id="h-recent">Latest receipts</h2>
      {st.s === "loading" && <Loading what="receipts" />}
      {st.s === "error" && <Failed text={st.text} retry={retry} />}
      {st.s === "done" && (st.data.length === 0 ? <p className="state">No receipts yet. They appear here as the verifier tallies payments.</p> : (
        <ol className="feed">{st.data.map((l, i) => (
          <li key={l.transactionHash + l.logIndex} style={{ "--i": i }}>
            <a href={`#/lookup/${l.args.agent}`} className="feed-row">
              <Identicon address={l.args.agent} size={28} />
              <span className="mono">{short(l.args.agent)}</span>
              <span className="amt">{usd(l.args.amount)} <small>USDG</small></span>
              <RatingPips value={Number(l.args.rating)} />
              <span className="mono mute hide-sm">from {short(l.args.payer)}</span>
              <span className="mono mute hide-sm">#{String(l.blockNumber)}</span>
            </a>
          </li>
        ))}</ol>
      ))}
    </section>
  );
}

function Profile({ a }) {
  const [st, retry] = useLoad(async () => {
    const [d, tk, logs] = await Promise.all([api.readAgent(a), api.readToken(), api.receipts(a)]);
    return { d, tk, logs };
  }, [a]);
  if (st.s === "loading") return <Loading what="this agent" />;
  if (st.s === "error") return <Failed text={st.text} retry={retry} />;
  const { d, tk, logs } = st.data;
  const counted = d.bond >= tk.minBond;
  const payers = [...new Set(logs.map((l) => l.args.payer))];
  const ratio = tk.minBond > 0n ? Math.min(1, Number((d.bond * 1000n) / tk.minBond) / 1000) : 1;
  const risk = logs.length ? flagsFor(a, logs) : null;
  return (
    <article className="profile" aria-label={`Tally for ${a}`}>
      <header className="p-head">
        <Identicon address={a} size={64} />
        <div className="p-id"><p className="label">Agent</p><Scramble text={a} className="p-addr" /></div>
        <a className="btn btn-line" href="#/lookup">New search</a>
      </header>

      <div className="p-score">
        <Scramble text={counted ? usd(d.score) : "0.00"} className="score" duration={900} />
        <p className={counted ? "ok-text" : "warn-text"}>{counted ? "Counted score" : "Score hidden: bond is below the minimum"}</p>
        {!counted && <p className="hint">Raw tally {usd(d.reputation)}, not counted until the bond reaches {tok(tk.minBond, tk.decimals)} {tk.symbol}.</p>}
      </div>

      <dl className="stats">
        <div><dt>Total paid</dt><dd>{usd(d.paid)} <small>USDG</small></dd></div>
        <div><dt>Receipts</dt><dd>{String(d.receipts)}</dd></div>
        <div className={d.receipts > 0n && d.payers === 1n ? "flag" : ""}><dt>Unique payers</dt><dd>{String(d.payers)}</dd>{d.receipts > 0n && d.payers === 1n && <small>One payer only. Treat with care.</small>}</div>
        <div><dt>Bond</dt><dd>{tok(d.bond, tk.decimals)} <small>{tk.symbol}</small></dd></div>
      </dl>

      {risk && (
        <section className="block" aria-label="Manipulation signals">
          <h2>Signals</h2>
          <dl className="stats two">
            <div><dt>Top payer share</dt><dd>{(risk.topPayerShareBps / 100).toFixed(0)}<small>%</small></dd></div>
            <div className={risk.flagged ? "flag" : ""}><dt>Heuristic flags</dt><dd>{risk.flags.length || "none"}</dd></div>
          </dl>
          <ul className="sigs">
            {risk.flags.map((f) => <li key={f}><span className="sig-tag">{f}</span>{FLAG_TEXT[f] || f}</li>)}
          </ul>
          <p className="hint">Signals are heuristics, not verdicts — they mark what deserves a closer look. The same detector runs in the gate at <code>/risk</code>.</p>
        </section>
      )}

      <section className="p-bond" aria-label="Bond against the minimum">
        <PixelBar ratio={ratio} cells={32} label={`Bond ${tok(d.bond, tk.decimals)} of ${tok(tk.minBond, tk.decimals)} ${tk.symbol} minimum`} />
        <p className="hint">{tok(d.bond, tk.decimals)} {tk.symbol} locked, minimum {tok(tk.minBond, tk.decimals)}.{d.unlockAt > 0n && ` Unlock started, withdraw opens ${new Date(Number(d.unlockAt) * 1000).toLocaleDateString()}.`}</p>
      </section>

      {payers.length > 0 && (
        <section className="block">
          <h2>Who paid</h2>
          <ul className="payers">{payers.slice(0, 40).map((p, i) => <li key={p} style={{ "--i": i }} title={p}><Identicon address={p} size={30} /><span className="sr-only">{p}</span></li>)}</ul>
        </section>
      )}

      <section className="block">
        <h2>Receipts</h2>
        {logs.length === 0 ? <p className="state">No verified payments for this agent yet.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th>Block</th><th>Payer</th><th>Amount</th><th>Rating</th><th>Payment tx</th></tr></thead>
              <tbody>{logs.map((l, i) => (
                <tr key={l.transactionHash + l.logIndex} style={{ "--i": Math.min(i, 20) }}>
                  <td className="mono">{String(l.blockNumber)}</td>
                  <td><span className="cell-id"><Identicon address={l.args.payer} size={20} />{short(l.args.payer)}</span></td>
                  <td>{usd(l.args.amount)} <small>USDG</small></td>
                  <td><RatingPips value={Number(l.args.rating)} /></td>
                  <td><TxLink hash={l.args.txHash} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}

function Lookup({ param }) {
  if (param) return <div className="page"><Profile a={param} /></div>;
  return (
    <>
      <Band>
        <h1>Check an agent's tally</h1>
        {!api.deployed ? <NotDeployed /> : <Search />}
      </Band>
      {api.deployed && <div className="page"><Recent /></div>}
    </>
  );
}

/* ------------------------------- Leaderboard ------------------------------- */

function Board() {
  const [st, retry] = useLoad(() => (api.deployed ? api.board() : Promise.resolve(null)), []);
  return (
    <div className="page">
      <div className="page-head">
        <PixelIcon name="tally" size={56} />
        <div><h1>Leaderboard</h1><p className="hint">Ranked by counted score. Unique payers sit next to every score so one-payer agents are easy to spot.</p></div>
      </div>
      {!api.deployed && <NotDeployed />}
      {api.deployed && st.s === "loading" && <Loading what="receipts" />}
      {api.deployed && st.s === "error" && <Failed text={st.text} retry={retry} />}
      {api.deployed && st.s === "done" && (() => {
        const { tk, rows } = st.data;
        const ranked = rows.map((r) => ({ ...r, counted: r.bond >= tk.minBond })).sort((x, y) => Number((y.counted ? y.score : 0n) - (x.counted ? x.score : 0n)));
        const top = ranked.find((r) => r.counted)?.score || 1n;
        if (ranked.length === 0) return <p className="state">No receipts recorded yet. The board fills as the verifier tallies payments.</p>;
        return (
          <ol className="board">{ranked.map((r, i) => (
            <li key={r.a} style={{ "--i": i }}>
              <a className="board-row" href={`#/lookup/${r.a}`}>
                <span className="rank mono">{String(i + 1).padStart(2, "0")}</span>
                <Identicon address={r.a} size={32} />
                <span className="mono">{short(r.a)}</span>
                <PixelBar ratio={r.counted ? Number((r.score * 1000n) / top) / 1000 : 0} cells={20} label={r.counted ? `Score ${usd(r.score)}` : "Score hidden"} />
                <span className="b-score">{r.counted ? usd(r.score) : <span className="warn-text">hidden</span>}</span>
                <span className={`b-payers ${r.payers === 1n ? "warn-text" : ""}`}>
                  {r.flags?.length > 0 && <span className="sig-dot" title={`Flagged: ${r.flags.join(", ")}`} aria-label={`Flagged: ${r.flags.join(", ")}`} />}
                  {String(r.payers)} {r.payers === 1n ? "payer" : "payers"}
                </span>
              </a>
            </li>
          ))}</ol>
        );
      })()}
    </div>
  );
}

/* ------------------------------- Bond ------------------------------- */

function Bond({ acct, onConnect }) {
  const [info, setInfo] = useState(null);
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState(0);

  const load = async (a) => { try { setInfo(await api.bondState(a)); } catch (e) { setNote({ kind: "err", text: msg(e) }); } };
  useEffect(() => { if (acct && api.deployed) load(acct); }, [acct]);
  const connect = async () => { setNote({ kind: "", text: "" }); setBusy(true); try { await onConnect(); } catch (e) { setNote({ kind: "err", text: msg(e) }); } setBusy(false); };
  const send = async (kind, value, label) => {
    setBusy(true); setNote({ kind: "", text: `${label}: confirm in your wallet…` });
    try {
      await api.send(acct, kind, value, info.tk.token);
      setNote({ kind: "ok", text: `${label}: done.${api.live ? "" : " Demo only, no transaction was sent."}` });
      setReplay((n) => n + 1);
      await load(acct);
    } catch (e) { setNote({ kind: "err", text: `${label} failed: ${msg(e)}` }); }
    setBusy(false);
  };

  let value = null;
  if (info && amt) { try { value = parseUnits(amt, info.tk.decimals); } catch { value = null; } }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const unlocking = info && info.d.unlockAt > 0n;
  const canWithdraw = unlocking && now >= info.d.unlockAt;
  const needApprove = info && value !== null && info.allow < value;
  const ratio = info ? Math.min(1, Number((info.d.bond * 1000n) / (info.tk.minBond || 1n)) / 1000) : 0;

  return (
    <div className="page bond-page">
      <div className="bond-intro">
        <PixelIcon name="lock" size={112} replay={replay} />
        <h1>Your bond</h1>
        <p className="hint">Lock tokens so your score can be read. Proven wash-trading burns the bond. Taking it back needs a 7 day unlock.</p>
      </div>
      <div className="bond-panel">
        {!api.deployed && <NotDeployed />}
        {api.deployed && !api.hasWallet() && <p className="state">No browser wallet found. Install one, then reload this page.</p>}
        {api.deployed && api.hasWallet() && !acct && <button className="btn btn-blue big" onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect wallet"}</button>}
        {acct && !info && !note.text && <Loading what="your bond" />}
        {acct && info && (
          <>
            <div className="who"><Identicon address={acct} size={36} /><span className="mono">{short(acct)}</span></div>
            <div className="bond-figure"><Scramble text={tok(info.d.bond, info.tk.decimals)} className="score" /> <span>{info.tk.symbol} locked</span></div>
            <PixelBar ratio={ratio} cells={32} label={`Bond ${tok(info.d.bond, info.tk.decimals)} of ${tok(info.tk.minBond, info.tk.decimals)} minimum`} />
            <dl className="stats two">
              <div><dt>Minimum</dt><dd>{tok(info.tk.minBond, info.tk.decimals)} <small>{info.tk.symbol}</small></dd></div>
              <div><dt>Wallet balance</dt><dd>{tok(info.bal, info.tk.decimals)} <small>{info.tk.symbol}</small></dd></div>
            </dl>
            {unlocking && <p className="hint">Unlock started. Withdraw opens {new Date(Number(info.d.unlockAt) * 1000).toLocaleString()}.</p>}
            <div className="search">
              <label htmlFor="amt">Amount ({info.tk.symbol})</label>
              <input id="amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.0" autoComplete="off" />
              {amt && value === null && <p className="hint err-text">Enter a number, for example 250 or 12.5.</p>}
            </div>
            <div className="actions">
              {needApprove
                ? <button className="btn btn-blue" disabled={busy} onClick={() => send("approve", value, "Approve")}>Approve {info.tk.symbol}</button>
                : <button className="btn btn-blue" disabled={busy || !value} onClick={() => send("deposit", value, "Lock bond")}>Lock bond</button>}
              <button className="btn btn-line" disabled={busy || unlocking} onClick={() => send("startUnlock", 0n, "Start unlock")}>Start 7 day unlock</button>
              <button className="btn btn-line" disabled={busy || !canWithdraw || !value} onClick={() => send("withdraw", value, "Withdraw")}>Withdraw</button>
            </div>
            {!canWithdraw && <p className="hint">Withdraw opens 7 days after you start the unlock.</p>}
          </>
        )}
        <p className={`note ${note.kind}`} role={note.kind === "err" ? "alert" : "status"}>{note.text}</p>
      </div>
    </div>
  );
}

/* ------------------------------- Shell ------------------------------- */

const FOOT = { __html: footerHTML(frameSVG) };

/** The pill's wallet button. Once connected, it becomes a link to that wallet's Bond page. */
function Wallet({ acct, onConnect, onLogout, privy }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(""), 5000); return () => clearTimeout(t); }, [err]);
  const email = privy?.email || "";
  if (acct) return (
    <>
      <a className="wallet on" href="#/bond" title={acct}><Identicon address={acct} size={22} /><span className="mono">{short(acct)}</span></a>
      <button className="wallet" type="button" onClick={onLogout} title={HAS_PRIVY ? "Sign out of Privy" : "Disconnect wallet"}>
        {email || (HAS_PRIVY ? "Sign out" : "Disconnect")}
      </button>
    </>
  );
  const click = async () => {
    if (HAS_PRIVY && !privy?.authenticated) return privy.login();
    setBusy(true); try { await onConnect(); } catch (e) { setErr(msg(e)); } setBusy(false);
  };
  if (HAS_PRIVY && !privy?.ready) return <button className="wallet" type="button" disabled>…</button>;
  return (
    <>
      <button className="wallet" type="button" onClick={click} disabled={busy}>{busy ? "Connecting…" : <>Sign in<span className="wide"> / Connect</span></>}</button>
      {err && <p className="wallet-err" role="alert">{err}</p>}
    </>
  );
}

export default function App() {
  const [name, param] = useRoute();
  const [acct, setAcctState] = useState(() => sessionStorage.getItem("tgentic.acct") || null);
  const setAcct = (a) => {
    if (a) sessionStorage.setItem("tgentic.acct", a);
    else sessionStorage.removeItem("tgentic.acct");
    setAcctState(a);
  };
  const p = HAS_PRIVY ? usePrivy() : null;
  const pw = HAS_PRIVY ? useWallets() : null;
  const pl = HAS_PRIVY ? useLogin() : null;
  const email = p?.user?.email?.address || p?.user?.google?.email || "";
  // Silent auto-connect: once authenticated and the Privy embedded wallet is ready
  // (including after a reload), connect immediately. This prevents the connect popup
  // from reappearing whenever the user clicks manually while the wallet is not yet in state.
  // If the Privy dashboard disables wallet auto-create, create one on demand here.
  const createdRef = useRef(false);
  useEffect(() => {
    if (!HAS_PRIVY || !p?.authenticated) { createdRef.current = false; return; }
    const w = pw?.wallets?.[0];
    if (!w) {
      if (!createdRef.current) {
        createdRef.current = true;
        p.createWallet().catch(() => {}); // already exists/being created — this effect connects once wallets populate
      }
      return;
    }
    let dead = false;
    (async () => {
      try {
        const provider = await w.getEthereumProvider();
        const a = await api.connectPrivy(provider, w.address);
        if (!dead) setAcct(a);
      } catch (e) { console.warn("auto-connect failed:", msg(e)); }
    })();
    return () => { dead = true; };
  }, [HAS_PRIVY, p?.authenticated, pw?.wallets?.length, pw?.wallets?.[0]?.address]);
  // Clear a stale acct: the Privy session is no longer authenticated but the address is still stored.
  useEffect(() => {
    if (HAS_PRIVY && p?.ready && !p?.authenticated && acct) setAcct(null);
  }, [HAS_PRIVY, p?.ready, p?.authenticated, acct]);
  const logout = () => {
    api.disconnect();
    setAcct(null);
    if (HAS_PRIVY && p?.authenticated) p.logout();
  };
  const connect = async (a) => {
    if (HAS_PRIVY && !a) {
      if (!p?.authenticated) { pl.login(); return; }
      // The embedded wallet may not exist yet (the Privy dashboard can disable auto-create),
      // or may still be creating asynchronously. If missing, create it on demand; if present,
      // let the auto-connect effect finish the connection once it is ready.
      let wallet = pw?.wallets[0];
      if (!wallet) {
        try { wallet = await p.createWallet(); }
        catch (e) {
          wallet = pw?.wallets[0]; // being created/linked async — use it once it appears
          if (!wallet) throw e;
        }
      }
      const provider = await wallet.getEthereumProvider();
      a = await api.connectPrivy(provider, wallet.address);
    } else if (!HAS_PRIVY && !a) {
      a = await api.connect();
    }
    setAcct(a); return a;
  };
  const privy = HAS_PRIVY ? { ready: p?.ready ?? false, authenticated: !!p?.authenticated, email, logout: () => p?.logout(), login: () => pl?.login() } : null;
  useEffect(() => mountLogoform(document.querySelector(".foot-field"), { mode: "band" }), []);
  const tabs = [["lookup", "Lookup"], ["board", "Leaderboard"], ["bond", "Bond"]];
  return (
    <>
      <header className="nav">
        <div className="pill">
          <a className="pill-mark" href="/" aria-label="TGENTIC home"><img src="/brand/mark.svg" width="22" height="22" alt="" /><span className="word">TGENTIC</span></a>
          <nav className="tabs" aria-label="Dapp sections">
            {tabs.map(([k, l]) => <a key={k} href={`#/${k}`} aria-current={name === k ? "page" : undefined}>{l}</a>)}
          </nav>
          <span className="net"><i aria-hidden="true" />{api.chainName}</span>
          <Wallet acct={acct} onConnect={connect} onLogout={logout} privy={privy} />
        </div>
      </header>
      {SHOW_DEMO_LABEL && (
        <p className="demo-bar" role="note">Demo data. Sample agents and receipts so you can see the dapp working; none of it is on chain. <a href={location.pathname + location.hash}>Leave demo</a></p>
      )}
      <main className={SHOW_DEMO_LABEL ? "has-demo" : ""}>
        {name === "board" ? <Board /> : name === "bond" ? <Bond acct={acct} onConnect={connect} /> : <Lookup param={param} />}
      </main>
      <footer className="foot" dangerouslySetInnerHTML={FOOT} />
    </>
  );
}
