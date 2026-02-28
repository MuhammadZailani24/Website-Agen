// ================================
// Catatan Keuangan Agen Mandiri (LocalStorage)
// Pages + Bottom Navbar + Mobile Cards (Riwayat & Modal)
// Hutang + Profit Setelah Lunas
// ================================
const LS_KEY = "agen_keuangan_v3";

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

const nowDateISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function rupiah(n){
  const x = Math.round(Number(n || 0));
  return "Rp " + x.toLocaleString("id-ID");
}

function clamp0(n){ return Math.max(0, Number(n || 0)); }

function getDefaultState(){
  return {
    init: { cash: 0, atm: 0 },
    owners: [],
    transactions: [],
    meta: { createdAt: nowISO(), updatedAt: nowISO() },
    ui: { page: "dashboard" }
  };
}

function loadState(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw) return getDefaultState();
  try{
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return getDefaultState();
    parsed.init = parsed.init || { cash: 0, atm: 0 };
    parsed.owners = Array.isArray(parsed.owners) ? parsed.owners : [];
    parsed.transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];
    parsed.meta = parsed.meta || { createdAt: nowISO(), updatedAt: nowISO() };
    parsed.ui = parsed.ui || { page: "dashboard" };
    return parsed;
  }catch{
    return getDefaultState();
  }
}

function saveState(state){
  state.meta = state.meta || {};
  state.meta.updatedAt = nowISO();
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

// ================================
// Profit rules:
// 1.000–999.999 => 5.000
// 1.000.000–1.999.999 => 10.000
// dst naik 5.000 per 1 juta
// Rumus: (floor(amount/1_000_000) + 1) * 5_000
// Profit hanya: tarik_tunai & transfer
// Profit masuk hanya jika transaksi lunas (paid=true)
// ================================
function calcProfit(amount){
  const a = Math.floor(Number(amount || 0));
  if(a < 1000) return 0;
  return (Math.floor(a / 1_000_000) + 1) * 5_000;
}
function profitForType(type, amount){
  if(type === "tarik_tunai" || type === "transfer") return calcProfit(amount);
  return 0;
}

// ================================
// Derived totals
// - Hutang (isDebt && !paid): tidak mempengaruhi saldo & profit
// - Lunas: baru mempengaruhi saldo & profit
// ================================
function computeDerived(state){
  let cash = clamp0(state.init?.cash);
  let atm  = clamp0(state.init?.atm);
  let profitTotal = 0;
  let debtTotal = 0;

  const txs = [...state.transactions].sort((a,b)=>{
    const da = (a.date || "").localeCompare(b.date || "");
    if(da !== 0) return da;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });

  for(const tx of txs){
    const amount = clamp0(tx.amount);
    const type = tx.type;

    const isDebt = !!tx.isDebt;
    const paid = (tx.paid === true);

    if(isDebt && !paid){
      debtTotal += amount;
      continue;
    }

    if(type === "tarik_tunai"){
      cash -= amount; atm += amount;
    }else if(type === "transfer"){
      atm -= amount; cash += amount;
    }else if(type === "pengeluaran"){
      const src = tx.source || "cash";
      if(src === "atm") atm -= amount;
      else cash -= amount;
    }

    profitTotal += profitForType(type, amount);
  }

  cash = Math.round(cash);
  atm = Math.round(atm);
  profitTotal = Math.round(profitTotal);
  debtTotal = Math.round(debtTotal);

  return { cash, atm, total: cash + atm, profit: profitTotal, debt: debtTotal };
}

function canApplySettledTx(derived, tx){
  const amount = clamp0(tx.amount);
  const type = tx.type;

  let cash = derived.cash;
  let atm  = derived.atm;

  if(type === "tarik_tunai"){
    cash -= amount; atm += amount;
  }else if(type === "transfer"){
    atm -= amount; cash += amount;
  }else if(type === "pengeluaran"){
    if((tx.source || "cash") === "atm") atm -= amount;
    else cash -= amount;
  }
  return cash >= 0 && atm >= 0;
}

// ================================
// UI Elements
// ================================
const el = {
  // pages
  pageDashboard: $("#page-dashboard"),
  pageTransaksi: $("#page-transaksi"),
  pageRiwayat: $("#page-riwayat"),
  pageModal: $("#page-modal"),

  // navbar
  navItems: $$(".nav-item"),

  // dashboard values
  vTotal: $("#vTotal"),
  vCash: $("#vCash"),
  vATM: $("#vATM"),
  vProfit: $("#vProfit"),
  vDebt: $("#vDebt"),
  lastUpdate: $("#lastUpdate"),

  // transaksi form
  txForm: $("#txForm"),
  txDate: $("#txDate"),
  txType: $("#txType"),
  txAmount: $("#txAmount"),
  txSource: $("#txSource"),
  sourceWrap: $("#sourceWrap"),
  txDebt: $("#txDebt"),
  debtWrap: $("#debtWrap"),
  txNote: $("#txNote"),
  profitHint: $("#profitHint"),
  txNotice: $("#txNotice"),
  btnSaveTx: $("#btnSaveTx"),
  btnCancelEdit: $("#btnCancelEdit"),

  // init balances
  initForm: $("#initForm"),
  initCash: $("#initCash"),
  initATM: $("#initATM"),

  // riwayat
  fType: $("#fType"),
  fQuery: $("#fQuery"),
  txBody: $("#txBody"),
  txCards: $("#txCards"),
  txCount: $("#txCount"),

  // owners
  ownerForm: $("#ownerForm"),
  ownerId: $("#ownerId"),
  ownerName: $("#ownerName"),
  ownerAmount: $("#ownerAmount"),
  ownerNote: $("#ownerNote"),
  ownerBody: $("#ownerBody"),
  ownerCards: $("#ownerCards"),
  ownerCount: $("#ownerCount"),
  btnCancelOwnerEdit: $("#btnCancelOwnerEdit"),

  // top actions
  btnExport: $("#btnExport"),
  fileImport: $("#fileImport"),
  btnReset: $("#btnReset"),
};

let state = loadState();
let editingTxId = null;
let editingOwnerId = null;

// ================================
// Navigation (Pages)
// ================================
function showPage(page){
  state.ui.page = page;
  saveState(state);

  el.pageDashboard.hidden = page !== "dashboard";
  el.pageTransaksi.hidden = page !== "transaksi";
  el.pageRiwayat.hidden = page !== "riwayat";
  el.pageModal.hidden = page !== "modal";

  el.navItems.forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.page === page);
  });
}

el.navItems.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    showPage(btn.dataset.page);
  });
});

// ================================
// Helpers
// ================================
function badgeForType(type){
  if(type === "tarik_tunai") return `<span class="badge blue">Tarik Tunai</span>`;
  if(type === "transfer") return `<span class="badge green">Transfer</span>`;
  if(type === "pengeluaran") return `<span class="badge red">Pengeluaran</span>`;
  return `<span class="badge">${type}</span>`;
}

function statusBadge(tx){
  if(tx.isDebt){
    if(tx.paid) return `<span class="badge green">Lunas</span>`;
    return `<span class="badge amber">Hutang</span>`;
  }
  return `<span class="badge">Normal</span>`;
}

function txImpactText(tx){
  const a = clamp0(tx.amount);
  if(tx.isDebt && !tx.paid) return `Belum dihitung (tunggu dibayar)`;

  if(tx.type === "tarik_tunai") return `Cash -${rupiah(a)} • ATM +${rupiah(a)}`;
  if(tx.type === "transfer") return `ATM -${rupiah(a)} • Cash +${rupiah(a)}`;
  if(tx.type === "pengeluaran"){
    const src = tx.source === "atm" ? "ATM" : "Cash";
    return `${src} -${rupiah(a)} (Total berkurang)`;
  }
  return "-";
}

function updateTxFormVisibility(){
  const type = el.txType.value;
  el.sourceWrap.style.display = (type === "pengeluaran") ? "block" : "none";

  const showDebt = (type === "tarik_tunai" || type === "transfer");
  el.debtWrap.style.display = showDebt ? "block" : "none";
  if(!showDebt) el.txDebt.checked = false;
}

function updateProfitHint(){
  const type = el.txType.value;
  const amount = clamp0(el.txAmount.value);
  const isDebt = !!el.txDebt.checked;
  const p = profitForType(type, amount);

  if(type === "pengeluaran"){
    el.profitHint.textContent = `Keuntungan transaksi: ${rupiah(0)} (pengeluaran tidak ada profit)`;
    return;
  }
  el.profitHint.textContent = isDebt
    ? `Keuntungan transaksi: ${rupiah(p)} (ditahan, masuk setelah dibayar)`
    : `Keuntungan transaksi: ${rupiah(p)} (langsung masuk)`;
}

function showTxError(msg){
  el.txNotice.hidden = false;
  el.txNotice.textContent = msg;
}
function clearTxError(){
  el.txNotice.hidden = true;
  el.txNotice.textContent = "";
}

function resetTxForm(){
  editingTxId = null;
  el.btnCancelEdit.hidden = true;
  el.btnSaveTx.textContent = "Simpan Transaksi";
  el.txForm.reset();
  el.txDate.value = nowDateISO();
  el.txType.value = "tarik_tunai";
  el.txSource.value = "cash";
  el.txDebt.checked = false;
  updateTxFormVisibility();
  updateProfitHint();
  clearTxError();
}

function resetOwnerForm(){
  editingOwnerId = null;
  el.btnCancelOwnerEdit.hidden = true;
  $("#btnSaveOwner").textContent = "Simpan";
  el.ownerId.value = "";
  el.ownerForm.reset();
}

// ================================
// Render
// ================================
function render(){
  const derived = computeDerived(state);

  el.vTotal.textContent  = rupiah(derived.total);
  el.vCash.textContent   = rupiah(derived.cash);
  el.vATM.textContent    = rupiah(derived.atm);
  el.vProfit.textContent = rupiah(derived.profit);
  el.vDebt.textContent   = rupiah(derived.debt);

  el.lastUpdate.textContent = new Date(state.meta?.updatedAt || Date.now()).toLocaleString("id-ID");

  el.initCash.value = clamp0(state.init?.cash);
  el.initATM.value  = clamp0(state.init?.atm);

  updateTxFormVisibility();
  updateProfitHint();

  renderTxList();
  renderOwners();
}

function getFilteredTx(){
  const typeFilter = el.fType.value || "all";
  const q = (el.fQuery.value || "").trim().toLowerCase();

  const txs = [...state.transactions].sort((a,b)=>{
    const da = (b.date || "").localeCompare(a.date || "");
    if(da !== 0) return da;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  return txs.filter(tx=>{
    if(typeFilter !== "all" && tx.type !== typeFilter) return false;
    if(q){
      const note = (tx.note || "").toLowerCase();
      if(!note.includes(q)) return false;
    }
    return true;
  });
}

function renderTxList(){
  const filtered = getFilteredTx();

  // Desktop table
  el.txBody.innerHTML = filtered.map(tx=>{
    const amount = clamp0(tx.amount);
    const profit = (tx.isDebt && !tx.paid) ? 0 : profitForType(tx.type, amount);
    const canPay = tx.isDebt && !tx.paid;

    return `
      <tr>
        <td>${tx.date || "-"}</td>
        <td>${badgeForType(tx.type)}</td>
        <td>${statusBadge(tx)}</td>
        <td><b>${rupiah(amount)}</b></td>
        <td>${rupiah(profit)}</td>
        <td class="muted">${txImpactText(tx)}</td>
        <td>${(tx.note || "").replace(/</g,"&lt;")}</td>
        <td>
          <div class="action-links">
            ${canPay ? `<button class="link-btn pay" data-act="pay" data-id="${tx.id}">Bayar</button>` : ""}
            <button class="link-btn" data-act="edit" data-id="${tx.id}">Edit</button>
            <button class="link-btn danger" data-act="del" data-id="${tx.id}">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Mobile cards
  el.txCards.innerHTML = filtered.map(tx=>{
    const amount = clamp0(tx.amount);
    const profit = (tx.isDebt && !tx.paid) ? 0 : profitForType(tx.type, amount);
    const canPay = tx.isDebt && !tx.paid;

    return `
      <div class="tx-card">
        <div class="tx-top">
          <div class="tx-title">
            <div class="tx-date">${tx.date || "-"}</div>
            <div>${badgeForType(tx.type)} ${statusBadge(tx)}</div>
          </div>
          <div class="tx-amount">${rupiah(amount)}</div>
        </div>

        <div class="tx-grid">
          <div class="kv">
            <div class="k">Profit</div>
            <div class="v">${rupiah(profit)}</div>
          </div>
          <div class="kv">
            <div class="k">Dampak</div>
            <div class="v">${txImpactText(tx)}</div>
          </div>
        </div>

        ${tx.note ? `<div class="tx-note"><b>Catatan:</b> ${(tx.note || "").replace(/</g,"&lt;")}</div>` : ""}

        <div class="tx-actions">
          ${canPay ? `<button class="link-btn pay" data-act="pay" data-id="${tx.id}">Bayar</button>` : `<button class="link-btn" disabled style="opacity:.6;">-</button>`}
          <button class="link-btn" data-act="edit" data-id="${tx.id}">Edit</button>
          <button class="link-btn danger" data-act="del" data-id="${tx.id}">Hapus</button>
          <button class="link-btn" data-act="toTransaksi" data-id="${tx.id}">Buka Form</button>
        </div>
      </div>
    `;
  }).join("");

  el.txCount.textContent = `${filtered.length} transaksi (total tersimpan: ${state.transactions.length})`;
}

function renderOwners(){
  const owners = [...state.owners].sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  // Desktop table
  el.ownerBody.innerHTML = owners.map(o=>{
    return `
      <tr>
        <td><b>${(o.name||"").replace(/</g,"&lt;")}</b></td>
        <td>${rupiah(o.amount)}</td>
        <td>${(o.note||"").replace(/</g,"&lt;")}</td>
        <td>
          <div class="action-links">
            <button class="link-btn" data-oact="edit" data-id="${o.id}">Edit</button>
            <button class="link-btn danger" data-oact="del" data-id="${o.id}">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Mobile cards
  el.ownerCards.innerHTML = owners.map(o=>{
    return `
      <div class="owner-card">
        <div class="name">${(o.name||"").replace(/</g,"&lt;")}</div>
        <div class="meta"><b>Modal:</b> ${rupiah(o.amount)}</div>
        ${o.note ? `<div class="meta"><b>Catatan:</b> ${(o.note||"").replace(/</g,"&lt;")}</div>` : ""}
        <div class="owner-actions">
          <button class="link-btn" data-oact="edit" data-id="${o.id}">Edit</button>
          <button class="link-btn danger" data-oact="del" data-id="${o.id}">Hapus</button>
        </div>
      </div>
    `;
  }).join("");

  el.ownerCount.textContent = `${owners.length} pemilik`;
}

// ================================
// Events
// ================================
el.txType.addEventListener("change", ()=>{ updateTxFormVisibility(); updateProfitHint(); });
el.txAmount.addEventListener("input", updateProfitHint);
el.txDebt.addEventListener("change", updateProfitHint);

el.txForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  clearTxError();

  const type = el.txType.value;
  const isDebtAllowed = (type === "tarik_tunai" || type === "transfer");
  const isDebt = isDebtAllowed ? !!el.txDebt.checked : false;

  const tx = {
    id: editingTxId || uid("tx"),
    date: el.txDate.value || nowDateISO(),
    type,
    amount: clamp0(el.txAmount.value),
    source: type === "pengeluaran" ? (el.txSource.value || "cash") : null,
    note: (el.txNote.value || "").trim(),
    isDebt,
    paid: isDebt ? false : true,
    paidAt: isDebt ? null : nowISO(),
    createdAt: nowISO()
  };

  if(tx.amount < 1000){
    showTxError("Nominal minimal Rp 1.000.");
    return;
  }

  // validate balance only if settled now
  let tempState = state;
  if(editingTxId){
    tempState = { ...state, transactions: state.transactions.filter(t=>t.id !== editingTxId) };
  }
  const derivedTemp = computeDerived(tempState);

  if(!tx.isDebt && !canApplySettledTx(derivedTemp, tx)){
    showTxError("Saldo tidak cukup untuk transaksi ini (akan membuat Cash/ATM minus).");
    return;
  }

  if(editingTxId){
    state.transactions = state.transactions.filter(t=>t.id !== editingTxId);
  }
  state.transactions.push(tx);
  saveState(state);

  resetTxForm();
  render();
  showPage("riwayat");
});

el.btnCancelEdit.addEventListener("click", resetTxForm);

// saldo awal
el.initForm.addEventListener("submit", (e)=>{
  e.preventDefault();
  state.init.cash = clamp0(el.initCash.value);
  state.init.atm  = clamp0(el.initATM.value);
  saveState(state);
  render();
});

// riwayat actions (desktop + mobile share same data-act)
function handleTxAction(act, id){
  const tx = state.transactions.find(t=>t.id === id);
  if(!tx) return;

  if(act === "pay"){
    if(!(tx.isDebt && !tx.paid)){
      alert("Transaksi ini bukan hutang / sudah lunas.");
      return;
    }
    const ok = confirm(`Tandai hutang ini sebagai LUNAS?\nNominal: ${rupiah(tx.amount)}\nProfit akan masuk setelah lunas.`);
    if(!ok) return;

    const derivedBefore = computeDerived({ ...state, transactions: state.transactions.filter(t=>t.id !== id) });
    const txAsSettled = { ...tx, paid: true };

    if(!canApplySettledTx(derivedBefore, txAsSettled)){
      alert("Gagal melunasi: jika dilunasi sekarang saldo akan menjadi minus. Cek saldo awal/transaksi lain.");
      return;
    }

    tx.paid = true;
    tx.paidAt = nowISO();
    saveState(state);
    render();
    return;
  }

  if(act === "edit"){
    editingTxId = id;
    el.btnCancelEdit.hidden = false;
    el.btnSaveTx.textContent = "Simpan Perubahan";

    el.txDate.value = tx.date || nowDateISO();
    el.txType.value = tx.type || "tarik_tunai";
    el.txAmount.value = clamp0(tx.amount);
    el.txSource.value = tx.source || "cash";
    el.txNote.value = tx.note || "";

    const isDebtAllowed = (tx.type === "tarik_tunai" || tx.type === "transfer");
    el.txDebt.checked = isDebtAllowed ? (!!tx.isDebt && !tx.paid) : false;

    updateTxFormVisibility();
    updateProfitHint();
    clearTxError();

    showPage("transaksi");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if(act === "del"){
    const ok = confirm("Hapus transaksi ini?");
    if(!ok) return;
    state.transactions = state.transactions.filter(t=>t.id !== id);
    saveState(state);
    if(editingTxId === id) resetTxForm();
    render();
    return;
  }

  if(act === "toTransaksi"){
    // quick jump to form edit
    handleTxAction("edit", id);
    return;
  }
}

el.txCards.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if(!act || !id) return;
  handleTxAction(act, id);
});

el.txBody.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if(!act || !id) return;
  handleTxAction(act, id);
});

el.fType.addEventListener("change", renderTxList);
el.fQuery.addEventListener("input", renderTxList);

// owners
el.ownerForm.addEventListener("submit", (e)=>{
  e.preventDefault();

  const owner = {
    id: editingOwnerId || uid("own"),
    name: (el.ownerName.value || "").trim(),
    amount: clamp0(el.ownerAmount.value),
    note: (el.ownerNote.value || "").trim(),
    createdAt: nowISO()
  };

  if(!owner.name){
    alert("Nama pemilik wajib diisi.");
    return;
  }

  if(editingOwnerId){
    state.owners = state.owners.filter(o=>o.id !== editingOwnerId);
  }
  state.owners.push(owner);
  saveState(state);

  resetOwnerForm();
  renderOwners();
});

el.btnCancelOwnerEdit.addEventListener("click", resetOwnerForm);

function handleOwnerAction(act, id){
  const o = state.owners.find(x=>x.id === id);
  if(!o) return;

  if(act === "edit"){
    editingOwnerId = id;
    el.btnCancelOwnerEdit.hidden = false;
    $("#btnSaveOwner").textContent = "Simpan Perubahan";
    el.ownerId.value = id;
    el.ownerName.value = o.name || "";
    el.ownerAmount.value = clamp0(o.amount);
    el.ownerNote.value = o.note || "";
    showPage("modal");
    return;
  }

  if(act === "del"){
    const ok = confirm("Hapus pemilik/modal ini?");
    if(!ok) return;
    state.owners = state.owners.filter(x=>x.id !== id);
    saveState(state);
    if(editingOwnerId === id) resetOwnerForm();
    renderOwners();
    return;
  }
}

el.ownerCards.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  const act = btn.dataset.oact;
  const id = btn.dataset.id;
  if(!act || !id) return;
  handleOwnerAction(act, id);
});

el.ownerBody.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  const act = btn.dataset.oact;
  const id = btn.dataset.id;
  if(!act || !id) return;
  handleOwnerAction(act, id);
});

// Export/Import/Reset
el.btnExport.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agen-mandiri-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

el.fileImport.addEventListener("change", async ()=>{
  const file = el.fileImport.files?.[0];
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if(!data || typeof data !== "object") throw new Error("Format tidak valid.");
    if(!("transactions" in data) || !Array.isArray(data.transactions)) throw new Error("File tidak berisi transaksi.");

    state = {
      ...getDefaultState(),
      ...data,
      init: data.init || { cash: 0, atm: 0 },
      owners: Array.isArray(data.owners) ? data.owners : [],
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      meta: data.meta || { createdAt: nowISO(), updatedAt: nowISO() },
      ui: data.ui || { page: "dashboard" }
    };
    saveState(state);
    resetTxForm();
    resetOwnerForm();
    render();
    showPage(state.ui.page || "dashboard");
    alert("Import berhasil.");
  }catch(err){
    alert("Import gagal: " + (err?.message || "File rusak"));
  }finally{
    el.fileImport.value = "";
  }
});

el.btnReset.addEventListener("click", ()=>{
  const ok = confirm("Reset semua data? Ini akan menghapus saldo awal, transaksi, dan pemilik modal.");
  if(!ok) return;
  localStorage.removeItem(LS_KEY);
  state = getDefaultState();
  resetTxForm();
  resetOwnerForm();
  render();
  showPage("dashboard");
});

// init
function init(){
  el.txDate.value = nowDateISO();
  updateTxFormVisibility();
  updateProfitHint();
  render();
  showPage(state.ui?.page || "dashboard");
}
init();