/**
 * qa-test.js — Automated QA runner for AD371 Week 8 (async-api-queue)
 *
 *   npm test                 concise output
 *   npm test -- --verbose    also streams worker logs and every status poll
 *   (or set QA_VERBOSE=1)
 *
 * Prerequisites, left running by this script: Redis (Docker) on 127.0.0.1:6379
 * and the API (node api.js) on http://localhost:3000. Do not run worker.js
 * separately: the runner starts and stops its own worker subprocess and aborts
 * if another worker is consuming the "jobs" queue.
 *
 * Safety: only the worker process spawned here is ever stopped. No jobs are
 * deleted and Redis is never flushed. Uses Node built-ins plus bullmq.
 */

"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { Queue } = require("bullmq");

// --- Configuration ----------------------------------------------------------
const API = "http://localhost:3000";
const REDIS = { host: "127.0.0.1", port: 6379 };
const QUEUE_NAME = "jobs";
const WORKER_SCRIPT = path.join(__dirname, "worker.js");

const LATENCY_LIMIT_MS = 100; // Test 1 requirement — not loosened
const JOB_DURATION_MS = 5000; // worker.js simulated processing time
const POLL_MS = 250;
const BURST_SIZE = 5;
const OFFLINE_JOBS = 2;
const OFFLINE_HOLD_MS = 3000;
const RETRY_TASK = "TEST_RETRY_FAILURE"; // worker.js matches this exact string
const EXPECTED_ATTEMPTS = 3;

const VERBOSE = process.argv.includes("--verbose") || process.env.QA_VERBOSE === "1";
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const taskName = (label) => `QA-${RUN_ID} ${label}`;

// --- Output -----------------------------------------------------------------
const TESTS = [
  "Asynchronous decoupling",
  "Burst traffic and queue buffering",
  "Worker stop and recovery",
  "Failure and retry handling",
  "API and broker health",
];
const results = []; // { test, name, pass, detail }
let currentTest = 0;
const t0 = performance.now();

const out = (msg = "") => console.log(msg);
const info = (msg) => out(`  ${msg}`);
const debug = (msg) => VERBOSE && out(`    · ${msg}`);
const ms = (n) => `${n.toFixed(1)} ms`;
const secs = (n) => `${(n / 1000).toFixed(2)} s`;
const sleep = (n) => new Promise((r) => setTimeout(r, n));

function section(n) {
  currentTest = n;
  out("");
  out(`[${n}/${TESTS.length}] ${TESTS[n - 1]}`);
}

function check(name, pass, detail = "") {
  results.push({ test: currentTest, name, pass, detail });
  const label = pass ? "PASS" : "FAIL";
  out(`  ${label}  ${detail ? `${name.padEnd(46)} ${detail}` : name}`);
  return pass;
}

// --- HTTP -------------------------------------------------------------------
async function request(method, urlPath, body) {
  const start = performance.now();
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const elapsed = performance.now() - start;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, ms: elapsed };
}

async function submitJob(task) {
  const r = await request("POST", "/api/jobs", { task });
  const id = r.body && r.body.jobId != null ? String(r.body.jobId) : "";
  return { ...r, id };
}

/** Poll GET /api/jobs/:id until a terminal status. Returns the compressed status path. */
async function pollJob(id, { timeoutMs, until = ["completed", "failed"] }) {
  const start = performance.now();
  const statuses = [];
  let body = null;
  while (performance.now() - start < timeoutMs) {
    const r = await request("GET", `/api/jobs/${id}`);
    body = r.body;
    const status = r.status === 200 && body ? body.status : `HTTP ${r.status}`;
    if (statuses[statuses.length - 1] !== status) {
      statuses.push(status);
      debug(`job ${id}: ${status} (+${secs(performance.now() - start)})`);
    }
    // api.js reads job data and job state in two calls; a poll landing between them can
    // report "completed" with result null. Re-poll once the data catches up.
    const settling = status === "completed" && body?.result == null;
    if (settling) debug(`job ${id}: completed but result not yet readable, re-polling`);
    if (until.includes(status) && !settling) {
      return { status, body, statuses, elapsed: performance.now() - start };
    }
    await sleep(POLL_MS);
  }
  return {
    status: statuses[statuses.length - 1] || "unknown",
    body,
    statuses,
    elapsed: performance.now() - start,
    timedOut: true,
  };
}

const describePath = (p) =>
  `${p.statuses.join(" → ")} (${secs(p.elapsed)}${p.timedOut ? ", TIMED OUT" : ""})`;

// --- Redis health (raw RESP PING; no extra packages) ------------------------
function redisPing() {
  return new Promise((resolve) => {
    const sock = net.createConnection(REDIS);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ ok: false, reply: "timeout" });
    }, 3000);
    sock.on("connect", () => sock.write("PING\r\n"));
    sock.on("data", (d) => {
      clearTimeout(timer);
      sock.end();
      const reply = d.toString().trim();
      resolve({ ok: reply === "+PONG", reply });
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, reply: e.message });
    });
  });
}

// --- Worker subprocess (only the one this runner spawns) --------------------
const queue = new Queue(QUEUE_NAME, { connection: REDIS });
const workerLog = []; // all output from runner-owned workers (always captured)
let worker = null;
let workerGeneration = 0;

function captureLines(stream, gen) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line) continue;
      workerLog.push(line);
      if (VERBOSE) out(`    [worker#${gen}] ${line}`);
    }
  });
}

async function waitFor(fn, timeoutMs, intervalMs = 200) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function startWorker() {
  if (worker) throw new Error("runner already owns a running worker");
  const gen = ++workerGeneration;
  const marker = workerLog.length;
  // node is spawned directly (no shell), so child.pid is exactly the worker
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  worker = child;
  child.exited = new Promise((r) => child.once("exit", () => r()));
  child.once("exit", () => {
    if (worker === child) worker = null;
  });
  captureLines(child.stdout, gen);
  captureLines(child.stderr, gen);

  const ready = await waitFor(
    async () =>
      workerLog.slice(marker).some((l) => l.includes("Background worker started")) &&
      (await queue.getWorkers()).length >= 1,
    15000
  );
  if (!ready) throw new Error(`worker #${gen} did not register with Redis within 15 s`);
  return child.pid;
}

/** Graceful stop: wait until no job is active, then end only our child process. */
async function stopWorker({ waitIdleMs = 60000 } = {}) {
  if (!worker) return null;
  const child = worker;
  await waitFor(async () => (await queue.getActiveCount()) === 0, waitIdleMs, POLL_MS);
  child.kill();
  await Promise.race([child.exited, sleep(10000)]);
  if (worker === child) worker = null;
  await waitFor(async () => (await queue.getWorkers()).length === 0, 10000);
  return child.pid;
}

function killOwnedWorkerSync() {
  if (worker && worker.exitCode === null) {
    try {
      worker.kill();
    } catch {
      /* already gone */
    }
  }
}

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killOwnedWorkerSync();
  try {
    await Promise.race([queue.close(), sleep(3000)]);
  } catch {
    /* ignore */
  }
  process.exit(code);
}
process.on("SIGINT", () => {
  out("\nInterrupted — stopping the runner's own worker only.");
  shutdown(130);
});
process.on("SIGTERM", () => shutdown(143));
process.on("exit", killOwnedWorkerSync);

const logCount = (needle) => workerLog.filter((l) => l.includes(needle)).length;
const countsLine = (c) =>
  `waiting ${c.waiting} · active ${c.active} · delayed ${c.delayed} · completed ${c.completed} · failed ${c.failed}`;
const getCounts = () => queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");

// --- Pre-flight --------------------------------------------------------------
const ctx = { backlog: 0, t1JobId: null, t4JobId: null, seen: new Set() };
const jobTimeout = (n) => (ctx.backlog + n) * JOB_DURATION_MS + 15000;

async function preflight() {
  out("Pre-flight");
  const ping = await redisPing();
  if (!ping.ok) {
    info(`Redis ${REDIS.host}:${REDIS.port} not reachable (${ping.reply}). Start the container and re-run.`);
    return false;
  }
  info(`Redis   PING → ${ping.reply}`);

  try {
    const r = await request("GET", `/api/jobs/qa-preflight-${RUN_ID}`);
    info(`API     reachable (HTTP ${r.status})`);
  } catch (e) {
    info(`API not reachable at ${API} (${e.cause?.code || e.message}). Start it with: node api.js`);
    return false;
  }

  const others = await queue.getWorkers();
  if (others.length > 0) {
    info(`ABORT: ${others.length} other worker(s) consuming "${QUEUE_NAME}" (${others.map((w) => w.addr).join(", ")}).`);
    info("Stop the worker in your other terminal (Ctrl+C) and re-run; Test 3 needs sole control.");
    return false;
  }
  info("Workers none competing; the runner will manage its own");

  const c = await getCounts();
  ctx.backlog = c.waiting + c.active + c.delayed;
  info(`Queue   ${countsLine(c)}`);
  if (ctx.backlog > 0) info(`NOTE    ${ctx.backlog} pre-existing pending job(s) run first; timeouts extended`);
  return true;
}

// --- Test 1: Asynchronous decoupling ----------------------------------------
async function test1() {
  section(1);
  const task = taskName("T1 decoupling");
  const r = await submitJob(task);
  info(`job ${r.id || "?"}  POST ${r.status} in ${ms(r.ms)}`);

  check("POST returns HTTP 202", r.status === 202, `got ${r.status}`);
  // Unique = not seen earlier in this run AND BullMQ maps this ID to this run's own task
  const stored = r.id ? await queue.getJob(r.id) : null;
  const ownsId = stored?.data?.task === task;
  check("Job ID is unique and nonempty", r.id !== "" && !ctx.seen.has(r.id) && ownsId,
    `id ${r.id || "(none)"}${r.id && !ownsId ? " (belongs to another job)" : ""}`);
  ctx.seen.add(r.id);
  check(`Response latency < ${LATENCY_LIMIT_MS} ms`, r.ms < LATENCY_LIMIT_MS, ms(r.ms));
  if (!r.id) return;
  ctx.t1JobId = r.id;

  const p = await pollJob(r.id, { timeoutMs: jobTimeout(1) });
  info(`job ${r.id}  ${describePath(p)}`);
  check("Job reaches 'completed'", p.status === "completed", p.status);
  const resultTask = p.body?.result?.task;
  check("Result contains the original task", resultTask === task, resultTask ? "task matches" : "missing");
}

// --- Test 2: Burst traffic and queue buffering -------------------------------
async function test2() {
  section(2);
  const tasks = Array.from({ length: BURST_SIZE }, (_, i) => taskName(`T2 burst #${i + 1}`));
  const subs = await Promise.all(tasks.map((t) => submitJob(t)));
  const ids = subs.map((s) => s.id);
  const lat = subs.map((s) => s.ms);
  info(`jobs ${ids.join(", ")}  ${BURST_SIZE}× POST, ${ms(Math.min(...lat))}–${ms(Math.max(...lat))}`);

  check(`All ${BURST_SIZE} submissions return HTTP 202`, subs.every((s) => s.status === 202),
    subs.map((s) => s.status).join(","));
  const unique = ids.every(Boolean) && new Set(ids).size === ids.length && !ids.some((id) => ctx.seen.has(id));
  check("All job IDs are unique", unique, `${new Set(ids).size}/${ids.length} distinct`);
  ids.forEach((id) => ctx.seen.add(id));

  // Inspect BullMQ immediately after the burst
  const counts = await getCounts();
  const states = await Promise.all(ids.map(async (id) => (await queue.getJob(id))?.getState()));
  const ourWaiting = states.filter((s) => s === "waiting").length;
  const ourActive = states.filter((s) => s === "active").length;
  info(`queue after burst  ${countsLine(counts)}`);
  ids.forEach((id, i) => debug(`job ${id}: ${states[i]}`));
  check("Pending jobs are buffered in the queue (waiting)",
    ourWaiting >= BURST_SIZE - 1 && ourActive <= 1, `burst: ${ourWaiting} waiting, ${ourActive} active`);

  const polls = await Promise.all(ids.map((id) => pollJob(id, { timeoutMs: jobTimeout(BURST_SIZE) })));
  const completed = polls.filter((p) => p.status === "completed").length;
  const matched = polls.filter((p, i) => p.body?.result?.task === tasks[i]).length;
  check(`All ${BURST_SIZE} jobs eventually complete with their own task`,
    completed === BURST_SIZE && matched === BURST_SIZE,
    `${completed}/${BURST_SIZE} completed, ${matched}/${BURST_SIZE} results match`);

  // Sequential processing via BullMQ timestamps (concurrency 1)
  const jobs = (await Promise.all(ids.map((id) => queue.getJob(id)))).filter(Boolean);
  jobs.sort((a, b) => a.processedOn - b.processedOn);
  let sequential = jobs.length === BURST_SIZE;
  for (let i = 1; i < jobs.length; i++) {
    if (jobs[i].processedOn < jobs[i - 1].finishedOn) sequential = false;
  }
  const avg = jobs.length
    ? jobs.reduce((sum, j) => sum + (j.finishedOn - j.processedOn), 0) / jobs.length
    : 0;
  info(`processing order  ${jobs.map((j) => j.id).join(" → ")}  (avg ${secs(avg)} each)`);
  check("Jobs processed sequentially (no overlap, concurrency 1)", sequential);
}

// --- Test 3: Worker stop and recovery ----------------------------------------
async function test3() {
  section(3);
  const pid = await stopWorker();
  const registered = (await queue.getWorkers()).length;
  info(`worker stopped (pid ${pid}) after it was idle`);
  check("Worker stopped (no workers registered on queue)", registered === 0, `${registered} registered`);

  const health = ctx.t1JobId ? await request("GET", `/api/jobs/${ctx.t1JobId}`) : { status: 0, ms: 0 };
  check("API still responds while worker is offline", health.status === 200,
    `GET job ${ctx.t1JobId} → ${health.status} in ${ms(health.ms)}`);

  const tasks = Array.from({ length: OFFLINE_JOBS }, (_, i) => taskName(`T3 offline #${i + 1}`));
  const subs = [];
  for (const t of tasks) subs.push(await submitJob(t));
  const ids = subs.map((s) => s.id);
  ids.forEach((id) => ctx.seen.add(id));
  info(`jobs ${ids.join(", ")}  submitted offline, POST ${subs.map((s) => ms(s.ms)).join(" / ")}`);
  check("Both offline submissions return HTTP 202", subs.every((s) => s.status === 202),
    subs.map((s) => s.status).join(","));

  await sleep(OFFLINE_HOLD_MS);
  const statuses = await Promise.all(ids.map((id) => request("GET", `/api/jobs/${id}`)));
  const states = await Promise.all(ids.map(async (id) => (await queue.getJob(id))?.getState()));
  const waitingCount = await queue.getWaitingCount();
  info(`after ${OFFLINE_HOLD_MS / 1000} s offline  API: ${statuses.map((s) => s.body?.status).join(", ")}` +
    `  ·  BullMQ: ${states.join(", ")}  ·  waiting count ${waitingCount}`);
  check("Both jobs remain queued while worker is offline",
    statuses.every((s) => s.body?.status === "queued") && states.every((s) => s === "waiting"));

  const newPid = await startWorker();
  info(`worker restarted (pid ${newPid})`);
  const polls = await Promise.all(ids.map((id) => pollJob(id, { timeoutMs: jobTimeout(OFFLINE_JOBS) })));
  ids.forEach((id, i) => info(`job ${id}  ${describePath(polls[i])}`));
  const recovered = polls.every((p, i) => p.status === "completed" && p.body?.result?.task === tasks[i]);
  check("Both jobs complete after restart — none lost", recovered,
    `${polls.filter((p) => p.status === "completed").length}/${OFFLINE_JOBS} completed`);
  info("scope: recovery of jobs queued during a graceful stop, not a crash mid-job");
}

// --- Test 4: Failure and retry handling --------------------------------------
async function test4() {
  section(4);
  const r = await submitJob(RETRY_TASK);
  info(`job ${r.id || "?"}  ${RETRY_TASK}  POST ${r.status} in ${ms(r.ms)}`);
  check("Retry-test job accepted (HTTP 202)", r.status === 202, `got ${r.status}`);
  if (!r.id) return;
  ctx.t4JobId = r.id;
  ctx.seen.add(r.id);

  const p = await pollJob(r.id, { timeoutMs: jobTimeout(1) + 10000, until: ["failed", "completed"] });
  await sleep(500); // let final worker log lines flush
  info(`job ${r.id}  ${describePath(p)}`);

  const attemptsSeen = logCount(`Processing job ${r.id}:`);
  const failuresSeen = logCount(`Simulated failure for job ${r.id}`);
  check("Worker attempted processing", attemptsSeen >= 1, `${attemptsSeen} attempt(s) logged`);
  check(`BullMQ performed configured retries (${EXPECTED_ATTEMPTS} attempts)`,
    attemptsSeen === EXPECTED_ATTEMPTS && failuresSeen === EXPECTED_ATTEMPTS,
    `${attemptsSeen} attempts, ${failuresSeen} failures logged`);
  check("Final status is 'failed'", p.status === "failed", p.status);
  check(`attemptsMade equals ${EXPECTED_ATTEMPTS}`, p.body?.attemptsMade === EXPECTED_ATTEMPTS,
    `attemptsMade ${p.body?.attemptsMade}`);
  check("Failure reason is reported", typeof p.body?.error === "string" && p.body.error.length > 0,
    `"${p.body?.error}"`);

  const state = await (await queue.getJob(r.id))?.getState();
  info(`BullMQ state "${state}"; retained via removeOnFail: false (no separate dead-letter queue)`);
}

// --- Test 5: API and broker health -------------------------------------------
async function test5() {
  section(5);
  const ping = await redisPing();
  check("Redis is reachable (PING → PONG)", ping.ok, ping.reply);

  const known = ctx.t1JobId ? await request("GET", `/api/jobs/${ctx.t1JobId}`) : { status: 0, ms: 0 };
  check("API responds to requests", known.status > 0, ms(known.ms));
  check("GET known job ID returns HTTP 200", known.status === 200, `job ${ctx.t1JobId} → ${known.status}`);

  const invalid = [
    { label: "missing task", body: {} },
    { label: "blank task", body: { task: "   " } },
    { label: "non-string task", body: { task: 123 } },
  ];
  for (const c of invalid) {
    const r = await request("POST", "/api/jobs", c.body);
    check(`Invalid payload (${c.label}) returns HTTP 400`, r.status === 400, `${r.status} in ${ms(r.ms)}`);
  }

  const nf = await request("GET", `/api/jobs/qa-missing-${RUN_ID}`);
  check("Unknown job ID returns HTTP 404", nf.status === 404, `${nf.status} in ${ms(nf.ms)}`);

  const expectedLogs = [
    "Background worker started",
    ctx.t1JobId && `Processing job ${ctx.t1JobId}:`,
    ctx.t1JobId && `COMPLETED: Job ${ctx.t1JobId}`,
    ctx.t4JobId && `Simulated failure for job ${ctx.t4JobId}`,
    ctx.t4JobId && `Job ${ctx.t4JobId} failed:`,
  ].filter(Boolean);
  const missing = expectedLogs.filter((n) => logCount(n) === 0);
  check("Relevant worker logs are visible", missing.length === 0,
    missing.length ? `missing: ${missing.join(" | ")}` : `${workerLog.length} lines captured`);
  // Show the matching worker log lines (first match for each) so they are visible without --verbose
  expectedLogs.forEach((n) => {
    const line = workerLog.find((l) => l.includes(n));
    if (line) info(`worker log  ${line}`);
  });
  info("manual step: inspect POST /api/jobs (202) and GET /api/jobs/:id (200) in browser DevTools → Network");
}

// --- Main --------------------------------------------------------------------
async function runTest(n, fn) {
  try {
    await fn();
  } catch (e) {
    currentTest = n;
    check("Test ran without an unexpected error", false, e.message);
  }
}

function summary() {
  out("");
  out("Summary");
  TESTS.forEach((title, i) => {
    const rs = results.filter((r) => r.test === i + 1);
    const passed = rs.filter((r) => r.pass).length;
    const ok = rs.length > 0 && passed === rs.length;
    out(`  ${ok ? "PASS" : "FAIL"}  [${i + 1}/${TESTS.length}] ${title.padEnd(36)} ${passed}/${rs.length} checks`);
  });
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    out("");
    out("Failed checks");
    failed.forEach((r) => out(`  [${r.test}/${TESTS.length}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`));
  }
  out("");
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  out(`${results.length - failed.length}/${results.length} checks passed in ${elapsed} s`);
  out(failed.length === 0 ? "RESULT: ALL TESTS PASSED" : `RESULT: ${failed.length} CHECK(S) FAILED`);
  return failed.length;
}

async function main() {
  out("AD371 Week 8 · Async API QA Runner");
  out(`run ${RUN_ID} · Node ${process.version} · ${API} · Redis ${REDIS.host}:${REDIS.port}` +
    `${VERBOSE ? " · verbose" : ""}`);
  out("");

  if (!(await preflight())) {
    out("\nPre-flight failed — no tests were run.");
    return shutdown(2);
  }
  try {
    const pid = await startWorker();
    info(`Worker  started by runner (pid ${pid})`);
  } catch (e) {
    info(`Could not start worker: ${e.message}`);
    return shutdown(2);
  }

  await runTest(1, test1);
  await runTest(2, test2);
  await runTest(3, test3);
  await runTest(4, test4);
  await runTest(5, test5);

  const pid = await stopWorker({ waitIdleMs: 15000 });
  out("");
  out(`Cleanup: ${pid ? `runner worker stopped (pid ${pid})` : "no runner worker left running"}; ` +
    "API and Redis left running; no jobs deleted.");

  const failed = summary();
  return shutdown(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal runner error:", e);
  shutdown(1);
});
