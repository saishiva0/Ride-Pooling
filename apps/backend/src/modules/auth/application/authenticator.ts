/**
 * Provider-independent authentication port (Phase 3.9; Phase 3.18 — OD-005
 * resolved).
 *
 * OD-005 was RESOLVED in Phase 3.18 (phone + OTP via MSG91). The HTTP/socket
 * authenticators now resolve presented bearer tokens through the session
 * service (`auth/http/bearer-authenticator.ts`), which implements this
 * port's contract: it produces the provider-independent `AuthenticationResult`
 * and throws the SAME generic 401 for every failure.
 *
 * This interface remains the seam: its implementation owns credential shape
 * and validation, credential verification, and session/token issuance, and
 * produces the provider-independent `AuthenticationResult`
 * (`domain/identity.ts`) so the rest of the system never sees credentials.
 */
import type { AuthenticationResult } from '../domain/identity.js';

/** Opaque provider-specific credentials. Shape is defined by the concrete method. */
export type AuthCredentials = Record<string, unknown>;

/**
 * The authentication seam. Concrete implementations (the Phase 3.18 bearer
 * authenticator over session validation) implement this interface; the API
 * layer consumes it through the `AuthenticationResult` it produces.
 */
export interface Authenticator {
  /** Machine-readable method id, e.g. 'password' | 'phone-otp' | 'magic-link'. */
  readonly method: string;
  /**
   * Verifies presented credentials and resolves them to an authenticated
   * identity. MUST throw `AuthenticationError` (401) with a generic message
   * for every failure — never reveal which account (if any) exists, and never
   * leak credentials or internal provider errors.
   */
  authenticate(credentials: AuthCredentials): Promise<AuthenticationResult>;
}
