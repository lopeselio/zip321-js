import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../src/hash/sha256.ts';
import { blake2b } from '../src/hash/blake2b.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const text = (s: string) => new TextEncoder().encode(s);
const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);

test('sha256 matches known answers', () => {
  assert.equal(hex(sha256(text(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(text('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256 matches node:crypto across block boundaries', () => {
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
    const data = bytes(n);
    assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'), `length ${n}`);
  }
});

test('blake2b-512 matches RFC 7693 known answers', () => {
  assert.equal(
    hex(blake2b(text('abc'), 64)),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  );
  assert.equal(
    hex(blake2b(text(''), 64)),
    '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce',
  );
});

test('blake2b matches node:crypto across block boundaries', () => {
  for (const n of [0, 1, 127, 128, 129, 255, 256, 257, 1000]) {
    const data = bytes(n);
    assert.equal(hex(blake2b(data, 64)), createHash('blake2b512').update(data).digest('hex'), `length ${n}`);
  }
});

test('blake2b rejects bad parameters', () => {
  assert.throws(() => blake2b(text(''), 0), RangeError);
  assert.throws(() => blake2b(text(''), 65), RangeError);
  assert.throws(() => blake2b(text(''), 32, new Uint8Array(8)), RangeError);
});
