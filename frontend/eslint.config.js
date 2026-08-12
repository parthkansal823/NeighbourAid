/**
 * ESLint 9 flat config (replaces .eslintrc.cjs).
 *
 * Flat config is the only format ESLint 9+ reads by default; the old
 * `.eslintrc.cjs` was silently ignored once the major landed, which is a
 * quiet way to lose your whole lint gate.
 *
 * One rule change worth calling out: `react/jsx-no-undef` is escalated to an
 * error here and `no-undef` stays on for source files. A missing icon import
 * previously slipped past lint and only blew up at build time — see the
 * `Map`/`MapPin` incident in components — because the default config never
 * flagged it.
 */

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    // Build output, native shells and tooling caches are not ours to lint.
    ignores: [
      'dist/**',
      'android/**',
      'ios/**',
      '.wrangler/**',
      '.ruff_cache/**',
      'node_modules/**',
      'public/service-worker.js',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs['recommended-latest'].rules,

      // Runtime-crash guards. Both fire on a component used without an
      // import, which is exactly the class of bug the old config missed.
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',

      // `refs` and `purity` stay errors — both describe real misbehaviour
      // under React 19's concurrent rendering (a ref written during a render
      // that gets discarded; a render whose output depends on Date.now()).
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',

      // `set-state-in-effect` is off, and that is a considered decision
      // rather than a shrug.
      //
      // Its true positives were worth having and have been fixed: two screens
      // stored an unchanging browser capability (`'geolocation' in navigator`)
      // in state via an effect, and AuthContext called logout() synchronously
      // for an already-expired token. Those are gone — see utils/geo.js and
      // the clamped timer in AuthContext.
      //
      // What remains is a limitation of the rule's analysis: it flags
      //
      //     useEffect(() => { void load() }, [load])
      //
      // even when `load` performs *every* setState after an `await`, because
      // it does not model the await boundary — it only sees "effect calls a
      // function that transitively calls setState". That is fetch-on-mount,
      // the single most common legitimate effect, and it is what React's own
      // docs prescribe (with the cancellation flag these loaders already use).
      // The rule cannot be satisfied here without either inlining every fetch
      // or scattering suppressions across nine call sites.
      //
      // Left as `off` rather than `warn` so `--max-warnings 0` stays the
      // default gate; a permanent wall of unfixable warnings just teaches
      // people to stop reading lint output. Revisit when the rule learns to
      // distinguish pre- from post-await state updates.
      'react-hooks/set-state-in-effect': 'off',

      // The codebase documents props in comments rather than PropTypes.
      'react/prop-types': 'off',
      'react-refresh/only-export-components': 'off',

      // Unused imports are dead weight, but an unused catch binding or a
      // deliberately-ignored arg shouldn't fail the build.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },

  {
    // Vitest globals + the jsdom-flavoured setup shim.
    files: ['src/**/*.{test,spec}.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },

  {
    // Node-context config files.
    files: ['*.config.js', 'vite.config.js', 'postcss.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
