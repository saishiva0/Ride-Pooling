import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('applies defaults when variables are absent', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/ridepool',
    });

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.isDevelopment).toBe(true);
    expect(config.isProduction).toBe(false);
  });

  it('applies the approved OD-004 matching defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/ridepool',
    });

    expect(config.MATCHING_PICKUP_RADIUS_METERS).toBe(5000);
    expect(config.MATCHING_DEPARTURE_WINDOW_MINUTES).toBe(60);
    expect(config.MATCHING_DESTINATION_TOLERANCE_METERS).toBe(5000);
    expect(config.MATCHING_MAX_RESULTS).toBe(20);
  });

  it('honours explicit OD-004 matching configuration', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/ridepool',
      MATCHING_PICKUP_RADIUS_METERS: '8000',
      MATCHING_DEPARTURE_WINDOW_MINUTES: '45',
      MATCHING_DESTINATION_TOLERANCE_METERS: '3000',
      MATCHING_MAX_RESULTS: '10',
    });

    expect(config.MATCHING_PICKUP_RADIUS_METERS).toBe(8000);
    expect(config.MATCHING_DEPARTURE_WINDOW_MINUTES).toBe(45);
    expect(config.MATCHING_DESTINATION_TOLERANCE_METERS).toBe(3000);
    expect(config.MATCHING_MAX_RESULTS).toBe(10);
  });

  it('throws a clear error when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('throws when DATABASE_URL is not a valid URL', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'not-a-url',
      }),
    ).toThrow(/Invalid environment configuration/);
  });
});
