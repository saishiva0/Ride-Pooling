/**
 * Unit tests for the server-controlled matching configuration mapping
 * (OD-004 — resolved Phase 3.19).
 */
import { describe, expect, it } from 'vitest';
import {
  matchingConfigurationFromConfig,
  matchingMaxResultsFromConfig,
} from './matching-config.js';

describe('matchingConfigurationFromConfig', () => {
  it('maps the approved server config values unchanged (meters/minutes)', () => {
    const config = matchingConfigurationFromConfig({
      MATCHING_PICKUP_RADIUS_METERS: 5000,
      MATCHING_DEPARTURE_WINDOW_MINUTES: 60,
      MATCHING_DESTINATION_TOLERANCE_METERS: 5000,
      MATCHING_MAX_RESULTS: 20,
    });

    expect(config).toEqual({
      pickupRadiusMeters: 5000,
      departureTimeWindowMinutes: 60,
      destinationToleranceMeters: 5000,
    });
  });

  it('passes through non-default server values unchanged', () => {
    const config = matchingConfigurationFromConfig({
      MATCHING_PICKUP_RADIUS_METERS: 8000,
      MATCHING_DEPARTURE_WINDOW_MINUTES: 45,
      MATCHING_DESTINATION_TOLERANCE_METERS: 3000,
      MATCHING_MAX_RESULTS: 10,
    });

    expect(config).toEqual({
      pickupRadiusMeters: 8000,
      departureTimeWindowMinutes: 45,
      destinationToleranceMeters: 3000,
    });
  });
});

describe('matchingMaxResultsFromConfig', () => {
  it('returns the server-owned result cap', () => {
    expect(matchingMaxResultsFromConfig({ MATCHING_MAX_RESULTS: 20 })).toBe(20);
    expect(matchingMaxResultsFromConfig({ MATCHING_MAX_RESULTS: 10 })).toBe(10);
  });
});
