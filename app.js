// ============================================================
//  app.js  —  Raises Lab OMS Phase 1 v3.1
//  修正内容:
//  - 製品・資材シート → 全画面表示
//  - 画像アップロード（ファイル選択 + ドラッグ&ドロップ + Ctrl+V貼り付け）
//  - 資材シート行を可変（追加・削除ボタン）
//  - Col.1〜7 → コード（上段）＋カラー名（下段）の2段自由入力に変更
//  - 製品シートにカラー登録欄を追加（Col.1〜7）
//  - 仕入先 → 仕入先マスタから選択
//  - 品番・品名欄を拡張
//  - ロス・単価をシンプル数字入力
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwKxypPrqzxHtac7V4vGtvdYi11Vd8PfhJTS3PqMztyQbuIIzGWQzgsb_iLyt55NxDh/exec'; // ← GASデプロイURLを入れる

// ===== 状態 =====
let _token   = localStorage.getItem('rl_token') || null;
let _user    = JSON.parse(localStorage.getItem('rl_user') || 'null');
let _masters = { colors: [], sizes: [], suppliers: [], materials: [] };
let _currentProduct = null;
let _currentFsTab   = 'product';
let _productPage    = 1;
let _materialRows   = [];
let _productImages  = ['','','','','',''];
let _productColors  = Array(7).fill(null).map(()=>({code:'',name:''})); // 製品カラー Col.1〜7

const STATUS_LABELS = {
  draft:'下書き', sampling:'サンプル中', bulk_order:'資材発注',
  in_production:'生産中', completed:'完成', cancelled:'中止',
};
const SEASONS = ['26AW','26SS','26HO','25AW','25SS','27AW','27SS'];
const ITEMS = [
  {code:'JK',name:'ジャケット'},{code:'PT',name:'パンツ'},{code:'OP',name:'ワンピース'},
  {code:'SK',name:'スカート'}, {code:'TS',name:'Tシャツ'},{code:'SH',name:'シャツ'},
  {code:'CT',name:'コート'},   {code:'KN',name:'ニット'}, {code:'BL',name:'ブルゾン'},
  {code:'CB',name:'カーディガン'},{code:'SW',name:'スウェット'},{code:'OT',name:'その他'},
];
const CATEGORIES = ['生地','裏地','芯地','副資材','下げ札等','その他'];
const UNITS = ['m','個','枚','本','組','式','yd','kg','g'];

// ===== API（GETパラメータ方式） =====
async function api(action, body = {}) {
  showLoading(true);
  try {
    const payload = JSON.stringify({ action, token: _token, ...body });
    const url     = GAS_URL + '?payload=' + encodeURIComponent(payload);
    const res     = await fetch(url, { method: 'GET' });
    const text    = await res.text();
    const data    = JSON.parse(text);
    if (!data.ok && data.error === 'UNAUTHORIZED') { forceLogout(); return null; }
    return data;
  } catch (e) {
    console.error('API Error:', e);
    toast('通信エラーが発生しました', 'error');
    return null;
  } finally {
    showLoading(false);
  }
}

// ===== UI Helpers =====
function showLoading(v) { document.getElementById('loading').classList.toggle('show', v); }
function toast(msg, type = 'default') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function statusBadge(s) {
  return '<span class="badge badge-' + s + '">' + (STATUS_LABELS[s] || s) + '</span>';
}
function nokiCounter(d) {
  if (!d) return '';
  const days = Math.round((new Date(d) - new Date()) / 86400000);
  const cls  = days > 30 ? 'noki-green' : days >= 0 ? 'noki-yellow' : 'noki-red';
  return '<span class="noki-counter ' + cls + '">納期 ' + days + '日</span>';
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== ページ切替 =====
function showPage(name) {
  document.querySelectorAll('#topbar nav button').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');
  const main = document.getElementById('main');
  if (name === 'products') renderProductsPage(main);
  if (name === 'masters')  renderMastersPage(main);
}

// ===== Auth =====
async function doLogin() {
  const username = document.getElementById('l-user').value.trim();
  const password = document.getElementById('l-pass').value;
  if (!username || !password) return;
  const errEl = document.getElementById('l-error');
  errEl.style.display = 'none';
  showLoading(true);
  try {
    const payload = JSON.stringify({ action:'login', username, password });
    const url     = GAS_URL + '?payload=' + encodeURIComponent(payload);
    const res     = await fetch(url, { method:'GET' });
    const data    = await res.json();
    if (data.ok) {
      _token = data.token; _user = data.user;
      localStorage.setItem('rl_token', _token);
      localStorage.setItem('rl_user', JSON.stringify(_user));
      bootApp();
    } else {
      errEl.textContent = data.error || 'ログインに失敗しました';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = '通信エラー: ' + e.message;
    errEl.style.display = 'block';
  } finally { showLoading(false); }
}
async function doLogout() { await api('logout'); forceLogout(); }
function forceLogout() {
  _token = null; _user = null;
  localStorage.removeItem('rl_token'); localStorage.removeItem('rl_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').classList.add('show');
}

// ===== Boot =====
async function bootApp() {
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-disp').textContent = _user?.display_name || _user?.username || '';
  const [c, s, sup, mat] = await Promise.all([
    api('colors.list'), api('sizes.list'), api('suppliers.list'), api('materials.list'),
  ]);
  if (c)   _masters.colors    = c.items || [];
  if (s)   _masters.sizes     = s.items || [];
  if (sup) _masters.suppliers = sup.items || [];
  if (mat) _masters.materials = mat.items || [];
  showPage('products');
}

// ===== 品番一覧 =====
let _searchTimer = null;
function renderProductsPage(main) {
  main.innerHTML = `
    <div class="page-header">
      <h1>品番一覧</h1>
      <div class="actions"><button class="btn btn-primary" onclick="openNewProductForm()">＋ 新規品番</button></div>
    </div>
    <div class="search-bar">
      <input type="text" id="s-q" placeholder="品番・品名・ブランドで検索..." oninput="triggerSearch()">
      <select id="s-status" onchange="loadProducts()">
        <option value="">全ステータス</option>
        ${Object.entries(STATUS_LABELS).map(([v,l]) => '<option value="'+v+'">'+l+'</option>').join('')}
      </select>
      <select id="s-season" onchange="loadProducts()">
        <option value="">全シーズン</option>
        ${SEASONS.map(s => '<option value="'+s+'">'+s+'</option>').join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">クリア</button>
    </div>
    <div id="product-grid-area"></div>
    <div id="pagination-area"></div>`;
  _productPage = 1; loadProducts();
}
function triggerSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _productPage = 1; loadProducts(); }, 350);
}
function clearSearch() {
  ['s-q','s-status','s-season'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  _productPage = 1; loadProducts();
}
async function loadProducts() {
  const search = document.getElementById('s-q')?.value || '';
  const status = document.getElementById('s-status')?.value || '';
  const season = document.getElementById('s-season')?.value || '';
  const res = await api('products.list', { search, status, season, page: _productPage, per: 24 });
  if (!res) return;
  const area = document.getElementById('product-grid-area');
  if (!area) return;
  if (!res.items || res.items.length === 0) {
    area.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>品番が登録されていません</p><button class="btn btn-primary" style="margin-top:16px" onclick="openNewProductForm()">＋ 新規品番を登録</button></div>';
    document.getElementById('pagination-area').innerHTML = '';
    return;
  }
  area.innerHTML = '<div class="product-grid">' + res.items.map(productCard).join('') + '</div>';
  renderPagination(res.total, _productPage, 24);
}
function productCard(p) {
  const img = p.image_url_1 ? '<img src="'+esc(p.image_url_1)+'" alt="" loading="lazy">' : '<div class="no-img">🧥</div>';
  return '<div class="product-card" onclick="openProduct(\''+esc(p.style_code)+'\')">' +
    '<div class="thumb">'+img+'</div>' +
    '<div class="body">' +
      '<div class="style-code">'+esc(p.style_code)+'</div>' +
      '<div class="brand-no">'+(esc(p.brand_product_no)||'（品番未設定）')+'</div>' +
      '<div class="name">'+esc(p.product_name||'')+(p.brand?' / '+esc(p.brand):'')+'</div>' +
      '<div class="meta">'+statusBadge(p.status)+'<span style="font-size:11px;color:var(--c-text2)">'+esc(p.year||'')+esc(p.season||'')+'</span>'+nokiCounter(p.delivery_date)+'</div>' +
    '</div></div>';
}
function renderPagination(total, page, per) {
  const pages = Math.ceil(total/per);
  const area  = document.getElementById('pagination-area');
  if (!area||pages<=1) { if(area) area.innerHTML=''; return; }
  let html = '<div class="pagination">';
  html += '<button onclick="goPage('+(page-1)+')" '+(page<=1?'disabled':'')+'>‹</button>';
  for (let i=1; i<=pages; i++) {
    if (pages>7&&Math.abs(i-page)>2&&i!==1&&i!==pages) { if(i===2||i===pages-1) html+='<button disabled>…</button>'; continue; }
    html += '<button class="'+(i===page?'active':'')+'" onclick="goPage('+i+')">'+i+'</button>';
  }
  html += '<button onclick="goPage('+(page+1)+')" '+(page>=pages?'disabled':'')+'>›</button></div>';
  html += '<div style="text-align:center;font-size:12px;color:var(--c-text3);margin-top:6px">'+total+'件</div>';
  area.innerHTML = html;
}
function goPage(p) { _productPage = p; loadProducts(); }

// ===== 全画面モーダル =====
function openFull(title) {
  document.getElementById('fs-title').textContent = title;
  document.getElementById('fullscreen-modal').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeFull() {
  document.getElementById('fullscreen-modal').classList.remove('show');
  document.body.style.overflow = '';
  _currentProduct = null;
  loadProducts();
}

// ===== 新規品番 =====
function openNewProductForm() {
  _currentProduct = null;
  _productImages  = ['','','','','',''];
  _productColors  = Array(7).fill(null).map(()=>({code:'',name:''}));
  document.getElementById('fs-badge').innerHTML   = '';
  document.getElementById('fs-tabs').innerHTML    = '';
  document.getElementById('fs-actions').innerHTML = '';
  document.getElementById('fs-footer').innerHTML  =
    '<button class="btn btn-secondary" onclick="closeFull()">キャンセル</button>' +
    '<button class="btn btn-primary" onclick="saveNewProduct()">登録する</button>';
  document.getElementById('fs-body').innerHTML = renderProductForm(null);
  setupImagePaste();
  openFull('新規品番の登録');
}

// ===== 品番詳細 =====
async function openProduct(style_code) {
  const res = await api('products.get', { style_code });
  if (!res||!res.ok) { toast('取得に失敗しました','error'); return; }
  _currentProduct = res.item;
  _productImages  = [
    res.item.image_url_1||'', res.item.image_url_2||'',
    res.item.image_url_3||'', res.item.image_url_4||'',
    res.item.image_url_5||'', res.item.image_url_6||'',
  ];
  // 製品カラー読み込み
  _productColors = Array(7).fill(null).map((_,i) => ({
    code: res.item['product_color'+(i+1)+'_code'] || '',
    name: res.item['product_color'+(i+1)+'_name'] || '',
  }));
  _currentFsTab = 'product';
  document.getElementById('fs-badge').innerHTML = statusBadge(res.item.status);
  document.getElementById('fs-tabs').innerHTML =
    '<button class="fs-tab active" id="fstab-product"   onclick="switchFsTab(\'product\')">📋 製品シート</button>' +
    '<button class="fs-tab"        id="fstab-materials" onclick="switchFsTab(\'materials\')">🧵 資材シート</button>';
  document.getElementById('fs-footer').innerHTML =
    '<button class="btn btn-secondary" onclick="closeFull()">閉じる</button>' +
    '<button class="btn btn-primary"   onclick="saveFsTab()">保存する</button>';
  document.getElementById('fs-body').innerHTML = renderProductForm(_currentProduct);
  setupImagePaste();
  openFull(res.item.brand_product_no || res.item.style_code);
}

function switchFsTab(tab) {
  _currentFsTab = tab;
  document.querySelectorAll('.fs-tab').forEach(t => t.classList.remove('active'));
  const btn = document.getElementById('fstab-' + tab);
  if (btn) btn.classList.add('active');
  if (tab === 'product')   { document.getElementById('fs-body').innerHTML = renderProductForm(_currentProduct); setupImagePaste(); }
  if (tab === 'materials') renderMaterialsTab();
}
async function saveFsTab() {
  if (_currentFsTab === 'product')   await saveProductData();
  if (_currentFsTab === 'materials') await saveMaterialsData();
}

// ===== 製品フォーム =====
function renderProductForm(p) {
  const imgSlots = _productImages.map((url, i) =>
    '<div class="image-slot" id="imgslot-'+i+'" onclick="triggerImgUpload('+i+')" ondragover="event.preventDefault()" ondrop="handleImgDrop(event,'+i+')">' +
    (url ? '<img id="imgprev-'+i+'" src="'+esc(url)+'" alt="">' : '<div class="img-placeholder">📷</div><div class="img-label">写真 '+(i+1)+'</div>') +
    '<div class="img-overlay"><button class="btn btn-sm" style="background:#fff;color:#333;font-size:11px" onclick="event.stopPropagation();clearImg('+i+')">削除</button></div>' +
    '<input type="file" id="imgfile-'+i+'" accept="image/*" style="display:none" onchange="handleImgFile(event,'+i+')">' +
    '</div>'
  ).join('');

  // 製品カラー登録（Col.1〜7）
  const colorRows = _productColors.map((c, i) =>
    '<div style="display:grid;grid-template-columns:28px 1fr 1fr;gap:6px;align-items:center;margin-bottom:6px">' +
    '<div style="font-size:11px;font-weight:600;color:var(--c-text2);text-align:center">'+( i+1)+'</div>' +
    '<input type="text" id="pc-code-'+i+'" value="'+esc(c.code)+'" placeholder="カラーコード" style="font-size:12px">' +
    '<input type="text" id="pc-name-'+i+'" value="'+esc(c.name)+'" placeholder="カラー名（例: ブラック）" style="font-size:12px">' +
    '</div>'
  ).join('');

  return '<div style="display:grid;grid-template-columns:1fr 320px;gap:24px;align-items:start">' +
  '<div>' +
  '<div class="section-card"><h3>📦 基本情報</h3>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>お客様品番 ★</label><input type="text" id="f-brand-no" value="'+esc(p?.brand_product_no||'')+'" placeholder="例: K1709LJ046EK"></div>' +
  '<div class="form-group"><label>仮品番</label><input type="text" id="f-temp-no" value="'+esc(p?.temp_product_no||'')+'" placeholder="仮品番"></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>品名（日本語）</label><input type="text" id="f-name-ja" value="'+esc(p?.product_name||'')+'" placeholder="品名"></div>' +
  '<div class="form-group"><label>品名（英語）</label><input type="text" id="f-name-en" value="'+esc(p?.product_name_en||'')+'" placeholder="Product Name"></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>ブランド</label><input type="text" id="f-brand" value="'+esc(p?.brand||'')+'" placeholder="ブランド名"></div>' +
  '<div class="form-group"><label>取引先コード（SKU用）</label><input type="text" id="f-client-id" value="'+esc(p?.client_id||'')+'" placeholder="例: TK" maxlength="4" style="text-transform:uppercase"></div></div>' +
  '<div class="form-row form-row-3">' +
  '<div class="form-group"><label>アイテム</label><select id="f-item-code">'+ITEMS.map(i=>'<option value="'+i.code+'" '+(p?.item_code===i.code?'selected':'')+'>'+i.code+' '+i.name+'</option>').join('')+'</select></div>' +
  '<div class="form-group"><label>年度</label><select id="f-year">'+['2026','2027','2025'].map(y=>'<option value="'+y.slice(-2)+'" '+(p?.year===y.slice(-2)?'selected':'')+'>'+y+'</option>').join('')+'</select></div>' +
  '<div class="form-group"><label>シーズン</label><select id="f-season">'+[['AW','秋冬'],['SS','春夏'],['HO','Holiday'],['RE','Resort'],['NS','通年']].map(([v,l])=>'<option value="'+v+'" '+(p?.season===v?'selected':'')+'>'+v+' '+l+'</option>').join('')+'</select></div>' +
  '</div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>サイズ展開</label><input type="text" id="f-size-range" value="'+esc(p?.size_range||'')+'" placeholder="例: S/M/L/XL"></div>' +
  '<div class="form-group"><label>原産国</label><input type="text" id="f-country" value="'+esc(p?.country_of_origin||'')+'" placeholder="日本、中国、ベトナム 等"></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>パタンナー</label><input type="text" id="f-patternmaker" value="'+esc(p?.patternmaker||'')+'" placeholder="パタンナー名"></div>' +
  '<div class="form-group"><label>パターンNo.</label><input type="text" id="f-pattern-no" value="'+esc(p?.pattern_no||'')+'" placeholder="パターンNo."></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>サンプルNo.</label><input type="text" id="f-sample-no" value="'+esc(p?.sample_no||'')+'" placeholder="サンプルNo."></div>' +
  '<div class="form-group"><label>縫製工場</label><input type="text" id="f-factory" value="'+esc(p?.factory_name||'')+'" placeholder="工場名"></div></div>' +
  '<div class="form-row form-row-2"><div class="form-group"><label>製品納期</label><input type="date" id="f-delivery" value="'+esc(p?.delivery_date||'')+'"></div>' +
  '<div class="form-group"><label>ステータス</label><select id="f-status">'+Object.entries(STATUS_LABELS).map(([v,l])=>'<option value="'+v+'" '+(p?.status===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div></div>' +
  '<div class="form-group"><label>コメント・備考</label><textarea id="f-memo">'+esc(p?.memo||'')+'</textarea></div>' +
  '</div></div>' +
  '<div><div class="section-card"><h3>📷 写真</h3>' +
  '<p style="font-size:12px;color:var(--c-text2);margin-bottom:12px">クリック・ドラッグ&ドロップ・Ctrl+Vで追加（最大6枚）</p>' +
  '<div class="image-grid">'+imgSlots+'</div></div>' +
  '<div class="section-card" style="margin-top:16px"><h3>🎨 製品カラー登録</h3>' +
  '<div style="display:grid;grid-template-columns:28px 1fr 1fr;gap:6px;margin-bottom:8px">' +
  '<div></div><div style="font-size:11px;font-weight:600;color:var(--c-text2)">カラーコード</div><div style="font-size:11px;font-weight:600;color:var(--c-text2)">カラー名</div></div>' +
  colorRows +
  '<p style="font-size:11px;color:var(--c-text3);margin-top:8px">※ 取引先・工場でのカラー呼称を自由に登録</p>' +
  '</div></div>' +
  '</div>';
}

function collectProductForm() {
  const g = id => document.getElementById(id)?.value || '';
  // 製品カラー収集
  const colorFields = {};
  for (let i = 0; i < 7; i++) {
    colorFields['product_color'+(i+1)+'_code'] = document.getElementById('pc-code-'+i)?.value || '';
    colorFields['product_color'+(i+1)+'_name'] = document.getElementById('pc-name-'+i)?.value || '';
  }
  return {
    brand_product_no: g('f-brand-no'), temp_product_no: g('f-temp-no'),
    product_name: g('f-name-ja'), product_name_en: g('f-name-en'),
    brand: g('f-brand'), client_id: g('f-client-id').toUpperCase(),
    item_code: g('f-item-code'), item_name: (ITEMS.find(i=>i.code===g('f-item-code'))||{}).name||'',
    year: g('f-year'), season: g('f-season'), size_range: g('f-size-range'),
    country_of_origin: g('f-country'), patternmaker: g('f-patternmaker'),
    pattern_no: g('f-pattern-no'), sample_no: g('f-sample-no'),
    factory_name: g('f-factory'), delivery_date: g('f-delivery'),
    status: g('f-status'), memo: g('f-memo'),
    image_url_1: _productImages[0]||'', image_url_2: _productImages[1]||'',
    image_url_3: _productImages[2]||'', image_url_4: _productImages[3]||'',
    image_url_5: _productImages[4]||'', image_url_6: _productImages[5]||'',
    ...colorFields,
  };
}
async function saveNewProduct() {
  const data = collectProductForm();
  if (!data.brand_product_no && !data.product_name) { toast('品番または品名を入力してください','error'); return; }
  const res = await api('products.create', data);
  if (!res) return;
  if (!res.ok) { toast(res.error||'登録に失敗しました','error'); return; }
  toast('登録しました（'+res.style_code+'）','success');
  closeFull();
}
async function saveProductData() {
  const data = collectProductForm();
  const res  = await api('products.update', { style_code: _currentProduct.style_code, ...data });
  if (!res) return;
  if (!res.ok) { toast(res.error||'保存に失敗しました','error'); return; }
  toast('保存しました','success');
  Object.assign(_currentProduct, data);
  document.getElementById('fs-badge').innerHTML = statusBadge(data.status);
  document.getElementById('fs-title').textContent = data.brand_product_no || _currentProduct.style_code;
}

// ===== 画像処理 =====
function triggerImgUpload(i) { document.getElementById('imgfile-'+i).click(); }
function handleImgFile(event, i) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => setImage(i, e.target.result);
  reader.readAsDataURL(file);
}
function handleImgDrop(event, i) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => setImage(i, e.target.result);
  reader.readAsDataURL(file);
}
function setImage(i, dataUrl) {
  _productImages[i] = dataUrl;
  const slot = document.getElementById('imgslot-'+i);
  if (!slot) return;
  slot.innerHTML =
    '<img id="imgprev-'+i+'" src="'+dataUrl+'" alt="">' +
    '<div class="img-overlay"><button class="btn btn-sm" style="background:#fff;color:#333;font-size:11px" onclick="event.stopPropagation();clearImg('+i+')">削除</button></div>' +
    '<input type="file" id="imgfile-'+i+'" accept="image/*" style="display:none" onchange="handleImgFile(event,'+i+')">';
}
function clearImg(i) {
  _productImages[i] = '';
  const slot = document.getElementById('imgslot-'+i);
  if (slot) slot.innerHTML =
    '<div class="img-placeholder">📷</div><div class="img-label">写真 '+(i+1)+'</div>' +
    '<div class="img-overlay"></div>' +
    '<input type="file" id="imgfile-'+i+'" accept="image/*" style="display:none" onchange="handleImgFile(event,'+i+')">';
}
let _pasteHandler = null;
function setupImagePaste() {
  if (_pasteHandler) document.removeEventListener('paste', _pasteHandler);
  _pasteHandler = (e) => {
    const items = e.clipboardData?.items; if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const emptyIdx = _productImages.findIndex(u => !u);
        if (emptyIdx < 0) { toast('画像スロットが満杯です（最大6枚）','error'); return; }
        const reader = new FileReader();
        reader.onload = ev => { setImage(emptyIdx, ev.target.result); toast('写真'+(emptyIdx+1)+'に貼り付けました','success'); };
        reader.readAsDataURL(item.getAsFile());
        break;
      }
    }
  };
  document.addEventListener('paste', _pasteHandler);
}

// ===== 資材シート =====
async function renderMaterialsTab() {
  const res = await api('product_materials.get', { style_code: _currentProduct.style_code });
  _materialRows = res?.items || [];
  if (_materialRows.length === 0) {
    for (let i = 0; i < 10; i++) _materialRows.push({ material_slot: String(i+1).padStart(2,'0') });
  }

  const colorOpts = '<option value="">-</option>' + _masters.colors.map(c =>
    '<option value="'+esc(c.color_code)+'">'+esc(c.color_code)+' '+esc(c.color_name_ja)+'</option>'
  ).join('');
  const supOpts = '<option value="">-</option>' + _masters.suppliers.map(s =>
    '<option value="'+esc(s.supplier_name)+'">'+esc(s.supplier_name)+'</option>'
  ).join('');

  document.getElementById('fs-body').innerHTML =
    '<div style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<code style="font-family:monospace;background:var(--c-bg);padding:2px 8px;border-radius:4px;font-size:12px">'+esc(_currentProduct.style_code)+'</code>' +
    '<button class="btn btn-secondary btn-sm" onclick="addMatRow()">＋ 行を追加</button>' +
    '<div style="margin-left:auto;font-size:13px">着単価合計: <strong id="mat-total" style="font-size:16px;color:var(--c-primary)">-</strong></div>' +
    '</div>' +
    '<datalist id="mat-namelist">'+_masters.materials.map(m=>'<option value="'+esc(m.product_name)+'">').join('')+'</datalist>' +
    '<div class="material-table-wrap"><table class="material-table"><thead><tr>' +
    '<th style="width:32px">No.</th><th style="min-width:180px">品名</th><th style="min-width:140px">品番</th>' +
    '<th style="min-width:100px">規格</th><th style="width:90px">分類</th><th style="min-width:100px">使用箇所</th>' +
    '<th style="width:65px">要尺</th><th style="width:55px">単位</th>' +
    '<th style="min-width:130px">Col.1<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.2<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.3<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.4<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.5<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.6<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="min-width:130px">Col.7<br><span style="font-size:9px;font-weight:400">コード / カラー名</span></th>' +
    '<th style="width:60px">ロス%</th><th style="width:75px">単価(円)</th><th style="width:80px">着単価</th>' +
    '<th style="min-width:130px">仕入先</th><th style="min-width:110px">メモ</th><th style="width:30px"></th>' +
    '</tr></thead><tbody id="mat-tbody"></tbody></table></div>';

  const tbody = document.getElementById('mat-tbody');
  _materialRows.forEach((r, idx) => appendMatRow(tbody, r, idx, colorOpts, supOpts));
  calcMatTotals();
}

function appendMatRow(tbody, r, idx, _unused1, supOpts) {
  if (!supOpts) {
    supOpts = '<option value="">-</option>' + _masters.suppliers.map(s =>
      '<option value="'+esc(s.supplier_name)+'">'+esc(s.supplier_name)+'</option>').join('');
  }

  // Col.1〜7：コード（上段）＋カラー名（下段）の2段自由入力
  const colCell = (n) => {
    const code = esc(r['color'+n+'_code']||'');
    const name = esc(r['color'+n+'_name']||'');
    return '<td style="padding:3px 4px;min-width:120px">' +
      '<input type="text" data-r="'+idx+'" data-f="color'+n+'_code" value="'+code+'" placeholder="コード" style="font-size:11px;border-bottom:none;border-radius:4px 4px 0 0;border-color:var(--c-border)">' +
      '<input type="text" data-r="'+idx+'" data-f="color'+n+'_name" value="'+name+'" placeholder="カラー名" style="font-size:11px;border-radius:0 0 4px 4px;margin-top:-1px;border-color:var(--c-border)">' +
      '</td>';
  };

  const selSup = () => {
    const val = esc(r.supplier_name||'');
    return '<select data-r="'+idx+'" data-f="supplier_name" style="font-size:11px;width:100%">' +
      supOpts.replace('value="'+val+'"', 'value="'+val+'" selected') + '</select>';
  };

  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  tr.innerHTML =
    '<td class="slot-cell">'+(idx+1)+'</td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="product_name" value="'+esc(r.product_name||'')+'" placeholder="品名" list="mat-namelist" style="min-width:160px"></td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="product_no"   value="'+esc(r.product_no||'')+'"   placeholder="品番" style="min-width:120px"></td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="spec"         value="'+esc(r.spec||'')+'"         placeholder="規格"></td>' +
    '<td><select data-r="'+idx+'" data-f="category" style="font-size:11px;width:100%">'+
      CATEGORIES.map(c=>'<option value="'+c+'" '+(r.category===c?'selected':'')+'>'+c+'</option>').join('')+'</select></td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="usage_location" value="'+esc(r.usage_location||'')+'" placeholder="使用箇所"></td>' +
    '<td><input type="number" step="0.01" data-r="'+idx+'" data-f="usage_quantity" value="'+esc(r.usage_quantity||'')+'" placeholder="0" oninput="calcRowPrice('+idx+')" style="width:60px;text-align:right"></td>' +
    '<td><select data-r="'+idx+'" data-f="unit" style="font-size:11px;width:52px">'+UNITS.map(u=>'<option value="'+u+'" '+(r.unit===u?'selected':'')+'>'+u+'</option>').join('')+'</select></td>' +
    colCell(1)+colCell(2)+colCell(3)+colCell(4)+colCell(5)+colCell(6)+colCell(7) +
    '<td><input type="number" step="0.1" data-r="'+idx+'" data-f="loss_rate"  value="'+esc(r.loss_rate||'')+'"  placeholder="0" style="width:55px;text-align:right"></td>' +
    '<td><input type="number" step="1"   data-r="'+idx+'" data-f="unit_price" value="'+esc(r.unit_price||'')+'" placeholder="0" oninput="calcRowPrice('+idx+')" style="width:68px;text-align:right"></td>' +
    '<td id="rowprice-'+idx+'" style="text-align:right;font-weight:600;font-size:12px;color:var(--c-primary);padding-right:8px">'+(r.unit_price&&r.usage_quantity?Math.round(r.unit_price*r.usage_quantity).toLocaleString()+'円':'-')+'</td>' +
    '<td>'+selSup()+'</td>' +
    '<td><input type="text" data-r="'+idx+'" data-f="memo" value="'+esc(r.memo||'')+'" placeholder="メモ"></td>' +
    '<td><button class="del-btn" onclick="delMatRow('+idx+')" title="削除">✕</button></td>';
  tbody.appendChild(tr);
}

function addMatRow() {
  const idx = _materialRows.length;
  const row = { material_slot: String(idx+1).padStart(2,'0') };
  _materialRows.push(row);
  appendMatRow(document.getElementById('mat-tbody'), row, idx);
}

function delMatRow(idx) {
  _materialRows.splice(idx, 1);
  renderMaterialsTab();
}

function getMatField(idx, field) {
  const el = document.querySelector('[data-r="'+idx+'"][data-f="'+field+'"]');
  return el ? el.value : '';
}

function calcRowPrice(idx) {
  const qty   = parseFloat(getMatField(idx,'usage_quantity')) || 0;
  const price = parseFloat(getMatField(idx,'unit_price'))    || 0;
  const cell  = document.getElementById('rowprice-'+idx);
  if (cell) cell.textContent = qty&&price ? Math.round(qty*price).toLocaleString()+'円' : '-';
  calcMatTotals();
}
function calcMatTotals() {
  let total = 0;
  _materialRows.forEach((_,idx) => {
    total += (parseFloat(getMatField(idx,'usage_quantity'))||0) * (parseFloat(getMatField(idx,'unit_price'))||0);
  });
  const el = document.getElementById('mat-total');
  if (el) el.textContent = Math.round(total).toLocaleString() + '円';
}

async function saveMaterialsData() {
  const fields = ['product_name','product_no','spec','category','usage_location',
                  'usage_quantity','unit','loss_rate','unit_price','supplier_name','memo',
                  'color1_code','color1_name','color2_code','color2_name',
                  'color3_code','color3_name','color4_code','color4_name',
                  'color5_code','color5_name','color6_code','color6_name',
                  'color7_code','color7_name'];
  const rows = _materialRows.map((_,idx) => {
    const obj = { material_slot: String(idx+1).padStart(2,'0') };
    fields.forEach(f => { obj[f] = getMatField(idx,f); });
    return obj;
  }).filter(r => r.product_name || r.product_no);

  const res = await api('product_materials.save', { style_code: _currentProduct.style_code, rows });
  if (!res) return;
  if (!res.ok) { toast(res.error||'保存に失敗しました','error'); return; }
  toast('資材シートを保存しました','success');
}

// ===== マスタ管理 =====
function renderMastersPage(main) {
  main.innerHTML =
    '<div class="page-header"><h1>マスタ管理</h1></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">' +
    '<div class="card"><h3 style="font-size:15px;font-weight:700;margin-bottom:14px">🎨 カラーマスタ</h3><div id="color-master-body"></div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openAddColor()">＋ カラー追加</button></div>' +
    '<div class="card"><h3 style="font-size:15px;font-weight:700;margin-bottom:14px">📐 サイズマスタ</h3><div id="size-master-body"></div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openAddSize()">＋ サイズ追加</button></div>' +
    '</div>' +
    '<div class="card" style="margin-top:20px"><h3 style="font-size:15px;font-weight:700;margin-bottom:14px">🏭 仕入先マスタ</h3><div id="supplier-master-body"></div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openAddSupplier()">＋ 仕入先追加</button></div>' +
    '<div class="card" style="margin-top:20px"><h3 style="font-size:15px;font-weight:700;margin-bottom:14px">🧵 資材マスタ</h3>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px"><input type="text" id="mat-search" placeholder="品名・品番で検索..." style="max-width:260px" oninput="filterMaterials()"><button class="btn btn-secondary btn-sm" onclick="openAddMaterial()">＋ 資材追加</button></div>' +
    '<div id="material-master-body"></div></div>';
  renderColorMaster(); renderSizeMaster(); renderSupplierMaster(); renderMaterialMaster();
}

function renderColorMaster() {
  const el = document.getElementById('color-master-body'); if (!el) return;
  el.innerHTML = '<table class="master-table"><thead><tr><th>コード</th><th>カラー名</th><th>English</th><th>色見本</th></tr></thead><tbody>' +
    _masters.colors.map(c => '<tr><td><code>'+esc(c.color_code)+'</code></td><td>'+esc(c.color_name_ja)+'</td><td>'+esc(c.color_name_en)+'</td>' +
      '<td><span style="display:inline-block;width:22px;height:22px;border-radius:4px;background:'+esc(c.hex||'#ccc')+';border:1px solid var(--c-border)"></span></td></tr>').join('') +
    '</tbody></table>';
}
function renderSizeMaster() {
  const el = document.getElementById('size-master-body'); if (!el) return;
  el.innerHTML = '<table class="master-table"><thead><tr><th>サイズ名</th><th>グループ</th><th>表示順</th></tr></thead><tbody>' +
    _masters.sizes.map(s => '<tr><td><strong>'+esc(s.size_name)+'</strong></td><td>'+esc(s.size_group)+'</td><td>'+esc(s.sort_order)+'</td></tr>').join('') +
    '</tbody></table>';
}
function renderSupplierMaster() {
  const el = document.getElementById('supplier-master-body'); if (!el) return;
  el.innerHTML = '<table class="master-table"><thead><tr><th>仕入先名</th><th>種別</th><th>担当者</th><th>TEL</th><th>メール</th></tr></thead><tbody>' +
    _masters.suppliers.map(s => '<tr><td><strong>'+esc(s.supplier_name)+'</strong></td><td>'+esc(s.type||'')+'</td><td>'+esc(s.contact_name||'')+'</td><td>'+esc(s.tel||'')+'</td><td>'+esc(s.email||'')+'</td></tr>').join('') +
    '</tbody></table>' +
    (_masters.suppliers.length===0 ? '<p style="text-align:center;color:var(--c-text3);padding:20px">データがありません</p>' : '');
}
function renderMaterialMaster(filter) {
  const el = document.getElementById('material-master-body'); if (!el) return;
  const items = filter ? _masters.materials.filter(m=>(m.product_name||'').includes(filter)||(m.product_no||'').includes(filter)) : _masters.materials;
  el.innerHTML = '<table class="master-table"><thead><tr><th>ID</th><th>分類</th><th>品番</th><th>品名</th><th>規格</th><th>単位</th><th>単価</th><th>仕入先</th></tr></thead><tbody>' +
    items.map(m => '<tr><td><code style="font-size:11px">'+esc(m.material_id)+'</code></td><td>'+esc(m.category||'')+'</td><td>'+esc(m.product_no||'')+'</td><td>'+esc(m.product_name||'')+'</td><td>'+esc(m.spec||'')+'</td><td>'+esc(m.unit||'')+'</td><td>'+(m.unit_price?Number(m.unit_price).toLocaleString()+'円':'')+'</td><td>'+esc(m.supplier_name||'')+'</td></tr>').join('') +
    '</tbody></table>' + (items.length===0 ? '<p style="text-align:center;color:var(--c-text3);padding:20px">データがありません</p>' : '');
}
function filterMaterials() { renderMaterialMaster(document.getElementById('mat-search')?.value||''); }

async function openAddColor() {
  const code   = prompt('カラーコード（3文字英大文字 例: BEG）'); if (!code) return;
  const nameJa = prompt('カラー名（日本語 例: ベージュ）'); if (!nameJa) return;
  const nameEn = prompt('Color name (e.g. Beige)') || '';
  const hex    = prompt('HEXカラーコード（例: #C8B89A）') || '';
  const res = await api('colors.upsert', { color_code:code.toUpperCase(), color_name_ja:nameJa, color_name_en:nameEn, hex, sort_order:_masters.colors.length+1 });
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('カラーを追加しました','success');
  const c = await api('colors.list'); if (c) { _masters.colors = c.items; renderColorMaster(); }
}
async function openAddSize() {
  const name = prompt('サイズ名（例: 2XL / 38 / F）'); if (!name) return;
  const res = await api('sizes.upsert', { size_name:name, size_group:'adult', sort_order:_masters.sizes.length+1 });
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('サイズを追加しました','success');
  const s = await api('sizes.list'); if (s) { _masters.sizes = s.items; renderSizeMaster(); }
}
async function openAddSupplier() {
  const name = prompt('仕入先名'); if (!name) return;
  const type = prompt('種別（factory / trading / maker）') || 'factory';
  const tel  = prompt('TEL（任意）') || '';
  const mail = prompt('メールアドレス（任意）') || '';
  const res  = await api('suppliers.upsert', { supplier_name:name, type, tel, email:mail });
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('仕入先を追加しました','success');
  const s = await api('suppliers.list'); if (s) { _masters.suppliers = s.items; renderSupplierMaster(); }
}
async function openAddMaterial() {
  const name  = prompt('資材品名'); if (!name) return;
  const no    = prompt('品番（任意）') || '';
  const cat   = prompt('分類（生地/副資材/下げ札等）') || '';
  const unit  = prompt('単位（m/個/枚）') || 'm';
  const price = parseFloat(prompt('単価（円）')||'0');
  const sup   = prompt('仕入先名（任意）') || '';
  const res   = await api('materials.upsert', { product_name:name, product_no:no, category:cat, unit, unit_price:price, supplier_name:sup });
  if (!res||!res.ok) { toast('保存に失敗しました','error'); return; }
  toast('資材を追加しました','success');
  const m = await api('materials.list'); if (m) { _masters.materials = m.items; renderMaterialMaster(); }
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('l-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  if (_token && _user) { bootApp(); }
  else { document.getElementById('login-screen').classList.add('show'); }
});
