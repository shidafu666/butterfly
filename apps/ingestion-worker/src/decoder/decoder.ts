import { unpack } from 'msgpackr';

export function decodePayload(buffer: Buffer): unknown {
  return unpack(buffer);
}
