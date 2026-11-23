# Arauto: o Claude Code avisa falando

Um mod que dá voz ao Claude Code. Você deixa a tarefa rodando, vai fazer outra coisa, e ele te chama falando quando termina, quando precisa de você ou quando algo dá errado.

## Como aparece no app (o mais discreto possível)

1. **Fechado:** só uma linha na barra de status: `Arauto · <voz> · pronto` (ou `falando`, ou `esperando você`).
2. **Minimizado:** um cartão pequeno no canto, com a frase que está sendo dita, o projeto, a emoção e dois botões: mudo e abrir o painel. Quando precisa de você, o cartão fica em âmbar com "Preciso de você".
3. **Aberto:** painel lateral, com tudo recolhido em seções:
   - **Agora:** a última fala e o botão "Ouvir de novo".
   - **Funções:** cada uma com Ligado/Desligado (lista abaixo) e o botão "Resumo falado do que rodou" (o mesmo que `/resumo`).
   - **Voz e persona:** voz, persona (seco e direto, empolgado, professor paciente, mordomo irônico), velocidade, emoção (o Claude escolhe ou sempre neutra), uma amostra com "Ouvir amostra", e uma voz para cada tipo de agente (pesquisa, revisão, código).
   - **Configurações:** tamanho da fala (até 2 frases), falar só em tarefas acima de 20 segundos, dizer o nome do projeto antes, e o gasto da sessão.

## Funções

| Função | O que faz | Começa |
|---|---|---|
| Aviso de fim de tarefa | Fala 1 a 2 frases quando termina, no tom do resultado | ligada |
| Resposta falada | Fala um resumo curto da resposta em vez de ler tudo | ligada |
| Preciso de você | Avisa com urgência quando vai pedir permissão; repete em 2 min se ninguém responder | ligada |
| Erro com gravidade | Quando um comando falha, resume em uma frase, tom conforme a gravidade | ligada |
| Vozes por agente | Cada subagente fala com a voz do tipo dele | ligada |
| Ferramenta falar | Uma ferramenta que o próprio Claude chama quando quer avisar algo, escolhendo a emoção | ligada |
| Tema de personagem | Uma fala curta de personagem ao abrir a sessão | ligada |
| Confirmação de início | Frase curta ao receber uma tarefa longa | desligada |
| Ler a resposta inteira | Lê a resposta toda, sem resumir | desligada |

Comandos: `/voz` (liga, desliga, troca a voz) e `/resumo` (resumo falado do que rodou na sessão).

## Regras da fala

- Nunca fala código, caminhos longos, links, chaves, tokens ou senhas.
- Uma fala por vez, em fila, mesmo com várias sessões abertas.
- Não pode travar o Claude Code enquanto a voz é gerada.
- Mudo vale para tudo, na hora.
- Português do Brasil.

## Voz

Por enquanto, a voz do próprio Mac (Luciana). Depois a voz vem da Fish Audio, modelo `drama-3`, com tags de emoção no começo da frase (ex.: `[aliviado] Terminei.`). Deixe pronto para trocar o motor de voz sem mexer no resto.
