import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPaymentRequest, parsePaymentRequest, type PaymentInput } from '../src/uri.ts';
import { memoText } from '../src/memo.ts';
import { ZIP321Error } from '../src/errors.ts';

const code = (c: string, param?: string) => (err: unknown) =>
  err instanceof ZIP321Error && err.code === c && (param === undefined || err.param === param);

// Testnet addresses from the ZIP and from zcash_address's vectors.
const T_ADDR = 'tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU';
const T_P2SH = 't26YoyZ1iPgiMEWL4zGUm74eVWfhyDMXzY2';
const Z_ADDR = 'ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez';
const Z_ADDR2 = 'ztestsapling1n65uaftvs2g7075q2x2a04shfk066u3lldzxsrprfrqtzxnhc9ps73v4lhx4l9yfxj46sl0q90k';
const U_ADDR = 'utest10c5kutapazdnf8ztl3pu43nkfsjx89fy3uuff8tsmxm6s86j37pe7uz94z5jhkl49pqe8yz75rlsaygexk6jpaxwx0esjr8wm5ut7d5s';
const TEX = 'textest1qyqszqgpqyqszqgpqyqszqgpqyqszqgpfcjgfy';
const ZREG = 'zregtestsapling1qqqqqqqqqqqqqqqqqqcguyvaw2vjk4sdyeg0lc970u659lvhqq7t0np6hlup5lusxle7505hlz3';
const MAIN = 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs';

test('ZIP-321 valid example 1: one Sapling payment with memo and message', () => {
  const uri = `zcash:${Z_ADDR}?amount=1&memo=VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg&message=Thank%20you%20for%20your%20purchase`;
  const { payments, network } = parsePaymentRequest(uri);
  assert.equal(network, 'test');
  assert.equal(payments.length, 1);
  const [p] = payments;
  assert.equal(p!.index, 0);
  assert.equal(p!.address, Z_ADDR);
  assert.equal(p!.amount, 100_000_000n);
  assert.equal(memoText(p!.memo!), 'This is a simple memo.');
  assert.equal(p!.message, 'Thank you for your purchase');
  assert.equal(p!.addressInfo?.kind, 'sapling');
  assert.equal(formatPaymentRequest(payments), uri);
});

test('ZIP-321 valid example 2: transparent and shielded recipients with a Unicode memo', () => {
  const uri = `zcash:?address=${T_ADDR}&amount=123.456&address.1=${Z_ADDR}&amount.1=0.789&memo.1=VGhpcyBpcyBhIHVuaWNvZGUgbWVtbyDinKjwn6aE8J-PhvCfjok`;
  const { payments } = parsePaymentRequest(uri);
  assert.deepEqual(
    payments.map((p) => [p.index, p.address, p.amount]),
    [
      [0, T_ADDR, 12_345_600_000n],
      [1, Z_ADDR, 78_900_000n],
    ],
  );
  assert.equal(memoText(payments[1]!.memo!), 'This is a unicode memo ✨🦄🏆🎉');
  assert.equal(formatPaymentRequest(payments), uri);
});

test('ZIP-321 valid example 3 (Custom Assets) fails only on the erratum in its second req-asset', () => {
  const placeholder1 = 'utest1qpsw0d7s6e5t7dv8x8yyw5e4v4jh8p5kux6g5v4kthh0nngwh2c5ue2x8p3wxy7qsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7egr7p';
  const asset = 'AEcnAAAAAAAAAADerb7v3q2-796tvu_erb7v3q2-796tvu_erb7v3q2-7xEiM0RVZneImQCqu8zd7v8AESIzRFVmd4iZqrvM3e7_';
  // The example addresses are placeholders, so address validation has to be off.
  const one = parsePaymentRequest(`zcash:?address=${placeholder1}&req-asset=${asset}`, { validateAddresses: false });
  assert.equal(one.payments[0]!.asset!.value, 10_055n);
  assert.throws(
    () =>
      parsePaymentRequest(
        `zcash:?address=${placeholder1}&req-asset=${asset}&address.1=${placeholder1}&req-asset.1=AJAIAwAAAAAAADerb7v3q2-796tvu_erb7v3q2-796tvu_erb7v3q2-7xEiM0RVZneImQCqu8zd7v8AESIzRFVmd4iZqrvM3e7_`,
        { validateAddresses: false },
      ),
    code('INVALID_ASSET', 'req-asset.1'),
  );
});

test('ZIP-321 invalid examples are rejected', () => {
  const cases: [string, string, string?][] = [
    [`zcash:?amount=3491405.05201255&address.1=${Z_ADDR}&amount.1=5740296.87793245`, 'MISSING_ADDRESS', 'amount'],
    [`zcash:?address=${T_ADDR}&amount=1&amount.1=2&address.2=${Z_ADDR}`, 'MISSING_ADDRESS', 'amount.1'],
    [`zcash:?address.0=${Z_ADDR}&amount.0=2`, 'INVALID_PARAM', 'address.0'],
    [`zcash:?amount=1.234&amount=2.345&address=${T_ADDR}`, 'DUPLICATE_PARAM', 'amount'],
    [`zcash:?amount.1=1.234&amount.1=2.345&address.1=${T_ADDR}`, 'DUPLICATE_PARAM', 'amount.1'],
    [`zcash:${T_ADDR}?amount=1%30`, 'INVALID_AMOUNT', 'amount'],
    [`zcash:${T_ADDR}?%61mount=1`, 'INVALID_PARAM', '%61mount'],
    [`zcash:%74mEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU?amount=1`, 'INVALID_URI'],
    [`zcash://${T_ADDR}?amount=1`, 'INVALID_URI'],
    [`zcash:?address=${Z_ADDR}&amount=5&req-asset=not@valid!chars`, 'INVALID_ASSET', 'req-asset'],
  ];
  for (const [uri, c, param] of cases) assert.throws(() => parsePaymentRequest(uri), code(c, param), uri);
});

test('reference-implementation vectors', () => {
  assert.equal(parsePaymentRequest(`zcash:${Z_ADDR}?amount=20999999.99999999`).payments[0]!.amount, 2_099_999_999_999_999n);
  assert.equal(parsePaymentRequest(`zcash:${Z_ADDR}?amount=21000000`).payments[0]!.amount, 2_100_000_000_000_000n);
  const simple = parsePaymentRequest(`zcash:${Z_ADDR2}?amount=3768769.02796286&message=`).payments[0]!;
  assert.equal(simple.amount, 376_876_902_796_286n);
  assert.equal(simple.message, '');
  assert.equal(parsePaymentRequest(`zcash:${Z_ADDR2}`).payments[0]!.amount, undefined);
  assert.equal(parsePaymentRequest(`zcash:${ZREG}?amount=1`).network, 'regtest');

  const invalid: [string, string][] = [
    [`zcash:?address=${T_ADDR}&amount=123.456&memo=eyAia2V5IjogIlRoaXMgaXMgYSBKU09OLXN0cnVjdHVyZWQgbWVtby4iIH0&address.1=${Z_ADDR}`, 'MEMO_NOT_ALLOWED'],
    [`zcash:${Z_ADDR}?amount=9223372036854775808`, 'INVALID_AMOUNT'],
    [`zcash:${Z_ADDR}?amount=21000000.00000001`, 'INVALID_AMOUNT'],
    [`zcash:${Z_ADDR}?amount=-1`, 'INVALID_AMOUNT'],
    [`zcash:?amount.10000=1.23&address.10000=${T_ADDR}`, 'INVALID_PARAM'],
    [`zcash:?address=${T_ADDR}&amount=123.`, 'INVALID_AMOUNT'],
    [`zcash:?address=${T_ADDR}&amount=123.45&req-unknown=x`, 'UNSUPPORTED_REQUIRED_PARAM'],
  ];
  for (const [uri, c] of invalid) assert.throws(() => parsePaymentRequest(uri), code(c), uri);
});

test('structural rules', () => {
  assert.throws(() => parsePaymentRequest('zcash:'), code('INVALID_URI'));
  assert.throws(() => parsePaymentRequest('zcash:?'), code('NO_PAYMENTS'));
  assert.throws(() => parsePaymentRequest('bitcoin:abc'), code('INVALID_URI'));
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?address=${T_ADDR}`), code('DUPLICATE_PARAM', 'address'));
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?amount`), code('INVALID_PARAM', 'amount'));
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?amount=1#frag`), code('INVALID_AMOUNT'));
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?message=hi#frag`), code('INVALID_PARAM', 'message'));
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?message=a=b`), code('INVALID_PARAM'));
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?message=%E2%82`), code('INVALID_PARAM')); // bad UTF-8
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?amount=1&foo.3=x`), code('MISSING_ADDRESS', 'foo.3'));
  assert.throws(() => parsePaymentRequest(`zcash:${Z_ADDR}?memo=VGhpcw==`), code('INVALID_MEMO'));
  assert.throws(() => parsePaymentRequest(`zcash:${Z_ADDR}?memo=${'A'.repeat(684)}`), code('INVALID_MEMO')); // 513 bytes
});

test('empty parameters, gaps in indices, and unknown parameters are accepted', () => {
  const { payments } = parsePaymentRequest(`zcash:?&address.5=${Z_ADDR}&&amount.5=1&foo.5=b%20c&flag.5&address=${T_ADDR}&amount=2`);
  assert.deepEqual(payments.map((p) => p.index), [0, 5]);
  assert.deepEqual(payments[1]!.otherParams, { foo: 'b c', flag: null });
});

test('parameter names match case-insensitively, as ABNF literals do', () => {
  const [p] = parsePaymentRequest(`ZCASH:${Z_ADDR}?AMOUNT=1&Message=hi`).payments;
  assert.equal(p!.amount, 100_000_000n);
  assert.equal(p!.message, 'hi');
  assert.throws(() => parsePaymentRequest(`zcash:${Z_ADDR}?amount=1&Amount=2`), code('DUPLICATE_PARAM'));
  assert.throws(() => parsePaymentRequest(`zcash:${Z_ADDR}?REQ-thing=1`), code('UNSUPPORTED_REQUIRED_PARAM'));
});

test('memos are refused for transparent and TEX addresses', () => {
  for (const addr of [T_ADDR, T_P2SH, TEX]) {
    assert.throws(() => parsePaymentRequest(`zcash:${addr}?amount=1&memo=aGk`), code('MEMO_NOT_ALLOWED', 'memo'), addr);
  }
  assert.ok(parsePaymentRequest(`zcash:${U_ADDR}?amount=1&memo=aGk`));
});

test('zero-valued transparent outputs are refused, zero shielded ones are fine', () => {
  assert.throws(() => parsePaymentRequest(`zcash:${T_ADDR}?amount=0`), code('ZERO_TRANSPARENT_AMOUNT'));
  assert.equal(parsePaymentRequest(`zcash:${Z_ADDR}?amount=0`).payments[0]!.amount, 0n);
});

test('network checks', () => {
  assert.equal(parsePaymentRequest(`zcash:${T_ADDR}?amount=1`).network, undefined); // test or regtest
  assert.equal(parsePaymentRequest(`zcash:${T_ADDR}?amount=1`, { network: 'regtest' }).network, 'regtest');
  assert.throws(() => parsePaymentRequest(`zcash:${Z_ADDR}?amount=1`, { network: 'main' }), code('WRONG_NETWORK', 'address'));
  assert.throws(() => parsePaymentRequest(`zcash:?address=${MAIN}&amount=1&address.1=${Z_ADDR}&amount.1=1`), code('WRONG_NETWORK', 'address.1'));
  assert.throws(() => parsePaymentRequest(`zcash:?address=${T_ADDR}&amount=1&address.1=${ZREG}&amount.1=1&address.2=${Z_ADDR}`), code('WRONG_NETWORK'));
  assert.equal(parsePaymentRequest(`zcash:?address=${T_ADDR}&amount=1&address.1=${ZREG}`).network, 'regtest');
});

test('addresses are checksummed unless validation is turned off', () => {
  const typo = Z_ADDR.slice(0, -1) + 'x';
  assert.throws(() => parsePaymentRequest(`zcash:${typo}?amount=1`), code('INVALID_ADDRESS'));
  const lenient = parsePaymentRequest(`zcash:${typo}?amount=1`, { validateAddresses: false });
  assert.equal(lenient.payments[0]!.addressInfo, undefined);
  // The memo rule still applies by prefix.
  assert.throws(() => parsePaymentRequest(`zcash:tmNotChecked?memo=aGk`, { validateAddresses: false }), code('MEMO_NOT_ALLOWED'));
  assert.throws(() => parsePaymentRequest('zcash:zcAnything?amount=1'), code('INVALID_ADDRESS'));
});

test('Custom Asset payments need an Orchard receiver and no amount', () => {
  const asset = 'AEcnAAAAAAAAAADerb7v3q2-796tvu_erb7v3q2-796tvu_erb7v3q2-7xEiM0RVZneImQCqu8zd7v8AESIzRFVmd4iZqrvM3e7_';
  // U_ADDR is a Sapling-only Unified Address.
  assert.throws(() => parsePaymentRequest(`zcash:${U_ADDR}?req-asset=${asset}`), code('INVALID_ASSET'));
  assert.throws(() => parsePaymentRequest(`zcash:${Z_ADDR}?req-asset=${asset}`), code('INVALID_ASSET'));
  assert.throws(() => parsePaymentRequest(`zcash:${U_ADDR}?amount=1&req-asset=${asset}`, { validateAddresses: false }), code('AMOUNT_AND_ASSET'));
});

test('formatPaymentRequest numbers multiple payments without a .0 index', () => {
  const uri = formatPaymentRequest([
    { address: Z_ADDR, amount: 50_000_000n, label: 'Deposit' },
    { address: T_ADDR, amount: 25_000_000 },
    { address: U_ADDR, memo: 'order 42' },
  ]);
  assert.equal(
    uri,
    `zcash:?address=${Z_ADDR}&amount=0.5&label=Deposit&address.1=${T_ADDR}&amount.1=0.25&address.2=${U_ADDR}&memo.2=b3JkZXIgNDI`,
  );
  assert.deepEqual(parsePaymentRequest(uri).payments.map((p) => p.index), [0, 1, 2]);
});

test('formatPaymentRequest escapes labels and messages', () => {
  const message = 'Pay & go: 50% off? a+b=c / "quoted" #1 ✨';
  const uri = formatPaymentRequest([{ address: Z_ADDR, message, label: "Maya's Café" }]);
  assert.equal(
    uri,
    `zcash:${Z_ADDR}?label=Maya's%20Caf%C3%A9&message=Pay%20%26%20go:%2050%25%20off%3F%20a%2Bb%3Dc%20%2F%20%22quoted%22%20%231%20%E2%9C%A8`,
  );
  assert.equal(parsePaymentRequest(uri).payments[0]!.message, message);
});

test('formatPaymentRequest refuses what the parser would refuse', () => {
  assert.throws(() => formatPaymentRequest([]), code('NO_PAYMENTS'));
  assert.throws(() => formatPaymentRequest([{ address: T_ADDR, memo: 'hi' }]), code('MEMO_NOT_ALLOWED'));
  assert.throws(() => formatPaymentRequest([{ address: T_ADDR, amount: 0n }]), code('ZERO_TRANSPARENT_AMOUNT'));
  assert.throws(() => formatPaymentRequest([{ address: Z_ADDR, amount: -1n }]), code('INVALID_AMOUNT'));
  assert.throws(() => formatPaymentRequest([{ address: Z_ADDR, memo: 'x'.repeat(513) }]), code('INVALID_MEMO'));
  assert.throws(() => formatPaymentRequest([{ address: 'not an address' }]), code('INVALID_PARAM'));
  assert.throws(() => formatPaymentRequest([{ address: Z_ADDR }], { network: 'main' }), code('WRONG_NETWORK'));
  assert.throws(() => formatPaymentRequest([{ address: Z_ADDR, otherParams: { amount: '1' } }]), code('INVALID_PARAM'));
  assert.throws(() => formatPaymentRequest([{ address: Z_ADDR, otherParams: { 'req-x': '1' } }]), code('INVALID_PARAM'));
});

test('format and parse round-trip random requests', () => {
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const chars = ['a', 'Z', '0', ' ', '&', '=', '%', '+', '?', '#', '/', ':', '@', '~', 'é', '✨', '🦄', '\n'];
  const text = () => Array.from({ length: rand(12) }, () => chars[rand(chars.length)]).join('');
  const shielded = [Z_ADDR, Z_ADDR2, U_ADDR];
  for (let round = 0; round < 200; round++) {
    const payments: PaymentInput[] = Array.from({ length: 1 + rand(4) }, () => {
      const transparent = rand(3) === 0;
      const p: PaymentInput = { address: transparent ? T_ADDR : shielded[rand(shielded.length)]! };
      if (rand(2)) p.amount = BigInt(1 + rand(2_000_000_000)) * BigInt(1 + rand(1000));
      if (!transparent && rand(2)) p.memo = Uint8Array.from({ length: rand(513) }, () => rand(256));
      if (rand(2)) p.label = text();
      if (rand(2)) p.message = text();
      if (rand(3) === 0) p.otherParams = { extra: rand(2) ? text() : null };
      return p;
    });
    const uri = formatPaymentRequest(payments);
    const parsed = parsePaymentRequest(uri);
    assert.equal(parsed.payments.length, payments.length);
    parsed.payments.forEach((got, i) => {
      const want = payments[i]!;
      assert.equal(got.address, want.address);
      assert.equal(got.amount, want.amount === undefined ? undefined : BigInt(want.amount));
      assert.deepEqual(got.memo, want.memo);
      assert.equal(got.label, want.label);
      assert.equal(got.message, want.message);
      assert.deepEqual(got.otherParams, want.otherParams ?? {});
    });
    assert.equal(formatPaymentRequest(parsed), uri);
  }
});
