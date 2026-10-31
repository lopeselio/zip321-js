export type ZIP321ErrorCode =
  /** The text does not match the ZIP-321 URI grammar. */
  | 'INVALID_URI'
  /** A parameter name, index or value is malformed. */
  | 'INVALID_PARAM'
  /** The same parameter appears twice for one payment. */
  | 'DUPLICATE_PARAM'
  /** A payment has parameters but no address. */
  | 'MISSING_ADDRESS'
  /** The request contains no payments. */
  | 'NO_PAYMENTS'
  /** An amount is malformed, negative, or above 21,000,000 ZEC. */
  | 'INVALID_AMOUNT'
  /** A memo is not unpadded base64url, or decodes to more than 512 bytes. */
  | 'INVALID_MEMO'
  /** A memo is attached to an address that cannot receive one. */
  | 'MEMO_NOT_ALLOWED'
  /** A zero-valued payment to a transparent address, which consensus rejects. */
  | 'ZERO_TRANSPARENT_AMOUNT'
  /** A `req-asset` value is malformed or is not paid to an Orchard receiver. */
  | 'INVALID_ASSET'
  /** `amount` and `req-asset` are both given for one payment. */
  | 'AMOUNT_AND_ASSET'
  /** A `req-` parameter this implementation does not understand. */
  | 'UNSUPPORTED_REQUIRED_PARAM'
  /** An address fails to decode (checksum, encoding, or structure). */
  | 'INVALID_ADDRESS'
  /** An address type that ZIP-321 forbids (Sprout). */
  | 'UNSUPPORTED_ADDRESS'
  /** An address is not for the expected network, or addresses mix networks. */
  | 'WRONG_NETWORK';

export class ZIP321Error extends Error {
  override name = 'ZIP321Error';
  readonly code: ZIP321ErrorCode;
  /** The parameter (e.g. `amount.2`) the error refers to, when there is one. */
  readonly param: string | undefined;

  constructor(code: ZIP321ErrorCode, message: string, param?: string) {
    super(message);
    this.code = code;
    this.param = param;
  }
}
