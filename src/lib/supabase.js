// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

// v13.45 — Credenciais via variáveis de ambiente (não mais hardcoded).
// Arquivo `.env` na raiz define VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
// Fallback com erro claro se faltar — melhor falhar logo que rodar quebrado.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    '[kira] Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não definidas. ' +
    'Crie o arquivo .env na raiz baseado no .env.example.'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  }
})

export const SUPABASE_PUBLIC_URL = SUPABASE_URL
export const SUPABASE_ANON_KEY = SUPABASE_KEY
