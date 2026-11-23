export type FuncaoId =
  | 'fimTarefa'
  | 'respostaFalada'
  | 'precisoDeVoce'
  | 'erroGravidade'
  | 'vozesAgente'
  | 'ferramentaFalar'
  | 'temaPersonagem'
  | 'confirmacaoInicio'
  | 'lerInteira'

export type Persona = 'seco' | 'empolgado' | 'professor' | 'mordomo'

export type Emocao =
  | 'neutro'
  | 'aliviado'
  | 'empolgado'
  | 'preocupado'
  | 'urgente'
  | 'frustrado'
  | 'calmo'

export type TipoAgente = 'pesquisa' | 'revisao' | 'codigo'

export type Motor = 'fish' | 'mac'

export type Config = {
  versao: number
  mudo: boolean
  funcoes: Record<FuncaoId, boolean>
  motor: Motor
  voz: string
  vozMac: string
  persona: Persona
  velocidade: number
  emocao: 'claude' | 'neutra'
  vozesAgente: Record<TipoAgente, string>
  maxFrases: number
  minSegundos: number
  dizerProjeto: boolean
}

export type TipoFala = 'fim' | 'preciso' | 'erro' | 'agente' | 'ferramenta' | 'tema' | 'inicio' | 'resumo' | 'amostra'

export type Locutor = 0 | 1

export type Replica = { quem: Locutor; texto: string; emocao: Emocao }

export type Fala = {
  texto: string
  replicas?: Replica[]
  emocao: Emocao
  tipo: TipoFala
  projeto: string
  voz: string
  motor: Motor
  reserva?: string
  quando: number
  rotulo?: string
  tempos?: Tempos
}

// Milissegundos de cada etapa, contados a partir do momento em que a fala entrou na fila.
export type Tempos = {
  espera: number
  gerar: number
  primeiroSom: number
  ateOuvir: number
  total: number
  cache?: boolean
}

export type Estado = 'pronto' | 'falando' | 'esperando'

export type Gasto = {
  falas: number
  chamadas: number
  tokensEntrada: number
  tokensSaida: number
  bytesFish: number
}

export type Rodada = { pedido: string; resposta: string; segundos: number }

export type Secao = 'agora' | 'funcoes' | 'voz' | 'config'

declare module 'claude-code' {
  interface PluginState {
    arauto: {
      config: Shaped<Config>
      agora: Shaped<Fala | null>
      estado: Estado
      gasto: Shaped<Gasto>
      rodadas: Shaped<Rodada[]>
      abertas: Shaped<Secao[]>
      saudou: boolean
    }
  }
}
