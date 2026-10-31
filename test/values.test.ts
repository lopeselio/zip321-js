import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatZec, MAX_MONEY, parseZec, toZatoshi } from '../src/amount.ts';
import { decodeAsset, encodeAsset } from '../src/asset.ts';
import { base64urlDecode, base64urlEncode } from '../src/encoding/base64url.ts';
import { memoText, textMemo } from '../src/memo.ts';
import { ZIP321Error } from '../src/errors.ts';

const code = (c: string) => (err: unknown) => err instanceof ZIP321Error && err.code === c;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('parseZec follows the ZIP-321 amount examples', () => {
  for (const s of ['50.00', '50', '050']) assert.equal(parseZec(s), 5_000_000_000n, s);
  for (const s of ['0.5', '00.500']) assert.equal(parseZec(s), 50_000_000n, s);
  for (const s of ['50,000.00', '50,00', '50.', '.5', '0.123456789', '-1', '1e5', '', ' 1', '+1']) {
    assert.throws(() => parseZec(s), code('INVALID_AMOUNT'), s);
  }
});

test('parseZec bounds amounts at 21,000,000 ZEC', () => {
  assert.equal(parseZec('20999999.99999999'), MAX_MONEY - 1n);
  assert.equal(parseZec('21000000'), MAX_MONEY);
  for (const s of ['21000000.00000001', '9223372036854775808', '18446744073709551624']) {
    assert.throws(() => parseZec(s), code('INVALID_AMOUNT'), s);
  }
});

test('formatZec writes the shortest decimal', () => {
  assert.equal(formatZec(0n), '0');
  assert.equal(formatZec(1n), '0.00000001');
  assert.equal(formatZec(150_000_000n), '1.5');
  assert.equal(formatZec(12_345_600_000n), '123.456');
  assert.equal(formatZec(MAX_MONEY), '21000000');
  assert.equal(formatZec(100_000_000), '1');
});

test('toZatoshi rejects negatives, fractions and overflow', () => {
  assert.throws(() => toZatoshi(-1n), code('INVALID_AMOUNT'));
  assert.throws(() => toZatoshi(1.5), code('INVALID_AMOUNT'));
  assert.throws(() => toZatoshi(MAX_MONEY + 1n), code('INVALID_AMOUNT'));
  assert.throws(() => toZatoshi(Number.MAX_SAFE_INTEGER + 2), code('INVALID_AMOUNT'));
});

test('base64url matches Node and rejects padding, the base64 alphabet and loose bits', () => {
  for (let n = 0; n < 20; n++) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 250) & 0xff);
    const encoded = base64urlEncode(data);
    assert.equal(encoded, Buffer.from(data).toString('base64url'));
    assert.equal(hex(base64urlDecode(encoded)!), hex(data));
  }
  for (const bad of ['VGhpcw==', 'a+b/', 'abcde', 'VGhpcy', 'VGhpcyB']) {
    assert.equal(base64urlDecode(bad), undefined, bad);
  }
  assert.equal(base64urlDecode('VGhpcw')?.length, 4);
});

test('textMemo and memoText follow ZIP 302', () => {
  assert.equal(memoText(textMemo('This is a unicode memo ✨🦄🏆🎉')), 'This is a unicode memo ✨🦄🏆🎉');
  assert.equal(memoText(new Uint8Array([0x68, 0x69, 0, 0, 0])), 'hi'); // zero padding stripped
  assert.equal(memoText(new Uint8Array(0)), '');
  assert.equal(memoText(new Uint8Array([0xf6])), undefined); // "no memo"
  assert.equal(memoText(new Uint8Array([0xf5, 1, 2])), undefined); // binary
  assert.equal(memoText(new Uint8Array([0xc3, 0x28])), undefined); // invalid UTF-8
  assert.equal(textMemo('é'.repeat(256)).length, 512);
  assert.throws(() => textMemo('é'.repeat(256) + 'x'), code('INVALID_MEMO'));
});

test('decodes the ZIP-321 req-asset example', () => {
  const asset = decodeAsset('AEcnAAAAAAAAAADerb7v3q2-796tvu_erb7v3q2-796tvu_erb7v3q2-7xEiM0RVZneImQCqu8zd7v8AESIzRFVmd4iZqrvM3e7_');
  assert.equal(asset.value, 10_055n);
  assert.equal(
    hex(asset.assetId),
    '0000deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff',
  );
  assert.equal(encodeAsset(asset), 'AEcnAAAAAAAAAADerb7v3q2-796tvu_erb7v3q2-796tvu_erb7v3q2-7xEiM0RVZneImQCqu8zd7v8AESIzRFVmd4iZqrvM3e7_');
});

test('rejects malformed req-asset values', () => {
  // Erratum: the ZIP's second req-asset example (meant to be 250000 units) is 74 bytes, not 75.
  assert.throws(
    () => decodeAsset('AJAIAwAAAAAAADerb7v3q2-796tvu_erb7v3q2-796tvu_erb7v3q2-7xEiM0RVZneImQCqu8zd7v8AESIzRFVmd4iZqrvM3e7_'),
    code('INVALID_ASSET'),
  );
  assert.throws(() => decodeAsset('not@valid!chars'), code('INVALID_ASSET'));
  assert.throws(() => decodeAsset(base64urlEncode(new Uint8Array([1, ...new Uint8Array(74)]))), code('INVALID_ASSET'));
  assert.throws(() => encodeAsset({ value: 1n << 64n, assetId: new Uint8Array(66) }), code('INVALID_ASSET'));
  assert.throws(() => encodeAsset({ value: 1n, assetId: new Uint8Array(65) }), code('INVALID_ASSET'));
});
