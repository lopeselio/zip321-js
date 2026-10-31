import { base64urlDecode, base64urlEncode } from './encoding/base64url.ts';
import { ZIP321Error } from './errors.ts';

/** A Custom Asset amount from a `req-asset` parameter (ZIP 321 version 0x00, ZIP 227 asset IDs). */
export interface AssetAmount {
  /** Amount in the asset's minimal units (u64). */
  value: bigint;
  /** `EncodeAssetId(AssetId)` from ZIP 227: 66 bytes. */
  assetId: Uint8Array;
}

const ASSET_ID_BYTES = 66;
const MAX_U64 = (1n << 64n) - 1n;

export function decodeAsset(text: string, param?: string): AssetAmount {
  const bytes = base64urlDecode(text);
  if (!bytes) throw new ZIP321Error('INVALID_ASSET', `req-asset is not unpadded base64url: ${text}`, param);
  if (bytes[0] !== 0x00) {
    throw new ZIP321Error('INVALID_ASSET', `Unsupported req-asset encoding version ${bytes[0] ?? '(empty)'}`, param);
  }
  if (bytes.length !== 1 + 8 + ASSET_ID_BYTES) {
    throw new ZIP321Error('INVALID_ASSET', `req-asset version 0 is 75 bytes, got ${bytes.length}`, param);
  }
  const value = new DataView(bytes.buffer, bytes.byteOffset + 1, 8).getBigUint64(0, true);
  return { value, assetId: bytes.slice(9) };
}

export function encodeAsset(asset: AssetAmount, param?: string): string {
  if (asset.value < 0n || asset.value > MAX_U64) throw new ZIP321Error('INVALID_ASSET', 'Asset value must fit in a u64', param);
  if (asset.assetId.length !== ASSET_ID_BYTES) {
    throw new ZIP321Error('INVALID_ASSET', `Asset ID must be ${ASSET_ID_BYTES} bytes`, param);
  }
  const bytes = new Uint8Array(1 + 8 + ASSET_ID_BYTES);
  new DataView(bytes.buffer).setBigUint64(1, asset.value, true);
  bytes.set(asset.assetId, 9);
  return base64urlEncode(bytes);
}
