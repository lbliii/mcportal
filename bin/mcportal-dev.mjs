#!/usr/bin/env node
// Development launcher for stdio hosts (Claude desktop, Claude Code): holds the
// host's stdio connection and runs the real server as a child process, restarting
// the child whenever a server source file changes. The host's `initialize` is
// replayed to each new child, so the host never sees the swap.
//
// The workspace HTML is read from disk on every resources/read, so UI edits need
// no restart: they show up in the next card the host opens.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'bin', 'mcportal.mjs');
const REPLAY_ID = '__mcportal_dev_reinit__';
const log = (msg) => process.stderr.write(`[mcportal-dev] ${msg}\n`);

let child = null;
let ready = false;          // child has answered the (replayed) initialize
let initLine = null;        // the host's initialize request, replayed on restart
let initializedLine = null; // the host's notifications/initialized
const queue = [];           // host messages held while a child starts
const inFlight = new Map(); // host request id (JSON) -> true, answered with an error if the child dies

function send(line) { process.stdout.write(`${line}\n`); }
function reject(idJson, message) {
  send(`{"jsonrpc":"2.0","id":${idJson},"error":{"code":-32603,"message":${JSON.stringify(message)}}}`);
}

function start(reason) {
  ready = false;
  const proc = spawn(process.execPath, [SERVER, '--stdio'], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
  child = proc;
  createInterface({ input: proc.stdout, crlfDelay: Infinity }).on('line', (line) => {
    if (proc !== child || !line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send(line); return; }
    if (msg && msg.id === REPLAY_ID) {   // our replayed initialize: swallow it, then resume
      if (initializedLine) proc.stdin.write(`${initializedLine}\n`);
      becomeReady(reason);
      return;
    }
    if (msg && msg.id !== undefined) inFlight.delete(JSON.stringify(msg.id));
    send(line);
  });
  proc.on('exit', (code, signal) => {
    if (proc !== child) return;
    child = null; ready = false;
    for (const id of inFlight.keys()) reject(id, 'MCPortal server restarted; try again');
    inFlight.clear();
    log(`server exited (${signal ?? code}); waiting for a file change to restart`);
  });
  if (initLine) {
    const init = JSON.parse(initLine);
    proc.stdin.write(`${JSON.stringify({ ...init, id: REPLAY_ID })}\n`);
  } else {
    becomeReady(reason);   // first start: the host's own initialize flows through normally
  }
}

function becomeReady(reason) {
  ready = true;
  if (reason) log(`reloaded (${reason})`);
  while (queue.length && ready && child) forward(queue.shift());
}

function forward(line) {
  let msg = null;
  try { msg = JSON.parse(line); } catch { /* pass through; the server answers parse errors */ }
  if (msg && msg.method === 'initialize') initLine = line;
  if (msg && msg.method === 'notifications/initialized') initializedLine = line;
  if (msg && msg.method !== undefined && msg.id !== undefined) inFlight.set(JSON.stringify(msg.id), true);
  if (!child) { if (msg && msg.id !== undefined && msg.method !== undefined) reject(JSON.stringify(msg.id), 'MCPortal server is not running (see logs); save a file to restart it'); return; }
  child.stdin.write(`${line}\n`);
}

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    if (!line.trim()) return;
    if (ready && child) forward(line); else queue.push(line);
  })
  .on('close', () => { if (child) child.stdin.end(); setTimeout(() => process.exit(0), 500).unref(); });

let timer = null;
let changed = new Set();
watch(path.join(ROOT, 'src'), { recursive: true }, (_event, file) => {
  if (!file || !file.endsWith('.ts')) return;   // .html is re-read per request
  changed.add(file);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const reason = [...changed].join(', ');
    changed = new Set();
    const old = child;
    child = null; ready = false;
    for (const id of inFlight.keys()) reject(id, 'MCPortal server restarted; try again');
    inFlight.clear();
    if (old) old.kill();
    start(reason);
  }, 250);
});

log(`watching ${path.join(ROOT, 'src')}`);
start(null);
