import type { AudioClip, PlayOptions, ProcessRunInit, ProcessRunResult, SpeakOptions } from 'claude-code'

import type { Config, Emocao, Motor, Replica } from '../types'

export type PedidoDeVoz = {
  texto: string
  emocao: Emocao
  voz: string
  velocidade: number
  signal: AbortSignal
  guardar?: boolean
}

export type PedidoDeDialogo = {
  replicas: readonly Replica[]
  vozes: readonly [string, string]
  velocidade: number
  signal: AbortSignal
}

// Quanto o motor levou da chamada até o primeiro som (estimado), e o que enviou.
export type ResultadoDeVoz = { bytes: number; primeiroSom: number; cache?: boolean }

// O que os motores podem usar do Claude Code.
export type Recursos = {
  falarNoSistema: (texto: string, opcoes: SpeakOptions) => Promise<unknown>
  rodar: (argv: readonly string[], init: ProcessRunInit) => Promise<ProcessRunResult>
  tocar: (clip: AudioClip, opcoes: PlayOptions) => Promise<void>
  // Roda um script de bash em fluxo; primeiroSom é o instante (Date.now) em que ele escreveu "som".
  tocarFluxo: (
    script: string,
    env: Record<string, string>,
    signal: AbortSignal,
    limiteMs: number,
  ) => Promise<{ codigo: number | null; stderr: string; primeiroSom?: number }>
}

// Todo motor recebe o texto já limpo e a emoção separada.
export type MotorDeVoz = {
  nome: string
  vozes: readonly { id: string; nome: string; descricao?: string }[]
  falar: (recursos: Recursos, pedido: PedidoDeVoz) => Promise<ResultadoDeVoz>
  dialogo: (recursos: Recursos, pedido: PedidoDeDialogo) => Promise<ResultadoDeVoz>
}

export const VELOCIDADE_NORMAL = 185

const AJUSTE_DE_RITMO: Record<Emocao, number> = {
  neutro: 1,
  calmo: 0.92,
  aliviado: 0.95,
  preocupado: 0.97,
  frustrado: 0.97,
  empolgado: 1.08,
  urgente: 1.12,
}

const mac: MotorDeVoz = {
  nome: 'Voz do Mac',
  vozes: [
    { id: 'Luciana', nome: 'Luciana' },
    { id: 'Eddy (Português (Brasil))', nome: 'Eddy' },
    { id: 'Flo (Português (Brasil))', nome: 'Flo' },
    { id: 'Reed (Português (Brasil))', nome: 'Reed' },
    { id: 'Rocko (Português (Brasil))', nome: 'Rocko' },
    { id: 'Sandy (Português (Brasil))', nome: 'Sandy' },
    { id: 'Shelley (Português (Brasil))', nome: 'Shelley' },
    { id: 'Grandma (Português (Brasil))', nome: 'Grandma' },
    { id: 'Grandpa (Português (Brasil))', nome: 'Grandpa' },
  ],
  async falar(recursos, { texto, emocao, voz, velocidade, signal }) {
    const ritmo = Math.round(velocidade * AJUSTE_DE_RITMO[emocao])
    await recursos.falarNoSistema(`[[rate ${ritmo}]] ${texto}`, { voice: voz, signal })
    return { bytes: 0, primeiroSom: 0 }
  },
  async dialogo(recursos, { replicas, vozes, velocidade, signal }) {
    for (const r of replicas) {
      if (signal.aborted) break
      await mac.falar(recursos, { texto: r.texto, emocao: r.emocao, voz: vozes[r.quem], velocidade, signal })
    }
    return { bytes: 0, primeiroSom: 0 }
  },
}

// A chave fica em ~/.config/arauto/fish-audio.header (modo 600) e só o curl a
// lê: ela não passa pelo mod, pela linha de comando nem pelo log.
//
// O áudio toca enquanto chega: curl -> (marca o primeiro byte) -> tee -> mpg123.
// "som" no stderr marca o primeiro byte de áudio; "erro=..." explica uma falha;
// "sem-tocador" (saída 4) pede o caminho antigo, que baixa tudo antes de tocar.
// Com ARAUTO_CACHE_ID, o mp3 fica guardado e a próxima vez toca do disco.
const SCRIPT_FLUXO = `set -u
PLAY=()
for p in /opt/homebrew/bin/mpg123 /usr/local/bin/mpg123; do [ -x "$p" ] && { PLAY=("$p" -q); break; }; done
if [ \${#PLAY[@]} -eq 0 ]; then
  for p in /opt/homebrew/bin/ffplay /usr/local/bin/ffplay; do [ -x "$p" ] && { PLAY=("$p" -nodisp -autoexit -loglevel quiet -i); break; }; done
fi
[ \${#PLAY[@]} -gt 0 ] || { echo sem-tocador >&2; exit 4; }
mata() { local f; for f in $(pgrep -P "$1"); do mata "$f"; done; kill "$1" 2>/dev/null; }
trap 'for f in $(pgrep -P $$); do mata "$f"; done; exit 143' TERM INT
CACHE=""
[ -n "\${ARAUTO_CACHE_ID:-}" ] && CACHE="$HOME/Library/Caches/arauto/$ARAUTO_CACHE_ID.mp3"
if [ -n "$CACHE" ] && [ -s "$CACHE" ]; then
  echo cache >&2; echo som >&2
  "\${PLAY[@]}" "$CACHE" &
  wait $!; exit $?
fi
H="$HOME/.config/arauto/fish-audio.header"
[ -r "$H" ] || { echo "erro=chave da Fish Audio não encontrada" >&2; exit 3; }
TMP="$(mktemp "\${TMPDIR:-/tmp}/arauto.XXXXXX")"
curl -sS --fail-with-body -m "$FISH_TIMEOUT" -H @"$H" -H 'content-type: application/json' -H "model: $FISH_MODEL" --data-binary "$FISH_BODY" https://api.fish.audio/v1/tts 2>/dev/null \\
  | { b="$(dd bs=1 count=1 2>/dev/null | xxd -p)"; if [ -n "$b" ]; then [ "$b" != 7b ] && echo som >&2; printf "\\\\x$b"; fi; cat; } \\
  | tee "$TMP" | "\${PLAY[@]}" - 2>/dev/null &
wait $!
st=$?
if [ ! -s "$TMP" ] || [ "$(head -c 1 "$TMP")" = "{" ]; then
  echo "erro=$(head -c 200 "$TMP" | tr '\\n' ' ')" >&2; rm -f "$TMP"; exit 22
fi
if [ -n "$CACHE" ] && [ $st -eq 0 ]; then mkdir -p "$(dirname "$CACHE")"; mv "$TMP" "$CACHE"; else rm -f "$TMP"; fi
exit $st`

// O caminho antigo: baixa o mp3 inteiro e só então toca. Fica para quando não há mpg123 nem ffplay.
const SCRIPT_INTEIRO = `set -o pipefail
H="$HOME/.config/arauto/fish-audio.header"
[ -r "$H" ] || { echo "chave da Fish Audio não encontrada" >&2; exit 3; }
curl -sS --fail-with-body -m "$FISH_TIMEOUT" -H @"$H" -H 'content-type: application/json' -H "model: $FISH_MODEL" --data-binary "$FISH_BODY" https://api.fish.audio/v1/tts | base64`

export const MODELO_FISH = 'drama-3'

let semTocador = false

async function hashDe(texto: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

async function sintetizar(
  recursos: Recursos,
  corpo: Record<string, unknown>,
  signal: AbortSignal,
  segundos: number,
  guardar = false,
): Promise<ResultadoDeVoz> {
  const inicio = Date.now()
  const pedido = JSON.stringify({ format: 'mp3', ...corpo })
  const bytes = new TextEncoder().encode(String(corpo.text ?? '')).length
  const env: Record<string, string> = { FISH_MODEL: MODELO_FISH, FISH_TIMEOUT: String(segundos), FISH_BODY: pedido }
  if (!semTocador) {
    if (guardar) env.ARAUTO_CACHE_ID = await hashDe(`${MODELO_FISH}|${pedido}`)
    const r = await recursos.tocarFluxo(SCRIPT_FLUXO, env, signal, (segundos + 10) * 1000)
    const cache = r.stderr.includes('cache\n')
    if (r.primeiroSom !== undefined) {
      return { bytes: cache ? 0 : bytes, primeiroSom: r.primeiroSom - inicio, cache }
    }
    if (signal.aborted) return { bytes: 0, primeiroSom: 0 }
    if (r.codigo === 4) {
      semTocador = true
    } else {
      const motivo = (r.stderr.match(/erro=(.*)/)?.[1] ?? r.stderr).replace(/\s+/g, ' ').trim().slice(0, 160)
      throw new Error(`Fish Audio falhou (código ${r.codigo}${motivo ? `: ${motivo}` : ''})`)
    }
  }
  const r = await recursos.rodar(['/bin/bash', '-c', SCRIPT_INTEIRO], { env, timeoutMs: (segundos + 5) * 1000 })
  const base64 = r.stdout.replace(/\s+/g, '')
  if (r.exitCode !== 0 || base64.length < 100) {
    const motivo = (r.stderr || r.stdout).replace(/\s+/g, ' ').trim().slice(0, 160)
    throw new Error(`Fish Audio falhou (código ${r.exitCode}${motivo ? `: ${motivo}` : ''})`)
  }
  const primeiroSom = Date.now() - inicio
  if (!signal.aborted) await recursos.tocar({ base64, mime: 'audio/mpeg' }, { signal })
  return { bytes, primeiroSom }
}

const ritmoFish = (velocidade: number) =>
  Math.min(2, Math.max(0.5, Number((velocidade / VELOCIDADE_NORMAL).toFixed(2))))

const fish: MotorDeVoz = {
  nome: 'Fish Audio (drama-3)',
  vozes: [
    { id: 'd9bc9ab6317040d28307ee6d89c73ca0', nome: 'Mordomo de IA', descricao: 'Mark l: masculina, madura, calma e formal' },
    { id: 'df1fa6d2ae194b3ebcbae60df48fde35', nome: 'Narrador Propagandas', descricao: 'masculina, confiante, de locução' },
    { id: '5b5a485751824c1993e210602cee16cb', nome: 'Voz feminina', descricao: 'jovem, clara e animada' },
  ],
  falar: (recursos, { texto, emocao, voz, velocidade, signal, guardar }) =>
    sintetizar(
      recursos,
      { text: `[${emocao}] ${texto}`, reference_id: voz, prosody: { speed: ritmoFish(velocidade) } },
      signal,
      25,
      guardar,
    ),
  // Um pedido só: cada réplica abre com <|speaker:N|>, N sendo a posição da voz em reference_id.
  dialogo: (recursos, { replicas, vozes, velocidade, signal }) =>
    sintetizar(
      recursos,
      {
        text: replicas.map(r => `<|speaker:${r.quem}|>[${r.emocao}] ${r.texto}`).join('\n'),
        reference_id: [...vozes],
        max_new_tokens: 2048,
        prosody: { speed: ritmoFish(velocidade) },
      },
      signal,
      90,
    ),
}

// A segunda voz do podcast: a primeira da lista que não seja a principal.
export const parceira = (motor: Motor, voz: string): string =>
  (motor === 'fish'
    ? ['5b5a485751824c1993e210602cee16cb', 'df1fa6d2ae194b3ebcbae60df48fde35']
    : ['Flo (Português (Brasil))', 'Reed (Português (Brasil))']
  ).find(v => v !== voz) ?? voz

export const MOTORES: Record<Motor, MotorDeVoz> = { fish, mac }

export const motorDe = (config: Config): MotorDeVoz => MOTORES[config.motor] ?? fish

export const VOZ_PADRAO: Record<Motor, string> = {
  fish: fish.vozes[0]?.id ?? '',
  mac: 'Luciana',
}

export const VOZES_AGENTE_PADRAO: Record<Motor, Config['vozesAgente']> = {
  fish: {
    pesquisa: '5b5a485751824c1993e210602cee16cb',
    revisao: 'df1fa6d2ae194b3ebcbae60df48fde35',
    codigo: 'd9bc9ab6317040d28307ee6d89c73ca0',
  },
  mac: {
    pesquisa: 'Reed (Português (Brasil))',
    revisao: 'Shelley (Português (Brasil))',
    codigo: 'Eddy (Português (Brasil))',
  },
}

export const nomeDaVoz = (id: string): string =>
  [...fish.vozes, ...mac.vozes].find(v => v.id === id)?.nome ?? id

// US$ por milhão de bytes UTF-8 no drama-3: 10 na promoção até 30/11/2026, 50 depois.
export const custoFish = (bytes: number, agora = Date.now()): number =>
  (bytes / 1_000_000) * (agora < Date.UTC(2026, 11, 1, 8) ? 10 : 50)
