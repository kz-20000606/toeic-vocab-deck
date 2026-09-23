const app=document.querySelector('#app');
let words=[],records={},db,view='home',level=1,direction='ja-en',orderMode='sequential',cursors={},session=null,notice='',listLevel='1';
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('vocab-deck',1);req.onupgradeneeded=()=>{req.result.createObjectStore('progress',{keyPath:'id'});req.result.createObjectStore('meta')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function transaction(store,mode,callback){return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let value;try{value=callback(tx.objectStore(store))}catch(err){reject(err);return}tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error)})}
async function loadRecords(){return new Promise((resolve,reject)=>{const req=db.transaction('progress').objectStore('progress').getAll();req.onsuccess=()=>resolve(Object.fromEntries(req.result.map(r=>[r.id,r])));req.onerror=()=>reject(req.error)})}
async function loadSession(){return new Promise((resolve,reject)=>{const req=db.transaction('meta').objectStore('meta').get('session');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}
async function loadCursors(){return new Promise((resolve,reject)=>{const req=db.transaction('meta').objectStore('meta').get('cursors');req.onsuccess=()=>resolve(req.result||{});req.onerror=()=>reject(req.error)})}
const saveSession=()=>transaction('meta','readwrite',store=>store.put(session,'session'));
const saveCursors=()=>transaction('meta','readwrite',store=>store.put(cursors,'cursors'));
const getWord=id=>words.find(w=>w.id===id);
const status=id=>records[id]?.status||'new';
const label=s=>({'new':'未学習','known':'わかる','unsure':'あやふや','unknown':'わからない'})[s];
function setView(next){view=next;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));render()}
function pick(pool,n,mode,start=0){
  const chosen=mode==='random'?[...pool]:[...pool.slice(start),...pool.slice(0,start)];
  if(mode==='random')for(let i=chosen.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[chosen[i],chosen[j]]=[chosen[j],chosen[i]]}
  return chosen.slice(0,n).map(w=>w.id);
}
async function begin(review=false,block=0){
  const levelWords=words.filter(w=>w.level===level);
  const pool=review?words.filter(w=>['unknown','unsure'].includes(status(w.id))):orderMode==='random'?levelWords:levelWords.slice(block*10,(block+1)*10);
  if(!pool.length){notice='復習する単語がまだありません。';render();return}
  session={ids:pick(pool,10,orderMode),index:0,review,direction,order:orderMode,shown:false,hinted:false,assessed:null,results:[]};
  await saveSession();setView('practice');
}
async function hint(){session.hinted=true;await saveSession();render()}
async function rate(choice){
  if(session.assessed)return;
  const id=session.ids[session.index];
  const final=choice;
  const prev=records[id]||{id,attempts:0};
  records[id]={...prev,id,status:final,attempts:prev.attempts+1,hints:(prev.hints||0)+(session.hinted?1:0),updatedAt:new Date().toISOString()};
  await transaction('progress','readwrite',store=>store.put(records[id]));
  session.results.push(final);
  session.assessed=final;
  session.shown=true;
  await saveSession();
  render();
}
async function advance(){
  if(!session.assessed)return;
  session.index++;
  session.shown=false;
  session.hinted=false;
  session.assessed=null;
  await saveSession();
  render();
}
async function markMistake(){
  if(!session?.shown||!session.assessed||session.assessed==='unknown')return;
  const id=session.ids[session.index];
  records[id]={...records[id],status:'unknown',updatedAt:new Date().toISOString()};
  await transaction('progress','readwrite',store=>store.put(records[id]));
  session.assessed='unknown';
  session.results[session.results.length-1]='unknown';
  await saveSession();
  render();
}
async function finish(){session=null;await saveSession();setView('home')}
function renderHome(){
  const weak=words.filter(w=>['unknown','unsure'].includes(status(w.id))).length;
  const seen=words.filter(w=>status(w.id)!=='new').length;
  app.innerHTML=`<div class="overview"><div><div class="eyebrow">MY WORDS</div><h1 class="heading">今日の単語を練習</h1><div class="muted">7レベル・各50語。短いセットから始めましょう。</div></div><div class="counter"><strong>${seen} / 350</strong>学習した語</div></div>
    <div class="levels">${Array.from({length:7},(_,i)=>{const n=i+1,c=words.filter(w=>w.level===n&&status(w.id)!=='new').length;return `<button class="level ${level===n?'selected':''}" data-level="${n}" aria-pressed="${level===n}">LEVEL ${n}<small>${c} / 50語</small></button>`}).join('')}</div>
    <section class="panel"><h2 class="sectiontitle">LEVEL ${level} を学習</h2><p class="muted">答えを思い浮かべて、自分で理解度を選びます。</p>
    <div class="eyebrow">出題方向</div><div class="options"><button class="option ${direction==='ja-en'?'selected':''}" data-direction="ja-en">日本語 → 英語</button><button class="option ${direction==='en-ja'?'selected':''}" data-direction="en-ja">英語 → 日本語</button></div>
    <div class="eyebrow">出題順</div><div class="options"><button class="option ${orderMode==='sequential'?'selected':''}" data-order="sequential">順番に</button><button class="option ${orderMode==='random'?'selected':''}" data-order="random">ランダム</button></div>
    ${orderMode==='random'?'<div class="eyebrow">50語から出題</div><div class="options"><button class="primary" id="random-start">ランダムに10語を始める</button></div>':`<div class="eyebrow">練習する範囲（各10語）</div><div class="options block-options">${Array.from({length:5},(_,i)=>{const set=words.filter(w=>w.level===level).slice(i*10,(i+1)*10);const done=set.filter(w=>status(w.id)!=='new').length;return `<button class="option block" data-block="${i}">${i*10+1}〜${(i+1)*10}語<small>${done} / 10語を学習済み</small></button>`}).join('')}</div>`}
    <div class="actions"><button class="secondary" id="review" ${weak?'':'disabled'}>苦手語を復習 ${weak?`(${weak})`:''}</button></div>
    <p class="note">${orderMode==='random'?`LEVEL ${level} の50語から重複なしで10語を選びます。`:'範囲のボタンを押すと、その10語を順番に練習できます。'}</p></section>${notice?`<p class="toast">${escapeHTML(notice)}</p>`:''}`;
  notice='';
  app.querySelectorAll('[data-level]').forEach(el=>el.onclick=()=>{level=+el.dataset.level;render()});
  app.querySelectorAll('[data-block]').forEach(el=>el.onclick=()=>begin(false,+el.dataset.block));
  app.querySelector('#random-start')?.addEventListener('click',()=>begin(false));
  app.querySelectorAll('[data-direction]').forEach(el=>el.onclick=()=>{direction=el.dataset.direction;render()});
  app.querySelectorAll('[data-order]').forEach(el=>el.onclick=()=>{orderMode=el.dataset.order;render()});
  app.querySelector('#review').onclick=()=>begin(true);
}
function renderPractice(){
  if(!session){setView('home');return}
  if(session.index>=session.ids.length){
    const counts={known:0,unsure:0,unknown:0};
    session.results.forEach(s=>counts[s]++);
    app.innerHTML=`<div class="eyebrow">SESSION COMPLETE</div><h1 class="heading">おつかれさまでした</h1><div class="panel result"><strong>${counts.known}</strong><p>わかる</p><p class="muted">あやふや ${counts.unsure}語 ・ わからない ${counts.unknown}語</p><button class="primary" id="finish">学習画面へ</button></div>`;
    app.querySelector('#finish').onclick=finish;
    return;
  }
  const w=getWord(session.ids[session.index]);
  const japaneseFirst=session.direction==='ja-en';
  const mask=[...w.word].map((char,i)=>char===' '?'　':i===0?escapeHTML(char):'_').join(' ');
  app.innerHTML=`<div class="quizhead"><h1>${session.review?'苦手語の復習':`LEVEL ${w.level}`}</h1><span class="muted">${session.index+1} / ${session.ids.length}</span></div>
    <div class="progress"><span style="width:${session.index/session.ids.length*100}%"></span></div>
    <section class="panel"><div class="card"><div class="cardlabel">${japaneseFirst?'日本語から英語を思い出す':'英語の意味を思い出す'}</div>
    <div class="word ${japaneseFirst?'meaning':''}">${escapeHTML(japaneseFirst?w.meaning:w.word)}</div>
    ${japaneseFirst&&session.hinted&&!session.shown?`<div class="hint" aria-live="polite">${mask}</div>`:''}
    ${session.shown?`<div class="cardlabel">答え</div><div class="word ${japaneseFirst?'':'meaning'}">${escapeHTML(japaneseFirst?w.word:w.meaning)}</div><p class="example">${escapeHTML(w.example)}</p>`:''}</div>
    <div class="answerbar">${session.shown?`<p class="assessment">${label(session.assessed)}として記録しました。</p><div class="actions">${session.assessed==='unknown'?'':'<button class="secondary" id="mistake">間違えてた</button>'}<button class="primary next-answer" id="next">次の単語へ</button></div>`:
      `<div class="ratings"><button data-rate="known">わかる</button><button data-rate="unsure">あやふや</button><button data-rate="unknown">わからない</button></div>${japaneseFirst?'<button class="secondary hint-button" id="hint">最初の1文字を見る</button>':''}`}</div></section>
    <p class="note">${session.shown?'答えが違っていた場合は「間違えてた」で苦手語に変更できます。':'ヒントを使っても評価は決まりません。3つの評価ボタンを押すと答えが表示されます。'}</p>
    <button class="ghost" id="exit" style="margin-top:20px">学習画面へ戻る</button>`;
  app.querySelector('#exit').onclick=()=>setView('home');
  app.querySelector('#hint')?.addEventListener('click',hint);
  app.querySelector('#next')?.addEventListener('click',advance);
  app.querySelector('#mistake')?.addEventListener('click',markMistake);
  app.querySelectorAll('[data-rate]').forEach(b=>b.onclick=()=>rate(b.dataset.rate));
}
function renderList(query=''){
  const displayed=words.filter(w=>(listLevel==='all'||+listLevel===w.level)&&(!query||w.word.toLowerCase().includes(query.toLowerCase())||w.meaning.includes(query)));
  app.innerHTML=`<div class="eyebrow">WORD LIST</div><h1 class="heading">単語一覧</h1><p class="muted">レベルを選んで50語ずつ確認できます。</p>
    <div class="listlevels" role="group" aria-label="表示するレベル"><button class="option ${listLevel==='all'?'selected':''}" data-list-level="all" aria-pressed="${listLevel==='all'}">すべて</button>${Array.from({length:7},(_,i)=>`<button class="option ${listLevel===String(i+1)?'selected':''}" data-list-level="${i+1}" aria-pressed="${listLevel===String(i+1)}">LEVEL ${i+1}</button>`).join('')}</div>
    <div class="listtools"><input class="input" id="search" type="search" placeholder="単語・日本語で検索" value="${escapeHTML(query)}" aria-label="単語を検索"></div><p class="note">${listLevel==='all'?'全レベル':`LEVEL ${listLevel}`} · ${displayed.length}語を表示</p>
    <div class="wordlist">${displayed.map(w=>`<div class="wordrow"><strong>${escapeHTML(w.word)}</strong><p>${escapeHTML(w.meaning)}</p><small>LEVEL ${w.level} · ${label(status(w.id))}</small><p class="note">${escapeHTML(w.example)}</p></div>`).join('')}</div>`;
  app.querySelectorAll('[data-list-level]').forEach(b=>b.onclick=()=>{listLevel=b.dataset.listLevel;renderList(app.querySelector('#search').value)});
  app.querySelector('#search').oninput=e=>{const caret=e.target.selectionStart;renderList(e.target.value);const input=app.querySelector('#search');input.focus();input.setSelectionRange(caret,caret)};
}
function renderSettings(){app.innerHTML=`<div class="eyebrow">YOUR DATA</div><h1 class="heading">学習記録</h1><p class="muted">記録はこの端末のブラウザ内に保存されます。別の端末には自動で移りません。</p><section class="panel"><div class="settingsrow"><h2>記録を書き出す</h2><p>学習した単語の状態や回答回数をJSONファイルに保存します。機種変更前のバックアップに使えます。</p><button class="primary" id="export">JSONを書き出す</button></div><div class="settingsrow"><h2>記録を読み込む</h2><p>このサイトから書き出したJSONファイルを読み込みます。同じ単語の現在の記録は上書きされます。</p><label class="secondary" for="import" style="display:inline-block;cursor:pointer">JSONを選ぶ</label><input type="file" id="import" accept="application/json,.json" hidden></div><div class="settingsrow"><h2>オフライン学習</h2><p>初回の読み込み後、画面と単語データを端末に保存します。ブラウザのデータを削除すると学習記録も消えるため、定期的に書き出してください。</p></div></section><p id="feedback" role="status" class="toast"></p>`;app.querySelector('#export').onclick=exportData;app.querySelector('#import').onchange=importData}
function exportData(){const blob=new Blob([JSON.stringify({app:'vocab-deck',version:1,exportedAt:new Date().toISOString(),records:Object.values(records),cursors},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`vocab-deck-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function importData(e){const field=app.querySelector('#feedback');try{const file=e.target.files?.[0];if(!file)return;if(file.size>5_000_000)throw Error('ファイルが大きすぎます。');const parsed=JSON.parse(await file.text());if(parsed.app!=='vocab-deck'||parsed.version!==1||!Array.isArray(parsed.records))throw Error('このサイトのバックアップファイルではありません。');const validIds=new Set(words.map(w=>w.id));const validStatus=new Set(['known','unsure','unknown']);const incoming=parsed.records.filter(r=>r&&validIds.has(r.id)&&validStatus.has(r.status)&&Number.isInteger(r.attempts)&&r.attempts>=0).map(r=>({id:r.id,status:r.status,attempts:r.attempts,hints:Number.isInteger(r.hints)&&r.hints>=0?r.hints:0,updatedAt:typeof r.updatedAt==='string'?r.updatedAt:new Date().toISOString()}));await transaction('progress','readwrite',store=>incoming.forEach(r=>store.put(r)));records=await loadRecords();if(parsed.cursors&&typeof parsed.cursors==='object'){for(let n=1;n<=7;n++){const position=parsed.cursors[n];if(Number.isInteger(position)&&position>=0&&position<50)cursors[n]=position}await saveCursors()}field.classList.remove('error');field.textContent=`${incoming.length}語の記録を読み込みました。`;e.target.value=''}catch(error){field.classList.add('error');field.textContent=`読み込めませんでした：${error.message}`}}
function render(){if(view==='home')renderHome();else if(view==='practice')renderPractice();else if(view==='list')renderList();else renderSettings()}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
(async()=>{try{const [response,database]=await Promise.all([fetch('words.json'),openDB()]);if(!response.ok)throw Error('単語データを読み込めませんでした。');words=await response.json();db=database;[records,cursors,session]=await Promise.all([loadRecords(),loadCursors(),loadSession()]);if(session&&(!Array.isArray(session.ids)||session.ids.some(id=>!getWord(id))))session=null;if(session?.shown&&!session.assessed){session.shown=false;await saveSession()}render();if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{})}catch(error){app.innerHTML=`<div class="panel error">読み込みに失敗しました。ページを再読み込みしてください。${escapeHTML(error.message)}</div>`}})();
