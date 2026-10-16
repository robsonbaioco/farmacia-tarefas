# FarmaTarefas

To-do list para trabalhadores de farmácia. Web responsivo + PWA (instalável, funciona offline).
n**Online:** https://robsonbaioco.github.io/farmacia-tarefas/

## Rodar

```
node serve.js 8080
```

Abra http://127.0.0.1:8080. (O service worker/instalação não funciona abrindo o `index.html` direto por `file://`.)
Para instalar no celular, o app precisa estar em HTTPS (ex.: GitHub Pages, Netlify) — basta subir esta pasta.

## Funcionalidades

- **Dia**: tarefas do dia, faixa da semana, progresso, pendências atrasadas ("Trazer para hoje").
- **Mudar de dia**: botão → (dia seguinte), ícone de calendário (atalhos + qualquer data), ou arrastar na tela **Semana** / na faixa da semana (desktop).
- **Modelos**: 16 tarefas pré-cadastradas (temperatura, SNGPC, caixa, validade...). Crie, edite ou exclua; os marcados como "rotina diária" entram com "+ Rotina diária".
- **Perfil**: nome, função, unidade, turno, tema; exportar (tudo / perfil+modelos / atividades) e importar JSON (mesclar ou substituir).

Dados ficam no `localStorage` do navegador. Ao alterar arquivos do app, aumente `CACHE` em `sw.js`.
