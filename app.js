/* PM-INFO Dashboard — หน้าเว็บ (คำนวณสถิติทั้งหมดในเบราว์เซอร์จากข้อมูลที่ Apps Script ส่งมา) */
(() => {
  'use strict';

  // ============================================================ basics
  const API = (window.PM_CONFIG || {}).API_URL;
  const TOKEN_KEY = 'pm_info_token';
  const IS_MOCK = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('mock');

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const fp = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '0') + '%';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const countBy = (rows, f) => { const m = new Map(); rows.forEach((r) => { const k = f(r); m.set(k, (m.get(k) || 0) + 1); }); return m; };
  const groupBy = (rows, f) => { const m = new Map(); rows.forEach((r) => { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
  const thDate = (r) => (r.d && r.m ? `${String(r.d).padStart(2, '0')}/${String(r.m).padStart(2, '0')}/${r.y + 543}` : '-');

  const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์'];
  const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#65a30d', '#475569', '#be123c', '#0d9488', '#a16207', '#4f46e5', '#9333ea'];

  // ============================================================ business rules (แก้ตรงนี้ได้)
  const STATUS_GROUPS = [
    { key: 'ปิดการขาย', color: '#16a34a', open: false },
    { key: 'เสนอราคาแล้ว', color: '#2563eb', open: true },
    { key: 'ติดตามอยู่', color: '#0891b2', open: true },
    { key: 'ลูกค้าเงียบ', color: '#94a3b8', open: false },
    { key: 'เรายังไม่ตอบ', color: '#f59e0b', open: false },
    { key: 'ไม่ซื้อ', color: '#dc2626', open: false },
    { key: 'บล็อก', color: '#7f1d1d', open: false },
    { key: 'ไม่ระบุ', color: '#cbd5e1', open: false },
  ];
  const SG_COLOR = Object.fromEntries(STATUS_GROUPS.map((g) => [g.key, g.color]));

  function statusGroup(r) {
    const s = r.status || '', f = (r.follow || '').toLowerCase();
    if (/ปิด/.test(s)) return 'ปิดการขาย';
    if (/เสนอราคา/.test(s)) return 'เสนอราคาแล้ว';
    if (/ไม่ตอบลูกค้า/.test(s)) return 'เรายังไม่ตอบ';
    if (/บล็อก|block/i.test(s)) return 'บล็อก';
    if (/ไม่ซื้อ/.test(s)) return 'ไม่ซื้อ';
    if (/follow/.test(f)) return 'ติดตามอยู่';
    if (/ลูกค้าไม่ตอบ/.test(s)) return 'ลูกค้าเงียบ';
    if (!s && /not interested/.test(f)) return 'ไม่ซื้อ';
    return s ? 'ไม่ระบุ' : 'ไม่ระบุ';
  }

  const PRODUCT_ALIAS = { 'กระเป๋า': 'กระเป๋า/ถุง' };

  // หมวดธุรกิจ — ตรวจตามลำดับ เจอคำแรกที่ตรงจบ
  const BIZ_RULES = [
    ['บุคคลธรรมดา', /บุคคลธรรมดา|นามบุคคล/],
    ['ภาครัฐ / สมาคม / มูลนิธิ', /สมาคม|มูลนิธิ|ราชการ|กระทรวง|กรม|องค์การ|เทศบาล|รัฐวิสาหกิจ|สหกรณ์/],
    ['การศึกษา', /มหาวิทยาลัย|โรงเรียน|การศึกษา|วิทยาลัย|สอนพิเศษ|อบรม/],
    ['สุขภาพ / การแพทย์', /โรงพยาบาล|คลินิก|เภสัช|การแพทย์|สาธารณสุข|ทันตกรรม|สุขภาพ|ยา(?!ง|น)/],
    ['การเงิน / ประกัน / ธนาคาร', /ประกัน|ธนาคาร|หลักทรัพย์|สินเชื่อ|การเงิน|ลงทุน|กองทุน|จำนำ|โฮลดิ้ง|ลิสซิ่ง/],
    ['อสังหาฯ / ก่อสร้าง / ตกแต่ง', /อสังหา|ก่อสร้าง|สถาปัตย|ตกแต่งภายใน|วัสดุก่อสร้าง|ปูนซีเมนต์|ที่อยู่อาศัย|บ้านจัดสรร/],
    ['โรงแรม / ท่องเที่ยว / อาหาร', /โรงแรม|รีสอร์ท|ที่พัก|นำเที่ยว|ท่องเที่ยว|ร้านอาหาร|เครื่องดื่ม|จัดเลี้ยง|เบเกอ|ภัตตาคาร/],
    ['โฆษณา / อีเวนต์ / สื่อ', /โฆษณา|แสดงสินค้า|ประชุม|บันเทิง|โทรทัศน์|สื่อ|นันทนาการ|การพิมพ์|ภาพยนตร์|ประชาสัมพันธ์|อีเว้นท์|อีเวนต์|event/i],
    ['IT / เทคโนโลยี / สื่อสาร', /คอมพิวเตอร์|ซอฟต์แวร์|สารสนเทศ|เทคโนโลยี|ข้อมูล|โทรคมนาคม|แม่ข่าย|อินเทอร์เน็ต|ดิจิทัล|อิเล็กทรอนิกส์/],
    ['ยานยนต์ / ขนส่ง / โลจิสติกส์', /ยานยนต์|รถยนต์|ขนส่ง|คลังสินค้า|ท่าเรือ|ยานพาหนะ|ออกของ|โลจิสติก|การบิน/],
    ['พลังงาน / สาธารณูปโภค', /ไฟฟ้า|เชื้อเพลิง|ปิโตรเลียม|พลังงาน|น้ำเสีย|ของเสีย|ขยะ|ก๊าซ|น้ำมัน(?!ทา)/],
    ['การผลิต / อุตสาหกรรม', /ผลิต|โรงงาน|เครื่องจักร|เคมี|อุตสาหกรรม/],
    ['ค้าส่ง / ค้าปลีก', /ขายส่ง|ขายปลีก|ค้า|จำหน่าย|ขายตรง|นำเข้า|ส่งออก/],
    ['บริการ / ที่ปรึกษา', /ปรึกษา|บริการ|กฎหมาย|บัญชี|วิศวกรรม|วิจัย|จัดหางาน|บริหาร/],
  ];
  function bizCat(s) {
    if (!s) return 'ไม่ระบุ';
    for (const [name, re] of BIZ_RULES) if (re.test(s)) return name;
    return 'อื่นๆ';
  }

  // เลเวลลูกค้าตามทุนจดทะเบียน (บาท)
  const TIERS = [
    { key: 'S', label: 'S · เล็ก (< 5 ล้าน)', max: 5e6 },
    { key: 'M', label: 'M · กลาง (5–50 ล้าน)', max: 5e7 },
    { key: 'L', label: 'L · ใหญ่ (50–500 ล้าน)', max: 5e8 },
    { key: 'XL', label: 'XL · ใหญ่มาก (500 ล้าน–5 พันล้าน)', max: 5e9 },
    { key: 'XXL', label: 'XXL · องค์กรยักษ์ (≥ 5 พันล้าน)', max: Infinity },
  ];
  const tierOf = (cap) => (cap ? TIERS.find((t) => cap < t.max).key : '-');
  const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label]).concat([['-', 'ไม่มีข้อมูลทุน']]));

  // เหตุผล/เหตุการณ์จากหมายเหตุ (1 แถวมีได้หลายข้อ)
  const REASONS = [
    ['เกินงบ / ราคาสูง', /เกินงบ|บัทเจ็ด|บัดเจ็ท|budget|ราคาสูง|แพง|งบไม่พอ/i],
    ['ติดขั้นต่ำ / จำนวนน้อย', /ขั้นต่ำ|จำนวนน้อย|1 ชุด|ไม่จำหน่าย|ไม่รับผลิต/],
    ['ลูกค้าไม่แจ้งรายละเอียด', /ไม่แจ้งรายละเอียด|ไม่แจ้ง|สอบถามรายละเอียดลูกค้าไม่ตอบ|สอบถามข้อมูลลูกค้า/],
    ['แจ้งรายละเอียดแล้วเงียบ', /แจ้งรายละเอียดลูกค้าแล้ว|ส่งแคตตาล็อ|แจ้งราคาไปแล้ว/],
    ['ทำใบเสนอราคา / AW แล้ว', /ใบเสนอราคา|เสนอราคา|\bAW\b|อาร์ตเวิร์ค|artwork/i],
    ['รอลูกค้าตัดสินใจ', /รอลูกค้า|รอลุกค้า|พิจารณา|ตัดสินใจ|ติดตามลูกค้าต่อ|ติดตามต่อ/],
    ['ย้ายไปคุยไลน์ส่วนตัว', /ไลน์ส่วนตัว/],
    ['ลูกค้าเก่า', /ลูกค้าเก่า/],
    ['เลื่อน / ยังไม่ใช้ตอนนี้', /เลื่อน|ยังไม่|ไว้ก่อน|โอกาสหน้า|ปีหน้า/],
    ['ส่งต่อแล้วไม่มีคนตอบ (ฝั่งเรา)', /ไม่มีคนตอบกลับ|ไม่มีการตอบกลับลูกค้า|ส่งให้ฝ่ายขาย/],
    ['ลูกค้าติดต่อขอข้อมูลเจ้าหน้าที่', /ติดต่อเจ้าหน้าที่/],
  ];
  const reasonsOf = (note) => (note ? REASONS.filter(([, re]) => re.test(note)).map(([k]) => k) : []);

  const REGION_ORDER = ['กรุงเทพฯ', 'ปริมณฑล', 'ภาคกลาง', 'ภาคตะวันออก', 'ภาคตะวันตก', 'ภาคเหนือ', 'ภาคอีสาน', 'ภาคใต้', 'ไม่ระบุ'];

  // ============================================================ state
  const state = { all: [], sheets: [], generatedAt: null, tab: 'overview', charts: {}, leadPage: 1 };

  // ============================================================ network
  async function post(body, { tries = 1, timeout = 45000 } = {}) {
    let last;
    for (let i = 0; i < tries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow', credentials: 'omit' });
        const text = await res.text();
        clearTimeout(timer);
        if (text.trim().startsWith('<')) throw new Error('GOOGLE_HTML');
        return JSON.parse(text);
      } catch (e) {
        clearTimeout(timer);
        last = e;
        if (i < tries - 1) await sleep([1500, 4000, 8000][i] || 8000);
      }
    }
    throw last;
  }
  const netMsg = (e) => (e && e.name === 'AbortError' ? 'Google ตอบช้าเกินไป — กด ลองใหม่ อีกครั้ง'
    : e && e.message === 'GOOGLE_HTML' ? 'Google ตอบกลับมาไม่ครบ (สคริปต์อาจเพิ่งตื่น) — กด ลองใหม่'
      : 'เชื่อมต่อไม่ได้ — เช็คอินเทอร์เน็ต แล้วกด ลองใหม่');

  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

  // ============================================================ UI helpers
  let overlayTimer;
  function showLoading(on, text = 'กำลังโหลดข้อมูล…') {
    clearInterval(overlayTimer);
    $('#overlay').classList.toggle('hidden', !on);
    if (on) {
      const t0 = Date.now();
      $('#overlayText').textContent = text;
      overlayTimer = setInterval(() => { $('#overlayText').textContent = `${text} ${Math.round((Date.now() - t0) / 1000)} วิ`; }, 1000);
    }
  }
  function showError(msg, retry, title = 'โหลดข้อมูลไม่สำเร็จ') {
    showLoading(false);
    $('#errTitle').textContent = title;
    $('#errMsg').textContent = msg;
    $('#errBox').classList.remove('hidden');
    $('#errRetry').onclick = () => { $('#errBox').classList.add('hidden'); retry(); };
  }
  function showLogin(msg = '') {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#loginMsg').textContent = msg;
    $('#code').value = '';
    $('#code').focus();
  }

  // ============================================================ auth + load
  async function doLogin(ev) {
    ev.preventDefault();
    const code = $('#code').value;
    if (!code) return;
    const btn = $('#loginBtn');
    btn.disabled = true; $('#loginMsg').textContent = 'กำลังตรวจสอบ…';
    try {
      const r = await post({ action: 'login', code }, { tries: 1, timeout: 30000 });
      if (r.ok && r.token) { setToken(r.token); $('#login').classList.add('hidden'); await loadData(); }
      else $('#loginMsg').textContent = ({
        WRONG_CODE: `รหัสไม่ถูกต้อง${r.left !== undefined ? ` (เหลือ ${r.left} ครั้งก่อนล็อก)` : ''}`,
        LOCKED: 'ใส่รหัสผิดหลายครั้ง ระบบล็อก 15 นาที',
        NOT_CONFIGURED: 'ระบบยังไม่ได้ตั้งรหัส (ACCESS_CODE)',
      })[r.error] || 'เข้าสู่ระบบไม่สำเร็จ';
    } catch (e) { $('#loginMsg').textContent = netMsg(e); }
    finally { btn.disabled = false; }
  }

  async function loadData() {
    showLoading(true);
    try {
      let r;
      if (IS_MOCK) r = await (await fetch('_local/payload.json', { cache: 'no-store' })).json();
      else {
        r = await post({ action: 'data', token: getToken() }, { tries: 3 });
        if (!r.ok && r.error === 'UNAUTHORIZED') { setToken(null); showLoading(false); showLogin('หมดเวลาเข้าใช้งาน กรุณาใส่รหัสอีกครั้ง'); return; }
        if (!r.ok) throw new Error(r.error || 'ERR');
        if (r.newToken) setToken(r.newToken);
      }
      prepare(r);
      showLoading(false);
      $('#app').classList.remove('hidden');
      setupFilters();
      render();
    } catch (e) {
      showError(e.message === 'SERVER_ERROR' ? 'อ่านข้อมูลจากชีตไม่สำเร็จ — ลองใหม่อีกครั้ง' : netMsg(e), loadData);
    }
  }

  // ============================================================ prepare data
  function prepare(payload) {
    state.sheets = payload.sheets || [];
    state.generatedAt = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
    const w = payload.warnings || [];
    $('#warn').classList.toggle('hidden', !w.length);
    $('#warn').textContent = w.length ? '⚠ ' + w.join(' · ') : '';

    const rows = payload.rows || [];
    rows.forEach((r, i) => {
      r.i = i;
      const p = (r.product || '').trim();
      r.product = PRODUCT_ALIAS[p] || p || '(ไม่ระบุ)';
      r.sg = statusGroup(r);
      r.bizc = bizCat(r.biz);
      r.tier = tierOf(r.capital);
      r.reasons = reasonsOf(r.note);
      r.wd = r.m && r.d ? new Date(r.y, r.m - 1, r.d).getDay() : null;
      r.ts = r.y * 10000 + (r.m || 0) * 100 + (r.d || 0);
      r.mk = r.m ? r.y * 12 + (r.m - 1) : null; // month key
      r.region = r.region || 'ไม่ระบุ';
      r.name = r.company || (r.line && !/^unknown$/i.test(r.line) ? r.line : '') || '(ไม่ทราบชื่อ)';
    });
    // ลูกค้าซ้ำ — นับข้ามทุกปี
    const by = groupBy(rows.filter((r) => r.cid), (r) => r.cid);
    by.forEach((list) => {
      list.sort((a, b) => a.ts - b.ts || a.i - b.i);
      list.forEach((r, k) => { r.visitNo = k + 1; r.visits = list.length; });
    });
    rows.forEach((r) => { if (!r.cid) { r.visitNo = 1; r.visits = 1; } });
    state.byCid = by;
    state.all = rows;
  }

  function setupFilters() {
    const years = [...new Set(state.all.map((r) => r.y))].sort();
    const fy = $('#fYear');
    const prev = fy.value;
    fy.innerHTML = years.map((y) => `<option value="${y}">${y} (${y + 543})</option>`).join('') + (years.length > 1 ? '<option value="all">ทุกปี</option>' : '');
    fy.value = prev && [...fy.options].some((o) => o.value === prev) ? prev : String(years[years.length - 1] || '');

    const reps = [...countBy(state.all, (r) => r.rep).entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const fr = $('#fRep'); const pr = fr.value;
    fr.innerHTML = '<option value="all">ทุกคน</option>' + reps.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    if (pr && [...fr.options].some((o) => o.value === pr)) fr.value = pr;

    const ls = $('#leadStatus'); const pls = ls.value;
    ls.innerHTML = '<option value="all">ทุกสถานะ</option>' + STATUS_GROUPS.map((g) => `<option>${g.key}</option>`).join('');
    if (pls) ls.value = pls;

    const t = state.generatedAt;
    $('#foot').textContent = `ข้อมูลจากชีต: ${state.sheets.join(', ') || '-'} · ดึงล่าสุด ${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear() + 543} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} น. · ${fmt(state.all.length)} รายการ`;
  }

  function filtered({ ignoreQuarter = false, ignoreYear = false, ignoreRep = false } = {}) {
    const y = $('#fYear').value, q = $('#fQ').value, rep = $('#fRep').value;
    return state.all.filter((r) => (ignoreYear || y === 'all' || String(r.y) === y)
      && (ignoreQuarter || q === 'all' || String(r.q) === q)
      && (ignoreRep || rep === 'all' || r.rep === rep));
  }
  const periodLabel = () => {
    const y = $('#fYear').value, q = $('#fQ').value, rep = $('#fRep').value;
    return `${y === 'all' ? 'ทุกปี' : 'ปี ' + y}${q === 'all' ? '' : ' Q' + q}${rep === 'all' ? '' : ' · ' + rep}`;
  };

  // ============================================================ chart helper
  Chart.defaults.font.family = "'IBM Plex Sans Thai', system-ui, sans-serif";
  Chart.defaults.color = '#475569';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.maintainAspectRatio = false;
  // "ปิดการขาย" ในกราฟ = คาดการณ์จากการสนทนา → ป้ายสีแดง
  const CLOSE_LBL = 'ปิดการขาย (คาดการณ์)';
  const redLegend = (gen) => function (c) { return gen.call(this, c).map((l) => (/ปิด/.test(l.text) ? { ...l, fontColor: '#dc2626' } : l)); };
  Chart.defaults.plugins.legend.labels.generateLabels = redLegend(Chart.defaults.plugins.legend.labels.generateLabels);
  ['doughnut', 'pie'].forEach((t) => { const L = Chart.overrides[t].plugins.legend.labels; L.generateLabels = redLegend(L.generateLabels); });
  function chart(id, cfg) {
    if (state.charts[id]) state.charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    state.charts[id] = new Chart(el, cfg);
  }
  const stackedBySG = (labels, rowsPerLabel) => STATUS_GROUPS.map((g) => ({
    label: g.key === 'ปิดการขาย' ? CLOSE_LBL : g.key, backgroundColor: g.color, stack: 's',
    data: rowsPerLabel.map((rs) => rs.filter((r) => r.sg === g.key).length),
  })).filter((ds) => ds.data.some((v) => v));
  const stackOpts = (horizontal = false) => ({
    indexAxis: horizontal ? 'y' : 'x',
    scales: { x: { stacked: true, grid: { display: !horizontal ? false : true } }, y: { stacked: true, grid: { display: horizontal ? false : true } } },
    plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
  });

  // ============================================================ stats helpers
  const EST = '<span class="est">(คาดการณ์จากการสนทนา)</span>';
  const EST_TH = '<span class="est est-th">(คาดการณ์)</span>';
  const markEst = (html) => String(html).replace(/(ปิดการขาย|อัตราปิด|ปิดได้|ปิดง่าย(?:กว่า|สุด)?)/, '$1 ' + EST + ' ');
  const sgBadge = (g) => `<span class="badge" style="background:${SG_COLOR[g]}">${esc(g)}</span>${g === 'ปิดการขาย' ? ' <span class="est">(คาดการณ์)</span>' : ''}`;
  const isClosed = (r) => r.sg === 'ปิดการขาย';
  const isOpen = (r) => r.sg === 'เสนอราคาแล้ว' || r.sg === 'ติดตามอยู่';
  const uniqCustomers = (rows) => new Set(rows.filter((r) => r.cid).map((r) => r.cid)).size + rows.filter((r) => !r.cid).length;

  function table(headers, rows, opts = {}) {
    const th = headers.map((h) => `<th class="${h.n ? 'n' : ''}">${esc(h.t)}${/ปิด/.test(h.t) ? EST_TH : ''}</th>`).join('');
    const body = rows.map((cells) => `<tr>${cells.map((c, i) => `<td class="${headers[i] && headers[i].n ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('');
    return `<table${opts.cls ? ` class="${opts.cls}"` : ''}><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="muted">ไม่มีข้อมูล</td></tr>`}</tbody></table>`;
  }
  const barCell = (v, max, label) => `<div class="bar-cell"><i style="width:${max ? Math.round((v / max) * 100) : 0}%"></i><span>${label}</span></div>`;

  // ============================================================ forecast
  function monthlySeries(rows) {
    const keys = rows.filter((r) => r.mk !== null).map((r) => r.mk);
    if (!keys.length) return [];
    const min = Math.min(...keys), max = Math.max(...keys);
    const out = [];
    for (let k = min; k <= max; k++) out.push({ k, y: Math.floor(k / 12), m: (k % 12) + 1, leads: 0, closed: 0, lastDay: 0 });
    rows.forEach((r) => {
      if (r.mk === null) return;
      const s = out[r.mk - min];
      s.leads++; if (isClosed(r)) s.closed++;
      if (r.d > s.lastDay) s.lastDay = r.d;
    });
    // เดือนล่าสุดยังไม่จบ → ขยายเป็นทั้งเดือนตามวันที่มีข้อมูลล่าสุด
    const last = out[out.length - 1];
    const dim = new Date(last.y, last.m, 0).getDate();
    const now = state.generatedAt;
    const isCurrent = now.getFullYear() === last.y && now.getMonth() + 1 === last.m;
    if (isCurrent && last.lastDay && last.lastDay < dim) { last.partial = true; last.proj = (last.leads / last.lastDay) * dim; }
    return out;
  }

  function forecast(rows) {
    const series = monthlySeries(rows);
    if (series.length < 3) return null;
    const vals = series.map((s) => (s.partial ? s.proj : s.leads));
    // Holt (แนวโน้มแบบหน่วง) — ยึดระดับล่าสุด ไม่ดิ่งต่ำกว่าเดือนปัจจุบันเหมือนเส้นตรง
    const use = vals.slice(-12);
    const n = use.length, AL = 0.5, BE = 0.3, PHI = 0.85;
    let a = use[0], b = use[1] - use[0];
    const errs = [];
    for (let i = 1; i < n; i++) {
      const pred = a + PHI * b;
      errs.push(use[i] - pred);
      const na = AL * use[i] + (1 - AL) * pred;
      b = BE * (na - a) + (1 - BE) * PHI * b;
      a = na;
    }
    const sd = Math.sqrt(sum(errs.map((e) => e * e)) / Math.max(1, errs.length - 1));

    // ฤดูกาล: ใช้เมื่อมีข้อมูล ≥ 24 เดือน
    let season = null;
    if (series.length >= 24) {
      const byM = Array.from({ length: 12 }, () => []);
      series.forEach((s, i) => byM[s.m - 1].push(vals[i]));
      const avgAll = sum(vals) / vals.length;
      season = byM.map((arr) => (arr.length && avgAll ? sum(arr) / arr.length / avgAll : 1));
    }
    const last = series[series.length - 1];
    const recent = series.slice(-6);
    const closeRate = sum(recent.map((s) => s.closed)) / (sum(recent.map((s) => s.leads)) || 1);
    const future = [];
    for (let h = 1; h <= 3; h++) {
      const k = last.k + h, m = (k % 12) + 1, y = Math.floor(k / 12);
      let damp = 0; for (let j = 1; j <= h; j++) damp += PHI ** j;
      let v = a + b * damp;
      if (season) v *= season[m - 1];
      v = Math.max(0, v);
      const band = 1.28 * sd * Math.sqrt(h);
      future.push({ k, y, m, leads: v, lo: Math.max(0, v - band), hi: v + band, closed: v * closeRate });
    }
    return { series, future, slope: b, closeRate, season: !!season, sd };
  }

  // ============================================================ product trend
  // เทียบสัดส่วนสินค้า 3 เดือนล่าสุด vs 3 เดือนก่อนหน้า (ใช้สัดส่วน ไม่ใช่จำนวน → ไม่หลอกตาตอนลีดรวมโตทั้งก้อน)
  function productTrend(rows) {
    const dated = rows.filter((r) => r.mk !== null);
    if (!dated.length) return null;
    const last = Math.max(...dated.map((r) => r.mk));
    if (last - Math.min(...dated.map((r) => r.mk)) < 5) return null;
    const known = (r) => r.product !== '(ไม่ระบุ)';
    const L = dated.filter((r) => r.mk > last - 3), P = dated.filter((r) => r.mk <= last - 3 && r.mk > last - 6);
    const Y = dated.filter((r) => r.mk > last - 12);
    const nL = L.filter(known).length || 1, nP = P.filter(known).length || 1;
    const fc = forecast(rows);
    const future3 = fc ? sum(fc.future.map((f) => f.leads)) : 0;
    const knownShareL = L.length ? L.filter(known).length / L.length : 1;
    const list = [...new Set(Y.filter(known).map((r) => r.product))].map((p) => {
      const l = L.filter((r) => r.product === p), pr = P.filter((r) => r.product === p), y = Y.filter((r) => r.product === p);
      const sL = l.length / nL, sP = pr.length / nP;
      const ratio = sP ? sL / sP : (l.length ? Infinity : 1);
      let trend = 'ทรงตัว';
      if (l.length < 10 && pr.length < 10) trend = 'ข้อมูลน้อย';
      else if (l.length >= 10 && ratio >= 1.25) trend = 'มาแรง';
      else if (pr.length >= 8 && ratio <= 0.8) trend = 'ขาลง';
      return { p, l: l.length, pr: pr.length, sL, sP, ratio, trend, closeRate: pct(y.filter(isClosed).length, y.length), closedL: l.filter(isClosed).length, n12: y.length, next3: future3 * knownShareL * sL };
    }).sort((a, b) => b.l - a.l);
    const lbl = (k) => `${MONTHS[k % 12]} ${String(Math.floor(k / 12) + 543).slice(2)}`;
    return { list, winL: `${lbl(last - 2)}–${lbl(last)}`, winP: `${lbl(last - 5)}–${lbl(last - 3)}`, unknownL: L.length - L.filter(known).length, nLall: L.length };
  }
  const TREND_STYLE = { 'มาแรง': ['#16a34a', '▲'], 'ขาลง': ['#dc2626', '▼'], 'ทรงตัว': ['#64748b', '■'], 'ข้อมูลน้อย': ['#cbd5e1', '·'] };

  // ============================================================ insights → { good, improve, info }
  function insights(rows) {
    const out = { good: [], improve: [], info: [] };
    const add = (kind, ic, text, act) => out[kind].push({ ic, text, act });
    const N = rows.length;
    if (!N) return out;
    const allRows = filtered({ ignoreYear: true, ignoreQuarter: true });

    // --- ช่วงเวลา
    const byQ = countBy(rows.filter((r) => r.q), (r) => r.q);
    if (byQ.size > 1) {
      const [bq, bn] = [...byQ.entries()].sort((a, b) => b[1] - a[1])[0];
      add('info', '📅', `ลูกค้าเข้ามามากสุดใน <b>Q${bq}</b> (${fmt(bn)} ลีด = ${fp(pct(bn, N))})`);
    }
    const byM = countBy(rows.filter((r) => r.m), (r) => r.mk);
    if (byM.size) {
      const [mk, mn] = [...byM.entries()].sort((a, b) => b[1] - a[1])[0];
      add('info', '🔥', `เดือนที่คึกคักสุดคือ <b>${MONTHS[mk % 12]} ${Math.floor(mk / 12) + 543}</b> มี ${fmt(mn)} ลีด`);
    }
    const byWd = countBy(rows.filter((r) => r.wd !== null), (r) => r.wd);
    if (byWd.size) {
      const [wd, wn] = [...byWd.entries()].sort((a, b) => b[1] - a[1])[0];
      add('info', '🗓', `วันที่มีลีดเข้ามากสุดคือ <b>วัน${WEEKDAYS[wd]}</b> (${fp(pct(wn, sum([...byWd.values()])))}) · นับตามวันที่บันทึกในชีต`);
    }

    // --- แนวโน้มลีด & ปิดการขาย (3 เดือนล่าสุด vs ก่อนหน้า)
    const ser = monthlySeries(allRows);
    if (ser.length >= 6) {
      const v = ser.map((s) => (s.partial ? s.proj : s.leads));
      const a3 = sum(v.slice(-3)), p3 = sum(v.slice(-6, -3));
      const g = pct(a3 - p3, p3);
      if (g >= 0) add('good', '📈', `ลีดโตต่อเนื่อง: 3 เดือนล่าสุด <b>+${fp(g)}</b> เทียบ 3 เดือนก่อนหน้า (${fmt(a3)} vs ${fmt(p3)})`, 'เตรียมคนตอบแชทให้พอกับลีดที่เพิ่ม ไม่ให้ลีดตกหล่น');
      else add('improve', '📉', `ลีดลดลง <b>${fp(-g)}</b> เทียบ 3 เดือนก่อนหน้า (${fmt(a3)} vs ${fmt(p3)})`, 'เพิ่มโฆษณา หรือทักลูกค้าเก่ากลับมา');
      const c3 = sum(ser.slice(-3).map((s) => s.closed)), cp = sum(ser.slice(-6, -3).map((s) => s.closed));
      if (c3 >= cp) add('good', '🏆', `ปิดการขายเพิ่มขึ้น: 3 เดือนล่าสุด <b>${fmt(c3)}</b> ราย เทียบ ${fmt(cp)} ราย${cp ? ` (+${fp(pct(c3 - cp, cp), 0)})` : ''}`);
      else add('improve', '🏆', `ปิดการขายลดลง: 3 เดือนล่าสุด ${fmt(c3)} ราย เทียบ ${fmt(cp)} ราย`, 'ไล่ดูลีด "เสนอราคาแล้ว" ที่ค้างอยู่');
    }

    // --- ลูกค้าซ้ำ
    const rep = rows.filter((r) => r.cid && r.visitNo > 1), fresh = rows.filter((r) => r.cid && r.visitNo === 1);
    if (rep.length) {
      const rr = pct(rep.filter(isClosed).length, rep.length), fr = pct(fresh.filter(isClosed).length, fresh.length);
      const nRep = new Set(rep.map((r) => r.cid)).size;
      if (rr > fr) add('good', '🔁', `ลูกค้าเก่ากลับมาซ้ำ <b>${fmt(nRep)}</b> ราย และปิดง่ายกว่า: อัตราปิด <b>${fp(rr)}</b> vs ลูกค้าใหม่ ${fp(fr)}`, 'ทำลิสต์ทักลูกค้าเก่าก่อนช่วงเทศกาล');
      else add('info', '🔁', `ลูกค้าเก่ากลับมาซ้ำ ${fmt(nRep)} ราย · อัตราปิด ${fp(rr)} vs ลูกค้าใหม่ ${fp(fr)}`);
    }

    // --- เลเวล / สินค้าที่ปิดง่าย
    const tiers = [...groupBy(rows.filter((r) => r.tier !== '-'), (r) => r.tier).entries()].filter(([, rs]) => rs.length >= 10)
      .map(([k, rs]) => [k, pct(rs.filter(isClosed).length, rs.length), rs.length]).sort((a, b) => b[1] - a[1]);
    if (tiers.length) add('good', '🏢', `กลุ่มลูกค้าที่ปิดได้ดีสุด <b>${esc(TIER_LABEL[tiers[0][0]])}</b> อัตราปิด ${fp(tiers[0][1])}`, 'ลีดกลุ่มนี้ควรให้เซลล์ตอบเร็วเป็นพิเศษ');
    const prod = [...groupBy(rows.filter((r) => r.product !== '(ไม่ระบุ)'), (r) => r.product).entries()];
    if (prod.length) {
      const top = [...prod].sort((a, b) => b[1].length - a[1].length)[0];
      const minN = Math.max(10, Math.round(N * 0.02));
      const best = prod.filter(([, rs]) => rs.length >= minN).map(([k, rs]) => [k, pct(rs.filter(isClosed).length, rs.length)]).sort((a, b) => b[1] - a[1])[0];
      add('info', '🎁', `สินค้าที่ถูกถามมากสุด <b>${esc(top[0])}</b> (${fmt(top[1].length)} ลีด)`);
      if (best) add('good', '🎯', `สินค้าที่ปิดการขายง่ายสุด <b>${esc(best[0])}</b> อัตราปิด ${fp(best[1])}`);
    }

    // --- แนวโน้มสินค้า
    const pt = productTrend(allRows);
    if (pt) {
      const up = pt.list.filter((x) => x.trend === 'มาแรง'), down = pt.list.filter((x) => x.trend === 'ขาลง');
      if (up.length) add('good', '🚀', `สินค้าที่กำลังมาแรง (${pt.winL}): <b>${up.slice(0, 4).map((x) => esc(x.p)).join(', ')}</b>`, 'เตรียมแบบ/ตัวอย่าง/สต็อกกลุ่มนี้ไว้ก่อน');
      if (down.length) add('improve', '🔻', `ความสนใจลดลง: <b>${down.map((x) => esc(x.p)).join(', ')}</b>`, 'ลองปรับรูป/ราคา/ข้อความโฆษณา หรือจับคู่กับสินค้าขายดี');
      if (pt.nLall && pt.unknownL / pt.nLall > 0.1) add('improve', '❓', `ลีดที่ไม่ได้ระบุสินค้าที่สนใจ <b>${fp(pct(pt.unknownL, pt.nLall))}</b> ใน 3 เดือนล่าสุด`, 'ถามลูกค้าว่าสนใจชุดไหนตั้งแต่แชทแรก จะวิเคราะห์สินค้าได้แม่นขึ้น');
    }

    // --- สิ่งที่ควรพัฒนา
    const silent = rows.filter((r) => r.sg === 'ลูกค้าเงียบ').length;
    if (pct(silent, N) > 20) add('improve', '🤐', `ลูกค้าเงียบหลังคุย <b>${fp(pct(silent, N))}</b> (${fmt(silent)} ราย) — กลุ่มใหญ่สุด`, 'ทักซ้ำภายใน 1–2 วัน + เสนอสินค้าพร้อมส่ง/ราคาตัวอย่างให้ตัดสินใจง่าย');
    const noReply = rows.filter((r) => r.sg === 'เรายังไม่ตอบ');
    if (noReply.length) {
      const [wr, wn] = [...countBy(noReply, (r) => r.rep).entries()].sort((a, b) => b[1] - a[1])[0];
      add('improve', '⚠️', `มี <b>${fmt(noReply.length)}</b> ลีดที่ฝั่งเรายังไม่ได้ตอบ (มากสุด: ${esc(wr)} ${fmt(wn)} ราย)`, 'เคลียร์รายการนี้ก่อน — โอกาสที่หลุดจากฝั่งเราเอง');
    } else add('good', '💬', 'ไม่มีลีดที่ฝั่งเราค้างตอบ');
    const quoted = rows.filter((r) => r.sg === 'เสนอราคาแล้ว').length;
    if (quoted) add('improve', '📄', `เสนอราคาแล้วยังไม่ปิด <b>${fmt(quoted)}</b> ราย`, 'ไล่ตามกลุ่มนี้ก่อน เพราะใกล้ปิดที่สุด');
    const lost = rows.filter((r) => ['ไม่ซื้อ', 'บล็อก', 'ลูกค้าเงียบ'].includes(r.sg)).flatMap((r) => r.reasons)
      .filter((k) => !['แจ้งรายละเอียดแล้วเงียบ', 'ลูกค้าไม่แจ้งรายละเอียด', 'ลูกค้าติดต่อขอข้อมูลเจ้าหน้าที่'].includes(k));
    if (lost.length) {
      const [lr, ln] = [...countBy(lost, (k) => k).entries()].sort((a, b) => b[1] - a[1])[0];
      add('improve', '🧩', `เหตุผลที่ลูกค้าหลุดบ่อยสุด (จากหมายเหตุ): <b>${esc(lr)}</b> ${fmt(ln)} ครั้ง`);
    }
    const noCo = rows.filter((r) => !r.company).length, noQty = rows.filter((r) => !r.qty).length;
    if (pct(noCo, N) > 30 || pct(noQty, N) > 30) add('improve', '📝', `ข้อมูลยังไม่ครบ: ไม่มีชื่อบริษัท ${fp(pct(noCo, N))} · ไม่มีจำนวนชุด ${fp(pct(noQty, N))}`, 'กรอกชื่อบริษัท/เบอร์เพิ่ม ระบบจะจับลูกค้าซ้ำและเลเวลลูกค้าได้แม่นขึ้น');

    // --- ข้อมูลน่ารู้
    const biz = [...countBy(rows.filter((r) => r.bizc !== 'ไม่ระบุ'), (r) => r.bizc).entries()].sort((a, b) => b[1] - a[1]);
    if (biz.length) add('info', '🏷', `ธุรกิจที่เข้ามามากสุด <b>${esc(biz[0][0])}</b> (${fmt(biz[0][1])} ลีด)${biz[1] ? ` รองลงมา ${esc(biz[1][0])}` : ''}`);
    const withReg = rows.filter((r) => r.region !== 'ไม่ระบุ');
    if (withReg.length) {
      const bkk = withReg.filter((r) => r.region === 'กรุงเทพฯ' || r.region === 'ปริมณฑล').length;
      add('info', '📍', `ลูกค้าที่ระบุที่อยู่ อยู่ กรุงเทพฯ+ปริมณฑล <b>${fp(pct(bkk, withReg.length))}</b>`);
    }
    const closed = rows.filter(isClosed).length;
    add('info', '✅', `ปิดการขาย ${fmt(closed)} จาก ${fmt(N)} ลีด = อัตราปิด ${fp(pct(closed, N))}`);
    return out;
  }

  function renderProductTrend() {
    const pt = productTrend(filtered({ ignoreYear: true, ignoreQuarter: true }));
    if (!pt) { $('#ptTable').innerHTML = '<p class="muted">ต้องมีข้อมูลอย่างน้อย 6 เดือน</p>'; $('#ptSummary').innerHTML = ''; $('#ptNote').textContent = ''; return; }
    $('#ptNote').textContent = `เทียบสัดส่วนสินค้า ${pt.winL} กับ ${pt.winP} · ใช้ข้อมูลทุกปี (ตามเซลล์ที่เลือก)`;
    const groups = ['มาแรง', 'ทรงตัว', 'ขาลง'].map((t) => [t, pt.list.filter((x) => x.trend === t)]).filter(([, l]) => l.length);
    $('#ptSummary').innerHTML = `<div class="pt-groups">${groups.map(([t, l]) => `<div class="pt-group"><span class="pt-head" style="color:${TREND_STYLE[t][0]}">${TREND_STYLE[t][1]} ${t}</span>${l.map((x) => `<span class="pt-chip">${esc(x.p)}</span>`).join('')}</div>`).join('')}</div>`;
    $('#ptTable').innerHTML = table(
      [{ t: 'สินค้า' }, { t: 'แนวโน้ม' }, { t: '3 ด. ก่อน', n: 1 }, { t: '3 ด. ล่าสุด', n: 1 }, { t: 'สัดส่วนของลีด (ก่อน → ล่าสุด)', n: 1 }, { t: 'อัตราปิด 12 ด.', n: 1 }, { t: 'คาดลีด 3 ด. หน้า', n: 1 }],
      pt.list.map((x) => {
        const chg = x.sP ? (x.sL - x.sP) * 100 : null;
        return [esc(x.p), `<span class="badge" style="background:${TREND_STYLE[x.trend][0]}">${TREND_STYLE[x.trend][1]} ${x.trend}</span>`, fmt(x.pr), fmt(x.l),
          chg === null ? '<span class="good-txt">ใหม่</span>' : `<span class="muted">${(x.sP * 100).toFixed(1)}% →</span> <b>${(x.sL * 100).toFixed(1)}%</b> <span class="${chg > 0.5 ? 'good-txt' : chg < -0.5 ? 'bad-txt' : 'muted'}">(${chg > 0 ? '+' : ''}${chg.toFixed(1)}%)</span>`,
          fp(x.closeRate), `≈ ${fmt(x.next3)}`];
      }),
    ) + '<p class="note">สัดส่วนของลีด = ลีดทุก 100 ราย มีกี่รายถามสินค้านี้ · ตัวเลขในวงเล็บ = เพิ่ม/ลดกี่ % · มาแรง = สัดส่วนโต ≥25% · ขาลง = ลด ≥20% · คาดลีด = ลีดรวมที่คาดการณ์ × สัดส่วนล่าสุด</p>';
  }

  // ============================================================ renderers
  function kpi(v, l, s = '', cls = '') { return `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }

  function renderOverview() {
    const rows = filtered();
    const N = rows.length, closed = rows.filter(isClosed).length;
    const repeatCust = new Set(rows.filter((r) => r.visits > 1).map((r) => r.cid)).size;
    const nr = rows.filter((r) => r.sg === 'เรายังไม่ตอบ').length;
    $('#kpis').innerHTML = [
      kpi(fmt(N), 'ลีดทั้งหมด', periodLabel()),
      kpi(fmt(uniqCustomers(rows)), 'ลูกค้า (ไม่นับซ้ำ)', `ลูกค้าซ้ำ ${fmt(repeatCust)} ราย`),
      kpi(fmt(rows.filter(isOpen).length), 'ยังมีโอกาส', 'เสนอราคา + ติดตามอยู่', 'good'),
      kpi(fmt(closed), 'ปิดการขาย ' + EST, `อัตราปิด ${fp(pct(closed, N))}`, 'good'),
      kpi(fp(pct(rows.filter((r) => r.sg === 'ลูกค้าเงียบ').length, N)), 'ลูกค้าเงียบ', 'คุยแล้วไม่ตอบกลับ', 'warn'),
      kpi(fmt(nr), 'เรายังไม่ตอบ', 'ควรเป็น 0', nr ? 'bad' : 'good'),
    ].join('');

    const ins = insights(rows);
    const li = (x) => `<li><span class="ic">${x.ic}</span><span>${markEst(x.text)}${x.act ? `<span class="act">→ ${esc(x.act)}</span>` : ''}</span></li>`;
    const empty = '<li class="muted">— ไม่มี —</li>';
    $('#insGood').innerHTML = ins.good.map(li).join('') || empty;
    $('#insImprove').innerHTML = ins.improve.map(li).join('') || empty;
    $('#insInfo').innerHTML = ins.info.map(li).join('') || empty;
    renderProductTrend();

    // forecast — ใช้ทุกปี (ตามเซลล์ที่เลือก)
    const fc = forecast(filtered({ ignoreYear: true, ignoreQuarter: true }));
    if (!fc) { $('#forecastTable').innerHTML = '<p class="muted">ข้อมูลยังน้อยเกินไปสำหรับคาดการณ์</p>'; chart('cForecast', { type: 'line', data: { labels: [], datasets: [] } }); return; }
    const hist = fc.series.slice(-12);
    const labels = hist.map((s) => `${MONTHS[s.m - 1]} ${String(s.y + 543).slice(2)}${s.partial ? '*' : ''}`).concat(fc.future.map((f) => `${MONTHS[f.m - 1]} ${String(f.y + 543).slice(2)}`));
    const pad = (arr, before, after) => Array(before).fill(null).concat(arr, Array(after).fill(null));
    const lastVal = hist[hist.length - 1].partial ? hist[hist.length - 1].proj : hist[hist.length - 1].leads;
    chart('cForecast', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'ลีดจริง', data: pad(hist.map((s) => s.leads), 0, 3), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.3 },
          { label: 'คาดการณ์', data: pad([lastVal, ...fc.future.map((f) => Math.round(f.leads))], hist.length - 1, 0), borderColor: '#f59e0b', borderDash: [6, 4], backgroundColor: '#f59e0b', tension: 0.3 },
          { label: 'ช่วงสูง', data: pad([lastVal, ...fc.future.map((f) => Math.round(f.hi))], hist.length - 1, 0), borderColor: 'transparent', backgroundColor: 'rgba(245,158,11,.15)', fill: '+1', pointRadius: 0 },
          { label: 'ช่วงต่ำ', data: pad([lastVal, ...fc.future.map((f) => Math.round(f.lo))], hist.length - 1, 0), borderColor: 'transparent', backgroundColor: 'rgba(245,158,11,.15)', pointRadius: 0 },
          { label: CLOSE_LBL, data: pad(hist.map((s) => s.closed), 0, 3), borderColor: '#16a34a', backgroundColor: '#16a34a', tension: 0.3 },
        ],
      },
      options: { plugins: { legend: { position: 'bottom', labels: { filter: (i) => !i.text.startsWith('ช่วง') } }, tooltip: { mode: 'index', intersect: false } }, scales: { y: { beginAtZero: true } } },
    });
    $('#forecastTable').innerHTML = table(
      [{ t: 'เดือน' }, { t: 'ลีดคาดการณ์', n: 1 }, { t: 'ช่วงที่เป็นไปได้', n: 1 }, { t: 'คาดว่าปิดได้', n: 1 }],
      fc.future.map((f) => [`${MONTHS[f.m - 1]} ${f.y + 543}`, fmt(f.leads), `${fmt(f.lo)}–${fmt(f.hi)}`, fmt(f.closed, 0)]),
    );
    const lastS = fc.series[fc.series.length - 1];
    $('#forecastNote').innerHTML = `วิธีคิด: ยึดระดับล่าสุด + แนวโน้มที่ค่อย ๆ ชะลอ จาก ${Math.min(12, fc.series.length)} เดือนล่าสุด (แนวโน้มตอนนี้ ${fc.slope >= 0 ? '+' : ''}${fmt(fc.slope, 1)} ลีด/เดือน) × อัตราปิด ${EST} 6 เดือนล่าสุด ${fp(fc.closeRate * 100)}`
      + (lastS.partial ? ` · * ${MONTHS[lastS.m - 1]} ยังไม่จบเดือน ประมาณทั้งเดือน ≈ ${fmt(lastS.proj)} ลีด` : '')
      + (fc.season ? ' · คิดผลของฤดูกาลแล้ว' : ' · เมื่อมีข้อมูลครบ 2 ปี ระบบจะคิดผลของฤดูกาล (เช่น ช่วงปีใหม่) ให้อัตโนมัติ')
      + ' · เป็นการคาดการณ์จากสถิติ ไม่ใช่ยอดขายจริง';
  }

  function renderTime() {
    const rows = filtered();
    // quarter
    const qs = [1, 2, 3, 4];
    const qRows = qs.map((q) => rows.filter((r) => r.q === q));
    chart('cQuarter', { type: 'bar', data: { labels: qs.map((q) => 'Q' + q), datasets: stackedBySG(qs, qRows) }, options: stackOpts() });

    // month
    const ser = monthlySeries(rows);
    chart('cMonth', {
      type: 'bar',
      data: {
        labels: ser.map((s) => `${MONTHS[s.m - 1]}${$('#fYear').value === 'all' ? ' ' + String(s.y + 543).slice(2) : ''}`),
        datasets: [
          { type: 'line', label: CLOSE_LBL, data: ser.map((s) => s.closed), borderColor: '#16a34a', backgroundColor: '#16a34a', yAxisID: 'y1', tension: 0.3 },
          { label: 'ลีด', data: ser.map((s) => s.leads), backgroundColor: '#93c5fd', borderRadius: 6 },
        ],
      },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'ลีด' } }, y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: CLOSE_LBL, color: '#dc2626' } }, x: { grid: { display: false } } } },
    });

    // weekday
    const wdRows = WD_ORDER.map((w) => rows.filter((r) => r.wd === w));
    chart('cWeekday', {
      type: 'bar',
      data: { labels: WD_ORDER.map((w) => WEEKDAYS[w]), datasets: [{ label: 'ลีด', data: wdRows.map((a) => a.length), backgroundColor: WD_ORDER.map((w) => (w === 0 || w === 6 ? '#fbbf24' : '#2563eb')), borderRadius: 6 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => `${CLOSE_LBL} ${wdRows[c.dataIndex].filter(isClosed).length}` } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } },
    });

    // part of month
    const parts = [['ต้นเดือน (1–10)', (d) => d <= 10], ['กลางเดือน (11–20)', (d) => d > 10 && d <= 20], ['ปลายเดือน (21–31)', (d) => d > 20]];
    const pRows = parts.map(([, f]) => rows.filter((r) => r.d && f(r.d)));
    chart('cMonthPart', { type: 'bar', data: { labels: parts.map((p) => p[0]), datasets: stackedBySG(parts, pRows) }, options: stackOpts() });

    // heatmap
    const months = [...new Set(rows.filter((r) => r.mk !== null).map((r) => r.mk))].sort((a, b) => a - b);
    const cell = new Map(); rows.forEach((r) => { if (r.mk !== null && r.wd !== null) { const k = r.mk + ':' + r.wd; cell.set(k, (cell.get(k) || 0) + 1); } });
    const max = Math.max(1, ...cell.values());
    $('#heatmap').innerHTML = `<table class="heat"><thead><tr><th></th>${WD_ORDER.map((w) => `<th>${WEEKDAYS[w]}</th>`).join('')}<th>รวม</th></tr></thead><tbody>${months.map((mk) => {
      const tds = WD_ORDER.map((w) => { const v = cell.get(mk + ':' + w) || 0; const a = v / max; return `<td style="background:rgba(37,99,235,${(0.06 + a * 0.85).toFixed(2)});color:${a > 0.55 ? '#fff' : '#0f172a'}">${v || ''}</td>`; }).join('');
      const tot = rows.filter((r) => r.mk === mk).length;
      return `<tr><th>${MONTHS[mk % 12]} ${Math.floor(mk / 12) + 543}</th>${tds}<td><b>${tot}</b></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function renderCustomers() {
    const rows = filtered();
    const ids = rows.filter((r) => r.cid);
    const custs = new Set(ids.map((r) => r.cid));
    const repeat = [...custs].filter((c) => state.byCid.get(c).length > 1);
    const newIn = [...custs].filter((c) => rows.some((r) => r.cid === c && r.visitNo === 1)).length;
    $('#custKpis').innerHTML = [
      kpi(fmt(uniqCustomers(rows)), 'ลูกค้า (ไม่นับซ้ำ)', periodLabel()),
      kpi(fmt(newIn), 'ลูกค้าใหม่', 'ทักครั้งแรกในช่วงนี้'),
      kpi(fmt(repeat.length), 'ลูกค้าที่เข้ามาซ้ำ', `${fp(pct(repeat.length, custs.size))} ของลูกค้าที่ระบุตัวได้`, 'good'),
      kpi(fmt(rows.filter((r) => !r.cid).length), 'ระบุตัวไม่ได้', 'ไม่มีบริษัท/เบอร์ และชื่อไลน์สั้นเกินจะยืนยัน', 'warn'),
    ].join('');

    // repeat table
    const q = ($('#repeatSearch').value || '').trim().toLowerCase();
    const list = repeat.map((c) => {
      const all = state.byCid.get(c);
      const inP = rows.filter((r) => r.cid === c);
      const lastR = all[all.length - 1];
      const names = [...new Set(all.map((r) => r.company).filter(Boolean))];
      const lines = [...new Set(all.map((r) => r.line).filter((l) => l && !/^unknown$/i.test(l)))];
      return { c, all, inP, lastR, name: names[0] || lines[0] || '(ไม่ทราบชื่อ)', alias: lines.join(', '), reps: [...new Set(all.map((r) => r.rep))], prods: [...new Set(all.map((r) => r.product).filter((p) => p !== '(ไม่ระบุ)'))], closed: all.filter(isClosed).length };
    }).filter((x) => !q || (x.name + ' ' + x.alias).toLowerCase().includes(q))
      .sort((a, b) => b.all.length - a.all.length || b.lastR.ts - a.lastR.ts);
    $('#repeatTable').innerHTML = table(
      [{ t: 'ลูกค้า' }, { t: 'เข้ามาทั้งหมด', n: 1 }, { t: 'ในช่วงที่เลือก', n: 1 }, { t: 'ครั้งแรก' }, { t: 'ล่าสุด' }, { t: 'เซลล์' }, { t: 'สินค้าที่เคยสนใจ' }, { t: 'สถานะล่าสุด' }, { t: 'ปิดได้', n: 1 }],
      list.slice(0, 200).map((x) => [
        `<b>${esc(x.name)}</b>${x.alias && x.alias !== x.name ? `<div class="muted small">${esc(x.alias)}</div>` : ''}`,
        `<span class="badge visit">${x.all.length} ครั้ง</span>`, fmt(x.inP.length), thDate(x.all[0]), thDate(x.lastR),
        x.reps.map((r) => `<span class="badge rep">${esc(r)}</span>`).join(' '), esc(x.prods.join(', ')),
        sgBadge(x.lastR.sg), x.closed ? `<span class="good-txt">${x.closed}</span>` : '0',
      ]),
    ) + (list.length > 200 ? `<p class="note">แสดง 200 จาก ${fmt(list.length)} ราย — ใช้ช่องค้นหา</p>` : '');

    // tiers
    const tierKeys = TIERS.map((t) => t.key).concat('-');
    const tRows = tierKeys.map((k) => rows.filter((r) => r.tier === k));
    const tk = TIERS.map((t) => t.key); // กราฟไม่รวม "ไม่มีข้อมูลทุน" (ดูในตาราง)
    chart('cTier', { type: 'bar', data: { labels: tk, datasets: stackedBySG(tk, tRows.slice(0, tk.length)) }, options: stackOpts() });
    const tMax = Math.max(...tRows.map((a) => a.length));
    $('#tierTable').innerHTML = table([{ t: 'เลเวล' }, { t: 'ลีด', n: 1 }, { t: 'ลูกค้า', n: 1 }, { t: 'ปิดได้', n: 1 }, { t: 'อัตราปิด', n: 1 }, { t: 'จำนวนชุดเฉลี่ย', n: 1 }],
      tierKeys.map((k, i) => { const rs = tRows[i]; const qv = rs.map((r) => r.qty).filter(Boolean); return [esc(TIER_LABEL[k]), barCell(rs.length, tMax, fmt(rs.length)), fmt(uniqCustomers(rs)), fmt(rs.filter(isClosed).length), fp(pct(rs.filter(isClosed).length, rs.length)), qv.length ? fmt(median(qv)) + ' <span class="muted small">(มัธยฐาน)</span>' : '-']; }));

    // business category
    const biz = [...groupBy(rows, (r) => r.bizc).entries()].sort((a, b) => (a[0] === 'ไม่ระบุ') - (b[0] === 'ไม่ระบุ') || b[1].length - a[1].length);
    const bizShown = biz.filter(([k]) => k !== 'ไม่ระบุ');
    chart('cBiz', { type: 'bar', data: { labels: bizShown.map(([k]) => k), datasets: stackedBySG(bizShown, bizShown.map(([, rs]) => rs)) }, options: stackOpts(true) });
    const bMax = Math.max(1, ...biz.map(([, rs]) => rs.length));
    $('#bizTable').innerHTML = table([{ t: 'ประเภทธุรกิจ' }, { t: 'ลีด', n: 1 }, { t: 'ปิดได้', n: 1 }, { t: 'อัตราปิด', n: 1 }, { t: 'ตัวอย่างที่กรอกในชีต' }],
      biz.map(([k, rs]) => [esc(k), barCell(rs.length, bMax, fmt(rs.length)), fmt(rs.filter(isClosed).length), fp(pct(rs.filter(isClosed).length, rs.length)),
        `<span class="muted small">${esc([...countBy(rs.filter((r) => r.biz), (r) => r.biz).entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t.slice(0, 40)).join(' · '))}</span>`]));

    // region
    const reg = REGION_ORDER.map((k) => rows.filter((r) => r.region === k));
    const regKeys = REGION_ORDER.filter((_, i) => reg[i].length && REGION_ORDER[i] !== 'ไม่ระบุ');
    chart('cRegion', { type: 'bar', data: { labels: regKeys, datasets: stackedBySG(regKeys, regKeys.map((k) => rows.filter((r) => r.region === k))) }, options: stackOpts(true) });
    const prov = [...groupBy(rows.filter((r) => r.province), (r) => r.province).entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
    const pMax = Math.max(1, ...prov.map(([, rs]) => rs.length));
    $('#provTable').innerHTML = table([{ t: 'จังหวัด' }, { t: 'ภูมิภาค' }, { t: 'ลีด', n: 1 }, { t: 'ปิดได้', n: 1 }],
      prov.map(([k, rs]) => [esc(k), `<span class="muted small">${esc(rs[0].region)}</span>`, barCell(rs.length, pMax, fmt(rs.length)), fmt(rs.filter(isClosed).length)]))
      + `<p class="note">ไม่มีที่อยู่ ${fmt(rows.filter((r) => !r.province).length)} รายการ (ไม่นับในกราฟภูมิภาค)</p>`;
  }

  function renderStatus() {
    const rows = filtered(), N = rows.length;
    const sg = STATUS_GROUPS.map((g) => [g, rows.filter((r) => r.sg === g.key).length]).filter(([, n]) => n);
    chart('cStatus', { type: 'doughnut', data: { labels: sg.map(([g]) => (g.key === 'ปิดการขาย' ? CLOSE_LBL : g.key)), datasets: [{ data: sg.map(([, n]) => n), backgroundColor: sg.map(([g]) => g.color) }] }, options: { plugins: { legend: { position: 'right' } }, cutout: '58%' } });
    const raw = [...countBy(rows, (r) => `${r.status || '(ว่าง)'}|${r.sg}`).entries()].sort((a, b) => b[1] - a[1]);
    $('#statusTable').innerHTML = table([{ t: 'สถานะในชีต' }, { t: 'จัดเป็น' }, { t: 'จำนวน', n: 1 }, { t: '%', n: 1 }],
      raw.map(([k, n]) => { const [s, g] = k.split('|'); return [esc(s), sgBadge(g), fmt(n), fp(pct(n, N))]; }));

    // funnel
    const detail = rows.filter((r) => r.company || r.qty || r.budget || ['เสนอราคาแล้ว', 'ปิดการขาย', 'ติดตามอยู่'].includes(r.sg)).length;
    const engaged = rows.filter((r) => ['เสนอราคาแล้ว', 'ปิดการขาย', 'ติดตามอยู่'].includes(r.sg)).length;
    const closed = rows.filter(isClosed).length;
    const steps = [['ลีดทั้งหมด', N], ['ได้รายละเอียดลูกค้า (บริษัท/จำนวน/งบ)', detail], ['เสนอราคา / ติดตามต่อ / ปิด', engaged], ['ปิดการขาย', closed]];
    $('#funnel').innerHTML = `<div class="funnel">${steps.map(([l, v], i) => `<div class="step"><div class="lbl">${/ปิด/.test(l) ? markEst(esc(l)) : esc(l)} ${i ? `<span class="muted small">(${fp(pct(v, steps[i - 1][1]))} จากขั้นก่อน)</span>` : ''}</div><div class="bar" style="width:${Math.max(6, pct(v, N))}%;background:${['#2563eb', '#3b82f6', '#0891b2', '#16a34a'][i]}">${fmt(v)}</div></div>`).join('')}</div>`;
    const fl = [...countBy(rows, (r) => r.follow || '(ว่าง)').entries()].sort((a, b) => b[1] - a[1]);
    $('#followTable').innerHTML = table([{ t: 'Follow to Lead' }, { t: 'จำนวน', n: 1 }, { t: '%', n: 1 }], fl.map(([k, n]) => [esc(k), fmt(n), fp(pct(n, N))]));

    const ser = monthlySeries(rows);
    const sRows = ser.map((s) => rows.filter((r) => r.mk === s.k));
    chart('cStatusMonth', { type: 'bar', data: { labels: ser.map((s) => `${MONTHS[s.m - 1]} ${String(s.y + 543).slice(2)}`), datasets: stackedBySG(ser, sRows) }, options: stackOpts() });

    const rs = [...countBy(rows.flatMap((r) => r.reasons), (k) => k).entries()].sort((a, b) => b[1] - a[1]);
    chart('cReason', { type: 'bar', data: { labels: rs.map(([k]) => k), datasets: [{ label: 'ครั้ง', data: rs.map(([, n]) => n), backgroundColor: '#7c3aed', borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { y: { grid: { display: false } } } } });

    const sug = [...countBy(rows.filter((r) => r.suggest), (r) => r.suggest).entries()].sort((a, b) => b[1] - a[1]);
    $('#suggestList').innerHTML = table([{ t: 'ข้อเสนอแนะ' }, { t: 'ครั้ง', n: 1 }], sug.map(([k, n]) => [esc(k), fmt(n)]));
  }

  function renderProducts() {
    const rows = filtered();
    const qv = rows.map((r) => r.qty).filter(Boolean), qc = rows.filter(isClosed).map((r) => r.qty).filter(Boolean);
    const bv = rows.map((r) => r.budget).filter(Boolean);
    $('#prodKpis').innerHTML = [
      kpi(qv.length ? fmt(median(qv)) : '-', 'จำนวนชุดต่อออเดอร์ (มัธยฐาน)', `เฉลี่ย ${fmt(qv.length ? sum(qv) / qv.length : 0)} ชุด · จาก ${fmt(qv.length)} ลีดที่ระบุจำนวน`),
      kpi(qc.length ? fmt(median(qc)) : '-', 'จำนวนชุด — เฉพาะที่ปิดได้ ' + EST, `เฉลี่ย ${fmt(qc.length ? sum(qc) / qc.length : 0)} ชุด`, 'good'),
      kpi(bv.length ? fmt(median(bv)) : '-', 'งบต่อชุด (มัธยฐาน, บาท)', `เฉลี่ย ${fmt(bv.length ? sum(bv) / bv.length : 0)} บาท`),
      kpi(fmt(new Set(rows.map((r) => r.product)).size), 'กลุ่มสินค้าที่ถูกถาม'),
    ].join('');

    const prods = [...groupBy(rows, (r) => r.product).entries()].sort((a, b) => (a[0] === '(ไม่ระบุ)') - (b[0] === '(ไม่ระบุ)') || b[1].length - a[1].length);
    const shown = prods.filter(([k]) => k !== '(ไม่ระบุ)');
    chart('cProduct', { type: 'bar', data: { labels: shown.map(([k]) => k), datasets: stackedBySG(shown, shown.map(([, rs]) => rs)) }, options: stackOpts(true) });

    const buckets = [['1–49', 1, 50], ['50–99', 50, 100], ['100–299', 100, 300], ['300–499', 300, 500], ['500–999', 500, 1000], ['1,000+', 1000, Infinity]];
    const bRows = buckets.map(([, lo, hi]) => rows.filter((r) => r.qty >= lo && r.qty < hi));
    chart('cQtyBucket', { type: 'bar', data: { labels: buckets.map((b) => b[0] + ' ชุด'), datasets: stackedBySG(buckets, bRows) }, options: stackOpts() });

    // สัดส่วนรายเดือน 12 เดือนล่าสุด (100%)
    const all = filtered({ ignoreYear: true, ignoreQuarter: true }).filter((r) => r.mk !== null && r.product !== '(ไม่ระบุ)');
    if (all.length) {
      const lastK = Math.max(...all.map((r) => r.mk));
      const ks = Array.from({ length: 12 }, (_, i) => lastK - 11 + i).filter((k) => all.some((r) => r.mk === k));
      const tot = ks.map((k) => all.filter((r) => r.mk === k).length || 1);
      const top = [...countBy(all, (r) => r.product).entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const main = top.slice(0, 7);
      const keyOf = (r) => (main.includes(r.product) ? r.product : 'อื่นๆ');
      chart('cProdShare', {
        type: 'bar',
        data: { labels: ks.map((k) => `${MONTHS[k % 12]} ${String(Math.floor(k / 12) + 543).slice(2)}`),
          datasets: main.concat(top.length > 7 ? ['อื่นๆ'] : []).map((p, i) => ({ label: p, backgroundColor: p === 'อื่นๆ' ? '#cbd5e1' : PALETTE[i], stack: 's',
            data: ks.map((k, j) => +(pct(all.filter((r) => r.mk === k && keyOf(r) === p).length, tot[j])).toFixed(1)) })) },
        options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: 100, ticks: { callback: (v) => v + '%' } } },
          plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false, callbacks: { label: (c) => `${c.dataset.label}: ${c.raw}%` } } } },
      });
    }

    const N = rows.length, pMax = Math.max(1, ...prods.map(([, rs]) => rs.length));
    $('#productTable').innerHTML = table(
      [{ t: 'สินค้า' }, { t: 'ลีด', n: 1 }, { t: '% ของลีด', n: 1 }, { t: 'ปิดได้', n: 1 }, { t: 'อัตราปิด', n: 1 }, { t: 'จำนวนชุด (มัธยฐาน)', n: 1 }, { t: 'จำนวนชุดเฉลี่ย', n: 1 }, { t: 'งบ/ชุด (มัธยฐาน)', n: 1 }],
      prods.map(([k, rs]) => {
        const q = rs.map((r) => r.qty).filter(Boolean), b = rs.map((r) => r.budget).filter(Boolean), c = rs.filter(isClosed).length;
        return [esc(k), barCell(rs.length, pMax, fmt(rs.length)), fp(pct(rs.length, N)), fmt(c), fp(pct(c, rs.length)), q.length ? fmt(median(q)) : '-', q.length ? fmt(sum(q) / q.length) : '-', b.length ? fmt(median(b)) : '-'];
      }),
    ) + '<p class="note">ค่ามัธยฐาน = ค่ากลาง ไม่โดนออเดอร์ใหญ่ผิดปกติดึง · ช่วงเช่น "100-200" คิดเป็นค่ากลาง 150</p>';
  }

  function renderSales() {
    const rows = filtered({ ignoreRep: true });
    const N = rows.length;
    const reps = [...groupBy(rows, (r) => r.rep).entries()].sort((a, b) => b[1].length - a[1].length);
    const cnt = (rs, g) => rs.filter((r) => r.sg === g).length;
    $('#repTable').innerHTML = table(
      [{ t: 'เซลล์' }, { t: 'ลีด', n: 1 }, { t: '% ของทีม', n: 1 }, { t: 'ลูกค้า (เจ้า)', n: 1 }, { t: 'ลูกค้าซ้ำ', n: 1 }, { t: 'ปิดการขาย', n: 1 }, { t: 'อัตราปิด', n: 1 }, { t: 'เสนอราคา', n: 1 }, { t: 'ติดตามอยู่', n: 1 }, { t: 'ลูกค้าเงียบ', n: 1 }, { t: 'เรายังไม่ตอบ', n: 1 }, { t: 'บล็อก/ไม่ซื้อ', n: 1 }, { t: 'กรอกข้อมูลครบ*', n: 1 }],
      reps.map(([rep, rs]) => {
        const c = cnt(rs, 'ปิดการขาย'), nr = cnt(rs, 'เรายังไม่ตอบ');
        const full = rs.filter((r) => r.company && (r.qty || r.budget)).length;
        return [`<b>${esc(rep)}</b>`, fmt(rs.length), fp(pct(rs.length, N)), fmt(uniqCustomers(rs)), fmt(new Set(rs.filter((r) => r.visits > 1).map((r) => r.cid)).size),
          `<span class="good-txt">${fmt(c)}</span>`, fp(pct(c, rs.length)), fmt(cnt(rs, 'เสนอราคาแล้ว')), fmt(cnt(rs, 'ติดตามอยู่')), fmt(cnt(rs, 'ลูกค้าเงียบ')),
          nr ? `<span class="bad-txt">${fmt(nr)}</span>` : '0', fmt(cnt(rs, 'บล็อก') + cnt(rs, 'ไม่ซื้อ')), fp(pct(full, rs.length))];
      }),
    ) + '<p class="note">* กรอกข้อมูลครบ = มีชื่อบริษัท และมีจำนวนชุดหรืองบ · หน้านี้แสดงทุกเซลล์เสมอ (ไม่ใช้ตัวกรองเซลล์)</p>';

    chart('cRepShare', { type: 'doughnut', data: { labels: reps.map(([k]) => k), datasets: [{ data: reps.map(([, rs]) => rs.length), backgroundColor: PALETTE }] }, options: { plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt(c.raw)} ลีด (${fp(pct(c.raw, N))})` } } }, cutout: '55%' } });
    chart('cRepStatus', { type: 'bar', data: { labels: reps.map(([k]) => k), datasets: stackedBySG(reps, reps.map(([, rs]) => rs)) }, options: stackOpts(true) });
    const ser = monthlySeries(rows);
    chart('cRepMonth', {
      type: 'line',
      data: { labels: ser.map((s) => `${MONTHS[s.m - 1]} ${String(s.y + 543).slice(2)}`), datasets: reps.map(([rep, rs], i) => ({ label: rep, data: ser.map((s) => rs.filter((r) => r.mk === s.k).length), borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length], tension: 0.3 })) },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  const PAGE = 50;
  function renderLeads() {
    const q = ($('#leadSearch').value || '').trim().toLowerCase();
    const st = $('#leadStatus').value, rep = $('#leadRepeatOnly').checked;
    const rows = filtered().filter((r) => (st === 'all' || r.sg === st) && (!rep || r.visits > 1)
      && (!q || [r.name, r.line, r.company, r.note, r.province, r.product, r.rep, r.biz].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => b.ts - a.ts || b.i - a.i);
    $('#leadCount').textContent = `(${fmt(rows.length)} รายการ)`;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.leadPage = Math.min(state.leadPage, pages);
    const page = rows.slice((state.leadPage - 1) * PAGE, state.leadPage * PAGE);
    $('#leadTable').innerHTML = table(
      [{ t: 'วันที่' }, { t: 'ลูกค้า' }, { t: 'เข้ามา' }, { t: 'เลเวล' }, { t: 'ประเภทธุรกิจ' }, { t: 'จังหวัด' }, { t: 'สินค้า' }, { t: 'จำนวน', n: 1 }, { t: 'งบ/ชุด', n: 1 }, { t: 'สถานะ' }, { t: 'เซลล์' }, { t: 'หมายเหตุ' }],
      page.map((r) => [thDate(r),
        `<b>${esc(r.name)}</b>${r.company && r.line && !/^unknown$/i.test(r.line) ? `<div class="muted small">${esc(r.line)}</div>` : ''}`,
        r.visits > 1 ? `<span class="badge visit" title="เข้ามาทั้งหมด ${r.visits} ครั้ง">ครั้งที่ ${r.visitNo}/${r.visits}</span>` : '<span class="muted small">ใหม่</span>',
        r.tier === '-' ? '-' : esc(r.tier), `<span class="small">${esc(r.bizc)}</span>`, esc(r.province || '-'), esc(r.product),
        r.qty ? fmt(r.qty) : '-', r.budget ? fmt(r.budget) : '-',
        sgBadge(r.sg), esc(r.rep), `<span class="small">${esc(r.note)}</span>`]),
    );
    $('#leadPager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => i + 1)
      .filter((p) => p === 1 || p === pages || Math.abs(p - state.leadPage) <= 2)
      .map((p, i, arr) => (i && p - arr[i - 1] > 1 ? '<span class="muted">…</span>' : '') + `<button data-p="${p}" class="${p === state.leadPage ? 'on' : ''}">${p}</button>`).join('') : '';
  }

  const RENDER = { overview: renderOverview, time: renderTime, customers: renderCustomers, status: renderStatus, products: renderProducts, sales: renderSales, leads: renderLeads };
  function render() {
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + state.tab));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    try { RENDER[state.tab](); } catch (e) { console.error(e); }
  }

  // ============================================================ events
  $('#loginForm').addEventListener('submit', doLogin);
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return; state.tab = b.dataset.tab; render(); });
  ['#fYear', '#fQ', '#fRep'].forEach((s) => $(s).addEventListener('change', () => { state.leadPage = 1; render(); }));
  $('#btnRefresh').addEventListener('click', loadData);
  $('#btnLogout').addEventListener('click', () => { setToken(null); Object.values(state.charts).forEach((c) => c.destroy()); state.charts = {}; state.all = []; showLogin(); });
  let deb;
  const debounce = (fn) => () => { clearTimeout(deb); deb = setTimeout(fn, 200); };
  $('#repeatSearch').addEventListener('input', debounce(renderCustomers));
  $('#leadSearch').addEventListener('input', debounce(() => { state.leadPage = 1; renderLeads(); }));
  $('#leadStatus').addEventListener('change', () => { state.leadPage = 1; renderLeads(); });
  $('#leadRepeatOnly').addEventListener('change', () => { state.leadPage = 1; renderLeads(); });
  $('#leadPager').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (!b) return; state.leadPage = Number(b.dataset.p); renderLeads(); $('#tab-leads').scrollIntoView({ behavior: 'smooth' }); });

  // ============================================================ start
  if (IS_MOCK) loadData();
  else if (!API || /PASTE_/.test(API)) showLogin('ยังไม่ได้ใส่ URL ของ Apps Script ใน config.js');
  else if (getToken()) loadData();
  else showLogin();
})();
