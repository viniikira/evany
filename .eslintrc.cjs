// Config focada em pegar imports faltantes (no-undef)
module.exports = {
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  env: { browser: true, es2022: true, node: true },
  rules: {
    'no-undef': 'error',
  },
  globals: {
    React: 'readonly',
    JSX: 'readonly',
  },
}
