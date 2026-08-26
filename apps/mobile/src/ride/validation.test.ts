import { describe, expect, it } from 'vitest';
import {
  parseDiscoveryForm,
  parseMatchingForm,
  parseRequestedSeats,
} from './validation';

describe('parseDiscoveryForm', () => {
  it('parses a valid form and converts radius km to meters', () => {
    const result = parseDiscoveryForm({
      latitude: '12.9716',
      longitude: '77.5946',
      radiusKm: '5',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        latitude: 12.9716,
        longitude: 77.5946,
        radiusMeters: 5000,
      },
    });
  });

  it('rounds fractional radius to whole meters', () => {
    const result = parseDiscoveryForm({
      latitude: '0',
      longitude: '0',
      radiusKm: '1.25',
    });
    expect(result.ok && result.value.radiusMeters).toBe(1250);
  });

  it('rejects a missing latitude', () => {
    const result = parseDiscoveryForm({
      latitude: '',
      longitude: '77.5946',
      radiusKm: '5',
    });
    expect(result).toEqual({ ok: false, error: 'Latitude is required' });
  });

  it('rejects a non-numeric longitude', () => {
    const result = parseDiscoveryForm({
      latitude: '12.9716',
      longitude: 'abc',
      radiusKm: '5',
    });
    expect(result).toEqual({ ok: false, error: 'Longitude must be a number' });
  });

  it('rejects an out-of-bounds latitude', () => {
    const result = parseDiscoveryForm({
      latitude: '91',
      longitude: '77.5946',
      radiusKm: '5',
    });
    expect(result).toEqual({
      ok: false,
      error: 'Latitude must be between -90 and 90',
    });
  });

  it('rejects an out-of-bounds longitude', () => {
    const result = parseDiscoveryForm({
      latitude: '0',
      longitude: '-181',
      radiusKm: '5',
    });
    expect(result).toEqual({
      ok: false,
      error: 'Longitude must be between -180 and 180',
    });
  });

  it('rejects a missing radius', () => {
    const result = parseDiscoveryForm({
      latitude: '0',
      longitude: '0',
      radiusKm: '',
    });
    expect(result).toEqual({ ok: false, error: 'Radius is required' });
  });

  it('rejects a non-positive radius', () => {
    const result = parseDiscoveryForm({
      latitude: '0',
      longitude: '0',
      radiusKm: '0',
    });
    expect(result).toEqual({
      ok: false,
      error: 'Radius must be a positive number',
    });
  });
});

describe('parseRequestedSeats', () => {
  it('parses a valid seat count', () => {
    expect(parseRequestedSeats('2', 4)).toEqual({ ok: true, value: 2 });
  });

  it('rejects an empty value', () => {
    expect(parseRequestedSeats('', 4)).toEqual({
      ok: false,
      error: 'Seats is required',
    });
  });

  it('rejects a non-integer value', () => {
    expect(parseRequestedSeats('1.5', 4)).toEqual({
      ok: false,
      error: 'Seats must be a positive integer',
    });
  });

  it('rejects a non-positive value', () => {
    expect(parseRequestedSeats('0', 4)).toEqual({
      ok: false,
      error: 'Seats must be a positive integer',
    });
  });

  it('rejects a count above the available seats', () => {
    expect(parseRequestedSeats('3', 2)).toEqual({
      ok: false,
      error: 'At most 2 seats available',
    });
  });
});

describe('parseMatchingForm', () => {
  // Deterministic far-future departure so the "must be in the future" guard
  // never becomes stale (the fixture previously used a near-term date that
  // aged into the past and made unrelated assertions fail).
  const baseValid = {
    pickupLatitude: '12.9716',
    pickupLongitude: '77.5946',
    destinationLatitude: '12.9698',
    destinationLongitude: '77.75',
    departureDateTime: '2099-01-01T10:00:00.000Z',
    requestedSeats: '1',
  };

  it('parses a valid matching form', () => {
    const result = parseMatchingForm(baseValid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.discovery).toEqual({
        latitude: 12.9716,
        longitude: 77.5946,
      });
      expect(result.value.destination).toEqual({
        latitude: 12.9698,
        longitude: 77.75,
      });
      expect(result.value.preferredDepartureTime).toEqual(
        new Date('2099-01-01T10:00:00.000Z'),
      );
      expect(result.value.requestedSeats).toBe(1);
    }
  });

  it('parses without requestedSeats (optional)', () => {
    const { requestedSeats, ...rest } = baseValid;
    const result = parseMatchingForm(rest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requestedSeats).toBeUndefined();
    }
  });

  it('rejects a missing pickup latitude', () => {
    const result = parseMatchingForm({ ...baseValid, pickupLatitude: '' });
    expect(result).toEqual({ ok: false, error: 'Pickup latitude is required' });
  });

  it('rejects an out-of-bounds destination longitude', () => {
    const result = parseMatchingForm({
      ...baseValid,
      destinationLongitude: '200',
    });
    expect(result).toEqual({
      ok: false,
      error: 'Destination longitude must be between -180 and 180',
    });
  });

  it('rejects a missing departure date/time', () => {
    const result = parseMatchingForm({ ...baseValid, departureDateTime: '' });
    expect(result).toEqual({
      ok: false,
      error: 'Departure date/time is required',
    });
  });

  it('rejects an invalid ISO date/time', () => {
    const result = parseMatchingForm({
      ...baseValid,
      departureDateTime: 'not-a-date',
    });
    expect(result).toEqual({
      ok: false,
      error: 'Invalid date/time format (use ISO 8601)',
    });
  });

  it('rejects a departure in the past', () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const result = parseMatchingForm({ ...baseValid, departureDateTime: past });
    expect(result).toEqual({
      ok: false,
      error: 'Departure must be in the future',
    });
  });

  it('rejects a non-integer requestedSeats', () => {
    const result = parseMatchingForm({ ...baseValid, requestedSeats: '1.5' });
    expect(result).toEqual({
      ok: false,
      error: 'Requested seats must be a positive integer',
    });
  });

  it('rejects a non-positive requestedSeats', () => {
    const result = parseMatchingForm({ ...baseValid, requestedSeats: '0' });
    expect(result).toEqual({
      ok: false,
      error: 'Requested seats must be a positive integer',
    });
  });
});
