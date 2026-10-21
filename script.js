/**
 * ProGestion V3.0 — Script principal
 * Version modernisée avec :
 * - Suppression des templates, Excel, WhatsApp, Catalogue, QR Code
 * - Mémoire des articles (autocomplétion)
 * - Refonte des paramètres (fiche entreprise)
 * - PDF premium
 * - Design modernisé
 */
(function () {
  'use strict';

  /* ============================================================
     SUPABASE
     ============================================================ */
  const SUPABASE_URL  = 'https://qpmxaxcyvwqhjhcbbjhc.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbXhheGN5dndxaGpoY2JiamhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMDg1NjAsImV4cCI6MjA5MTU4NDU2MH0.D9KZ9-b1LK5oHH8W7sX0pYScQHWM0exJWTv8Mtbpvdg';

  let supabase;
  try {
    if (!window.supabase?.createClient) throw new Error('Supabase SDK non disponible');
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  } catch (e) {
    console.warn('Supabase non chargé, mode dégradé :', e.message);
    supabase = {
      auth: {
        getSession:         async () => ({ data: { session: null }, error: null }),
        onAuthStateChange:  ()       => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async () => ({ error: { message: 'Serveur indisponible' } }),
        signUp:             async () => ({ error: { message: 'Serveur indisponible' } }),
        signOut:            async () => ({})
      },
      from: () => ({
        select: () => ({ count: 'exact', head: true, eq: () => ({ eq: () => ({}) }) }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: () => ({ eq: () => ({}) }) }),
        delete: () => ({ eq: () => ({ eq: () => ({}) }) })
      })
    };
  }

  /* ============================================================
     CONSTANTES
     ============================================================ */
  const DOC_LIMIT  = 10;
  const WA_NUMBER  = '22968908277';
  const MAX_UNDO   = 25;

  const STORAGE_KEYS = {
    draft:    'pg_draft.v7',
    counters: 'pg_counters.v7',
    clients:  'pg_clients.v7',
    settings: 'pg_settings.v7',
    articles: 'pg_articles.v7'
  };

  const MODES = {
    devis:    { label: 'DEVIS',     prefix: 'D', hasValidity: true  },
    facture:  { label: 'FACTURE',   prefix: 'F', hasValidity: false },
    proforma: { label: 'PRO FORMA', prefix: 'P', hasValidity: true  }
  };

  const STATUS_LABELS = {
    draft:    { label: 'Brouillon', icon: '📝', cls: 'status-draft'    },
    sent:     { label: 'Envoyé',    icon: '📤', cls: 'status-sent'     },
    accepted: { label: 'Accepté',   icon: '✅', cls: 'status-accepted' },
    invoiced: { label: 'Facturé',   icon: '💰', cls: 'status-invoiced' },
    refused:  { label: 'Refusé',    icon: '❌', cls: 'status-refused'  },
    expired:  { label: 'Expiré',    icon: '⏰', cls: 'status-expired'  }
  };

  /* ============================================================
     ÉTAT GLOBAL
     ============================================================ */
  const state = {
    mode:          'devis',
    logoDataURL:   null,
    sigImgDataURL: null,
    draftId:       uid(),
    docStatus:     'draft',
    _saveTimer:    null,
    _asiTimer:     null,
    draggedRow:    null,
    currentUser:   null,
    docCount:      0,
    currentView:   'editor',
    undoStack:     [],
    redoStack:     [],
    _undoLock:     false,
    settings:      loadSettings(),
    isFavorite:    false
  };

  /* ============================================================
     UTILITAIRES
     ============================================================ */
  function uid() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function fmt(n) {
    const r = Math.round(Number(n) || 0);
    return r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function num(v, min = 0) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? Math.max(min, x) : min;
  }

  function todayISO() { return new Date().toISOString().split('T')[0]; }

  function localDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function daysUntil(isoDate) {
    if (!isoDate) return null;
    const diff = new Date(isoDate) - new Date(todayISO());
    return Math.ceil(diff / 86400000);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, type = 'info', duration = 2800) {
    const el = $('#toast');
    if (!el) return;
    const colors = { success: '#14532d', error: '#7f1d1d', warning: '#78350f', info: 'var(--primary)' };
    const icons  = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    el.textContent = `${icons[type] || ''} ${msg}`;
    el.style.background = colors[type] || colors.info;
    el.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ============================================================
     PARAMÈTRES / SETTINGS (Fiche entreprise)
     ============================================================ */
  function defaultSettings() {
    return {
      companyName: '',
      managerName: '',
      managerFirstname: '',
      ifu: '',
      rccm: '',
      address: '',
      city: '',
      country: '',
      phone: '',
      email: '',
      website: '',
      defaultCurrency: 'CFA',
      logo: null,
      signature: null,
      paymentTerms: '',
      generalTerms: '',
      footer: '',
      vatRate: 18,
      reminders: true
    };
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings));
      return { ...defaultSettings(), ...raw };
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
  }

  function applySettingsToEditor() {
    const s = state.settings;
    const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
    set('#emitterName', s.companyName);
    set('#emitterAddress', s.address);
    set('#emitterExtra', `${s.city || ''} ${s.country || ''}`.trim());
    set('#emitterTel', s.phone);
    set('#emitterEmail', s.email);
    set('#currency', s.defaultCurrency || 'CFA');
    set('#vatRate', s.vatRate || 18);
    
    if (s.logo) {
      state.logoDataURL = s.logo;
      const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
      if (lp) { lp.src = s.logo; lp.style.display = 'block'; }
      if (lph) lph.style.display = 'none';
    }
    
    if (s.signature) {
      state.sigImgDataURL = s.signature;
      const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
      if (sp) { sp.src = s.signature; sp.style.display = 'block'; }
      if (sph) sph.style.display = 'none';
      if (scb) scb.style.display = 'flex';
    }
    
    if (s.paymentTerms) set('#docNotes', s.paymentTerms + (s.generalTerms ? '\n\n' + s.generalTerms : ''));
  }

  function populateSettingsPanel() {
    const s = state.settings;
    const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
    set('#settingCompanyName', s.companyName);
    set('#settingManagerName', s.managerName);
    set('#settingManagerFirstname', s.managerFirstname);
    set('#settingIfu', s.ifu);
    set('#settingRccm', s.rccm);
    set('#settingAddress', s.address);
    set('#settingCity', s.city);
    set('#settingCountry', s.country);
    set('#settingPhone', s.phone);
    set('#settingEmail', s.email);
    set('#settingWebsite', s.website);
    set('#settingDefaultCurrency', s.defaultCurrency || 'CFA');
    set('#settingVatRate', s.vatRate ?? 18);
    set('#settingPaymentTerms', s.paymentTerms || '');
    set('#settingGeneralTerms', s.generalTerms || '');
    set('#settingFooter', s.footer || '');
    if ($('#settingReminders')) $('#settingReminders').checked = s.reminders !== false;
    
    // Logo preview
    const logoPreview = $('#settingsLogoPreview');
    if (s.logo && logoPreview) {
      logoPreview.innerHTML = `<img src="${s.logo}" alt="Logo">`;
    } else if (logoPreview) {
      logoPreview.innerHTML = '<i class="fas fa-building"></i>';
    }
    
    // Signature preview
    const sigPreview = $('#settingsSigPreview');
    if (s.signature && sigPreview) {
      sigPreview.innerHTML = `<img src="${s.signature}" alt="Signature">`;
    } else if (sigPreview) {
      sigPreview.innerHTML = '<i class="fas fa-signature"></i><span>Aucune signature</span>';
    }
    
    // Show remove buttons if needed
    const logoRemove = $('#settingsLogoRemove');
    if (logoRemove) logoRemove.style.display = s.logo ? 'flex' : 'none';
    const sigRemove = $('#settingsSigRemove');
    if (sigRemove) sigRemove.style.display = s.signature ? 'flex' : 'none';
  }

  function bindSettingsEvents() {
    // Logo upload
    $('#settingsLogoUploadBtn')?.addEventListener('click', () => $('#settingsLogoUpload')?.click());
    $('#settingsLogoUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.settings.logo = ev.target.result;
        const preview = $('#settingsLogoPreview');
        if (preview) preview.innerHTML = `<img src="${ev.target.result}" alt="Logo">`;
        const remove = $('#settingsLogoRemove');
        if (remove) remove.style.display = 'flex';
        toast('Logo importé', 'success');
      };
      reader.readAsDataURL(file);
    });
    
    $('#settingsLogoRemove')?.addEventListener('click', () => {
      state.settings.logo = null;
      const preview = $('#settingsLogoPreview');
      if (preview) preview.innerHTML = '<i class="fas fa-building"></i>';
      const remove = $('#settingsLogoRemove');
      if (remove) remove.style.display = 'none';
      toast('Logo supprimé', 'info');
    });
    
    // Signature upload
    $('#settingsSigUploadBtn')?.addEventListener('click', () => $('#settingsSigUpload')?.click());
    $('#settingsSigUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.settings.signature = ev.target.result;
        const preview = $('#settingsSigPreview');
        if (preview) preview.innerHTML = `<img src="${ev.target.result}" alt="Signature">`;
        const remove = $('#settingsSigRemove');
        if (remove) remove.style.display = 'flex';
        toast('Signature importée', 'success');
      };
      reader.readAsDataURL(file);
    });
    
    $('#settingsSigRemove')?.addEventListener('click', () => {
      state.settings.signature = null;
      const preview = $('#settingsSigPreview');
      if (preview) preview.innerHTML = '<i class="fas fa-signature"></i><span>Aucune signature</span>';
      const remove = $('#settingsSigRemove');
      if (remove) remove.style.display = 'none';
      toast('Signature supprimée', 'info');
    });
    
    // Save settings
    $('#btnSettingsSave')?.addEventListener('click', () => {
      const get = (id) => $(id)?.value || '';
      state.settings = {
        ...state.settings,
        companyName: get('#settingCompanyName'),
        managerName: get('#settingManagerName'),
        managerFirstname: get('#settingManagerFirstname'),
        ifu: get('#settingIfu'),
        rccm: get('#settingRccm'),
        address: get('#settingAddress'),
        city: get('#settingCity'),
        country: get('#settingCountry'),
        phone: get('#settingPhone'),
        email: get('#settingEmail'),
        website: get('#settingWebsite'),
        defaultCurrency: get('#settingDefaultCurrency') || 'CFA',
        vatRate: num($('#settingVatRate')?.value, 0) || 18,
        paymentTerms: get('#settingPaymentTerms'),
        generalTerms: get('#settingGeneralTerms'),
        footer: get('#settingFooter'),
        reminders: $('#settingReminders')?.checked !== false
      };
      saveSettings(state.settings);
      applySettingsToEditor();
      renderDashboard();
      toast('Informations enregistrées', 'success');
    });
  }

  /* ============================================================
     MÉMOIRE DES ARTICLES
     ============================================================ */
  function getArticles() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.articles)) || []; }
    catch { return []; }
  }

  function saveArticles(list) {
    localStorage.setItem(STORAGE_KEYS.articles, JSON.stringify(list.slice(0, 200)));
  }

  function addArticle(designation, qty, price) {
    if (!designation || !designation.trim()) return;
    const articles = getArticles();
    const existing = articles.findIndex(a => a.designation.toLowerCase() === designation.toLowerCase());
    const article = { designation: designation.trim(), qty: num(qty, 0) || 1, price: num(price, 0), uses: 1, lastUsed: new Date().toISOString() };
    if (existing >= 0) {
      articles[existing].uses += 1;
      articles[existing].lastUsed = new Date().toISOString();
      articles[existing].qty = article.qty;
      articles[existing].price = article.price;
    } else {
      articles.unshift(article);
    }
    saveArticles(articles);
    populateItemDatalist();
  }

  function populateItemDatalist() {
    const dl = $('#itemDatalist');
    if (!dl) return;
    const articles = getArticles().slice(0, 80);
    const curr = state.settings?.defaultCurrency || 'CFA';
    dl.innerHTML = articles.map(item => 
      `<option value="${escHtml(item.designation)}">${fmt(item.price)} ${curr}</option>`
    ).join('');
  }

  function getArticleSuggestions(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return getArticles()
      .filter(a => a.designation.toLowerCase().includes(q))
      .slice(0, 8);
  }

  /* ============================================================
     CARNET CLIENTS
     ============================================================ */
  function getClients() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.clients)) || []; }
    catch { return []; }
  }

  function saveClients(list) {
    localStorage.setItem(STORAGE_KEYS.clients, JSON.stringify(list));
  }

  function saveCurrentClient() {
    const name = $('#clientName')?.value?.trim();
    if (!name) { toast('Renseignez d\'abord le nom du client', 'warning'); return; }
    const clients = getClients();
    const existing = clients.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
    const clientData = {
      id:      existing >= 0 ? clients[existing].id : uid(),
      name,
      address: $('#clientAddress')?.value || '',
      extra:   $('#clientExtra')?.value   || '',
      siret:   $('#clientSiret')?.value   || '',
      tel:     $('#clientTel')?.value     || '',
      email:   $('#clientEmail')?.value   || '',
      savedAt: new Date().toISOString()
    };
    if (existing >= 0) { clients[existing] = clientData; }
    else { clients.unshift(clientData); }
    saveClients(clients);
    populateClientDatalist();
    toast(existing >= 0 ? 'Client mis à jour' : 'Client enregistré', 'success');
  }

  function fillClientFields(c) {
    if (!c) return;
    const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
    set('#clientName',    c.name);
    set('#clientAddress', c.address);
    set('#clientExtra',   c.extra);
    set('#clientSiret',   c.siret);
    set('#clientTel',     c.tel);
    set('#clientEmail',   c.email);
    scheduleSave();
  }

  function renderClientsView() {
    const grid = $('#clientsGrid');
    if (!grid) return;
    const q = ($('#clientsSearch')?.value || '').toLowerCase();
    const clients = getClients().filter(c => !q || c.name.toLowerCase().includes(q) || (c.tel || '').includes(q));

    grid.innerHTML = '';
    if (clients.length === 0) {
      grid.innerHTML = `<div class="history-empty">
        <i class="fas fa-address-book"></i>
        ${q ? 'Aucun client trouvé' : 'Aucun client enregistré.'}
      </div>`;
      return;
    }

    clients.forEach(c => {
      const docs = getHistory().filter(d => d.client?.name?.toLowerCase() === c.name.toLowerCase());
      const ca   = docs.reduce((s, d) => s + computeTTC(d), 0);
      const card = document.createElement('div');
      card.className = 'client-card';
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div class="cc-avatar">${c.name.charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div class="cc-name">${escHtml(c.name)}</div>
            <div class="cc-info">
              ${c.tel     ? `<div>📞 ${escHtml(c.tel)}</div>` : ''}
              ${c.email   ? `<div>✉️ ${escHtml(c.email)}</div>` : ''}
              ${c.address ? `<div>📍 ${escHtml(c.address)}</div>` : ''}
            </div>
          </div>
        </div>
        <div class="cc-stats">
          <div class="cc-stat"><div class="cc-stat-label">Documents</div><div class="cc-stat-value">${docs.length}</div></div>
          <div class="cc-stat"><div class="cc-stat-label">CA total</div><div class="cc-stat-value">${fmt(ca)} ${state.settings?.defaultCurrency || 'CFA'}</div></div>
        </div>
        <div class="cc-actions">
          <button class="cc-btn cc-btn-new" data-id="${c.id}"><i class="fas fa-plus"></i> Nouveau doc</button>
          <button class="cc-btn cc-btn-del" data-id="${c.id}"><i class="fas fa-trash"></i></button>
        </div>`;
      grid.appendChild(card);
    });

    grid.onclick = e => {
      const newBtn = e.target.closest('.cc-btn-new');
      const delBtn = e.target.closest('.cc-btn-del');
      if (newBtn) {
        const c = getClients().find(x => x.id === newBtn.dataset.id);
        if (c) { fillClientFields(c); switchView('editor'); resetToNew(false, c); toast(`Document pour ${c.name}`, 'info'); }
      }
      if (delBtn) {
        if (confirm('Supprimer ce client ?')) {
          const list = getClients().filter(x => x.id !== delBtn.dataset.id);
          saveClients(list);
          renderClientsView();
          toast('Client supprimé', 'warning');
        }
      }
    };
  }

  function openClientPicker() {
    const modal = $('#clientPickerModal');
    if (!modal) return;
    modal.classList.add('open');
    renderClientPickerList('');
    $('#clientPickerSearch')?.focus();
  }

  function renderClientPickerList(q) {
    const list = $('#clientPickerList');
    if (!list) return;
    const clients = getClients().filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()));
    list.innerHTML = '';
    if (clients.length === 0) {
      list.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-light);font-size:0.85rem">
        ${q ? 'Aucun résultat' : 'Aucun client enregistré'}
      </div>`;
      return;
    }
    clients.forEach(c => {
      const item = document.createElement('div');
      item.className = 'client-picker-item';
      item.innerHTML = `
        <div class="cpi-avatar">${c.name.charAt(0).toUpperCase()}</div>
        <div>
          <div class="cpi-name">${escHtml(c.name)}</div>
          <div class="cpi-info">${escHtml([c.tel, c.email].filter(Boolean).join(' · '))}</div>
        </div>`;
      item.addEventListener('click', () => {
        fillClientFields(c);
        $('#clientPickerModal').classList.remove('open');
        toast(`Client sélectionné : ${c.name}`, 'success');
      });
      list.appendChild(item);
    });
  }

  function populateClientDatalist() {
    const dl = $('#clientDatalist');
    if (!dl) return;
    const names = [...new Set([
      ...getClients().map(c => c.name),
      ...getHistory().map(d => d.client?.name).filter(Boolean)
    ])];
    dl.innerHTML = names.map(n => `<option value="${escHtml(n)}">`).join('');
  }

  /* ============================================================
     NUMÉROTATION AUTOMATIQUE
     ============================================================ */
  function peekNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const year = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const key  = `${mode}-${year}`;
    const next = (counters[key] || 0) + 1;
    return `${prefix}${year}-${String(next).padStart(4, '0')}`;
  }

  function consumeNextNumber(mode) {
    const { prefix } = MODES[mode] || MODES.devis;
    const year = String(new Date().getFullYear()).slice(-2);
    const counters = getCounters();
    const key  = `${mode}-${year}`;
    const next = (counters[key] || 0) + 1;
    counters[key] = next;
    localStorage.setItem(STORAGE_KEYS.counters, JSON.stringify(counters));
    return `${prefix}${year}-${String(next).padStart(4, '0')}`;
  }

  function getCounters() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.counters)) || {}; }
    catch { return {}; }
  }

  /* ============================================================
     MODE DEVIS / FACTURE / PRO FORMA
     ============================================================ */
  function setMode(mode) {
    if (!MODES[mode]) mode = 'devis';
    state.mode = mode;
    const { label, hasValidity } = MODES[mode];
    if ($('#docTitle'))     $('#docTitle').textContent = label;
    if ($('#docTypeBadge')) $('#docTypeBadge').textContent = label;

    $$('.mode-nav-btn').forEach(b => b.classList.remove('active'));
    $('#navDevis')?.classList[mode === 'devis'    ? 'add' : 'remove']('active');
    $('#navFacture')?.classList[mode === 'facture'  ? 'add' : 'remove']('active');
    $('#navProforma')?.classList[mode === 'proforma' ? 'add' : 'remove']('active');

    const vc = $('#validityContainer');
    if (vc) vc.style.display = hasValidity ? '' : 'none';

    // Sync mobile type popup button + options
    $$('.mbn-type-popup-option').forEach(b => {
      b.classList[b.dataset.mode === mode ? 'add' : 'remove']('active');
    });
    const mbnLbl = $('#mbnTypeLabel');
    const modeDisplayName = label === 'PRO FORMA' ? 'Pro Forma' : label.charAt(0) + label.slice(1).toLowerCase();
    if (mbnLbl) mbnLbl.textContent = modeDisplayName;
    const mbnTypeIcon = $('#mbnTypeIcon');
    const iconMap = { devis: 'fa-file-alt', facture: 'fa-file-invoice-dollar', proforma: 'fa-file-invoice' };
    if (mbnTypeIcon) { mbnTypeIcon.className = 'fas ' + (iconMap[mode] || 'fa-file-alt'); }
    const mbnTypeBtn2 = $('#mbnTypeBtn');
    if (mbnTypeBtn2) mbnTypeBtn2.classList[mode !== 'devis' ? 'add' : 'remove']('type-active');

    updateBreadcrumb();
  }

  /* ============================================================
     STATUT DU DOCUMENT
     ============================================================ */
  function setStatus(status) {
    state.docStatus = status || 'draft';
    const sel = $('#docStatus');
    if (sel) {
      sel.value = state.docStatus;
      sel.dataset.val = state.docStatus;
    }
  }

  /* ============================================================
     SIDEBAR & NAVIGATION PAR VUES
     ============================================================ */
  function bindSidebarEvents() {
    const sidebar = $('#sidebar');
    const toggleBtn = $('#sidebarToggle');

    toggleBtn?.addEventListener('click', () => {
      sidebar?.classList.toggle('collapsed');
    });

    $$('.sidebar-nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $$('.mode-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setMode(btn.dataset.mode);
        switchView('editor');
      });
    });

    $('#navNew')?.addEventListener('click', () => {
      if (confirm('Créer un nouveau document ? Le brouillon actuel sera conservé dans l\'historique.')) {
        resetToNew(false);
        switchView('editor');
        toast('Nouveau document créé', 'success');
      }
    });

    $$('.mbn-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // D4 — Bouton Type → popup mobile
    const mbnTypeBtn = $('#mbnTypeBtn');
    const mbnTypePopup = $('#mbnTypePopup');
    const mbnTypeBackdrop = $('#mbnTypeBackdrop');

    function openTypePopup() {
      if (!mbnTypePopup || !mbnTypeBackdrop) return;
      mbnTypePopup.classList.add('open');
      mbnTypeBackdrop.classList.add('open');
    }
    function closeTypePopup() {
      if (!mbnTypePopup || !mbnTypeBackdrop) return;
      mbnTypePopup.classList.remove('open');
      mbnTypeBackdrop.classList.remove('open');
    }

    mbnTypeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      mbnTypePopup?.classList.contains('open') ? closeTypePopup() : openTypePopup();
    });
    mbnTypeBackdrop?.addEventListener('click', closeTypePopup);

    $$('.mbn-type-popup-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        setMode(mode);
        switchView('editor');
        closeTypePopup();
      });
    });

    // D3 — Barre nav mobile auto-masquage au scroll
    (function setupNavAutoHide() {
      const nav = $('#mobileBottomNav');
      const scroll = document.querySelector('.page-scroll');
      if (!nav || !scroll) return;
      let lastY = scroll.scrollTop;
      let ticking = false;
      scroll.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const currentY = scroll.scrollTop;
          if (currentY > lastY + 4) {
            nav.classList.add('nav-hidden');
          } else if (currentY < lastY - 4) {
            nav.classList.remove('nav-hidden');
          }
          lastY = currentY;
          ticking = false;
        });
      }, { passive: true });
    })();
  }

  function switchView(view) {
    state.currentView = view;

    $$('.view-panel').forEach(p => p.classList.remove('active'));
    const panelMap = { dashboard: 'viewDashboard', editor: 'viewEditor', history: 'viewHistory', clients: 'viewClients', settings: 'viewSettings' };
    $('#' + (panelMap[view] || 'viewEditor'))?.classList.add('active');

    $$('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
    const navMap = { dashboard: 'navDashboard', editor: 'navNew', history: 'navHistory', clients: 'navClients', settings: 'navSettings' };
    if (navMap[view]) $('#' + navMap[view])?.classList.add('active');

    $$('.mbn-item').forEach(b => b.classList.remove('active'));
    $$('.mbn-item[data-view="' + view + '"]').forEach(b => b.classList.add('active'));

    // Afficher les boutons Sauvegarder/PDF uniquement sur l'éditeur
    const topbarActions = $('#btnArchive')?.closest('.topbar-actions');
    if (topbarActions) topbarActions.style.display = (view === 'editor') ? '' : 'none';

    if (view === 'history') renderHistory();
    if (view === 'clients') { renderClientsView(); populateClientDatalist(); }
    if (view === 'dashboard') renderDashboard();
    if (view === 'settings') populateSettingsPanel();

    updateBreadcrumb(view);
    updateWorkspaceHeader(view);
  }

  function updateBreadcrumb(view) {
    view = view || state.currentView;
    const el = $('#bcCurrent');
    if (!el) return;
    const labels = {
      dashboard: 'Dashboard',
      editor: `${MODES[state.mode]?.label || 'Document'} — ${$('#docNumber')?.value || '…'}`,
      history: 'Historique',
      clients: 'Carnet clients',
      settings: 'Mon entreprise'
    };
    el.textContent = labels[view] || 'Document';
  }

  function updateWorkspaceHeader(view) {
    const title = $('#workspaceTitle');
    const subtitle = $('#workspaceSubtitle');
    const map = {
      dashboard: ['Dashboard de gestion', 'Vos indicateurs, vos clients et vos documents en un coup d’œil.'],
      editor: ['Création de document', 'Générez un devis ou une facture professionnelle en quelques clics.'],
      history: ['Historique intelligent', 'Filtrez, dupliquez et relancez vos documents en quelques secondes.'],
      clients: ['Carnet clients', 'Réutilisez vos contacts et gagnez en vitesse de saisie.'],
      settings: ['Mon entreprise', 'Configurez vos informations pour les réutiliser automatiquement.']
    };
    const [t, s] = map[view || state.currentView] || map.editor;
    if (title) title.textContent = t;
    if (subtitle) subtitle.textContent = s;
  }

  /* ============================================================
     UNDO / REDO
     ============================================================ */
  function snapshotState() {
    if (state._undoLock) return;
    const snap = collectData();
    state.undoStack.push(JSON.stringify(snap));
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack = [];
    updateUndoRedoBtns();
  }

  function undo() {
    if (state.undoStack.length < 2) return;
    state.redoStack.push(state.undoStack.pop());
    const snap = state.undoStack[state.undoStack.length - 1];
    if (!snap) return;
    state._undoLock = true;
    applyData(JSON.parse(snap));
    state._undoLock = false;
    updateUndoRedoBtns();
    showAutosaveIndicator('saving');
    setTimeout(() => showAutosaveIndicator('saved'), 500);
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    const snap = state.redoStack.pop();
    state.undoStack.push(snap);
    state._undoLock = true;
    applyData(JSON.parse(snap));
    state._undoLock = false;
    updateUndoRedoBtns();
  }

  function updateUndoRedoBtns() {
    const uBtn = $('#btnUndo');
    const rBtn = $('#btnRedo');
    if (uBtn) uBtn.disabled = state.undoStack.length < 2;
    if (rBtn) rBtn.disabled = state.redoStack.length === 0;
  }

  /* ============================================================
     AUTOSAVE INDICATOR
     ============================================================ */
  function showAutosaveIndicator(state_) {
    const dot  = $('#asiDot');
    const text = $('#asiText');
    if (!dot || !text) return;
    if (state_ === 'saving') {
      dot.className = 'asi-dot saving';
      text.textContent = 'Enregistrement…';
    } else if (state_ === 'saved') {
      dot.className = 'asi-dot saved';
      text.textContent = 'Sauvegardé';
      clearTimeout(state._asiTimer);
      state._asiTimer = setTimeout(() => {
        dot.className = 'asi-dot';
        text.textContent = '';
      }, 2500);
    }
  }

  /* ============================================================
     CRÉATION DE LIGNES
     ============================================================ */
  function createRow(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.rowId = item.id || uid();

    const makeTd = (cls = '') => { const td = document.createElement('td'); if (cls) td.className = cls; return td; };
    const makeInput = (type, cls, placeholder, value, field) => {
      const inp = document.createElement('input');
      inp.type = type;
      inp.className = cls;
      inp.placeholder = placeholder;
      inp.value = value;
      inp.dataset.field = field;
      if (type === 'number') { inp.min = '0'; inp.step = '1'; }
      return inp;
    };

    const tdDrag = makeTd('drag-handle');
    tdDrag.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    tdDrag.setAttribute('title', 'Glisser pour réordonner');
    tr.appendChild(tdDrag);

    const tdD = makeTd('col-designation');
    const inpD = makeInput('text', 'item-input', 'Désignation du produit/service', item.designation || '', 'designation');
    inpD.setAttribute('list', 'itemDatalist');
    tdD.appendChild(inpD);
    tr.appendChild(tdD);

    const tdQ = makeTd('col-qty');
    tdQ.appendChild(makeInput('number', 'item-input num', '0', item.qty ?? 1, 'qty'));
    tr.appendChild(tdQ);

    const tdP = makeTd('col-price');
    tdP.appendChild(makeInput('number', 'item-input num', '0', item.price ?? 0, 'price'));
    tr.appendChild(tdP);

    const tdT = makeTd('line-total-cell');
    tdT.textContent = fmt((item.qty ?? 1) * (item.price ?? 0));
    tr.appendChild(tdT);

    const tdA = makeTd('col-actions');
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'remove-row-btn';
    btnDel.innerHTML = '<i class="fas fa-trash"></i>';
    btnDel.dataset.action = 'remove-row';
    btnDel.title = 'Supprimer la ligne';
    tdA.appendChild(btnDel);
    tr.appendChild(tdA);

    tr.draggable = true;
    tr.addEventListener('dragstart', onDragStart);
    tr.addEventListener('dragover',  onDragOver);
    tr.addEventListener('drop',      onDrop);
    tr.addEventListener('dragend',   onDragEnd);

    return tr;
  }

  function addRow(item = {}, focus = false) {
    const body = $('#itemsBody');
    if (!body) return;
    const row = createRow({ id: uid(), qty: 1, price: 0, ...item });
    body.appendChild(row);
    if (focus) row.querySelector('.item-input')?.focus();
    recalculate();
    scheduleSave();
  }

  function ensureOneRow() {
    const body = $('#itemsBody');
    if (body && body.children.length === 0) addRow();
  }

  /* ============================================================
     DRAG & DROP
     ============================================================ */
  function onDragStart(e) {
    if (!e.target.closest('.drag-handle')) { e.preventDefault(); return; }
    state.draggedRow = this;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => this.classList.add('dragging'));
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!state.draggedRow || this === state.draggedRow || this.tagName !== 'TR') return;
    const rect = this.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > rect.height / 2;
    this.parentNode.insertBefore(state.draggedRow, isAfter ? this.nextSibling : this);
  }

  function onDrop(e) { e.preventDefault(); recalculate(); scheduleSave(); }

  function onDragEnd() {
    if (state.draggedRow) state.draggedRow.classList.remove('dragging');
    state.draggedRow = null;
  }

  /* ============================================================
     CALCULS
     ============================================================ */
  function getRowValues() {
    const body = $('#itemsBody');
    if (!body) return [];
    return Array.from(body.rows).map(tr => ({
      designation: tr.querySelector('[data-field="designation"]')?.value || '',
      qty:   num(tr.querySelector('[data-field="qty"]')?.value),
      price: num(tr.querySelector('[data-field="price"]')?.value)
    }));
  }

  function recalculate() {
    const body = $('#itemsBody');
    if (!body) return;

    let subtotal = 0;
    for (const tr of body.rows) {
      const q = num(tr.querySelector('[data-field="qty"]')?.value);
      const p = num(tr.querySelector('[data-field="price"]')?.value);
      const lt = q * p;
      subtotal += lt;
      const cell = tr.querySelector('.line-total-cell');
      if (cell) cell.textContent = fmt(lt);
    }

    const curr        = state.settings?.defaultCurrency || 'CFA';
    const discountOn  = $('#discountEnabled')?.checked || false;
    const discountRate = discountOn ? num($('#discountRate')?.value) : 0;
    const discount    = subtotal * discountRate / 100;
    const afterDiscount = subtotal - discount;
    const vatOn       = $('#vatEnabled')?.checked || false;
    const vatRate     = vatOn ? num($('#vatRate')?.value) : 0;
    const tax         = afterDiscount * vatRate / 100;
    const total       = afterDiscount + tax;

    if ($('#discountRateDisplay')) $('#discountRateDisplay').textContent = discountRate;
    const dic = $('#discountInputContainer');
    if (dic) dic.style.display = discountOn ? 'flex' : 'none';
    const dr = $('#discountRow');
    if (dr) dr.style.display = discountOn ? '' : 'none';

    if ($('#vatRateDisplay')) $('#vatRateDisplay').textContent = vatRate;
    const vic = $('#vatInputContainer');
    if (vic) vic.style.display = vatOn ? 'flex' : 'none';
    const vr = $('#vatRow');
    if (vr) vr.style.display = vatOn ? '' : 'none';

    const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = fmt(v); };
    set('subtotal',      subtotal);
    set('totalDiscount', discount);
    set('totalTax',      tax);
    set('grandTotal',    total);

    if ($('#bannerGrandTotal')) $('#bannerGrandTotal').textContent = `${fmt(total)} ${curr}`;
    if ($('#bannerDocNumber')) $('#bannerDocNumber').textContent = $('#docNumber')?.value || '—';

    $$('.curr').forEach(el => { el.textContent = curr; });
  }

  /* ============================================================
     COLLECTE DES DONNÉES
     ============================================================ */
  function collectData() {
    const rows = [];
    const body = $('#itemsBody');
    if (body) {
      for (const tr of body.rows) {
        rows.push({
          id:          tr.dataset.rowId,
          designation: tr.querySelector('[data-field="designation"]')?.value || '',
          qty:         num(tr.querySelector('[data-field="qty"]')?.value),
          price:       num(tr.querySelector('[data-field="price"]')?.value)
        });
      }
    }

    return {
      id:           state.draftId,
      mode:         state.mode,
      docStatus:    state.docStatus || 'draft',
      docNumber:    $('#docNumber')?.value    || '',
      docDate:      $('#docDate')?.value      || todayISO(),
      docValidity:  $('#docValidity')?.value  || '',
      currency:     $('#currency')?.value || state.settings?.defaultCurrency || 'CFA',
      vatEnabled:   $('#vatEnabled')?.checked ?? true,
      vatRate:      num($('#vatRate')?.value, 0),
      discountEnabled: $('#discountEnabled')?.checked || false,
      discountRate:    num($('#discountRate')?.value, 0),
      notes:        $('#docNotes')?.value     || '',
      placeOfIssue: $('#placeOfIssue')?.value || '',
      signatoryName: $('#signatoryName')?.value || '',
      signatoryRole: $('#signatoryRole')?.value || '',
      emitter: {
        name:    $('#emitterName')?.value    || '',
        address: $('#emitterAddress')?.value || '',
        extra:   $('#emitterExtra')?.value   || '',
        tel:     $('#emitterTel')?.value     || '',
        email:   $('#emitterEmail')?.value   || ''
      },
      client: {
        name:    $('#clientName')?.value    || '',
        address: $('#clientAddress')?.value || '',
        extra:   $('#clientExtra')?.value   || '',
        siret:   $('#clientSiret')?.value   || '',
        tel:     $('#clientTel')?.value     || '',
        email:   $('#clientEmail')?.value   || ''
      },
      logo:     state.logoDataURL   || null,
      sigImg:   state.sigImgDataURL || null,
      items:    rows,
      updatedAt: new Date().toISOString()
    };
  }

  function applyData(data) {
    if (!data) return;
    state.draftId      = data.id       || uid();
    state.logoDataURL  = data.logo     || null;
    state.sigImgDataURL = data.sigImg  || null;

    const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
    set('#emitterName',    data.emitter?.name);
    set('#emitterAddress', data.emitter?.address);
    set('#emitterExtra',   data.emitter?.extra);
    set('#emitterTel',     data.emitter?.tel);
    set('#emitterEmail',   data.emitter?.email);
    set('#clientName',    data.client?.name);
    set('#clientAddress', data.client?.address);
    set('#clientExtra',   data.client?.extra);
    set('#clientSiret',   data.client?.siret);
    set('#clientTel',     data.client?.tel);
    set('#clientEmail',   data.client?.email);
    set('#docNumber',    data.docNumber);
    set('#docDate',      data.docDate || todayISO());
    set('#docValidity',  data.docValidity);
    set('#currency',     data.currency || 'CFA');
    set('#placeOfIssue', data.placeOfIssue);
    set('#docNotes',     data.notes);
    set('#signatoryName', data.signatoryName);
    const sr = $('#signatoryRole');
    if (sr) sr.value = data.signatoryRole || '';

    const ve = $('#vatEnabled');      if (ve) ve.checked  = data.vatEnabled !== false;
    const vr = $('#vatRate');         if (vr) vr.value    = data.vatRate ?? 18;
    const de = $('#discountEnabled'); if (de) de.checked  = data.discountEnabled || false;
    const dr = $('#discountRate');    if (dr) dr.value    = data.discountRate ?? 0;

    const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
    if (data.logo && lp && lph) { lp.src = data.logo; lp.style.display = 'block'; lph.style.display = 'none'; }
    else if (lp && lph)         { lp.style.display = 'none'; lph.style.display = 'flex'; }

    const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
    if (data.sigImg && sp && sph) {
      sp.src = data.sigImg; sp.style.display = 'block'; sph.style.display = 'none';
      if (scb) scb.style.display = 'flex';
    } else if (sp && sph) {
      sp.src = ''; sp.style.display = 'none'; sph.style.display = 'flex';
      if (scb) scb.style.display = 'none';
    }

    const body = $('#itemsBody');
    if (body) {
      body.innerHTML = '';
      if (Array.isArray(data.items) && data.items.length) {
        data.items.forEach(it => body.appendChild(createRow({ ...it, designation: it.designation || it.description || '' })));
      } else { addRow(); }
    }

    setMode(data.mode || 'devis');
    setStatus(data.docStatus || 'draft');
    recalculate();
    populateClientDatalist();
    populateItemDatalist();
  }

  /* ============================================================
     SAUVEGARDE BROUILLON
     ============================================================ */
  function saveDraft() {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(collectData()));
  }

  function scheduleSave() {
    showAutosaveIndicator('saving');
    clearTimeout(state._saveTimer);
    state._saveTimer = setTimeout(() => {
      saveDraft();
      showAutosaveIndicator('saved');
      snapshotState();
    }, 700);
  }

  function loadDraft() {
    const raw = localStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) { resetToNew(); return; }
    try   { applyData(JSON.parse(raw)); }
    catch { resetToNew(); }
  }

  function resetToNew(clearEmitter = false, prefillClient = null) {
    state.draftId = uid();
    state.docStatus = 'draft';
    state.sigImgDataURL = null;

    if (clearEmitter) {
      ['#emitterName','#emitterAddress','#emitterExtra','#emitterTel','#emitterEmail']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
      state.logoDataURL = null;
      const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
      if (lp) lp.style.display = 'none';
      if (lph) lph.style.display = 'flex';
    }

    if (!prefillClient) {
      ['#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
    } else {
      fillClientFields(prefillClient);
    }

    const d = $('#docDate');     if (d) d.value = todayISO();
    const v = $('#docValidity'); if (v) v.value = '';
    const n = $('#docNotes');    if (n) n.value = '';
    const p = $('#placeOfIssue'); if (p) p.value = '';
    const sn = $('#signatoryName'); if (sn) sn.value = '';
    const sr = $('#signatoryRole'); if (sr) sr.value = '';
    const ve = $('#vatEnabled'); if (ve) ve.checked = true;
    const vr = $('#vatRate');    if (vr) vr.value = state.settings?.vatRate || 18;
    const de = $('#discountEnabled'); if (de) de.checked = false;
    const dr = $('#discountRate');    if (dr) dr.value = 0;

    const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
    if (sp)  sp.style.display  = 'none';
    if (sph) sph.style.display = 'flex';
    if (scb) scb.style.display = 'none';

    const newNumber = consumeNextNumber(state.mode || 'devis');
    const dn = $('#docNumber'); if (dn) dn.value = newNumber;

    const body = $('#itemsBody');
    if (body) { body.innerHTML = ''; addRow(); }

    setMode(state.mode || 'devis');
    setStatus('draft');
    recalculate();
    saveDraft();
    updateBreadcrumb();
    state.undoStack = [];
    state.redoStack = [];
    updateUndoRedoBtns();
    
    // Appliquer les paramètres entreprise
    applySettingsToEditor();
  }

  /* ============================================================
     DUPLICATION
     ============================================================ */
  function duplicateDocument() {
    const data   = collectData();
    data.id      = uid();
    data.docNumber = consumeNextNumber(data.mode);
    data.docDate = todayISO();
    data.docStatus = 'draft';
    data.savedAt = null;
    applyData(data);
    switchView('editor');
    toast(`Document dupliqué → ${data.docNumber}`, 'success');
    scheduleSave();
  }

  /* ============================================================
     HISTORIQUE
     ============================================================ */
  function historyKey() {
    return state.currentUser ? `pg_history.v7.${state.currentUser.id}` : 'pg_history.v7.anon';
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey())) || []; }
    catch { return []; }
  }

  function saveHistory(hist) {
    localStorage.setItem(historyKey(), JSON.stringify(hist.slice(0, 100)));
  }

  async function archiveDocument() {
    const data  = collectData();
    data.savedAt = new Date().toISOString();
    const hist   = getHistory();
    const dupIdx = hist.findIndex(it => it.docNumber === data.docNumber && it.mode === data.mode);
    const isNew  = dupIdx < 0;

    if (isNew && state.currentUser && state.docCount >= DOC_LIMIT) {
      showLimitModal();
      return;
    }

    if (dupIdx >= 0) { hist[dupIdx] = data; }
    else             { hist.unshift(data); }
    saveHistory(hist);
    updateHistoryBadge();
    populateClientDatalist();

    if (state.currentUser) await syncDocumentToSupabase(data, isNew);

    toast('Document sauvegardé ✓', 'success');
  }

  function updateHistoryBadge() {
    const badge = $('#historyBadgeCount');
    if (!badge) return;
    const count = getHistory().length;
    badge.textContent = count > 0 ? String(count) : '';
  }

  function renderHistory() {
    const grid = $('#historyList');
    if (!grid) return;

    const q          = ($('#historySearch')?.value || '').toLowerCase();
    const typeFilter = $('#filterType')?.value  || '';
    const statFilter = $('#filterStatus')?.value || '';

    const hist = getHistory().filter(it => {
      const matchQ    = !q || (it.client?.name || '').toLowerCase().includes(q) || (it.docNumber || '').toLowerCase().includes(q);
      const matchType = !typeFilter || it.mode === typeFilter;
      const matchStat = !statFilter || it.docStatus === statFilter;
      return matchQ && matchType && matchStat;
    });

    grid.innerHTML = '';

    if (hist.length === 0) {
      grid.innerHTML = `<div class="history-empty">
        <i class="fas fa-folder-open"></i>
        ${q || typeFilter || statFilter ? 'Aucun document ne correspond aux filtres' : 'Aucun document sauvegardé'}
      </div>`;
      return;
    }

    hist.forEach((item, idx) => {
      const ttc       = computeTTC(item);
      const savedDate = item.savedAt ? new Date(item.savedAt).toLocaleDateString('fr-FR') : '—';
      const modeLabel = MODES[item.mode]?.label || 'DEVIS';
      const st        = STATUS_LABELS[item.docStatus] || STATUS_LABELS.draft;
      const validity  = item.docValidity;
      const daysLeft  = validity ? daysUntil(validity) : null;

      let expiryWarning = '';
      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && item.mode !== 'facture') {
        expiryWarning = `<div class="hc-meta-item" style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> Expire dans ${daysLeft}j</div>`;
      }

      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="hc-top">
          <div class="hc-badges">
            <span class="hc-type-badge">${modeLabel}</span>
            <span class="hc-status-badge ${st.cls}">${st.icon} ${st.label}</span>
          </div>
        </div>
        <div class="hc-number">${escHtml(item.docNumber || 'Sans numéro')}</div>
        <div class="hc-client"><i class="fas fa-user"></i> ${escHtml(item.client?.name || 'Client non renseigné')}</div>
        <div class="hc-meta">
          <div class="hc-meta-item"><i class="fas fa-calendar-alt"></i> ${escHtml(item.docDate || '—')}</div>
          <div class="hc-meta-item"><i class="fas fa-clock"></i> ${savedDate}</div>
          ${expiryWarning}
        </div>
        <div class="hc-amount">${fmt(ttc)} ${item.currency || 'CFA'} TTC</div>
        <div class="hc-actions">
          <button class="hc-btn hc-btn-load" data-id="${item.id}"><i class="fas fa-folder-open"></i> Charger</button>
          <button class="hc-btn hc-btn-dup"  data-id="${item.id}"><i class="fas fa-copy"></i> Dupliquer</button>
          <button class="hc-btn hc-btn-pdf"  data-id="${item.id}"><i class="fas fa-file-pdf"></i></button>
          <button class="hc-btn hc-btn-del"  data-id="${item.id}"><i class="fas fa-trash"></i></button>
        </div>`;
      grid.appendChild(card);
    });

    grid.onclick = (e) => {
      const loadBtn = e.target.closest('.hc-btn-load');
      const dupBtn  = e.target.closest('.hc-btn-dup');
      const pdfBtn  = e.target.closest('.hc-btn-pdf');
      const delBtn  = e.target.closest('.hc-btn-del');

      if (loadBtn) {
        const h = getHistory().find(d => d.id === loadBtn.dataset.id);
        if (h && confirm('Charger ce document ? Le brouillon actuel sera écrasé.')) {
          applyData(h);
          switchView('editor');
          toast('Document chargé', 'success');
        }
      }
      if (dupBtn) {
        const h = getHistory().find(d => d.id === dupBtn.dataset.id);
        if (h) { applyData(h); duplicateDocument(); }
      }
      if (pdfBtn) {
        const h = getHistory().find(d => d.id === pdfBtn.dataset.id);
        if (h) { applyData(h); switchView('editor'); setTimeout(exportPDF, 200); }
      }
      if (delBtn) {
        const h = getHistory();
        const idx = h.findIndex(d => d.id === delBtn.dataset.id);
        if (idx >= 0 && confirm(`Supprimer "${h[idx].docNumber || 'ce document'}" ?`)) {
          const deleted = h[idx];
          h.splice(idx, 1);
          saveHistory(h);
          updateHistoryBadge();
          renderHistory();
          toast('Document supprimé', 'warning');
          deleteDocFromSupabase(deleted.docNumber, deleted.mode);
        }
      }
    };
  }

  function computeTTC(data) {
    if (!data?.items) return 0;
    const sub  = data.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
    const disc = data.discountEnabled ? sub * num(data.discountRate) / 100 : 0;
    const after = sub - disc;
    const tax  = (data.vatEnabled !== false) ? after * num(data.vatRate) / 100 : 0;
    return after + tax;
  }

  /* ============================================================
     RAPPELS EXPIRATION
     ============================================================ */
  function checkExpiringDocs() {
    if (!state.settings?.reminders) return;
    const hist = getHistory();
    const expiring = hist.filter(d => {
      if (!d.docValidity || d.mode === 'facture') return false;
      const days = daysUntil(d.docValidity);
      return days !== null && days >= 0 && days <= 7 && d.docStatus !== 'accepted' && d.docStatus !== 'invoiced';
    });
    if (expiring.length === 0) return;
    const first = expiring[0];
    const days  = daysUntil(first.docValidity);
    const banner = $('#reminderBanner');
    const text   = $('#reminderBannerText');
    if (banner && text) {
      text.textContent = `⚠️ ${expiring.length} devis expire${expiring.length > 1 ? 'nt' : ''} bientôt — "${first.docNumber}" expire dans ${days} jour${days !== 1 ? 's' : ''}`;
      banner.style.display = 'flex';
    }
  }

  /* ============================================================
     EXPORT PDF — PREMIUM
     ============================================================ */
  function exportPDF() {
    const body = $('#itemsBody');
    if (!body || body.rows.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pw = 210, ml = 15, mr = 15, cw = pw - ml - mr;
      const curr = state.settings?.defaultCurrency || 'CFA';
      const mode = MODES[state.mode] || MODES.devis;
      const s = state.settings || {};
      const status = STATUS_LABELS[state.docStatus] || STATUS_LABELS.draft;

      const SF = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
      const SC = (r, g, b) => doc.setTextColor(r, g, b);
      const FC = (r, g, b) => doc.setFillColor(r, g, b);
      const DC = (r, g, b, lw) => { doc.setDrawColor(r, g, b); doc.setLineWidth(lw || 0.3); };

      const BLUE = [26, 58, 107];
      const BLUE_LT = [59, 130, 246];
      const GRAY_DK = [30, 30, 40];
      const GRAY_MD = [100, 110, 130];
      const GRAY_LT = [160, 170, 190];
      const GRAY_BG = [245, 247, 250];
      const WHITE = [255, 255, 255];
      const BLACK = [20, 20, 30];

      let y = 12;

      // === EN-TETE : Logo + coordonnees ===
      let logoW = 0;
      if (state.logoDataURL) {
        try {
          const imgFmt = state.logoDataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(state.logoDataURL, imgFmt, ml, y, 16, 16, undefined, 'FAST');
          logoW = 22;
        } catch (_) {}
      }

      SF('bold', 13);
      SC(...BLUE);
      const cName = s.companyName || $('#emitterName')?.value || 'Votre entreprise';
      doc.text(cName, ml + logoW, y + 6);

      SF('normal', 7.5);
      SC(...GRAY_MD);
      const cSubtitle = s.managerName ? `${s.managerName} ${s.managerFirstname || ''}`.trim() : '';
      if (cSubtitle) doc.text(cSubtitle, ml + logoW, y + 11);

      const rightX = pw - mr;
      const coords = [
        s.phone ? `Tel. ${s.phone}` : '',
        s.email ? s.email : '',
        s.website ? s.website : '',
        [s.address, s.city, s.country].filter(Boolean).join(', ') || ''
      ].filter(Boolean);
      let cy = y;
      coords.forEach(line => {
        if (line) { doc.text(line, rightX, cy, { align: 'right' }); cy += 4; }
      });

      y = Math.max(y + 20, cy + 2) + 10;

      // === TITRE ===
      SF('bold', 26);
      SC(...GRAY_DK);
      doc.text(mode.label, ml, y);

      DC(...BLUE_LT, 1.2);
      doc.line(ml, y + 3, ml + 28, y + 3);

      // Date box a droite
      const dateBoxW = 52;
      const dateBoxX = rightX - dateBoxW;
      FC(...GRAY_BG);
      DC(...GRAY_LT, 0.3);
      doc.roundedRect(dateBoxX, y - 12, dateBoxW, 16, 3, 3, 'FD');
      SF('bold', 6.5);
      SC(...GRAY_MD);
      doc.text('DATE DE CREATION', dateBoxX + 5, y - 6);
      SF('bold', 8);
      SC(...BLUE);
      doc.text(localDate($('#docDate')?.value) || new Date().toLocaleDateString('fr-FR'), dateBoxX + 5, y - 1);
      if (mode.hasValidity && $('#docValidity')?.value) {
        const dl = daysUntil($('#docValidity').value);
        SF('normal', 6.5);
        SC(...GRAY_LT);
        doc.text(`Valide ${dl !== null ? dl + ' jours' : ''}`, dateBoxX + 5, y + 3.5);
      }

      y += 10;

      // Numero + badge statut
      SF('normal', 8.5);
      SC(...GRAY_MD);
      doc.text(`N° ${$('#docNumber')?.value || '—'}`, ml, y);

      const statColors = {
        draft:    [160, 170, 190],
        sent:     [59, 130, 246],
        accepted: [21, 128, 61],
        invoiced: [8, 145, 178],
        refused:  [185, 28, 28],
        expired:  [245, 158, 11]
      };
      const stCol = statColors[state.docStatus] || statColors.draft;
      const statLabel = status.label.toUpperCase();
      const statW = doc.getTextWidth(statLabel) + 10;
      const statX = ml + 38;
      FC(...stCol);
      doc.roundedRect(statX, y - 4, statW, 8, 4, 4, 'F');
      SF('bold', 6.5);
      SC(...WHITE);
      doc.text(statLabel, statX + statW / 2, y + 1.5, { align: 'center' });

      y += 5;
      DC(...GRAY_LT, 0.3);
      doc.line(ml, y, rightX, y);
      y += 8;

      // === CLIENT ===
      SF('bold', 7);
      SC(...BLUE);
      doc.text('CLIENT', ml, y);
      y += 4;

      const cardH = 26;
      FC(...WHITE);
      DC(...GRAY_LT, 0.3);
      doc.roundedRect(ml, y, cw, cardH, 4, 4, 'FD');

      const c1 = ml + 6, c2 = ml + cw * 0.36, c3 = ml + cw * 0.68;
      const cliItems = [
        { l: 'SOCIETE',          v: $('#clientName')?.value || 'Client non renseigne', x: c1,  y: y + 6 },
        { l: 'CONTACT',          v: $('#clientTel')?.value || '',                     x: c2,  y: y + 6 },
        { l: 'EMAIL',            v: $('#clientEmail')?.value || '',                   x: c3,  y: y + 6 },
        { l: 'TELEPHONE',        v: $('#clientTel')?.value || '',                     x: c1,  y: y + 16 },
        { l: 'ADRESSE',          v: [$('#clientAddress')?.value, $('#clientExtra')?.value].filter(Boolean).join(', ') || '', x: c2, y: y + 16 },
      ];
      cliItems.forEach(it => {
        if (!it.v) return;
        SF('normal', 6);
        SC(...GRAY_LT);
        doc.text(it.l, it.x, it.y);
        SF('bold', 7.5);
        SC(...GRAY_DK);
        doc.text(it.v, it.x, it.y + 3.5);
      });
      y += cardH + 10;

      // === PRESTATIONS ===
      SF('bold', 7);
      SC(...BLUE);
      doc.text('PRESTATIONS', ml, y);
      y += 4;

      const tableRows = [];
      for (const tr of body.rows) {
        const q = num(tr.querySelector('[data-field="qty"]')?.value);
        const p = num(tr.querySelector('[data-field="price"]')?.value);
        const des = tr.querySelector('[data-field="designation"]')?.value || '';
        const parts = des.split('\n');
        const main = parts[0] || '';
        const sub = parts[1] || '';
        tableRows.push([
          { content: main + (sub ? '\n' + sub : ''), styles: { fontStyle: sub ? 'normal' : 'bold', textColor: sub ? GRAY_MD : GRAY_DK } },
          { content: String(q), styles: { halign: 'center' } },
          { content: `${fmt(p)} ${curr}`, styles: { halign: 'right' } },
          { content: `${fmt(q * p)} ${curr}`, styles: { halign: 'right', fontStyle: 'bold' } }
        ]);
      }

      doc.autoTable({
        head: [[
          { content: 'DESCRIPTION', styles: { halign: 'left' } },
          { content: 'QTE', styles: { halign: 'center' } },
          { content: 'PRIX UNITAIRE', styles: { halign: 'right' } },
          { content: 'TOTAL HT', styles: { halign: 'right' } }
        ]],
        body: tableRows,
        startY: y,
        margin: { left: ml, right: mr },
        styles: {
          fontSize: 8.5,
          cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
          lineColor: [220, 225, 235],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: [245, 247, 250],
          textColor: GRAY_MD,
          fontStyle: 'bold',
          fontSize: 7,
          cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }
        },
        alternateRowStyles: { fillColor: [252, 253, 255] },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 16 },
          2: { cellWidth: 38 },
          3: { cellWidth: 38 }
        }
      });

      y = doc.lastAutoTable.finalY + 10;

      // === TOTAUX ===
      const subtotal = tableRows.reduce((s, _, i) => {
        const tr = body.rows[i];
        return s + num(tr.querySelector('[data-field="qty"]')?.value) * num(tr.querySelector('[data-field="price"]')?.value);
      }, 0);
      const discOn = $('#discountEnabled')?.checked || false;
      const discRate = discOn ? num($('#discountRate')?.value) : 0;
      const discount = subtotal * discRate / 100;
      const afterDisc = subtotal - discount;
      const vatOn = $('#vatEnabled')?.checked || false;
      const vatRate = vatOn ? num($('#vatRate')?.value) : 0;
      const tax = afterDisc * vatRate / 100;
      const total = afterDisc + tax;

      const totBoxW = 72;
      const totBoxX = rightX - totBoxW;

      // Bloc noir TOTAL TTC
      FC(...BLACK);
      doc.roundedRect(totBoxX, y, totBoxW, 30, 5, 5, 'F');
      SF('normal', 6.5);
      SC(...GRAY_LT);
      doc.text('TOTAL TTC', totBoxX + 8, y + 7);
      SF('bold', 15);
      SC(...WHITE);
      doc.text(`${fmt(total)} ${curr}`, totBoxX + 8, y + 20);

      // Details a gauche
      const dx = ml;
      const dy = y + 5;
      SF('normal', 8);
      SC(...GRAY_MD);
      doc.text('Total HT', dx, dy);
      SF('bold', 8);
      SC(...GRAY_DK);
      doc.text(`${fmt(subtotal)} ${curr}`, dx + 55, dy, { align: 'right' });

      let dyy = dy + 7;
      if (discOn) {
        SF('normal', 8); SC(...GRAY_MD);
        doc.text(`Remise (${discRate}%)`, dx, dyy);
        SF('bold', 8); SC(...GRAY_DK);
        doc.text(`-${fmt(discount)} ${curr}`, dx + 55, dyy, { align: 'right' });
        dyy += 7;
      }
      if (vatOn) {
        SF('normal', 8); SC(...GRAY_MD);
        doc.text(`TVA (${vatRate}%)`, dx, dyy);
        SF('bold', 8); SC(...GRAY_DK);
        doc.text(`${fmt(tax)} ${curr}`, dx + 55, dyy, { align: 'right' });
        dyy += 7;
      }
      SF('bold', 8); SC(...GRAY_DK);
      doc.text('Total TTC', dx, dyy);
      doc.text(`${fmt(total)} ${curr}`, dx + 55, dyy, { align: 'right' });

      y += 36;

      // === SIGNATURE ===
      SF('bold', 7);
      SC(...BLUE);
      doc.text('SIGNATURE', ml, y);
      y += 4;

      const signName = $('#signatoryName')?.value?.trim() || '';
      const signRole = $('#signatoryRole')?.value?.trim() || '';
      if (signName) {
        SF('bold', 9); SC(...GRAY_DK);
        doc.text(signName, ml, y + 5);
        if (signRole) {
          SF('normal', 8); SC(...GRAY_MD);
          doc.text(signRole, ml, y + 10);
        }
        y += 15;
      }
      DC(...GRAY_LT, 0.5);
      doc.line(ml, y, ml + 55, y);
      y += 6;

      const place = $('#placeOfIssue')?.value;
      if (place) {
        SF('normal', 8); SC(...GRAY_MD);
        doc.text(`Fait a ${place}, le ${new Date().toLocaleDateString('fr-FR')}`, ml, y);
      }

      // === FOOTER ===
      const pageH = doc.internal.pageSize.height;
      const footY = pageH - 10;
      DC(...GRAY_LT, 0.3);
      doc.line(ml, footY - 2, rightX, footY - 2);
      SF('normal', 6.5);
      SC(...GRAY_MD);
      const footLines = [
        s.footer || `${s.companyName || ''} - ${[s.address, s.city, s.country].filter(Boolean).join(', ') || ''}`,
        s.ifu ? `IFU : ${s.ifu}` : '',
        s.rccm ? `RCCM : ${s.rccm}` : ''
      ].filter(Boolean);
      let fy = footY + 1;
      footLines.forEach(line => {
        doc.text(line, pw / 2, fy, { align: 'center' });
        fy += 3;
      });

      const filename = `${mode.label}_${$('#docNumber')?.value || 'sans-numero'}.pdf`;
      doc.save(filename);
      toast('PDF genere ✓', 'success');

    } catch (err) {
      console.error('Erreur PDF :', err);
      toast('Erreur lors de la generation du PDF', 'error');
    }
  }

  /* ============================================================
     DASHBOARD
     ============================================================ */
  function dashboardEmpty(message) {
    return `<div class="dashboard-empty"><i class="fas fa-sparkles"></i><span>${message}</span></div>`;
  }

  function renderDashboard() {
    const hist = getHistory();
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const greeting = $('#dashboardGreetingName');
    const s_gr = state.settings || {};
    const greetName = [s_gr.managerName, s_gr.managerFirstname].filter(Boolean).join(' ').trim()
      || state.currentUser?.email?.split('@')[0] || 'Utilisateur';
    if (greeting) greeting.textContent = greetName;
    const label = $('#dashboardTodayLabel');
    if (label) label.textContent = `Aujourd'hui, ${today}, gardez une lecture immédiate de votre activité.`;

    const devis = hist.filter(d => d.mode === 'devis').length;
    const factures = hist.filter(d => d.mode === 'facture').length;
    const revenue = hist.reduce((sum, d) => sum + computeTTC(d), 0);
    const curr = state.settings?.defaultCurrency || 'CFA';
    
    if ($('#kpiTotalDocs')) $('#kpiTotalDocs').textContent = String(hist.length);
    if ($('#kpiDevis')) $('#kpiDevis').textContent = String(devis);
    if ($('#kpiFactures')) $('#kpiFactures').textContent = String(factures);
    if ($('#kpiRevenue')) $('#kpiRevenue').textContent = `${fmt(revenue)} ${curr}`;

    // Graphique CA
    const monthMap = new Map();
    hist.forEach(doc => {
      const key = (doc.docDate || todayISO()).slice(0, 7);
      monthMap.set(key, (monthMap.get(key) || 0) + computeTTC(doc));
    });
    const revenueEntries = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    const maxRevenue = Math.max(1, ...revenueEntries.map(([, value]) => value));
    const revenueChart = $('#revenueChart');
    if (revenueChart) {
      revenueChart.innerHTML = revenueEntries.length
        ? revenueEntries.map(([month, value]) => `<div class="chart-bar-col"><span class="chart-bar-label">${month.slice(5)}</span><div class="chart-bar-track"><div class="chart-bar-fill" style="height:${Math.max(8, (value / maxRevenue) * 100)}%"></div></div><strong>${fmt(value)}</strong></div>`).join('')
        : dashboardEmpty('Aucun chiffre à représenter.');
    }

    // Donut
    const totalDocs = Math.max(1, devis + factures + hist.filter(d => d.mode === 'proforma').length);
    const proformas = hist.filter(d => d.mode === 'proforma').length;
    const donut = $('#docsDonut');
    const legend = $('#docsLegend');
    if (donut) donut.style.background = `conic-gradient(var(--primary) 0 ${(devis / totalDocs) * 360}deg, var(--secondary) ${(devis / totalDocs) * 360}deg ${((devis + factures) / totalDocs) * 360}deg, rgba(15,23,42,.15) ${((devis + factures) / totalDocs) * 360}deg 360deg)`;
    if (legend) legend.innerHTML = [
      ['Devis', devis],
      ['Factures', factures],
      ['Pro Forma', proformas]
    ].map(([label, value]) => `<div class="legend-item"><span>${label}</span><strong>${value}</strong></div>`).join('');

    // Documents récents
    const recent = hist.slice(0, 5);
    const recentWrap = $('#dashboardRecentDocs');
    if (recentWrap) recentWrap.innerHTML = recent.length ? recent.map(doc => `<button class="dashboard-list-item" data-doc="${escHtml(doc.docNumber || '')}"><span><strong>${escHtml(doc.docNumber || 'Sans numéro')}</strong><small>${escHtml(doc.client?.name || 'Client non renseigné')}</small></span><strong>${fmt(computeTTC(doc))} ${doc.currency || curr}</strong></button>`).join('') : dashboardEmpty('Aucun document sauvegardé.');

    // Top clients
    const topClients = Object.values(hist.reduce((acc, doc) => {
      const name = doc.client?.name || 'Client non renseigné';
      acc[name] = acc[name] || { name, amount: 0, count: 0 };
      acc[name].amount += computeTTC(doc);
      acc[name].count += 1;
      return acc;
    }, {})).sort((a, b) => b.amount - a.amount).slice(0, 5);
    const topClientsWrap = $('#dashboardTopClients');
    if (topClientsWrap) topClientsWrap.innerHTML = topClients.length ? topClients.map(client => `<div class="dashboard-list-item static"><span><strong>${escHtml(client.name)}</strong><small>${client.count} document(s)</small></span><strong>${fmt(client.amount)} ${curr}</strong></div>`).join('') : dashboardEmpty('Ajoutez vos premiers clients.');

    // Documents en attente
    const pending = hist.filter(doc => ['draft', 'sent', 'expired'].includes(doc.docStatus)).slice(0, 5);
    const pendingWrap = $('#dashboardPendingDocs');
    if (pendingWrap) pendingWrap.innerHTML = pending.length ? pending.map(doc => `<div class="dashboard-list-item static"><span><strong>${escHtml(doc.docNumber || 'Sans numéro')}</strong><small>${STATUS_LABELS[doc.docStatus]?.label || 'Brouillon'} · ${escHtml(doc.client?.name || 'Client')}</small></span><strong>${fmt(computeTTC(doc))} ${doc.currency || curr}</strong></div>`).join('') : dashboardEmpty('Aucun document en attente.');
  }

  /* ============================================================
     ÉVÉNEMENTS PRINCIPAUX
     ============================================================ */
  function bindEvents() {
    // Status select
    $('#docStatus')?.addEventListener('change', (e) => {
      state.docStatus = e.target.value;
      e.target.dataset.val = e.target.value;
      scheduleSave();
    });

    // Undo / Redo buttons
    $('#btnUndo')?.addEventListener('click', undo);
    $('#btnRedo')?.addEventListener('click', redo);

    // Topbar actions
    $('#btnArchive')?.addEventListener('click', archiveDocument);
    $('#btnPdf')?.addEventListener('click', exportPDF);

    // Add row
    $('#addRow')?.addEventListener('click', () => addRow({}, true));

    // Remove row (delegation)
    $('#itemsBody')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="remove-row"]');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const body = $('#itemsBody');
      if (body.children.length > 1) { tr.remove(); }
      else {
        tr.querySelector('[data-field="designation"]').value = '';
        tr.querySelector('[data-field="qty"]').value   = '1';
        tr.querySelector('[data-field="price"]').value = '0';
      }
      recalculate(); scheduleSave(); snapshotState();
    });

    // Input changes on items
    $('#itemsBody')?.addEventListener('input', e => {
      const field = e.target.dataset?.field;
      if (field === 'qty' || field === 'price') {
        const v = parseFloat(e.target.value);
        if (v < 0 || !Number.isFinite(v)) e.target.value = 0;
      }
      recalculate(); scheduleSave();
    });

    // Checkboxes TVA / Remise
    $('#vatEnabled')?.addEventListener('change',      () => { recalculate(); scheduleSave(); });
    $('#discountEnabled')?.addEventListener('change', () => { recalculate(); scheduleSave(); });
    $('#vatRate')?.addEventListener('input',          () => { recalculate(); scheduleSave(); });
    $('#discountRate')?.addEventListener('input',     () => { recalculate(); scheduleSave(); });

    // All inputs → autosave
    const allInputs = [
      '#emitterName','#emitterAddress','#emitterExtra','#emitterTel','#emitterEmail',
      '#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail',
      '#docNumber','#docDate','#docValidity','#placeOfIssue','#docNotes','#signatoryName'
    ];
    allInputs.forEach(id => $(id)?.addEventListener('input', scheduleSave));
    $('#signatoryRole')?.addEventListener('change', scheduleSave);

    // Logo
    $('#logoPlaceholder')?.addEventListener('click', () => $('#logoUpload')?.click());
    $('#logoUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.logoDataURL = ev.target.result;
        const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
        if (lp)  { lp.src = ev.target.result; lp.style.display = 'block'; }
        if (lph) lph.style.display = 'none';
        scheduleSave();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // Signature image
    const sigZone = $('#sigUploadZone');
    sigZone?.addEventListener('click', () => { if (!$('#sigImgPreview').src || $('#sigImgPreview').style.display === 'none') $('#sigImgUpload')?.click(); });
    $('#sigImgUpload')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        state.sigImgDataURL = ev.target.result;
        const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
        if (sp) { sp.src = ev.target.result; sp.style.display = 'block'; }
        if (sph) sph.style.display = 'none';
        if (scb) scb.style.display = 'flex';
        scheduleSave();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('#btnClearSig')?.addEventListener('click', () => {
      state.sigImgDataURL = null;
      const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
      if (sp) { sp.src = ''; sp.style.display = 'none'; }
      if (sph) sph.style.display = 'flex';
      if (scb) scb.style.display = 'none';
      scheduleSave();
    });

    // Date courante
    const cd = $('#currentDate');
    if (cd) cd.textContent = new Date().toLocaleDateString('fr-FR');

    // History filters
    $('#historySearch')?.addEventListener('input', renderHistory);
    $('#filterType')?.addEventListener('change',   renderHistory);
    $('#filterStatus')?.addEventListener('change', renderHistory);

    // Clients
    $('#clientsSearch')?.addEventListener('input', renderClientsView);
    $('#btnSaveClient')?.addEventListener('click', saveCurrentClient);
    $('#btnPickClient')?.addEventListener('click', openClientPicker);
    $('#btnAddClientManual')?.addEventListener('click', () => {
      switchView('editor');
      ['#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
      $('#clientName')?.focus();
    });

    // Client picker modal
    $('#btnCloseClientPicker')?.addEventListener('click', () => $('#clientPickerModal')?.classList.remove('open'));
    $('#clientPickerModal')?.addEventListener('click', e => { if (e.target === $('#clientPickerModal')) $('#clientPickerModal').classList.remove('open'); });
    $('#clientPickerSearch')?.addEventListener('input', e => renderClientPickerList(e.target.value));

    // Reminder banner close
    $('#reminderClose')?.addEventListener('click', () => { const b = $('#reminderBanner'); if (b) b.style.display = 'none'; });

    // Client name smart autocomplete
    const clientNameInput = $('#clientName');
    const clientDropdown  = $('#clientDropdown');
    if (clientNameInput && clientDropdown) {
      clientNameInput.addEventListener('input', () => {
        const q = clientNameInput.value.toLowerCase();
        if (!q) { clientDropdown.classList.remove('open'); return; }
        const matches = getClients().filter(c => c.name.toLowerCase().includes(q)).slice(0, 5);
        if (matches.length === 0) { clientDropdown.classList.remove('open'); return; }
        clientDropdown.innerHTML = matches.map(c => `
          <div class="client-dropdown-item" data-id="${c.id}">
            <strong>${escHtml(c.name)}</strong>
            <span>${escHtml([c.tel, c.address].filter(Boolean).join(' · '))}</span>
          </div>`).join('');
        clientDropdown.classList.add('open');
        clientDropdown.querySelectorAll('.client-dropdown-item').forEach(item => {
          item.addEventListener('click', () => {
            const c = getClients().find(x => x.id === item.dataset.id);
            if (c) fillClientFields(c);
            clientDropdown.classList.remove('open');
          });
        });
      });
      document.addEventListener('click', e => {
        if (!e.target.closest('.client-suggest-wrap')) clientDropdown.classList.remove('open');
      });
    }

    // Article autocompletion — dropdown temps réel
    const articleDropdown = document.createElement('div');
    articleDropdown.className = 'article-dropdown';
    articleDropdown.id = 'articleDropdown';
    document.body.appendChild(articleDropdown);

    function showArticleDropdown(input, query) {
      if (!query || query.length < 2) { articleDropdown.classList.remove('open'); return; }
      const matches = getArticleSuggestions(query);
      if (matches.length === 0) { articleDropdown.classList.remove('open'); return; }
      const rect = input.getBoundingClientRect();
      articleDropdown.style.left = rect.left + 'px';
      articleDropdown.style.top = (rect.bottom + 4) + 'px';
      articleDropdown.style.width = rect.width + 'px';
      const curr = state.settings?.defaultCurrency || 'CFA';
      articleDropdown.innerHTML = matches.map(a => `
        <div class="article-dropdown-item" data-designation="${escHtml(a.designation)}" data-qty="${a.qty}" data-price="${a.price}">
          <strong>${escHtml(a.designation)}</strong>
          <span>${fmt(a.qty)} × ${fmt(a.price)} ${curr}</span>
        </div>`).join('');
      articleDropdown.classList.add('open');
      articleDropdown.querySelectorAll('.article-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const row = input.closest('tr');
          if (row) {
            input.value = item.dataset.designation;
            const qtyInput = row.querySelector('[data-field="qty"]');
            const priceInput = row.querySelector('[data-field="price"]');
            if (qtyInput) qtyInput.value = item.dataset.qty || 1;
            if (priceInput) priceInput.value = item.dataset.price || 0;
            recalculate(); scheduleSave();
          }
          articleDropdown.classList.remove('open');
        });
      });
    }

    $('#itemsBody')?.addEventListener('input', e => {
      if (e.target.dataset?.field === 'designation') {
        showArticleDropdown(e.target, e.target.value.trim());
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#articleDropdown') && !e.target.closest('[data-field="designation"]')) {
        articleDropdown.classList.remove('open');
      }
    });

    // Article memory — sauvegarde quand on quitte le champ
    $('#itemsBody')?.addEventListener('focusout', function(e) {
      const input = e.target.closest('[data-field="designation"]');
      if (!input) return;
      const designation = input.value.trim();
      if (!designation) return;
      const row = input.closest('tr');
      if (!row) return;
      const qty = num(row.querySelector('[data-field="qty"]')?.value, 0);
      const price = num(row.querySelector('[data-field="price"]')?.value, 0);
      addArticle(designation, qty, price);
      articleDropdown.classList.remove('open');
    }, true);

    // Currency change
    $('#currency')?.addEventListener('change', () => { recalculate(); scheduleSave(); });

    // Dashboard actions
    $('#dashboardCreateDoc')?.addEventListener('click', () => switchView('editor'));

    // Click events: recent docs
    document.addEventListener('click', e => {
      const recentDoc = e.target.closest('[data-doc]');
      if (recentDoc) {
        const doc = getHistory().find(row => row.docNumber === recentDoc.dataset.doc);
        if (doc) { applyData(doc); switchView('editor'); }
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); archiveDocument(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (e.key === 'Escape') {
        $('#clientPickerModal')?.classList.remove('open');
      }
    });
  }

  /* ============================================================
     SUPABASE — SYNC
     ============================================================ */
  async function syncDocumentToSupabase(data, isNew) {
    try {
      const payload = { 
        user_id: state.currentUser.id, 
        mode: data.mode, 
        doc_number: data.docNumber, 
        doc_date: data.docDate || null, 
        doc_status: data.docStatus || 'draft', 
        client_name: data.client?.name || '', 
        total_ttc: computeTTC(data), 
        data 
      };
      if (isNew) {
        const { error } = await supabase.from('documents').insert(payload);
        if (!error) { state.docCount++; updateCounterBadge(); }
      } else {
        await supabase.from('documents').update({ ...payload, updated_at: new Date().toISOString() })
          .eq('user_id', state.currentUser.id)
          .eq('doc_number', data.docNumber)
          .eq('mode', data.mode);
      }
    } catch (e) { console.error('Sync Supabase:', e); }
  }

  async function loadDocCountFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { count } = await supabase.from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', state.currentUser.id);
      state.docCount = count || 0;
      updateCounterBadge();
    } catch (e) { console.error('Count:', e); }
  }

  async function loadHistoryFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { data: rows, error } = await supabase.from('documents')
        .select('data, created_at, updated_at')
        .eq('user_id', state.currentUser.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error || !rows?.length) return;
      const remoteHist = rows.map(r => ({ ...r.data, savedAt: r.updated_at || r.created_at }));
      saveHistory(remoteHist);
      updateHistoryBadge();
    } catch (e) { console.error('History load:', e); }
  }

  async function deleteDocFromSupabase(docNumber, mode) {
    if (!state.currentUser) return;
    try {
      await supabase.from('documents').delete()
        .eq('user_id', state.currentUser.id)
        .eq('doc_number', docNumber)
        .eq('mode', mode);
      state.docCount = Math.max(0, state.docCount - 1);
      updateCounterBadge();
    } catch (e) { console.error('Delete:', e); }
  }

  function updateCounterBadge() {
    const pct = Math.min(100, (state.docCount / DOC_LIMIT) * 100);
    const bar  = $('#sdcBar');
    const lbl  = $('#sdcLabel');
    if (bar) { 
      bar.style.width = `${pct}%`; 
      bar.style.background = pct >= 100 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--success)'; 
    }
    if (lbl) lbl.textContent = `${state.docCount} / ${DOC_LIMIT} documents`;
  }

  /* ============================================================
     AUTHENTIFICATION
     ============================================================ */
  function bindAuthEvents() {
    $('#tabLogin')?.addEventListener('click', () => {
      $('#tabLogin').classList.add('active');
      $('#tabRegister').classList.remove('active');
      $('#formLogin').style.display    = '';
      $('#formRegister').style.display = 'none';
      clearAuthError('loginError');
    });

    $('#tabRegister')?.addEventListener('click', () => {
      $('#tabRegister').classList.add('active');
      $('#tabLogin').classList.remove('active');
      $('#formRegister').style.display = '';
      $('#formLogin').style.display    = 'none';
      clearAuthError('registerError');
    });

    $$('.toggle-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = $('#' + btn.dataset.target);
        if (!inp) return;
        const isHidden = inp.type === 'password';
        inp.type = isHidden ? 'text' : 'password';
        btn.querySelector('i').className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
      });
    });

    $('#formLogin')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError('loginError');
      const email    = $('#loginEmail')?.value?.trim();
      const password = $('#loginPassword')?.value;
      if (!email || !password) { showAuthError('loginError', 'Veuillez remplir tous les champs.'); return; }
      setAuthLoading('btnLogin', true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setAuthLoading('btnLogin', false);
      if (error) {
        const msgs = { 
          'Invalid login credentials': 'Email ou mot de passe incorrect.', 
          'Email not confirmed': 'Veuillez confirmer votre email.', 
          'Too many requests': 'Trop de tentatives. Réessayez plus tard.' 
        };
        showAuthError('loginError', msgs[error.message] || error.message);
      }
    });

    $('#formRegister')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError('registerError');
      const email   = $('#regEmail')?.value?.trim();
      const pass    = $('#regPassword')?.value;
      const confirm = $('#regConfirm')?.value;
      if (!email || !pass || !confirm) { showAuthError('registerError', 'Veuillez remplir tous les champs.'); return; }
      if (pass.length < 8) { showAuthError('registerError', 'Le mot de passe doit contenir au moins 8 caractères.'); return; }
      if (pass !== confirm) { showAuthError('registerError', 'Les mots de passe ne correspondent pas.'); return; }
      setAuthLoading('btnRegister', true);
      const { data: signData, error } = await supabase.auth.signUp({ email, password: pass });
      setAuthLoading('btnRegister', false);
      if (error) { showAuthError('registerError', error.message); return; }
      if (signData?.session) { /* onAuthStateChange handles it */ }
      else { toast('Compte créé ! Vérifiez votre email.', 'success', 5000); $('#tabLogin')?.click(); }
    });

    $('#btnLogout')?.addEventListener('click', async () => {
      if (!confirm('Se déconnecter ?')) return;
      await supabase.auth.signOut();
    });

    $('#btnLimitClose')?.addEventListener('click', () => { $('#limitOverlay').style.display = 'none'; });
  }

  function setAuthLoading(btnId, loading) {
    const btn = $('#' + btnId); if (!btn) return;
    btn.disabled = loading;
    const txt = btn.querySelector('.btn-text'), ico = btn.querySelector('.btn-loader');
    if (txt) txt.style.display = loading ? 'none' : '';
    if (ico) ico.style.display = loading ? '' : 'none';
  }

  function showAuthError(elId, msg) {
    const el = $('#' + elId); if (!el) return;
    el.textContent = msg; el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  }

  function clearAuthError(elId) {
    const el = $('#' + elId); if (el) { el.textContent = ''; el.classList.remove('visible'); }
  }

  function showLimitModal() { $('#limitOverlay').style.display = 'flex'; }

  /* ============================================================
     AUTH STATE
     ============================================================ */
  function onAuthStateChange(session) {
    if (session?.user) {
      state.currentUser = session.user;
      showApp();
    } else {
      state.currentUser = null;
      state.docCount = 0;
      showAuthModal();
    }
  }

  function showAuthModal() {
    const o = $('#authOverlay'); if (o) o.style.display = 'flex';
    const su = $('#sidebarUser'), bl = $('#btnLogout'), sdc = $('#sidebarDocCounter');
    if (su) su.style.display = 'none';
    if (bl) bl.style.display = 'none';
    if (sdc) sdc.style.display = 'none';
  }

  function showApp() {
    const o = $('#authOverlay'); if (o) o.style.display = 'none';

    const su = $('#sidebarUser'); if (su) su.style.display = 'flex';
    const bl = $('#btnLogout');   if (bl) bl.style.display = 'flex';
    const sdc = $('#sidebarDocCounter'); if (sdc) sdc.style.display = 'block';
    const email = state.currentUser?.email || '';
    const sueEl = $('#sidebarUserEmail'); if (sueEl) sueEl.textContent = email;
    const suaEl = $('#sidebarUserAvatar'); if (suaEl) suaEl.textContent = email.charAt(0).toUpperCase();

    loadDocCountFromSupabase();
    loadHistoryFromSupabase();

    // Charger les paramètres
    state.settings = loadSettings();
    
    applySettingsToEditor();
    loadDraft();
    recalculate();
    ensureOneRow();
    populateClientDatalist();
    populateItemDatalist();
    updateHistoryBadge();
    checkExpiringDocs();
    snapshotState();
    renderDashboard();
    populateSettingsPanel();
    updateWorkspaceHeader(state.currentView);
  }

  /* ============================================================
     INITIALISATION
     ============================================================ */
  async function init() {
    // Charger les paramètres
    state.settings = loadSettings();
    
    const authOverlay = $('#authOverlay');
    if (authOverlay) authOverlay.style.display = 'flex';

    const dn = $('#docNumber');
    if (dn && !dn.value) dn.placeholder = peekNextNumber('devis');

    const docDate = $('#docDate');
    if (docDate && !docDate.value) docDate.value = todayISO();

    const cd = $('#currentDate');
    if (cd) cd.textContent = new Date().toLocaleDateString('fr-FR');

    bindSidebarEvents();
    bindEvents();
    bindAuthEvents();
    bindSettingsEvents();

    try {
      supabase.auth.onAuthStateChange((_event, session) => onAuthStateChange(session));
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      onAuthStateChange(data?.session ?? null);
    } catch (err) {
      console.error('Auth init:', err);
      // Mode offline — initialiser l'app quand même
      if (authOverlay) authOverlay.style.display = 'none';
      showApp();
      toast('Mode hors-ligne — vos données restent sur cet appareil.', 'info', 4000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();