# Documentação do FarmaTarefas

Guia para quem vai dar manutenção no FarmaTarefas. O [README da raiz](../README.md) diz o que o app faz; aqui está **como ele funciona por dentro** e **como mexer nele sem quebrar nada**. O projeto é pequeno (HTML, CSS e um JavaScript, sem build), então tudo está nesta página.

| Seção | Para que serve |
|---|---|
| [Começo rápido](#começo-rápido) | Rodar no computador e publicar |
| [Arquitetura](#arquitetura) | Papel de cada arquivo, estado, como as telas são desenhadas |
| [Dados e persistência](#dados-e-persistência) | O que fica no `localStorage`, formato do backup, service worker |
| [Funcionalidades](#funcionalidades) | Como cada tela e ação funciona |
| [Manutenção](#manutenção) | Receitas passo a passo e pontos frágeis conhecidos |

## Começo rápido

```sh
node serve.js 8080     # http://127.0.0.1:8080
```

Use `127.0.0.1`, não `localhost` (nesta máquina o `localhost` cai em outro processo, no IPv6). Abrir o `index.html` direto (`file://`) até funciona, mas sem service worker e sem instalação.

**Publicar:** o site é o GitHub Pages da branch `main`, na raiz (<https://robsonbaioco.github.io/farmacia-tarefas/>). Não há build: o `git push` para `main` já publica.

Requisitos: só Node (qualquer versão recente) para o `serve.js`, que usa apenas módulos nativos. Não há `package.json` nem dependências.

## Arquitetura

```
index.html ── casca fixa: topo, abas, <main id="app">, botão +, diálogos, toast
   ├── styles.css ── tokens de cor (claro/escuro), layout celular e computador
   └── app.js ───── todo o app: estado, regras, telas, diálogos, backup
          ├── localStorage "farmatarefas:v1" (estado inteiro em JSON)
          └── sw.js (service worker) ── Cache Storage "farmatarefas-vN" (cópia offline)
manifest.webmanifest + icons/ ── instalação como app (PWA)
serve.js ── servidor local de teste (não vai para produção)
```

| Arquivo | Papel |
|---|---|
| `index.html` | Elementos fixos. Os diálogos (`taskDialog`, `moveDialog`, `tplDialog`, `confirmDialog`) já existem aqui e o `app.js` só os preenche e abre. |
| `app.js` | Um arquivo só, dividido em blocos comentados: utilidades, estado, ações, renderização, diálogos, importar/exportar, eventos, toast, tema/PWA/inicialização. |
| `styles.css` | Variáveis em `:root`; tema escuro pelo sistema ou forçado com `data-theme`. Abaixo de 900px as abas ficam embaixo; acima, no topo. |
| `sw.js` | Guarda os arquivos para uso offline. Estratégia: rede primeiro, cache como reserva. |
| `serve.js` | Servidor HTTP mínimo para testar o PWA (que precisa de `http://`). |

### Estado e desenho das telas

- `state` é tudo o que é salvo (perfil, tarefas, modelos, tema, se o cadastro foi feito). `ui` é só o que está na tela (aba, dia escolhido, item em edição) e não é salvo.
- Toda ação segue o mesmo caminho: muda `state` → `save()` → `render()`.
- `render()` escolhe a tela (`renderOnboarding`, `renderDay`, `renderWeek`, `renderTemplates`, `renderProfile`) e ela **substitui todo o `innerHTML` de `#app`** por um texto HTML montado com template strings. Não há framework nem diff.
- Por isso os cliques são tratados por **delegação**: um único `app.addEventListener('click', ...)` lê os atributos do elemento clicado:
  - `data-nav` (andar dias/semanas ou voltar para hoje),
  - `data-date` (abrir um dia),
  - `data-act` (ação: `toggle`, `edit`, `move`, `tomorrow`, `new`, `routine`, `tpl-add`, `export`, `reset`...),
  - e o id do item vem do pai com `data-id` (tarefa) ou `data-tpl` (modelo).
- Arrastar e soltar (computador) usa `draggable` nas tarefas e `data-drop="<data>"` nas colunas da Semana e na faixa da semana.

## Dados e persistência

Tudo fica no navegador, na chave `farmatarefas:v1` do `localStorage`. Não há servidor nem conta.

```js
{
  profile:   { name, role, store, shiftStart, shiftEnd },   // turno em "HH:MM"
  tasks:     [{ id, title, notes, date: "AAAA-MM-DD", time, moment, category, priority, done, doneAt, createdAt }],
  templates: [{ id, title, notes, moment, category, priority, routine }],
  settings:  { theme: "auto" | "light" | "dark" },
  onboarded: true,          // false = mostra o cadastro do primeiro acesso
  createdAt: "ISO"
}
```

- `moment`: `"inicio"`, `""` (durante o turno) ou `"fim"`. Não há horário fixo nas tarefas. O campo `time` só existe em dados antigos: tarefas antigas com hora de um modelo padrão viram momento ao carregar (pelo título, via `DEFAULT_MOMENT_BY_TITLE`); hora de tarefa criada pela pessoa é mantida e só é exibida.
- `category`: um dos ids de `CATEGORIES`; `priority`: `baixa`, `normal` ou `alta`.
- Datas são sempre strings `AAAA-MM-DD` no fuso local (`toISO`/`fromISO`), nunca `new Date("AAAA-MM-DD")`, que seria UTC.
- **Todo dado lido passa pelo saneamento**: `load()` → `sanitizeState()` → `normalizeTask()`/`normalizeTemplate()`. Eles completam campos faltando, cortam textos longos e trocam valores inválidos pelo padrão. Ao abrir, o app grava de volta o estado saneado.
- Duas abas abertas ficam sincronizadas pelo evento `storage`.

### Backup (JSON)

`exportData(what)` baixa `farmatarefas-<nome>-<completo|perfil|atividades>-<data>.json`:

```js
{ format: "farmatarefas-backup", version: 1, exportedAt, content: "all" | "profile" | "tasks",
  profile?, templates?, settings?, tasks? }
```

`importFile` recusa arquivos sem `format: "farmatarefas-backup"`. Depois pergunta:

- **Substituir tudo**: troca só as partes que o arquivo traz (perfil/modelos/tema e/ou tarefas).
- **Mesclar**: o perfil importado só preenche campos vazios; modelos e tarefas são juntados pelo `id` (o importado vence).

No primeiro acesso (sem perfil) a importação substitui sem perguntar.

### Service worker e atualização

`sw.js` guarda os arquivos de `ASSETS` no cache `farmatarefas-vN`. Toda requisição GET do próprio site vai primeiro à rede (com `cache: 'no-cache'`, para revalidar) e atualiza a cópia; sem rede, usa a cópia, e em último caso o `index.html`. Na ativação, caches com outro nome são apagados. Com essa estratégia, quem está online recebe a versão nova na próxima recarga.

## Funcionalidades

- **Primeiro acesso** (`renderOnboarding` + `finishOnboarding`): nome (obrigatório), função, unidade, turno (início e fim; os dois ou nenhum) e a escolha dos modelos de rotina, agrupados por categoria. Os escolhidos viram `routine: true` e já entram como tarefas de hoje. Também dá para importar um backup dali.
- **Dia** (`renderDay`): setas para o dia anterior/seguinte, botão "Hoje", ícone de calendário com um `<input type="date">` invisível por cima, faixa da semana (pendentes por dia), aviso de pendências de dias anteriores com "Trazer para hoje" (só quando o dia mostrado é hoje), barra de progresso, pendentes e "Concluídas" recolhíveis.
- **Ordem da lista** (`sortTasks`): pendentes primeiro; depois momento do turno (início, durante, fim), hora (dados antigos), prioridade (alta, normal, baixa) e criação.
- **Semana** (`renderWeek`): segunda a domingo, uma coluna por dia, tarefas em versão compacta, "+ tarefa" por dia; arrastar entre colunas muda o dia. No celular, o ícone de calendário da tarefa abre o diálogo de mover.
- **Mover** (`openMoveDialog`): atalhos Hoje, Amanhã, Depois de amanhã, +1 dia, +1 semana, Próxima segunda, ou qualquer data. A seta → da tarefa passa para o dia seguinte (pendência atrasada vai para amanhã a partir de hoje).
- **Modelos** (`renderTemplates`): 16 modelos padrão em `DEFAULT_TEMPLATES`, agrupados por categoria. Adicionar ao dia mostrado, editar, excluir (com desfazer) e "Restaurar modelos padrão" (repõe os que faltam, comparando pelo título). "+ Rotina diária" / "Aplicar rotina neste dia" (`applyRoutine`) adiciona os modelos de rotina que ainda não estão no dia (também comparando pelo título).
- **Nova tarefa** pelo botão +: título, observações, dia, momento, categoria, prioridade e "Salvar também como modelo". Na aba Modelos o + cria um modelo.
- **Perfil** (`renderProfile`): dados, turno e tema; resumo (total, concluídas, atrasadas); exportar tudo / só perfil e modelos / só atividades; importar; apagar concluídas com mais de 30 dias; apagar todos os dados (com confirmação).
- **Desfazer**: mover, excluir, aplicar rotina, trazer pendências e excluir modelo mostram um toast com "Desfazer" por 5 segundos.
- **Virada do dia**: se o app volta a ficar visível num dia novo e estava mostrando "hoje", passa a mostrar o novo hoje.
- **Instalar**: o botão "Instalar app" aparece quando o navegador dispara `beforeinstallprompt`.

## Onde estão os comentários

Todo arquivo de código começa com um comentário dizendo o papel dele e com quem conversa. Toda função tem um `/** ... */` explicando o que faz; os blocos de eventos têm um comentário de linha. Comentários de linha aparecem só onde a lógica não é óbvia (o *porquê*). Ao mudar o código, atualize o comentário junto.

## Manutenção

Antes de terminar qualquer mudança: `node --check app.js`, teste em `node serve.js 8080` (inclusive no modo escuro e numa janela estreita, de celular) e, se mexeu no formato dos dados, teste com um backup antigo.

### Publicar uma mudança

1. Se mudou a lista de arquivos do app (arquivo novo, ícone novo), atualize `ASSETS` em `sw.js`.
2. Aumente o número em `CACHE` (`farmatarefas-v4` → `v5`) sempre que mudar arquivos do app, como pede o README. Isso descarta a cópia offline antiga.
3. Commit e `git push` para `main`. O GitHub Pages atualiza em um ou dois minutos.

### Modelo padrão novo

Acrescente em `DEFAULT_TEMPLATES` (`app.js`) com `title`, `category` (id de `CATEGORIES`), `priority` e, se for o caso, `moment` (`inicio`/`fim`) e `notes`. Ele aparece para quem fizer o cadastro depois; quem já usa o app o recebe pelo botão "Restaurar modelos padrão".

### Categoria nova

1. Em `CATEGORIES`, acrescente `{ id, label }` **antes** de `outros` (o último item é a categoria de reserva usada por `catLabel`).
2. Em `styles.css`, crie a cor `--c-<id>` em `:root` e nos **dois** blocos do tema escuro (o `@media (prefers-color-scheme: dark)` e o `:root[data-theme="dark"]`).

### Campo novo na tarefa ou no modelo

1. Campo no diálogo (`index.html`).
2. Leitura em `openTaskDialog`/`openTplDialog` e no `submit` do formulário.
3. Valor padrão e validação em `normalizeTask`/`normalizeTemplate` — senão o campo é descartado ao carregar e ao importar.
4. Exibição em `taskHTML` ou `renderTemplates`, sempre passando o texto por `esc()`.
5. Se for um campo de modelo que a tarefa herda, copie em `taskFromTemplate`.

### Mudar o formato dos dados

Não troque a chave `farmatarefas:v1` nem o `EXPORT_FORMAT`: quem já usa perderia os dados ou não conseguiria importar o backup. Converta o formato antigo dentro de `sanitizeState`/`normalize*`, como foi feito com a hora fixa → momento do turno.

### Pontos frágeis conhecidos

- **HTML como texto**: tudo que vem da pessoa (título, notas, nome, unidade) precisa passar por `esc()` antes de entrar num template string, senão abre brecha para HTML injetado.
- **Tela inteira redesenhada** a cada ação: foco e posição de rolagem dentro de `#app` se perdem no `render()`. Listeners não podem ser presos a elementos de dentro de `#app` (somem no próximo render); use a delegação existente.
- **Comparação por título**: "+ Rotina diária" e "Restaurar modelos padrão" decidem o que já existe pelo título em minúsculas. Renomear um modelo de rotina depois de aplicado no dia faz ele ser adicionado de novo; renomear um padrão faz o "Restaurar" trazer o original de volta.
- **Excluir modelo** usa `findIndex` sem conferir se achou; se o id não existir, `splice(-1, 1)` removeria o último modelo. Hoje o id sempre existe porque vem do próprio elemento desenhado.
- **Momento do turno** só tem três valores (`MOMENTS` + `MOMENT_ORDER`). Um valor novo precisa entrar nos dois e nos `<select name="moment">` dos dois diálogos do `index.html`.
- **Dados antigos com hora**: a conversão depende do título do modelo padrão em `DEFAULT_TEMPLATES`. Mudar o título de um padrão faz tarefas antigas com aquela hora deixarem de ser convertidas (continuam funcionando, com a hora exibida).
- **Cache offline**: esquecer de pôr arquivo novo em `ASSETS` faz ele faltar sem internet.
- **Dados só no aparelho**: limpar os dados do navegador apaga tudo. O backup é a única cópia.
