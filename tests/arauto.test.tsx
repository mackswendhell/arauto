import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

function motor(
  on: On,
  respostaDoModelo = '{"emocao":"aliviado","frase":"Terminei, os testes passaram."}',
  store: Record<string, unknown> = {},
  fishFalha = false,
  semTocador = false,
  chaveInicial = 'sk-fish-0000aaaa',
) {
  const ditas: { texto: string; voz?: string | string[]; motor: 'fish' | 'mac' }[] = []
  const corpos: Record<string, unknown>[] = []
  const tocados: string[] = []
  const pedidosAoModelo: string[] = []
  const chaveGuardada = { valor: chaveInicial }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { config: { funcoes: { temaPersonagem: false } }, ...store })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__arauto__${e.name}` } }))
  const abertos: string[] = []
  const fechados: string[] = []
  on('ui.open', (_, e) => {
    abertos.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    fechados.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', (_, e) => {
    pedidosAoModelo.push(e.prompt)
    const podcast = (e.system ?? '').includes('podcast')
    return {
      value: {
        isAnswered: true,
        text: podcast ? ROTEIRO : respostaDoModelo,
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('audio.speak', (_, e) => {
    ditas.push({ texto: e.text, voz: e.voice, motor: 'mac' })
    return { value: { via: 'system' } }
  })
  const guardados = new Set<string>()
  const cacheUsado: boolean[] = []
  on('process.spawn', async function* (_, e) {
    const env = e.env ?? {}
    if (semTocador) {
      yield { stream: 'stderr' as const, text: 'sem-tocador\n' }
      return { value: { code: 4, signal: null } }
    }
    if (fishFalha) {
      yield { stream: 'stderr' as const, text: 'erro={"message":"saldo insuficiente"}\n' }
      return { value: { code: 22, signal: null } }
    }
    expect(env.FISH_MODEL).toBe('drama-3')
    const corpo = JSON.parse(env.FISH_BODY ?? '{}') as Record<string, unknown> & { text: string; reference_id: string | string[] }
    expect(corpo.latency).toBeUndefined()
    const id = env.ARAUTO_CACHE_ID
    const doCache = id !== undefined && guardados.has(id)
    if (id) guardados.add(id)
    cacheUsado.push(doCache)
    corpos.push(corpo)
    ditas.push({ texto: corpo.text, voz: corpo.reference_id, motor: 'fish' })
    yield { stream: 'stderr' as const, text: doCache ? 'cache\nsom\n' : 'som\n' }
    return { value: { code: 0, signal: null } }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/pkill') {
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.init?.env?.FISH_BODY === undefined) {
      const script = e.argv[2] ?? ''
      const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
      if (!script.includes('read -r k') && script.includes('rm -f')) {
        chaveGuardada.valor = ''
        return ok('sem-chave\n')
      }
      if (script.includes('read -r k')) {
        const nova = (e.init?.stdin ?? '').trim()
        if (!nova) return ok('vazia\n')
        if (!nova.startsWith('sk-fish-')) return ok('invalida\n')
        chaveGuardada.valor = nova
        return ok(`conectada ${nova.slice(0, 8)}\n`)
      }
      return ok(chaveGuardada.valor ? `conectada ${chaveGuardada.valor.slice(0, 8)}\n` : 'sem-chave\n')
    }
    if (fishFalha) {
      return { value: { exitCode: 22, stdout: '', stderr: 'curl: (22) The requested URL returned error: 402', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const corpo = JSON.parse(e.init?.env?.FISH_BODY ?? '{}') as { text: string; reference_id: string | string[] }
    corpos.push(corpo)
    ditas.push({ texto: corpo.text, voz: corpo.reference_id, motor: 'fish' })
    expect(e.init?.env?.FISH_MODEL).toBe('drama-3')
    return { value: { exitCode: 0, stdout: 'SUQz'.repeat(60), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('audio.play', (_, e) => {
    tocados.push(e.clip.mime ?? '')
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  return { ditas, pedidosAoModelo, clock, tocados, corpos, cacheUsado, chaveGuardada, abertos, fechados }
}

const MORDOMO = 'd9bc9ab6317040d28307ee6d89c73ca0'
const FEMININA = '5b5a485751824c1993e210602cee16cb'
const ROTEIRO = JSON.stringify({
  replicas: [
    { quem: 0, emocao: 'calmo', texto: 'Boa tarde. Hoje o Arauto ganhou voz nova.' },
    { quem: 1, emocao: 'empolgado', texto: 'E qual foi a novidade principal?' },
    { quem: 0, emocao: 'aliviado', texto: 'A Fish Audio entrou, com reserva no Mac.' },
    { quem: 1, emocao: 'neutro', texto: 'Ficou faltando alguma coisa?' },
  ],
})

const inicio = { cwd: '/Users/eu/dev/loja', surface: 'desktop', isInteractive: true } as const

test('fala no fim de uma tarefa longa, no tom do resultado', async ($, on) => {
  const { ditas, pedidosAoModelo, clock, tocados } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'roda os testes', turnId: 't1' })
  await $.turn.complete({
    turnId: 't1',
    answer: 'Rodei `npm test` em /Users/eu/dev/loja/src. Todos os 42 testes passaram.',
    durationMs: 45_000,
    isAborted: false,
    reason: 'answer',
  })
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(1)
  expect(ditas.length).toBe(1)
  expect(ditas[0]?.texto).toBe('[aliviado] Terminei, os testes passaram.')
  expect(ditas[0]?.motor).toBe('fish')
  expect(ditas[0]?.voz).toBe(MORDOMO)
  expect(tocados).toEqual([])
})

test('se a Fish falha, fala com a voz do Mac', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {}, true)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'feito', durationMs: 30_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(ditas.length).toBe(1)
  expect(ditas[0]?.motor).toBe('mac')
  expect(ditas[0]?.voz).toBe('Luciana')
  expect(ditas[0]?.texto).toContain('Terminei, os testes passaram.')
})

test('a configuração antiga, da voz do Mac, passa para a Fish e o Mordomo', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {
    config: { motor: 'mac', voz: 'Reed (Português (Brasil))', persona: 'seco', minSegundos: 10, funcoes: { temaPersonagem: false } },
  })
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'feito', durationMs: 12_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(ditas[0]?.motor).toBe('fish')
  expect(ditas[0]?.voz).toBe(MORDOMO)
})

test('/voz mac volta para a voz do Mac', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  await $.command.run({ command: 'voz', args: 'mac' } as never)
  await clock.settle()
  expect(ditas[0]?.motor).toBe('mac')
  expect(ditas[0]?.voz).toBe('Luciana')
})

test('não fala em tarefa curta', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'Oi!', durationMs: 3_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(ditas.length).toBe(0)
})

test('nunca fala código, caminhos, links ou chaves', async ($, on) => {
  const { ditas, clock } = motor(
    on,
    '{"emocao":"neutro","frase":"Salvei em /Users/eu/.env com a chave sk-ant-abc123def456ghi789 e o link https://exemplo.com/x."}',
  )
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'feito', durationMs: 30_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  const dito = ditas[0]?.texto ?? ''
  expect(dito).not.toContain('/Users')
  expect(dito).not.toContain('sk-ant')
  expect(dito).not.toContain('https')
})

test('avisa quando precisa de permissão e repete em 2 minutos', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(2_000)
  expect(ditas.length).toBe(1)
  expect(ditas[0]?.texto).toContain('permissão')
  await clock.advance(120_000)
  expect(ditas.length).toBe(2)
  expect(ditas[1]?.texto).toMatch(/ainda/i)
})

test('não repete se a permissão já foi respondida', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  await clock.advance(2_000)
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'x' })
  await clock.advance(130_000)
  expect(ditas.length).toBe(1)
})

test('a ferramenta falar fala o que o Claude pediu', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  const r = await $.tool.call({ tool: 'mcp__arauto__falar', frase: 'Achei um problema no banco.', emocao: 'preocupado' } as never)
  await clock.settle()
  expect(JSON.stringify(r)).toContain('Na fila')
  expect(ditas[0]?.texto).toContain('Achei um problema no banco.')
})

test('/voz desliga deixa tudo mudo', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  await $.command.run({ command: 'voz', args: 'desliga' } as never)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'feito', durationMs: 60_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(ditas.length).toBe(0)
})

test('/arauto off cala e esconde em todas as sessões; /arauto on volta com o painel', async ($, on) => {
  const { ditas, pedidosAoModelo, clock, abertos, fechados } = motor(on)
  await $.session.start(inicio)
  const r = await $.command.run({ command: 'arauto', args: 'off' } as never)
  expect(JSON.stringify(r)).toContain('desligado')
  expect(fechados).toContain('arauto-cartao')
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'feito', durationMs: 60_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(ditas.length).toBe(0)
  expect(pedidosAoModelo.length).toBe(0)
  abertos.length = 0
  await $.command.run({ command: 'arauto', args: 'on' } as never)
  expect(abertos).toContain('arauto')
  await $.turn.start({ text: 'y', turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: 'feito', durationMs: 60_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(ditas.length).toBe(1)
})

test('desligado, a sessão nova não abre o cartão e /arauto sozinho liga de novo', async ($, on) => {
  const { ditas, clock, abertos } = motor(on, undefined, { desligado: true })
  await $.session.start(inicio)
  await clock.settle()
  expect(abertos).toEqual([])
  expect(ditas.length).toBe(0)
  await $.command.run({ command: 'arauto', args: '' } as never)
  expect(abertos).toContain('arauto')
})

const PAINEL = {
  plugin: 'arauto',
  component: 'Pane',
  requestId: 'arauto',
  props: { title: 'Arauto', isFocused: false, bodyColumns: 48, scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('o painel desenha como cartão e como lateral', async ($, on) => {
  const { clock } = motor(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.42 } } as never }))
  await $.session.start(inicio)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await clock.advance(2_000)
  for (const surface of ['desktop', 'terminal'] as const) {
    const cartao = await $.ui.mount({ ...PAINEL, surface, props: { ...PAINEL.props, placement: 'widget' } })
    expect((await cartao.find({ type: 'Text', text: /Preciso de você/ }))?.text).toBe('Preciso de você')
    await cartao.unmount()
    const lateral = await $.ui.mount({ ...PAINEL, surface, props: { ...PAINEL.props, placement: 'dock' } })
    if (surface === 'desktop') {
      await lateral.press({ key: 'secao-funcoes' })
      await lateral.press({ key: 'secao-voz' })
      await lateral.press({ key: 'secao-config' })
    }
    expect(await lateral.find({ type: "Text", text: /0,42/ })).toBeDefined()
    const antes = (await lateral.find({ key: 'funcao-lerInteira' }))?.props.label
    await lateral.press({ key: 'funcao-lerInteira' })
    const depois = (await lateral.find({ key: 'funcao-lerInteira' }))?.props.label
    expect(new Set([antes, depois])).toEqual(new Set(['Ligado', 'Desligado']))
    await lateral.unmount()
  }
})

test('fim de turno que chega antes do mod ficar pronto ainda é falado', async ($, on) => {
  const { ditas, clock } = motor(on)
  const fim = $.turn.complete({ turnId: 't1', answer: 'Pronto.', durationMs: 40_000, isAborted: false, reason: 'answer' })
  await clock.settle()
  await $.session.start(inicio)
  await clock.advance(200)
  await fim
  await clock.settle()
  expect(ditas.length).toBe(1)
  expect(ditas[0]?.texto).toContain('Terminei')
})

test('aviso perdido num recarregamento é falado pela cópia nova', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {
    fim: { turnId: 't9', sessao: 'sessao-teste', quando: Date.now() - 5_000, situacao: 'na fila', instrucao: 'Avise que terminei.', material: 'ok' },
  })
  await $.session.start(inicio)
  await clock.settle()
  expect(ditas.length).toBe(1)
  await $.session.start(inicio)
  await clock.settle()
  expect(ditas.length).toBe(1)
})

test('aviso já falado não se repete depois de recarregar', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {
    fim: { turnId: 't9', quando: Date.now() - 5_000, situacao: 'falado', instrucao: 'x', material: 'ok' },
  })
  await $.session.start(inicio)
  await clock.settle()
  expect(ditas.length).toBe(0)
})

test('sessão reserva do app não cumprimenta nem repete o aviso de outra sessão', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {
    config: { funcoes: { temaPersonagem: true } },
    fim: { turnId: 't9', sessao: 'outra', quando: Date.now() - 5_000, situacao: 'na fila', texto: 'Terminei a outra.', emocao: 'neutro' },
  })
  await $.session.start({ ...inicio, cwd: '/private/var/folders/xx/T/spare-abc123' })
  await clock.settle()
  expect(ditas.length).toBe(0)
  await $.turn.start({ text: 'cria a página', turnId: 't1' })
  await clock.settle()
  expect(ditas.length).toBe(1)
  expect(ditas[0]?.texto).toContain('dispor')
})

test('aviso guardado por outra sessão não toca aqui', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {
    fim: { turnId: 't9', sessao: 'outra', quando: Date.now() - 5_000, situacao: 'na fila', texto: 'Terminei a outra.', emocao: 'neutro' },
  })
  await $.session.start(inicio)
  await clock.settle()
  expect(ditas.length).toBe(0)
})

function etapas(on: On, passos: { pensado: string; texto?: string; ferramenta?: string }[]) {
  on('turn.step', async function* (_, e) {
    const p = passos[e.index] ?? { pensado: '' }
    if (p.pensado) yield { kind: 'thinking' as const, index: 0, text: p.pensado }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: p.texto ?? '',
      toolUses: p.ferramenta ? [{ name: 'Bash', input: { description: p.ferramenta } }] : [],
      stopReason: p.ferramenta ? ('tool_use' as const) : ('end_turn' as const),
      usage: null,
    }
  })
}

const passo = async ($: Engine, index: number) => {
  const s = $.turn.step({ turnId: 't1', index, model: 'opus', messageCount: 3 })
  for await (const _ of s) void _
  return s.result
}

test('pensamento ligado: fala a descoberta no meio da tarefa, no nível escolhido', async ($, on) => {
  const { ditas, clock, pedidosAoModelo } = motor(on, '{"emocao":"calmo","frase":"Achei a causa, o teste usava a data errada."}', {
    config: { funcoes: { temaPersonagem: false, pensamento: true }, nivelPensamento: 'normal' },
  })
  etapas(on, [
    { pensado: 'Vou ler os testes.', ferramenta: 'Lê os testes' },
    { pensado: 'A causa é o fuso horário na data do teste.', ferramenta: 'Corrige o teste' },
    { pensado: 'Agora rodo de novo.', ferramenta: 'Roda os testes' },
  ])
  await $.session.start(inicio)
  await $.turn.start({ text: 'conserta os testes', turnId: 't1' })
  await passo($, 0)
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(0)
  await clock.advance(25_000)
  await passo($, 1)
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(1)
  expect(pedidosAoModelo[0]).toContain('fuso horário')
  expect(pedidosAoModelo[0]).toContain('Lê os testes')
  expect(ditas.map(d => d.texto)).toEqual(['[calmo] Achei a causa, o teste usava a data errada.'])
  await clock.advance(20_000)
  await passo($, 2)
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(1)
})

test('pensamento: o modelo pode ficar quieto', async ($, on) => {
  const { ditas, clock, pedidosAoModelo } = motor(on, '{"emocao":"neutro","frase":""}', {
    config: { funcoes: { temaPersonagem: false, pensamento: true }, nivelPensamento: 'tudo' },
  })
  etapas(on, [{ pensado: 'Leio o arquivo.', ferramenta: 'Lê' }, { pensado: 'Leio outro.', ferramenta: 'Lê' }])
  await $.session.start(inicio)
  await $.turn.start({ text: 'arruma', turnId: 't1' })
  await clock.advance(25_000)
  await passo($, 0)
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(1)
  expect(ditas.map(d => d.texto)).toEqual([])
})

test('pensamento desligado (padrão) não consulta o modelo nas etapas', async ($, on) => {
  const { ditas, clock, pedidosAoModelo } = motor(on)
  etapas(on, [{ pensado: 'A causa é o fuso.', ferramenta: 'Corrige' }])
  await $.session.start(inicio)
  await $.turn.start({ text: 'arruma', turnId: 't1' })
  await clock.advance(200_000)
  await passo($, 0)
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(0)
  expect(ditas.length).toBe(0)
})

test('com Pensamento ligado aparece o nível, com três opções', async ($, on) => {
  const { clock } = motor(on, undefined, { config: { funcoes: { temaPersonagem: false, pensamento: true } } })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0 } } as never }))
  await $.session.start(inicio)
  await clock.settle()
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop', props: { ...PAINEL.props, placement: 'dock' } })
  await painel.press({ key: 'secao-funcoes' })
  const nivel = (await painel.findAll({ type: 'Select' })).find(s => (s.key ?? s.props.key) === 'nivel-pensamento')
  expect(nivel?.props.value).toBe('essencial')
  expect((nivel?.props.options as { label: string }[]).map(o => o.label)).toEqual(['Só o essencial', 'Normal', 'Tudo'])
  await painel.press({ key: 'funcao-pensamento' })
  const depois = (await painel.findAll({ type: 'Select' })).find(s => (s.key ?? s.props.key) === 'nivel-pensamento')
  expect(depois).toBeUndefined()
  await painel.unmount()
})

const fimDe = (durationMs: number, answer = 'feito') =>
  ({ turnId: 't1', answer, durationMs, isAborted: false, reason: 'answer' }) as const

test('fala de fim fica em no máximo duas frases curtas', async ($, on) => {
  const longa = JSON.stringify({
    emocao: 'aliviado',
    frase:
      'Pronto, senhor: integrei a Fish Audio com a voz do mordomo; deixei a voz do Mac como reserva. Também testei tudo ao vivo. E ainda anotei o gasto no painel.',
  })
  const { ditas, clock } = motor(on, longa)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete(fimDe(30_000))
  await clock.settle()
  const dito = String(ditas[0]?.texto).replace(/^\[\w+\] /, '')
  expect(dito.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2)
  expect(dito.split(/\s+/).length).toBeLessThanOrEqual(28)
})

test('o tempo só entra na fala quando passa de um minuto', async ($, on) => {
  const { pedidosAoModelo, clock } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete(fimDe(45_000))
  await clock.settle()
  expect(pedidosAoModelo[0]).toContain('Não mencione quanto tempo levou')
  await $.turn.start({ text: 'y', turnId: 't2' })
  await $.turn.complete({ ...fimDe(150_000), turnId: 't2' })
  await clock.settle()
  expect(pedidosAoModelo[1]).toContain('3 minutos')
})

test('o cartão minimizado fica âmbar com Preciso de você', async ($, on) => {
  const { clock } = motor(on)
  await $.session.start(inicio)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await clock.advance(2_000)
  const cartao = await $.ui.mount({ ...PAINEL, surface: 'desktop', props: { ...PAINEL.props, placement: 'widget', anchoredEdges: ['bottom', 'right'] } })
  const titulo = await cartao.find({ type: 'Text', text: /Preciso de você/ })
  expect(titulo?.props).toMatchObject({ color: 'inverseText' })
  expect(await cartao.find({ type: 'Text', text: /loja · urgente/ })).toBeDefined()
  expect(await cartao.find({ key: 'mudo' })).toBeDefined()
  expect(await cartao.find({ key: 'abrir' })).toBeDefined()
  await cartao.unmount()
})

test('o resumo vira podcast com duas vozes do drama-3 num pedido só', async ($, on) => {
  const { corpos, clock } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'integra a fish', turnId: 't1' })
  await $.turn.complete(fimDe(5_000, 'Integrei.'))
  const r = await $.command.run({ command: 'resumo', args: '' } as never)
  await clock.settle()
  expect(String((r as { text?: string }).text)).toContain('Mordomo de IA: Boa tarde')
  const podcast = corpos.find(c => Array.isArray(c.reference_id))
  expect(podcast?.reference_id).toEqual([MORDOMO, FEMININA])
  expect(String(podcast?.text)).toContain('<|speaker:1|>[empolgado] E qual foi a novidade principal?')
  expect(podcast?.max_new_tokens).toBe(2048)
})

test('o podcast cai para duas vozes do Mac se a Fish falhar', async ($, on) => {
  const { ditas, clock } = motor(on, undefined, {}, true)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete(fimDe(5_000))
  await $.command.run({ command: 'resumo', args: '' } as never)
  await clock.settle()
  expect(ditas.length).toBe(4)
  expect(ditas.map(d => d.voz)).toEqual(['Luciana', 'Flo (Português (Brasil))', 'Luciana', 'Flo (Português (Brasil))'])
})

test('frase fixa fica guardada: a segunda vez toca do disco', async ($, on) => {
  const { cacheUsado, clock } = motor(on)
  await $.session.start(inicio)
  for (let i = 0; i < 2; i++) {
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
    await clock.advance(2_000)
    await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: `x${i}` })
  }
  expect(cacheUsado).toEqual([false, true])
})

test('frase do fim não vai para o cache', async ($, on) => {
  const { cacheUsado, clock } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.turn.complete(fimDe(30_000))
  await clock.settle()
  expect(cacheUsado).toEqual([false])
})

test('sem mpg123 nem ffplay, baixa o áudio inteiro e toca', async ($, on) => {
  const { ditas, tocados, clock } = motor(on, undefined, {}, false, true)
  await $.session.start(inicio)
  await $.tool.call({ tool: 'mcp__arauto__falar', frase: 'Teste sem tocador.' } as never)
  await clock.settle()
  expect(ditas.length).toBe(1)
  expect(tocados).toEqual(['audio/mpeg'])
})

const RESPOSTA = 'Rodei a suíte inteira.\n\n<!-- arauto: aliviado | Terminei, senhor. Os quarenta e dois testes passaram. -->'

const responder = ($: Engine, texto: string) =>
  $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: texto }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: `u-${texto.length}`,
  } as never)

test('cada mensagem do usuário leva o pedido da linha falada', async ($, on) => {
  motor(on)
  let contexto: readonly string[] = []
  on('prompt.submit', (_, e) => {
    contexto = e.context ?? []
    return { text: e.text, context: e.context }
  })
  await $.session.start(inicio)
  await $.prompt.submit({ text: 'roda os testes' } as never)
  expect(contexto.join('\n')).toContain('<!-- arauto: EMOCAO | FRASE -->')
})

test('a linha do Claude some do texto e vira a fala, sem Haiku', async ($, on) => {
  const { ditas, pedidosAoModelo, clock } = motor(on)
  let gravado = ''
  on('session.append', (_, e, next) => {
    gravado = JSON.stringify(e.message.content)
    return next(e)
  })
  await $.session.start(inicio)
  await $.turn.start({ text: 'roda os testes', turnId: 't1' })
  await responder($, RESPOSTA)
  expect(gravado).not.toContain('arauto')
  expect(gravado).toContain('Rodei a suíte inteira.')
  await $.turn.complete(fimDe(30_000, 'Rodei a suíte inteira.'))
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(0)
  expect(ditas[0]?.texto).toBe('[aliviado] Terminei, senhor. Os quarenta e dois testes passaram.')
})

test('acima de um minuto, a fala diz quanto levou', async ($, on) => {
  const { ditas, clock } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await responder($, RESPOSTA)
  await $.turn.complete(fimDe(185_000))
  await clock.settle()
  expect(ditas[0]?.texto).toBe('[aliviado] Terminei, senhor. Levou 3 minutos.')
})

test('sem a linha, o Haiku entra como reserva', async ($, on) => {
  const { ditas, pedidosAoModelo, clock } = motor(on)
  await $.session.start(inicio)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await responder($, 'Rodei a suíte inteira.')
  await $.turn.complete(fimDe(30_000))
  await clock.settle()
  expect(pedidosAoModelo.length).toBe(1)
  expect(ditas[0]?.texto).toContain('Terminei, os testes passaram.')
})

test('a linha pela metade, enquanto a resposta chega, não aparece', async ($, on) => {
  motor(on)
  let desenhado = ''
  on('ui.render', { component: 'AssistantMessage' }, ($$, e) => {
    desenhado = e.props.text
    const { Text } = $$.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  await $.session.start(inicio)
  const ui = await $.ui.mount({
    plugin: 'arauto',
    surface: 'desktop',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text: 'Rodei a suíte.\n<!-- arauto: aliviado | Termin', isFirstOfReply: true },
  } as never)
  expect(desenhado).toBe('Rodei a suíte.')
  await ui.unmount()
})

type No = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

test('cada seção aberta: rótulo à esquerda, controle à direita', async ($, on) => {
  const { clock } = motor(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1.23 } } as never }))
  await $.session.start(inicio)
  await clock.settle()
  const painel = await $.ui.mount({ ...PAINEL, surface: 'desktop', props: { ...PAINEL.props, placement: 'dock' } })
  for (const id of ['funcoes', 'voz', 'config']) await painel.press({ key: `secao-${id}` })
  const funcoes = (await painel.findAll({ type: 'Button' })).filter(b => String(b.key ?? b.props.key ?? '').startsWith('funcao-'))
  expect(funcoes.length).toBe(10)
  for (const b of funcoes) expect(['Ligado', 'Desligado']).toContain(b.props.label)
  const fileiras = (await painel.findAll({ type: 'Box' })).filter(b => b.props.justifyContent === 'space-between')
  expect(fileiras.length).toBeGreaterThan(20)
  for (const f of fileiras) {
    const [esquerda, direita] = (f.children ?? []) as No[]
    expect(esquerda?.type).toBe('Box')
    expect(['Button', 'Select', 'Text']).toContain(direita?.type)
  }
  await painel.unmount()
})

test('a chave da Fish aparece mascarada, troca pelo campo e a recusada não substitui a anterior', async ($, on) => {
  const { chaveGuardada } = motor(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.42 } } as never }))
  await $.session.start(inicio)
  for (const surface of ['desktop', 'terminal'] as const) {
    const lateral = await $.ui.mount({ ...PAINEL, surface, props: { ...PAINEL.props, placement: 'dock' } })
    if (surface === 'desktop') await lateral.press({ key: 'secao-config' })
    expect(await lateral.find({ type: 'Text', text: /^sk-fish-••••••••$/ })).toBeDefined()
    expect(await lateral.find({ type: 'Text', text: /0000aaaa/ })).toBeUndefined()
    expect(await lateral.find({ type: 'Text', text: /Fish Audio conectada/ })).toBeDefined()
    await lateral.press({ key: 'chave-trocar' })
    await lateral.input({ key: 'chave-entrada', text: 'chave-errada' })
    expect(chaveGuardada.valor).toBe('sk-fish-0000aaaa')
    expect(await lateral.find({ type: 'Text', text: /anterior continua valendo/ })).toBeDefined()
    await lateral.input({ key: 'chave-entrada', text: 'sk-fish-1111bbbb' })
    expect(chaveGuardada.valor).toBe('sk-fish-1111bbbb')
    expect(await lateral.find({ key: 'chave-entrada' })).toBeUndefined()
    expect(await lateral.find({ type: 'Text', text: /^sk-fish-••••••••$/ })).toBeDefined()
    chaveGuardada.valor = 'sk-fish-0000aaaa'
    await lateral.unmount()
  }
})

test('sem chave, o painel pede para colar e explica que fala com a voz do Mac', async ($, on) => {
  const { chaveGuardada } = motor(on, undefined, {}, false, false, '')
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.42 } } as never }))
  await $.session.start(inicio)
  const lateral = await $.ui.mount({ ...PAINEL, surface: 'desktop', props: { ...PAINEL.props, placement: 'dock' } })
  await lateral.press({ key: 'secao-config' })
  expect(await lateral.find({ key: 'chave-entrada' })).toBeDefined()
  expect(await lateral.find({ type: 'Text', text: /voz do Mac/ })).toBeDefined()
  await lateral.input({ key: 'chave-entrada', text: '  sk-fish-2222cccc  ' })
  expect(chaveGuardada.valor).toBe('sk-fish-2222cccc')
  await lateral.press({ key: 'chave-apagar' })
  expect(chaveGuardada.valor).toBe('')
  expect(await lateral.find({ key: 'chave-entrada' })).toBeDefined()
  await lateral.unmount()
})
