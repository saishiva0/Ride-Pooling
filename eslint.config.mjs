// RidePool — shared ESLint flat config (ESLint 9).
// A single, intentionally small configuration is applied to every workspace.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.test.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['apps/backend/vitest.config.ts'],
        },
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Keep the foundation light: no stylistic rules that slow development.
    },
  },
);
