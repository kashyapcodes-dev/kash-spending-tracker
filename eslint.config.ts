import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  { ignores: ['dist', '.next'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: { projectService: true },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'import': importPlugin,
    },
    rules: {
      // Forbid .js and .jsx source files
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['*.js', '*.jsx'], message: 'Use .ts/.tsx instead' },
          ],
        },
      ],
      // Import plugin rules
      'import/no-default-export': 'error',
      'import/no-named-as-namespace': 'off',
    },
    settings: {
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } },
    },
  },
  {
    // Package-specific config for @kash packages (core, contract, api-client, ui, integrations, db, config)
    extends: [tseslint.configs.disableTypeChecked],
    files: ['packages/**/*.?([jt])s'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      // Forbid .js and .jsx source files
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['*.js', '*.jsx'], message: 'Use .ts/.tsx instead' },
          ],
        },
      ],
    },
  },
  {
    // apps/web/apps/web - Next.js app with React
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylistic],
    files: ['apps/web/apps/web/**/*.?([jt])s'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: { projectService: true },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      'import': importPlugin,
    },
    rules: {
      // Forbid .js and .jsx source files
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['*.js', '*.jsx'], message: 'Use .ts/.tsx instead' },
          ],
        },
      ],
      // React hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Import plugin rules
      'import/no-default-export': 'error',
      'import/no-named-as-namespace': 'off',
    },
    settings: {
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } },
    },
  },
  {
    // apps/mcp - MCP server (Node.js environment)
    extends: [tseslint.configs.disableTypeChecked],
    files: ['apps/mcp/**/*.?([jt])s'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      // Forbid .js and .jsx source files
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['*.js', '*.jsx'], message: 'Use .ts/.tsx instead' },
          ],
        },
      ],
    },
  },
);
