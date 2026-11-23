import type { ChaveFish, SituacaoChave } from '../types'

// A chave mora em ~/.config/arauto/fish-audio.header (modo 600), o mesmo arquivo
// que o curl lê para falar. O painel só lê os 8 primeiros caracteres (sk-fish-)
// para mostrar mascarada; a chave nova chega aos scripts pela entrada padrão,
// nunca pela linha de comando nem pelo ambiente, e não fica no estado do mod.

const TESTE = 'https://api.fish.audio/wallet/self/api-credit'

const LER = `H="$HOME/.config/arauto/fish-audio.header"
[ -r "$H" ] || { echo sem-chave; exit 0; }
p="$(sed -n 's/^Authorization: Bearer //p' "$H" | head -n 1 | cut -c1-8)"
[ -n "$p" ] || { echo sem-chave; exit 0; }
c="$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H @"$H" '${TESTE}' 2>/dev/null)"
case "$c" in 200) s=conectada;; 401|403) s=invalida;; *) s=sem-conexao;; esac
echo "$s $p"`

// Testa a chave nova antes de trocar: se a Fish recusar, a anterior continua.
const GRAVAR = `umask 077
D="$HOME/.config/arauto"; H="$D/fish-audio.header"
mkdir -p "$D"
IFS= read -r k || [ -n "$k" ]
k="$(printf %s "$k" | tr -d '[:space:]')"
case "$k" in Bearer*) k="\${k#Bearer}";; esac
[ -n "$k" ] || { echo vazia; exit 0; }
T="$(mktemp "$D/.chave.XXXXXX")"
printf 'Authorization: Bearer %s\\n' "$k" > "$T"
unset k
c="$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H @"$T" '${TESTE}' 2>/dev/null)"
case "$c" in 401|403) rm -f "$T"; echo invalida; exit 0;; 200) s=conectada;; *) s=sem-conexao;; esac
chmod 600 "$T" && mv -f "$T" "$H"
echo "$s $(sed -n 's/^Authorization: Bearer //p' "$H" | head -n 1 | cut -c1-8)"`

const APAGAR = `rm -f "$HOME/.config/arauto/fish-audio.header"; echo sem-chave`

type Rodar = (
  argv: readonly string[],
  init?: { stdin?: string; timeoutMs?: number },
) => Promise<{ exitCode: number | null; stdout: string }>

const SITUACOES: readonly SituacaoChave[] = ['conectada', 'invalida', 'sem-conexao', 'sem-chave']

function interpretar(saida: string): Pick<ChaveFish, 'situacao' | 'prefixo'> {
  const [palavra = '', prefixo = ''] = saida.trim().split(/\s+/)
  const situacao = SITUACOES.find(s => s === palavra) ?? 'sem-conexao'
  return { situacao, prefixo: situacao === 'sem-chave' ? '' : prefixo }
}

export const SEM_CHAVE: ChaveFish = { situacao: 'sem-chave', prefixo: '', editando: false }

export async function lerChave(rodar: Rodar): Promise<Pick<ChaveFish, 'situacao' | 'prefixo'>> {
  const r = await rodar(['/bin/bash', '-c', LER], { timeoutMs: 15_000 })
  return interpretar(r.stdout)
}

export type Gravacao = { recusada: true } | { recusada: false; vazia: boolean; chave: Pick<ChaveFish, 'situacao' | 'prefixo'> }

export async function gravarChave(rodar: Rodar, chave: string): Promise<Gravacao> {
  const r = await rodar(['/bin/bash', '-c', GRAVAR], { stdin: `${chave}\n`, timeoutMs: 15_000 })
  const saida = r.stdout.trim()
  if (saida === 'invalida') return { recusada: true }
  if (saida === 'vazia') return { recusada: false, vazia: true, chave: { situacao: 'sem-chave', prefixo: '' } }
  return { recusada: false, vazia: false, chave: interpretar(saida) }
}

export async function apagarChave(rodar: Rodar): Promise<void> {
  await rodar(['/bin/bash', '-c', APAGAR])
}

export const mascarar = (prefixo: string) => `${prefixo || 'sk-'}••••••••`

export function legendaDaChave(c: ChaveFish): string {
  if (c.aviso) return c.aviso
  switch (c.situacao) {
    case 'conectada':
      return 'Fish Audio conectada · drama-3'
    case 'invalida':
      return 'A Fish recusou a chave guardada. Troque por uma nova.'
    case 'sem-conexao':
      return 'Chave guardada; sem conexão com a Fish para testar agora.'
    case 'sem-chave':
      return 'Sem chave: o Arauto fala com a voz do Mac.'
  }
}
