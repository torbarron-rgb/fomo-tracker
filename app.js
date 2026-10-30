// ===== Config (edit me) =====
const DEPOSITED_USD = 67.13; // Total deposited: $57.52 + $9.61 detected Oct 18 ~13:36 UTC (USDC $0.88 -> $10.491276 on-chain via Jupiter, SOL 0, no holdings sold)
const REALIZED_PNL_USD = -21.81; // Dawn realised −$21.81 on $268.09 invested (06:15 Madrid 30 Oct); 08:11 PIZZA 50% sell not yet reflected
// Robinhood chain is tracked via EVM_TOKENS (PIZZA).
const SOL_WALLET = "7BQKwDkic5gjQmFRJwiAr7P4KrYzAmBHUEaCv7yXb4sP";
const EVM_WALLET = "0x789d01bc529eE2346A4F6abF78a6D37F1B3B770B";
const MAX_CAP_USD = 3; // Cap per trade (single source for cash-ready check)
const TRADE_FEE_BUFFER_USD = 0.35; // Fee/slippage buffer on top of cap
const CASH_NEED_USD = MAX_CAP_USD + TRADE_FEE_BUFFER_USD; // $3.35 needed for one trade
const IDEAL_CASH_MIN_USD = 7, IDEAL_CASH_MAX_USD = 10; // Ideal cash buffer hint
const REFRESH_MS = 15000;
const DUST_USD = 0.10; // Holdings under $0.10 are dust: hidden and excluded from Total
const SANITY_MAX_USD = DEPOSITED_USD; // A position with no cost basis priced above this is treated as a bad price (excluded)
// Only trust DexScreener pairs quoted in these majors (a ZEC/AVEN pool once priced ZEC at $6.2M -> 0.0000187 ZEC = $116)
const GOOD_QUOTES = new Set(["SOL","WSOL","USDC","USDT","USDG","USD1","PYUSD","WETH","ETH","WBNB","BNB","CBBTC","WBTC"]);
// EVM tokens can't be auto-discovered keylessly; list contracts to check here (chain: "bsc" | "base").
const EVM_TOKENS = [
  { chain: "bsc", address: "0x14F6A94909C407854390Aa2d2462a3095D317777" }, // 旺柴 WangChai
  { chain: "robinhood", address: "0xd086f891229cD123aAdfCAe7C4b40150A80fd9D7" }, // PIZZA (Robinhood chain)
];
const EVM_RPC = { bsc: "https://bsc-rpc.publicnode.com", base: "https://base-rpc.publicnode.com", robinhood: "https://robinhood-rpc.publicnode.com" };
const NATIVE = { bsc: { sym: "BNB", wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }, base: { sym: "ETH", wrapped: "0x4200000000000000000000000000000000000006" }, robinhood: { sym: "ETH", wrapped: null } };
const CHAIN_NAME = { bsc: "BNB Chain", base: "Base", robinhood: "Robinhood" };
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
// ============================

const APP_VERSION = "20261030-0820-dustfix"; // Keep in sync with version.json + index.html ?v=
async function checkUpdate() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const remote = (await r.json()).version;
    if (remote && remote !== APP_VERSION && sessionStorage.getItem("fomo-updated-to") !== remote) {
      sessionStorage.setItem("fomo-updated-to", remote);
      location.replace(location.pathname + "?u=" + encodeURIComponent(remote)); // query-busts HTML fetch; same path/icon, no re-add
    }
  } catch (e) {}
}
const $ = id => document.getElementById(id);
const fmt = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(2) + "K" : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
let last = null, lastOk = 0, COSTS = {}, ACT = null;
const TCOL = ["#007aff","#ff9500","#af52de","#34c759","#ff2d55","#5ac8fa","#a2845e","#5856d6"];
const tcol = t => { let h = 0; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TCOL[h % TCOL.length]; };
const sgn = n => (n >= 0 ? "+" : "−") + fmt(Math.abs(n));
$("dep").textContent = fmt(DEPOSITED_USD);
if ($("rpnl")) { $("rpnl").textContent = sgn(REALIZED_PNL_USD); $("rpnl").style.color = REALIZED_PNL_USD >= 0 ? "#15803d" : "#dc2626"; }

async function j(url, opts) {
  const r = await fetch(url, { cache: "no-store", ...opts });
  if (!r.ok) throw new Error(url.split("/")[2] + " HTTP " + r.status);
  return r.json();
}
const rpc = (url, method, params) => j(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then(d => { if (d.error) throw new Error(d.error.message); return d.result; });

async function dexPrices(chain, addrs) {
  const out = {};
  for (let i = 0; i < addrs.length; i += 30) {
    const pairs = await j(`https://api.dexscreener.com/tokens/v1/${chain}/${addrs.slice(i, i + 30).join(",")}`);
    for (const p of pairs) {
      const a = p.baseToken.address.toLowerCase(), liq = p.liquidity?.usd || 0;
      if (!GOOD_QUOTES.has(String(p.quoteToken?.symbol || "").toUpperCase())) continue; // skip exotic-quote pools (bad prices)
      if (!out[a] || liq > out[a].liq) out[a] = { liq, price: +p.priceUsd || 0, ch: p.priceChange?.h24, url: p.url, img: p.info?.imageUrl, sym: p.baseToken.symbol, name: p.baseToken.name };
    }
  }
  return out;
}

async function loadSolana() {
  const bal = await j(`https://lite-api.jup.ag/ultra/v1/balances/${SOL_WALLET}`);
  const mints = Object.keys(bal).map(k => k === "SOL" ? WSOL : k);
  const px = await dexPrices("solana", mints).catch(() => ({}));
  // Jupiter price is aggregated across routes; prefer it over a single DexScreener pair
  try {
    const jp = await j(`https://lite-api.jup.ag/price/v3?ids=${mints.slice(0, 50).join(",")}`);
    for (const [m, v] of Object.entries(jp || {})) if (v && v.usdPrice > 0) { const k = m.toLowerCase(); px[k] = { ...(px[k] || {}), price: +v.usdPrice }; }
  } catch (e) {}
  return Object.entries(bal).map(([k, v]) => {
    const mint = k === "SOL" ? WSOL : k, p = px[mint.toLowerCase()] || {};
    const amt = v.uiAmount || 0;
    const price = mint === USDC_SOL ? 1 : p.price || 0;
    return { chain: "Solana", sym: k === "SOL" ? "SOL" : p.sym || mint.slice(0, 4) + "…", amt, usd: amt * price, ch: mint === USDC_SOL ? 0 : p.ch, url: p.url || `https://dexscreener.com/solana/${mint}`, img: p.img, cash: mint === USDC_SOL, addr: mint };
  });
}

async function loadEvm() {
  const out = [], data = "0x70a08231" + EVM_WALLET.slice(2).toLowerCase().padStart(64, "0");
  for (const chain of Object.keys(EVM_RPC)) {
    const toks = EVM_TOKENS.filter(t => t.chain === chain);
    const [nat, ...raws] = await Promise.all([
      rpc(EVM_RPC[chain], "eth_getBalance", [EVM_WALLET, "latest"]),
      ...toks.flatMap(t => [rpc(EVM_RPC[chain], "eth_call", [{ to: t.address, data }, "latest"]), t.decimals != null ? t.decimals : rpc(EVM_RPC[chain], "eth_call", [{ to: t.address, data: "0x313ce567" }, "latest"]).then(h => parseInt(h, 16))])
    ]);
    const px = await dexPrices(chain, [NATIVE[chain].wrapped, ...toks.map(t => t.address)].filter(Boolean));
    const n = Number(BigInt(nat)) / 1e18, np = (NATIVE[chain].wrapped && px[NATIVE[chain].wrapped.toLowerCase()]) || {};
    out.push({ chain: CHAIN_NAME[chain], sym: NATIVE[chain].sym, amt: n, usd: n * (np.price || 0), ch: np.ch, url: np.url, img: np.img });
    toks.forEach((t, i) => {
      const amt = Number(BigInt(raws[i * 2])) / 10 ** raws[i * 2 + 1], p = px[t.address.toLowerCase()] || {};
      out.push({ chain: CHAIN_NAME[chain], sym: p.sym || t.address.slice(0, 6), amt, usd: amt * (p.price || 0), ch: p.ch, url: p.url || `https://dexscreener.com/${chain}/${t.address}`, img: p.img, addr: t.address });
    });
  }
  return out;
}

function render(items, errs) {
  // Drop bad prices: no cost basis and implausibly large vs everything deposited
  items = items.filter(x => x.cash || x.usd <= SANITY_MAX_USD || COSTS[(x.addr || "").toLowerCase()]);
  // Dust (< $0.10) never counts toward Total
  const total = items.filter(x => x.cash || x.usd >= DUST_USD).reduce((s, x) => s + x.usd, 0), cash = items.filter(x => x.cash).reduce((s, x) => s + x.usd, 0);
  const pnl = total - DEPOSITED_USD, pct = pnl / DEPOSITED_USD * 100;
  $("total").textContent = fmt(total);
  $("cash").textContent = fmt(cash);
  if ($("cashready")) {
    const need = CASH_NEED_USD, short = need - cash, ready = cash >= need;
    $("cashready").textContent = ready ? "Ready for next trade" : `Need ${fmt(short)} more for next trade`;
    $("cashready").className = "tsub " + (ready ? "ready" : "low");
    if ($("cashhint")) $("cashhint").textContent = ready
      ? (cash < IDEAL_CASH_MIN_USD ? `Ideal ${fmt(IDEAL_CASH_MIN_USD)}\u2013${fmt(IDEAL_CASH_MAX_USD)} for buffer` : "")
      : `Needs ${fmt(need)} (${fmt(MAX_CAP_USD)} cap + ${fmt(TRADE_FEE_BUFFER_USD)} buffer) \u00b7 Ideal ${fmt(IDEAL_CASH_MIN_USD)}\u2013${fmt(IDEAL_CASH_MAX_USD)}`;
  }
  if ($("netline")) $("netline").innerHTML = `<span class="${pnl >= 0 ? "up" : "dn"}">${sgn(pnl)} (${pnl >= 0 ? "+" : ""}${pct.toFixed(2)}%)</span> <span class="dim">vs ${fmt(DEPOSITED_USD)} deposited</span>`;
  if ($("netval")) { $("netval").textContent = sgn(pnl); $("netval").style.color = pnl >= 0 ? "#15803d" : "#dc2626"; }
  const shown = items.filter(x => !x.cash && x.usd >= DUST_USD).sort((a, b) => b.usd - a.usd);
  if ($("tok")) $("tok").textContent = shown.length;
  let open = 0, best = null;
  shown.forEach(x => { const c = COSTS[(x.addr || "").toLowerCase()]; x.cb = c; if (c && c.cost != null) { x.gain = x.usd - c.cost; open += x.gain; if (!best || x.gain / c.cost > best.g) best = { s: x.sym, g: x.gain / c.cost }; } });
  $("opnl").textContent = sgn(open); $("opnl").style.color = open >= 0 ? "#15803d" : "#dc2626";
  $("best").textContent = best ? `${best.s} ${best.g >= 0 ? "+" : ""}${(best.g * 100).toFixed(0)}%` : "—";
  $("list").innerHTML = shown.length ? shown.map(x => {
    const esc = s => String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    return `<a class="row" href="${esc(x.url || "#")}" target="_blank" rel="noopener">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : `<div class="ph"></div>`}
      <div class="mid"><div class="sym">${esc(x.sym)}</div><div class="sub">${x.chain} · ${fmtAmt(x.amt)}</div>${x.cb?.trader ? `<div class="tg"><i style="background:${tcol(x.cb.trader)}"></i>@${esc(x.cb.trader)}</div>` : ""}</div>
      <div class="r"><div class="val">${fmt(x.usd)}</div>${x.gain != null ? `<div class="cb">Paid ${fmt(x.cb.cost)}</div><div class="cb ${x.gain >= 0 ? "g" : "d"}">${sgn(x.gain)} (${x.gain >= 0 ? "+" : ""}${(x.gain / x.cb.cost * 100).toFixed(0)}%)</div>` : `<div class="cb">Paid —</div>`}</div></a>`;
  }).join("") : `<div class="sub">No positions</div>`;
}

let lastTraders = null;
async function loadTraders() {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  try {
    const r = await fetch(`traders.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    lastTraders = await r.json();
    $("copywarn").style.display = "none";
  } catch (e) {
    $("copywarn").style.display = "block";
    $("copywarn").textContent = "Couldn't load traders list" + (lastTraders ? " — showing last loaded." : ".") + " (" + (e.message || e) + ")";
    if (!lastTraders) { $("copylist").innerHTML = ""; return; }
  }
  const ts = (lastTraders.traders || []).slice().sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1));
  const live = ts.filter(t => t.status === "live").length;
  const sizeLabel = (ts[0] && ts[0].size) ? ts[0].size.replace(" of buy", "") : ""; $("copyhd").textContent = `${live} live` + (sizeLabel ? ` · ${sizeLabel}` : "");
  $("copylist").innerHTML = ts.length ? ts.map((t, i) => {
    const on = t.status === "live";
    return `<div class="tr${i ? "" : " first"}${on ? "" : " paused"}"><span class="tdot" style="background:${tcol(t.handle)}"></span><div class="mid"><div class="sym">@${esc(t.handle)}</div>
      <div class="sub">${esc(t.chains || "")}${t.note ? " · " + esc(t.note) : ""}</div></div>
      <span class="status ${on ? "live" : "paused"}">${on ? "Live" : "Paused"}</span></div>`;
  }).join("") : `<div class="sub">No traders</div>`;
  const u = lastTraders.updated ? new Date(lastTraders.updated) : null;
  $("copyfoot").textContent = u && !isNaN(u) ? "Updated " + u.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

async function loadData() {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  try { const c = await j(`costs.json?t=${Date.now()}`); COSTS = {}; for (const [k, v] of Object.entries(c.coins || {})) COSTS[k.toLowerCase()] = v; } catch (e) {}
  try { ACT = await j(`activity.json?t=${Date.now()}`); } catch (e) {}
  if (ACT) $("actlist").innerHTML = ACT.slice().sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 6).map((a, i) => {
    const d = new Date(a.t);
    return `<div class="ev${i ? "" : " first"}"><span>${esc(a.text)}</span><time>${isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>`;
  }).join("") || `<div class="sub">No activity</div>`;
}
function ago() { if (!lastOk) return; const s = Math.round((Date.now() - lastOk) / 1000); const t = s < 5 ? "just now" : s < 60 ? s + "s ago" : s < 3600 ? Math.floor(s / 60) + "m ago" : Math.floor(s / 3600) + "h ago"; $("upd").textContent = (stale ? "Stale · " : "") + "Updated " + t; }
let stale = false;
async function refresh() {
  loadTraders(); await loadData();
  $("ref").textContent = "Updating…";
  const res = await Promise.allSettled([loadSolana(), loadEvm()]);
  const errs = res.filter(r => r.status === "rejected").map(r => r.reason?.message || r.reason);
  last = last || [[], []];
  res.forEach((r, i) => { if (r.status === "fulfilled") last[i] = r.value; });
  render(last.flat(), errs);
  if (!errs.length) lastOk = Date.now();
  $("warn").style.display = errs.length ? "block" : "none";
  $("warn").textContent = errs.length ? "Some data failed to update — showing last good data. (" + errs.join("; ") + ")" : "";
  $("dot").className = "dot" + (errs.length ? " off" : "");
  stale = !!errs.length; if (!lastOk) $("upd").textContent = "Offline"; ago();
  $("ref").textContent = "Refresh";
}
$("ref").onclick = refresh;
refresh(); setInterval(refresh, REFRESH_MS); setInterval(ago, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkUpdate(); refresh(); } });
checkUpdate();
