import { z } from 'zod';

/**
 * Environment variable schema. Validated once at startup (see `config/index.ts`).
 * Only values actually required by the running app are required here; future
 * integrations (CORS, JWT, maps, push, socket) stay optional placeholders so
 * unused integrations are never activated.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .url('DATABASE_URL must be a valid URL'),
  CORS_ORIGIN: z.string().url().optional(),
  SOCKET_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Phone + OTP authentication (OD-005 — resolved Phase 3.18). All MSG91
  // options are optional so the app boots (and tests run) without credentials;
  // the OTP provider fails closed when MSG91_AUTH_KEY is absent.
  MSG91_AUTH_KEY: z.string().min(1).optional(),
  MSG91_SENDER_ID: z.string().min(1).max(6).optional(),
  MSG91_BASE_URL: z.string().url().optional(),
  MSG91_OTP_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  MSG91_OTP_LENGTH: z.coerce.number().int().min(4).max(9).default(6),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Matching policy (OD-004 — resolved Phase 3.19). Server-controlled product
  // thresholds: HTTP callers can never supply these. Defaults are the approved
  // V1 values (5 km pickup radius, ±60 min departure window, 5 km destination
  // tolerance, max 20 results).
  MATCHING_PICKUP_RADIUS_METERS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  MATCHING_DEPARTURE_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(60),
  MATCHING_DESTINATION_TOLERANCE_METERS: z.coerce
    .number()
    .int()
    .min(0)
    .default(5000),
  MATCHING_MAX_RESULTS: z.coerce.number().int().min(1).max(100).default(20),
  // Push notifications (Phase 3.23). Optional so the app boots without credentials;
  // the push provider fails closed when not configured.
  PUSH_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
