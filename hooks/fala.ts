import type { ModelCompleteRequest, ModelCompleteResult } from 'claude-code'

import type { Config, Emocao, Locutor, Persona, Replica, TipoFala } from '../types'

export const EMOCOES: readonly Emocao[] = [
  'neutro',
  'aliviado',
  'empolgado',
  'preocupado',
  'urgente',
  'frustrado',
  'calmo',
]

export const PERSONAS: Record<Persona, { nome: string; jeito: string }> = {
  seco: { nome: 'Seco e direto', jeito: 'seco e direto, sem floreio, frases curtas' },
  empolgado: { nome: 'Empolgado', jeito: 'empolgado e animado, com energia, sem exagerar' },
  professor: { nome: 'Professor paciente', jeito: 'professor paciente, calmo, claro e gentil' },
  mordomo: {
    nome: 'Mordomo irônico',
    jeito: 'mordomo educado com uma pitada de ironia fina, trata o usuário por "senhor"',
  },
}

export function limpar(texto: string, maxFrases?: number, maxChars = 400): string {
  let t = texto
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{8,}/g, ' ')
    .replace(/\b[A-Za-z0-9_\-+=]{28,}\b/g, ' ')
    .replace(/\b[0-9a-f]{16,}\b/gi, ' ')
    .replace(/\S*[\\/]\S*/g, ' ')
    .replace(/\b[\w-]+\.(tsx?|jsx?|json|md|py|sh|ya?ml|toml|lock|css|html|swift|env)\b/gi, ' ')
    .replace(/^\s*[-*+>#|]+\s*/gm, '')
    .replace(/[*_#|~>\[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
  if (maxFrases !== undefined) t = encurtar(t, maxFrases)
  return t.slice(0, maxChars)
}

export const PALAVRAS_POR_FRASE = 14

// Frase termina em . ! ? ; … ou em : e — seguidos de espaço (assim "1.5" não
// conta como duas). Fica com as primeiras `maxFrases` que couberem no limite
// de palavras; uma frase sozinha longa demais é cortada no limite.
function encurtar(texto: string, maxFrases: number): string {
  const frases = texto
    .split(/(?<=[.!?;…])\s+|\s+[—–]\s+|(?<=:)\s+/)
    .map(f => f.trim().replace(/[;:,—–]+$/, '.'))
    .filter(Boolean)
  const limite = PALAVRAS_POR_FRASE * maxFrases
  const escolhidas: string[] = []
  let palavras = 0
  for (const frase of frases.slice(0, maxFrases)) {
    const n = frase.split(/\s+/).length
    if (escolhidas.length > 0 && palavras + n > limite) break
    escolhidas.push(frase)
    palavras += n
  }
  let t = escolhidas.join(' ')
  const todas = t.split(/\s+/)
  if (todas.length > limite) t = `${todas.slice(0, limite).join(' ').replace(/[,;:]$/, '')}.`
  if (!t) return ''
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

const FIXAS: Record<Persona, Partial<Record<TipoFala, string[]>>> = {
  seco: {
    fim: ['Terminei.'],
    preciso: ['Preciso de você.'],
    erro: ['Deu erro.'],
    agente: ['Agente terminou.'],
    tema: ['Arauto ligado.'],
    inicio: ['Certo. Vai levar um tempo.'],
  },
  empolgado: {
    fim: ['Prontinho, terminei!'],
    preciso: ['Ei, preciso de você aqui!'],
    erro: ['Opa, deu um erro!'],
    agente: ['Um agente acabou de terminar!'],
    tema: ['Arauto na área, bora trabalhar!'],
    inicio: ['Bora! Isso vai levar um tempinho, eu te chamo.'],
  },
  professor: {
    fim: ['Pronto, terminei a tarefa.'],
    preciso: ['Quando puder, preciso da sua ajuda.'],
    erro: ['Encontrei um erro, vale dar uma olhada.'],
    agente: ['Um dos agentes concluiu o trabalho.'],
    tema: ['Olá. Vou te avisar quando terminar ou precisar de você.'],
    inicio: ['Entendi. Isso vai levar um tempo, eu te aviso.'],
  },
  mordomo: {
    fim: ['Tarefa concluída, senhor.'],
    preciso: ['Perdão, senhor, sua presença é requisitada.'],
    erro: ['Lamento informar, senhor, houve um contratempo.'],
    agente: ['Um dos auxiliares terminou, senhor.'],
    tema: ['O Arauto está a seu dispor, senhor.'],
    inicio: ['Pois não, senhor. Isso levará algum tempo.'],
  },
}

const EMOCAO_FIXA: Partial<Record<TipoFala, Emocao>> = {
  fim: 'aliviado',
  preciso: 'urgente',
  erro: 'preocupado',
  agente: 'neutro',
  tema: 'calmo',
  inicio: 'calmo',
}

export function fraseFixa(persona: Persona, tipo: TipoFala): { texto: string; emocao: Emocao } {
  const opcoes = FIXAS[persona][tipo] ?? FIXAS.seco[tipo] ?? ['Aviso.']
  return { texto: opcoes[Math.floor(Math.random() * opcoes.length)] ?? 'Aviso.', emocao: EMOCAO_FIXA[tipo] ?? 'neutro' }
}

export type Uso = { entrada: number; saida: number }

export type PedidoDeFrase = {
  tipo: TipoFala
  instrucao: string
  material: string
  config: Config
  // Pode ficar quieto: sem nada que valha dizer, devolve frase vazia em vez da fixa.
  calar?: boolean
}

export type Completar = (pedido: ModelCompleteRequest) => Promise<ModelCompleteResult>

export async function gerarFrase(
  completar: Completar,
  { tipo, instrucao, material, config, calar }: PedidoDeFrase,
): Promise<{ texto: string; emocao: Emocao; uso?: Uso }> {
  const reserva = () => (calar ? { texto: '', emocao: 'neutro' as Emocao } : fraseFixa(config.persona, tipo))
  const persona = PERSONAS[config.persona]
  const system = [
    'Você é o Arauto, a voz do Claude Code. Fala com o usuário em português do Brasil, em voz alta.',
    `Personalidade: ${persona.jeito}.`,
    `Responda com no máximo ${config.maxFrases} frase(s) curtas, de até ${PALAVRAS_POR_FRASE} palavras cada, faladas e naturais, em primeira pessoa (você é o Claude avisando). Sem ponto e vírgula, sem dois-pontos.`,
    'Não diga quanto tempo a tarefa levou, a menos que a instrução peça.',
    'Nunca fale código, nomes de arquivo, caminhos, links, comandos, chaves, tokens ou senhas. Diga o que aconteceu em linguagem comum.',
    'Sem emojis, sem markdown, sem aspas.',
    config.emocao === 'neutra'
      ? 'A emoção é sempre neutro.'
      : `Escolha a emoção que combina com o resultado: ${EMOCOES.join(', ')}.`,
    'Devolva só JSON numa linha: {"emocao":"...","frase":"..."}',
  ].join('\n')
  const prompt = `${instrucao}\n\n<material>\n${material.slice(0, 6000)}\n</material>`
  try {
    const r = await completar({ model: 'haiku', system, prompt, maxTokens: 220, timeoutMs: 12000 })
    if (!r.isAnswered) return reserva()
    const uso = { entrada: r.usage?.input_tokens ?? 0, saida: r.usage?.output_tokens ?? 0 }
    const json = r.text.match(/\{[\s\S]*\}/)?.[0]
    const dados = json ? (JSON.parse(json) as { emocao?: string; frase?: string }) : {}
    const texto = limpar(dados.frase ?? '', config.maxFrases)
    if (!texto) return { ...reserva(), uso }
    const emocao =
      config.emocao === 'neutra' || !EMOCOES.includes(dados.emocao as Emocao)
        ? 'neutro'
        : (dados.emocao as Emocao)
    return { texto, emocao, uso }
  } catch {
    return reserva()
  }
}

export type PedidoDeDialogo = {
  material: string
  config: Config
  nomes: readonly [string, string]
}

export async function gerarDialogo(
  completar: Completar,
  { material, config, nomes }: PedidoDeDialogo,
): Promise<{ replicas: Replica[]; uso?: Uso }> {
  const system = [
    'Você escreve um podcast curtíssimo em português do Brasil, falado por dois apresentadores, resumindo uma sessão de trabalho do Claude Code.',
    `Apresentador 0: ${nomes[0]}, ${PERSONAS[config.persona].jeito}. Apresentador 1: ${nomes[1]}, animada e curiosa, faz perguntas e comenta.`,
    'De 4 a 6 réplicas alternadas, começando pelo apresentador 0. Cada réplica com no máximo 2 frases curtas.',
    'Diga o que foi feito e o que ficou pendente. Nunca fale código, nomes de arquivo, caminhos, links, comandos, chaves, tokens ou senhas.',
    `Emoções possíveis: ${EMOCOES.join(', ')}.`,
    'Devolva só JSON: {"replicas":[{"quem":0,"emocao":"...","texto":"..."}]}',
  ].join('\n')
  try {
    const r = await completar({ model: 'haiku', system, prompt: `<sessao>\n${material.slice(0, 8000)}\n</sessao>`, maxTokens: 900, timeoutMs: 20000 })
    if (!r.isAnswered) return { replicas: [] }
    const uso = { entrada: r.usage?.input_tokens ?? 0, saida: r.usage?.output_tokens ?? 0 }
    const json = r.text.match(/\{[\s\S]*\}/)?.[0]
    const dados = json ? (JSON.parse(json) as { replicas?: { quem?: number; emocao?: string; texto?: string }[] }) : {}
    const replicas = (dados.replicas ?? [])
      .slice(0, 6)
      .map((x, i): Replica => ({
        quem: x.quem === 1 || x.quem === 0 ? x.quem : ((i % 2) as Locutor),
        emocao: EMOCOES.includes(x.emocao as Emocao) ? (x.emocao as Emocao) : 'neutro',
        texto: limpar(x.texto ?? '', 2),
      }))
      .filter(x => x.texto.length > 1)
    return { replicas, uso }
  } catch {
    return { replicas: [] }
  }
}
