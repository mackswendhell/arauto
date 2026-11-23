import type { Config, Emocao } from '../types'
import { EMOCOES, PALAVRAS_POR_FRASE, PERSONAS } from './fala'

// O próprio Claude fecha a resposta com uma linha que o Arauto fala:
//   <!-- arauto: aliviado | Terminei, senhor. Os testes passaram. -->
// É um comentário HTML: o Markdown não mostra, e o mod ainda tira do texto.
const LINHA = /<!--\s*arauto\s*:\s*([^|>]*?)\s*\|\s*([\s\S]*?)\s*-->/gi

// Enquanto a resposta chega, a linha pode estar pela metade (sem o "-->").
const LINHA_OU_INICIO = /\n*[ \t]*<!--\s*arauto\b[\s\S]*?(?:-->|$)/gi

export type LinhaFalada = { texto: string; emocao: Emocao }

export function extrairLinha(texto: string): LinhaFalada | undefined {
  let achada: LinhaFalada | undefined
  for (const m of texto.matchAll(LINHA)) {
    const emocao = (m[1] ?? '').trim().toLowerCase() as Emocao
    const frase = (m[2] ?? '').trim()
    if (frase) achada = { texto: frase, emocao: EMOCOES.includes(emocao) ? emocao : 'neutro' }
  }
  return achada
}

export const temLinha = (texto: string): boolean => /<!--\s*arauto\b/i.test(texto)

export const tirarLinha = (texto: string): string => texto.replace(LINHA_OU_INICIO, '').trimEnd()

export function instrucaoDaLinha(config: Config): string {
  const oQueDizer = config.funcoes.respostaFalada
    ? `até ${config.maxFrases} frases curtas, de até ${PALAVRAS_POR_FRASE} palavras cada, com o essencial do resultado`
    : 'uma frase curta avisando que terminou'
  return [
    'Arauto (a voz do Claude Code neste computador): termine a sua resposta final deste turno com uma última linha exatamente neste formato, que o usuário não vê e o Arauto fala em voz alta:',
    '<!-- arauto: EMOCAO | FRASE -->',
    `EMOCAO: uma de ${EMOCOES.join(', ')}, no tom do resultado (deu certo, ficou pela metade, deu problema, precisa de uma decisão).`,
    `FRASE: ${oQueDizer}, em português do Brasil, em primeira pessoa, falada e natural, sem ponto e vírgula nem dois-pontos. Personalidade: ${PERSONAS[config.persona].jeito}.`,
    'Nunca ponha na FRASE código, nomes de arquivo, caminhos, links, comandos, chaves, tokens ou senhas, nem quanto tempo a tarefa levou.',
    'Só uma linha dessas, no fim da resposta final; não a mencione no resto do texto.',
  ].join('\n')
}
