package main

const landingPage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pulse</title>
<style>
  :root { --bg:#07090d; --card:#0c1016; --card2:#10151d; --line:#1a212c; --line2:#243041; --text:#d7dee8; --muted:#6b7686; --dim:#465162;
          --accent:#22d3ee; --ok:#2ee59d; --bad:#ff4d6d; --mono:"JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace; }
  * { box-sizing:border-box; }
  html { color-scheme:dark; scrollbar-color:var(--line2) transparent; scrollbar-width:thin; }
  body { margin:0; font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--text); background:var(--bg);
         background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
         background-size:40px 40px; background-position:-1px -1px; }
  body::before { content:""; position:fixed; inset:0; background:radial-gradient(ellipse at top,transparent 0%,var(--bg) 70%); pointer-events:none; z-index:0; }
  main { position:relative; z-index:1; max-width:1040px; margin:0 auto; padding:0 24px 40px; }
  .mono, h1, h2, .num, td, th, .label, .value, button, footer, .brand, nav { font-family:var(--mono); }
  .muted { color:var(--muted); }

  .topbar { display:flex; justify-content:space-between; align-items:center; padding:18px 0; margin-bottom:24px; border-bottom:1px solid var(--line); }
  .brand { font-size:14px; letter-spacing:.02em; display:flex; align-items:center; gap:10px; }
  .brand b { color:var(--accent); font-weight:500; }
  .brand .tag { font-size:11px; color:var(--muted); border:1px solid var(--line2); border-radius:4px; padding:2px 6px; }
  nav { display:flex; gap:18px; font-size:12px; }
  nav a { color:var(--muted); } nav a:hover { color:var(--accent); }

  section { background:rgba(12,16,22,.92); border:1px solid var(--line); border-radius:8px; padding:20px; margin-bottom:16px; }
  h2 { margin:0; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
  h2::before { content:"// "; color:var(--accent); }
  .sub { font-size:12px; color:var(--dim); margin-top:4px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }

  .hero { display:flex; align-items:center; gap:22px; flex-wrap:wrap; }
  .pulse { width:64px; height:64px; border-radius:50%; border:1px solid rgba(46,229,157,.35); display:grid; place-items:center; flex:none; position:relative; }
  .pulse::after { content:""; position:absolute; inset:8px; border-radius:50%; border:1px dashed rgba(46,229,157,.25); }
  .pulse span { width:18px; height:18px; border-radius:50%; background:var(--ok); box-shadow:0 0 18px var(--ok); }
  .down .pulse { border-color:rgba(255,77,109,.4); } .down .pulse::after { border-color:rgba(255,77,109,.3); }
  .down .pulse span { background:var(--bad); box-shadow:0 0 18px var(--bad); }
  @media (prefers-reduced-motion:no-preference) { .pulse span { animation:beat 2s ease-in-out infinite; } }
  @keyframes beat { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(.75);opacity:.6} }
  .eyebrow { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  .hero h1 { margin:4px 0 0; font-size:30px; font-weight:500; letter-spacing:-.01em; }
  .hero h1 b { color:var(--ok); font-weight:500; } .down .hero h1 b { color:var(--bad); }
  .hero p { margin:6px 0 0; font-family:var(--mono); font-size:13px; color:var(--muted); }
  .hero p span { color:var(--text); }
  .hero .right { margin-left:auto; display:flex; gap:8px; }

  button { font-size:12px; border-radius:6px; padding:8px 14px; cursor:pointer; border:1px solid var(--line2); background:var(--card2); color:var(--text); letter-spacing:.02em; }
  button.primary { border-color:var(--accent); color:var(--accent); background:rgba(34,211,238,.06); }
  button.danger { border-color:rgba(255,77,109,.5); color:var(--bad); background:rgba(255,77,109,.05); }
  button:hover { filter:brightness(1.25); }

  .ecg-wrap { margin-top:20px; padding-top:16px; border-top:1px dashed var(--line2); }
  .ecg-head { margin-bottom:8px; }
  .ecg-meta { font-family:var(--mono); font-size:11px; color:var(--muted); letter-spacing:.04em; }
  .ecg-meta #bpm { color:var(--text); }
  #ecg { display:block; width:100%; height:84px; border-radius:6px; background:
         linear-gradient(rgba(46,229,157,.05) 1px,transparent 1px) 0 0/100% 14px,
         linear-gradient(90deg,rgba(46,229,157,.05) 1px,transparent 1px) 0 0/14px 100%, #080b10;
         border:1px solid var(--line); }
  .down #ecg { background:
         linear-gradient(rgba(255,77,109,.05) 1px,transparent 1px) 0 0/100% 14px,
         linear-gradient(90deg,rgba(255,77,109,.05) 1px,transparent 1px) 0 0/14px 100%, #0b080a; }
  .checks { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px; margin-top:20px; padding-top:18px; border-top:1px dashed var(--line2); }
  .checks > div { background:var(--card2); border:1px solid var(--line); border-radius:6px; padding:10px 12px; }
  .checks .st { font-size:12px; margin-top:4px; font-family:var(--mono); }

  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  @media (max-width:760px) { .stats { grid-template-columns:repeat(2,1fr); } nav { display:none; } }
  .stat { background:rgba(12,16,22,.92); border:1px solid var(--line); border-radius:8px; padding:16px; position:relative; overflow:hidden; }
  .stat::before { content:""; position:absolute; left:0; top:0; width:2px; height:100%; background:var(--accent); opacity:.6; }
  .label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.12em; }
  .num { font-size:26px; font-weight:500; margin-top:6px; }

  .fleet { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:10px; margin-top:16px; }
  .rep { background:var(--card2); border:1px solid var(--line); border-radius:8px; padding:12px 14px; position:relative; overflow:hidden; transition:border-color .3s, opacity .3s; }
  .rep::before { content:""; position:absolute; left:0; top:0; width:2px; height:100%; background:var(--ok); }
  .rep.fail { border-color:rgba(255,77,109,.45); } .rep.fail::before { background:var(--bad); }
  .rep.down { opacity:.6; border-style:dashed; } .rep.down::before { background:var(--dim); }
  .rep-top { display:flex; align-items:center; gap:8px; font-family:var(--mono); font-size:13px; }
  .rep-top .dot { width:8px; height:8px; border-radius:50%; background:var(--ok); box-shadow:0 0 8px var(--ok); flex:none; }
  .rep.fail .dot { background:var(--bad); box-shadow:0 0 8px var(--bad); }
  .rep.down .dot { background:var(--dim); box-shadow:none; }
  @media (prefers-reduced-motion:no-preference) { .rep.down .dot { animation:beat 1s ease-in-out infinite; } }
  .tags { margin-left:auto; display:flex; gap:4px; }
  .tag { font-size:10px; color:var(--accent); border:1px solid rgba(34,211,238,.4); border-radius:4px; padding:1px 5px; white-space:nowrap; }
  .tag.re { color:#f5b84b; border-color:rgba(245,184,75,.45); }
  .rep-meta { font-family:var(--mono); font-size:11px; color:var(--muted); margin-top:6px; }
  .rep-state { font-family:var(--mono); font-size:12px; margin-top:6px; letter-spacing:.06em; color:var(--ok); }
  .rep.fail .rep-state { color:var(--bad); } .rep.down .rep-state { color:var(--muted); }
  .mini { display:block; width:100%; height:34px; margin-top:10px; border-radius:4px; background:#080b10; border:1px solid var(--line); }
  .rep-btns { display:flex; gap:6px; margin-top:10px; }
  .rep-btns button { padding:4px 10px; font-size:11px; }
  .strip { display:flex; gap:3px; height:40px; align-items:stretch; margin-top:16px; }
  .strip i { flex:1; border-radius:1px; background:var(--ok); opacity:.75; }
  .strip i:last-child { opacity:1; box-shadow:0 0 8px var(--ok); }
  .strip i.f { background:var(--bad); opacity:1; }
  .strip i.e { background:var(--line); opacity:1; box-shadow:none; }
  .legend { display:flex; justify-content:space-between; font-size:11px; margin-top:8px; font-family:var(--mono); color:var(--dim); }

  table { width:100%; border-collapse:collapse; font-size:12px; margin-top:14px; }
  th { text-align:left; font-weight:400; color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:.12em; padding:0 10px 10px; border-bottom:1px solid var(--line2); }
  td { padding:9px 10px; border-bottom:1px solid var(--line); white-space:nowrap; color:#b8c2cf; }
  tbody tr:hover td { background:rgba(34,211,238,.03); }
  td.reason { white-space:normal; color:var(--bad); }
  .scroll { max-height:340px; overflow:auto; }
  .ok { color:var(--ok); } .fail { color:var(--bad) !important; }
  .pill { display:inline-flex; align-items:center; gap:6px; color:var(--ok); }
  .pill::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; }
  .pill.fail { color:var(--bad); }
  .src { color:var(--accent); }

  .info { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:1px; margin-top:16px; background:var(--line); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .info > div { background:var(--card); padding:12px 14px; }
  .value { margin-top:5px; font-size:13px; word-break:break-all; color:var(--text); }
  footer { color:var(--dim); font-size:11px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; padding-top:8px; }
  a { color:var(--accent); text-decoration:none; }
</style>
</head>
<body>
<main id="root">
  <div class="topbar">
    <div class="brand"><b>&#9673;</b> pulse <span class="muted" style="font-size:12px">// container health</span> <span class="tag" id="tag-ver">v-</span></div>
    <nav><a href="/healthz">/healthz</a><a href="/info">/info</a><a href="/api/health-logs">/api/health-logs</a></nav>
  </div>
  <section>
    <div class="hero">
      <div class="pulse"><span></span></div>
      <div>
        <div class="eyebrow">System status</div>
        <h1>Container is <b id="status-word">...</b></h1>
        <p>id <span id="cid">...</span> &nbsp;·&nbsp; uptime <span id="uptime">...</span> &nbsp;·&nbsp; v<span id="ver">...</span></p>
      </div>
      <div class="right">
        <button id="crash" class="danger" hidden>Crash container</button>
        <button id="sim" class="danger" hidden>Simulate failure</button>
        <button id="check-now" class="primary">&#9656; Run check</button>
      </div>
    </div>
    <div class="ecg-wrap">
      <div class="row ecg-head">
        <h2>Heartbeat &middot; this replica</h2>
        <span class="ecg-meta"><span id="bpm">0</span> checks/min &nbsp;·&nbsp; <span id="signal" class="ok">signal ok</span></span>
      </div>
      <canvas id="ecg" aria-label="Heartbeat line: each spike is a health check" role="img"></canvas>
    </div>
    <div class="checks" id="checks"></div>
  </section>

  <div class="stats">
    <div class="stat"><div class="label">Total checks</div><div class="num" id="s-total">0</div></div>
    <div class="stat"><div class="label">Success rate</div><div class="num" id="s-rate">-</div></div>
    <div class="stat"><div class="label">Failures</div><div class="num" id="s-fails">0</div></div>
    <div class="stat"><div class="label">Last check</div><div class="num" id="s-last">-</div></div>
  </div>

  <section>
    <div class="row">
      <h2>Fleet</h2>
      <span class="legend" style="margin:0" id="fleet-sum">discovering replicas...</span>
    </div>
    <div class="sub">Every replica of the service, found via Docker DNS &middot; scale with <span class="mono" style="color:var(--accent)">docker compose up -d --scale pulse=N</span></div>
    <div class="fleet" id="fleet"></div>
    <div class="sub" id="fleet-empty" hidden>No replicas found.</div>
  </section>

  <section>
    <div class="row"><h2>Recent checks</h2><span class="legend" style="margin:0" id="strip-count"></span></div>
    <div class="strip" id="strip"></div>
    <div class="legend"><span>&larr; older</span><span>newest &rarr;</span></div>
  </section>

  <section>
    <h2>Health log</h2>
    <div class="sub">GET /healthz &mdash; docker HEALTHCHECK every 15s, dashboard, or external probes</div>
    <div class="scroll">
      <table>
        <thead><tr><th>Time</th><th>Status</th><th>Source</th><th>Container</th><th>Latency</th><th>Memory</th><th>Uptime</th></tr></thead>
        <tbody id="logs"></tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Runtime</h2>
    <div class="info" id="info"></div>
  </section>

  <footer><span>pulse · scratch image · go · zero dependencies</span><span id="updated"></span></footer>
</main>
<script>
const $ = id => document.getElementById(id);
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function ago(t){ const s = Math.max(0, Math.round((Date.now() - new Date(t)) / 1000)); return s < 60 ? s + "s ago" : Math.round(s/60) + "m ago"; }
let simOn = false;

async function runCheck() {
  try {
    const r = await fetch("/healthz", {headers:{"X-Healthcheck":"ui"}});
    const d = await r.json();
    const ok = d.status === "ok";
    $("root").classList.toggle("down", !ok);
    $("status-word").textContent = ok ? "healthy" : "unhealthy";
    document.title = (ok ? "Healthy" : "UNHEALTHY") + " · Pulse · " + d.host;
    $("checks").innerHTML = d.checks.map(c =>
      '<div><div class="label">'+esc(c.name)+'</div><div class="st"><span class="'+(c.status==="ok"?"ok":"fail")+'">'+(c.status==="ok"?"Pass":"Fail")+'</span> <span class="muted">· '+esc(c.detail)+'</span></div></div>').join("");
  } catch (e) {
    $("root").classList.add("down");
    $("status-word").textContent = "unreachable";
  }
}

async function loadLogs() {
  const d = await (await fetch("/api/health-logs")).json();
  const logs = d.logs || [];
  simOn = d.simulate_fail;
  $("sim").textContent = simOn ? "Stop simulated failure" : "Simulate failure";
  $("s-total").textContent = d.total_checks;
  $("s-fails").textContent = d.total_fails;
  $("s-fails").className = "num" + (d.total_fails ? " fail" : "");
  $("s-rate").textContent = d.total_checks ? (100 * (d.total_checks - d.total_fails) / d.total_checks).toFixed(1) + "%" : "-";
  $("s-last").textContent = logs.length ? ago(logs[logs.length-1].time) : "-";

  const slots = 100, pad = Math.max(0, slots - logs.length);
  $("strip").innerHTML = '<i class="e"></i>'.repeat(pad) + logs.slice(-slots).map(l =>
    '<i class="'+(l.status==="ok"?"":"f")+'" title="'+esc(new Date(l.time).toLocaleTimeString()+" · "+l.status+" · "+l.source)+'"></i>').join("");
  $("strip-count").textContent = "last " + Math.min(logs.length, slots) + " of " + d.total_checks;

  $("logs").innerHTML = logs.length ? logs.slice().reverse().map(l =>
    '<tr><td>'+new Date(l.time).toLocaleTimeString()+'</td>'+
    '<td><span class="pill '+(l.status==="ok"?"":"fail")+'">'+(l.status==="ok"?"OK":"FAIL")+'</span></td>'+
    '<td class="src">'+esc(l.source)+'</td><td class="mono">'+esc(l.host)+'</td>'+
    '<td>'+l.latency_ms.toFixed(2)+' ms</td><td>'+esc(l.mem_mb)+' MB</td><td>'+esc(l.uptime)+'</td></tr>'+
    (l.fail_reason ? '<tr><td></td><td colspan="6" class="reason">'+esc(l.fail_reason)+'</td></tr>' : '')).join("")
    : '<tr><td colspan="7" class="muted">No checks yet.</td></tr>';
}

async function loadInfo() {
  const d = await (await fetch("/info")).json();
  $("cid").textContent = d.container_id_short;
  $("uptime").textContent = d.uptime;
  $("ver").textContent = d.app_version; $("tag-ver").textContent = "v" + d.app_version;
  $("sim").hidden = !d.demo_mode;
  $("crash").hidden = !d.demo_mode;
  demoMode = d.demo_mode;
  const f = [["Hostname",d.hostname],["Container ID",d.container_id_short],["IP address",(d.ip_addresses||[]).join(", ")||"n/a"],
    ["OS / arch",d.os+" / "+d.arch],["CPUs",d.cpus],["Memory (MB)",d.mem_alloc_mb],
    ["Goroutines",d.goroutines],["Go version",d.go_version],["PID",d.pid],["Started (UTC)",d.started_at.replace("T"," ").replace("Z","")]];
  $("info").innerHTML = f.map(([l,v]) => '<div><div class="label">'+l+'</div><div class="value mono">'+esc(v)+'</div></div>').join("");
}

async function refresh() {
  try { await Promise.all([loadLogs(), loadInfo()]); $("updated").textContent = "refresh 5s · last sync " + new Date().toLocaleTimeString(); }
  catch (e) { $("updated").textContent = "Connection lost, retrying..."; $("root").classList.add("down"); $("status-word").textContent = "unreachable"; }
}

$("crash").addEventListener("click", async () => {
  $("crash").textContent = "Crashing...";
  try { await fetch("/api/crash", {method:"POST"}); } catch (e) {}
  setTimeout(() => { $("crash").textContent = "Crash container"; }, 4000);
});
$("check-now").addEventListener("click", async () => { await runCheck(); refresh(); });
$("sim").addEventListener("click", async () => {
  await fetch("/api/simulate", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({fail:!simOn})});
  await runCheck(); refresh();
});

// ---------- Heartbeat monitor ----------
// Each real /healthz call = a full spike (red if it failed). Between checks, a small
// beat every second shows the connection is alive. No connection = flat line.
const cv = $("ecg"), ctx = cv.getContext("2d");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COLORS = ["#2ee59d", "#ff4d6d", "#3a4452"]; // ok, fail, no signal
const SPEED = 60; // px per second
let W = 0, H = 0, buf = [], pending = [], lastTotal = -1, signal = true, curColor = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = Math.max(1, cv.clientWidth); H = Math.max(1, cv.clientHeight);
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  while (buf.length < W) buf.unshift({y: 0, c: curColor});
  if (buf.length > W) buf = buf.slice(-W);
}

// ECG-like shape (P wave, QRS spike, T wave) as keypoints, then interpolated per pixel.
const SHAPE = [[0,0],[4,0],[8,.1],[12,0],[16,0],[18,-.14],[22,1],[26,-.32],[29,0],[34,0],[40,.2],[46,0],[50,0]];
function beat(amp, c, irregular) {
  const out = [];
  for (let i = 0; i < SHAPE.length - 1; i++) {
    const [x0, y0] = SHAPE[i], [x1, y1] = SHAPE[i + 1];
    for (let x = x0; x < x1; x++) {
      let y = (y0 + (y1 - y0) * (x - x0) / (x1 - x0)) * amp;
      if (irregular) y += (Math.random() - .5) * .25 * amp;
      out.push({y, c});
    }
  }
  if (irregular) { // add an extra skipped/early beat feel
    for (let i = 0; i < 8; i++) out.push({y: 0, c});
    out.push(...beat(amp * .5, c, false).slice(14, 32));
  }
  return out;
}

function queueBeat(amp, failed) {
  if (pending.length > 400) return; // don't build an endless backlog
  for (let i = 0; i < 6; i++) pending.push({y: 0, c: failed ? 1 : 0});
  pending.push(...beat(amp, failed ? 1 : 0, failed));
}

function nextSample() {
  if (pending.length) return pending.shift();
  if (!signal) return {y: 0, c: 2};
  return {y: (Math.random() - .5) * .015, c: curColor};
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  const base = H * .66, scale = H * .52;
  ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.lineCap = "round";
  let i = 0;
  while (i < buf.length - 1) { // draw runs of the same colour as one glowing path
    const c = buf[i].c; ctx.beginPath(); ctx.moveTo(i, base - buf[i].y * scale);
    let j = i + 1;
    for (; j < buf.length; j++) { ctx.lineTo(j, base - buf[j].y * scale); if (buf[j].c !== c) break; }
    ctx.strokeStyle = COLORS[c]; ctx.shadowColor = COLORS[c]; ctx.shadowBlur = c === 2 ? 0 : 8;
    ctx.stroke(); i = j;
  }
  const last = buf[buf.length - 1]; // glowing head
  ctx.beginPath(); ctx.arc(buf.length - 1, base - last.y * scale, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = COLORS[last.c]; ctx.shadowBlur = last.c === 2 ? 0 : 14; ctx.fill();
  ctx.shadowBlur = 0;
  // fade the oldest part of the trace on the left
  ctx.globalCompositeOperation = "destination-out";
  const g = ctx.createLinearGradient(0, 0, W * .25, 0);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W * .25, H);
  ctx.globalCompositeOperation = "source-over";
}

let lastT = performance.now(), carry = 0;
function frame(t) {
  const dt = Math.min(.1, (t - lastT) / 1000);
  carry += dt * SPEED; lastT = t;
  stepMinis(dt);
  let n = Math.floor(carry); carry -= n;
  while (n-- > 0) { buf.push(nextSample()); if (buf.length > W) buf.shift(); }
  draw();
  requestAnimationFrame(frame);
}

async function pollPulse() {
  try {
    const d = await (await fetch("/api/pulse?since=" + lastTotal, {cache: "no-store"})).json();
    if (!signal) { signal = true; $("signal").textContent = "signal ok"; $("signal").className = "ok"; runCheck(); refresh(); }
    curColor = d.status === "ok" ? 0 : 1;
    if (lastTotal >= 0 && d.new.length) d.new.forEach(s => queueBeat(1, s !== "ok"));
    else queueBeat(.28, d.status !== "ok"); // idle "connection alive" beat
    lastTotal = d.total;
    $("bpm").textContent = d.per_min;
  } catch (e) {
    signal = false; pending = []; curColor = 2;
    $("signal").textContent = "signal lost"; $("signal").className = "fail";
    $("root").classList.add("down"); $("status-word").textContent = "unreachable";
  }
  if (reduceMotion) { // no animation: just append the samples and redraw once
    while (pending.length) { buf.push(pending.shift()); }
    for (let i = 0; i < 20; i++) buf.push(nextSample());
    buf = buf.slice(-W); draw();
  }
}

resize();
addEventListener("resize", () => { resize(); draw(); });
if (!reduceMotion) requestAnimationFrame(frame);
pollPulse(); setInterval(pollPulse, 1000);

// ---------- Fleet panel ----------
// One card per replica, each with its own mini heartbeat: tall spike = that replica's
// health check, small beat = it answered the 1s poll, red = unhealthy, flat = down.
// Cards stay for 60s after a replica disappears so you can watch it come back.
let demoMode = false;
const seen = {};
const MINI_SPEED = 45;

function mkCard(s) {
  s.el = document.createElement("div");
  s.el.className = "rep";
  s.el.innerHTML = '<div class="rep-top"><span class="dot"></span><span class="rid"></span><span class="tags"></span></div>' +
    '<canvas class="mini" aria-hidden="true"></canvas><div class="rep-meta"></div><div class="rep-state"></div><div class="rep-btns"></div>';
  s.cv = s.el.querySelector("canvas"); s.ctx = s.cv.getContext("2d"); s.w = 0; s.h = 0;
}
function miniResize(s) {
  const dpr = window.devicePixelRatio || 1, w = Math.max(1, s.cv.clientWidth), h = Math.max(1, s.cv.clientHeight);
  if (w === s.w && h === s.h) return;
  s.w = w; s.h = h; s.cv.width = w * dpr; s.cv.height = h * dpr; s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  while (s.buf.length < w) s.buf.unshift({y: 0, c: s.color});
  if (s.buf.length > w) s.buf = s.buf.slice(-w);
}
function miniQueue(s, amp, failed) {
  if (s.pending.length > 300) return;
  for (let i = 0; i < 4; i++) s.pending.push({y: 0, c: failed ? 1 : 0});
  s.pending.push(...beat(amp, failed ? 1 : 0, failed));
}
function miniNext(s) {
  if (s.pending.length) return s.pending.shift();
  if (s.color === 2) return {y: 0, c: 2};
  return {y: (Math.random() - .5) * .02, c: s.color};
}
function drawMini(s) {
  const g = s.ctx, H = s.h, base = H * .7, sc = H * .58;
  g.clearRect(0, 0, s.w, H); g.lineWidth = 1.3; g.lineJoin = "round";
  let i = 0;
  while (i < s.buf.length - 1) {
    const c = s.buf[i].c; g.beginPath(); g.moveTo(i, base - s.buf[i].y * sc);
    let j = i + 1;
    for (; j < s.buf.length; j++) { g.lineTo(j, base - s.buf[j].y * sc); if (s.buf[j].c !== c) break; }
    g.strokeStyle = COLORS[c]; g.shadowColor = COLORS[c]; g.shadowBlur = c === 2 ? 0 : 6; g.stroke(); i = j;
  }
  g.shadowBlur = 0;
}
let miniCarry = 0;
function stepMinis(dt) {
  miniCarry += dt * MINI_SPEED;
  let n = Math.floor(miniCarry); miniCarry -= n;
  for (const s of Object.values(seen)) {
    if (!s.cv || !s.el.isConnected) continue;
    miniResize(s);
    for (let k = 0; k < n; k++) { s.buf.push(miniNext(s)); if (s.buf.length > s.w) s.buf.shift(); }
    drawMini(s);
  }
}

async function loadFleet() {
  let d;
  try { d = await (await fetch("/api/fleet", {cache:"no-store"})).json(); } catch (e) { return; }
  const now = Date.now(), live = new Set();
  for (const r of d.replicas) {
    if (!r.id) continue;
    let s = seen[r.id];
    const failed = r.status !== "ok";
    if (!s) {
      s = seen[r.id] = {restarts:0, prevUp:r.uptime_s, prevChecks:r.checks, downSince:0, buf:[], pending:[], color: failed ? 1 : 0};
      mkCard(s);
    } else {
      const restarted = r.uptime_s < s.prevUp;
      if (restarted) s.restarts++;
      const fresh = Math.max(0, Math.min(3, r.checks - (restarted ? 0 : s.prevChecks)));
      if (fresh) for (let k = 0; k < fresh; k++) miniQueue(s, 1, failed);
      else miniQueue(s, .3, failed);
    }
    s.color = failed ? 1 : 0; s.r = r; s.prevUp = r.uptime_s; s.prevChecks = r.checks; s.downSince = 0;
    live.add(r.id);
  }
  for (const s of Object.values(seen)) if (!live.has(s.r.id) && !s.downSince) { s.downSince = now; s.pending = []; s.color = 2; }

  const fl = $("fleet");
  let up = 0, healthy = 0;
  for (const [id, s] of Object.entries(seen).sort((a, b) => a[0].localeCompare(b[0]))) {
    const gone = !live.has(id), r = s.r;
    if (gone && now - s.downSince > 60000) { s.el.remove(); delete seen[id]; continue; }
    if (!gone) { up++; if (r.status === "ok") healthy++; }
    s.el.className = "rep " + (gone ? "down" : (r.status === "ok" ? "" : "fail"));
    s.el.querySelector(".rid").textContent = id;
    s.el.querySelector(".tags").innerHTML = (r.self ? '<span class="tag">this page</span>' : '') +
      (s.restarts ? '<span class="tag re">restarted &times;' + s.restarts + '</span>' : '');
    s.el.querySelector(".rep-meta").innerHTML = esc(r.ip || r.addr) + ' &middot; up ' + (gone ? "-" : esc(r.uptime));
    s.el.querySelector(".rep-state").innerHTML = gone ? "DOWN &middot; restarting..." : (r.status === "ok" ? "HEALTHY" : "UNHEALTHY");
    s.el.querySelector(".rep-btns").innerHTML = (demoMode && !gone) ?
      '<button class="danger" data-act="kill" data-addr="' + esc(r.addr) + '">Kill</button>' +
      '<button data-act="' + (r.simulate_fail ? "recover" : "fail") + '" data-addr="' + esc(r.addr) + '">' + (r.simulate_fail ? "Recover" : "Fail") + '</button>' : '';
    fl.appendChild(s.el); // keeps sorted order; canvas is preserved
    if (reduceMotion) { miniResize(s); while (s.pending.length) s.buf.push(s.pending.shift()); for (let k = 0; k < 20; k++) s.buf.push(miniNext(s)); s.buf = s.buf.slice(-s.w); drawMini(s); }
  }
  $("fleet-empty").hidden = up > 0 || Object.keys(seen).length > 0;
  $("fleet-sum").textContent = up + (up === 1 ? " replica" : " replicas") + " up · " + healthy + " healthy";
}

$("fleet").addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  b.disabled = true; b.textContent = "...";
  try {
    await fetch("/api/fleet/action", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({addr: b.dataset.addr, action: b.dataset.act})});
  } catch (err) {}
  setTimeout(loadFleet, 250);
});
loadFleet(); setInterval(loadFleet, 1000);

runCheck().then(refresh);
setInterval(refresh, 5000);
setInterval(runCheck, 30000);
</script>
</body>
</html>`
