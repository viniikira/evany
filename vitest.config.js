// vitest.config.js
// Configuração Vitest pro projeto.
// Testa apenas helpers puros (lib/) — sem componentes React por enquanto.
//
// Como rodar:
//   npm test           → executa todos uma vez
//   npm run test:watch → modo watch (re-roda quando arquivo muda)

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    globals: false,
  },
})
