import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { ChaveFish, Config, Emocao, Fala, FuncaoId, Motor, Persona, Replica, Secao, Tempos, TipoAgente, TipoFala } from '../types'
import { PERSONAS, fraseFixa, gerarDialogo, gerarFrase, limpar } from './fala'
import type { PedidoDeFrase } from './fala'
import { MOTORES, VOZES_AGENTE_PADRAO, VOZ_PADRAO, custoFish, motorDe, nomeDaVoz, parceira } from './voz'
import type { Recursos } from './voz'
import { extrairLinha, instrucaoDaLinha, temLinha, tirarLinha } from './linha'
import type { LinhaFalada } from './linha'
import { SEM_CHAVE, apagarChave, gravarChave, legendaDaChave, lerChave, mascarar } from './chave'

const PANE = 'arauto'
const CARTAO = 'arauto-cartao'
const FERRAMENTA = 'mcp__arauto__falar'

const FUNCOES: readonly { id: FuncaoId; nome: string; padrao: boolean }[] = [
  { id: 'fimTarefa', nome: 'Aviso de fim de tarefa', padrao: true },
  { id: 'respostaFalada', nome: 'Resposta falada', padrao: true },
  { id: 'precisoDeVoce', nome: 'Preciso de você', padrao: true },
  { id: 'erroGravidade', nome: 'Erro com gravidade', padrao: true },
  { id: 'vozesAgente', nome: 'Vozes por agente', padrao: true },
  { id: 'ferramentaFalar', nome: 'Ferramenta falar', padrao: true },
  { id: 'temaPersonagem', nome: 'Tema de personagem', padrao: true },
  { id: 'confirmacaoInicio', nome: 'Confirmação de início', padrao: false },
  { id: 'lerInteira', nome: 'Ler a resposta inteira', padrao: false },
]

const VERSAO_CONFIG = 2

const PADRAO: Config = {
  versao: VERSAO_CONFIG,
  mudo: false,
  funcoes: Object.fromEntries(FUNCOES.map(f => [f.id, f.padrao])) as Record<FuncaoId, boolean>,
  motor: 'fish',
  voz: VOZ_PADRAO.fish,
  vozMac: VOZ_PADRAO.mac,
  persona: 'mordomo',
  velocidade: 185,
  emocao: 'claude',
  vozesAgente: VOZES_AGENTE_PADRAO.fish,
  maxFrases: 2,
  minSegundos: 20,
  dizerProjeto: false,
}

const VELOCIDADES = [
  { value: '150', label: 'Lenta' },
  { value: '185', label: 'Normal' },
  { value: '220', label: 'Rápida' },
  { value: '260', label: 'Muito rápida' },
]

const LIMIARES = [
  { value: '0', label: 'Sempre' },
  { value: '10', label: 'Acima de 10 s' },
  { value: '20', label: 'Acima de 20 s' },
  { value: '45', label: 'Acima de 45 s' },
  { value: '60', label: 'Acima de 1 min' },
]

const ROTULO_AGENTE: Record<TipoAgente, string> = {
  pesquisa: 'pesquisa',
  revisao: 'revisão',
  codigo: 'código',
}

const config = atom({ plugin: 'arauto', key: 'config' } as const, PADRAO, { shape: 'config-2' })
const agora = atom({ plugin: 'arauto', key: 'agora' } as const, null, { shape: 'fala-2' })
const estado = atom({ plugin: 'arauto', key: 'estado' } as const, 'pronto')
const gasto = atom(
  { plugin: 'arauto', key: 'gasto' } as const,
  { falas: 0, chamadas: 0, tokensEntrada: 0, tokensSaida: 0, bytesFish: 0 },
  { shape: 'gasto-2' },
)
const rodadas = atom({ plugin: 'arauto', key: 'rodadas' } as const, [], { shape: 'rodadas-1' })
const abertas = atom({ plugin: 'arauto', key: 'abertas' } as const, ['agora'], { shape: 'abertas-1' })
const saudou = atom({ plugin: 'arauto', key: 'saudou' } as const, false)
const chaveFish = atom({ plugin: 'arauto', key: 'chave' } as const, SEM_CHAVE, { shape: 'chave-1' })

type Gerada = { texto: string; emocao: Emocao; replicas?: Replica[] }

type Tarefa = {
  criada?: number
  rotulo?: string
  fixa?: boolean
  tipo: TipoFala
  voz?: string
  pendencia?: string
  semPrefixo?: boolean
  motor?: Motor
  guardado?: string
  gerar: () => Promise<Gerada | null>
}

// O aviso de fim fica guardado no store até ser falado: se o mod recarregar
// no meio (a cópia antiga é descartada), a cópia nova fala de novo.
type AvisoGuardado = {
  turnId: string
  quando: number
  situacao: 'na fila' | 'falando' | 'falado' | 'pulado'
  motivo?: string
  instrucao?: string
  material?: string
  texto?: string
  emocao?: Emocao
}

type Pendencia = { tool: string; timer?: Timer; repetir?: Timer }

type Turno = { id: string; texto: string; aviso?: Timer; errosFalados: number }

type Nucleo = {
  enfileirar: (tarefa: Tarefa) => void
  frase: (pedido: PedidoDeFrase) => Promise<Gerada | null>
  salvarConfig: (mudar: (c: Config) => Config) => Promise<void>
  definirMudo: (mudo?: boolean) => Promise<void>
  aguardar: (tool: string, atraso: number) => void
  resolverFerramenta: (tool: string) => Promise<void>
  resolverTodas: () => Promise<void>
  avisarErro: (comando: string, saida: string) => Promise<void>
  resumir: () => Promise<string>
  abrirPainel: () => Promise<void>
  minimizar: () => Promise<void>
  atualizarChave: () => Promise<void>
  salvarChave: (texto: string) => Promise<void>
  apagarChave: () => Promise<void>
  editarChave: (editando: boolean) => Promise<void>
  depois: (ms: number, fn: () => void) => Timer
}

const ligada = (c: Config, id: FuncaoId) => !c.mudo && c.funcoes[id]

const medir = (
  criada: number,
  inicioGerar: number,
  fimGerar: number,
  chamada: number,
  r: { primeiroSom: number; cache?: boolean },
): Tempos => ({
  espera: inicioGerar - criada,
  gerar: fimGerar - inicioGerar,
  primeiroSom: r.primeiroSom,
  ateOuvir: chamada - criada + r.primeiroSom,
  total: Date.now() - criada,
  cache: r.cache,
})

const duracaoFalada = (segundos: number): string => {
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return minutos === 1 ? 'um minuto' : `${minutos} minutos`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  const h = horas === 1 ? 'uma hora' : `${horas} horas`
  return resto === 0 ? h : `${h} e ${resto} minutos`
}

const dolares = (valor: number, casas: number) => `US$ ${valor.toFixed(casas).replace('.', ',')}`

const segundosFalados = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`

const trocarMotor = (c: Config, motor: Motor): Config =>
  c.motor === motor ? c : { ...c, motor, voz: VOZ_PADRAO[motor], vozesAgente: VOZES_AGENTE_PADRAO[motor] }

const tipoDeAgente = (subagentType: string): TipoAgente =>
  /review|revis|audit|secur|critique|check/i.test(subagentType)
    ? 'revisao'
    : /explore|research|pesquis|search|guide|general/i.test(subagentType)
      ? 'pesquisa'
      : 'codigo'

function fraseDePreciso(persona: Persona, tool: string, repetindo: boolean): Gerada {
  const motivo =
    tool === 'AskUserQuestion'
      ? 'Tenho uma pergunta.'
      : tool === 'ExitPlanMode'
        ? 'O plano está pronto para você aprovar.'
        : 'Tem uma permissão esperando.'
  if (repetindo) {
    const ainda: Record<Persona, string> = {
      seco: 'Ainda preciso de você.',
      empolgado: 'Ei, ainda estou te esperando!',
      professor: 'Ainda estou esperando sua resposta, quando puder.',
      mordomo: 'Senhor, permita-me insistir: ainda aguardo sua resposta.',
    }
    return { texto: `${ainda[persona]} ${motivo}`, emocao: 'urgente' }
  }
  return { texto: `${fraseFixa(persona, 'preciso').texto} ${motivo}`, emocao: 'urgente' }
}

export const register: Register = on => {
  let nucleo: Nucleo | null = null
  let projeto = ''
  let fila: Tarefa[] = []
  let tocando = false
  let atual: AbortController | null = null
  let turno: Turno | null = null
  let ultimoErro = 0
  let contador = 0
  let fishFalhando = false
  // O que a pessoa colou no campo da chave, só até salvar; nunca vai para o estado.
  let rascunhoChave = ''
  const pendentes = new Map<string, Pendencia>()

  on('session.start', async ($, e, next) => {
    projeto = e.cwd.split('/').filter(Boolean).pop() ?? ''
    const sessao = await $.session.id()

    const atualizarStatus = async () => {
      const c = await read($, config)
      const s = await read($, estado)
      const rotulo = c.mudo ? 'mudo' : s === 'falando' ? 'falando' : s === 'esperando' ? 'esperando você' : 'pronto'
      $.ui.status(`Arauto · ${nomeDaVoz(c.voz)} · ${rotulo}`)
    }

    const salvarConfig = async (mudar: (c: Config) => Config) => {
      await update($, config, c => mudar(c))
      await $.store.set('config', await read($, config))
      await atualizarStatus()
    }

    const definirMudo = async (mudo?: boolean) => {
      await salvarConfig(c => ({ ...c, mudo: mudo ?? !c.mudo }))
      if ((await read($, config)).mudo) {
        fila = []
        atual?.abort('mudo')
      }
    }

    const frase = async (pedido: PedidoDeFrase): Promise<Gerada | null> => {
      const r = await gerarFrase(req => $.model.complete(req), pedido)
      const uso = r.uso
      if (uso) {
        await update($, gasto, g => ({
          ...g,
          chamadas: g.chamadas + 1,
          tokensEntrada: g.tokensEntrada + uso.entrada,
          tokensSaida: g.tokensSaida + uso.saida,
        }))
      }
      return { texto: r.texto, emocao: r.emocao }
    }

    const pegarVez = async () => {
      const limite = Date.now() + 60_000
      for (;;) {
        const agoraMs = Date.now()
        const vez = (await $.store.get('vez')) as { sessao: string; ate: number } | undefined
        if (!vez || vez.sessao === sessao || vez.ate < agoraMs || agoraMs > limite) {
          await $.store.set('vez', { sessao, ate: agoraMs + 30_000 })
          return
        }
        await $.clock.sleep(400)
      }
    }

    const soltarVez = async () => {
      const vez = (await $.store.get('vez')) as { sessao: string } | undefined
      if (vez?.sessao === sessao) await $.store.delete('vez')
    }

    const marcar = async (turnId: string | undefined, situacao: AvisoGuardado['situacao'], motivo?: string) => {
      if (!turnId) return
      const guardado = (await $.store.get('fim')) as AvisoGuardado | undefined
      if (guardado?.turnId !== turnId) return
      await $.store.set('fim', { ...guardado, situacao, motivo })
    }

    const tocar = async () => {
      if (tocando) return
      tocando = true
      try {
        while (fila.length > 0) {
          const tarefa = fila.shift()
          if (!tarefa) break
          if ((await read($, config)).mudo) {
            fila = []
            break
          }
          if (tarefa.pendencia && !pendentes.has(tarefa.pendencia)) continue
          const criada = tarefa.criada ?? Date.now()
          const inicioGerar = Date.now()
          const gerada = await tarefa.gerar()
          const fimGerar = Date.now()
          const c = await read($, config)
          if (!gerada?.texto || c.mudo) {
            await marcar(tarefa.guardado, 'pulado', c.mudo ? 'mudo' : 'frase vazia')
            continue
          }
          if (tarefa.pendencia && !pendentes.has(tarefa.pendencia)) continue
          try {
            const raiz = await $.session.root()
            projeto = raiz.split('/').filter(Boolean).pop() ?? projeto
          } catch {}
          const comPrefixo = c.dizerProjeto && projeto !== '' && !tarefa.semPrefixo
          const texto = comPrefixo ? `${projeto}. ${gerada.texto}` : gerada.texto
          const motorPedido = tarefa.motor ?? c.motor
          const voz = tarefa.voz ?? (motorPedido === c.motor ? c.voz : c.vozMac)
          const replicas = gerada.replicas
          const fala: Fala = {
            texto,
            replicas,
            emocao: gerada.emocao,
            tipo: tarefa.tipo,
            projeto,
            voz,
            motor: motorPedido,
            quando: Date.now(),
            rotulo: tarefa.rotulo,
          }
          await update($, agora, () => fala)
          await update($, gasto, g => ({ ...g, falas: g.falas + 1 }))
          await pegarVez()
          await update($, estado, () => 'falando')
          await atualizarStatus()
          const controle = new AbortController()
          atual = controle
          await marcar(tarefa.guardado, 'falando')
          const recursos: Recursos = {
            falarNoSistema: (t, opcoes) => $.audio.speak(t, opcoes),
            rodar: (argv, init) => $.process.run(argv, init),
            tocar: (clip, opcoes) => $.audio.play(clip, opcoes),
            tocarFluxo: async (script, env, signal, limiteMs) => {
              const marca = `arauto-fala-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
              const fluxo = $.process.spawn({ argv: ['/bin/bash', '-c', script, marca], env })
              const parar = () => {
                void $.process.run(['/usr/bin/pkill', '-TERM', '-f', marca]).catch(() => undefined)
              }
              if (signal.aborted) parar()
              signal.addEventListener('abort', parar, { once: true })
              const limite = $.clock.after(limiteMs, parar)
              let stderr = ''
              let primeiroSom: number | undefined
              try {
                for await (const parte of fluxo) {
                  if (parte.stream !== 'stderr') continue
                  stderr += parte.text
                  if (primeiroSom === undefined && /(^|\n)som\n/.test(stderr)) primeiroSom = Date.now()
                }
              } finally {
                signal.removeEventListener('abort', parar)
                limite.cancel()
              }
              const fim = await fluxo.result.catch(() => ({ code: null }))
              return { codigo: fim.code, stderr, primeiroSom }
            },
          }
          const pedido = { texto, emocao: gerada.emocao, velocidade: c.velocidade, signal: controle.signal }
          const dizer = (m: Motor, principal: string) =>
            replicas
              ? MOTORES[m].dialogo(recursos, {
                  replicas,
                  vozes: [principal, parceira(m, principal)],
                  velocidade: c.velocidade,
                  signal: controle.signal,
                })
              : MOTORES[m].falar(recursos, { ...pedido, voz: principal, guardar: tarefa.fixa === true })
          let final: Fala = fala
          try {
            try {
              const chamada = Date.now()
              const r = await dizer(motorPedido, voz)
              const { bytes } = r
              final = { ...final, tempos: medir(criada, inicioGerar, fimGerar, chamada, r) }
              if (bytes > 0) await update($, gasto, g => ({ ...g, bytesFish: g.bytesFish + bytes }))
              if (motorPedido === 'fish') fishFalhando = false
            } catch (erro) {
              if (controle.signal.aborted || motorPedido === 'mac') throw erro
              const reserva = erro instanceof Error ? erro.message : String(erro)
              final = { ...fala, motor: 'mac', voz: c.vozMac, reserva }
              await update($, agora, () => final)
              if (!fishFalhando) $.ui.log(`Arauto: ${reserva}. Usando a voz do Mac como reserva.`)
              fishFalhando = true
              const chamada = Date.now()
              const r = await dizer('mac', c.vozMac)
              final = { ...final, tempos: medir(criada, inicioGerar, fimGerar, chamada, r) }
            }
            await marcar(tarefa.guardado, 'falado')
            await update($, agora, () => final)
          } catch (erro) {
            await marcar(tarefa.guardado, 'pulado', controle.signal.aborted ? 'cortado' : String(erro))
            if (!controle.signal.aborted) $.ui.log(`Arauto: não consegui falar (${String(erro)})`)
          } finally {
            atual = null
            await soltarVez()
          }
        }
      } finally {
        tocando = false
        await update($, estado, () => (pendentes.size > 0 ? 'esperando' : 'pronto'))
        await atualizarStatus()
      }
    }

    const enfileirar = (tarefa: Tarefa) => {
      fila.push({ criada: Date.now(), ...tarefa })
      $.clock.after(0, () => void tocar())
    }

    const chamar = async (id: string, repetindo: boolean) => {
      const p = pendentes.get(id)
      if (!p) return
      const c = await read($, config)
      if (!ligada(c, 'precisoDeVoce')) return
      await update($, estado, () => 'esperando')
      await atualizarStatus()
      enfileirar({ tipo: 'preciso', pendencia: id, fixa: true, gerar: async () => fraseDePreciso(c.persona, p.tool, repetindo) })
      if (!repetindo) p.repetir = $.clock.after(120_000, () => void chamar(id, true))
    }

    const aguardar = (tool: string, atraso: number) => {
      contador += 1
      const id = `pendencia-${contador}`
      const p: Pendencia = { tool }
      pendentes.set(id, p)
      p.timer = $.clock.after(atraso, () => void chamar(id, false))
    }

    const resolver = async (id: string) => {
      const p = pendentes.get(id)
      if (!p) return
      p.timer?.cancel()
      p.repetir?.cancel()
      pendentes.delete(id)
      if (pendentes.size === 0 && (await read($, estado)) === 'esperando') {
        await update($, estado, () => 'pronto')
        await atualizarStatus()
      }
    }

    const resolverFerramenta = async (tool: string) => {
      const achada = [...pendentes].find(([, p]) => p.tool === tool || p.tool === 'permissao')
      if (achada) await resolver(achada[0])
    }

    const resolverTodas = async () => {
      for (const id of [...pendentes.keys()]) await resolver(id)
    }

    const avisarErro = async (comando: string, saida: string) => {
      const c = await read($, config)
      if (!ligada(c, 'erroGravidade')) return
      const texto = saida.trim()
      if (texto.length < 20 || /^exit code \d+\s*$/i.test(texto)) return
      const agoraMs = Date.now()
      if ((turno && turno.errosFalados > 0) || agoraMs - ultimoErro < 90_000) return
      ultimoErro = agoraMs
      if (turno) turno.errosFalados += 1
      enfileirar({
        tipo: 'erro',
        gerar: () =>
          frase({
            tipo: 'erro',
            instrucao:
              'Um comando que rodei falhou. Diga em uma frase o que deu errado, sem citar o comando. Tom conforme a gravidade: leve (calmo), atrapalha o trabalho (preocupado), grave como perda de dados, build quebrado ou falta de acesso (urgente).',
            material: `Comando: ${comando.slice(0, 500)}\n\nSaída:\n${texto.slice(-2500)}`,
            config: { ...c, maxFrases: 1 },
          }),
      })
    }

    const resumir = async (): Promise<string> => {
      const lista = await read($, rodadas)
      const c = await read($, config)
      if (lista.length === 0) {
        const vazio = 'Ainda não rodou nada nesta sessão.'
        enfileirar({ tipo: 'resumo', semPrefixo: true, gerar: async () => ({ texto: vazio, emocao: 'neutro' }) })
        return vazio
      }
      const material = lista
        .slice(-15)
        .map((r, i) => `${i + 1}. Pedido: ${r.pedido}\nResultado (${r.segundos}s): ${r.resposta}`)
        .join('\n\n')
      const principal = c.motor === 'fish' ? c.voz : c.vozMac
      const nomes = [nomeDaVoz(principal), nomeDaVoz(parceira(c.motor, principal))] as const
      const r = await gerarDialogo(req => $.model.complete(req), { material, config: c, nomes })
      const uso = r.uso
      if (uso) {
        await update($, gasto, g => ({
          ...g,
          chamadas: g.chamadas + 1,
          tokensEntrada: g.tokensEntrada + uso.entrada,
          tokensSaida: g.tokensSaida + uso.saida,
        }))
      }
      if (r.replicas.length === 0) {
        const falhou = 'Não consegui montar o resumo agora.'
        enfileirar({ tipo: 'resumo', semPrefixo: true, gerar: async () => ({ texto: falhou, emocao: 'preocupado' }) })
        return falhou
      }
      const roteiro = r.replicas.map(x => `${nomes[x.quem]}: ${x.texto}`).join('\n')
      enfileirar({
        tipo: 'resumo',
        semPrefixo: true,
        gerar: async () => ({ texto: roteiro, emocao: r.replicas[0]?.emocao ?? 'neutro', replicas: r.replicas }),
      })
      return roteiro
    }

    const abrirPainel = async () => {
      await $.ui.close({ id: CARTAO })
      await $.ui.open({ id: PANE, title: 'Arauto' })
    }

    const minimizar = async () => {
      await $.ui.close({ id: PANE })
      await $.ui.open({ id: CARTAO, title: 'Arauto', placement: 'widget' })
    }

    const rodarScript = (argv: readonly string[], init?: { stdin?: string; timeoutMs?: number }) =>
      $.process.run(argv, init)

    const atualizarChave = async () => {
      const lida = await lerChave(rodarScript).catch(() => null)
      if (lida) await update($, chaveFish, atual => ({ ...atual, ...lida, aviso: undefined }))
    }

    const salvarChave = async (texto: string) => {
      rascunhoChave = ''
      if (!texto.trim()) return
      await update($, chaveFish, atual => ({ ...atual, aviso: 'Testando a chave na Fish…' }))
      const r = await gravarChave(rodarScript, texto).catch(() => null)
      if (!r) {
        await update($, chaveFish, atual => ({ ...atual, aviso: 'Não consegui guardar a chave. Tente de novo.' }))
      } else if (r.recusada) {
        await update($, chaveFish, atual => ({
          ...atual,
          editando: true,
          aviso: atual.situacao === 'sem-chave'
            ? 'A Fish recusou essa chave. Confira e cole de novo.'
            : 'A Fish recusou essa chave. A anterior continua valendo.',
        }))
      } else if (!r.vazia) {
        fishFalhando = false
        await update($, chaveFish, () => ({ ...r.chave, editando: false }))
      }
    }

    const removerChave = async () => {
      rascunhoChave = ''
      await apagarChave(rodarScript).catch(() => undefined)
      await update($, chaveFish, () => SEM_CHAVE)
    }

    const editarChave = async (editando: boolean) => {
      rascunhoChave = ''
      await update($, chaveFish, atual => ({ ...atual, editando, aviso: undefined }))
    }

    nucleo = {
      enfileirar,
      frase,
      salvarConfig,
      definirMudo,
      aguardar,
      resolverFerramenta,
      resolverTodas,
      avisarErro,
      resumir,
      abrirPainel,
      minimizar,
      atualizarChave,
      salvarChave,
      apagarChave: removerChave,
      editarChave,
      depois: (ms, fn) => $.clock.after(ms, fn),
    }
    void atualizarChave()

    const salvo = (await $.store.get('config')) as Partial<Config> | undefined
    const atualizado = salvo?.versao === VERSAO_CONFIG
    const preferencias: Partial<Config> = atualizado
      ? (salvo ?? {})
      : {
          mudo: salvo?.mudo,
          velocidade: salvo?.velocidade,
          emocao: salvo?.emocao,
          maxFrases: salvo?.maxFrases,
          minSegundos: salvo?.minSegundos,
          dizerProjeto: salvo?.dizerProjeto,
        }
    const definidas = Object.fromEntries(Object.entries(preferencias).filter(([, v]) => v !== undefined))
    await update($, config, () => ({
      ...PADRAO,
      ...definidas,
      versao: VERSAO_CONFIG,
      funcoes: { ...PADRAO.funcoes, ...salvo?.funcoes },
      vozesAgente: { ...PADRAO.vozesAgente, ...(atualizado ? salvo?.vozesAgente : {}) },
    }))
    if (!atualizado) await $.store.set('config', await read($, config))
    await $.command.register({
      name: 'voz',
      description: 'Arauto: liga, desliga ou troca a voz',
      argumentHint: '[liga | desliga | lista | nome da voz]',
    })
    await $.command.register({ name: 'resumo', description: 'Arauto: resumo falado do que rodou na sessão' })
    await $.command.register({ name: 'arauto', description: 'Arauto: abre o painel' })
    await $.tool.register({
      name: 'falar',
      description:
        'Fala uma frase curta em voz alta para o usuário (português do Brasil). Use quando quiser chamar a atenção dele no meio do trabalho, por exemplo para um aviso importante. Não use para o aviso de fim de tarefa, que já é automático. Nunca inclua código, caminhos, links ou segredos.',
      inputSchema: {
        type: 'object',
        properties: {
          frase: { type: 'string', description: 'Uma ou duas frases curtas, como seriam ditas.' },
          emocao: {
            type: 'string',
            enum: ['neutro', 'aliviado', 'empolgado', 'preocupado', 'urgente', 'frustrado', 'calmo'],
          },
        },
        required: ['frase'],
      },
      isDeferred: false,
    })
    await atualizarStatus()
    const abertos = await $.ui.panes().then(
      lista => lista.map(p => p.id),
      () => [] as string[],
    )
    if (e.surface !== 'terminal' && !abertos.includes(PANE) && !abertos.includes(CARTAO)) {
      void $.ui.open({ id: CARTAO, title: 'Arauto', placement: 'widget' })
    }
    const c = await read($, config)
    const guardado = (await $.store.get('fim')) as AvisoGuardado | undefined
    if (guardado?.situacao === 'na fila' && Date.now() - guardado.quando < 180_000) {
      const { instrucao, material = '', texto, emocao = 'neutro' } = guardado
      if (texto) {
        enfileirar({ tipo: 'fim', guardado: guardado.turnId, gerar: async () => ({ texto, emocao }) })
      } else if (instrucao) {
        enfileirar({ tipo: 'fim', guardado: guardado.turnId, gerar: () => frase({ tipo: 'fim', instrucao, material, config: c }) })
      }
    }
    if (!(await read($, saudou))) {
      await update($, saudou, () => true)
      if (ligada(c, 'temaPersonagem')) {
        enfileirar({ tipo: 'tema', semPrefixo: true, fixa: true, gerar: async () => fraseFixa(c.persona, 'tema') })
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    turno?.aviso?.cancel()
    const este: Turno = { id: e.turnId, texto: e.text, errosFalados: 0 }
    turno = este
    await $.store.set('turno', { id: e.turnId, texto: e.text.slice(0, 500) })
    await $.store.delete('linha')
    const c = await read($, config)
    if (nucleo && ligada(c, 'confirmacaoInicio') && e.text) {
      const n = nucleo
      este.aviso = n.depois(12_000, () => {
        if (turno?.id === este.id) n.enfileirar({ tipo: 'inicio', fixa: true, gerar: async () => fraseFixa(c.persona, 'inicio') })
      })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const guardar = (aviso: Omit<AvisoGuardado, 'turnId' | 'quando'>) =>
      $.store.set('fim', { turnId: e.turnId, quando: Date.now(), ...aviso })
    for (let i = 0; !nucleo && i < 50; i++) await $.clock.sleep(100)
    const n = nucleo
    const capturada = ((await $.store.get('linha')) as LinhaFalada | undefined) ?? extrairLinha(e.answer)
    await $.store.delete('linha')
    const resposta = tirarLinha(e.answer)
    turno?.aviso?.cancel()
    const guardado = (await $.store.get('turno')) as { id: string; texto: string } | undefined
    const pedido = turno?.id === e.turnId ? turno.texto : guardado?.id === e.turnId ? guardado.texto : ''
    turno = null
    await n?.resolverTodas()
    const segundos = Math.round(e.durationMs / 1000)
    await update($, rodadas, l =>
      [...l, { pedido: pedido.slice(0, 500), resposta: resposta.slice(0, 1500), segundos }].slice(-30),
    )
    const c = await read($, config)
    if (c.mudo || e.isAborted) {
      await guardar({ situacao: 'pulado', motivo: c.mudo ? 'mudo' : 'interrompida' })
      return r
    }
    if (e.reason === 'error' || e.reason === 'refusal') {
      if (n && ligada(c, 'erroGravidade')) {
        const instrucao =
          e.reason === 'refusal'
            ? 'O modelo se recusou a continuar a tarefa. Avise em uma frase, tom preocupado.'
            : 'A tarefa parou por um erro da API (limite, conexão ou contexto cheio). Avise em uma frase, tom urgente.'
        n.enfileirar({
          tipo: 'erro',
          gerar: () => n.frase({ tipo: 'erro', instrucao, material: e.answer, config: { ...c, maxFrases: 1 } }),
        })
      }
      return r
    }
    if (segundos < c.minSegundos) {
      await guardar({ situacao: 'pulado', motivo: `curta (${segundos} s)` })
      return r
    }
    if (ligada(c, 'lerInteira')) {
      const inteira = limpar(resposta, undefined, 4000)
      if (inteira) n?.enfileirar({ tipo: 'fim', gerar: async () => ({ texto: inteira, emocao: 'neutro' }) })
      return r
    }
    const resumo = ligada(c, 'respostaFalada')
    if (!resumo && !ligada(c, 'fimTarefa')) {
      await guardar({ situacao: 'pulado', motivo: 'funções desligadas' })
      return r
    }
    if (capturada) {
      const texto =
        segundos > 60
          ? `${limpar(capturada.texto, 1)} Levou ${duracaoFalada(segundos)}.`
          : limpar(capturada.texto, c.maxFrases)
      const emocao: Emocao = c.emocao === 'neutra' ? 'neutro' : capturada.emocao
      if (texto.length > 1) {
        await guardar({ situacao: 'na fila', texto, emocao })
        n?.enfileirar({ tipo: 'fim', rotulo: 'linha do Claude', guardado: e.turnId, gerar: async () => ({ texto, emocao }) })
        return r
      }
    }
    const tempo =
      segundos > 60
        ? `A tarefa levou ${duracaoFalada(segundos)}; diga isso de passagem.`
        : 'Não mencione quanto tempo levou.'
    const instrucao = resumo
      ? `Terminei uma tarefa. ${tempo} Avise que terminei e diga, em linguagem falada, o essencial da resposta abaixo, no tom do resultado (deu certo, ficou pela metade, deu problema, precisa de uma decisão).`
      : `Terminei uma tarefa. ${tempo} Avise que terminei, no tom do resultado, sem detalhar.`
    const material = `Pedido: ${pedido}\n\nResposta final:\n${resposta.slice(0, 6000)}`
    await guardar({ situacao: 'na fila', instrucao, material })
    n?.enfileirar({
      tipo: 'fim',
      rotulo: 'Haiku de reserva',
      guardado: e.turnId,
      gerar: () => n.frase({ tipo: 'fim', instrucao, material, config: c }),
    })
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    const c = await read($, config)
    const fala = !c.mudo && !c.funcoes.lerInteira && (c.funcoes.fimTarefa || c.funcoes.respostaFalada)
    if (!fala) return next(e)
    return next({ ...e, context: [...(e.context ?? []), instrucaoDaLinha(c)] })
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId || !Array.isArray(e.message.content)) return next(e)
    let achada: LinhaFalada | undefined
    const content = e.message.content.map(bloco => {
      const texto = bloco.type === 'text' && typeof bloco.text === 'string' ? bloco.text : undefined
      if (texto === undefined || !temLinha(texto)) return bloco
      achada = extrairLinha(texto) ?? achada
      return { ...bloco, text: tirarLinha(texto) }
    })
    if (!achada) return next(e)
    await $.store.set('linha', achada)
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) =>
    temLinha(e.props.text) ? next({ ...e, props: { ...e.props, text: tirarLinha(e.props.text) } }) : next(e),
  )

  on('classic.PermissionRequest', async ($, e, next) => {
    const pergunta = e.tool_name === 'AskUserQuestion' || e.tool_name === 'ExitPlanMode'
    nucleo?.aguardar(e.tool_name, pergunta ? 500 : 1500)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' && pendentes.size === 0) nucleo?.aguardar('permissao', 1500)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', async ($, e, next) => {
    await nucleo?.resolverFerramenta(e.tool_name)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    await nucleo?.resolverFerramenta(e.tool_name)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await nucleo?.resolverFerramenta(e.tool_name)
    if (e.tool_name === 'Bash' && !e.is_interrupt) {
      const comando = String((e.tool_input as { command?: unknown } | undefined)?.command ?? '')
      void nucleo?.avisarErro(comando, e.error)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: FERRAMENTA }, async ($, e) => {
    const entrada = e as unknown as { frase?: unknown; emocao?: unknown }
    const c = await read($, config)
    if (!nucleo || !ligada(c, 'ferramentaFalar')) {
      return { result: 'O Arauto está mudo ou com a ferramenta falar desligada; nada foi dito.' }
    }
    const texto = limpar(String(entrada.frase ?? ''), c.maxFrases)
    if (!texto) return { result: 'Frase vazia depois da limpeza; nada foi dito.' }
    const emocao: Emocao = c.emocao === 'neutra' ? 'neutro' : ((entrada.emocao as Emocao | undefined) ?? 'neutro')
    nucleo.enfileirar({ tipo: 'ferramenta', gerar: async () => ({ texto, emocao }) })
    return { result: `Na fila para falar: ${texto}` }
  })

  on('agent.report', async ($, e, next) => {
    const r = await next(e)
    const c = await read($, config)
    const n = nucleo
    if (n && ligada(c, 'vozesAgente') && !e.parentAgentId) {
      const tipo = tipoDeAgente(`${e.subagentType} ${e.text.slice(0, 400)}`)
      const situacao = e.status === 'completed' ? 'terminei' : e.status === 'failed' ? 'falhei' : 'fui interrompido'
      n.enfileirar({
        tipo: 'agente',
        voz: c.vozesAgente[tipo],
        gerar: () =>
          n.frase({
            tipo: 'agente',
            instrucao: `Quem fala é o agente de ${ROTULO_AGENTE[tipo]}, que ${situacao}. Use duas frases curtas: a primeira anuncia, como "Pesquisa concluída." ou "Revisão pronta.", e a segunda diz o principal do que encontrou. Não se apresente.`,
            material: e.text,
            config: { ...c, maxFrases: 2 },
          }),
      })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'voz' }, async ($, e) => {
    const n = nucleo
    if (!n) return { text: 'O Arauto ainda está carregando.', isTextDisplayOnly: true }
    const arg = e.args.trim()
    const motor = motorDe(await read($, config))
    if (!arg) {
      await n.definirMudo()
      return { text: (await read($, config)).mudo ? 'Arauto mudo.' : 'Arauto com voz.', isTextDisplayOnly: true }
    }
    if (/^(liga|ligar|on|ativa)$/i.test(arg)) {
      await n.definirMudo(false)
      return { text: 'Arauto com voz.', isTextDisplayOnly: true }
    }
    if (/^(desliga|desligar|off|mudo)$/i.test(arg)) {
      await n.definirMudo(true)
      return { text: 'Arauto mudo.', isTextDisplayOnly: true }
    }
    if (/^lista$/i.test(arg)) {
      const linhas = (Object.keys(MOTORES) as Motor[]).map(
        m => `${MOTORES[m].nome}: ${MOTORES[m].vozes.map(v => v.nome).join(', ')}`,
      )
      return { text: linhas.join('\n'), isTextDisplayOnly: true }
    }
    if (/^(fish|mac)$/i.test(arg)) {
      const m = arg.toLowerCase() as Motor
      await n.salvarConfig(atualCfg => trocarMotor(atualCfg, m))
      n.enfileirar({ tipo: 'amostra', semPrefixo: true, gerar: async () => ({ texto: 'Voz trocada.', emocao: 'neutro' }) })
      return { text: `Motor de voz: ${MOTORES[m].nome}.`, isTextDisplayOnly: true }
    }
    const voz = motor.vozes.find(v => v.nome.toLowerCase() === arg.toLowerCase() || v.id === arg)
    if (!voz) return { text: `Não conheço a voz "${arg}". Use /voz lista.`, isTextDisplayOnly: true }
    await n.salvarConfig(atualCfg => ({ ...atualCfg, voz: voz.id }))
    n.enfileirar({
      tipo: 'amostra',
      semPrefixo: true,
      gerar: async () => ({ texto: `Oi, agora eu sou ${voz.nome}.`, emocao: 'neutro' }),
    })
    return { text: `Voz trocada para ${voz.nome}.`, isTextDisplayOnly: true }
  })

  on('command.run', { command: 'resumo' }, async () => ({
    text: nucleo ? await nucleo.resumir() : 'O Arauto ainda está carregando.',
  }))

  on('command.run', { command: 'arauto' }, async () => {
    await nucleo?.abrirPainel()
    return { text: 'Painel do Arauto aberto.', isTextDisplayOnly: true }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== CARTAO) return next(e)
    const { Box, Text, Button, Select, Input } = $.ui.resolve(e)
    const n = nucleo
    const c = await read($, config)
    const fala = await read($, agora)
    const s = await read($, estado)
    const esperando = s === 'esperando'
    const rotulo = c.mudo ? 'mudo' : esperando ? 'esperando você' : s
    const motor = motorDe(c)
    const salvar = (mudar: (atualCfg: Config) => Config) => n?.salvarConfig(mudar)

    const botaoMudo = <Button key="mudo" label={c.mudo ? 'Ligar som' : 'Mudo'} onPress={() => n?.definirMudo()} />


    if (e.props.placement === 'widget' || e.requestId === CARTAO) {
      const corTexto = esperando ? 'inverseText' : undefined
      return (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={esperando ? 'warning' : 'subtle'}
          backgroundColor={esperando ? 'warning' : undefined}
          paddingX={1}
        >
          <Text bold color={esperando ? 'inverseText' : 'claude'}>
            {esperando ? 'Preciso de você' : `Arauto · ${nomeDaVoz(c.voz)} · ${rotulo}`}
          </Text>
          <Text color={corTexto} maxLines={3}>
            {fala ? fala.texto : 'Nada dito ainda.'}
          </Text>
          {fala && (
            <Text color={corTexto} dimColor={!esperando}>
              {`${fala.projeto || 'sem projeto'} · ${fala.emocao}`}
            </Text>
          )}
          <Box flexDirection="row" gap={1}>
            {botaoMudo}
            <Button key="abrir" label="Abrir painel" onPress={() => n?.abrirPainel()} />
          </Box>
        </Box>
      )
    }

    const lista = await read($, abertas)
    const g = await read($, gasto)
    const k: ChaveFish = await read($, chaveFish)
    const pedirChave = k.situacao === 'sem-chave' || k.editando
    const uso = await $.session.usage()
    const vozes = motor.vozes.map(v => ({ value: v.id, label: v.nome }))

    const linha = (chaveDaLinha: string, rotuloDaLinha: string, controle: JSX.Element) => (
      <Box key={`linha-${chaveDaLinha}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
        <Box flexShrink={1}>
          <Text>{rotuloDaLinha}</Text>
        </Box>
        {controle}
      </Box>
    )
    const chave = (chaveDoBotao: string, ligado: boolean, alternar: () => unknown) => (
      <Button
        key={chaveDoBotao}
        label={ligado ? 'Ligado' : 'Desligado'}
        variant={ligado ? 'primary' : 'secondary'}
        onPress={() => void alternar()}
      />
    )

    const secao = (id: Secao, titulo: string, corpo: JSX.Element) => (
      <Box flexDirection="column">
        <Button
          key={`secao-${id}`}
          plain
          onPress={async () => {
            const abrindo = !(await read($, abertas)).includes(id)
            await update($, abertas, l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]))
            if (abrindo && id === 'config') void n?.atualizarChave()
          }}
        >
          {`${lista.includes(id) ? '▾' : '▸'} ${titulo}`}
        </Button>
        {lista.includes(id) && (
          <Box flexDirection="column" paddingLeft={2}>
            {corpo}
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={esperando ? 'warning' : undefined}>
            {`Arauto · ${nomeDaVoz(c.voz)} · ${rotulo}`}
          </Text>
          {botaoMudo}
          <Button key="minimizar" label="Minimizar" onPress={() => n?.minimizar()} />
        </Box>

        {secao(
          'agora',
          'Agora',
          <Box flexDirection="column">
            <Text>{fala ? fala.texto : 'Nada dito ainda.'}</Text>
            {fala && (
              <Text dimColor>
                {`${fala.projeto || 'sem projeto'} · ${fala.emocao} · ${nomeDaVoz(fala.voz)} · ${MOTORES[fala.motor]?.nome ?? fala.motor}${
                  fala.tempos ? ` · começou a tocar em ${segundosFalados(fala.tempos.gerar + fala.tempos.primeiroSom)}` : ''
                }`}
              </Text>
            )}
            {fala?.reserva && <Text color="warning">{`Usei a voz do Mac: ${fala.reserva}`}</Text>}
            <Box flexDirection="row">
              <Button
                key="ouvir"
                label="Ouvir de novo"
                onPress={async () => {
                  const f = await read($, agora)
                  if (f) {
                    n?.enfileirar({
                      tipo: f.tipo,
                      voz: f.voz,
                      motor: f.motor,
                      semPrefixo: true,
                      gerar: async () => ({ texto: f.texto, emocao: f.emocao }),
                    })
                  }
                }}
              />
            </Box>
          </Box>,
        )}

        {secao(
          'funcoes',
          'Funções',
          <Box flexDirection="column" gap={1}>
            {FUNCOES.map(f =>
              linha(
                `funcao-${f.id}`,
                f.nome,
                chave(`funcao-${f.id}`, c.funcoes[f.id], () =>
                  salvar(atualCfg => ({ ...atualCfg, funcoes: { ...atualCfg.funcoes, [f.id]: !atualCfg.funcoes[f.id] } })),
                ),
              ),
            )}
            {linha('resumo', 'Resumo falado do que rodou', <Button key="resumo" label="Ouvir" onPress={() => n?.resumir()} />)}
          </Box>,
        )}

        {secao(
          'voz',
          'Voz e persona',
          <Box flexDirection="column" gap={1}>
            {linha(
              'motor',
              'Motor de voz',
              <Select
                key="motor"
                value={c.motor}
                options={(Object.keys(MOTORES) as Motor[]).map(m => ({ value: m, label: MOTORES[m].nome }))}
                onSelect={v => salvar(atualCfg => trocarMotor(atualCfg, v === 'mac' ? 'mac' : 'fish'))}
              />,
            )}
            {linha(
              'voz',
              'Voz',
              <Select key="voz" value={c.voz} options={vozes} onSelect={v => salvar(atualCfg => ({ ...atualCfg, voz: v }))} />,
            )}
            {c.motor === 'fish' &&
              linha(
                'reserva',
                'Reserva se a Fish falhar',
                <Select
                  key="reserva"
                  value={c.vozMac}
                  options={MOTORES.mac.vozes.map(v => ({ value: v.id, label: v.nome }))}
                  onSelect={v => salvar(atualCfg => ({ ...atualCfg, vozMac: v }))}
                />,
              )}
            {linha(
              'persona',
              'Persona',
              <Select
                key="persona"
                value={c.persona}
                options={(Object.keys(PERSONAS) as Persona[]).map(p => ({ value: p, label: PERSONAS[p].nome }))}
                onSelect={v => salvar(atualCfg => ({ ...atualCfg, persona: v as Persona }))}
              />,
            )}
            {linha(
              'velocidade',
              'Velocidade',
              <Select
                key="velocidade"
                value={String(c.velocidade)}
                options={VELOCIDADES}
                onSelect={v => salvar(atualCfg => ({ ...atualCfg, velocidade: Number(v) }))}
              />,
            )}
            {linha(
              'emocao',
              'Emoção',
              <Select
                key="emocao"
                value={c.emocao}
                options={[
                  { value: 'claude', label: 'O Claude escolhe' },
                  { value: 'neutra', label: 'Sempre neutra' },
                ]}
                onSelect={v => salvar(atualCfg => ({ ...atualCfg, emocao: v === 'neutra' ? 'neutra' : 'claude' }))}
              />,
            )}
            {linha(
              'amostra',
              'Amostra',
              <Button
                key="amostra"
                label="Ouvir amostra"
                onPress={async () => {
                  const atualCfg = await read($, config)
                  n?.enfileirar({
                    tipo: 'amostra',
                    semPrefixo: true,
                    gerar: async () => ({
                      texto: `${fraseFixa(atualCfg.persona, 'fim').texto} É assim que eu vou te avisar.`,
                      emocao: 'aliviado',
                    }),
                  })
                }}
              />,
            )}
            <Box marginTop={1}>
              <Text dimColor>Voz por tipo de agente</Text>
            </Box>
            {(Object.keys(ROTULO_AGENTE) as TipoAgente[]).map(tipo =>
              linha(
                `agente-${tipo}`,
                `Agente de ${ROTULO_AGENTE[tipo]}`,
                <Select
                  key={`agente-${tipo}`}
                  value={c.vozesAgente[tipo]}
                  options={vozes}
                  onSelect={v => salvar(atualCfg => ({ ...atualCfg, vozesAgente: { ...atualCfg.vozesAgente, [tipo]: v } }))}
                />,
              ),
            )}
          </Box>,
        )}

        {secao(
          'config',
          'Configurações',
          <Box flexDirection="column" gap={1}>
            {pedirChave ? (
              <Box key="chave-campo" flexDirection="column" gap={1}>
                <Text>Chave da Fish Audio</Text>
                <Input
                  key="chave-entrada"
                  placeholder="Cole aqui a chave (sk-fish-…)"
                  submitLabel="salvar"
                  onInput={v => {
                    rascunhoChave = v
                  }}
                  onSubmit={v => void n?.salvarChave(v)}
                />
                <Box flexDirection="row" gap={1}>
                  <Button key="chave-salvar" label="Salvar" variant="primary" onPress={() => void n?.salvarChave(rascunhoChave)} />
                  {k.editando && k.situacao !== 'sem-chave' && (
                    <Button key="chave-cancelar" label="Cancelar" onPress={() => void n?.editarChave(false)} />
                  )}
                </Box>
              </Box>
            ) : (
              linha('chave', 'Chave da Fish Audio', <Text dimColor>{mascarar(k.prefixo)}</Text>)
            )}
            <Text dimColor>{legendaDaChave(k)}</Text>
            {!pedirChave && (
              <Box key="chave-botoes" flexDirection="row" gap={1}>
                <Button key="chave-trocar" label="Trocar" onPress={() => void n?.editarChave(true)} />
                <Button key="chave-apagar" label="Apagar" onPress={() => void n?.apagarChave()} />
              </Box>
            )}
            {linha(
              'tamanho',
              'Tamanho da fala',
              <Select
                key="tamanho"
                value={String(c.maxFrases)}
                options={[
                  { value: '1', label: '1 frase' },
                  { value: '2', label: 'Até 2 frases' },
                ]}
                onSelect={v => salvar(atualCfg => ({ ...atualCfg, maxFrases: v === '1' ? 1 : 2 }))}
              />,
            )}
            {linha(
              'limiar',
              'Avisar fim de tarefa',
              <Select
                key="limiar"
                value={String(c.minSegundos)}
                options={LIMIARES}
                onSelect={v => salvar(atualCfg => ({ ...atualCfg, minSegundos: Number(v) }))}
              />,
            )}
            {linha(
              'projeto',
              'Dizer o nome do projeto antes',
              chave('projeto', c.dizerProjeto, () => salvar(atualCfg => ({ ...atualCfg, dizerProjeto: !atualCfg.dizerProjeto }))),
            )}
            <Box marginTop={1}>
              <Text dimColor>Gasto da sessão</Text>
            </Box>
            {linha('gasto-falas', 'Falas', <Text dimColor>{String(g.falas)}</Text>)}
            {linha(
              'gasto-haiku',
              'Haiku',
              <Text dimColor>{`${g.chamadas} chamadas · ${g.tokensEntrada + g.tokensSaida} tokens`}</Text>,
            )}
            {linha(
              'gasto-fish',
              'Fish Audio',
              <Text dimColor>{`${g.bytesFish} bytes · ${dolares(custoFish(g.bytesFish), 4)}`}</Text>,
            )}
            {uso.cost &&
              linha('gasto-sessao', 'Sessão inteira', <Text dimColor>{dolares(uso.cost.usd, 2)}</Text>)}
            <Text dimColor>Valores em dólar são estimativas.</Text>
          </Box>,
        )}
      </Box>
    )
  })
}
