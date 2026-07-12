// src/lib/constants.js
// Constantes compartilhadas do domínio

export const KIRA_LOGO = 'https://cdn.shopify.com/s/files/1/0633/6865/9009/files/Branco_1.webp?v=1745818832'
export const EVANY_LOGO = 'https://cdn.shopify.com/s/files/1/0633/6865/9009/files/logo_1_ok-01.png?v=1776305784'

export const FINISH = ['Lace Front','Full Lace','Closure','360 Lace','U-Part','V-Part','Headband Wig','Wig (sem lace)','Rabo de Cavalo','Topper','HD Lace','Transparent Lace']
export const REP_TYPES = ['Repartição Livre','Repartição Meio','Repartição Lateral']
export const REP_SIZES = ['13x2','13x3','13x4','13x5','13x6','13x7']
export const REP_ACAB = ['123++','15133++']
export const HTYPES = ['Liso','Ondulado','Cacheado','Crespo','Body Wave','Deep Wave','Water Wave','Kinky Curly','Kinky Straight','Loose Wave','Jerry Curl','Pixie Cut','Bob']
export const HLENS = ['8"','10"','12"','14"','16"','18"','20"','22"','24"','26"','28"','30"','32"','34"','36"']
export const MATERIALS = ['Fibra Premium','Cabelo Humano','Blend (Humano+Fibra)','Fibra Orgânica','Fibra Heat Friendly']

export const COLOR_STATUSES = [
  { id:'catalog', label:'Em Catálogo', color:'#10B981', icon:'🛍️' },
  { id:'production', label:'Em Produção', color:'#F59E0B', icon:'🏭' },
  { id:'idea', label:'Ideia', color:'#8B5CF6', icon:'💡' },
  { id:'discontinued', label:'Descontinuada', color:'#9CA3AF', icon:'⛔' },
]

export const IDEA_ST = [
  { id:'possibility', label:'Possibilidade', color:'#8B5CF6', icon:'💡' },
  { id:'researching', label:'Pesquisando', color:'#3B82F6', icon:'🔍' },
  { id:'discarded', label:'Descartada', color:'#9CA3AF', icon:'🗑️' },
]

export const PROD_ST = [
  { id:'developing', label:'Em Desenvolvimento', color:'#3B82F6', icon:'🎨' },
  { id:'in_production', label:'Em Produção', color:'#F59E0B', icon:'🏭' },
  { id:'catalog', label:'Em Catálogo', color:'#10B981', icon:'🛍️' },
  { id:'discontinued', label:'Descontinuado', color:'#9CA3AF', icon:'⛔' },
]

export const ORDER_ST = [
  { id:'draft', label:'Rascunho', color:'#9CA3AF', icon:'📝' },
  { id:'sent', label:'Em Revisão', color:'#3B82F6', icon:'🔍' },
  { id:'manufacturing', label:'Em Fabricação', color:'#F59E0B', icon:'🏭' },
  { id:'in_transit', label:'Em Trânsito', color:'#8B5CF6', icon:'✈️' },
  { id:'completed', label:'Concluído', color:'#10B981', icon:'✅' },
]

export const ALL_ST = [...IDEA_ST, ...PROD_ST]
export const PROD_SORT_ORDER = { developing:0, in_production:1, catalog:2, discontinued:3 }

export const SESSION_TIMEOUT_MINUTES = 8 * 60  // 8 horas de inatividade

// Normaliza string pra busca (remove acentos, lowercase)
export function normSearch(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// Versão do sistema — incrementar em cada update
export const APP_VERSION = 'v13.51'
