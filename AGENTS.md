# Instrucoes Persistentes

- Em chats futuros neste repositorio, consulte este arquivo antes de responder.
- Quando eu disser "ver la", confira este arquivo e siga estas instrucoes.
- Responda em portugues (pt-BR), com objetividade.

## Funcoes do app

- Criar/entrar em sala de chat com `topic + senha + nickname`.
- Trocar mensagens em tempo real na sala (Socket.IO).
- Compartilhar historico recente de mensagens ao entrar na sala.
- Mostrar status de conexao (conectado/desconectado).
- Mostrar quantidade de usuarios/peers na sala.
- Permitir sair da sala e voltar para tela de login.
- Manter heartbeat (`ping/pong`) para detectar conexao ativa.
- Sincronizar estado de partidas de xadrez via WebSocket (`/ws`).
- Suportar chat do xadrez e atribuicao de cor (`w`, `b`, `spectator`).
- Limpar salas inativas automaticamente no servidor.
