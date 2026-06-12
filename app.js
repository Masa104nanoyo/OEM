// ============================================================
//  app.js  —  Raises Lab OMS フロントエンド (Phase 1)
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwepUX6BdC1jd3kkrn5OVCxJ8eweRhRgYvEb0iXpCA2150zBIcfxUMzhNuuH1atKQ3ZLw/exec'; // ← GASデプロイURL を入れる

// ===== 状態 =====
let _token   = localStorage.getItem('rl_token') || null;
let _user    = JSON.parse(localStorage.getItem('rl_user') || 'null');
let _masters = { colors: [], sizes: [], suppliers: [], materials: [] };
let _currentProduct = null;
let _currentDrawerTab = 'product';
let _productPage = 1;
let _productTotal = 0;
const PER_PAGE = 24;

const STATUS_LABELS = {
  draft:         '下書き',
  sampling:      'サンプル中',
  bulk_order:    '資材発注',
  in_production: '生産中',
  completed:     '完成',
  cancelled:     '中止',
};
const SEASONS = ['26AW','26SS','26HO','25AW','25SS','27AW','27SS'];
const ITEMS = [
  {code:'JK',name:'ジャケット'},{code:'PT',name:'パンツ'},{code:'OP',name:'ワンピース'},
  {code:'SK',name:'スカート'},{code:'TS',name:'Tシャツ'},{code:'SH',name:'シャツ'},
  {code:'CT',name:'コート'},{code:'KN',name:'ニット'},{code:'BL',name:'ブルゾン'},
  {code:'CB',name:'カーディガン'},{code:'SW',name:'スウェット'},{code:'OT',name:'その他'},
];

// ===== API =====
async function api(action, body = {}) {
  showLoading(true);
  try {
    const params = new URLSearchParams();
    params.append('payload', JSON.stringify({ action, token: _token, ...body }));
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: params,
    });
    const text = await res.text();
    const data = JSON.parse(text);
    if (!data.ok && data.error === 'UNAUTHORIZED') { forceLogout(); return null; }
    return data;
  } catch (e) {
    console.error(e);
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
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function showPage(name) {
  document.querySelectorAll('#topbar nav button').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById(`nav-${name}`);
  if (nb) nb.classList.add('active');
  const main = document.getElementById('main');
  if (name === 'products') renderProductsPage(main);
  if (name === 'masters')  renderMastersPage(main);
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function nokiCounter(deliveryDate) {
  if (!deliveryDate) return '';
  const days = Math.round((new Date(deliveryDate) - new Date()) / 86400000);
  const cls = days > 30 ? 'noki-green' : days >= 0 ? 'noki-yellow' : 'noki-red';
  return `<span class="noki-counter ${cls}">納期 ${days}日</span>`;
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
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username, password }),
    });
    const data = await res.json();
    if (data.ok) {
      _token = data.token;
      _user  = data.user;
      localStorage.setItem('rl_token', _token);
      localStorage.setItem('rl_user', JSON.stringify(_user));
      bootApp();
    } else {
      errEl.textContent = data.error || 'ログインに失敗しました';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = '通信エラー';
    errEl.style.display = 'block';
  } finally {
    showLoading(false);
  }
}

async function doLogout() {
  await api('logout');
  forceLogout();
}

function forceLogout() {
  _token = null; _user = null;
  localStorage.removeItem('rl_token');
  localStorage.removeItem('rl_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').classList.add('show');
}

// ===== Boot =====
async function bootApp() {
  document.getElementById('login-screen').classList.remove('show');
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-disp').textContent = _user?.display_name || _user?.username || '';

  // マスタ一括ロード
  const [c, s, sup, mat] = await Promise.all([
    api('colors.list'),
    api('sizes.list'),
    api('suppliers.list'),
    api('materials.list'),
  ]);
  if (c)   _masters.colors    = c.items || [];
  if (s)   _masters.sizes     = s.items || [];
  if (sup) _masters.suppliers = sup.items || [];
  if (mat) _masters.materials = mat.items || [];

  showPage('products');

  // Enter key on login
  document.getElementById('l-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

// ===== 品番一覧ページ =====
let _searchTimer = null;

function renderProductsPage(main) {
  main.innerHTML = `
    <div class="page-header">
      <h1>品番一覧</h1>
      <div class="actions">
        <button class="btn btn-primary" onclick="openNewProduct()">＋ 新規品番</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="s-q" placeholder="品番・品名・ブランドで検索..." oninput="triggerSearch()">
      <select id="s-status" onchange="loadProducts()">
        <option value="">全ステータス</option>
        ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="s-season" onchange="loadProducts()">
        <option value="">全シーズン</option>
        ${SEASONS.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">クリア</button>
    </div>
    <div id="product-grid-area"></div>
    <div id="pagination-area"></div>
  `;
  _productPage = 1;
  loadProducts();
}

function triggerSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _productPage = 1; loadProducts(); }, 350);
}

function clearSearch() {
  document.getElementById('s-q').value = '';
  document.getElementById('s-status').value = '';
  document.getElementById('s-season').value = '';
  _productPage = 1;
  loadProducts();
}

async function loadProducts() {
  const search  = document.getElementById('s-q')?.value || '';
  const status  = document.getElementById('s-status')?.value || '';
  const season  = document.getElementById('s-season')?.value || '';

  const res = await api('products.list', {
    search, status, season, page: _productPage, per: PER_PAGE,
  });
  if (!res) return;

  _productTotal = res.total || 0;
  const area = document.getElementById('product-grid-area');
  if (!area) return;

  if (!res.items || res.items.length === 0) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="icon">📦</div>
        <p>品番が登録されていません</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="openNewProduct()">＋ 新規品番を登録</button>
      </div>`;
    document.getElementById('pagination-area').innerHTML = '';
    return;
  }

  area.innerHTML = `<div class="product-grid">${res.items.map(productCard).join('')}</div>`;
  renderPagination(res.total, _productPage, PER_PAGE);
}

function productCard(p) {
  const imgHtml = p.image_url_1
    ? `<img src="${p.image_url_1}" alt="" loading="lazy">`
    : `<div class="no-img">🧥</div>`;
  return `
    <div class="product-card" onclick="openProduct('${p.style_code}')">
      <div class="thumb">${imgHtml}</div>
      <div class="body">
        <div class="style-code">${p.style_code}</div>
        <div class="brand-no">${p.brand_product_no || '（品番未設定）'}</div>
        <div class="name">${p.product_name || ''} ${p.brand ? '/ ' + p.brand : ''}</div>
        <div class="meta">
          ${statusBadge(p.status)}
          <span class="season-tag">${p.year || ''}${p.season || ''}</span>
          ${nokiCounter(p.delivery_date)}
        </div>
      </div>
    </div>`;
}

function renderPagination(total, page, per) {
  const pages = Math.ceil(total / per);
  const area  = document.getElementById('pagination-area');
  if (!area || pages <= 1) { if (area) area.innerHTML = ''; return; }
  let html = `<div class="pagination">`;
  html += `<button onclick="goPage(${page-1})" ${page<=1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - page) > 2 && i !== 1 && i !== pages) {
      if (i === 2 || i === pages - 1) html += `<button disabled>…</button>`;
      continue;
    }
    html += `<button class="${i===page?'active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button onclick="goPage(${page+1})" ${page>=pages?'disabled':''}>›</button>`;
  html += `</div><div style="text-align:center;font-size:12px;color:var(--c-text3);margin-top:6px">${total}件</div>`;
  area.innerHTML = html;
}

function goPage(p) { _productPage = p; loadProducts(); }

// ===== ドロワー（詳細/新規） =====
function openDrawer(title) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-overlay').classList.add('show');
  document.getElementById('drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('show');
  document.getElementById('drawer').classList.remove('open');
  _currentProduct = null;
}

// ===== 新規品番 =====
function openNewProduct() {
  _currentProduct = null;
  document.getElementById('drawer-badge').innerHTML = '';
  document.getElementById('drawer-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="closeDrawer()">キャンセル</button>
    <button class="btn btn-primary" onclick="saveNewProduct()">登録する</button>
  `;
  document.getElementById('drawer-tabs').innerHTML = '';
  document.getElementById('drawer-body').innerHTML = renderProductForm(null);
  openDrawer('新規品番の登録');
}

function renderProductForm(p) {
  const isNew = !p;
  const colorOptions = _masters.colors.map(c =>
    `<option value="${c.color_code}">${c.color_code} ${c.color_name_ja}</option>`
  ).join('');
  const sizeOptions = _masters.sizes.map(s =>
    `<option value="${s.size_name}" ${isNew && s.size_name==='M'?'selected':''}>${s.size_name}</option>`
  ).join('');

  return `
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>お客様品番 ★</label>
      <input type="text" id="f-brand-no" value="${p?.brand_product_no||''}" placeholder="例: K1709LJ046EK">
    </div>
    <div class="form-group">
      <label>仮品番</label>
      <input type="text" id="f-temp-no" value="${p?.temp_product_no||''}" placeholder="仮品番">
    </div>
  </div>
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>品名（日本語）</label>
      <input type="text" id="f-name-ja" value="${p?.product_name||''}" placeholder="例: リップストップ ホスピタルジャケット">
    </div>
    <div class="form-group">
      <label>品名（英語）</label>
      <input type="text" id="f-name-en" value="${p?.product_name_en||''}" placeholder="Hospital Jacket">
    </div>
  </div>
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>ブランド</label>
      <input type="text" id="f-brand" value="${p?.brand||''}" placeholder="ブランド名">
    </div>
    <div class="form-group">
      <label>取引先コード（SKU生成用）</label>
      <input type="text" id="f-client-id" value="${p?.client_id||''}" placeholder="例: TK" maxlength="4" style="text-transform:uppercase">
    </div>
  </div>
  <div class="form-row form-row-3">
    <div class="form-group">
      <label>アイテム</label>
      <select id="f-item-code">
        ${ITEMS.map(i => `<option value="${i.code}" ${p?.item_code===i.code?'selected':''}>${i.code} ${i.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>年度</label>
      <select id="f-year">
        ${['2026','2027','2025'].map(y => `<option value="${y.slice(-2)}" ${p?.year===y.slice(-2)?'selected':''}>${y}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>シーズン</label>
      <select id="f-season">
        ${[['AW','秋冬'],['SS','春夏'],['HO','Holiday'],['RE','Resort'],['NS','通年']].map(
          ([v,l]) => `<option value="${v}" ${p?.season===v?'selected':''}>${v} ${l}</option>`
        ).join('')}
      </select>
    </div>
  </div>
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>サイズ展開</label>
      <input type="text" id="f-size-range" value="${p?.size_range||''}" placeholder="例: S/M/L/XL">
    </div>
    <div class="form-group">
      <label>原産国</label>
      <input type="text" id="f-country" value="${p?.country_of_origin||''}" placeholder="日本、中国、ベトナム 等">
    </div>
  </div>
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>パタンナー</label>
      <input type="text" id="f-patternmaker" value="${p?.patternmaker||''}" placeholder="パタンナー名">
    </div>
    <div class="form-group">
      <label>パターンNo.</label>
      <input type="text" id="f-pattern-no" value="${p?.pattern_no||''}" placeholder="パターンNo.">
    </div>
  </div>
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>サンプルNo.</label>
      <input type="text" id="f-sample-no" value="${p?.sample_no||''}" placeholder="サンプルNo.">
    </div>
    <div class="form-group">
      <label>縫製工場</label>
      <input type="text" id="f-factory" value="${p?.factory_name||''}" placeholder="工場名">
    </div>
  </div>
  <div class="form-row form-row-2">
    <div class="form-group">
      <label>製品納期</label>
      <input type="date" id="f-delivery" value="${p?.delivery_date||''}">
    </div>
    <div class="form-group">
      <label>ステータス</label>
      <select id="f-status">
        ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}" ${p?.status===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="form-group">
    <label>コメント・備考</label>
    <textarea id="f-memo">${p?.memo||''}</textarea>
  </div>
  `;
}

async function saveNewProduct() {
  const data = collectProductForm();
  if (!data.brand_product_no && !data.product_name) {
    toast('品番または品名を入力してください', 'error'); return;
  }
  const res = await api('products.create', data);
  if (!res) return;
  if (!res.ok) { toast(res.error || '登録に失敗しました', 'error'); return; }
  toast(`登録しました（${res.style_code}）`, 'success');
  closeDrawer();
  loadProducts();
}

function collectProductForm() {
  const g = id => document.getElementById(id)?.value || '';
  return {
    brand_product_no:  g('f-brand-no'),
    temp_product_no:   g('f-temp-no'),
    product_name:      g('f-name-ja'),
    product_name_en:   g('f-name-en'),
    brand:             g('f-brand'),
    client_id:         g('f-client-id').toUpperCase(),
    item_code:         g('f-item-code'),
    item_name:         ITEMS.find(i => i.code === g('f-item-code'))?.name || '',
    year:              g('f-year'),
    season:            g('f-season'),
    size_range:        g('f-size-range'),
    country_of_origin: g('f-country'),
    patternmaker:      g('f-patternmaker'),
    pattern_no:        g('f-pattern-no'),
    sample_no:         g('f-sample-no'),
    factory_name:      g('f-factory'),
    delivery_date:     g('f-delivery'),
    status:            g('f-status'),
    memo:              g('f-memo'),
  };
}

// ===== 品番詳細（編集） =====
async function openProduct(style_code) {
  const res = await api('products.get', { style_code });
  if (!res || !res.ok) { toast('取得に失敗しました', 'error'); return; }
  _currentProduct = res.item;
  _currentDrawerTab = 'product';
  renderProductDrawer();
  openDrawer(_currentProduct.brand_product_no || _currentProduct.style_code);
}

function renderProductDrawer() {
  const p = _currentProduct;
  document.getElementById('drawer-badge').innerHTML = statusBadge(p.status);
  document.getElementById('drawer-tabs').innerHTML = `
    <button class="drawer-tab active" id="dtab-product"  onclick="switchDrawerTab('product')">製品シート</button>
    <button class="drawer-tab"        id="dtab-materials" onclick="switchDrawerTab('materials')">資材シート</button>
  `;
  document.getElementById('drawer-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="closeDrawer()">閉じる</button>
    <button class="btn btn-primary" id="drawer-save-btn" onclick="saveCurrentTab()">保存する</button>
  `;
  switchDrawerTab('product');
}

function switchDrawerTab(tab) {
  _currentDrawerTab = tab;
  document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
  const btn = document.getElementById(`dtab-${tab}`);
  if (btn) btn.classList.add('active');

  if (tab === 'product')   renderProductTabBody();
  if (tab === 'materials') renderMaterialsTab();
}

function renderProductTabBody() {
  document.getElementById('drawer-body').innerHTML = renderProductForm(_currentProduct);
}

async function saveCurrentTab() {
  if (_currentDrawerTab === 'product') await saveProductEdit();
  if (_currentDrawerTab === 'materials') await saveMaterialsEdit();
}

async function saveProductEdit() {
  const data = collectProductForm();
  const res  = await api('products.update', {
    style_code: _currentProduct.style_code, ...data,
  });
  if (!res) return;
  if (!res.ok) { toast(res.error || '保存に失敗しました', 'error'); return; }
  toast('保存しました', 'success');
  Object.assign(_currentProduct, data);
  document.getElementById('drawer-badge').innerHTML = statusBadge(data.status);
  loadProducts();
}

// ===== 資材シート =====
let _materialRows = [];

async function renderMaterialsTab() {
  const res = await api('product_materials.get', { style_code: _currentProduct.style_code });
  _materialRows = res?.items || [];

  // 21スロット確保
  const slots = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
  const map   = {};
  _materialRows.forEach(r => { map[r.material_slot] = r; });

  const colorHeaders = _masters.colors.slice(0, 7).map((c, i) =>
    `<th title="${c.color_name_ja}">Col.${i+1}<br><span style="font-size:9px">${c.color_code}</span></th>`
  ).join('');

  const rows = slots.map(slot => {
    const r = map[slot] || { material_slot: slot };
    const bulkCols = Array.from({length: 7}, (_, i) =>
      `<td><input type="number" min="0" data-slot="${slot}" data-field="bulk_color${i+1}" value="${r[`bulk_color${i+1}`]||''}" placeholder="0"></td>`
    ).join('');
    return `
      <tr data-slot="${slot}">
        <td class="slot-cell">${slot}</td>
        <td>
          <input type="text" data-slot="${slot}" data-field="product_name" value="${r.product_name||''}" placeholder="品名" list="mat-list">
        </td>
        <td><input type="text" data-slot="${slot}" data-field="product_no" value="${r.product_no||''}" placeholder="品番"></td>
        <td><input type="text" data-slot="${slot}" data-field="spec" value="${r.spec||''}" placeholder="規格・サイズ"></td>
        <td>
          <select data-slot="${slot}" data-field="category" style="width:80px;font-size:11px">
            <option value="">-</option>
            ${['生地','裏地','芯地','副資材','下げ札等','その他'].map(c =>
              `<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`
            ).join('')}
          </select>
        </td>
        <td><input type="text" data-slot="${slot}" data-field="usage_location" value="${r.usage_location||''}" placeholder="使用箇所"></td>
        <td><input type="number" step="0.1" data-slot="${slot}" data-field="usage_quantity" value="${r.usage_quantity||''}" placeholder="0.0"></td>
        <td>
          <select data-slot="${slot}" data-field="unit" style="width:56px;font-size:11px">
            ${['m','個','枚','本','組','式','yd'].map(u =>
              `<option value="${u}" ${r.unit===u?'selected':''}>${u}</option>`
            ).join('')}
          </select>
        </td>
        ${bulkCols}
        <td><input type="number" step="0.1" data-slot="${slot}" data-field="loss_rate" value="${r.loss_rate||''}" placeholder="0"></td>
        <td><input type="number" step="0.01" data-slot="${slot}" data-field="unit_price" value="${r.unit_price||''}" placeholder="0" oninput="calcUnitPricePerPiece('${slot}')"></td>
        <td class="price-per-piece-${slot}" style="text-align:right;font-weight:600;font-size:12px">
          ${r.unit_price && r.usage_quantity ? Math.round(r.unit_price * r.usage_quantity) + '円' : '-'}
        </td>
        <td><input type="text" data-slot="${slot}" data-field="maker_name" value="${r.maker_name||''}" placeholder="メーカー"></td>
        <td><input type="text" data-slot="${slot}" data-field="supplier_name" value="${r.supplier_name||''}" placeholder="仕入先"></td>
        <td><input type="text" data-slot="${slot}" data-field="memo" value="${r.memo||''}" placeholder="メモ"></td>
      </tr>`;
  }).join('');

  // 資材名候補リスト
  const matList = `<datalist id="mat-list">${_masters.materials.map(m =>
    `<option value="${m.product_name}">`
  ).join('')}</datalist>`;

  document.getElementById('drawer-body').innerHTML = `
    ${matList}
    <p style="font-size:12px;color:var(--c-text2);margin-bottom:10px">
      スタイルコード: <code style="font-family:monospace;background:var(--c-bg);padding:2px 6px;border-radius:4px">${_currentProduct.style_code}</code>
      — 資材明細を入力してください。BULK発注数はカラー別に入力。着単価は自動計算されます。
    </p>
    <div style="overflow-x:auto">
    <table class="material-table">
      <thead>
        <tr>
          <th>No.</th><th>品名</th><th>品番</th><th>規格</th><th>分類</th>
          <th>使用箇所</th><th>要尺</th><th>単位</th>
          ${colorHeaders}
          <th>ロス%</th><th>単価</th><th>着単価</th><th>メーカー</th><th>仕入先</th><th>メモ</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <div style="margin-top:14px;padding:12px;background:var(--c-bg);border-radius:var(--radius);font-size:12px">
      <strong>着単価合計（資材）:</strong>
      <span id="mat-total-price" style="font-size:16px;font-weight:700;margin-left:8px">計算中...</span>
    </div>
  `;
  calcMatTotals();
}

function calcUnitPricePerPiece(slot) {
  const qty   = parseFloat(getSlotField(slot, 'usage_quantity')) || 0;
  const price = parseFloat(getSlotField(slot, 'unit_price'))    || 0;
  const cell  = document.querySelector(`.price-per-piece-${slot}`);
  if (cell) cell.textContent = qty && price ? Math.round(qty * price) + '円' : '-';
  calcMatTotals();
}

function calcMatTotals() {
  const slots = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
  let total = 0;
  slots.forEach(slot => {
    const qty   = parseFloat(getSlotField(slot, 'usage_quantity')) || 0;
    const price = parseFloat(getSlotField(slot, 'unit_price'))    || 0;
    total += qty * price;
  });
  const el = document.getElementById('mat-total-price');
  if (el) el.textContent = Math.round(total).toLocaleString() + '円';
}

function getSlotField(slot, field) {
  const el = document.querySelector(`[data-slot="${slot}"][data-field="${field}"]`);
  return el ? el.value : '';
}

async function saveMaterialsEdit() {
  const slots = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
  const rows  = slots.map(slot => {
    const fields = ['product_name','product_no','spec','category','usage_location',
                    'usage_quantity','unit','loss_rate','unit_price','maker_name',
                    'supplier_name','memo',
                    'bulk_color1','bulk_color2','bulk_color3','bulk_color4',
                    'bulk_color5','bulk_color6','bulk_color7'];
    const obj = { material_slot: slot };
    fields.forEach(f => { obj[f] = getSlotField(slot, f); });
    return obj;
  }).filter(r => r.product_name || r.product_no); // 空行は除外

  const res = await api('product_materials.save', {
    style_code: _currentProduct.style_code, rows,
  });
  if (!res) return;
  if (!res.ok) { toast(res.error || '保存に失敗しました', 'error'); return; }
  toast('資材シートを保存しました', 'success');
}

// ===== マスタ管理ページ =====
function renderMastersPage(main) {
  main.innerHTML = `
    <div class="page-header"><h1>マスタ管理</h1></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">🎨 カラーマスタ</h3>
        <div id="color-master-body"></div>
        <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openAddColor()">＋ カラー追加</button>
      </div>
      <div class="card">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">📐 サイズマスタ</h3>
        <div id="size-master-body"></div>
        <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="openAddSize()">＋ サイズ追加</button>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">🧵 資材マスタ</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="mat-search" placeholder="品名・品番で検索..." style="max-width:260px" oninput="filterMaterials()">
        <button class="btn btn-secondary btn-sm" onclick="openAddMaterial()">＋ 資材追加</button>
      </div>
      <div id="material-master-body"></div>
    </div>
  `;
  renderColorMaster();
  renderSizeMaster();
  renderMaterialMaster();
}

function renderColorMaster() {
  const el = document.getElementById('color-master-body');
  if (!el) return;
  el.innerHTML = `
    <table class="master-table">
      <thead><tr><th>コード</th><th>カラー名</th><th>English</th><th>色見本</th></tr></thead>
      <tbody>
        ${_masters.colors.map(c => `
          <tr>
            <td><code>${c.color_code}</code></td>
            <td>${c.color_name_ja}</td>
            <td>${c.color_name_en}</td>
            <td><span style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${c.hex||'#ccc'};border:1px solid var(--c-border)"></span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderSizeMaster() {
  const el = document.getElementById('size-master-body');
  if (!el) return;
  el.innerHTML = `
    <table class="master-table">
      <thead><tr><th>サイズ名</th><th>グループ</th><th>表示順</th></tr></thead>
      <tbody>
        ${_masters.sizes.map(s => `
          <tr>
            <td><strong>${s.size_name}</strong></td>
            <td>${s.size_group}</td>
            <td>${s.sort_order}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderMaterialMaster(filter = '') {
  const el = document.getElementById('material-master-body');
  if (!el) return;
  const items = filter
    ? _masters.materials.filter(m =>
        (m.product_name||'').includes(filter) || (m.product_no||'').includes(filter)
      )
    : _masters.materials;
  el.innerHTML = `
    <table class="master-table">
      <thead><tr><th>ID</th><th>分類</th><th>品番</th><th>品名</th><th>規格</th><th>単位</th><th>単価</th><th>仕入先</th></tr></thead>
      <tbody>
        ${items.map(m => `
          <tr>
            <td><code style="font-size:11px">${m.material_id}</code></td>
            <td>${m.category||''}</td>
            <td>${m.product_no||''}</td>
            <td>${m.product_name||''}</td>
            <td>${m.spec||''}</td>
            <td>${m.unit||''}</td>
            <td>${m.unit_price ? Number(m.unit_price).toLocaleString() + '円' : ''}</td>
            <td>${m.supplier_name||''}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${items.length === 0 ? '<p style="text-align:center;color:var(--c-text3);padding:20px">データがありません</p>' : ''}
  `;
}

function filterMaterials() {
  const q = document.getElementById('mat-search')?.value || '';
  renderMaterialMaster(q);
}

// ===== マスタ追加（シンプルモーダル） =====
function openAddColor() {
  const code = prompt('カラーコード（3文字英大文字 例: BEG）');
  if (!code) return;
  const nameJa = prompt('カラー名（日本語 例: ベージュ）');
  if (!nameJa) return;
  const nameEn = prompt('Color name (English e.g. Beige)') || '';
  const hex    = prompt('HEXカラーコード（例: #C8B89A）') || '';
  saveColor(code.toUpperCase(), nameJa, nameEn, hex);
}

async function saveColor(code, nameJa, nameEn, hex) {
  const res = await api('colors.upsert', {
    color_code: code, color_name_ja: nameJa, color_name_en: nameEn,
    hex, sort_order: _masters.colors.length + 1,
  });
  if (!res || !res.ok) { toast('保存に失敗しました', 'error'); return; }
  toast('カラーを追加しました', 'success');
  const c = await api('colors.list');
  if (c) { _masters.colors = c.items; renderColorMaster(); }
}

function openAddSize() {
  const name = prompt('サイズ名（例: 2XL / 38 / F）');
  if (!name) return;
  saveSize(name);
}

async function saveSize(name) {
  const res = await api('sizes.upsert', {
    size_name: name, size_group: 'adult', sort_order: _masters.sizes.length + 1,
  });
  if (!res || !res.ok) { toast('保存に失敗しました', 'error'); return; }
  toast('サイズを追加しました', 'success');
  const s = await api('sizes.list');
  if (s) { _masters.sizes = s.items; renderSizeMaster(); }
}

function openAddMaterial() {
  const name = prompt('資材品名');
  if (!name) return;
  const no   = prompt('品番（任意）') || '';
  const cat  = prompt('分類（生地/副資材/下げ札等 等）') || '';
  const unit = prompt('単位（m/個/枚 等）') || 'm';
  const price = parseFloat(prompt('単価（円）') || '0');
  const sup   = prompt('仕入先名（任意）') || '';
  saveMaterial({ product_name: name, product_no: no, category: cat, unit, unit_price: price, supplier_name: sup });
}

async function saveMaterial(fields) {
  const res = await api('materials.upsert', fields);
  if (!res || !res.ok) { toast('保存に失敗しました', 'error'); return; }
  toast('資材を追加しました', 'success');
  const m = await api('materials.list');
  if (m) { _masters.materials = m.items; renderMaterialMaster(); }
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('l-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  if (_token && _user) {
    bootApp();
  } else {
    document.getElementById('login-screen').classList.add('show');
  }
});
