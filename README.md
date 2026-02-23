# news-api

Backend leve em Node.js + Fastify + SQLite para substituir a persistencia em arquivos no GitHub.

## O que faz

- Coleta RSS das mesmas fontes do worker atual.
- Processa conteudo com IA (OpenRouter) quando `USE_AI=true`.
- Aplica quality gate minimo antes de persistir.
- Salva posts e views em SQLite.
- Exponibiliza endpoints compativeis para stats/views.

## Endpoints

- `GET /health`
- `POST /api/collector/run`
- `GET /api/posts?limit=20&page=1&tag=...&topic=...`
- `GET /api/posts/:slug`
- `GET /api/views/:slug`
- `POST /api/views/:slug`
- `GET /api/stats/dashboard?limit=20`
- `GET /api/stats/posts-by-day?preset=7d`
- `GET /api/stats/posts-by-hour?preset=24h`
- `GET /api/stats/posts-by-hour?preset=24h&timeline=repository`
- `GET /api/stats/posts-by-hour-posts?hour=YYYY-MM-DDTHH:00&timeline=repository&bucketHours=1`

## Setup

```bash
npm install
cp .env.example .env
npm run collect
npm start
```

## Variaveis principais

- `PORT` (default `3001`)
- `DB_PATH` (default `./data/news.db`)
- `RUN_SCHEDULER` (default `true`)
- `SCHEDULER_CRON` (default `0 * * * *`)
- `USE_AI` (default `false`)
- `OPENROUTER_KEY`
- `OPENROUTER_MODEL`

## Observacao

A fonte UOL pode variar formato e eventualmente falhar em parsing RSS. O coletor continua processando as demais fontes sem interromper a execucao.
