const socket = io();
const $ = id => document.getElementById(id);
let mySeat = 0, myColor = 0, game = null, asking = '', selectedSquare = null;
const names={gomoku:'五子棋',xiangqi:'中国象棋',chess:'国际象棋',go:'围棋',checkers:'跳棋（英式）','chinese-checkers':'中国跳棋'};
const query = new URLSearchParams(location.search);
const playerName = () => $('name').value.trim();
function savedSession() { try { return JSON.parse(localStorage.getItem('gomoku.session') || 'null'); } catch { return null; } }
function enter(result) {
  if (!result?.ok) { $('err').textContent = result?.error || '加入房间失败'; return; }
  mySeat = result.seat;
  localStorage.setItem('gomoku.session', JSON.stringify({ code: result.code, name: playerName(), seat: mySeat }));
  $('lobby').classList.add('hidden'); $('game').classList.remove('hidden'); $('code').textContent = result.code; render();
}
function chineseCheckersMoves(g,side,fromKey=null){
 const dirs=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]],spots=new Map(g.meta.spots.map(p=>[p.key,p])),forced=g.meta.forcedFrom,out=[];
 for(const p of g.meta.spots){const from=p.key;if(forced&&from!==forced)continue;if(fromKey&&from!==fromKey)continue;if(g.board[from]!==side)continue;
  for(const [dq,dr] of dirs){const step=`${p.q+dq},${p.r+dr}`,mid=step,to=`${p.q+2*dq},${p.r+2*dr}`;if(!forced&&spots.has(step)&&!g.board[step])out.push({from:{q:p.q,r:p.r},to:{q:p.q+dq,r:p.r+dr},jump:false});if(spots.has(mid)&&g.board[mid]&&spots.has(to)&&!g.board[to])out.push({from:{q:p.q,r:p.r},to:{q:p.q+2*dq,r:p.r+2*dr},jump:true});}
 }return out;
}
function renderChineseCheckersBoard(g,side){
 const board=$('board');board.innerHTML='';const viewSide=side===2?2:1,camp=g.meta.camps[viewSide===1?0:3],byKey=new Map(g.meta.spots.map(p=>[p.key,p]));let centerX=0,centerY=0;for(const key of camp){const p=byKey.get(key);centerX+=p.q+p.r/2;centerY+=p.r*Math.sqrt(3)/2;}centerX/=camp.length;centerY/=camp.length;const angle=Math.PI/2-Math.atan2(centerY,centerX),cos=Math.cos(angle),sin=Math.sin(angle),points=g.meta.spots.map(p=>({...p,rx:(p.q+p.r/2)*cos-(p.r*Math.sqrt(3)/2)*sin,ry:(p.q+p.r/2)*sin+(p.r*Math.sqrt(3)/2)*cos})),minX=Math.min(...points.map(p=>p.rx)),maxX=Math.max(...points.map(p=>p.rx)),minY=Math.min(...points.map(p=>p.ry)),maxY=Math.max(...points.map(p=>p.ry));board.style.aspectRatio=`${maxX-minX}/${maxY-minY}`;const forced=g.meta.forcedFrom,selected=forced?forced:(selectedSquare?`${selectedSquare.q},${selectedSquare.r}`:null),moves=side&&g.turn===side&&g.phase==='playing'?chineseCheckersMoves(g,side,selected):[];
 for(const p of points){const cell=document.createElement('button');cell.type='button';cell.className='cc-hole'+(p.homeSide===1?' camp-red':p.homeSide===2?' camp-black':'');cell.style.left=`${4+(p.rx-minX)/(maxX-minX)*92}%`;cell.style.top=`${4+(p.ry-minY)/(maxY-minY)*92}%`;cell.title=`${p.q}, ${p.r}`;const piece=g.board[p.key]||0;if(piece){cell.classList.add(piece===1?'occupied-red':'occupied-black');const marble=document.createElement('i');marble.className='cc-marble '+(piece===1?'red':'black');cell.append(marble);}const target=moves.find(m=>m.to.q===p.q&&m.to.r===p.r);if(target)cell.classList.add('cc-target');if(selected===p.key)cell.classList.add('cc-selected');cell.disabled=g.phase!=='playing'||g.turn!==side;
  cell.onclick=()=>{if(target){socket.emit('board:move',{from:target.from,to:target.to});selectedSquare=null;return;}if(forced)return;if(piece===side){selectedSquare={q:p.q,r:p.r};renderChineseCheckersBoard(g,side);}else if(selectedSquare){selectedSquare=null;renderChineseCheckersBoard(g,side);}};board.append(cell);
 }
}
function requireName() { if (playerName()) return true; $('err').textContent = '请先输入你的名字。'; $('name').focus(); return false; }
$('create').onclick = () => { if (!requireName()) return; $('err').textContent = ''; socket.emit('create', { name: playerName(), gameType: $('gameType').value }, enter); };
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
socket.on('state', state => { game = state; selectedSquare = null; render(); });
$('pass').onclick=()=>socket.emit('board:move',{pass:true});
$('endTurn').onclick=()=>socket.emit('board:endturn');
function render() {
 if(!game)return;const type=game.gameType||'gomoku',own=game.players[mySeat-1];myColor=own?.color||0;$('pageTitle').textContent=names[type]||'棋类合集';const board=$('board');board.innerHTML='';board.className='board';board.style.removeProperty('aspect-ratio');const dims={gomoku:[15,15],go:[19,19],chess:[8,8],checkers:[8,8],xiangqi:[9,10],'chinese-checkers':[0,0]},[w,h]=dims[type]||dims.gomoku;if(type==='chinese-checkers'){board.className='ccboard';renderChineseCheckersBoard(game,myColor);}else if(type!=='gomoku'){board.classList.add('otherboard',type);board.style.setProperty('--cols',w);}if(type==='xiangqi'){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('xq-lines');svg.setAttribute('viewBox','0 0 9 10');svg.setAttribute('preserveAspectRatio','none');let d='';for(let y=0;y<10;y++)d+=`M.5 ${y+.5}H8.5 `;for(let x=0;x<9;x++){const px=x+.5;d+=x===0||x===8?`M${px} .5V9.5 `:`M${px} .5V4.5 M${px} 5.5V9.5 `;}d+='M3.5 .5L5.5 2.5 M5.5 .5L3.5 2.5 M3.5 7.5L5.5 9.5 M5.5 7.5L3.5 9.5';svg.innerHTML=`<path d="${d}"/>`;board.append(svg);}
 const last=game.moves.at(-1),xi={1:{R:'車',H:'馬',E:'相',A:'仕',K:'帥',C:'炮',S:'兵'},2:{R:'車',H:'馬',E:'象',A:'士',K:'將',C:'砲',S:'卒'}},symbols={1:{K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'},2:{K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟'}};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const cell=document.createElement('button');cell.className='cell';if(selectedSquare?.x===x&&selectedSquare?.y===y)cell.classList.add('selected');const v=game.board[y*w+x];cell.disabled=game.phase!=='playing'||game.turn!==myColor||game.status!=='playing';if(type==='gomoku'||type==='go'){if(last&&((last.x===x&&last.y===y)||(last.to?.x===x&&last.to?.y===y)))cell.classList.add('last');if(v){const i=document.createElement('i');i.className='stone '+(v===1?'black':'white');cell.append(i);}}else if(v){const i=document.createElement('span');i.className='piece '+(v.side===1?(type==='xiangqi'?'red':'w'):'b');i.textContent=type==='chess'?symbols[v.side][v.kind]:type==='xiangqi'?xi[v.side][v.kind]:(v.kind==='k'?'♛':'●');cell.append(i);}
 cell.onclick=()=>{if(type==='gomoku')return socket.emit('move',{x,y});if(type==='go')return !v&&socket.emit('board:move',{x,y});if(selectedSquare){if(selectedSquare.x===x&&selectedSquare.y===y){selectedSquare=null;cell.classList.remove('selected');return;}socket.emit('board:move',{from:selectedSquare,to:{x,y}});selectedSquare=null;}else if(v?.side===myColor){selectedSquare={x,y};cell.classList.add('selected');}};board.append(cell);}
 $('lastMove').textContent=last?(last.pass?'最近落子：停一手':type==='chinese-checkers'?'最近移动了一枚棋子':`最近落子：第 ${(last.to?.y??last.y)+1} 行，第 ${(last.to?.x??last.x)+1} 列`):'尚无落子';const notice=$('gameNotice');if(game.phase==='finished'){notice.classList.remove('hidden','draw','left');if(game.status==='draw'){notice.textContent='平局！';notice.classList.add('draw');}else if(game.status==='left'){notice.textContent='对方已离开房间，本局结束。';notice.classList.add('left');}else{const win=game.players.find(p=>p?.color===game.winner);notice.textContent=(win?.name||'获胜方')+' 获胜！'+(game.result?' '+game.result:'');}}else{notice.classList.add('hidden');notice.textContent='';}
 game.players.forEach((p,i)=>{$('p'+(i+1)).textContent=`玩家 ${i+1}：${p?.name||'等待加入'}${p?(p.connected?'':'（暂时离线）'):''}　🎲 ${game.dice[i]??'未掷'}${p?.color===1?'　先手方':p?.color===2?'　后手方':''}`;});const bot=!game.players[1]&&['gomoku','xiangqi','chinese-checkers'].includes(type);$('botDifficulty').classList.toggle('hidden',!bot);$('botJoin').classList.toggle('hidden',!bot);$('roll').classList.toggle('hidden',game.phase!=='rolling');$('roll').disabled=game.phase!=='rolling'||game.players.some(p=>!p?.connected)||game.dice[mySeat-1]!==null;$('pass').classList.toggle('hidden',type!=='go'||game.phase!=='playing');$('endTurn').classList.toggle('hidden',type!=='chinese-checkers'||game.phase!=='playing'||game.turn!==myColor||!game.meta.forcedFrom);$('undo').classList.toggle('hidden',game.phase!=='playing');const botOpponent=game.players.some(player=>player?.bot);$('undo').textContent=botOpponent?'悔掉我的上一步':'请求悔棋';$('undo').disabled=botOpponent&&!game.moves.some(move=>move.color===myColor);$('undo').title=botOpponent?'撤回你自己的上一回合；若机器人已回应，也会一起撤回。':'';$('turn').textContent=game.phase==='playing'?(game.status==='playing'?(game.turn===myColor?'轮到你':'等待对方'):(game.status==='draw'?'平局':game.winner===myColor?'你赢了':'你输了')):'';$('status').textContent=game.phase==='rolling'?(!game.players.every(p=>p?.connected)?'等待另一位玩家加入':game.rollMessage||(game.dice[mySeat-1]!==null?`你掷出 ${game.dice[mySeat-1]} 点，等待对方`:'请掷骰决定先后手')):game.status==='left'?'对方已离开房间':$('turn').textContent;$('hint').textContent=game.undo?(game.undo===myColor?'悔棋请求已发送，等待回应':'对方请求悔棋'):'';if(game.undo&&game.undo!==myColor)ask('undo','对方请求悔棋','是否撤销最近一步？');
}$('botJoin').onclick = () => socket.timeout(3000).emit('bot:join', $('botDifficulty').value, (error, result) => {
  if (error) $('hint').textContent = '服务器未响应机器人邀请，请关闭旧服务器窗口并重新启动。';
  else if (!result?.ok) $('hint').textContent = result.error;
});
$('roll').onclick = () => socket.emit('roll');
function ask(kind, title, body) { if (asking === kind) return; asking = kind; $('dt').textContent = title; $('db').textContent = body; $('dlg').showModal(); }
function reply(accept) { if (asking === 'undo') socket.emit('undo:reply', accept); else if (asking === 'restart') socket.emit('restart:reply', accept); asking = ''; $('dlg').close(); }
$('yes').onclick = () => reply(true); $('no').onclick = () => reply(false);
$('undo').onclick = () => socket.emit('undo:req'); $('restart').onclick = () => socket.emit('restart:req');
socket.on('restart:ask', seat => { if (seat !== mySeat) ask('restart', '对方请求重新开局', '同意后将重新掷骰决定黑棋。'); });
$('resign').onclick = () => { if (confirm('确定认输吗？')) socket.emit('resign'); };
$('leave').onclick = () => {
  if (!confirm('确定退出房间吗？退出后当前棋局将结束。')) return;
  socket.emit('leave', () => {
    localStorage.removeItem('gomoku.session'); mySeat = 0; myColor = 0; game = null; asking = '';
    if ($('dlg').open) $('dlg').close();
    $('game').classList.add('hidden'); $('lobby').classList.remove('hidden'); $('codeIn').value = '';
    $('pageTitle').textContent = '棋类合集'; $('code').textContent = ''; $('status').textContent = ''; $('turn').textContent = '';
    $('board').innerHTML = ''; $('board').className = 'board'; $('board').style.removeProperty('--cols');
    $('lastMove').textContent = '尚无落子'; $('hint').textContent = ''; $('gameNotice').className = 'game-notice hidden'; $('gameNotice').textContent = '';
    $('p1').textContent = '玩家 1：等待加入'; $('p2').textContent = '玩家 2：等待加入';
    history.replaceState(null, '', location.pathname); $('err').textContent = '';
  });
};$('copy').onclick = async () => {
  try {
    let link;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1') {
      const response = await fetch('/api/addresses'), ips = await response.json(), host = ips[0] || location.hostname;
      link = `http://${host}:${location.port || 3000}/?room=${game.code}`;
    } else link = `${location.origin}/?room=${game.code}`;
    await navigator.clipboard.writeText(link); $('hint').textContent = '已复制邀请链接：' + link;
  } catch { $('hint').textContent = '复制失败，请检查浏览器剪贴板权限。'; }
};

$('feedbackOpen').onclick = () => { $('feedbackStatus').textContent = ''; $('feedbackDialog').showModal(); };
$('feedbackClose').onclick = () => $('feedbackDialog').close();
$('feedbackSend').onclick = async () => {
  const message = $('feedbackMessage').value.trim();
  if (message.length < 3) { $('feedbackStatus').textContent = '请写至少 3 个字。'; return; }
  $('feedbackSend').disabled = true; $('feedbackStatus').textContent = '正在发送…';
  try {
    const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: $('feedbackCategory').value, message, contact: $('feedbackContact').value.trim(), website: $('feedbackWebsite').value }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '发送失败，请稍后再试。');
    $('feedbackStatus').textContent = '感谢反馈，已成功发送！'; $('feedbackMessage').value = ''; $('feedbackContact').value = '';
  } catch (error) { $('feedbackStatus').textContent = error.message || '发送失败，请稍后再试。'; }
  finally { $('feedbackSend').disabled = false; }
};
