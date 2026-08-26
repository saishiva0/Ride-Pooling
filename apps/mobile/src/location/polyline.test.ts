/**
 * Encoded-polyline decoder tests (Phase 3.20). Pinned against Google's
 * documented example and the malformed-input failure mode.
 */
import { describe, expect, it } from 'vitest';
import { decodePolyline } from './polyline';

describe('decodePolyline', () => {
  it('decodes the canonical Google example in [lng, lat] order', () => {
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const decoded = decodePolyline(encoded);
    expect(decoded).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('round-trips a simple single point', () => {
    // Encode (0,0) manually: lat 0 → 0x20 chunk sequence, lng 0 → 0x20.
    expect(decodePolyline('??')).toEqual([[0, 0]]);
  });

  it('handles negative deltas (west/south movement)', () => {
    // -120,-38.5 then -0.75,+2.2 encodes as ... use a known pair.
    const encoded = '_p~iF~ps|U';
    expect(decodePolyline(encoded)).toEqual([[-120.2, 38.5]]);
  });

  it('throws on malformed input instead of yielding garbage', () => {
    expect(() => decodePolyline('')).not.toThrow();
    expect(() => decodePolyline('_')).toThrow(RangeError);
    expect(() => decodePolyline('~f')).toThrow(RangeError);
  });
});
