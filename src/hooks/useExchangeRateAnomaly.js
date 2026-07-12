// src/hooks/useExchangeRateAnomaly.js
// v13.44 — Detecção de anomalia no câmbio USD/BRL.
//
// Busca histórico dos últimos 30 dias (AwesomeAPI — mesma fonte do useUsdRate)
// e compara o câmbio atual contra a média + desvio padrão.
//
// Retorna sinal contextual (não barulho):
//   - LOW  = câmbio abaixo da média histórica → bom momento pra pagar fábrica pendente
//   - HIGH = câmbio acima da média histórica → evite novo pedido agora
//   - NORMAL = dentro da faixa esperada
//
// Sensibilidade: ~1 desvio padrão. Com 30 dias de dados, isso filtra ~68% dos casos (banda normal).
// Implementação sem libs (ciência de dados básica: média + desvio padrão).

import { useState, useEffect } from 'react'
import { log } from '../lib/logger'

const HISTORY_DAYS = 30
const STD_DEV_THRESHOLD = 1.0  // 1 σ pra considerar fora do normal

/**
 * @param {number|null} currentRate - câmbio atual (vem do useUsdRate)
 * @returns {{
 *   status: 'low' | 'high' | 'normal' | 'loading' | 'error',
 *   currentRate: number|null,
 *   avgRate: number|null,
 *   delta: number,          // diferença absoluta (currentRate - avgRate)
 *   deltaPercent: number,   // diferença em %
 *   message: string|null,   // texto curto pra UI
 *   recommendation: string|null, // ação sugerida
 *   history: number[],      // últimos 30 pontos (pra sparkline)
 * }}
 */
export function useExchangeRateAnomaly(currentRate) {
  const [state, setState] = useState({
    status: 'loading',
    currentRate,
    avgRate: null,
    delta: 0,
    deltaPercent: 0,
    message: null,
    recommendation: null,
    history: [],
  })

  useEffect(() => {
    let cancelled = false

    const fetchHistory = async () => {
      try {
        const r = await fetch(`https://economia.awesomeapi.com.br/json/daily/USD-BRL/${HISTORY_DAYS}`)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const d = await r.json()
        if (cancelled) return
        if (!Array.isArray(d) || d.length < 5) {
          setState(s => ({ ...s, status: 'error', history: [] }))
          return
        }

        // Parse e limpeza
        const rates = d
          .map(x => parseFloat(x.bid))
          .filter(x => !isNaN(x) && x > 0)

        if (rates.length < 5) {
          setState(s => ({ ...s, status: 'error', history: rates }))
          return
        }

        const avg = rates.reduce((a, b) => a + b, 0) / rates.length
        const variance = rates.reduce((a, b) => a + (b - avg) ** 2, 0) / rates.length
        const std = Math.sqrt(variance)

        // Se não tem câmbio atual ainda, reporta só histórico
        if (!currentRate || currentRate <= 0) {
          setState({
            status: 'loading',
            currentRate: null,
            avgRate: avg,
            delta: 0,
            deltaPercent: 0,
            message: null,
            recommendation: null,
            history: rates.reverse(),
          })
          return
        }

        const delta = currentRate - avg
        const deltaPercent = (delta / avg) * 100
        const zScore = std > 0 ? delta / std : 0

        let status = 'normal'
        let message = null
        let recommendation = null

        if (zScore < -STD_DEV_THRESHOLD) {
          status = 'low'
          message = `Câmbio ${Math.abs(deltaPercent).toFixed(1)}% abaixo da média de ${HISTORY_DAYS} dias`
          recommendation = 'Momento bom pra pagar fábrica pendente'
        } else if (zScore > STD_DEV_THRESHOLD) {
          status = 'high'
          message = `Câmbio ${deltaPercent.toFixed(1)}% acima da média de ${HISTORY_DAYS} dias`
          recommendation = 'Evite novo pedido agora — aguarde acomodação'
        }

        setState({
          status,
          currentRate,
          avgRate: avg,
          delta,
          deltaPercent,
          message,
          recommendation,
          history: rates.reverse(),  // cronológico (mais antigo → mais recente)
        })
      } catch (err) {
        if (cancelled) return
        log.error('[useExchangeRateAnomaly] erro:', err)
        setState(s => ({ ...s, status: 'error' }))
      }
    }

    fetchHistory()
    // Re-fetch a cada hora (câmbio diário não muda tão rápido)
    const iv = setInterval(fetchHistory, 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [currentRate])

  return state
}
