import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts', './tests/register-paths.ts'],
  },
  resolve: {
    alias: {
      '@': srcPath,
      '@/components': `${srcPath}/components`,
      '@/hooks': `${srcPath}/hooks`,
      '@/api': `${srcPath}/api`,
      '@/auth': `${srcPath}/auth`,
      '@/location': `${srcPath}/location`,
      '@/navigation': `${srcPath}/navigation`,
      '@/ride': `${srcPath}/ride`,
      '@/screens': `${srcPath}/screens`,
      '@/state': `${srcPath}/state`,
      '@/theme': `${srcPath}/theme`,
      '@/tests': `${srcPath}/tests`,
      '@/config': `${srcPath}/config`,
      // Deterministic render tests: react-native / expo-status-bar cannot run
      // in a plain Node environment, so tests resolve them to the minimal
      // mocks in ./tests/mocks (test infrastructure only — the app at runtime
      // uses the real modules via Metro).
      'react-native': fileURLToPath(
        new URL('./tests/mocks/react-native.ts', import.meta.url),
      ),
      'expo-status-bar': fileURLToPath(
        new URL('./tests/mocks/expo-status-bar.ts', import.meta.url),
      ),
      // Phase 3.18: the native secure store cannot run in a plain Node
      // environment. Tests resolve it to the fail-closed mock below so that
      // the default auth wiring (session restore) settles deterministically.
      'expo-secure-store': fileURLToPath(
        new URL('./tests/mocks/expo-secure-store.ts', import.meta.url),
      ),
      // Phase 3.20: native map and device-location modules cannot run in a
      // plain Node environment. Tests resolve them to the mocks below so the
      // default Google location wiring and map components settle
      // deterministically.
      'react-native-maps': fileURLToPath(
        new URL('./tests/mocks/react-native-maps.ts', import.meta.url),
      ),
      'expo-location': fileURLToPath(
        new URL('./tests/mocks/expo-location.ts', import.meta.url),
      ),
      // Phase 3.23: the native push-notification modules cannot run in a
      // plain Node environment (importing them for real throws
      // `ReferenceError: __DEV__ is not defined`). Tests resolve them to the
      // fail-closed mocks below.
      'expo-notifications': fileURLToPath(
        new URL('./tests/mocks/expo-notifications.ts', import.meta.url),
      ),
      'expo-device': fileURLToPath(
        new URL('./tests/mocks/expo-device.ts', import.meta.url),
      ),
      'expo-constants': fileURLToPath(
        new URL('./tests/mocks/expo-constants.ts', import.meta.url),
      ),
    },
  },
});
