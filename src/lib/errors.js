// src/lib/errors.js
// Traduz mensagens técnicas do Supabase/Postgres para português acessível.
// Sem isso, o usuário vê coisas como:
//   "new row violates row-level security policy for table 'products'"
// Com isso vê:
//   "Você não tem permissão pra fazer isso. Fale com um administrador."

import { log } from './logger'

const PATTERNS = [
  // Permissões / RLS
  { match: /row-level security|violates row-level security|policy for table/i, 
    msg: 'Você não tem permissão pra essa ação. Fale com um administrador.' },
  { match: /permission denied/i, 
    msg: 'Permissão negada.' },
  { match: /JWT expired|JWT.*expired|jwt.*malformed|invalid.*token/i, 
    msg: 'Sua sessão expirou. Faça login novamente.' },

  // Constraints / duplicatas
  { match: /duplicate key value.*products_name|uq_products_name_lower/i,
    msg: 'Já existe um produto com esse nome. Use outro nome ou edite o produto existente.' },
  { match: /duplicate key value.*ideas_name|uq_ideas_name_lower/i,
    msg: 'Já existe uma ideia com esse nome.' },
  { match: /duplicate key value.*color_variants.*product_code|uq_color_variants_product_code/i,
    msg: 'Esse código de cor já existe nesse produto. Cada cor pode aparecer só uma vez.' },
  { match: /duplicate key value.*colors_code/i,
    msg: 'Essa cor já está cadastrada.' },
  { match: /duplicate key value.*factories_name/i,
    msg: 'Já existe uma fábrica com esse nome.' },
  { match: /duplicate key value.*collections_name/i,
    msg: 'Já existe uma coleção com esse nome.' },
  { match: /duplicate key value.*names_lower|idx_names_lower/i,
    msg: 'Esse nome já está no banco.' },
  { match: /duplicate key/i,
    msg: 'Esse registro já existe.' },

  // Foreign keys
  { match: /violates foreign key.*color_variants/i,
    msg: 'Não é possível remover esse produto: ele tem cores ligadas.' },
  { match: /violates foreign key.*order_items/i,
    msg: 'Esse produto está em pedidos e não pode ser removido. Remova dos pedidos primeiro.' },
  { match: /violates foreign key/i,
    msg: 'Esse item está sendo usado em outro lugar do sistema.' },

  // Validações de campo
  { match: /violates not-null constraint.*"name"/i,
    msg: 'O campo Nome é obrigatório.' },
  { match: /violates not-null constraint.*"factory"/i,
    msg: 'O campo Fábrica é obrigatório.' },
  { match: /violates not-null constraint/i,
    msg: 'Algum campo obrigatório ficou em branco.' },
  { match: /violates check constraint.*status/i,
    msg: 'Status inválido.' },
  { match: /invalid input syntax for type uuid/i,
    msg: 'Identificador inválido.' },

  // Storage
  { match: /payload too large|file too large|exceeded the maximum/i,
    msg: 'Arquivo grande demais. Use uma foto/PDF menor.' },
  { match: /mime type.*not.*supported|invalid_mime_type/i,
    msg: 'Tipo de arquivo não suportado.' },
  { match: /storage.*not found|object not found/i,
    msg: 'Arquivo não encontrado no servidor.' },

  // Auth
  { match: /invalid login credentials|invalid_credentials/i,
    msg: 'Email ou senha incorretos.' },
  { match: /email.*not confirmed/i,
    msg: 'Email não confirmado. Verifique sua caixa de entrada.' },
  { match: /user already registered/i,
    msg: 'Esse email já tem cadastro.' },
  { match: /password.*at least|weak password/i,
    msg: 'A senha precisa ter pelo menos 6 caracteres.' },
  { match: /rate limit/i,
    msg: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.' },

  // Rede
  { match: /failed to fetch|network|networkerror|timeout/i,
    msg: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' },
]

export function translateError(err) {
  if (!err) return 'Erro desconhecido'
  const msg = err.message || err.error_description || err.error || String(err)
  for (const { match, msg: friendly } of PATTERNS) {
    if (match.test(msg)) return friendly
  }
  // Se não casou nenhum padrão, devolve a mensagem original truncada
  return msg.length > 200 ? msg.slice(0, 197) + '...' : msg
}

// Helper: usa em catch e já formata pra toast
export function toastError(toast, err, prefix = '') {
  const friendly = translateError(err)
  toast.push((prefix ? prefix + ': ' : '') + friendly, { kind: 'error', duration: 5000 })
  // Loga também o erro original no console pra debug
  log.error('[KIRA] Erro:', err)
}
