/**
 * Pure form-input parsers (Phase 3.15 — MOBILE RIDE PARTICIPANT FLOW).
 *
 * Screens receive user-entered strings (TextInput values); these parsers turn
 * them into validated typed inputs, or a human-readable error. They are pure
 * and deterministic so the exact accepted/rejected shapes are unit-tested.
 * They mirror the backend's HTTP-boundary expectations (finite latitude in
 * [-90, 90], longitude in [-180, 180], positive radius).
 *
 * Coordinate bounds are NOT duplicated here: the WGS84 bounds constants and
 * predicates come from the Phase 3.16 mobile location module
 * (`src/location/coordinate.ts`), the mobile mirror of the authoritative
 * Phase 3.12 rules. These parsers only translate user strings to numbers and
 * keep the human-readable messages.
 */
import {
  LATITUDE_MAX,
  LATITUDE_MIN,
  LONGITUDE_MAX,
  LONGITUDE_MIN,
  isValidLatitude,
  isValidLongitude,
} from '../location/coordinate';

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

export interface DiscoveryFormValues {
  latitude: string;
  longitude: string;
  /** Search radius in kilometers (converted to meters for the backend). */
  radiusKm: string;
}

/** Parsed discovery input ready for GET /api/v1/rides/discover. */
export interface DiscoveryInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/** Parses a single coordinate string into a finite number within bounds. */
function parseCoordinate(
  raw: string,
  field: string,
  isValid: (value: number) => boolean,
  min: number,
  max: number,
): ParseResult<number> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: `${field} is required` };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${field} must be a number` };
  }
  if (!isValid(parsed)) {
    return { ok: false, error: `${field} must be between ${min} and ${max}` };
  }
  return { ok: true, value: parsed };
}

/** Input for the matching capability (POST /api/v1/rides/match). */
export interface MatchingFormValues {
  pickupLatitude: string;
  pickupLongitude: string;
  destinationLatitude: string;
  destinationLongitude: string;
  departureDateTime: string;
  requestedSeats?: string;
}

/** Parsed matching input ready for POST /api/v1/rides/match. */
export interface MatchingInput {
  discovery: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  preferredDepartureTime: Date;
  requestedSeats?: number;
}

/** Parses the matching form into a matching input. */
export function parseMatchingForm(
  values: MatchingFormValues,
): ParseResult<MatchingInput> {
  const pickupLatitude = parseCoordinate(
    values.pickupLatitude,
    'Pickup latitude',
    isValidLatitude,
    LATITUDE_MIN,
    LATITUDE_MAX,
  );
  if (!pickupLatitude.ok) {
    return pickupLatitude;
  }

  const pickupLongitude = parseCoordinate(
    values.pickupLongitude,
    'Pickup longitude',
    isValidLongitude,
    LONGITUDE_MIN,
    LONGITUDE_MAX,
  );
  if (!pickupLongitude.ok) {
    return pickupLongitude;
  }

  const destinationLatitude = parseCoordinate(
    values.destinationLatitude,
    'Destination latitude',
    isValidLatitude,
    LATITUDE_MIN,
    LATITUDE_MAX,
  );
  if (!destinationLatitude.ok) {
    return destinationLatitude;
  }

  const destinationLongitude = parseCoordinate(
    values.destinationLongitude,
    'Destination longitude',
    isValidLongitude,
    LONGITUDE_MIN,
    LONGITUDE_MAX,
  );
  if (!destinationLongitude.ok) {
    return destinationLongitude;
  }

  const departureDateTimeRaw = values.departureDateTime.trim();
  if (departureDateTimeRaw === '') {
    return { ok: false, error: 'Departure date/time is required' };
  }
  const preferredDepartureTime = new Date(departureDateTimeRaw);
  if (Number.isNaN(preferredDepartureTime.getTime())) {
    return { ok: false, error: 'Invalid date/time format (use ISO 8601)' };
  }
  if (preferredDepartureTime <= new Date()) {
    return { ok: false, error: 'Departure must be in the future' };
  }

  let requestedSeats: number | undefined = undefined;
  if (values.requestedSeats !== undefined) {
    const trimmed = values.requestedSeats.trim();
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return {
          ok: false,
          error: 'Requested seats must be a positive integer',
        };
      }
      requestedSeats = parsed;
    }
  }

  return {
    ok: true,
    value: {
      discovery: {
        latitude: pickupLatitude.value,
        longitude: pickupLongitude.value,
      },
      destination: {
        latitude: destinationLatitude.value,
        longitude: destinationLongitude.value,
      },
      preferredDepartureTime,
      requestedSeats,
    },
  };
}

/** Parses the discover form into a discovery input (radius in meters). */
export function parseDiscoveryForm(
  values: DiscoveryFormValues,
): ParseResult<DiscoveryInput> {
  const latitude = parseCoordinate(
    values.latitude,
    'Latitude',
    isValidLatitude,
    LATITUDE_MIN,
    LATITUDE_MAX,
  );
  if (!latitude.ok) {
    return latitude;
  }
  const longitude = parseCoordinate(
    values.longitude,
    'Longitude',
    isValidLongitude,
    LONGITUDE_MIN,
    LONGITUDE_MAX,
  );
  if (!longitude.ok) {
    return longitude;
  }

  const radiusKm = values.radiusKm.trim();
  if (radiusKm === '') {
    return { ok: false, error: 'Radius is required' };
  }
  const radius = Number(radiusKm);
  if (!Number.isFinite(radius) || radius <= 0) {
    return { ok: false, error: 'Radius must be a positive number' };
  }

  return {
    ok: true,
    value: {
      latitude: latitude.value,
      longitude: longitude.value,
      radiusMeters: Math.round(radius * 1000),
    },
  };
}

/**
 * Parses a requested-seats entry. `maxSeats` is the ride's currently available
 * seat count (an advisory display cap — the backend remains authoritative).
 */
export function parseRequestedSeats(
  raw: string,
  maxSeats: number,
): ParseResult<number> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Seats is required' };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: 'Seats must be a positive integer' };
  }
  if (parsed > maxSeats) {
    return {
      ok: false,
      error: `At most ${maxSeats} seat${maxSeats === 1 ? '' : 's'} available`,
    };
  }
  return { ok: true, value: parsed };
}

export interface RideCreationFormValues {
  pickupLatitude: string;
  pickupLongitude: string;
  pickupLabel: string;
  destinationLatitude: string;
  destinationLongitude: string;
  destinationLabel: string;
  departureDateTime: string;
  totalSeats: string;
  vehicleType: string;
  discoveryRadiusKm: string;
  pricingType: 'STANDARD' | 'CUSTOM';
  pricePerKm: string;
  estimatedDistanceKm: string;
}

export interface RideCreationInputParsed {
  pickup: { latitude: number; longitude: number; label: string };
  destination: { latitude: number; longitude: number; label: string };
  departureDateTime: Date;
  totalSeats: number;
  vehicleType: string | undefined;
  discoveryRadiusKm: number | undefined;
  pricingType: 'STANDARD' | 'CUSTOM';
  pricePerKm: number;
  estimatedDistanceKm: number | undefined;
  estimatedContribution: number | undefined;
}

export function parseRideCreationForm(
  values: RideCreationFormValues,
): ParseResult<RideCreationInputParsed> {
  const pickupLatitude = parseCoordinate(
    values.pickupLatitude,
    'Pickup latitude',
    isValidLatitude,
    LATITUDE_MIN,
    LATITUDE_MAX,
  );
  if (!pickupLatitude.ok) {
    return pickupLatitude;
  }

  const pickupLongitude = parseCoordinate(
    values.pickupLongitude,
    'Pickup longitude',
    isValidLongitude,
    LONGITUDE_MIN,
    LONGITUDE_MAX,
  );
  if (!pickupLongitude.ok) {
    return pickupLongitude;
  }

  const destinationLatitude = parseCoordinate(
    values.destinationLatitude,
    'Destination latitude',
    isValidLatitude,
    LATITUDE_MIN,
    LATITUDE_MAX,
  );
  if (!destinationLatitude.ok) {
    return destinationLatitude;
  }

  const destinationLongitude = parseCoordinate(
    values.destinationLongitude,
    'Destination longitude',
    isValidLongitude,
    LONGITUDE_MIN,
    LONGITUDE_MAX,
  );
  if (!destinationLongitude.ok) {
    return destinationLongitude;
  }

  const departureDateTimeRaw = values.departureDateTime.trim();
  if (departureDateTimeRaw === '') {
    return { ok: false, error: 'Departure date/time is required' };
  }
  const departureDateTime = new Date(departureDateTimeRaw);
  if (Number.isNaN(departureDateTime.getTime())) {
    return { ok: false, error: 'Invalid date/time format (use ISO 8601)' };
  }
  if (departureDateTime <= new Date()) {
    return { ok: false, error: 'Departure must be in the future' };
  }

  const totalSeatsRaw = values.totalSeats.trim();
  if (totalSeatsRaw === '') {
    return { ok: false, error: 'Total seats is required' };
  }
  const totalSeats = Number(totalSeatsRaw);
  if (!Number.isInteger(totalSeats) || totalSeats < 1) {
    return { ok: false, error: 'Total seats must be a positive integer' };
  }

  const vehicleType = values.vehicleType.trim() || undefined;

  const discoveryRadiusKmRaw = values.discoveryRadiusKm.trim();
  let discoveryRadiusKm: number | undefined = undefined;
  if (discoveryRadiusKmRaw !== '') {
    const radius = Number(discoveryRadiusKmRaw);
    if (!Number.isFinite(radius) || radius <= 0) {
      return { ok: false, error: 'Discovery radius must be a positive number' };
    }
    discoveryRadiusKm = radius;
  }

  const pricingType = values.pricingType;

  const pricePerKmRaw = values.pricePerKm.trim();
  if (pricePerKmRaw === '') {
    return { ok: false, error: 'Price per km is required' };
  }
  const pricePerKm = Number(pricePerKmRaw);
  if (!Number.isFinite(pricePerKm) || pricePerKm <= 0) {
    return { ok: false, error: 'Price per km must be a positive number' };
  }

  const estimatedDistanceKmRaw = values.estimatedDistanceKm.trim();
  let estimatedDistanceKm: number | undefined = undefined;
  if (estimatedDistanceKmRaw !== '') {
    const dist = Number(estimatedDistanceKmRaw);
    if (!Number.isFinite(dist) || dist <= 0) {
      return {
        ok: false,
        error: 'Estimated distance must be a positive number',
      };
    }
    estimatedDistanceKm = dist;
  }

  return {
    ok: true,
    value: {
      pickup: {
        latitude: pickupLatitude.value,
        longitude: pickupLongitude.value,
        label: values.pickupLabel.trim() || 'Pickup',
      },
      destination: {
        latitude: destinationLatitude.value,
        longitude: destinationLongitude.value,
        label: values.destinationLabel.trim() || 'Destination',
      },
      departureDateTime,
      totalSeats,
      vehicleType,
      discoveryRadiusKm,
      pricingType,
      pricePerKm,
      estimatedDistanceKm,
      estimatedContribution: undefined,
    },
  };
}
