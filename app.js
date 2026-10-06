'use strict';
const GAME_ID='kingdomino';
const GAME_NAME='KINGDOMINO';
const APP_VERSION='v0.1.18';
const WORKER_ORIGIN='https://kingdomino-online.naitoryo7110.workers.dev';
const COMMON_PLAYER_NAME_KEY='boardgamePlayerName';
const ROOM_IDS=['room1','room2','room3','room4'];
const NAME_DRAFT_KEY='kingdomino-name-draft';
const ACTIVE_ROOM_KEY=`${GAME_ID}-online-room`;
const ACTIVE_NAME_KEY=`${GAME_ID}-online-active-name`;
const TERRAINS={wheat:'小麦畑',forest:'森',water:'湖',grass:'草原',swamp:'沼地',mine:'鉱山'};
const TERRAIN_EMOJI={wheat:'🌾',forest:'🌲',water:'🌊',grass:'🌿',swamp:'🟫',mine:'⛰️'};
const TILES_RAW=`1,wheat,0,wheat,0
2,wheat,0,wheat,0
3,forest,0,forest,0
4,forest,0,forest,0
5,forest,0,forest,0
6,forest,0,forest,0
7,water,0,water,0
8,water,0,water,0
9,water,0,water,0
10,grass,0,grass,0
11,grass,0,grass,0
12,swamp,0,swamp,0
13,wheat,0,forest,0
14,wheat,0,water,0
15,wheat,0,grass,0
16,wheat,0,swamp,0
17,forest,0,water,0
18,forest,0,grass,0
19,wheat,1,forest,0
20,wheat,1,water,0
21,wheat,1,grass,0
22,wheat,1,swamp,0
23,wheat,1,mine,0
24,forest,1,wheat,0
25,forest,1,wheat,0
26,forest,1,wheat,0
27,forest,1,wheat,0
28,forest,1,water,0
29,forest,1,grass,0
30,water,1,wheat,0
31,water,1,wheat,0
32,water,1,forest,0
33,water,1,forest,0
34,water,1,forest,0
35,water,1,forest,0
36,wheat,0,grass,1
37,water,0,grass,1
38,wheat,0,swamp,1
39,grass,0,swamp,1
40,mine,1,wheat,0
41,wheat,0,grass,2
42,water,0,grass,2
43,wheat,0,swamp,2
44,grass,0,swamp,2
45,mine,2,wheat,0
46,swamp,0,mine,2
47,swamp,0,mine,2
48,wheat,0,mine,3`;
const ALL_TILES=TILES_RAW.split('\n').map(line=>{const [no,a,ac,b,bc]=line.split(',');return{no:+no,a:{terrain:a,crowns:+ac},b:{terrain:b,crowns:+bc}}});
let state=null,ws=null,currentRoomId=null,currentPlayerName='',token='',actionSeq=0,reconnectTimer=null,commonNameSavedForSession=null;
let selectedDir=0,selectedAnchor=null,viewPlayerId=null,lastPlacementKey=null;
let helpOpen=false,helpMode='rules';
let lastTurnPopupKey=null,turnPopupTimer=null;
const app=document.getElementById('app');
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function commonSavedName(){return String(localStorage.getItem(COMMON_PLAYER_NAME_KEY)||'').trim().slice(0,32)}
function saveCommonNameOnActualStart(name){name=String(name||'').trim().slice(0,32);if(name)localStorage.setItem(COMMON_PLAYER_NAME_KEY,name)}
function tokenKey(r){return `${GAME_ID}-online-token-${r}`}
function getToken(r){let t=localStorage.getItem(tokenKey(r));if(!t){t=crypto.randomUUID().replace(/-/g,'');localStorage.setItem(tokenKey(r),t)}return t}
function newActionId(p='op'){actionSeq=(actionSeq+1)%1e6;return [p,Date.now(),actionSeq,Math.random().toString(36).slice(2,8)].join('-')}
function roomStatusLabel(r){if(r.status==='playing')return'ゲーム中';if(r.status==='finished')return'終了';return'待機中'}
async function jfetch(url,opt){const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'通信に失敗しました。');return d}
async function loadRooms(){const settled=await Promise.allSettled(ROOM_IDS.map(r=>jfetch(`${WORKER_ORIGIN}/room-summary?roomId=${r}&_=${Date.now()}`,{cache:'no-store'})));renderTitle(settled)}

function helpButtons(){return `<button class='mini-btn' data-help-open='rules'>ルール</button><button class='mini-btn' data-help-open='terms'>用語</button><button class='mini-btn' data-help-open='tiles'>タイル一覧</button>`}
function helpOverlayHtml(){const title=helpMode==='rules'?'ルール':helpMode==='terms'?'用語':'タイル一覧';return `<div class='help-overlay ${helpOpen?'':'hidden'}' id='helpOverlay'><div class='panel help-card'><div class='help-head'><h2>${title}</h2><div class='topbar-actions'><button class='mini-btn ${helpMode==='rules'?'active':''}' data-help-tab='rules'>ルール</button><button class='mini-btn ${helpMode==='terms'?'active':''}' data-help-tab='terms'>用語</button><button class='mini-btn ${helpMode==='tiles'?'active':''}' data-help-tab='tiles'>タイル一覧</button><button class='mini-btn danger' id='helpClose'>閉じる</button></div></div><div class='help-body'>${helpMode==='rules'?rulesHtml():helpMode==='terms'?termsHtml():tilesHtml()}</div></div></div>`}
function rulesHtml(){return `<div class='help-section'><h3>ゲームの目的</h3><p>自分の王国を広げて、最後にいちばん高い点数を取るゲームです。</p></div><div class='help-section'><h3>ゲームの流れ</h3><ol><li><b>最初だけ</b>、現在のタイルから1枚選びます。</li><li>その後は自分の番になったら、<b>いま予約しているタイルを王国へ置く</b>→<b>次のタイルを1枚選ぶ</b>の順です。</li><li>全員が次のタイルを選び終わると、次のタイル列が現在のタイル列になります。</li><li>番号の小さいタイルを取った人ほど、次のラウンドで先に行動します。</li></ol></div><div class='help-section'><h3>タイルの置き方</h3><ul><li>タイルは2マス1組です。</li><li><b>どちらか片方</b>が、すでに置いてある<b>同じ地形</b>か<b>城</b>に上下左右で接していれば置けます。</li><li><b>斜め接続は無効</b>です。</li><li>盤面の太枠は<b>現在の5×5表示枠</b>です。王国の広がり方に応じて枠自体は移動します。</li><li>王国全体が<b>5×5以内</b>に収まる必要があります。2人戦の7×7設定では<b>7×7以内</b>です。</li><li>どうしても置けない時だけ、そのタイルは<b>破棄</b>します。</li><li><b>一度置いたタイルは移動・回転できません。</b></li></ul></div><div class='help-section'><h3>点数</h3><p><b>つながった同じ地形のマス数 × その領地にある王冠の数</b>です。</p><ul><li>例：森が5マスつながっていて、王冠が2個なら <b>5×2＝10点</b></li><li>王冠が0個の領地は、何マスあっても<b>0点</b></li></ul></div><div class='help-section'><h3>人数ごとの違い</h3><ul><li><b>2人通常戦</b>：各プレイヤーはキングを2個使い、48枚からランダムに24枚だけ使用します。最初の選択は、先手1枚→後手2枚→先手1枚です。</li><li><b>2人 マイティ・デュエル</b>：キング2個、48枚すべてを使い、王国は7×7です。</li><li><b>3人戦</b>：毎ラウンド4枚公開し、1枚は余って捨てられます。</li><li><b>4人戦</b>：毎ラウンド4枚すべて使います。</li></ul></div><div class='help-section'><h3>ボーナス</h3><ul><li><b>ハーモニー +5</b>：王国に穴がなく、きれいに完成していると+5点。</li><li><b>ミドルキングダム +10</b>：城が王国の中央にあると+10点。</li></ul></div>`}
function termsHtml(){return `<div class='help-section'><dl class='glossary'><dt>王国</dt><dd>自分が作っていく盤面全体のことです。</dd><dt>城</dt><dd>最初から持っているスタート地点です。どの地形とも接続できます。</dd><dt>タイル</dt><dd>2マスで1組の地形です。毎番1枚ずつ配置します。一度置いたタイルは動かせません。</dd><dt>地形</dt><dd>小麦畑・森・湖・草原・沼地・鉱山の6種類です。</dd><dt>領地</dt><dd>同じ地形が上下左右につながったひとかたまりです。</dd><dt>王冠</dt><dd>点数倍率です。領地の広さに掛け算されます。</dd><dt>現在のタイル</dt><dd>このラウンドで配置するタイル列です。ゲーム開始直後だけは、ここから最初の1枚を選びます。</dd><dt>次のタイル</dt><dd>このラウンドの後半で予約するタイル列です。次ラウンドに配置する対象になります。</dd><dt>予約</dt><dd>次のラウンドで自分が使うタイルを先に確保することです。</dd><dt>キング</dt><dd><b>欲しいタイルの上に置く予約コマ</b>です。『このタイルは自分が取る』という印になり、キングが置かれたタイル番号の小さい順に次の手番が来ます。2人戦では1人2個のキングを使うので、1人が毎ラウンド2枚のタイルを予約します。キング自体を王国の盤面へ置いたり動かしたりするものではありません。</dd><dt>ラウンド</dt><dd>全員が1回ずつ「置く→選ぶ」を終えるまでの一区切りです。</dd><dt>破棄</dt><dd>合法的に置ける場所が1つもない時、そのタイルを捨てることです。</dd><dt>5×5 / 7×7</dt><dd>王国全体が収まらないといけない最大サイズです。</dd><dt>CPU難易度</dt><dd>CPUの強さ設定です。かんたん / ふつう / つよい があります。</dd></dl></div>`}
function catalogTileHtml(t){return `<div class='catalog-domino'><span class='num'>#${t.no}</span><div class='catalog-halves'><div class='catalog-half ${t.a.terrain}'>${TERRAIN_EMOJI[t.a.terrain]}<span>${TERRAINS[t.a.terrain]}</span>${t.a.crowns?`<b>${'👑'.repeat(t.a.crowns)}</b>`:''}</div><div class='catalog-half ${t.b.terrain}'>${TERRAIN_EMOJI[t.b.terrain]}<span>${TERRAINS[t.b.terrain]}</span>${t.b.crowns?`<b>${'👑'.repeat(t.b.crowns)}</b>`:''}</div></div></div>`}
function tilesHtml(){return `<div class='help-section'><p>ゲームで使用する全48枚です。<b>番号が小さいタイルを予約したキングほど、次ラウンドで先に行動</b>します。</p><div class='tile-catalog'>${ALL_TILES.map(catalogTileHtml).join('')}</div></div>`}
function openHelp(mode){helpMode=mode||'rules';helpOpen=true;rerenderCurrent()}
function closeHelp(){helpOpen=false;rerenderCurrent()}
function bindHelpButtons(){app.querySelectorAll('[data-help-open]').forEach(b=>b.onclick=()=>openHelp(b.dataset.helpOpen));app.querySelectorAll('[data-help-tab]').forEach(b=>b.onclick=()=>openHelp(b.dataset.helpTab));const close=document.getElementById('helpClose');if(close)close.onclick=closeHelp;const overlay=document.getElementById('helpOverlay');if(overlay)overlay.onclick=e=>{if(e.target===overlay)closeHelp()}}
function rerenderCurrent(){if(!state){loadRooms();return}if(state.status==='lobby')renderLobby();else renderGame()}

function renderTitle(results){const draft=sessionStorage.getItem(NAME_DRAFT_KEY)??commonSavedName()??'';app.innerHTML=`<div class='wrap'><div class='top'><div class='title'>KINGDOMINO ONLINE</div><div class='topbar-actions'>${helpButtons()}<div class='ver'>${APP_VERSION}</div></div></div><div class='panel namebox'><div>プレイヤー名</div><input id='nameInput' maxlength='32' value='${esc(draft)}'><div class='actions'><button class='btn secondary' id='refreshRooms'>ROOM更新</button></div><div id='titleErr' class='error'></div></div><div class='room-grid'>${ROOM_IDS.map((rid,i)=>{const x=results?.[i];if(!x||x.status==='rejected')return `<article class='panel room-card'><div class='room-head'><b>ROOM ${i+1}</b><span class='error'>取得失敗</span></div><div class='muted'>ROOM情報を取得できません。</div><button data-room='${rid}'>参加する</button><button class='reset' data-reset='${rid}'>初期化</button></article>`;const r=x.value.room||x.value;const names=(r.players||[]).map(p=>p.name).join('、')||'なし';return `<article class='panel room-card'><div class='room-head'><b>ROOM ${i+1}</b><span>${roomStatusLabel(r)}</span></div><div>${r.count||0} / 4人</div><div class='muted'>参加者：${esc(names)}</div><button data-room='${rid}'>${r.reconnect?'再接続':'参加する'}</button><button class='reset' data-reset='${rid}'>初期化</button></article>`}).join('')}</div>${helpOverlayHtml()}</div>`;const ni=document.getElementById('nameInput');ni.addEventListener('input',e=>sessionStorage.setItem(NAME_DRAFT_KEY,e.target.value));document.getElementById('refreshRooms').onclick=loadRooms;app.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>joinRoom(b.dataset.room));app.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetRoom(b.dataset.reset));bindHelpButtons()}
async function resetRoom(rid){if(!confirm(`ROOM ${ROOM_IDS.indexOf(rid)+1} を初期化しますか？`))return;try{await jfetch(`${WORKER_ORIGIN}/reset-empty?roomId=${encodeURIComponent(rid)}`,{method:'POST',cache:'no-store'});await loadRooms()}catch(e){alert(e.message)}}
async function joinRoom(rid){const name=String(document.getElementById('nameInput')?.value||'').trim().slice(0,32);if(!name){document.getElementById('titleErr').textContent='プレイヤー名を入力してください。';return}const t=getToken(rid);try{await jfetch(`${WORKER_ORIGIN}/join-check?roomId=${encodeURIComponent(rid)}&name=${encodeURIComponent(name)}&token=${encodeURIComponent(t)}`,{cache:'no-store'});currentRoomId=rid;currentPlayerName=name;token=t;localStorage.setItem(ACTIVE_ROOM_KEY,rid);localStorage.setItem(ACTIVE_NAME_KEY,name);connectWs()}catch(e){document.getElementById('titleErr').textContent=e.message}}
function wsUrl(){return WORKER_ORIGIN.replace(/^http/,'ws')+`/ws?roomId=${encodeURIComponent(currentRoomId)}&name=${encodeURIComponent(currentPlayerName)}&token=${encodeURIComponent(token)}`}
function connectWs(){clearTimeout(reconnectTimer);try{ws=new WebSocket(wsUrl());ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='state'){state=m.state;onState() }else if(m.type==='error'){alert(m.error)}};ws.onclose=()=>{if(currentRoomId)scheduleReconnect()};ws.onerror=()=>ws.close()}catch{scheduleReconnect()}}
function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{if(currentRoomId)connectWs()},1300)}
function send(type,payload={}){if(ws?.readyState!==WebSocket.OPEN)return;ws.send(JSON.stringify({type,actionId:newActionId(type),...payload}))}
function me(){return state?.players?.find(p=>p.token===token)}
function isHost(){return me()?.id===state?.hostId}
function onState(){const placementKey=state?`${state.gameSessionId||''}:${state.activeTokenId||''}:${state.turnAction||''}:${state.round||0}`:null;if(lastPlacementKey!==placementKey){selectedAnchor=null;lastPlacementKey=placementKey}const incomingCpuKey=cpuStateKey();if(cpuPendingKey&&cpuPendingKey!==incomingCpuKey){cpuPendingKey=null;cpuBusy=false;clearTimeout(cpuTimer)}const m=me();if(state&&(state.status==='playing'||state.gameStarted)&&state.gameSessionId&&commonNameSavedForSession!==state.gameSessionId){saveCommonNameOnActualStart(currentPlayerName);commonNameSavedForSession=state.gameSessionId}if(!viewPlayerId&&m)viewPlayerId=m.id;if(state.status==='lobby')renderLobby();else renderGame();maybeShowTurnPopup();maybeRunCpu()}
function renderLobby(){const m=me();const host=isHost();app.innerHTML=`<div class='wrap'><div class='top'><div class='title'>KINGDOMINO ONLINE</div><div class='topbar-actions'>${helpButtons()}<button class='mini-btn danger' id='leave'>退出</button><div class='ver'>${APP_VERSION}</div></div></div><div class='lobby-grid'><section class='panel'><h2>ROOM ${ROOM_IDS.indexOf(currentRoomId)+1}</h2><div class='players'>${(state.players||[]).map(p=>`<div class='player-row'><span>${esc(p.name)}${p.id===state.hostId?' 👑':''}</span><span>${p.cpu?'CPU':'PLAYER'}</span></div>`).join('')}</div>${host?`<div class='actions'><button class='btn secondary' id='addCpu'>CPU追加</button><button class='btn secondary' id='removeCpu'>CPU削除</button></div>`:''}</section><section class='panel settings'><h3>ゲーム設定</h3><label>CPU難易度 <select id='cpuLevel' ${host?'':'disabled'}><option value='easy'>かんたん</option><option value='normal'>ふつう</option><option value='hard'>つよい</option></select></label><label>ハーモニー +5 <input id='harmony' type='checkbox' ${state.settings?.harmony?'checked':''} ${host?'':'disabled'}></label><label>ミドルキングダム +10 <input id='middle' type='checkbox' ${state.settings?.middle?'checked':''} ${host?'':'disabled'}></label><label>マイティ・デュエル（2人専用 7×7・48枚） <input id='mighty' type='checkbox' ${state.settings?.mighty?'checked':''} ${host&&state.players.length===2?'':'disabled'}></label>${host?`<div class='actions'><button class='btn good' id='startGame'>ゲーム開始</button></div>`:''}<div class='muted'>2人通常戦は自動でキング2個・24枚使用になります。7×7・48枚で遊ぶ場合だけマイティ・デュエルをONにします。</div></section></div>${helpOverlayHtml()}</div>`;if(host){document.getElementById('cpuLevel').value=state.settings?.cpuLevel||'normal';document.getElementById('addCpu').onclick=()=>send('addCpu');document.getElementById('removeCpu').onclick=()=>send('removeCpu');['cpuLevel','harmony','middle','mighty'].forEach(id=>document.getElementById(id).onchange=()=>send('settings',{settings:{cpuLevel:document.getElementById('cpuLevel').value,harmony:document.getElementById('harmony').checked,middle:document.getElementById('middle').checked,mighty:document.getElementById('mighty').checked}}));document.getElementById('startGame').onclick=()=>send('start')}document.getElementById('leave').onclick=leaveRoom;bindHelpButtons()}
function leaveRoom(){send('leave');currentRoomId=null;state=null;viewPlayerId=null;localStorage.removeItem(ACTIVE_ROOM_KEY);localStorage.removeItem(ACTIVE_NAME_KEY);try{ws?.close()}catch{}loadRooms()}
function terrainCell(c,extra=''){if(!c)return `<div class='cell empty ${extra}'></div>`;if(c.terrain==='castle')return `<div class='cell castle ${extra}'>🏰</div>`;return `<div class='cell ${c.terrain} ${extra}' title='${TERRAINS[c.terrain]}'><span>${TERRAIN_EMOJI[c.terrain]}</span>${c.crowns?`<span class='crowns'>${'👑'.repeat(c.crowns)}</span>`:''}</div>`}
function fixedBoardBounds(size){const reach=size-1;return{minX:-reach,maxX:reach,minY:-reach,maxY:reach,displaySize:reach*2+1}}
function currentKingdomFrame(board,size){const pts=Object.keys(board||{}).map(k=>k.split(',').map(Number));const half=Math.floor(size/2);let minX=-half,minY=-half;if(pts.length){const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),occMinX=Math.min(...xs),occMaxX=Math.max(...xs),occMinY=Math.min(...ys),occMaxY=Math.max(...ys);if(occMinX<minX)minX=occMinX;if(occMaxX>minX+size-1)minX=occMaxX-size+1;if(occMinY<minY)minY=occMinY;if(occMaxY>minY+size-1)minY=occMaxY-size+1}return{minX,maxX:minX+size-1,minY,maxY:minY+size-1}}
function frameClass(x,y,f){const inside=x>=f.minX&&x<=f.maxX&&y>=f.minY&&y<=f.maxY;if(!inside)return'outside-frame';let c='inside-frame';if(x===f.minX)c+=' frame-left';if(x===f.maxX)c+=' frame-right';if(y===f.minY)c+=' frame-top';if(y===f.maxY)c+=' frame-bottom';return c}
function renderBoard(p){const size=state.boardSize||5,b=fixedBoardBounds(size),displaySize=b.displaySize,f=currentKingdomFrame(p.board,size);let html=`<div class='board board-${size}' style='grid-template-columns:repeat(${displaySize},1fr)' data-frame='${f.minX},${f.minY},${f.maxX},${f.maxY}'>`;for(let y=b.minY;y<=b.maxY;y++)for(let x=b.minX;x<=b.maxX;x++){const c=p.board?.[`${x},${y}`];const selectable=canAct()&&state.turnAction==='place'&&p.id===me()?.id&&!c;const extra=`${selectable?'valid ':''}${frameClass(x,y,f)}`.trim();html+=terrainCell(c,extra).replace('></div>',` data-x='${x}' data-y='${y}' data-pos='${x},${y}'></div>`)}return html+'</div>'}

function orderedPlayersForSidebar(){
  const m=me();
  if(!state?.players)return[];
  if(!m)return[...state.players];
  return [m,...state.players.filter(p=>p.id!==m.id)];
}
function miniCell(c){
  if(!c)return `<div class='mini-cell empty'></div>`;
  if(c.terrain==='castle')return `<div class='mini-cell castle'>🏰</div>`;
  return `<div class='mini-cell ${c.terrain}'>${c.crowns?`<span class='mini-crowns'>${c.crowns}</span>`:''}</div>`;
}
function renderMiniBoard(p){
  const size=state.boardSize||5;
  const f=currentKingdomFrame(p.board||{},size);
  let html=`<div class='mini-board mini-board-${size}' style='grid-template-columns:repeat(${size},1fr)'>`;
  for(let y=f.minY;y<=f.maxY;y++){
    for(let x=f.minX;x<=f.maxX;x++){
      html+=miniCell(p.board?.[`${x},${y}`]);
    }
  }
  return html+'</div>';
}
function sidebarPlayerHtml(p,vp,m){
  const self=p.id===m?.id;
  if(self){
    return `<section class='player-block self-block'>
      <button class='player-card self-summary ${p.id===activePlayer()?.id?'active':''} me ${p.id===vp?.id?'viewing':''}' data-view='${p.id}' aria-label='自分の盤面へ戻る'>
        <div class='player-card-main'>
          <b>${esc(p.name)}（自分）</b>
          <div>${p.score??0}点</div>
        </div>
      </button>
    </section>`;
  }
  return `<section class='player-block'>
    <button class='player-card player-select ${p.id===activePlayer()?.id?'active':''} ${p.id===vp?.id?'viewing':''}' data-view='${p.id}' aria-label='${esc(p.name)}の盤面を見る'>
      <div class='player-card-main'>
        <b>${esc(p.name)}</b>
        <div>${p.cpu?'CPU・':''}${p.score??0}点</div>
      </div>
    </button>
    <button class='mini-board-wrap ${p.id===vp?.id?'viewing':''}' data-view='${p.id}' aria-label='${esc(p.name)}の盤面を見る'>
      ${renderMiniBoard(p)}
    </button>
  </section>`;
}

function currentPlacementTile(){if(!state||state.turnAction!=='place')return null;const tok=state.tokens?.find(t=>t.id===state.activeTokenId);if(!tok)return null;return state.currentRow?.find(x=>x.claimedBy===tok.id)?.tile||null}
function clearGhost(){app.querySelectorAll('.cell.ghost').forEach(el=>{el.classList.remove('ghost','ghost-valid','ghost-invalid','wheat','forest','water','grass','swamp','mine');el.innerHTML=''})}
function paintGhostHalf(x,y,half,legal){const el=app.querySelector(`.cell[data-pos="${x},${y}"]`);if(!el||!el.classList.contains('empty'))return;el.classList.add('ghost',legal?'ghost-valid':'ghost-invalid',half.terrain);el.innerHTML=`<span>${TERRAIN_EMOJI[half.terrain]}</span>${half.crowns?`<span class='crowns'>${'👑'.repeat(half.crowns)}</span>`:''}`}
function selectedPlacement(){const m=me(),tile=currentPlacementTile();if(!m||!tile||!selectedAnchor)return null;const dirs=[[1,0],[0,1],[-1,0],[0,-1]],d=dirs[selectedDir];return{x:selectedAnchor.x,y:selectedAnchor.y,dx:d[0],dy:d[1],legal:clientLegal(tile,m.board,selectedAnchor.x,selectedAnchor.y,d[0],d[1],state.boardSize),tile}}
function placementScorePreview(){const q=selectedPlacement(),m=me();if(!q||!q.legal||!m)return null;const before=estimateScore(m.board||{});const board=JSON.parse(JSON.stringify(m.board||{}));board[`${q.x},${q.y}`]={terrain:q.tile.a.terrain,crowns:q.tile.a.crowns};board[`${q.x+q.dx},${q.y+q.dy}`]={terrain:q.tile.b.terrain,crowns:q.tile.b.crowns};const after=estimateScore(board);return{before,after,delta:after-before}}
function previewPlacement(x,y){clearGhost();selectedAnchor={x,y};const q=selectedPlacement();if(!q)return;paintGhostHalf(q.x,q.y,q.tile.a,q.legal);paintGhostHalf(q.x+q.dx,q.y+q.dy,q.tile.b,q.legal);updatePlacementControls()}
function updatePlacementControls(){const q=selectedPlacement(),score=placementScorePreview(),btn=document.getElementById('confirmPlace'),hint=document.getElementById('placeHint'),scoreEl=document.getElementById('placeScorePreview');if(btn){btn.disabled=!q?.legal;btn.classList.toggle('disabled',!q?.legal)}if(hint){hint.textContent=!q?'配置したいマスをクリックして仮配置してください。':q.legal?'緑のゴースト位置に配置できます。':'赤いゴースト位置には配置できません。回転または別のマスを選んでください。'}if(scoreEl){scoreEl.innerHTML=score?`この配置で <b>+${score.delta}点</b>　現時点の地形得点 <b>${score.after}点</b>`:'仮配置すると、増える点数をここに表示します。'}}
function bindBoardPlacement(){app.querySelectorAll('.cell.valid').forEach(el=>{const x=+el.dataset.x,y=+el.dataset.y;el.onclick=()=>previewPlacement(x,y)});updatePlacementControls()}

function tokenDisplayLabel(token,player){
  if(!token||!player)return'';
  if(state?.players?.length===2){
    const n=(Number(token.index)||0)+1;
    return `${player.name} キング${n===1?'①':'②'}`;
  }
  return player.name;
}

function tileOwnerHtml(token,player){
  if(!token||!player)return '未選択';
  if(state?.players?.length===2){
    const n=(Number(token.index)||0)+1;
    return `<span class='claim-name'>${esc(player.name)}</span><span class='claim-king'>${n===1?'①':'②'}</span>`;
  }
  return `<span class='claim-name'>${esc(player.name)}</span>`;
}

function tileHtml(t,rowType){const claimed=t.claimedBy;const owner=claimed?state.tokens?.find(k=>k.id===claimed):null;const pl=owner?state.players.find(p=>p.id===owner.playerId):null;const ownerHtml=pl?tileOwnerHtml(owner,pl):'未選択';const initialClickable=rowType==='current'&&state.phase==='claim_initial'&&canAct()&&!claimed;const clickable=(rowType==='next'&&canAct()&&state.turnAction==='claim'&&!claimed)||initialClickable;const attr=initialClickable?`data-claim-initial='${t.tile.no}'`:(clickable?`data-claim='${t.tile.no}'`:'');return `<div class='domino ${claimed?'claimed':''} ${clickable?'claimable':''}' ${attr}><span class='num'>#${t.tile.no}</span><div class='half ${t.tile.a.terrain}'>${TERRAIN_EMOJI[t.tile.a.terrain]}${t.tile.a.crowns?`<span class='crowns'>${'👑'.repeat(t.tile.a.crowns)}</span>`:''}</div><div class='half ${t.tile.b.terrain}'>${TERRAIN_EMOJI[t.tile.b.terrain]}${t.tile.b.crowns?`<span class='crowns'>${'👑'.repeat(t.tile.b.crowns)}</span>`:''}</div><div class='claimtag'>${ownerHtml}</div></div>`}
function canAct(){const m=me();if(!m)return false;const tok=state.tokens?.find(t=>t.id===state.activeTokenId);return !!tok&&tok.playerId===m.id&&!m.cpu}
function activePlayer(){const t=state.tokens?.find(x=>x.id===state.activeTokenId);return t?state.players.find(p=>p.id===t.playerId):null}
function activeTokenLabel(){const t=state.tokens?.find(x=>x.id===state.activeTokenId);const p=t?state.players.find(x=>x.id===t.playerId):null;return tokenDisplayLabel(t,p)}
function turnPopupKey(){if(!state||state.status!=='playing'||!state.activeTokenId)return null;return `${state.gameSessionId||''}:${state.round||0}:${state.activeTokenId}`}
function maybeShowTurnPopup(){const key=turnPopupKey();if(!key||key===lastTurnPopupKey)return;lastTurnPopupKey=key;const p=activePlayer();if(!p)return;const old=document.getElementById('turnPopup');if(old)old.remove();const el=document.createElement('div');el.id='turnPopup';el.className='turn-popup';el.innerHTML=`<div class="turn-popup-inner">${esc(activeTokenLabel())}のターン</div>`;document.body.appendChild(el);clearTimeout(turnPopupTimer);turnPopupTimer=setTimeout(()=>{el.classList.add('hide');setTimeout(()=>el.remove(),250)},2200)}
function statusText(){if(state.status==='finished')return'ゲーム終了';if(state.phase==='claim_initial'){return `${activeTokenLabel()}：最初のタイルを選択`}if(state.turnAction==='place')return `${activeTokenLabel()}：タイルを配置`;if(state.turnAction==='claim')return `${activeTokenLabel()}：次のタイルを選択`;return'進行中'}
function renderGame(){const m=me();const vp=state.players.find(p=>p.id===viewPlayerId)||m||state.players[0];const viewingSelf=vp?.id===m?.id;const sidebarPlayers=orderedPlayersForSidebar();app.innerHTML=`<div class='play-screen'><header class='panel play-topbar'><div class='play-top-title'>KINGDOMINO ONLINE</div><div class='play-top-actions'>${helpButtons()}<button class='mini-btn danger' id='leave'>退出</button><span class='ver'>${APP_VERSION}</span></div></header><div class='game-layout'><aside class='panel side side-with-boards'>${sidebarPlayers.map(p=>sidebarPlayerHtml(p,vp,m)).join('')}</aside><main class='panel center'><div class='status'>${esc(statusText())}　ラウンド ${state.round||1}</div><div class='board-view-head'><div class='muted'>表示：<b>${esc(vp.name)}</b>　${state.boardSize}×${state.boardSize}</div>${!viewingSelf&&m?`<button class='mini-btn' id='backMyBoard'>自分の盤面へ戻る</button>`:''}</div><div class='board-wrap'>${renderBoard(vp)}</div><div class='actions placement-actions'>${canAct()&&state.turnAction==='place'&&viewingSelf?`<button class='btn secondary' id='rot'>↻ 回転</button><button class='btn good' id='confirmPlace' disabled>配置確定</button>${state.canDiscard?`<button class='btn danger' id='discard'>配置不能・破棄</button>`:''}`:''}</div>${canAct()&&state.turnAction==='place'&&viewingSelf?`<div class='place-hint' id='placeHint'>配置したいマスをクリックして仮配置してください。</div><div class='place-score-preview' id='placeScorePreview'>仮配置すると、増える点数をここに表示します。</div><div class='frame-note'>太枠：現在の${state.boardSize}×${state.boardSize}表示枠（王国の広がりに応じて移動）</div>`:''}${!viewingSelf?`<div class='spectate-note'>他プレイヤーの盤面を閲覧中です。配置操作は自分の盤面でのみ行えます。</div>`:''}</main><aside class='panel tiles'><div class='rows'><div><b>現在のタイル</b><div class='tile-row'>${(state.currentRow||[]).map(t=>tileHtml(t,'current')).join('')}</div></div><div><b>次のタイル</b><div class='tile-row'>${(state.nextRow||[]).map(t=>tileHtml(t,'next')).join('')}</div></div></div></aside></div></div>${state.status==='finished'?resultOverlay():''}${helpOverlayHtml()}`;app.querySelectorAll('[data-view]').forEach(e=>e.onclick=()=>{viewPlayerId=e.dataset.view;selectedAnchor=null;renderGame()});const backMy=document.getElementById('backMyBoard');if(backMy&&m)backMy.onclick=()=>{viewPlayerId=m.id;selectedAnchor=null;renderGame()};document.getElementById('leave').onclick=leaveRoom;if(document.getElementById('rot'))document.getElementById('rot').onclick=()=>{selectedDir=(selectedDir+1)%4;if(selectedAnchor)previewPlacement(selectedAnchor.x,selectedAnchor.y);else updatePlacementControls()};if(document.getElementById('confirmPlace'))document.getElementById('confirmPlace').onclick=()=>{const q=selectedPlacement();if(q?.legal)placeAt(q.x,q.y)};if(document.getElementById('discard'))document.getElementById('discard').onclick=()=>send('discard');bindBoardPlacement();app.querySelectorAll('[data-claim]').forEach(e=>e.onclick=()=>send('claim',{tileNo:+e.dataset.claim}));app.querySelectorAll('[data-claim-initial]').forEach(e=>e.onclick=()=>send('claimInitial',{tileNo:+e.dataset.claimInitial}));if(document.getElementById('closeResult'))document.getElementById('closeResult').onclick=()=>document.querySelector('.overlay')?.classList.add('hidden');if(document.getElementById('backLobby'))document.getElementById('backLobby').onclick=()=>send('backLobby');bindHelpButtons();if(selectedAnchor&&canAct()&&state.turnAction==='place'&&viewingSelf)previewPlacement(selectedAnchor.x,selectedAnchor.y)}
function placeAt(x,y){const dirs=[[1,0],[0,1],[-1,0],[0,-1]],d=dirs[selectedDir];send('place',{x,y,dx:d[0],dy:d[1]})}
function resultOverlay(){const sorted=[...state.players].sort((a,b)=>(b.score||0)-(a.score||0));return `<div class='overlay'><div class='panel result'><h2>リザルト</h2><table class='score-table'><tr><th>順位</th><th>名前</th><th>得点</th></tr>${sorted.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${p.score||0}点</td></tr>`).join('')}</table><div class='actions'>${isHost()?`<button class='btn good' id='backLobby'>ロビーへ戻る</button>`:''}<button class='btn secondary' id='closeResult'>盤面を見る</button></div></div></div>`}
function cpuTileScore(tile,p){const terr=[tile.a,tile.b];let s=terr.reduce((n,h)=>n+h.crowns*12,0)-tile.no*0.08;for(const h of terr){let count=0;Object.values(p.board||{}).forEach(c=>{if(c.terrain===h.terrain)count++});s+=count*1.2}return s}
function findCpuPlacement(tile,p,level='normal'){const dirs=[[1,0],[0,1],[-1,0],[0,-1]],cand=[];for(let y=-7;y<=7;y++)for(let x=-7;x<=7;x++)for(const [dx,dy] of dirs){if(clientLegal(tile,p.board,x,y,dx,dy,state.boardSize)){const before=p.score||0;const board=JSON.parse(JSON.stringify(p.board));board[`${x},${y}`]={terrain:tile.a.terrain,crowns:tile.a.crowns};board[`${x+dx},${y+dy}`]={terrain:tile.b.terrain,crowns:tile.b.crowns};let score=estimateScore(board);cand.push({x,y,dx,dy,v:score-before+(level==='hard'?(tile.a.crowns+tile.b.crowns)*2:0)})}}if(level==='easy')return cand[Math.floor(Math.random()*cand.length)]||null;cand.sort((a,b)=>b.v-a.v);return cand[0]||null}
function clientLegal(tile,board,x,y,dx,dy,size){const x2=x+dx,y2=y+dy;if(board[`${x},${y}`]||board[`${x2},${y2}`])return false;const points=Object.keys(board).map(k=>k.split(',').map(Number)).concat([[x,y],[x2,y2]]);const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);if(Math.max(...xs)-Math.min(...xs)+1>size||Math.max(...ys)-Math.min(...ys)+1>size)return false;const halves=[{x,y,h:tile.a},{x:x2,y:y2,h:tile.b}],dirs=[[1,0],[-1,0],[0,1],[0,-1]];return halves.some(q=>dirs.some(([ax,ay])=>{const c=board[`${q.x+ax},${q.y+ay}`];return c&&(c.terrain==='castle'||c.terrain===q.h.terrain)}))}
function estimateScore(board){let seen=new Set(),score=0;for(const [k,c] of Object.entries(board)){if(c.terrain==='castle'||seen.has(k))continue;let q=[k],count=0,crowns=0;seen.add(k);while(q.length){const cur=q.pop(),cc=board[cur];count++;crowns+=cc.crowns||0;const [x,y]=cur.split(',').map(Number);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nk=`${x+dx},${y+dy}`,nc=board[nk];if(nc&&nc.terrain===c.terrain&&!seen.has(nk)){seen.add(nk);q.push(nk)}}}score+=count*crowns}return score}
let cpuBusy=false,cpuPendingKey=null,cpuTimer=null;
function cpuStateKey(){if(!state)return'';return [state.gameSessionId||'',state.status||'',state.phase||'',state.turnAction||'',state.activeTokenId||'',state.round||0].join('|')}
function maybeRunCpu(){if(!isHost()||state?.status!=='playing')return;const key=cpuStateKey();if(cpuPendingKey===key)return;const tok=state.tokens?.find(t=>t.id===state.activeTokenId),p=tok&&state.players.find(x=>x.id===tok.playerId);if(!p?.cpu){cpuBusy=false;cpuPendingKey=null;clearTimeout(cpuTimer);return}cpuBusy=true;cpuPendingKey=key;clearTimeout(cpuTimer);cpuTimer=setTimeout(()=>{if(!state||cpuStateKey()!==key){cpuBusy=false;cpuPendingKey=null;maybeRunCpu();return}try{if(state.phase==='claim_initial'){let avail=state.currentRow.filter(x=>!x.claimedBy);if(state.settings?.cpuLevel==='easy')avail=[...avail].sort(()=>Math.random()-.5);else avail=[...avail].sort((a,b)=>cpuTileScore(b.tile,p)-cpuTileScore(a.tile,p));if(avail[0])send('claimInitial',{tileNo:avail[0].tile.no,cpuTokenId:tok.id})}else if(state.turnAction==='place'){const cur=state.currentRow.find(x=>x.claimedBy===tok.id);if(cur){const pl=findCpuPlacement(cur.tile,p,state.settings?.cpuLevel||'normal');if(pl)send('place',{...pl,cpuTokenId:tok.id});else send('discard',{cpuTokenId:tok.id})}}else if(state.turnAction==='claim'){let avail=state.nextRow.filter(x=>!x.claimedBy);if(state.settings?.cpuLevel==='easy')avail=[...avail].sort(()=>Math.random()-.5);else avail=[...avail].sort((a,b)=>cpuTileScore(b.tile,p)-cpuTileScore(a.tile,p));if(avail[0])send('claim',{tileNo:avail[0].tile.no,cpuTokenId:tok.id})}}catch(e){cpuBusy=false;cpuPendingKey=null;console.error(e)}},state.settings?.cpuLevel==='easy'?700:450)}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentRoomId&&(!ws||ws.readyState!==WebSocket.OPEN))scheduleReconnect()});window.addEventListener('online',()=>{if(currentRoomId&&(!ws||ws.readyState!==WebSocket.OPEN))scheduleReconnect()});
window.addEventListener('load',()=>{const ar=localStorage.getItem(ACTIVE_ROOM_KEY),an=localStorage.getItem(ACTIVE_NAME_KEY);if(ar&&an){currentRoomId=ar;currentPlayerName=an;token=getToken(ar);connectWs()}else loadRooms()});
