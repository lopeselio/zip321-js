# zip321

Parse, build and validate [ZIP-321](https://zips.z.cash/zip-0321) Zcash payment request URIs
(`zcash:…?amount=…&memo=…`), the links and QR codes wallets use to request a payment.

Strict where the ZIP says MUST, with real address validation, and no dependencies. It runs
in Node, browsers and edge runtimes.

```ts
import { formatPaymentRequest, parsePaymentRequest, memoText } from 'zip321';

// A shop asks for 1.5 ZEC with an order number in the memo.
const uri = formatPaymentRequest([
  { address: 'u1…', amount: 150_000_000n, memo: 'order 42', label: 'Maya Lin Studio' },
]);
// zcash:u1…?amount=1.5&memo=b3JkZXIgNDI&label=Maya%20Lin%20Studio

// A wallet reads it back.
const { payments, network } = parsePaymentRequest(uri);
payments[0].amount;          // 150000000n (zatoshi)
memoText(payments[0].memo!); // 'order 42'
network;                     // 'main'
```

## What it checks

- **The grammar.** It rejects `address.0` (leading zeros), duplicate parameters, parameters without an address,
  percent-encoding outside labels and messages, `zcash://`, padded or standard-alphabet base64, unknown `req-`
  parameters, more than 8 decimals, and amounts above 21,000,000 ZEC.
- **Addresses.** Every address is decoded and checksummed: transparent (Base58Check), Sapling (Bech32), TEX (Bech32m)
  and Unified Addresses, with full ZIP 316 decoding (F4Jumble, padding, receiver order and sizes). Sprout addresses
  are refused, as the ZIP requires.
- **Networks.** Mainnet, testnet and regtest are told apart. Pass `{ network }` to require one. A request that mixes
  networks is refused.
- **Payment rules.** It refuses a memo to a transparent or TEX address, a zero-value transparent output, `amount` together
  with `req-asset`, and a Custom Asset paid to an address without an Orchard receiver.
- **Memos.** A memo can be at most 512 bytes. `memoText()` reads ZIP 302 text memos and returns `undefined` for binary memos.

Errors are `ZIP321Error`s with a `code` (`INVALID_AMOUNT`, `MEMO_NOT_ALLOWED`, `WRONG_NETWORK`, …) and the offending
`param` (`amount.2`), so a wallet can tell the user exactly what is wrong.

## API

| | |
|---|---|
| `parsePaymentRequest(uri, options?)` | → `{ payments, network? }`. Throws `ZIP321Error` |
| `formatPaymentRequest(payments, options?)` | → URI. One payment goes in the path, several become `address`, `address.1`, … |
| `decodeAddress(address)` | → `{ kind, networks, receivers?, canReceiveMemo, transparentOnly }` |
| `parseZec('1.5')` / `formatZec(150000000n)` | Exact decimal ZEC ↔ zatoshi |
| `textMemo(text)` / `memoText(bytes)` | UTF-8 memo encoding and ZIP 302 decoding |

Options: `network` (`'main' | 'test' | 'regtest'`) and `validateAddresses` (default `true`). With
`validateAddresses: false`, any alphanumeric address is accepted, which is useful for address types newer than this
library; transparent addresses are then recognized by prefix only.

A parsed payment is `{ index, address, addressInfo?, amount?, asset?, memo?, label?, message?, otherParams }`.
Amounts are `bigint` zatoshi; `formatPaymentRequest` also accepts safe-integer numbers. `memo` takes bytes or a string.
Unknown parameters without `req-` are ignored, as the ZIP says, but kept in `otherParams`, so a parsed request can
be formatted again without losing anything.

## Tested against

- Every example in ZIP-321, plus the test vectors from the reference Rust `zip321` crate.
- The 60 Unified Address and 8 F4Jumble vectors from [zcash-test-vectors](https://github.com/zcash/zcash-test-vectors),
  and the address vectors from `zcash_address`.
- A live [Thus Spoke Zakura](https://github.com/zcashlabs/thus-spoke-zakura) regtest node, whose server parses with the
  reference crate. URIs this library formats are accepted there, URIs THS generates parse here, and invalid URIs are
  rejected by both.

One erratum turned up along the way: the ZIP's second `req-asset` example is 74 bytes rather than 75, so a correct
decoder rejects it.

## Develop

```sh
npm install
npm test                 # unit tests
npm run test:integration # against THS (starts one with the `ths` launcher; needs Docker), or set THS_API_URL
npm run build
```

MIT licensed. The test vectors in `test/fixtures` come from zcash-test-vectors (MIT) by way of the `zcash_address` and
`f4jumble` crates.
