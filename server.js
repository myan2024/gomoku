const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomInt } = require('crypto');
const { Server } = require('socket.io');

const games = new Map(), SIZE = 15;
const difficulties = { easy: '简单', medium: '中等', master: '大师' };
const freshGame = () => ({ board: Array(SIZE * SIZE).fill(0), moves: [], turn: 1, phase: 'rolling', status: 'playing', winner: 0, dice: [null, null], rollMessage: '', undo: null, restartSeat: null });
const feedbackRate = new Map();
function sendJson(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function handleFeedback(req, res) {
  let raw = '';
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 6000) return sendJson(res, 413, { ok: false, error: '反馈内容太长。' });
    }
    const data = JSON.parse(raw || '{}');
    if (String(data.website || '').trim()) return sendJson(res, 200, { ok: true });
    const message = String(data.message || '').trim();
    if (message.length < 3 || message.length > 2000) return sendJson(res, 400, { ok: false, error: '请填写 3 到 2000 个字的建议。' });
    const categories = { bug: '问题反馈', idea: '功能建议', other: '其他' };
    const category = categories[data.category] || categories.other;
    const contact = String(data.contact || '').trim().slice(0, 254);
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now(), recent = (feedbackRate.get(ip) || []).filter(time => now - time < 10 * 60 * 1000);
    if (recent.length >= 5) return sendJson(res, 429, { ok: false, error: '提交太频繁，请稍后再试。' });
    recent.push(now); feedbackRate.set(ip, recent);
    const apiKey = process.env.RESEND_API_KEY, to = process.env.FEEDBACK_TO_EMAIL, from = process.env.FEEDBACK_FROM_EMAIL;
    if (!apiKey || !to || !from) return sendJson(res, 503, { ok: false, error: '反馈邮件尚未配置。' });
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `[五子棋反馈] ${category}`, text: `${category}\n\n${message}${contact ? `\n\n回信联系：${contact}` : ''}\n\n时间：${new Date().toISOString()}` })
    });
    if (!response.ok) { console.error('Feedback email service returned', response.status); return sendJson(res, 502, { ok: false, error: '邮件发送失败，请稍后重试。' }); }
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { ok: false, error: '提交内容格式不正确。' });
    console.error('Feedback submission failed:', error.message);
    return sendJson(res, 500, { ok: false, error: '提交失败，请稍后重试。' });
  }
}
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/feedback') {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return handleFeedback(req, res);
  }
  if (pathname === '/api/addresses') {
    const ips = Object.values(os.networkInterfaces()).flat().filter(v => v && !v.internal && v.family === 'IPv4').map(v => v.address);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(ips)); return;
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
function snapshot(room) { return { code: room.code, players: room.players.map(p => p && { name: p.name, color: p.color, seat: p.seat, connected: !!p.bot || !!p.id, bot: !!p.bot }), botDifficulty: room.botDifficulty || null, ...room.game }; }
function emitState(room) { io.to(room.code).emit('state', snapshot(room)); }
function winAt(board, x, y, color) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) { let xx = x + dx * sign, yy = y + dy * sign; while (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE && board[yy * SIZE + xx] === color) { count++; xx += dx * sign; yy += dy * sign; } }
    if (count >= 5) return true;
  }
  return false;
}
function setColor(room, player, color) { player.color = color; const client = player.id && io.sockets.sockets.get(player.id); if (client) client.data.color = color; }
function startDiceRound(room) { room.players.forEach(player => player && setColor(room, player, 0)); room.game = freshGame(); }
function finishMove(room, x, y, color) {
  const g = room.game; g.board[y * SIZE + x] = color; g.moves.push({ x, y, color });
  if (winAt(g.board, x, y, color)) { g.status = 'won'; g.phase = 'finished'; g.winner = color; }
  else if (g.moves.length === SIZE * SIZE) { g.status = 'draw'; g.phase = 'finished'; }
  else g.turn = 3 - color;
  g.undo = null; emitState(room);
  if (g.phase === 'playing' && room.players.some(p => p?.bot && p.color === g.turn)) scheduleBot(room);
}
function candidateMoves(board) {
  const points = [];
  if (!board.some(Boolean)) return [{ x: 7, y: 7 }];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (board[y * SIZE + x]) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE && board[yy * SIZE + xx]) { near = true; break; }
    }
    if (near) points.push({ x, y });
  }
  return points;
}
function immediateWins(board, color, points = candidateMoves(board)) {
  const wins = [];
  for (const p of points) { const i = p.y * SIZE + p.x; board[i] = color; const win = winAt(board, p.x, p.y, color); board[i] = 0; if (win) wins.push(p); }
  return wins;
}
function lineValue(count, open) {
  if (count >= 5) return 1e8;
  if (count === 4) return open === 2 ? 1e6 : 3e4;
  if (count === 3) return open === 2 ? 1.5e4 : 1.5e3;
  if (count === 2) return open === 2 ? 450 : 80;
  return open === 2 ? 12 : 2;
}
function pointValue(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]; let total = 0;
  for (const [dx, dy] of dirs) {
    let count = 1, open = 0;
    for (const sign of [-1, 1]) {
      let xx = x + dx * sign, yy = y + dy * sign;
      while (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE && board[yy * SIZE + xx] === color) { count++; xx += dx * sign; yy += dy * sign; }
      if (xx >= 0 && xx < SIZE && yy >= 0 && yy < SIZE && board[yy * SIZE + xx] === 0) open++;
    }
    total += lineValue(count, open);
  }
  return total;
}
function chooseBotMove(room) {
  const board = room.game.board, color = room.players.find(p => p?.bot).color, opponent = 3 - color;
  let points = candidateMoves(board);
  if (!points.length) return { x: 7, y: 7 };
  const wins = immediateWins(board, color, points); if (wins.length) return wins[0];
  const blocks = immediateWins(board, opponent, points); if (blocks.length) return blocks[0];
  if (room.botDifficulty === 'easy') return points[randomInt(points.length)];
  let scored = points.map(p => {
    const i = p.y * SIZE + p.x; board[i] = color;
    const attack = pointValue(board, p.x, p.y, color), defense = pointValue(board, p.x, p.y, opponent);
    let score = attack + defense * (room.botDifficulty === 'master' ? 1.08 : 0.92);
    if (room.botDifficulty === 'master') {
      const danger = immediateWins(board, opponent).length;
      const forks = immediateWins(board, color).length;
      if (danger) score -= 2e6 * danger;
      score += Math.min(forks, 3) * 7e5;
    }
    score += (7 - Math.abs(7 - p.x) + 7 - Math.abs(7 - p.y)) * 0.1;
    board[i] = 0; return { ...p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  if (room.botDifficulty === 'medium') return scored[0];
  const top = scored.slice(0, Math.min(12, scored.length));
  return top[randomInt(Math.max(1, Math.min(3, top.length)))];
}
function scheduleBot(room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  const delay = room.botDifficulty === 'easy' ? 550 : room.botDifficulty === 'master' ? 1100 : 800;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.game.phase !== 'playing' || room.game.status !== 'playing') return;
    const bot = room.players.find(p => p?.bot);
    if (!bot || room.game.turn !== bot.color) return;
    const move = chooseBotMove(room); finishMove(room, move.x, move.y, bot.color);
  }, delay);
}
function afterRoll(room) {
  if (!room.game.dice.every(value => value !== null)) return;
  if (room.game.dice[0] === room.game.dice[1]) { room.game.dice = [null, null]; room.game.rollMessage = '平局，请双方重新掷骰。'; return; }
  const blackSeat = room.game.dice[0] > room.game.dice[1] ? 1 : 2;
  setColor(room, room.players[blackSeat - 1], 1); setColor(room, room.players[2 - blackSeat], 2);
  room.game.phase = 'playing'; room.game.turn = 1;
  if (room.players.some(p => p?.bot && p.color === 1)) scheduleBot(room);
}
function completeUndo(room, accept) {
  if (accept) { const move = room.game.moves.pop(); room.game.board[move.y * SIZE + move.x] = 0; room.game.turn = move.color; }
  room.game.undo = null; emitState(room);
  if (room.game.phase === 'playing' && room.players.some(p => p?.bot && p.color === room.game.turn)) scheduleBot(room);
}

io.on('connection', socket => {
  socket.on('create', (data, done) => {
    let code; do { code = randomInt(0, 36 ** 5).toString(36).toUpperCase().padStart(5, '0'); } while (games.has(code));
    const room = { code, players: [{ id: socket.id, name: String(data.name || '').trim().slice(0, 20), seat: 1, color: 0, bot: false }, null], game: freshGame(), botDifficulty: null, expiry: null, botTimer: null };
    games.set(code, room); socket.join(code); socket.data = { code, seat: 1, color: 0 };
    done?.({ ok: true, code, seat: 1 }); emitState(room);
  });
  socket.on('join', (data, done) => {
    const room = games.get(String(data.code || '').trim().toUpperCase());
    if (!room) return done?.({ ok: false, error: '房间不存在' });
    if (room.expiry) { clearTimeout(room.expiry); room.expiry = null; }
    let index = Number(data.seat) === 1 || Number(data.seat) === 2 ? Number(data.seat) - 1 : -1;
    if (index >= 0 && (!room.players[index] || room.players[index].id || room.players[index].bot)) index = -1;
    if (index < 0) index = room.players.findIndex(player => !player);
    if (index < 0) return done?.({ ok: false, error: '房间已满' });
    const seat = index + 1;
    room.players[index] = { id: socket.id, name: String(data.name || '').trim().slice(0, 20), seat, color: room.players[index]?.color || 0, bot: false };
    socket.join(room.code); socket.data = { code: room.code, seat, color: room.players[index].color };
    done?.({ ok: true, code: room.code, seat }); emitState(room);
  });
  socket.on('bot:join', (difficulty, done) => {
    const room = games.get(socket.data.code);
    if (!room || socket.data.seat !== 1) return done?.({ ok: false, error: '请先创建一个房间。' });
    if (room.players[1]) return done?.({ ok: false, error: '对手位置已被占用。' });
    if (!difficulties[difficulty]) return done?.({ ok: false, error: '机器人难度无效。' });
    room.players[1] = { id: null, name: `机器人（${difficulties[difficulty]}）`, seat: 2, color: 0, bot: true };
    room.botDifficulty = difficulty;
    if (room.expiry) { clearTimeout(room.expiry); room.expiry = null; }
    done?.({ ok: true });
    emitState(room);
  });  socket.on('roll', () => {
    const room = games.get(socket.data.code), seat = socket.data.seat;
    if (!room || room.game.phase !== 'rolling' || !room.players[0] || !room.players[1] || room.game.dice[seat - 1] !== null) return;
    room.game.dice[seat - 1] = randomInt(1, 7);
    const bot = room.players.find(p => p?.bot);
    if (bot) room.game.dice[bot.seat - 1] = randomInt(1, 7);
    room.game.rollMessage = ''; afterRoll(room); emitState(room);
  });
  socket.on('move', ({ x, y }) => {
    const room = games.get(socket.data.code), color = socket.data.color;
    if (!room || room.game.phase !== 'playing' || room.game.status !== 'playing' || room.game.turn !== color || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= SIZE || y < 0 || y >= SIZE || room.game.board[y * SIZE + x]) return;
    finishMove(room, x, y, color);
  });
  socket.on('undo:req', () => {
    const room = games.get(socket.data.code);
    if (!room || room.game.phase !== 'playing' || !room.game.moves.length) return;
    room.game.undo = socket.data.color;
    if (room.players.some(p => p?.bot && p.color !== socket.data.color)) completeUndo(room, true); else emitState(room);
  });
  socket.on('undo:reply', accept => {
    const room = games.get(socket.data.code);
    if (!room || room.game.undo !== 3 - socket.data.color) return;
    completeUndo(room, !!accept);
  });
  socket.on('restart:req', () => {
    const room = games.get(socket.data.code);
    if (!room || !room.players[0] || !room.players[1]) return;
    if (room.players.some(p => p?.bot)) { startDiceRound(room); emitState(room); return; }
    room.game.restartSeat = socket.data.seat; io.to(room.code).emit('restart:ask', socket.data.seat);
  });
  socket.on('restart:reply', accept => {
    const room = games.get(socket.data.code);
    if (!room || room.game.restartSeat === null || room.game.restartSeat === socket.data.seat) return;
    if (accept) startDiceRound(room); else room.game.restartSeat = null;
    emitState(room);
  });
  socket.on('leave', done => {
    const room = games.get(socket.data.code), seat = socket.data.seat;
    if (!room || !seat) return done?.({ ok: true });
    const player = room.players[seat - 1];
    if (player && player.id === socket.id) room.players[seat - 1] = null;
    if (room.game.phase !== 'finished' && room.players.some(p => p && !p.bot && p.id)) {
      room.game.phase = 'finished'; room.game.status = 'left'; room.game.winner = 0; room.game.undo = null; room.game.restartSeat = null;
      if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
    }
    emitState(room); socket.leave(room.code); socket.data = {};
    if (!room.players.some(p => p && !p.bot && p.id)) room.expiry = setTimeout(() => { if (!room.players.some(p => p && !p.bot && p.id)) games.delete(room.code); }, 30 * 60 * 1000);
    done?.({ ok: true });
  });  socket.on('resign', () => {
    const room = games.get(socket.data.code), color = socket.data.color;
    if (room && room.game.phase === 'playing' && room.game.status === 'playing') { room.game.status = 'won'; room.game.phase = 'finished'; room.game.winner = 3 - color; emitState(room); }
  });
  socket.on('disconnect', () => {
    const room = games.get(socket.data.code); if (!room) return;
    const player = room.players.find(p => p && p.id === socket.id); if (player) player.id = null;
    emitState(room);
    if (!room.players.some(p => p && !p.bot && p.id)) room.expiry = setTimeout(() => { if (!room.players.some(p => p && !p.bot && p.id)) games.delete(room.code); }, 30 * 60 * 1000);
  });
});
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Gomoku: http://localhost:${port}`));
