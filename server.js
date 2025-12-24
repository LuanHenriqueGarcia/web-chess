const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Hyperswarm = require('hyperswarm');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  pingTimeout: 60000,
  pingInterval: 25000
});
const wss = new WebSocket.Server({ noServer: true });

app.use(express.static(path.join(__dirname, 'public')));

const activeRooms = new Map();
const userSockets = new Map();

function buildRoomKey(topic, secret) {
  const secretHash = crypto.createHash('md5').update(secret).digest('hex').substr(0, 8);
  return `${topic}:${secretHash}`;
}

class ChatRoom {
  constructor(topic, secret) {
    this.topic = topic;
    this.secret = secret;
    this.swarm = new Hyperswarm();
    this.peers = new Set();
    this.messages = [];
    this.socketClients = new Set();
    this.chessClients = new Set();
    this.chessState = null;
    this.chessSeq = -1;
    this.gameId = null;
    this.peerBuffers = new Map();
    this.setupSwarm();
  }

  setupSwarm() {
    const topicHash = crypto.createHash('sha256')
      .update(this.topic + this.secret)
      .digest();

    this.swarm.join(topicHash, { lookup: true, announce: true });

    this.swarm.on('connection', (connection, info) => {
      console.log(`New P2P Connection: ${this.topic}`);
      
      this.peers.add(connection);
      this.peerBuffers.set(connection, '');
      
      setTimeout(() => this.broadcastUserCount(), 100);
      
      this.messages.forEach(msg => {
        this.sendToPeer(connection, msg);
      });

      connection.on('data', (data) => {
        this.processPeerData(connection, data);
      });

      connection.on('close', () => {
        this.peers.delete(connection);
        this.peerBuffers.delete(connection);
        console.log(`P2P Connection closed at ${this.topic}`);
        setTimeout(() => this.broadcastUserCount(), 100);
      });

      connection.on('error', (err) => {
        console.error('Error at the P2P connection:', err);
        this.peers.delete(connection);
        this.peerBuffers.delete(connection);
        setTimeout(() => this.broadcastUserCount(), 100);
      });
    });

    this.swarm.on('error', (err) => {
      console.error('Error at the swarm:', err);
    });
  }

  processPeerData(connection, data) {
    const incoming = data.toString();
    let buffer = this.peerBuffers.get(connection) || '';
    buffer += incoming;

    if (!buffer.includes('\n')) {
      try {
        const message = JSON.parse(buffer);
        this.peerBuffers.set(connection, '');
        this.handleMessage(message, connection);
      } catch (err) {
        this.peerBuffers.set(connection, buffer);
      }
      return;
    }

    const lines = buffer.split('\n');
    const remainder = lines.pop();
    this.peerBuffers.set(connection, remainder);

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message, connection);
      } catch (err) {
        console.error('Error processing P2P message:', err);
      }
    });
  }

  handleMessage(message, fromConnection) {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'chat') {
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }

      this.messages.push(message);
      
      if (this.messages.length > 100) {
        this.messages.shift();
      }

      this.peers.forEach(peer => {
        if (peer !== fromConnection) {
          this.sendToPeer(peer, message);
        }
      });

      this.socketClients.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('message', message);
        }
      });
      return;
    }

    if (typeof message.type === 'string' && message.type.startsWith('chess/')) {
      this.handleChessFromPeer(message, fromConnection);
    }
  }

  sendToPeer(connection, message) {
    try {
      connection.write(`${JSON.stringify(message)}\n`);
    } catch (err) {
      console.error('Error sending message to peer:', err);
    }
  }

  addSocketClient(socketId) {
    this.socketClients.add(socketId);
    setTimeout(() => this.broadcastUserCount(), 100);
  }

  removeSocketClient(socketId) {
    this.socketClients.delete(socketId);
    setTimeout(() => this.broadcastUserCount(), 100);
  }

  addChessClient(ws) {
    this.chessClients.add(ws);
  }

  removeChessClient(ws) {
    this.chessClients.delete(ws);
  }

  sendMessage(message) {
    const chatMessage = {
      type: 'chat',
      username: message.username,
      text: message.text,
      timestamp: Date.now()
    };

    this.handleMessage(chatMessage, null);
  }

  getUserCount() {
    return this.socketClients.size + this.peers.size;
  }

  broadcastUserCount() {
    const userCount = this.getUserCount();
    this.socketClients.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('user-count', { count: userCount });
      }
    });
  }

  registerGameId(gameId) {
    if (!gameId) return;
    if (!this.gameId) {
      this.gameId = gameId;
    }
  }

  shouldAcceptChessSeq(seq) {
    if (typeof seq !== 'number' || Number.isNaN(seq)) {
      return true;
    }
    if (seq <= this.chessSeq) {
      return false;
    }
    this.chessSeq = seq;
    return true;
  }

  updateChessState(message) {
    if (typeof message.seq === 'number' && !Number.isNaN(message.seq)) {
      this.chessSeq = message.seq;
    }
    if (message.fen) {
      this.chessState = {
        fen: message.fen,
        seq: this.chessSeq
      };
    }
  }

  sendChessStateToPeer(connection) {
    if (!connection || !this.chessState) return;
    const payload = {
      type: 'chess/state',
      gameId: this.gameId || undefined,
      seq: this.chessState.seq,
      fen: this.chessState.fen
    };
    this.sendToPeer(connection, payload);
  }

  sendChessStateToSocket(ws) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.chessState) return;
    const payload = {
      type: 'chess/state',
      gameId: this.gameId || undefined,
      seq: this.chessState.seq,
      fen: this.chessState.fen
    };
    ws.send(JSON.stringify(payload));
  }

  broadcastChessMessage(message, fromConnection, fromSocket) {
    this.peers.forEach(peer => {
      if (peer !== fromConnection) {
        this.sendToPeer(peer, message);
      }
    });

    this.chessClients.forEach(ws => {
      if (ws !== fromSocket && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  handleChessFromPeer(message, fromConnection) {
    this.registerGameId(message.gameId);

    if (message.type === 'chess/hello') {
      this.sendChessStateToPeer(fromConnection);
      return;
    }

    if (message.type === 'chess/state-req') {
      this.sendChessStateToPeer(fromConnection);
      return;
    }

    if (!this.shouldAcceptChessSeq(message.seq)) {
      return;
    }

    if (message.type === 'chess/state' || message.type === 'chess/move') {
      this.updateChessState(message);
      this.broadcastChessMessage(message, fromConnection, null);
    }
  }

  handleChessFromSocket(message, ws) {
    this.registerGameId(message.gameId);

    if (message.type === 'chess/state-req') {
      this.sendChessStateToSocket(ws);
      return;
    }

    if (!this.shouldAcceptChessSeq(message.seq)) {
      return;
    }

    if (message.type === 'chess/state' || message.type === 'chess/move') {
      this.updateChessState(message);
      this.broadcastChessMessage(message, null, ws);
    }
  }

  destroy() {
    try {
      this.swarm.destroy();
    } catch (err) {
      console.error('Error destroying swarm:', err);
    }
    this.chessClients.clear();
    this.peerBuffers.clear();
  }
}

server.on('upgrade', (request, socket, head) => {
  let pathname = '';
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    pathname = url.pathname;
  } catch (err) {
    pathname = request.url;
  }

  if (pathname !== '/ws') {
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

function sendWsError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chess/error', message }));
  }
}

function detachChessSocket(ws) {
  const roomKey = ws.roomKey;
  if (!roomKey || !activeRooms.has(roomKey)) return;

  const room = activeRooms.get(roomKey);
  room.removeChessClient(ws);

  if (room.socketClients.size === 0 && room.chessClients.size === 0) {
    setTimeout(() => {
      if (activeRooms.has(roomKey) &&
          activeRooms.get(roomKey).socketClients.size === 0 &&
          activeRooms.get(roomKey).chessClients.size === 0) {
        activeRooms.get(roomKey).destroy();
        activeRooms.delete(roomKey);
        console.log(`Room ${roomKey} removed due to inactivity`);
      }
    }, 300000);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      sendWsError(ws, 'Invalid JSON payload');
      return;
    }

    if (!message || typeof message.type !== 'string' || !message.type.startsWith('chess/')) {
      sendWsError(ws, 'Unsupported message type');
      return;
    }

    if (message.type === 'chess/hello') {
      const roomCode = typeof message.roomCode === 'string' ? message.roomCode.trim() : '';
      if (!roomCode) {
        sendWsError(ws, 'roomCode is required');
        return;
      }

      const roomKey = buildRoomKey(roomCode, '');

      if (ws.roomKey && ws.roomKey !== roomKey) {
        detachChessSocket(ws);
      }

      if (!activeRooms.has(roomKey)) {
        activeRooms.set(roomKey, new ChatRoom(roomCode, ''));
      }

      const room = activeRooms.get(roomKey);
      const gameId = message.gameId || `room:${roomCode}`;
      room.registerGameId(gameId);

      ws.roomKey = roomKey;
      room.addChessClient(ws);

      ws.send(JSON.stringify({
        type: 'chess/joined',
        gameId: room.gameId || gameId,
        roomCode
      }));

      room.sendChessStateToSocket(ws);
      return;
    }

    const roomKey = ws.roomKey;
    if (!roomKey || !activeRooms.has(roomKey)) {
      sendWsError(ws, 'Join a room first');
      return;
    }

    const room = activeRooms.get(roomKey);

    if (message.type === 'chess/state-req') {
      room.handleChessFromSocket(message, ws);
      return;
    }

    room.handleChessFromSocket(message, ws);
  });

  ws.on('close', () => {
    detachChessSocket(ws);
  });

  ws.on('error', () => {
    detachChessSocket(ws);
  });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (data) => {
    try {
      const { topic, secret, username } = data;
      
      if (!topic || !secret || !username) {
        socket.emit('error', 'Topic, secret, and username are required');
        return;
      }

      const roomKey = buildRoomKey(topic, secret);
      
      if (userSockets.has(socket.id)) {
        const oldRoom = userSockets.get(socket.id);
        if (activeRooms.has(oldRoom)) {
          /*   ╱|、      
              (˚ˎ 。7     
              |、˜〵     
              じしˍ,)ノ  
          */
          activeRooms.get(oldRoom).removeSocketClient(socket.id);
        }
      }

      if (!activeRooms.has(roomKey)) {
        activeRooms.set(roomKey, new ChatRoom(topic, secret));
      }

      const room = activeRooms.get(roomKey);
      room.addSocketClient(socket.id);
      userSockets.set(socket.id, roomKey);

      socket.emit('joined-room', { 
        topic, 
        messages: room.messages,
        userCount: room.getUserCount()
      });

      room.sendMessage({
        username: 'System',
        text: `${username} entered the room`,
      });

    } catch (err) {
      console.error('Error when joining room:', err);
      socket.emit('error', 'Internal server error');
    }
  });

  socket.on('send-message', (data) => {
    try {
      const roomKey = userSockets.get(socket.id);
      if (!roomKey || !activeRooms.has(roomKey)) {
        socket.emit('error', 'You are not in a room');
        return;
      }

      const room = activeRooms.get(roomKey);
      room.sendMessage(data);
    } catch (err) {
      console.error('Error sending message:', err);
      socket.emit('error', 'Error sending message');
    }
  });

  socket.on('disconnect', () => {
    try {
      console.log('Client Disconnected:', socket.id);
      
      const roomKey = userSockets.get(socket.id);
      if (roomKey && activeRooms.has(roomKey)) {
        const room = activeRooms.get(roomKey);
        room.removeSocketClient(socket.id);
        
        if (room.socketClients.size === 0) {
          setTimeout(() => {
            if (activeRooms.has(roomKey) &&
                activeRooms.get(roomKey).socketClients.size === 0 &&
                activeRooms.get(roomKey).chessClients.size === 0) {
              activeRooms.get(roomKey).destroy();
              activeRooms.delete(roomKey);
              console.log(`Room ${roomKey} removed due to inactivity`);
            }
          }, 300000);
        }
      }
      
      userSockets.delete(socket.id);
    } catch (err) {
      console.error('Error disconnecting a client:', err);
    }
  });

  socket.on('ping', () => {
    socket.emit('pong');
  });
});

setInterval(() => {
  activeRooms.forEach((room, key) => {
    if (room.socketClients.size === 0 && room.chessClients.size === 0 && room.peers.size === 0) {
      room.destroy();
      activeRooms.delete(key);
      console.log(`Room ${key} removed due to periodic cleanup`);
    }
  });
}, 600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Running @ ${PORT}`);
});
