(() => {
  'use strict';
  const COLS = 31, ROWS = 21, CELL = 30, W = COLS * CELL, H = ROWS * CELL;
  const SONAR_RADIUS = 7.4, SONAR_MS = 2500, ALERT_MS = 10000, STEP_MS = 125, ENEMY_STEP_MS = 620;
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay'), overlayTitle = $('overlayTitle'), overlayCopy = $('overlayCopy');
  const startButton = $('startButton'), pulseButton = $('pulseButton'), baitButton = $('baitButton'), baitHint = $('baitHint');
  const pulseSound = $('soundToggle'), pauseButton = $('pauseButton'), canvasFrame = $('canvasFrame');
  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const map = Array.from({ length: ROWS }, () => Array(COLS).fill(1)); // 1 = wall
  const revealed = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const coresAt = [{ x: 27, y: 2 }, { x: 27, y: 10 }, { x: 11, y: 18 }];
  const stationsAt = [{ x: 10, y: 4 }, { x: 18, y: 16 }, { x: 27, y: 7 }];
  const exitAt = { x: 2, y: 18 }, startAt = { x: 2, y: 2 };
  let state = 'title', paused = false, baitArmed = false, soundOn = false;
  let player = { x: startAt.x, y: startAt.y }, enemies = [], cores = [], stations = [];
  let charge = 5, lives = 3, elapsed = 0, hitCount = 0, startedAt = 0, lastFrame = 0, nextMove = 0, enemyClock = 0;
  let sonar = null, alertTarget = null, alertUntil = 0, pulses = [], toastUntil = 0, bestTime = Number(localStorage.getItem('echoSalvagerBest') || 0);
  let heldKeys = new Set(), touchDir = null, touchMoveAt = 0, resumeState = 'title';
  let audio = null;

  function carve(x1, y1, x2, y2) { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) map[y][x] = 0; }
  function buildMap() {
    carve(1, 1, COLS - 2, ROWS - 2);
    for (let x = 1; x < COLS - 1; x++) { if (![3, 11, 19, 27].includes(x)) map[6][x] = 1; if (![5, 11, 19, 26].includes(x)) map[13][x] = 1; }
    for (let y = 1; y < ROWS - 1; y++) { if (![3, 10, 17].includes(y)) map[y][7] = 1; if (![2, 8, 14, 18].includes(y)) map[y][15] = 1; if (![5, 12, 18].includes(y)) map[y][23] = 1; }
    // Broken machinery adds texture without sealing any of the vault's passages.
    [[4,9],[5,9],[12,3],[12,4],[18,9],[19,9],[27,15],[28,15],[4,16],[5,16],[20,3],[21,3],[10,10],[11,10],[26,4],[27,4]].forEach(([x,y]) => { if (![...coresAt, ...stationsAt, startAt, exitAt].some(p => p.x === x && p.y === y)) map[y][x] = 1; });
    // Keep the three routes, lift and charging points open on every local run.
    [...coresAt, ...stationsAt, startAt, exitAt, {x:7,y:3},{x:7,y:10},{x:7,y:17},{x:15,y:2},{x:15,y:8},{x:15,y:14},{x:15,y:18},{x:23,y:5},{x:23,y:12},{x:23,y:18},{x:11,y:6},{x:19,y:6},{x:27,y:6},{x:5,y:13},{x:11,y:13},{x:19,y:13},{x:26,y:13}].forEach(p => { map[p.y][p.x] = 0; });
  }
  buildMap();

  function resetRun() {
    for (let y = 0; y < ROWS; y++) revealed[y].fill(false);
    player = { ...startAt }; cores = coresAt.map(p => ({ ...p, found: false })); stations = stationsAt.map(p => ({ ...p, used: false }));
    enemies = [{ x: 12, y: 10, home: {x:12,y:10}, hue: 0 }, { x: 20, y: 4, home: {x:20,y:4}, hue: 1 }, { x: 26, y: 17, home: {x:26,y:17}, hue: 2 }];
    charge = 5; lives = 3; elapsed = 0; hitCount = 0; startedAt = performance.now(); enemyClock = startedAt; sonar = null; alertTarget = null; alertUntil = 0; pulses = []; paused = false; baitArmed = false; heldKeys.clear(); touchDir = null;
    state = 'playing'; overlay.classList.add('hidden'); pauseButton.hidden = false; $('runState').textContent = 'SIGNAL ACTIVE'; $('statusMessage').textContent = 'Move quietly. A pulse reveals the vault — and gives away your location.';
    ping(startAt.x, startAt.y, false, true); updateHud();
  }
  function cellOpen(x,y) { return x >= 1 && y >= 1 && x < COLS - 1 && y < ROWS - 1 && map[y][x] === 0; }
  function announce(text, duration = 2500) { const box = $('toast'); box.textContent = text; box.classList.add('show'); toastUntil = performance.now() + duration; $('statusMessage').textContent = text; }
  function chirp(kind = 'ping') {
    if (!soundOn) return;
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); const osc = audio.createOscillator(), gain = audio.createGain(); osc.type = kind === 'hit' ? 'sawtooth' : 'sine'; osc.frequency.setValueAtTime(kind === 'hit' ? 145 : 460, audio.currentTime); osc.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 65 : 190, audio.currentTime + .22); gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(kind === 'hit' ? .065 : .035, audio.currentTime + .012); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .28); osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .3); } catch (_) {}
  }
  function ping(x, y, decoy = false, opening = false) {
    if (state !== 'playing' || paused) return false;
    if (!opening) { if (charge <= 0) { announce('NO CHARGE. Find a pale-green relay station to recharge.', 2300); return false; } charge--; }
    const now = performance.now(); sonar = { x, y, at: now, until: now + SONAR_MS, decoy };
    if (!opening) { alertTarget = { x, y }; alertUntil = now + ALERT_MS; }
    pulses.push({ x, y, at: now, decoy });
    for (let yy = Math.max(0, y - 9); yy <= Math.min(ROWS - 1, y + 9); yy++) for (let xx = Math.max(0, x - 9); xx <= Math.min(COLS - 1, x + 9); xx++) if (Math.hypot(xx - x, yy - y) <= SONAR_RADIUS + 1) revealed[yy][xx] = true;
    if (!opening) { chirp(); announce(decoy ? 'DECOY ECHO AWAY. The Warden is chasing the false signal.' : 'SONAR PULSE. The Warden heard that.', 2100); }
    updateHud(); return true;
  }
  function doPulse() { if (state === 'playing' && !paused) ping(player.x, player.y, false); }
  function armBait() { if (state !== 'playing' || paused) return; baitArmed = !baitArmed; canvasFrame.classList.toggle('aiming', baitArmed); baitHint.classList.toggle('armed', baitArmed); baitHint.textContent = baitArmed ? 'Decoy armed — click a lit floor tile to throw the echo.' : 'Make a decoy to pull the Warden away from your trail.'; announce(baitArmed ? 'DECOY ARMED — CLICK A VISIBLE FLOOR TILE.' : 'Decoy cancelled.', 1800); }
  function visibleAt(x,y, now = performance.now()) { return !!sonar && now < sonar.until && Math.hypot(x - sonar.x, y - sonar.y) <= SONAR_RADIUS; }
  function move(dx,dy) {
    if (state !== 'playing' || paused) return;
    const nx = player.x + dx, ny = player.y + dy;
    if (!cellOpen(nx,ny)) { chirp('wall'); return; }
    player.x = nx; player.y = ny;
    const core = cores.find(c => !c.found && c.x === nx && c.y === ny);
    if (core) { core.found = true; chirp(); announce(`CORE ${cores.filter(c=>c.found).length} OF 3 RECOVERED. Keep moving.`, 3000); }
    const station = stations.find(s => !s.used && s.x === nx && s.y === ny);
    if (station) { station.used = true; charge = 5; chirp(); announce('RELAY STATION ONLINE. SONAR CHARGE RESTORED.', 2600); }
    if (nx === exitAt.x && ny === exitAt.y) {
      if (cores.every(c => c.found)) finishRun(true); else announce(`LIFT LOCKED — ${3 - cores.filter(c=>c.found).length} CORE${cores.filter(c=>c.found).length === 2 ? '' : 'S'} STILL MISSING.`, 2500);
    }
    if (enemies.some(e => e.x === nx && e.y === ny)) hitPlayer();
    updateHud();
  }
  function hitPlayer() {
    if (performance.now() < (player.safeUntil || 0) || state !== 'playing') return;
    lives--; hitCount++; player = { ...startAt, safeUntil: performance.now() + 1800 }; chirp('hit');
    announce(lives ? `THE WARDEN FOUND YOU. Recovery team pulled you back — ${lives} ${lives === 1 ? 'life' : 'lives'} left.` : 'SIGNAL LOST. The vault went quiet.', 3000);
    if (!lives) finishRun(false); else { alertTarget = { ...startAt }; alertUntil = performance.now() + ALERT_MS; ping(startAt.x, startAt.y, false, true); }
    updateHud();
  }
  function finishRun(won) {
    state = won ? 'won' : 'lost'; paused = false; baitArmed = false; canvasFrame.classList.remove('aiming'); pauseButton.hidden = true; $('runState').textContent = won ? 'EXTRACTION CONFIRMED' : 'SIGNAL LOST';
    const sec = Math.max(0, Math.floor(elapsed / 1000)); const mm = String(Math.floor(sec/60)).padStart(2,'0'), ss = String(sec%60).padStart(2,'0');
    const stars = won ? (hitCount === 0 && sec < 150 ? 3 : hitCount <= 1 ? 2 : 1) : 0;
    if (won && (!bestTime || sec < bestTime)) { bestTime = sec; localStorage.setItem('echoSalvagerBest', String(sec)); }
    overlayTitle.innerHTML = won ? 'THE LIGHT<br><em>MADE IT HOME.</em>' : 'THE VAULT<br><em>WENT QUIET.</em>';
    overlayCopy.textContent = won ? `All three cores recovered in ${mm}:${ss}. ${stars === 3 ? 'A clean run. The city lights are back.' : 'The city lights are back — you can still do it cleaner.'}` : 'The Warden caught your signal. The lift is still waiting. Take a breath, then try a quieter route.';
    $('missionCard').querySelector('.card-stamp').innerHTML = `<span class="stamp-icon">${won ? '✦' : '◉'}</span> ${won ? 'EXTRACTION REPORT' : 'RECOVERY ORDER'} <span class="stamp-line"></span><span>${won ? stars + ' / 3 STARS' : 'RETRY'}</span>`;
    $('missionCard').querySelectorAll('.objective-line')[0].innerHTML = `<span class="objective-number">01</span><span>${won ? `SALVAGED <b>03 / 03 CORES</b>` : `CORES FOUND <b>${cores.filter(c=>c.found).length} / 03</b>`}</span><span class="objective-arrow">${won ? '◆' : '↗'}</span>`;
    $('missionCard').querySelectorAll('.objective-line')[1].innerHTML = `<span class="objective-number">02</span><span>TIME BELOW <b>${mm}:${ss}</b> · ${hitCount} ${hitCount === 1 ? 'HIT' : 'HITS'}</span><span class="objective-arrow">↗</span>`;
    startButton.querySelector('span').textContent = won ? 'RUN IT AGAIN' : 'TRY AGAIN'; overlay.classList.remove('hidden');
  }
  function togglePause() { if (state !== 'playing') return; paused = !paused; $('runState').textContent = paused ? 'SIMULATION PAUSED' : 'SIGNAL ACTIVE'; pauseButton.innerHTML = paused ? 'RESUME <span>P</span>' : 'PAUSE <span>P</span>'; $('statusMessage').textContent = paused ? 'Simulation paused. Press P or Resume when you are ready.' : 'Move quietly. A pulse reveals the vault — and gives away your location.'; }
  function pathNext(from, to) {
    if (!cellOpen(to.x,to.y)) return null;
    const q = [{x:from.x,y:from.y}], seen = new Set([`${from.x},${from.y}`]), prev = new Map();
    for (let i=0;i<q.length;i++) { const p=q[i]; if (p.x===to.x&&p.y===to.y) break; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const x=p.x+dx,y=p.y+dy,k=`${x},${y}`; if(cellOpen(x,y)&&!seen.has(k)){seen.add(k);prev.set(k,`${p.x},${p.y}`);q.push({x,y});} } }
    const end=`${to.x},${to.y}`; if(!seen.has(end)||end===`${from.x},${from.y}`) return null; let cur=end, before=prev.get(cur); while(before && before!==`${from.x},${from.y}`){cur=before;before=prev.get(cur);} const [x,y]=cur.split(',').map(Number); return {x,y};
  }
  function updateEnemies(now) {
    if (now - enemyClock < ENEMY_STEP_MS) return; enemyClock = now;
    if (alertTarget && now < alertUntil) {
      for (const e of enemies) { if (e.x===alertTarget.x&&e.y===alertTarget.y) continue; const n=pathNext(e,alertTarget); if(n){e.x=n.x;e.y=n.y;} if(e.x===player.x&&e.y===player.y) hitPlayer(); }
    } else { alertTarget = null; }
  }
  function updateHud() {
    const found = cores.filter(c=>c.found).length; $('coreCount').innerHTML = `${String(found).padStart(2,'0')} <i>/ 03</i>`;
    $('coreTrack').querySelectorAll('.core-slot').forEach((el,i)=>el.classList.toggle('active',i<found));
    $('chargeValue').innerHTML = `${String(charge).padStart(2,'0')} <small>/ 05</small>`;
    $('chargeBars').innerHTML = Array.from({length:5},(_,i)=>`<span class="${i<charge?'on':''}"></span>`).join('');
    $('lifeCaption').innerHTML = `${Array.from({length:3},(_,i)=>`<span class="life-dot ${i>=lives?'off':''}"></span>`).join('')}<small>${lives} ${lives===1?'LIFE':'LIVES'}</small>`;
    pulseButton.disabled = state !== 'playing' || paused || charge<=0; baitButton.disabled = pulseButton.disabled;
    const alerting = performance.now() < alertUntil; $('threatLabel').textContent = alerting ? 'WARDEN INVESTIGATING' : 'THREAT DORMANT'; $('threatLabel').parentElement.classList.toggle('alert',alerting);
  }
  function pointFromEvent(ev) { const r=canvas.getBoundingClientRect(); return { x:Math.floor((ev.clientX-r.left)/r.width*COLS), y:Math.floor((ev.clientY-r.top)/r.height*ROWS) }; }
  canvas.addEventListener('click',ev=>{ if(!baitArmed||state!=='playing'||paused)return; const p=pointFromEvent(ev); if(!cellOpen(p.x,p.y)){announce('A decoy needs an open floor tile.',1600);return;} if(!revealed[p.y][p.x]){announce('You can only throw an echo onto a tile you have seen.',1900);return;} baitArmed=false;canvasFrame.classList.remove('aiming');baitHint.classList.remove('armed');baitHint.textContent='Make a decoy to pull the Warden away from your trail.';ping(p.x,p.y,true); });
  startButton.addEventListener('click',()=>{ $('missionCard').querySelector('.card-stamp').innerHTML='<span class="stamp-icon">◉</span> RECOVERY ORDER <span class="stamp-line"></span><span>04—07</span>'; resetRun(); });
  pulseButton.addEventListener('click',doPulse); baitButton.addEventListener('click',armBait); pauseButton.addEventListener('click',togglePause);
  pulseSound.addEventListener('click',()=>{soundOn=!soundOn;pulseSound.setAttribute('aria-pressed',String(soundOn));$('soundState').textContent=soundOn?'ON':'OFF';if(soundOn)chirp();});
  window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault();if(k==='p'){togglePause();return;}if(state!=='playing'||paused)return;if(k===' '){doPulse();return;}if(k==='f'){armBait();return;}const mapKey={w:[0,-1],arrowup:[0,-1],s:[0,1],arrowdown:[0,1],a:[-1,0],arrowleft:[-1,0],d:[1,0],arrowright:[1,0]};if(mapKey[k]){heldKeys.add(k);if(performance.now()>=nextMove){move(...mapKey[k]);nextMove=performance.now()+STEP_MS;}}});
  window.addEventListener('keyup',e=>heldKeys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{heldKeys.clear();touchDir=null;});
  document.querySelectorAll('[data-move]').forEach(btn=>{const [dx,dy]=btn.dataset.move.split(',').map(Number);btn.addEventListener('pointerdown',e=>{e.preventDefault();if(state==='playing'){touchDir={dx,dy};move(dx,dy);touchMoveAt=performance.now()+STEP_MS;}});for(const ev of ['pointerup','pointercancel','pointerleave'])btn.addEventListener(ev,()=>{touchDir=null;});});
  function drawCell(x,y,now) {
    const px=x*CELL,py=y*CELL,known=revealed[y][x],visible=visibleAt(x,y,now);
    if(!known){ctx.fillStyle='#03090b';ctx.fillRect(px,py,CELL,CELL);return;}
    if(map[y][x]===1){ctx.fillStyle=visible?'#162323':'#0a1113';ctx.fillRect(px,py,CELL,CELL);ctx.fillStyle=visible?'#1c2b2a':'#0d1617';ctx.fillRect(px+1,py+1,CELL-2,CELL-2);if(visible){ctx.fillStyle='#233330';ctx.fillRect(px+3,py+4,CELL-8,1);ctx.fillRect(px+8,py+12,CELL-4,1);ctx.fillStyle='#12201f';ctx.fillRect(px+5,py+7,1,4);ctx.fillRect(px+22,py+14,1,7);}return;}
    ctx.fillStyle=visible?'#101b1b':'#091111';ctx.fillRect(px,py,CELL,CELL);
    const h=(x*97+y*47+x*y*3)%19;if(visible&&h===0){ctx.fillStyle='#273431';ctx.fillRect(px+7,py+8,2,2);}if(visible&&h===5){ctx.fillStyle='#1b2928';ctx.fillRect(px+21,py+18,4,1);}
    if(visible){ctx.strokeStyle='#182525';ctx.lineWidth=.55;ctx.strokeRect(px+.2,py+.2,CELL-.4,CELL-.4);}
  }
  function drawPickup(p,now,color,kind) { const x=(p.x+.5)*CELL,y=(p.y+.5)*CELL,beat=.65+.35*Math.sin(now/230+p.x);ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);ctx.shadowBlur=kind==='core'?18:12;ctx.shadowColor=color;ctx.fillStyle=color;ctx.globalAlpha=beat;const s=kind==='core'?7:5;ctx.fillRect(-s/2,-s/2,s,s);ctx.globalAlpha=.55;ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(-s,-s,s*2,s*2);ctx.restore();ctx.globalAlpha=1; }
  function drawEnemy(e,now) { const x=(e.x+.5)*CELL,y=(e.y+.5)*CELL,pulse=.7+.3*Math.sin(now/170+e.hue);ctx.save();ctx.translate(x,y);ctx.shadowBlur=17;ctx.shadowColor='#ff476e';ctx.fillStyle='#601d35';ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(8,-5);ctx.lineTo(7,6);ctx.lineTo(0,10);ctx.lineTo(-7,6);ctx.lineTo(-8,-5);ctx.closePath();ctx.fill();ctx.strokeStyle='#ff7188';ctx.globalAlpha=.8;ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#ffccd1';ctx.globalAlpha=pulse;ctx.fillRect(-4,-2,2,2);ctx.fillRect(2,-2,2,2);ctx.restore(); }
  function drawPlayer(now) { const x=(player.x+.5)*CELL,y=(player.y+.5)*CELL;const blink=now<(player.safeUntil||0)&&Math.floor(now/90)%2===0;if(blink)return;ctx.save();ctx.translate(x,y);ctx.shadowBlur=22;ctx.shadowColor='#7bffe0';ctx.fillStyle='#8affd9';ctx.beginPath();ctx.arc(0,0,6.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#dffff5';ctx.beginPath();ctx.arc(1,-1,2.2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#8affd9';ctx.globalAlpha=.55;ctx.beginPath();ctx.arc(0,0,10+Math.sin(now/110)*1.5,0,Math.PI*2);ctx.stroke();ctx.restore(); }
  function drawMap(now) {
    ctx.fillStyle='#03090b';ctx.fillRect(0,0,W,H);
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)drawCell(x,y,now);
    if(sonar&&now<sonar.until){const cx=(sonar.x+.5)*CELL,cy=(sonar.y+.5)*CELL;const grd=ctx.createRadialGradient(cx,cy,5,cx,cy,SONAR_RADIUS*CELL);grd.addColorStop(0,'#62ffe108');grd.addColorStop(.7,'#59ffd108');grd.addColorStop(1,'#60ffe000');ctx.fillStyle=grd;ctx.beginPath();ctx.arc(cx,cy,SONAR_RADIUS*CELL,0,Math.PI*2);ctx.fill();}
    for(const s of stations)if(!s.used&&visibleAt(s.x,s.y,now))drawPickup(s,now,'#8affd9','station');
    for(const c of cores)if(!c.found&&visibleAt(c.x,c.y,now))drawPickup(c,now,'#ffbd78','core');
    if(visibleAt(exitAt.x,exitAt.y,now)){const x=(exitAt.x+.5)*CELL,y=(exitAt.y+.5)*CELL;ctx.save();ctx.strokeStyle='#ffb56b';ctx.shadowBlur=12;ctx.shadowColor='#ffb56b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,9+Math.sin(now/240)*1.6,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ffb56b';ctx.fillRect(x-3,y-3,6,6);ctx.restore();}
    if(sonar&&now<sonar.until){for(const e of enemies)if(visibleAt(e.x,e.y,now))drawEnemy(e,now);}
    for(const p of pulses){const t=(now-p.at)/940;if(t>=0&&t<=1){const r=t*SONAR_RADIUS*CELL;ctx.beginPath();ctx.arc((p.x+.5)*CELL,(p.y+.5)*CELL,r,0,Math.PI*2);ctx.strokeStyle=p.decoy?`rgba(255,187,118,${(1-t)*.55})`:`rgba(118,255,223,${(1-t)*.62})`;ctx.lineWidth=1.3;ctx.stroke();}}
    if(baitArmed){ctx.fillStyle='rgba(255,181,107,.08)';ctx.fillRect(0,0,W,H);}
    drawPlayer(now);
    if(state==='title'){ctx.fillStyle='#02070826';ctx.fillRect(0,0,W,H);}
    if(paused&&state==='playing'){ctx.fillStyle='#020708a8';ctx.fillRect(0,0,W,H);ctx.fillStyle='#cbe2d9';ctx.font='600 13px monospace';ctx.textAlign='center';ctx.fillText('SIMULATION PAUSED  ·  PRESS P TO RESUME',W/2,H/2);}
  }
  function frame(now) {
    if(!lastFrame)lastFrame=now;const dt=Math.min(50,now-lastFrame);lastFrame=now;
    if(state==='playing'&&!paused){elapsed+=dt;const dir=heldKeys.values().next().value;const m={w:[0,-1],arrowup:[0,-1],s:[0,1],arrowdown:[0,1],a:[-1,0],arrowleft:[-1,0],d:[1,0],arrowright:[1,0]};if(dir&&m[dir]&&now>=nextMove){move(...m[dir]);nextMove=now+STEP_MS;}if(touchDir&&now>=touchMoveAt){move(touchDir.dx,touchDir.dy);touchMoveAt=now+STEP_MS;}updateEnemies(now);$('timeValue').innerHTML=`${String(Math.floor(elapsed/60000)).padStart(2,'0')}<small>:${String(Math.floor(elapsed/1000)%60).padStart(2,'0')}</small>`;if(elapsed>0&&Math.floor(elapsed/1000)%1===0&&now-lastHud>420){updateHud();lastHud=now;}}
    if(toastUntil&&now>toastUntil){$('toast').classList.remove('show');toastUntil=0;}pulses=pulses.filter(p=>now-p.at<1100);drawMap(now);requestAnimationFrame(frame);
  }
  let lastHud=0; requestAnimationFrame(frame); updateHud();
})();
