// src/lib/auth.js
import { supabase } from './supabase'

// Cache de profile como Promise pra evitar race condition.
// Bug #8: na v12 limpávamos o cache antes do callback recarregar, então
// requests simultâneos batiam no banco. Agora a Promise é compartilhada.
let profilePromise = null

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  profilePromise = null
  return data
}

export async function signOut() {
  profilePromise = null
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getProfile() {
  if (profilePromise) return profilePromise
  
  profilePromise = (async () => {
    const session = await getSession()
    if (!session) return null
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', session.user.id)
      .single()
    if (error) {
      profilePromise = null  // permite retry
      return null
    }
    return { ...data, email: session.user.email }
  })()
  
  return profilePromise
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    profilePromise = null
    // Bug #9: se token expira (TOKEN_REFRESHED com session=null, ou USER_DELETED),
    // forçamos sinal de logout pra UI reagir
    if (!session && (event === 'SIGNED_OUT' || event === 'USER_DELETED' || event === 'TOKEN_REFRESHED')) {
      callback(null)
      return
    }
    callback(session)
  })
}

export function clearProfileCache() {
  profilePromise = null
}

// Permissões consolidadas baseadas no role.
// FONTE DA VERDADE: este objeto. Toda checagem de permissão no frontend
// deve usar `permsFor(profile.role).x` em vez de `profile.role === 'admin'`.
// O backend (RLS) faz o cumprimento real — frontend é só pra UX.
export const PERMS = {
  admin:   { ideas:1, products:1, orders:1, names:1, collections:1, factories:1, colors:1, users:1, factoryInfo:1, prices:1, logs:1, shopify:1, payments:1, backup:1 },
  gerente: { ideas:1, products:1, orders:1, names:1, collections:1, factories:0, colors:1, users:0, factoryInfo:1, prices:0, logs:1, shopify:1, payments:0, backup:0 },
  equipe:  { ideas:0, products:1, orders:0, names:0, collections:1, factories:0, colors:1, users:0, factoryInfo:0, prices:0, logs:0, shopify:0, payments:0, backup:0 },
}

export function permsFor(role) {
  return PERMS[role] || PERMS.equipe
}
