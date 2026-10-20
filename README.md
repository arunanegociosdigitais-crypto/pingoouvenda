# Pingou Venda — Métricas de Roupas Vendidas

Aplicativo web para acompanhar as vendas de uma loja de roupas: registra cada venda, calcula métricas e mostra o desempenho em tempo real, com som de venda ("pingou venda") a cada novo registro.

## Estrutura

- `client/` — interface React (Vite/Bun): painel de métricas, página de vendas, produtos e estoque, criar conta e entrar com email e senha.
- `server/` — ações do servidor e esquema do banco de dados (Drizzle).
- `drizzle/` — migrações SQL do banco.

## Como rodar

```bash
bun install
bun run build
```

Os assets binários do app (imagens do pinguim, logo e o arquivo de som da venda) ficam em `client/src/assets/`.
