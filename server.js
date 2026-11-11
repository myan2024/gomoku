const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomInt } = require('crypto');
const { Server } = require('socket.io');

const games = new Map();
const SIZE = 15;
const freshGame = () => ({ board: Array(SIZE * SIZE).fill(0), moves: [], turn: 1, phase: 'rolling', status: 'playing', winner: 0, dice: [null, null], rollMessage: '', undo: null, restartSeat: null });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/addresses') {
    const ips = Object.values(os.networkInterfaces()).flat().filter(v => v && !v.internal && v.family === 'IPv4').map(v => v.address);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(ips));
    return;
  }
  const file = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(data);
  });
});
const io = new Server(server);
function snapshot(room) {
  return { code: room.code, players: room.players.map(p => p && { name: p.name, color: p.color, seat: p.seat, connected: !!p.id }), ...room.game };
}
function emitState(room) { io.to(room.code).emit('state', snapshot(room)); }
function winAt(board, x, y, color) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let xx = x + dx * sign, yy = y + dy * sign;
      while (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE && board[yy * SIZE + xx] === color) { count++; xx += dx * sign; yy += dy * sign; }
    }
    if (count >= 5) return true;
  }
  return false;
}
function setColor(room, player, color) {
  player.color = color;
  const client = player.id && io.sockets.sockets.get(player.id);
  if (client) client.data.color = color;
}
function startDiceRound(room) { room.players.forEach(player => player && setColor(room, player, 0)); room.game = freshGame(); }

io.on('connection', socket => {
  socket.on('create', (data, done) => {
    let code;
    do { code = randomInt(0, 36 ** 5).toString(36).toUpperCase().padStart(5, '0'); } while (games.has(code));
    const room = { code, players: [{ id: socket.id, name: String(data.name || '').trim().slice(0, 20), seat: 1, color: 0 }, null], game: freshGame(), expiry: null };
    games.set(code, room);
    socket.join(code); socket.data = { code, seat: 1, color: 0 };
    done?.({ ok: true, code, seat: 1 }); emitState(room);
  });
  socket.on('join', (data, done) => {
    const room = games.get(String(data.code || '').trim().toUpperCase());
    if (!room) return done?.({ ok: false, error: '房间不存在' });
    if (room.expiry) { clearTimeout(room.expiry); room.expiry = null; }
    let index = Number(data.seat) === 1 || Number(data.seat) === 2 ? Number(data.seat) - 1 : -1;
    if (index >= 0 && (!room.players[index] || room.players[index].id)) index = -1;
    if (index < 0) index = room.players.findIndex(player => !player);
    if (index < 0) return done?.({ ok: false, error: '房间已满' });
    const seat = index + 1;
    room.players[index] = { id: socket.id, name: String(data.name || '').trim().slice(0, 20), seat, color: room.players[index]?.color || 0 };
    socket.join(room.code); socket.data = { code: room.code, seat, color: room.players[index].color };
    done?.({ ok: true, code: room.code, seat }); emitState(room);
  });
  socket.on('roll', () => {
    const room = games.get(socket.data.code), seat = socket.data.seat;
    if (!room || room.game.phase !== 'rolling' || !room.players[0]?.id || !room.players[1]?.id || room.game.dice[seat - 1] !== null) return;
    room.game.dice[seat - 1] = randomInt(1, 7);
    room.game.rollMessage = '';
    if (room.game.dice.every(value => value !== null)) {
      if (room.game.dice[0] === room.game.dice[1]) {
        room.game.dice = [null, null];
        room.game.rollMessage = '平局，请双方重新掷骰。';
      } else {
        const blackSeat = room.game.dice[0] > room.game.dice[1] ? 1 : 2;
        setColor(room, room.players[blackSeat - 1], 1);
        setColor(room, room.players[2 - blackSeat], 2);
        room.game.phase = 'playing';
        room.game.turn = 1;
      }
    }
    emitState(room);
  });
  socket.on('move', ({ x, y }) => {
    const room = games.get(socket.data.code), color = socket.data.color;
    if (!room || room.game.phase !== 'playing' || room.game.status !== 'playing' || room.game.turn !== color || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= SIZE || y < 0 || y >= SIZE || room.game.board[y * SIZE + x]) return;
    room.game.board[y * SIZE + x] = color; room.game.moves.push({ x, y, color });
    if (winAt(room.game.board, x, y, color)) { room.game.status = 'won'; room.game.phase = 'finished'; room.game.winner = color; }
    else if (room.game.moves.length === SIZE * SIZE) { room.game.status = 'draw'; room.game.phase = 'finished'; }
    else room.game.turn = 3 - color;
    room.game.undo = null; emitState(room);
  });
  socket.on('undo:req', () => {
    const room = games.get(socket.data.code);
    if (room && room.game.phase === 'playing' && room.game.moves.length) { room.game.undo = socket.data.color; emitState(room); }
  });
  socket.on('undo:reply', accept => {
    const room = games.get(socket.data.code);
    if (!room || room.game.undo !== 3 - socket.data.color) return;
    if (accept) { const move = room.game.moves.pop(); room.game.board[move.y * SIZE + move.x] = 0; room.game.turn = move.color; }
    room.game.undo = null; emitState(room);
  });
  socket.on('restart:req', () => {
    const room = games.get(socket.data.code);
    if (room && room.players[0]?.id && room.players[1]?.id) { room.game.restartSeat = socket.data.seat; io.to(room.code).emit('restart:ask', socket.data.seat); }
  });
  socket.on('restart:reply', accept => {
    const room = games.get(socket.data.code);
    if (!room || room.game.restartSeat === null || room.game.restartSeat === socket.data.seat) return;
    if (accept) startDiceRound(room); else room.game.restartSeat = null;
    emitState(room);
  });
  socket.on('resign', () => {
    const room = games.get(socket.data.code), color = socket.data.color;
    if (room && room.game.phase === 'playing' && room.game.status === 'playing') { room.game.status = 'won'; room.game.phase = 'finished'; room.game.winner = 3 - color; emitState(room); }
  });
  socket.on('disconnect', () => {
    const room = games.get(socket.data.code);
    if (!room) return;
    const player = room.players.find(p => p && p.id === socket.id);
    if (player) player.id = null;
    emitState(room);
    if (!room.players.some(p => p && p.id)) room.expiry = setTimeout(() => { if (!room.players.some(p => p && p.id)) games.delete(room.code); }, 30 * 60 * 1000);
  });
});
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Gomoku: http://localhost:${port}`));
