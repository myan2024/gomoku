const { randomInt } = require('crypto');
const TYPES = new Set(['xiangqi', 'chess', 'go', 'checkers', 'chinese-checkers']);
const at = (x, y, w) => y * w + x;
const inside = (x, y, w, h) => x >= 0 && x < w && y >= 0 && y < h;
const piece = (side, kind) => ({ side, kind });
const blank = (w, h) => Array(w * h).fill(null);
const base = (board, meta = {}) => ({ board, meta, moves: [], turn: 1, phase: 'rolling', status: 'playing', winner: 0, dice: [null, null], rollMessage: '', undo: null, restartSeat: null });

function createBoard(type) {
  if(type==='chinese-checkers'){
    const center=[];for(let q=-4;q<=4;q++)for(let r=-4;r<=4;r++)if(Math.abs(q+r)<=4)center.push({q,r});
    const camps=[];let arm=[];for(let t=1;t<=4;t++)for(let j=0;j<t;j++)arm.push({q:9-t,r:-4+j});
    for(let rotation=0;rotation<6;rotation++){let camp=arm.map(p=>({...p}));for(let i=0;i<rotation;i++)camp=camp.map(p=>({q:-p.r,r:p.q+p.r}));camps.push(camp);}
    const all=new Map();for(const p of center)all.set(`${p.q},${p.r}`,{...p,homeSide:0});for(let c=0;c<camps.length;c++)for(const p of camps[c])all.set(`${p.q},${p.r}`,{...p,homeSide:c===0?1:c===3?2:0});
    const raw=[...all.values()],xs=raw.map(p=>p.q+p.r/2),ys=raw.map(p=>p.r*Math.sqrt(3)/2),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const spots=raw.map(p=>({...p,key:`${p.q},${p.r}`,px:(p.q+p.r/2-minX)/(maxX-minX),py:(p.r*Math.sqrt(3)/2-minY)/(maxY-minY)}));
    const board=Object.fromEntries(spots.map(p=>[p.key,0]));for(const p of camps[0])board[`${p.q},${p.r}`]=1;for(const p of camps[3])board[`${p.q},${p.r}`]=2;
    const g=base(board,{spots,camps:camps.map(c=>c.map(p=>`${p.q},${p.r}`)),forcedFrom:null,hopCount:0,hopVisited:[]});g.type=type;return g;
  }
  if (type === 'chess') {
    const b = blank(8, 8), back = ['R','N','B','Q','K','B','N','R'];
    for (let x=0;x<8;x++) { b[at(x,0,8)] = piece(2,back[x]); b[at(x,1,8)] = piece(2,'P'); b[at(x,6,8)] = piece(1,'P'); b[at(x,7,8)] = piece(1,back[x]); }
    const g=base(b,{castling:{wK:true,wQ:true,bK:true,bQ:true},enPassant:null,halfmove:0});g.type=type;return g;
  }
  if (type === 'xiangqi') {
    const b=blank(9,10), back=['R','H','E','A','K','A','E','H','R'];
    for(let x=0;x<9;x++){b[at(x,0,9)]=piece(2,back[x]);b[at(x,9,9)]=piece(1,back[x]);}
    for(const x of [1,7]){b[at(x,2,9)]=piece(2,'C');b[at(x,7,9)]=piece(1,'C');}
    for(const x of [0,2,4,6,8]){b[at(x,3,9)]=piece(2,'S');b[at(x,6,9)]=piece(1,'S');}
    const g=base(b,{captures:[0,0,0]});g.type=type;return g;
  }
  if (type === 'go') {const g=base(Array(19*19).fill(0),{captures:[0,0,0],passCount:0,seen:['0'.repeat(19*19)],komi:6.5});g.type=type;return g;}
  if (type === 'checkers') {
    const b=blank(8,8);
    for(let y=0;y<3;y++)for(let x=0;x<8;x++)if((x+y)%2===1)b[at(x,y,8)]=piece(2,'m');
    for(let y=5;y<8;y++)for(let x=0;x<8;x++)if((x+y)%2===1)b[at(x,y,8)]=piece(1,'m');
    const g=base(b,{forcedFrom:null});g.type=type;return g;
  }
  return null;
}
function cloneBoard(board){return board.map(p=>p&&({...p}));}
function pathClear(board,from,to,w){const dx=Math.sign(to.x-from.x),dy=Math.sign(to.y-from.y);let x=from.x+dx,y=from.y+dy;while(x!==to.x||y!==to.y){if(board[at(x,y,w)])return false;x+=dx;y+=dy;}return true;}

// International chess
function chessPseudo(b,meta,x,y,side,attacksOnly=false){
  const out=[],p=b[at(x,y,8)];if(!p||p.side!==side)return out;
  const add=(tx,ty)=>{if(!inside(tx,ty,8,8))return false;const target=b[at(tx,ty,8)];if(target?.side===side)return false;if(!attacksOnly&&target?.kind==='K')return false;out.push({from:{x,y},to:{x:tx,y:ty}});return !target;};
  if(p.kind==='P'){
    const d=side===1?-1:1,home=side===1?6:1;
    if(attacksOnly){for(const dx of [-1,1]){const tx=x+dx,ty=y+d;if(inside(tx,ty,8,8))out.push({from:{x,y},to:{x:tx,y:ty}})}return out;}
    if(inside(x,y+d,8,8)&&!b[at(x,y+d,8)]){add(x,y+d);if(y===home&&!b[at(x,y+2*d,8)])add(x,y+2*d)}
    for(const dx of [-1,1]){const tx=x+dx,ty=y+d;if(!inside(tx,ty,8,8))continue;const target=b[at(tx,ty,8)];if((target&&target.side!==side&&target.kind!=='K')||(meta.enPassant&&meta.enPassant.x===tx&&meta.enPassant.y===ty))out.push({from:{x,y},to:{x:tx,y:ty},enPassant:!target});}return out;
  }
  if(p.kind==='N'){for(const [dx,dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]])add(x+dx,y+dy);return out;}
  if(p.kind==='K'){
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)add(x+dx,y+dy);
    if(!attacksOnly&&y===(side===1?7:0)&&x===4&&!chessCheck(b,side)){
      const rank=y,pre=side===1?'w':'b';
      if(meta.castling[pre+'K']&&!b[at(5,rank,8)]&&!b[at(6,rank,8)]&&b[at(7,rank,8)]?.kind==='R'&&b[at(7,rank,8)]?.side===side&&!chessAttacked(b,5,rank,3-side)&&!chessAttacked(b,6,rank,3-side))out.push({from:{x,y},to:{x:6,y:rank},castle:'K'});
      if(meta.castling[pre+'Q']&&!b[at(1,rank,8)]&&!b[at(2,rank,8)]&&!b[at(3,rank,8)]&&b[at(0,rank,8)]?.kind==='R'&&b[at(0,rank,8)]?.side===side&&!chessAttacked(b,3,rank,3-side)&&!chessAttacked(b,2,rank,3-side))out.push({from:{x,y},to:{x:2,y:rank},castle:'Q'});
    }return out;
  }
  const dirs=[];if(['B','Q'].includes(p.kind))dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);if(['R','Q'].includes(p.kind))dirs.push([1,0],[-1,0],[0,1],[0,-1]);
  for(const [dx,dy] of dirs){let tx=x+dx,ty=y+dy;while(inside(tx,ty,8,8)){if(!add(tx,ty))break;tx+=dx;ty+=dy;}}
  return out;
}
function chessAttacked(b,x,y,by){for(let sy=0;sy<8;sy++)for(let sx=0;sx<8;sx++)if(b[at(sx,sy,8)]?.side===by&&chessPseudo(b,{},sx,sy,by,true).some(m=>m.to.x===x&&m.to.y===y))return true;return false;}
function chessCheck(b,side){let k=-1;for(let i=0;i<64;i++)if(b[i]?.side===side&&b[i].kind==='K'){k=i;break;}return k<0||chessAttacked(b,k%8,Math.floor(k/8),3-side);}
function chessApply(b,meta,m,side){const moving=b[at(m.from.x,m.from.y,8)],target=b[at(m.to.x,m.to.y,8)];b[at(m.from.x,m.from.y,8)]=null;b[at(m.to.x,m.to.y,8)]=moving;
  if(m.enPassant)b[at(m.to.x,m.to.y+(side===1?1:-1),8)]=null;
  if(m.castle){const y=m.from.y,rx=m.castle==='K'?7:0,tx=m.castle==='K'?5:3; b[at(tx,y,8)]=b[at(rx,y,8)];b[at(rx,y,8)]=null;}
  if(moving.kind==='P'&&(m.to.y===0||m.to.y===7))b[at(m.to.x,m.to.y,8)]=piece(side,['Q','R','B','N'].includes(m.promotion)?m.promotion:'Q');
  const pref=side===1?'w':'b';if(moving.kind==='K'){meta.castling[pref+'K']=false;meta.castling[pref+'Q']=false;}if(moving.kind==='R'){if(m.from.x===0)meta.castling[pref+'Q']=false;if(m.from.x===7)meta.castling[pref+'K']=false;}
  if(target?.kind==='R'){const tp=target.side===1?'w':'b';if(m.to.x===0)meta.castling[tp+'Q']=false;if(m.to.x===7)meta.castling[tp+'K']=false;}
  meta.enPassant=null;if(moving.kind==='P'&&Math.abs(m.to.y-m.from.y)===2)meta.enPassant={x:m.from.x,y:(m.from.y+m.to.y)/2};meta.halfmove=(moving.kind==='P'||target)?0:(meta.halfmove||0)+1;
}
function chessLegal(b,meta,side){const result=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(b[at(x,y,8)]?.side===side){for(const m of chessPseudo(b,meta,x,y,side)){const cp=cloneBoard(b),mm=structuredClone(meta);chessApply(cp,mm,m,side);if(!chessCheck(cp,side))result.push(m);}}return result;}

// Chinese chess
function xiangqiPseudo(b,x,y,side){const out=[],p=b[at(x,y,9)];if(!p||p.side!==side)return out;const add=(tx,ty)=>{if(!inside(tx,ty,9,10)||b[at(tx,ty,9)]?.side===side)return false;out.push({from:{x,y},to:{x:tx,y:ty}});return !b[at(tx,ty,9)];};
  if(p.kind==='R'||p.kind==='C'){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){let tx=x+dx,ty=y+dy,screens=0;while(inside(tx,ty,9,10)){const q=b[at(tx,ty,9)];if(p.kind==='R'){if(q){if(q.side!==side)out.push({from:{x,y},to:{x:tx,y:ty}});break;}out.push({from:{x,y},to:{x:tx,y:ty}});}else{if(!screens){if(!q)out.push({from:{x,y},to:{x:tx,y:ty}});else screens=1;}else if(q){if(q.side!==side)out.push({from:{x,y},to:{x:tx,y:ty}});break;}}tx+=dx;ty+=dy;}}return out;}
  if(p.kind==='H'){for(const [dx,dy,legx,legy] of [[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1],[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0]])if(inside(x+legx,y+legy,9,10)&&!b[at(x+legx,y+legy,9)])add(x+dx,y+dy);return out;}
  if(p.kind==='E'){for(const [dx,dy] of [[2,2],[2,-2],[-2,2],[-2,-2]]){const ty=y+dy;if((side===1&&ty<5)||(side===2&&ty>4))continue;if(!b[at(x+dx/2,y+dy/2,9)])add(x+dx,ty);}return out;}
  if(p.kind==='A'){for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){const tx=x+dx,ty=y+dy;if(tx>=3&&tx<=5&&((side===1&&ty>=7)||(side===2&&ty<=2)))add(tx,ty);}return out;}
  if(p.kind==='K'){for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const tx=x+dx,ty=y+dy;if(tx>=3&&tx<=5&&((side===1&&ty>=7)||(side===2&&ty<=2)))add(tx,ty);}let ty=y+(side===1?-1:1);while(inside(x,ty,9,10)){const q=b[at(x,ty,9)];if(q){if(q.side!==side&&q.kind==='K')out.push({from:{x,y},to:{x,y:ty}});break;}ty+=side===1?-1:1;}return out;}
  if(p.kind==='S'){const d=side===1?-1:1;add(x,y+d);const crossed=side===1?y<=4:y>=5;if(crossed){add(x-1,y);add(x+1,y);}return out;}return out;
}
function xiCheck(b,side){let k=-1;for(let i=0;i<b.length;i++)if(b[i]?.side===side&&b[i].kind==='K'){k=i;break;}if(k<0)return true;const x=k%9,y=Math.floor(k/9),opp=3-side;for(let i=0;i<b.length;i++)if(b[i]?.side===opp)if(xiangqiPseudo(b,i%9,Math.floor(i/9),opp).some(m=>m.to.x===x&&m.to.y===y))return true;return false;}
function xiLegal(b,side){const out=[];for(let i=0;i<b.length;i++)if(b[i]?.side===side)for(const m of xiangqiPseudo(b,i%9,Math.floor(i/9),side)){const cp=cloneBoard(b);cp[at(m.to.x,m.to.y,9)]=cp[at(m.from.x,m.from.y,9)];cp[at(m.from.x,m.from.y,9)]=null;if(!xiCheck(cp,side))out.push(m);}return out;}

// Go
function goGroup(b,x,y){const w=19,start=at(x,y,w),color=b[start],stack=[start],seen=new Set([start]),stones=[],libs=new Set();while(stack.length){const i=stack.pop(),cx=i%w,cy=Math.floor(i/w);stones.push(i);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;if(!inside(nx,ny,w,w))continue;const ni=at(nx,ny,w);if(!b[ni])libs.add(ni);else if(b[ni]===color&&!seen.has(ni)){seen.add(ni);stack.push(ni);}}}return {stones,libs};}
function scoreGo(game){const b=game.board,w=19,score=[0,0,0],seen=new Set();for(let i=0;i<b.length;i++)if(b[i])score[b[i]]++;for(let i=0;i<b.length;i++)if(!b[i]&&!seen.has(i)){const stack=[i],area=[],borders=new Set();seen.add(i);while(stack.length){const j=stack.pop(),x=j%w,y=Math.floor(j/w);area.push(j);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(!inside(nx,ny,w,w))continue;const ni=at(nx,ny,w);if(!b[ni]&&!seen.has(ni)){seen.add(ni);stack.push(ni);}else if(b[ni])borders.add(b[ni]);}}if(borders.size===1)score[[...borders][0]]+=area.length;}score[1]+=game.meta.captures[1];score[2]+=game.meta.captures[2]+game.meta.komi;return score;}

// English/American checkers
function checkerMoves(b,side,forcedFrom=null){const jumps=[],normal=[],froms=forcedFrom?[forcedFrom]:Array.from({length:64},(_,i)=>({x:i%8,y:Math.floor(i/8)}));for(const {x,y} of froms){const p=b[at(x,y,8)];if(!p||p.side!==side)continue;const dirs=p.kind==='k'?[-1,1]:[side===1?-1:1];for(const dy of dirs)for(const dx of [-1,1]){const tx=x+dx,ty=y+dy;if(!inside(tx,ty,8,8))continue;if(!b[at(tx,ty,8)]){if(!forcedFrom)normal.push({from:{x,y},to:{x:tx,y:ty}});}else if(b[at(tx,ty,8)].side!==side){const jx=x+dx*2,jy=y+dy*2;if(inside(jx,jy,8,8)&&!b[at(jx,jy,8)])jumps.push({from:{x,y},to:{x:jx,y:jy},capture:{x:tx,y:ty}});}}}return jumps.length?jumps:normal;}
function chineseCheckerMoves(game,side){
  const dirs=[[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]],spots=new Set(game.meta.spots.map(p=>p.key)),forced=game.meta.forcedFrom,visited=new Set(game.meta.hopVisited||[]),out=[];
  for(const spot of game.meta.spots){const from=spot.key;if(forced&&from!==forced)continue;if(game.board[from]!==side)continue;
    for(const [dq,dr] of dirs){const mid=`${spot.q+dq},${spot.r+dr}`,to=`${spot.q+2*dq},${spot.r+2*dr}`;
      if(!forced){const step=`${spot.q+dq},${spot.r+dr}`;if(spots.has(step)&&!game.board[step])out.push({from:{q:spot.q,r:spot.r},to:{q:spot.q+dq,r:spot.r+dr},jump:false});}
      if(spots.has(mid)&&game.board[mid]&&spots.has(to)&&!game.board[to]&&(!forced||!visited.has(to)))out.push({from:{q:spot.q,r:spot.r},to:{q:spot.q+2*dq,r:spot.r+2*dr},jump:true});
    }
  }return out;
}
function legalMoves(game,side){if(game.type==='chess')return chessLegal(game.board,game.meta,side);if(game.type==='xiangqi')return xiLegal(game.board,side);if(game.type==='checkers')return checkerMoves(game.board,side,game.meta.forcedFrom);if(game.type==='chinese-checkers')return chineseCheckerMoves(game,side);return [];}
function applyBoardMove(game,move,side,detectEnd=true,assumeLegal=false){
  if(game.type==='chinese-checkers'){
    const m=chineseCheckerMoves(game,side).find(a=>a.from.q===move.from?.q&&a.from.r===move.from?.r&&a.to.q===move.to?.q&&a.to.r===move.to?.r);if(!m)return {ok:false};
    const from=`${m.from.q},${m.from.r}`,to=`${m.to.q},${m.to.r}`;game.board[from]=0;game.board[to]=side;
    const target=new Set(game.meta.camps[side===1?3:0]),pieces=Object.entries(game.board).filter(([,owner])=>owner===side);if(pieces.length&&pieces.every(([key])=>target.has(key)))return {ok:true,winner:side};
    if(m.jump){if(!game.meta.forcedFrom)game.meta.hopVisited=[from];game.meta.hopVisited.push(to);game.meta.hopCount=(game.meta.hopCount||0)+1;if(game.meta.hopCount>=20){game.meta.forcedFrom=null;game.meta.hopCount=0;game.meta.hopVisited=[];return {ok:true};}game.meta.forcedFrom=to;if(chineseCheckerMoves(game,side).some(next=>next.jump))return {ok:true,keepTurn:true};}
    game.meta.forcedFrom=null;game.meta.hopCount=0;game.meta.hopVisited=[];return {ok:true};
  }
  if(game.type==='chess'){
    const legal=chessLegal(game.board,game.meta,side),m=legal.find(a=>a.from.x===move.from?.x&&a.from.y===move.from?.y&&a.to.x===move.to?.x&&a.to.y===move.to?.y);if(!m)return {ok:false};chessApply(game.board,game.meta,m,side);const enemy=3-side,answers=chessLegal(game.board,game.meta,enemy);if(!answers.length){if(chessCheck(game.board,enemy))return {ok:true,winner:side};return {ok:true,draw:true};}return {ok:true};
  }
  if(game.type==='xiangqi'){
    const m=assumeLegal?move:xiLegal(game.board,side).find(a=>a.from.x===move.from?.x&&a.from.y===move.from?.y&&a.to.x===move.to?.x&&a.to.y===move.to?.y);if(!m)return {ok:false};game.board[at(m.to.x,m.to.y,9)]=game.board[at(m.from.x,m.from.y,9)];game.board[at(m.from.x,m.from.y,9)]=null;const enemy=3-side;if(!game.board.some(p=>p?.side===enemy&&p.kind==='K'))return {ok:true,winner:side};if(detectEnd&&!xiLegal(game.board,enemy).length)return {ok:true,winner:side};return {ok:true};
  }
  if(game.type==='checkers'){
    const m=checkerMoves(game.board,side,game.meta.forcedFrom).find(a=>a.from.x===move.from?.x&&a.from.y===move.from?.y&&a.to.x===move.to?.x&&a.to.y===move.to?.y);if(!m)return {ok:false};const p=game.board[at(m.from.x,m.from.y,8)];game.board[at(m.from.x,m.from.y,8)]=null;game.board[at(m.to.x,m.to.y,8)]=p;if(m.capture){game.board[at(m.capture.x,m.capture.y,8)]=null;game.meta.captures[side]++;}if((side===1&&m.to.y===0)||(side===2&&m.to.y===7))p.kind='k';const nextJumps=m.capture?checkerMoves(game.board,side,m.to):[];if(nextJumps.length){game.meta.forcedFrom=m.to;return {ok:true,keepTurn:true};}game.meta.forcedFrom=null;if(!checkerMoves(game.board,3-side).length)return {ok:true,winner:side};return {ok:true};
  }
  if(game.type==='go'){
  if(move.pass){game.meta.passCount++;if(game.meta.passCount>=2){const score=scoreGo(game),diff=score[1]-score[2];return {ok:true,draw:diff===0,winner:diff===0?0:diff>0?1:2,score};}return {ok:true};}
    const {x,y}=move;if(!inside(x,y,19,19)||game.board[at(x,y,19)]!==0)return {ok:false};const original=game.board.slice(),i=at(x,y,19);game.board[i]=side;let captured=0;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(!inside(nx,ny,19,19))continue;const ni=at(nx,ny,19);if(game.board[ni]===3-side){const group=goGroup(game.board,nx,ny);if(!group.libs.size){for(const stone of group.stones)game.board[stone]=0;captured+=group.stones.length;}}}const own=goGroup(game.board,x,y);if(!own.libs.size){game.board=original;return {ok:false,reason:'不能下在没有气的位置'};}const key=game.board.join('');if(game.meta.seen.includes(key)){game.board=original;return {ok:false,reason:'重复局面不允许（劫争）'};}game.meta.captures[side]+=captured;game.meta.seen.push(key);game.meta.passCount=0;return {ok:true};
  }
  return {ok:false};
}
const XIANGQI_VALUE={K:100000,R:900,C:480,H:420,E:210,A:210,S:100};
function xiangqiEval(game,side){let score=0;for(let i=0;i<game.board.length;i++){const p=game.board[i];if(!p)continue;const x=i%9,y=Math.floor(i/9),advance=p.side===1?9-y:y;let value=XIANGQI_VALUE[p.kind]||0;if(p.kind==='S')value+=advance*12+(advance>=5?35:0);if(p.kind==='H'||p.kind==='C')value+=(4-Math.abs(4-x))*4;score+=(p.side===side?1:-1)*value;}return score;}
function chooseXiangqiMove(game,side,difficulty='medium'){
  const moves=legalMoves(game,side);if(!moves.length)return null;
  if(difficulty==='easy')return moves[randomInt(moves.length)];
  const depth=difficulty==='master'?3:2,mate=1000000;
  function search(position,toMove,remaining,alpha,beta,ply){
    if(remaining===0)return xiangqiEval(position,side);
    const options=legalMoves(position,toMove);if(!options.length)return toMove===side?-mate+ply:mate-ply;
    options.sort((a,b)=>{const av=position.board[at(a.to.x,a.to.y,9)],bv=position.board[at(b.to.x,b.to.y,9)];return (bv?XIANGQI_VALUE[bv.kind]||0:0)-(av?XIANGQI_VALUE[av.kind]||0:0);});
    const maximizing=toMove===side;let best=maximizing?-Infinity:Infinity;
    for(const move of options){const next=structuredClone(position),result=applyBoardMove(next,move,toMove,false,true);if(!result.ok)continue;let value;if(result.winner)value=result.winner===side?mate-ply-1:-mate+ply+1;else value=search(next,3-toMove,remaining-1,alpha,beta,ply+1);if(maximizing){best=Math.max(best,value);alpha=Math.max(alpha,best);}else{best=Math.min(best,value);beta=Math.min(beta,best);}if(beta<=alpha)break;}
    return best===Infinity||best===-Infinity?xiangqiEval(position,side):best;
  }
  let best=-Infinity,choices=[];for(const move of moves){const next=structuredClone(game),result=applyBoardMove(next,move,side,false,true);let score=result.winner===side?mate:search(next,3-side,depth-1,-Infinity,Infinity,1);if(score>best){best=score;choices=[move];}else if(score===best)choices.push(move);}return choices[randomInt(choices.length)];
}
function chineseCheckersDistance(game,side){
  const pieces=Object.entries(game.board).filter(([,owner])=>owner===side).map(([key])=>key.split(',').map(Number)),targets=game.meta.camps[side===1?3:0].map(key=>key.split(',').map(Number));if(!pieces.length)return 0;
  const n=targets.length,full=(1<<n)-1;let dp=new Array(1<<n).fill(Infinity);dp[0]=0;
  for(const [q,r] of pieces){const next=new Array(1<<n).fill(Infinity);for(let mask=0;mask<=full;mask++){if(!Number.isFinite(dp[mask]))continue;for(let j=0;j<n;j++)if(!(mask&(1<<j))){const [tq,tr]=targets[j],dq=q-tq,dr=r-tr,dist=Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr)),nm=mask|(1<<j);next[nm]=Math.min(next[nm],dp[mask]+dist);}}dp=next;}return dp[full];
}
function evaluateChineseCheckers(game,side){return chineseCheckersDistance(game,3-side)*0.15-chineseCheckersDistance(game,side);}
function chooseChineseCheckersMove(game,side,difficulty='medium'){
  const generated=chineseCheckerMoves(game,side);if(!generated.length)return null;if(game.meta.forcedFrom&&(game.meta.hopCount||0)>=5)return {endTurn:true};
  const previous=[...game.moves].reverse().find(m=>m.color===side&&m.from&&m.to&&Number.isInteger(m.from.q)&&Number.isInteger(m.to.q));
  const nonReverse=previous?generated.filter(m=>!(m.from.q===previous.to.q&&m.from.r===previous.to.r&&m.to.q===previous.from.q&&m.to.r===previous.from.r)):generated;
  const moves=nonReverse.length?nonReverse:generated,options=game.meta.forcedFrom?[...moves,{endTurn:true}]:moves;if(difficulty==='easy')return options[randomInt(options.length)];
  const opponent=3-side,terminal=100000,ranked=[];
  for(const move of options){const next=structuredClone(game);let keep=false;
    if(move.endTurn){next.meta.forcedFrom=null;next.turn=opponent;}else{const result=applyBoardMove(next,move,side);if(!result.ok)continue;if(result.winner)return move;keep=result.keepTurn;}
    ranked.push({move,next,keep,score:evaluateChineseCheckers(next,side)-(keep?0.25:0)});
  }
  if(difficulty==='master')ranked.sort((a,b)=>b.score-a.score);
  const candidates=difficulty==='master'?ranked.slice(0,6):ranked;let best=-Infinity,choices=[];
  for(const candidate of candidates){let score=candidate.score;
    if(difficulty==='master'&&!candidate.keep){const replies=chineseCheckerMoves(candidate.next,opponent);let worst=Infinity;for(const reply of replies){const after=structuredClone(candidate.next),response=applyBoardMove(after,reply,opponent);const value=response.winner===opponent?-terminal:evaluateChineseCheckers(after,side);worst=Math.min(worst,value);}if(replies.length)score=worst;}
    if(score>best){best=score;choices=[candidate.move];}else if(score===best)choices.push(candidate.move);
  }return choices.length?choices[randomInt(choices.length)]:options[0];
}
module.exports={TYPES,createBoard,applyBoardMove,legalMoves,scoreGo,chooseXiangqiMove,chooseChineseCheckersMove};
