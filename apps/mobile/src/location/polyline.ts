/**
 * Google encoded-polyline decoder (Phase 3.20 — GOOGLE MAPS & LOCATION
 * INTEGRATION).
 *
 * Pure, dependency-free implementation of the Google encoded polyline
 * algorithm (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
 * Returns coordinates in the project's GeoJSON convention: **[longitude,
 * latitude]** (identical to the Phase 3.12 `LineStringGeometry`). Throws
 * `RangeError` on malformed input so callers fail closed instead of yielding
 * garbage geometry.
 */

function decodeSignedValue(
  encoded: string,
  index: number,
): {
  value: number;
  index: number;
} {
  let result = 0;
  let shift = 0;
  let byte = 0;
  let cursor = index;
  do {
    if (cursor >= encoded.length) {
      throw new RangeError('Malformed encoded polyline');
    }
    byte = encoded.charCodeAt(cursor) - 63;
    cursor += 1;
    if (byte < 0 || byte > 63) {
      throw new RangeError('Malformed encoded polyline');
    }
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const negative = result & 1;
  result >>= 1;
  return { value: negative ? ~result : result, index: cursor };
}

/** Decodes an encoded polyline into `[longitude, latitude]` pairs (scaled to
 * 5 decimal places, matching Google's precision). */
export function decodePolyline(encoded: string): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latDelta = decodeSignedValue(encoded, index);
    latitude += latDelta.value;
    index = latDelta.index;
    const lngDelta = decodeSignedValue(encoded, index);
    longitude += lngDelta.value;
    index = lngDelta.index;
    coordinates.push([longitude / 1e5, latitude / 1e5]);
  }
  return coordinates;
}
