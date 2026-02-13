# Web Chess / PCChat

## Rodar local

```bash
npm install
npm start
```

Abra:
- `http://localhost:3000/` (chat)
- `http://localhost:3000/chess.html` (xadrez)

## Deploy frontend na Vercel

1. Suba o repositorio no GitHub.
2. Importe o projeto na Vercel.
3. O arquivo `vercel.json` ja publica o conteudo de `public/`.

URLs esperadas na Vercel:
- `/` -> chat
- `/chess` -> xadrez

## Configurar URL do backend

Edite `public/config.js`:

```js
window.PCCHAT_CONFIG = {
  API_BASE_URL: "https://seu-backend.exemplo.com"
};
```

- Em desenvolvimento local, pode deixar vazio (`""`) para usar o mesmo host.
- Em deploy, coloque a URL do backend publico (com HTTPS).

No backend, configure `ALLOWED_ORIGINS` (veja `.env.example`), por exemplo:

```bash
ALLOWED_ORIGINS=https://seu-app.vercel.app,http://localhost:3000
```

## Observacao importante

Este projeto usa Socket.IO + WebSocket + estado em memoria no servidor (`server.js`).
Para funcionamento estavel do realtime, mantenha o backend em um host de servidor Node persistente (ex.: Render/Railway/Fly).

## Erro na Vercel: FUNCTION_INVOCATION_FAILED

Se aparecer `500 FUNCTION_INVOCATION_FAILED`, a Vercel provavelmente detectou o projeto como funcao serverless de Express.

Correcao:
1. Deixe a Vercel servindo apenas frontend estatico (`vercel.json` ja configurado).
2. Hospede o backend (`server.js`) em outro provedor Node persistente.
3. Configure `public/config.js` com a URL publica do backend.
