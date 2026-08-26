/**
 * Environment name parsing shared across workspaces.
 * Kept deliberately small; application-specific config stays in the apps.
 */
export const NodeEnv = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;

export type NodeEnv = (typeof NodeEnv)[keyof typeof NodeEnv];

export function parseNodeEnv(value: string | undefined): NodeEnv {
  switch (value) {
    case NodeEnv.TEST:
    case NodeEnv.PRODUCTION:
      return value;
    default:
      return NodeEnv.DEVELOPMENT;
  }
}
