const socket = io();
const $ = id => document.getElementById(id);
let mySeat = 0, myColor = 0, game = null, asking = '';
const query = new URLSearchParams(location.search);
const playerName = () => $('name').value.trim();
function savedSession() { try { return JSON.parse(localStorage.getItem('gomoku.session') || 'null'); } catch { return null; } }
function enter(result) {
  if (!result?.ok) { $('err').textContent = result?.error || '加入房间失败'; return; }
  mySeat = result.seat;
  localStorage.setItem('gomoku.session', JSON.stringify({ code: result.code, name: playerName(), seat: mySeat }));
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden'); $('code').textContent = result.code; render();
}
function requireName() { if (playerName()) return true; $('err').textContent = '请先输入你的名字。'; $('name').focus(); return false; }
$('create').onclick = () => { if (!requireName()) return; $('err').textContent = ''; socket.emit('create', { name: playerName() }, enter); };
$('join').onclick = () => { if (!requireName()) return; $('err').textContent = ''; socket.emit('join', { name: playerName(), code: $('codeIn').value }, enter); };
if (query.has('room')) $('codeIn').value = query.get('room');
$('conn').textContent = '前端已加载，正在连接服务器…';
socket.on('connect', () => {
  $('conn').textContent = '已连接';
  const saved = savedSession(), linkRoom = query.get('room');
  if (linkRoom) $('codeIn').value = linkRoom;
  if (!saved || (linkRoom && linkRoom.toUpperCase() !== saved.code.toUpperCase()) || mySeat) return;
  const code = linkRoom || saved.code; $('name').value = saved.name || '';
  const attemptJoin = attempt => socket.emit('join', { name: saved.name, code, seat: saved.seat }, result => {
    if (result.ok) return enter(result);
    if (result.error === '房间已满' && attempt < 5) return setTimeout(() => attemptJoin(attempt + 1), 700);
    localStorage.removeItem('gomoku.session'); $('err').textContent = '';
  });
  attemptJoin(0);
});
socket.on('disconnect', () => $('conn').textContent = '连接中断，正在重连…');
socket.on('connect_error', error => $('conn').textContent = '连接失败：' + error.message);
socket.on('state', state => { game = state; render(); });
function render() {
  if (!game) return;
  const own = game.players[mySeat - 1]; myColor = own?.color || 0;
  const board = $('board'); board.innerHTML = '';
  const lastMove = game.moves[game.moves.length - 1];
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    const cell = document.createElement('button'); cell.className = 'cell'; cell.disabled = game.phase !== 'playing' || game.turn !== myColor || game.status !== 'playing'; cell.onclick = () => socket.emit('move', { x, y });
    if (lastMove && lastMove.x === x && lastMove.y === y) { cell.classList.add('last'); cell.title = '最近落子'; }
    const color = game.board[y * 15 + x];
    if (color) { const stone = document.createElement('i'); stone.className = 'stone ' + (color === 1 ? 'black' : 'white'); cell.append(stone); }
    board.append(cell);
  }
  $('lastMove').textContent = lastMove ? `最近落子：${lastMove.color === 1 ? '黑棋' : '白棋'} · 第 ${lastMove.y + 1} 行，第 ${lastMove.x + 1} 列` : '尚无落子';
  game.players.forEach((player, index) => {
    const el = $('p' + (index + 1));
    el.textContent = `玩家 ${index + 1}：${player?.name || '等待加入'}${player ? (player.connected ? '' : '（暂时离线）') : ''}　🎲 ${game.dice[index] ?? '未掷'}${player?.color === 1 ? '　黑棋' : player?.color === 2 ? '　白棋' : ''}`;
  });
  $('roll').classList.toggle('hidden', game.phase !== 'rolling');
  $('roll').disabled = game.phase !== 'rolling' || game.players.some(p => !p?.connected) || game.dice[mySeat - 1] !== null;
  $('undo').classList.toggle('hidden', game.phase !== 'playing');
  $('turn').textContent = game.phase === 'playing' ? (game.status === 'playing' ? (game.turn === myColor ? '轮到你' : '等待对方') : (game.status === 'draw' ? '平局' : (game.winner === myColor ? '你赢了' : '你输了'))) : '';
  if (game.phase === 'rolling') {
    const bothHere = game.players.every(p => p?.connected);
    $('status').textContent = !bothHere ? '等待另一位玩家加入' : game.rollMessage || (game.dice[mySeat - 1] !== null ? `你掷出 ${game.dice[mySeat - 1]} 点，等待对方` : '请掷骰，点数大者执黑先手');
  } else $('status').textContent = $('turn').textContent;
  $('hint').textContent = game.undo ? (game.undo === myColor ? '悔棋请求已发送，等待回应' : '对方请求悔棋') : '';
  if (game.undo && game.undo !== myColor) ask('undo', '对方请求悔棋', '是否撤销最近一步？');
}
$('roll').onclick = () => socket.emit('roll');
function ask(kind, title, body) { if (asking === kind) return; asking = kind; $('dt').textContent = title; $('db').textContent = body; $('dlg').showModal(); }
function reply(accept) { if (asking === 'undo') socket.emit('undo:reply', accept); else if (asking === 'restart') socket.emit('restart:reply', accept); asking = ''; $('dlg').close(); }
$('yes').onclick = () => reply(true); $('no').onclick = () => reply(false);
$('undo').onclick = () => socket.emit('undo:req'); $('restart').onclick = () => socket.emit('restart:req');
socket.on('restart:ask', seat => { if (seat !== mySeat) ask('restart', '对方请求重新开局', '同意后将重新掷骰决定黑棋。'); });
$('resign').onclick = () => { if (confirm('确定认输吗？')) socket.emit('resign'); };
$('copy').onclick = async () => {
  try {
    let link;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1') {
      const response = await fetch('/api/addresses'), ips = await response.json(), host = ips[0] || location.hostname;
      link = `http://${host}:${location.port || 3000}/?room=${game.code}`;
    } else link = `${location.origin}/?room=${game.code}`;
    await navigator.clipboard.writeText(link); $('hint').textContent = '已复制邀请链接：' + link;
  } catch { $('hint').textContent = '复制失败，请检查浏览器剪贴板权限。'; }
};
