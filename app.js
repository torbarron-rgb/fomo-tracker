// ===== Config (edit me) =====
const DEPOSITED_USD = 39.82;
const SOL_WALLET = "7BQKwDkic5gjQmFRJwiAr7P4KrYzAmBHUEaCv7yXb4sP";
const EVM_WALLET = "0x789d01bc529eE2346A4F6abF78a6D37F1B3B770B";
const REFRESH_MS = 15000;
const DUST_USD = 0.01;
// EVM tokens can't be auto-discovered keylessly; list contracts to check here (chain: "bsc" | "base").
const EVM_TOKENS = [
  { chain: "bsc", address: "0x14F6A94909C407854390Aa2d2462a3095D317777" }, // 旺柴 WangChai
];
const EVM_RPC = { bsc: "https://bsc-rpc.publicnode.com", base: "https://base-rpc.publicnode.com" };
const NATIVE = { bsc: { sym: "BNB", wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }, base: { sym: "ETH", wrapped: "0x4200000000000000000000000000000000000006" } };
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
// ============================

const $ = id => document.getElementById(id);
const fmt = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(2) + "K" : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
let last = null, lastOk = 0;
$("dep").textContent = fmt(DEPOSITED_USD);

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
      if (!out[a] || liq > out[a].liq) out[a] = { liq, price: +p.priceUsd || 0, ch: p.priceChange?.h24, url: p.url, img: p.info?.imageUrl, sym: p.baseToken.symbol, name: p.baseToken.name };
    }
  }
  return out;
}

async function loadSolana() {
  const bal = await j(`https://lite-api.jup.ag/ultra/v1/balances/${SOL_WALLET}`);
  const mints = Object.keys(bal).map(k => k === "SOL" ? WSOL : k);
  const px = await dexPrices("solana", mints);
  return Object.entries(bal).map(([k, v]) => {
    const mint = k === "SOL" ? WSOL : k, p = px[mint.toLowerCase()] || {};
    const amt = v.uiAmount || 0;
    const price = mint === USDC_SOL ? 1 : p.price || 0;
    return { chain: "Solana", sym: k === "SOL" ? "SOL" : p.sym || mint.slice(0, 4) + "…", amt, usd: amt * price, ch: mint === USDC_SOL ? 0 : p.ch, url: p.url || `https://dexscreener.com/solana/${mint}`, img: p.img, cash: mint === USDC_SOL };
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
    const px = await dexPrices(chain, [NATIVE[chain].wrapped, ...toks.map(t => t.address)]);
    const n = Number(BigInt(nat)) / 1e18, np = px[NATIVE[chain].wrapped.toLowerCase()] || {};
    out.push({ chain: chain === "bsc" ? "BNB Chain" : "Base", sym: NATIVE[chain].sym, amt: n, usd: n * (np.price || 0), ch: np.ch, url: np.url, img: np.img });
    toks.forEach((t, i) => {
      const amt = Number(BigInt(raws[i * 2])) / 10 ** raws[i * 2 + 1], p = px[t.address.toLowerCase()] || {};
      out.push({ chain: chain === "bsc" ? "BNB Chain" : "Base", sym: p.sym || t.address.slice(0, 6), amt, usd: amt * (p.price || 0), ch: p.ch, url: p.url || `https://dexscreener.com/${chain}/${t.address}`, img: p.img });
    });
  }
  return out;
}

function render(items, errs) {
  const total = items.reduce((s, x) => s + x.usd, 0), cash = items.filter(x => x.cash).reduce((s, x) => s + x.usd, 0);
  const pnl = total - DEPOSITED_USD, pct = pnl / DEPOSITED_USD * 100;
  $("total").textContent = fmt(total);
  $("pnl").className = "pill " + (pnl >= 0 ? "up" : "dn");
  $("pnl").textContent = `${pnl >= 0 ? "+" : "−"}${fmt(Math.abs(pnl))} (${pnl >= 0 ? "+" : ""}${pct.toFixed(2)}%) all time`;
  $("cash").textContent = fmt(cash);
  const shown = items.filter(x => !x.cash && x.usd >= DUST_USD).sort((a, b) => b.usd - a.usd);
  $("tok").textContent = shown.length;
  $("list").innerHTML = shown.length ? shown.map(x => {
    const c = x.ch == null ? `<span class="pill nu">—</span>` : `<span class="pill ${x.ch >= 0 ? "up" : "dn"}">${x.ch >= 0 ? "+" : ""}${(+x.ch).toFixed(2)}%</span>`;
    const esc = s => String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    return `<a class="row" href="${esc(x.url || "#")}" target="_blank" rel="noopener">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : `<div class="ph"></div>`}
      <div class="mid"><div class="sym">${esc(x.sym)}</div><div class="sub">${x.chain} · ${fmtAmt(x.amt)}</div></div>
      <div class="r"><div class="val">${fmt(x.usd)}</div>${c}</div></a>`;
  }).join("") : `<div class="sub">No positions</div>`;
}

let lastTraders = null;
async function loadTraders() {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  try {
    const r = await fetch("traders.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    lastTraders = await r.json();
    $("copywarn").style.display = "none";
  } catch (e) {
    $("copywarn").style.display = "block";
    $("copywarn").textContent = "⚠️ Couldn't load traders list" + (lastTraders ? " — showing last loaded." : ".") + " (" + (e.message || e) + ")";
    if (!lastTraders) { $("copylist").innerHTML = ""; return; }
  }
  const ts = (lastTraders.traders || []).slice().sort((a, b) => (a.status === "live" ? 0 : 1) - (b.status === "live" ? 0 : 1));
  const live = ts.filter(t => t.status === "live").length;
  $("copyhd").textContent = `Copying · ${live} live`;
  $("copylist").innerHTML = ts.length ? ts.map((t, i) => {
    const on = t.status === "live";
    return `<div class="tr${i ? "" : " first"}${on ? "" : " paused"}"><div class="mid"><div class="sym">@${esc(t.handle)}</div>
      <div class="sub">${esc([t.size, t.chains].filter(Boolean).join(" · "))}${t.note ? " · " + esc(t.note) : ""}</div></div>
      <span class="pill ${on ? "up" : "nu"}">${on ? "Live" : "Paused"}</span></div>`;
  }).join("") : `<div class="sub">No traders</div>`;
  const u = lastTraders.updated ? new Date(lastTraders.updated) : null;
  $("copyfoot").textContent = u && !isNaN(u) ? "Updated " + u.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

async function refresh() {
  loadTraders();
  $("ref").textContent = "↻ …";
  const res = await Promise.allSettled([loadSolana(), loadEvm()]);
  const errs = res.filter(r => r.status === "rejected").map(r => r.reason?.message || r.reason);
  last = last || [[], []];
  res.forEach((r, i) => { if (r.status === "fulfilled") last[i] = r.value; });
  render(last.flat(), errs);
  if (!errs.length) lastOk = Date.now();
  $("warn").style.display = errs.length ? "block" : "none";
  $("warn").textContent = errs.length ? "⚠️ Some data failed to update — showing last good data. (" + errs.join("; ") + ")" : "";
  $("dot").className = "dot" + (errs.length ? " off" : "");
  $("upd").textContent = (errs.length ? "Stale · " : "Live · ") + new Date(lastOk || Date.now()).toLocaleTimeString();
  $("ref").textContent = "↻ Refresh";
}
$("ref").onclick = refresh;
refresh(); setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
