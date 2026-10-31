// Cross-checks against a real Thus Spoke Zakura instance, whose ZIP-321 parser is the reference
// Rust `zip321` crate. Runs with THS_INTEGRATION=1. Uses THS_API_URL if set, otherwise starts
// a disposable instance with the `ths` launcher (needs Docker).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { decodeAddress, formatPaymentRequest, memoText, parsePaymentRequest } from '../src/index.ts';

const run = promisify(execFile);
const enabled = process.env.THS_INTEGRATION === '1';

interface Account {
  id: number;
  unified_address: string;
  transparent_address: string;
}
interface ParsedByTHS {
  address: string;
  to_account: number | null;
  amount_zatoshi: number | null;
  memo: string | null;
}

describe('against a THS instance', { skip: !enabled && 'set THS_INTEGRATION=1' }, () => {
  let api = process.env.THS_API_URL?.replace(/\/$/, '') ?? '';
  let launcher: ChildProcess | undefined;
  let accounts: Account[] = [];

  const call = async <T>(path: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const res = await fetch(`${api}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as T };
  };

  before(async () => {
    if (!api) ({ api, launcher } = await startTHS());
    accounts = (await call<Account[]>('/api/v1/accounts')).json;
    assert.equal(accounts.length, 5);
  });

  after(async () => {
    if (!launcher || launcher.exitCode !== null) return;
    const exited = new Promise((resolve) => launcher!.once('exit', resolve));
    launcher.kill('SIGINT'); // THS cleans up its containers on SIGINT
    const timer = setTimeout(() => launcher!.kill('SIGKILL'), 120_000);
    await exited;
    clearTimeout(timer);
  });

  test('decodes every development address as regtest', () => {
    for (const a of accounts) {
      const ua = decodeAddress(a.unified_address);
      assert.equal(ua.kind, 'unified');
      assert.deepEqual(ua.networks, ['regtest']);
      assert.ok(ua.receivers!.some((r) => r.kind === 'orchard'), 'Ironwood uses Orchard-format receivers');
      const t = decodeAddress(a.transparent_address);
      assert.equal(t.kind, 'p2pkh');
      assert.ok(t.networks.includes('regtest'));
    }
  });

  test('THS parses the URIs we format', async () => {
    const cases = [
      { account: 2, amount: 150_000_000n, memo: 'order 42 ✨' },
      { account: 3, amount: 1n },
      { account: 4, memo: 'no amount' },
    ];
    for (const c of cases) {
      const address = accounts[c.account - 1]!.unified_address;
      const uri = formatPaymentRequest([{ address, amount: c.amount, memo: c.memo, label: 'Shop & Co' }], { network: 'regtest' });
      const { status, json } = await call<ParsedByTHS>('/api/v1/zip321/parse', { uri });
      assert.equal(status, 200, uri);
      assert.equal(json.address, address);
      assert.equal(json.to_account, c.account);
      assert.equal(json.amount_zatoshi, c.amount === undefined ? null : Number(c.amount));
      assert.equal(json.memo, c.memo ?? null);
    }
    const t = accounts[4]!.transparent_address;
    const { json } = await call<ParsedByTHS>('/api/v1/zip321/parse', { uri: formatPaymentRequest([{ address: t, amount: 2n }]) });
    assert.equal(json.to_account, 5);
  });

  test('we parse the URIs THS generates', async () => {
    for (const [account, amount, memo] of [[1, 250_000_000, 'invoice #7'], [2, undefined, undefined], [3, 12_345, '']] as const) {
      const { json } = await call<{ uri: string }>('/api/v1/zip321/request', { account_id: account, amount_zatoshi: amount, memo });
      const { payments, network } = parsePaymentRequest(json.uri, { network: 'regtest' });
      assert.equal(network, 'regtest');
      assert.equal(payments.length, 1);
      assert.equal(payments[0]!.address, accounts[account - 1]!.unified_address);
      assert.equal(payments[0]!.amount, amount === undefined ? undefined : BigInt(amount));
      const got = payments[0]!.memo;
      // An empty string still produces a (empty) text memo.
      assert.equal(got === undefined ? undefined : memoText(got), memo);
    }
  });

  test('THS rejects the URIs we reject', async () => {
    const t = accounts[0]!.transparent_address;
    const ua = accounts[1]!.unified_address;
    const invalid = [
      `zcash:${t}?amount=1&memo=aGk`, // memo to a transparent address
      `zcash:?address.0=${ua}&amount.0=1`, // leading zero index
      `zcash:${ua}?amount=1&amount=2`, // duplicate
      `zcash:${ua}?amount=1%30`, // percent-encoded amount
      `zcash:${ua}?amount=21000000.00000001`, // above max money
      `zcash:${ua}?amount=1&req-unknown=x`, // unknown required parameter
      `zcash:${ua}?memo=VGhpcw==`, // padded base64
      `zcash:${ua.slice(0, -1)}${ua.endsWith('q') ? 'p' : 'q'}?amount=1`, // checksum typo
    ];
    for (const uri of invalid) {
      assert.throws(() => parsePaymentRequest(uri), { name: 'ZIP321Error' }, uri);
      assert.equal((await call('/api/v1/zip321/parse', { uri })).status, 400, uri);
    }
  });
});

async function startTHS(): Promise<{ api: string; launcher: ChildProcess }> {
  const bin =
    process.env.THS_BIN ?? (existsSync(join(homedir(), '.local/bin/ths')) ? join(homedir(), '.local/bin/ths') : 'ths');
  const name = `zip321-${randomBytes(3).toString('hex')}`;
  const launcher = spawn(bin, ['--name', name, 'start', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  launcher.stdout!.on('data', (d) => (log = (log + d).slice(-4000)));
  launcher.stderr!.on('data', (d) => (log = (log + d).slice(-4000)));

  const deadline = Date.now() + 840_000;
  for (;;) {
    if (launcher.exitCode !== null) throw new Error(`ths exited with ${launcher.exitCode}:\n${log}`);
    try {
      await run(bin, ['--name', name, 'wait', '--timeout', '30', '--json']);
      const { stdout } = await run(bin, ['--name', name, 'endpoints', '--json']);
      const endpoints = JSON.parse(stdout) as { dashboard: string; network: string };
      assert.equal(endpoints.network, 'regtest');
      return { api: endpoints.dashboard.replace(/\/$/, ''), launcher };
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`THS did not become ready: ${err}\n${log}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
