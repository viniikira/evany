// src/lib/logger.js
// v13.45 — Logger centralizado.
//
// Por que existe:
//   - Em desenvolvimento: logs verbosos ajudam no debug
//   - Em produção: console poluído confunde usuários e vaza dados em DevTools
//
// Regra:
//   - info/debug/warn: só aparecem em DEV
//   - error: sempre visível (produção precisa ver erros críticos)
//
// Uso:
//   import { log } from '../lib/logger'
//   log.info('carregou produtos', { count: 42 })
//   log.error('falha ao salvar', err)
//
// Migração progressiva — substituir console.* por log.* conforme editar os arquivos.

const isDev = import.meta.env.DEV

function fmt(level, args) {
  const prefix = `[kira:${level}]`
  return [prefix, ...args]
}

export const log = {
  /** Mensagem informativa. Silenciosa em produção. */
  info: (...args) => {
    if (isDev) console.log(...fmt('info', args))
  },
  /** Debug detalhado. Silencioso em produção. */
  debug: (...args) => {
    if (isDev) console.debug(...fmt('debug', args))
  },
  /** Aviso sobre algo não crítico. Silencioso em produção. */
  warn: (...args) => {
    if (isDev) console.warn(...fmt('warn', args))
  },
  /** Erro. Sempre visível — precisamos ver em produção. */
  error: (...args) => {
    console.error(...fmt('error', args))
  },
}
