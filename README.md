# FarmaTarefas

To-do list para trabalhadores de farmácia. Web responsivo + PWA (instalável, funciona offline).

**Online:** https://robsonbaioco.github.io/farmacia-tarefas/

## Rodar

```
node serve.js 8080
```

Abra http://127.0.0.1:8080. (O service worker/instalação não funciona abrindo o `index.html` direto por `file://`.)
Para instalar no celular, o app precisa estar em HTTPS (ex.: GitHub Pages, Netlify) — basta subir esta pasta.

## Funcionalidades

- **Primeiro acesso**: abre a criação de perfil (nome, função, unidade, turno com horário de início e fim) e a pessoa escolhe quais modelos entram na rotina diária. Também dá para importar um backup direto daí.
- **Dia**: tarefas do dia, faixa da semana, progresso, pendências atrasadas ("Trazer para hoje").
- **Mudar de dia**: botão → (dia seguinte), ícone de calendário (atalhos + qualquer data), ou arrastar na tela **Semana** / na faixa da semana (desktop).
- **Modelos**: 16 opções pré-cadastradas (temperatura, SNGPC, caixa, validade...) para a pessoa escolher; nenhuma entra sozinha na lista. Crie, edite ou exclua; os marcados como "rotina diária" entram com "+ Rotina diária".
- **Sem horário fixo**: tarefas e modelos usam o momento do turno (início / durante / fim), que vale para qualquer turno. A lista do dia ordena por momento e prioridade; dados antigos com hora são convertidos automaticamente.
- **Perfil**: nome, função, unidade, turno (início/fim), tema; exportar (tudo / perfil+modelos / atividades) e importar JSON (mesclar ou substituir).

Dados ficam no `localStorage` do navegador. Ao alterar arquivos do app, aumente `CACHE` em `sw.js`.
