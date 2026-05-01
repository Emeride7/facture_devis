/**
 * ProGestion v2.0 — Script principal
 * Nouveautés MVP :
 *  - Sidebar collapsible + navigation par vues
 *  - Statuts de documents (Brouillon, Envoyé, Accepté, Facturé…)
 *  - Carnet clients réutilisable (localStorage)
 *  - Duplication de document
 *  - Templates prédéfinis
 *  - QR Code paiement Mobile Money
 *  - Signature image upload
 *  - Undo / Redo (stack 25 états)
 *  - Autosave indicator (dot + texte)
 *  - Breadcrumb dynamique
 *  - Rappels expiration devis
 *  - Partage WhatsApp
 *  - Paramètres branding (couleurs, police)
 *  - Mobile Bottom Nav
 *  - Mon profil entreprise (logo + coordonnées)
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
    draft:    'pg_draft.v6',
    counters: 'pg_counters.v6',
    clients:  'pg_clients.v6',
    settings: 'pg_settings.v6',
    profile:  'pg_company_profile.v6'
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

  const TEMPLATES = [
    {
      id: 'service',
      name: 'Prestation de service',
      icon: 'fas fa-briefcase',
      desc: 'Consulting, conseil, mission',
      notes: 'Paiement sous 30 jours à compter de la réception de la facture.\nTout retard entraîne des pénalités de 1,5% par mois.',
      items: [
        { designation: 'Prestation de conseil et accompagnement', qty: 1, price: 0 },
        { designation: 'Frais de déplacement (forfait)', qty: 1, price: 0 }
      ]
    },
    {
      id: 'produit',
      name: 'Vente de produits',
      icon: 'fas fa-box',
      desc: 'Marchandises, équipements',
      notes: 'Livraison sous 5 à 7 jours ouvrés après réception du paiement.\nRetours acceptés dans les 14 jours.',
      items: [
        { designation: 'Produit ref. —', qty: 1, price: 0 },
        { designation: 'Frais de livraison', qty: 1, price: 0 }
      ]
    },
    {
      id: 'abonnement',
      name: 'Abonnement mensuel',
      icon: 'fas fa-sync-alt',
      desc: 'Maintenance, SaaS, abonnement',
      notes: 'Abonnement mensuel renouvelable tacitement. Résiliation avec préavis de 30 jours.',
      items: [
        { designation: 'Abonnement mensuel — Plan Standard', qty: 1, price: 0 },
        { designation: 'Support technique prioritaire', qty: 1, price: 0 }
      ]
    },
    {
      id: 'transport',
      name: 'Transport / Livraison',
      icon: 'fas fa-truck',
      desc: 'Fret, logistique, coursier',
      notes: 'Prix incluant le carburant et les frais de manutention. Assurance marchandises non incluse.',
      items: [
        { designation: 'Transport de marchandises — Trajet aller', qty: 1, price: 0 },
        { designation: 'Frais de manutention', qty: 1, price: 0 }
      ]
    },
    {
      id: 'btp',
      name: 'BTP / Travaux',
      icon: 'fas fa-hard-hat',
      desc: 'Construction, rénovation, artisan',
      notes: 'Devis valable 30 jours. Travaux débutant après versement d\'un acompte de 30%.\nGarantie décennale applicable.',
      items: [
        { designation: 'Main d\'œuvre — Forfait journalier', qty: 1, price: 0 },
        { designation: 'Fournitures et matériaux', qty: 1, price: 0 },
        { designation: 'Location de matériel', qty: 1, price: 0 }
      ]
    },
    {
      id: 'formation',
      name: 'Formation',
      icon: 'fas fa-chalkboard-teacher',
      desc: 'Cours, ateliers, séminaires',
      notes: 'Formation dispensée en présentiel ou en ligne selon accord. Certificat de participation fourni.',
      items: [
        { designation: 'Formation — Module 1 (demi-journée)', qty: 1, price: 0 },
        { designation: 'Support de formation (PDF)', qty: 1, price: 0 }
      ]
    },
    {
      id: 'evenement',
      name: 'Événementiel',
      icon: 'fas fa-calendar-check',
      desc: 'Organisation d\'événements',
      notes: 'Devis non contractuel avant signature du bon de commande.\nAcompte de 50% requis à la réservation.',
      items: [
        { designation: 'Organisation et coordination', qty: 1, price: 0 },
        { designation: 'Location salle / espace', qty: 1, price: 0 },
        { designation: 'Traiteur / Restauration', qty: 1, price: 0 }
      ]
    },
    {
      id: 'vierge',
      name: 'Document vierge',
      icon: 'fas fa-file',
      desc: 'Commencer de zéro',
      notes: '',
      items: [{ designation: '', qty: 1, price: 0 }]
    }
  ];

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
    companyProfileLogo: null
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
     PARAMÈTRES / SETTINGS
     ============================================================ */
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)) || defaultSettings(); }
    catch { return defaultSettings(); }
  }

  function defaultSettings() {
    return { primaryColor: '#1e3c72', secondaryColor: '#2a5298', font: 'Inter', footer: '', reminders: true };
  }

  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
  }

  function applySettingsToDOM(s) {
    document.documentElement.style.setProperty('--primary',   s.primaryColor   || '#1e3c72');
    document.documentElement.style.setProperty('--secondary', s.secondaryColor || '#2a5298');
    document.body.style.fontFamily = `'${s.font || 'Inter'}', sans-serif`;
  }

  function populateSettingsPanel() {
    const s = state.settings;
    const pc = $('#settingPrimaryColor');
    const sc = $('#settingSecondaryColor');
    const fn = $('#settingFont');
    const ft = $('#settingFooter');
    const rm = $('#settingReminders');
    if (pc) { pc.value = s.primaryColor;   $('#settingPrimaryColorHex').textContent   = s.primaryColor; }
    if (sc) { sc.value = s.secondaryColor; $('#settingSecondaryColorHex').textContent = s.secondaryColor; }
    if (fn) fn.value = s.font || 'Inter';
    if (ft) ft.value = s.footer || '';
    if (rm) rm.checked = s.reminders !== false;
  }

  function bindSettingsEvents() {
    const pc = $('#settingPrimaryColor');
    const sc = $('#settingSecondaryColor');
    if (pc) pc.addEventListener('input', () => { $('#settingPrimaryColorHex').textContent = pc.value; });
    if (sc) sc.addEventListener('input', () => { $('#settingSecondaryColorHex').textContent = sc.value; });

    $('#btnSettingsSave')?.addEventListener('click', () => {
      state.settings = {
        primaryColor:   $('#settingPrimaryColor')?.value   || '#1e3c72',
        secondaryColor: $('#settingSecondaryColor')?.value || '#2a5298',
        font:           $('#settingFont')?.value           || 'Inter',
        footer:         $('#settingFooter')?.value         || '',
        reminders:      $('#settingReminders')?.checked    !== false
      };
      saveSettings(state.settings);
      applySettingsToDOM(state.settings);
      toast('Paramètres enregistrés', 'success');
    });
  }

  /* ============================================================
     COMPANY PROFILE (MON PROFIL)
     ============================================================ */
  function getCompanyProfile() {
    try {
      const defaultProfile = {
        companyName: '',
        address: '',
        addressExtra: '',
        cityCountry: '',
        phone: '',
        email: '',
        taxId: '',
        website: '',
        logoDataURL: null
      };
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.profile)) || defaultProfile;
    } catch { 
      return defaultSettings(); 
    }
  }

  function saveCompanyProfile(profile) {
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
    if (state.currentUser) {
      syncProfileToSupabase(profile);
    }
  }

  function fillEmitterFromProfile() {
    const profile = getCompanyProfile();
    
    const emitterName = $('#emitterName');
    const emitterAddress = $('#emitterAddress');
    const emitterExtra = $('#emitterExtra');
    const emitterTel = $('#emitterTel');
    const emitterEmail = $('#emitterEmail');
    
    if (emitterName && !emitterName.value) emitterName.value = profile.companyName || '';
    if (emitterAddress && !emitterAddress.value) emitterAddress.value = profile.address || '';
    if (emitterExtra && !emitterExtra.value) {
      let extra = profile.addressExtra || '';
      if (profile.cityCountry) {
        extra += extra ? ' · ' + profile.cityCountry : profile.cityCountry;
      }
      emitterExtra.value = extra;
    }
    if (emitterTel && !emitterTel.value) emitterTel.value = profile.phone || '';
    if (emitterEmail && !emitterEmail.value) emitterEmail.value = profile.email || '';
    
    if (profile.logoDataURL && !state.logoDataURL) {
      state.logoDataURL = profile.logoDataURL;
      const lp = $('#logoPreview'), lph = $('#logoPlaceholder');
      if (lp) { lp.src = profile.logoDataURL; lp.style.display = 'block'; }
      if (lph) lph.style.display = 'none';
    }
  }

  function populateCompanyProfileForm() {
    const profile = getCompanyProfile();
    
    const setVal = (id, val) => {
      const el = $('#' + id);
      if (el) el.value = val || '';
    };
    
    setVal('profileCompanyName', profile.companyName);
    setVal('profileAddress', profile.address);
    setVal('profileAddressExtra', profile.addressExtra);
    setVal('profileCityCountry', profile.cityCountry);
    setVal('profilePhone', profile.phone);
    setVal('profileEmail', profile.email);
    setVal('profileTaxId', profile.taxId);
    setVal('profileWebsite', profile.website);
    
    const profileImg = $('#profileLogoImg');
    const profilePlaceholder = $('#profileLogoPlaceholder');
    const removeBtn = $('#btnRemoveLogo');
    
    if (profile.logoDataURL && profileImg && profilePlaceholder) {
      profileImg.src = profile.logoDataURL;
      profileImg.style.display = 'block';
      profilePlaceholder.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'flex';
    } else if (profileImg && profilePlaceholder) {
      profileImg.style.display = 'none';
      profilePlaceholder.style.display = 'flex';
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }

  function saveProfileFromForm() {
    const newProfile = {
      companyName:   $('#profileCompanyName')?.value || '',
      address:       $('#profileAddress')?.value || '',
      addressExtra:  $('#profileAddressExtra')?.value || '',
      cityCountry:   $('#profileCityCountry')?.value || '',
      phone:         $('#profilePhone')?.value || '',
      email:         $('#profileEmail')?.value || '',
      taxId:         $('#profileTaxId')?.value || '',
      website:       $('#profileWebsite')?.value || '',
      logoDataURL:   state.companyProfileLogo || getCompanyProfile().logoDataURL
    };
    
    saveCompanyProfile(newProfile);
    toast('Profil entreprise enregistré !', 'success');
    
    const currentEmitterName = $('#emitterName')?.value;
    if (!currentEmitterName || currentEmitterName === '') {
      fillEmitterFromProfile();
      scheduleSave();
    }
  }

  async function syncProfileToSupabase(profile) {
    if (!state.currentUser) return;
    try {
      await supabase.from('user_profiles').upsert({
        user_id: state.currentUser.id,
        company_profile: profile,
        updated_at: new Date().toISOString()
      });
    } catch (e) { console.error('Profile sync error:', e); }
  }

  async function loadProfileFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('company_profile')
        .eq('user_id', state.currentUser.id)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      if (data?.company_profile) {
        saveCompanyProfile(data.company_profile);
      }
    } catch (e) { console.error('Profile load error:', e); }
  }

  function initCompanyProfileEvents() {
    $('#navCompanyProfile')?.addEventListener('click', () => {
      switchView('companyProfile');
      populateCompanyProfileForm();
    });
    
    $('#btnSaveCompanyProfile')?.addEventListener('click', saveProfileFromForm);
    
    const logoPreviewDiv = $('#profileLogoPreview');
    const logoUpload = $('#profileLogoUpload');
    
    logoPreviewDiv?.addEventListener('click', () => {
      logoUpload?.click();
    });
    
    logoUpload?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.companyProfileLogo = ev.target.result;
        const profileImg = $('#profileLogoImg');
        const placeholder = $('#profileLogoPlaceholder');
        const removeBtn = $('#btnRemoveLogo');
        if (profileImg) {
          profileImg.src = ev.target.result;
          profileImg.style.display = 'block';
        }
        if (placeholder) placeholder.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'flex';
        
        const profile = getCompanyProfile();
        profile.logoDataURL = ev.target.result;
        saveCompanyProfile(profile);
        toast('Logo mis à jour', 'success');
      };
      reader.readAsDataURL(file);
    });
    
    $('#btnRemoveLogo')?.addEventListener('click', () => {
      if (confirm('Supprimer le logo de votre profil ?')) {
        state.companyProfileLogo = null;
        const profile = getCompanyProfile();
        profile.logoDataURL = null;
        saveCompanyProfile(profile);
        
        const profileImg = $('#profileLogoImg');
        const placeholder = $('#profileLogoPlaceholder');
        const removeBtn = $('#btnRemoveLogo');
        if (profileImg) profileImg.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        if (removeBtn) removeBtn.style.display = 'none';
        
        toast('Logo supprimé', 'info');
      }
    });
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
      grid.innerHTML = `<div class="history-empty" style="grid-column:1/-1">
        <i class="fas fa-address-book"></i>
        ${q ? 'Aucun client trouvé' : 'Aucun client enregistré. Enregistrez un client depuis le formulaire.'}
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
          <div class="cc-stat"><div class="cc-stat-label">CA total</div><div class="cc-stat-value">${fmt(ca)} CFA</div></div>
        </div>
        <div class="cc-actions">
          <button class="cc-btn cc-btn-new" data-id="${c.id}"><i class="fas fa-plus"></i> Nouveau doc</button>
          <button class="cc-btn cc-btn-del" data-id="${c.id}"><i class="fas fa-trash"></i></button>
        </div>`;
      grid.appendChild(card);
    });

    grid.addEventListener('click', e => {
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
    }, { once: true });
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

    $('#navTemplate')?.addEventListener('click', openTemplateModal);
    $('#navNew')?.addEventListener('click', () => {
      if (confirm('Créer un nouveau document ? Le brouillon actuel sera conservé dans l\'historique si déjà sauvegardé.')) {
        resetToNew(false);
        switchView('editor');
        toast('Nouveau document créé', 'success');
      }
    });

    $$('.mbn-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    $('#mbnPdf')?.addEventListener('click', exportPDF);
  }

  function switchView(view) {
    state.currentView = view;

    $$('.view-panel').forEach(p => p.classList.remove('active'));
    const panelMap = { 
      editor: 'viewEditor', 
      history: 'viewHistory', 
      clients: 'viewClients', 
      settings: 'viewSettings',
      companyProfile: 'viewCompanyProfile'
    };
    const panelId = panelMap[view] || 'viewEditor';
    $('#' + panelId)?.classList.add('active');

    $$('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
    const navMap = { 
      editor: 'navNew', 
      history: 'navHistory', 
      clients: 'navClients', 
      settings: 'navSettings',
      companyProfile: 'navCompanyProfile'
    };
    if (navMap[view]) $('#' + navMap[view])?.classList.add('active');

    $$('.mbn-item').forEach(b => b.classList.remove('active'));
    $$('.mbn-item[data-view="' + view + '"]').forEach(b => b.classList.add('active'));

    if (view === 'history')  renderHistory();
    if (view === 'clients')  { renderClientsView(); populateClientDatalist(); }
    if (view === 'settings') populateSettingsPanel();
    if (view === 'companyProfile') populateCompanyProfileForm();

    updateBreadcrumb(view);
  }

  function updateBreadcrumb(view) {
    view = view || state.currentView;
    const el = $('#bcCurrent');
    if (!el) return;
    const labels = { editor: `${MODES[state.mode]?.label || 'Document'} — ${$('#docNumber')?.value || '…'}`, history: 'Historique', clients: 'Carnet clients', settings: 'Paramètres', companyProfile: 'Mon profil' };
    el.textContent = labels[view] || 'Document';
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

    const curr        = $('#currency')?.value || 'CFA';
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
      currency:     $('#currency')?.value     || 'CFA',
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
      sp.style.display = 'none'; sph.style.display = 'flex';
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
    const c = $('#currency');    if (c) c.value = 'CFA';
    const ve = $('#vatEnabled'); if (ve) ve.checked = true;
    const vr = $('#vatRate');    if (vr) vr.value = 18;
    const de = $('#discountEnabled'); if (de) de.checked = false;
    const dr = $('#discountRate');    if (dr) dr.value = 0;

    const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
    if (sp)  sp.style.display  = 'none';
    if (sph) sph.style.display = 'flex';
    if (scb) scb.style.display = 'none';

    const newNumber = consumeNextNumber('devis');
    const dn = $('#docNumber'); if (dn) dn.value = newNumber;

    const body = $('#itemsBody');
    if (body) { body.innerHTML = ''; addRow(); }

    // Pré-remplir avec le profil entreprise
    fillEmitterFromProfile();

    setMode('devis');
    setStatus('draft');
    recalculate();
    saveDraft();
    updateBreadcrumb();
    state.undoStack = [];
    state.redoStack = [];
    updateUndoRedoBtns();
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
    return state.currentUser ? `pg_history.v6.${state.currentUser.id}` : 'pg_history.v6.anon';
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
          <button class="hc-btn hc-btn-load" data-idx="${idx}"><i class="fas fa-folder-open"></i> Charger</button>
          <button class="hc-btn hc-btn-dup"  data-idx="${idx}"><i class="fas fa-copy"></i> Dupliquer</button>
          <button class="hc-btn hc-btn-pdf"  data-idx="${idx}"><i class="fas fa-file-pdf"></i></button>
          <button class="hc-btn hc-btn-del"  data-idx="${idx}"><i class="fas fa-trash"></i></button>
        </div>`;
      grid.appendChild(card);
    });

    grid.onclick = (e) => {
      const loadBtn = e.target.closest('.hc-btn-load');
      const dupBtn  = e.target.closest('.hc-btn-dup');
      const pdfBtn  = e.target.closest('.hc-btn-pdf');
      const delBtn  = e.target.closest('.hc-btn-del');

      if (loadBtn) {
        const h = getHistory()[parseInt(loadBtn.dataset.idx, 10)];
        if (h && confirm('Charger ce document ? Le brouillon actuel sera écrasé.')) {
          applyData(h);
          switchView('editor');
          toast('Document chargé', 'success');
        }
      }
      if (dupBtn) {
        const h = getHistory()[parseInt(dupBtn.dataset.idx, 10)];
        if (h) { applyData(h); duplicateDocument(); }
      }
      if (pdfBtn) {
        const h = getHistory()[parseInt(pdfBtn.dataset.idx, 10)];
        if (h) { applyData(h); switchView('editor'); setTimeout(exportPDF, 200); }
      }
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.idx, 10);
        const h   = getHistory();
        if (h[idx] && confirm(`Supprimer "${h[idx].docNumber || 'ce document'}" ?`)) {
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
     TEMPLATES
     ============================================================ */
  function openTemplateModal() {
    const modal = $('#templateModal');
    if (!modal) return;
    const grid = $('#templateGrid');
    if (grid && grid.children.length === 0) {
      TEMPLATES.forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.innerHTML = `<i class="${tpl.icon}"></i><div class="template-card-name">${tpl.name}</div><div class="template-card-desc">${tpl.desc}</div>`;
        card.addEventListener('click', () => applyTemplate(tpl));
        grid.appendChild(card);
      });
    }
    modal.classList.add('open');
  }

  function applyTemplate(tpl) {
    if (!confirm(`Appliquer le template "${tpl.name}" ? Le contenu actuel sera remplacé.`)) return;
    const body = $('#itemsBody');
    if (body) {
      body.innerHTML = '';
      tpl.items.forEach(it => body.appendChild(createRow({ id: uid(), ...it })));
    }
    const n = $('#docNotes'); if (n && tpl.notes) n.value = tpl.notes;
    recalculate();
    scheduleSave();
    $('#templateModal').classList.remove('open');
    toast(`Template "${tpl.name}" appliqué`, 'success');
  }

  /* ============================================================
     QR CODE PAIEMENT
     ============================================================ */
  function bindQrEvents() {
    const qrEnabled = $('#qrEnabled');
    const qrConfig  = $('#qrConfig');
    const btnGenQr  = $('#btnGenQr');

    qrEnabled?.addEventListener('change', () => {
      if (qrConfig) qrConfig.style.display = qrEnabled.checked ? 'flex' : 'none';
      if (!qrEnabled.checked) { const d = $('#qrCodeDisplay'); if (d) d.innerHTML = ''; }
    });

    btnGenQr?.addEventListener('click', () => {
      const phone    = $('#qrPhone')?.value?.trim();
      const provider = $('#qrProvider')?.value || 'momo';
      const total    = $('#grandTotal')?.textContent?.replace(/\s/g, '') || '0';
      const currency = $('#currency')?.value || 'CFA';

      if (!phone) { toast('Renseignez un numéro de paiement', 'warning'); return; }

      const displayEl = $('#qrCodeDisplay');
      if (!displayEl) return;
      displayEl.innerHTML = '';

      const labels = { momo: 'MTN MOMO', wave: 'Wave', airtel: 'Airtel Money', moov: 'Moov Money' };
      const text   = `${labels[provider] || 'Mobile Money'} | ${phone} | ${total} ${currency}`;

      try {
        if (window.QRCode) {
          new window.QRCode(displayEl, { text, width: 128, height: 128, colorDark: '#1e3c72', colorLight: '#ffffff' });
          toast('QR Code généré', 'success');
        } else {
          displayEl.innerHTML = `<div style="font-size:0.8rem;color:var(--text-light);padding:8px">QR Code lib non disponible.<br><code>${text}</code></div>`;
        }
      } catch (err) {
        console.error('QR:', err);
        toast('Erreur génération QR', 'error');
      }
    });
  }

  /* ============================================================
     PARTAGE WHATSAPP
     ============================================================ */
  function shareWhatsApp() {
    const mode    = MODES[state.mode]?.label || 'Document';
    const num_    = $('#docNumber')?.value || '—';
    const client  = $('#clientName')?.value || 'Client';
    const total   = $('#grandTotal')?.textContent || '0';
    const curr    = $('#currency')?.value || 'CFA';
    const emitter = $('#emitterName')?.value || 'Votre entreprise';

    const msg = `Bonjour,\n\nVeuillez trouver ci-joint votre ${mode} N° ${num_}.\n\nMontant total : ${total} ${curr}\nÉmis par : ${emitter}\n\nMerci de votre confiance.`;
    const url = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ============================================================
     RAPPELS EXPIRATION
     ============================================================ */
  function checkExpiringDocs() {
    if (!state.settings.reminders) return;
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
     EXPORT PDF — premium
     ============================================================ */
  function exportPDF() {
    const body = $('#itemsBody');
    if (!body || body.rows.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }

    try {
      const { jsPDF } = window.jspdf;
      const doc  = new jsPDF({ unit: 'mm', format: 'a4' });
      const pw = 210, ml = 14, mr = 14, cw = pw - ml - mr;
      const curr = $('#currency')?.value || 'CFA';
      const mode = MODES[state.mode] || MODES.devis;

      const C = {
        navy: [26,54,107], blue: [42,82,152], lightBg: [235,241,255],
        rowAlt: [249,251,255], line: [210,220,240], textDk: [22,34,60],
        textMd: [80,95,130], textLt: [140,155,185], white: [255,255,255],
        green: [21,128,61], red: [185,28,28]
      };

      const setFont  = (style = 'normal', size = 9) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
      const setColor = (rgb) => doc.setTextColor(...rgb);
      const setFill  = (rgb) => doc.setFillColor(...rgb);
      const setDraw  = (rgb, lw = 0.3) => { doc.setDrawColor(...rgb); doc.setLineWidth(lw); };

      // HEADER
      const emitterLines = [
        $('#emitterAddress')?.value,
        $('#emitterExtra')?.value,
        [$('#emitterTel')?.value, $('#emitterEmail')?.value].filter(Boolean).join('   |   ')
      ].filter(Boolean);

      const rightLineCount = 3 + (mode.hasValidity && $('#docValidity')?.value ? 1 : 0);
      const leftBottom  = 20 + emitterLines.length * 5;
      const rightBottom = 14 + rightLineCount * 6 + 4;
      const hdrH = Math.max(36, Math.max(leftBottom, rightBottom) + 6);

      setFill(C.navy);
      doc.rect(0, 0, pw, hdrH, 'F');

      const stInfo = STATUS_LABELS[state.docStatus] || STATUS_LABELS.draft;
      setFont('bold', 7);
      setColor([200,215,245]);
      doc.text(stInfo.label.toUpperCase(), pw - mr, hdrH - 4, { align: 'right' });

      let emitterX = ml;
      if (state.logoDataURL) {
        try {
          const imgFmt = state.logoDataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          const lSize  = Math.min(30, hdrH - 10);
          const lY     = (hdrH - lSize) / 2;
          setFill(C.white);
          doc.roundedRect(ml, lY, lSize, lSize, 3, 3, 'F');
          doc.addImage(state.logoDataURL, imgFmt, ml + 1, lY + 1, lSize - 2, lSize - 2, undefined, 'FAST');
          emitterX = ml + lSize + 6;
        } catch (_) {}
      }

      setColor(C.white); setFont('bold', 13);
      const nameY = Math.min(14, hdrH / 3);
      doc.text($('#emitterName')?.value || 'Votre entreprise', emitterX, nameY);
      setFont('normal', 8); setColor([200,215,245]);
      let ey = nameY + 6;
      emitterLines.forEach(line => { doc.text(line, emitterX, ey); ey += 5; });

      const rightX = pw - mr;
      setFont('bold', 24); setColor(C.white);
      doc.text(mode.label, rightX, 16, { align: 'right' });
      setDraw([255,255,255], 0.3);
      doc.line(rightX - 52, 19, rightX, 19);
      setFont('normal', 8.5); setColor([200,215,245]);
      doc.text(`N°  ${$('#docNumber')?.value || '—'}`, rightX, 25, { align: 'right' });
      doc.text(`Date :  ${localDate($('#docDate')?.value)}`, rightX, 31, { align: 'right' });
      if (mode.hasValidity && $('#docValidity')?.value) {
        doc.text(`Valide jusqu'au :  ${localDate($('#docValidity').value)}`, rightX, 37, { align: 'right' });
      }

      // CLIENT CARD
      let y = hdrH + 8;
      const clientLines = [
        $('#clientAddress')?.value,
        $('#clientExtra')?.value,
        [$('#clientTel')?.value, $('#clientEmail')?.value].filter(Boolean).join('   |   '),
        $('#clientSiret')?.value ? `SIRET / IFU : ${$('#clientSiret').value}` : null
      ].filter(Boolean);
      const cardH = Math.max(26, 16 + clientLines.length * 5 + 6);

      setFill(C.lightBg); setDraw(C.line, 0.4);
      doc.roundedRect(ml, y, cw, cardH, 4, 4, 'FD');
      setFill(C.blue);
      doc.roundedRect(ml, y, 22, cardH, 4, 4, 'F');
      doc.rect(ml + 16, y, 6, cardH, 'F');
      setColor(C.white); setFont('bold', 7);
      doc.text('FACTURÉ À', ml + 11, y + cardH - 4, { angle: 90, align: 'left' });
      const cx = ml + 26;
      setColor(C.textDk); setFont('bold', 11);
      doc.text($('#clientName')?.value || 'Client non renseigné', cx, y + 10);
      setFont('normal', 8.5); setColor(C.textMd);
      let cy2 = y + 17;
      clientLines.forEach(line => { doc.text(line, cx, cy2); cy2 += 5; });
      y += cardH + 8;

      // TABLE
      const tableRows = [];
      for (const tr of body.rows) {
        const q   = num(tr.querySelector('[data-field="qty"]')?.value);
        const p   = num(tr.querySelector('[data-field="price"]')?.value);
        const des = tr.querySelector('[data-field="designation"]')?.value || '';
        tableRows.push([des, String(q), fmt(p), fmt(q * p)]);
      }

      doc.autoTable({
        head: [[
          { content: 'Désignation',      styles: { halign: 'left'  } },
          { content: 'Qté',              styles: { halign: 'right' } },
          { content: `Prix unitaire HT`, styles: { halign: 'right' } },
          { content: `Total HT`,         styles: { halign: 'right' } }
        ]],
        body: tableRows,
        startY: y,
        margin: { left: ml, right: mr },
        styles: { fontSize: 9, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: C.textDk, lineColor: C.line, lineWidth: 0.25 },
        headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 5, right: 5 } },
        alternateRowStyles: { fillColor: C.rowAlt },
        columnStyles: { 0: { cellWidth: 'auto', halign: 'left' }, 1: { cellWidth: 18, halign: 'right' }, 2: { cellWidth: 38, halign: 'right' }, 3: { cellWidth: 38, halign: 'right' } },
        didParseCell(data) { if (data.column.index === 3 && data.section === 'body') { data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = C.navy; } }
      });

      y = doc.lastAutoTable.finalY;

      // TOTAUX
      const subtotal  = tableRows.reduce((s, _, i) => { const tr = body.rows[i]; return s + num(tr.querySelector('[data-field="qty"]')?.value) * num(tr.querySelector('[data-field="price"]')?.value); }, 0);
      const discOn    = $('#discountEnabled')?.checked || false;
      const discRate  = discOn ? num($('#discountRate')?.value) : 0;
      const discount  = subtotal * discRate / 100;
      const afterDisc = subtotal - discount;
      const vatOn     = $('#vatEnabled')?.checked || false;
      const vatRate   = vatOn ? num($('#vatRate')?.value) : 0;
      const tax       = afterDisc * vatRate / 100;
      const total     = afterDisc + tax;

      y += 6;
      const totX = ml + cw * 0.52, totW = cw * 0.48, colAmt = pw - mr, colLbl = totX + 5;
      const totLines = [
        { label: 'Sous-total HT', value: subtotal },
        discOn ? { label: `Remise (${discRate}%)`, value: -discount, red: true } : null,
        vatOn  ? { label: `TVA (${vatRate}%)`,     value: tax } : null
      ].filter(Boolean);

      const rowH = 6.5, totalH = totLines.length * rowH + 14;
      setFill(C.lightBg); setDraw(C.line, 0.3);
      doc.roundedRect(totX, y, totW, totalH, 3, 3, 'FD');

      let ty2 = y + 7;
      totLines.forEach(row => {
        setFont('normal', 8.5); setColor(row.red ? C.red : C.textMd);
        doc.text(row.label, colLbl, ty2);
        doc.text(`${row.red && row.value < 0 ? '− ' : ''}${fmt(Math.abs(row.value))} ${curr}`, colAmt, ty2, { align: 'right' });
        ty2 += rowH;
      });

      setDraw(C.blue, 0.5); doc.line(totX + 4, ty2 - 1, pw - mr - 4, ty2 - 1); ty2 += 3;
      const ttcH = 9;
      setFill(C.navy); doc.roundedRect(totX, ty2 - 5, totW, ttcH, 3, 3, 'F');
      setFont('bold', 10.5); setColor(C.white);
      doc.text('Total TTC', colLbl, ty2 + 1);
      doc.text(`${fmt(total)} ${curr}`, colAmt, ty2 + 1, { align: 'right' });
      ty2 += ttcH; y = ty2 + 10;

      // NOTES
      const notes = $('#docNotes')?.value?.trim();
      if (notes) {
        const notesY = doc.lastAutoTable.finalY + 6;
        setFill([245,247,252]); setDraw(C.line, 0.3);
        const notesW = cw * 0.5 - 4;
        const notesLines = doc.splitTextToSize(notes, notesW - 12);
        const notesH = notesLines.length * 4.5 + 14;
        doc.roundedRect(ml, notesY, notesW, notesH, 3, 3, 'FD');
        setFill(C.blue); doc.roundedRect(ml, notesY, notesW, 8, 3, 3, 'F');
        doc.rect(ml, notesY + 4, notesW, 4, 'F');
        setFont('bold', 7.5); setColor(C.white);
        doc.text('NOTES & CONDITIONS', ml + 5, notesY + 5.5);
        setFont('normal', 8); setColor(C.textMd);
        doc.text(notesLines, ml + 5, notesY + 13);
        y = Math.max(y, notesY + notesH + 8);
      }

      // QR CODE dans le PDF
      const qrEnabled = $('#qrEnabled')?.checked;
      const qrDisplay = $('#qrCodeDisplay');
      if (qrEnabled && qrDisplay) {
        const qrCanvas = qrDisplay.querySelector('canvas');
        if (qrCanvas) {
          try {
            const qrData = qrCanvas.toDataURL('image/png');
            const qrSize = 28;
            const qrX = pw - mr - qrSize;
            doc.addImage(qrData, 'PNG', qrX, doc.lastAutoTable.finalY + 6, qrSize, qrSize);
            setFont('normal', 6.5); setColor(C.textLt);
            doc.text('Scanner pour payer', qrX + qrSize / 2, doc.lastAutoTable.finalY + 6 + qrSize + 4, { align: 'center' });
          } catch (_) {}
        }
      }

      // SIGNATURE
      const signatoryName = $('#signatoryName')?.value?.trim() || '';
      const signatoryRole = $('#signatoryRole')?.value?.trim() || '';
      const sigExtraH = (signatoryName ? 5 : 0) + (signatoryRole ? 5 : 0);
      const sigBoxH = 28 + sigExtraH, sigBoxW = 80, sigY = y;

      setFill(C.lightBg); setDraw(C.line, 0.3);
      doc.roundedRect(ml, sigY, sigBoxW, sigBoxH, 3, 3, 'FD');
      setFont('bold', 7); setColor(C.textMd);
      doc.text('CACHET ET SIGNATURE', ml + 4, sigY + 6);

      if (state.sigImgDataURL) {
        try {
          const imgFmt = state.sigImgDataURL.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(state.sigImgDataURL, imgFmt, ml + 4, sigY + 8, sigBoxW - 10, 16, undefined, 'FAST');
        } catch (_) {
          setDraw(C.blue, 0.5); doc.line(ml + 4, sigY + 20, ml + sigBoxW - 6, sigY + 20);
        }
      } else {
        setDraw(C.blue, 0.5); doc.line(ml + 4, sigY + 20, ml + sigBoxW - 6, sigY + 20);
      }

      let sigTextY = sigY + 26;
      if (signatoryName) { setFont('bold', 8.5); setColor(C.textDk); doc.text(signatoryName, ml + 4, sigTextY); sigTextY += 5; }
      if (signatoryRole) { setFont('normal', 7.5); setColor(C.textMd); doc.text(signatoryRole, ml + 4, sigTextY); }

      const place = $('#placeOfIssue')?.value;
      if (place) {
        setFont('normal', 8); setColor(C.textMd);
        doc.text(`Fait à ${place}, le ${new Date().toLocaleDateString('fr-FR')}`, ml + sigBoxW + 8, sigY + sigBoxH / 2 + 2);
      }

      // FOOTER
      const pageH = doc.internal.pageSize.height;
      const footY = pageH - 8;
      setFill(C.navy); doc.rect(0, footY - 4, pw, 12, 'F');
      setFont('normal', 7); setColor([170,190,225]);
      const footerTxt = state.settings?.footer || `${mode.label}  ·  N° ${$('#docNumber')?.value || '—'}  ·  ${$('#emitterName')?.value || ''}`;
      doc.text(footerTxt, pw / 2, footY + 1, { align: 'center' });
      doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, pw - mr, footY + 1, { align: 'right' });

      const filename = `${mode.label}_${$('#docNumber')?.value || 'sans-numero'}.pdf`;
      doc.save(filename);
      toast('PDF généré ✓', 'success');

    } catch (err) {
      console.error('Erreur PDF :', err);
      toast('Erreur lors de la génération du PDF', 'error');
    }
  }

  /* ============================================================
     EXPORT EXCEL
     ============================================================ */
  function exportExcel() {
    const body = $('#itemsBody');
    if (!body || body.rows.length === 0) { toast('Ajoutez au moins une ligne', 'error'); return; }
    try {
      const curr = $('#currency')?.value || 'CFA';
      const modeLabel = MODES[state.mode]?.label || 'DEVIS';
      const wb = XLSX.utils.book_new();
      const rows = [
        [modeLabel],
        [],
        ['N°', $('#docNumber')?.value || '', 'Date', $('#docDate')?.value || ''],
        ['Statut', STATUS_LABELS[state.docStatus]?.label || 'Brouillon'],
        ['Émetteur', $('#emitterName')?.value || ''],
        [],
        ['CLIENT'],
        [$('#clientName')?.value    || ''],
        [$('#clientAddress')?.value || ''],
        [],
        ['Désignation', 'Qté', `Prix HT (${curr})`, `Total HT (${curr})`]
      ];

      let subtotal = 0;
      for (const tr of body.rows) {
        const q = num(tr.querySelector('[data-field="qty"]')?.value);
        const p = num(tr.querySelector('[data-field="price"]')?.value);
        rows.push([tr.querySelector('[data-field="designation"]')?.value || '', q, p, q * p]);
        subtotal += q * p;
      }

      const discOn   = $('#discountEnabled')?.checked || false;
      const discRate = discOn ? num($('#discountRate')?.value) : 0;
      const discount = subtotal * discRate / 100;
      const afterDisc = subtotal - discount;
      const vatOn    = $('#vatEnabled')?.checked || false;
      const vatRate  = vatOn ? num($('#vatRate')?.value) : 0;
      const tax      = afterDisc * vatRate / 100;
      const total    = afterDisc + tax;

      rows.push([]);
      rows.push(['Sous-total HT', '', '', '', subtotal]);
      if (discOn) rows.push([`Remise (${discRate}%)`, '', '', '', -discount]);
      if (vatOn)  rows.push([`TVA (${vatRate}%)`, '', '', '', tax]);
      rows.push(['Total TTC', '', '', '', total]);

      const notes = $('#docNotes')?.value?.trim();
      if (notes) { rows.push([]); rows.push(['Notes', notes]); }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Document');
      XLSX.writeFile(wb, `${modeLabel}_${$('#docNumber')?.value || 'sans-numero'}.xlsx`);
      toast('Excel généré ✓', 'success');
    } catch (err) { console.error('Excel:', err); toast('Erreur génération Excel', 'error'); }
  }

  /* ============================================================
     ÉVÉNEMENTS PRINCIPAUX
     ============================================================ */
  function bindEvents() {
    $('#docStatus')?.addEventListener('change', (e) => {
      state.docStatus = e.target.value;
      e.target.dataset.val = e.target.value;
      scheduleSave();
    });

    $('#btnUndo')?.addEventListener('click', undo);
    $('#btnRedo')?.addEventListener('click', redo);

    $('#btnArchive')?.addEventListener('click', archiveDocument);
    $('#btnDuplicate')?.addEventListener('click', duplicateDocument);
    $('#btnWhatsapp')?.addEventListener('click', shareWhatsApp);
    $('#btnPdf')?.addEventListener('click', exportPDF);
    $('#btnExcel')?.addEventListener('click', exportExcel);

    $('#addRow')?.addEventListener('click', () => addRow({}, true));

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

    $('#itemsBody')?.addEventListener('input', e => {
      const field = e.target.dataset?.field;
      if (field === 'qty' || field === 'price') {
        const v = parseFloat(e.target.value);
        if (v < 0 || !Number.isFinite(v)) e.target.value = 0;
      }
      recalculate(); scheduleSave();
    });

    $('#vatEnabled')?.addEventListener('change',      () => { recalculate(); scheduleSave(); });
    $('#discountEnabled')?.addEventListener('change', () => { recalculate(); scheduleSave(); });
    $('#vatRate')?.addEventListener('input',          () => { recalculate(); scheduleSave(); });
    $('#discountRate')?.addEventListener('input',     () => { recalculate(); scheduleSave(); });
    $('#currency')?.addEventListener('input',         () => { recalculate(); scheduleSave(); });

    const allInputs = [
      '#emitterName','#emitterAddress','#emitterExtra','#emitterTel','#emitterEmail',
      '#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail',
      '#docNumber','#docDate','#docValidity','#placeOfIssue','#docNotes','#signatoryName'
    ];
    allInputs.forEach(id => $(id)?.addEventListener('input', scheduleSave));
    $('#signatoryRole')?.addEventListener('change', scheduleSave);

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
    });

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
    });
    $('#btnClearSig')?.addEventListener('click', () => {
      state.sigImgDataURL = null;
      const sp = $('#sigImgPreview'), sph = $('#sigUploadPlaceholder'), scb = $('#btnClearSig');
      if (sp) { sp.src = '#'; sp.style.display = 'none'; }
      if (sph) sph.style.display = 'flex';
      if (scb) scb.style.display = 'none';
      scheduleSave();
    });

    const cd = $('#currentDate');
    if (cd) cd.textContent = new Date().toLocaleDateString('fr-FR');

    $('#historySearch')?.addEventListener('input', renderHistory);
    $('#filterType')?.addEventListener('change',   renderHistory);
    $('#filterStatus')?.addEventListener('change', renderHistory);

    $('#clientsSearch')?.addEventListener('input', renderClientsView);
    $('#btnSaveClient')?.addEventListener('click', saveCurrentClient);
    $('#btnPickClient')?.addEventListener('click', openClientPicker);
    $('#btnAddClientManual')?.addEventListener('click', () => {
      switchView('editor');
      ['#clientName','#clientAddress','#clientExtra','#clientSiret','#clientTel','#clientEmail']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });
      $('#clientName')?.focus();
    });

    $('#btnCloseClientPicker')?.addEventListener('click', () => $('#clientPickerModal')?.classList.remove('open'));
    $('#clientPickerModal')?.addEventListener('click', e => { if (e.target === $('#clientPickerModal')) $('#clientPickerModal').classList.remove('open'); });
    $('#clientPickerSearch')?.addEventListener('input', e => renderClientPickerList(e.target.value));

    $('#btnCloseTemplate')?.addEventListener('click', () => $('#templateModal')?.classList.remove('open'));
    $('#templateModal')?.addEventListener('click', e => { if (e.target === $('#templateModal')) $('#templateModal').classList.remove('open'); });

    $('#reminderClose')?.addEventListener('click', () => { const b = $('#reminderBanner'); if (b) b.style.display = 'none'; });

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

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); archiveDocument(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (e.key === 'Escape') {
        $('#templateModal')?.classList.remove('open');
        $('#clientPickerModal')?.classList.remove('open');
      }
    });
  }

  /* ============================================================
     SUPABASE — SYNC
     ============================================================ */
  async function syncDocumentToSupabase(data, isNew) {
    try {
      const payload = { user_id: state.currentUser.id, mode: data.mode, doc_number: data.docNumber, doc_date: data.docDate || null, doc_status: data.docStatus || 'draft', client_name: data.client?.name || '', total_ttc: computeTTC(data), data };
      if (isNew) {
        const { error } = await supabase.from('documents').insert(payload);
        if (!error) { state.docCount++; updateCounterBadge(); }
      } else {
        await supabase.from('documents').update({ ...payload, updated_at: new Date().toISOString() }).eq('user_id', state.currentUser.id).eq('doc_number', data.docNumber).eq('mode', data.mode);
      }
    } catch (e) { console.error('Sync Supabase:', e); }
  }

  async function loadDocCountFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { count } = await supabase.from('documents').select('*', { count: 'exact', head: true }).eq('user_id', state.currentUser.id);
      state.docCount = count || 0;
      updateCounterBadge();
    } catch (e) { console.error('Count:', e); }
  }

  async function loadHistoryFromSupabase() {
    if (!state.currentUser) return;
    try {
      const { data: rows, error } = await supabase.from('documents').select('data, created_at, updated_at').eq('user_id', state.currentUser.id).order('created_at', { ascending: false }).limit(100);
      if (error || !rows?.length) return;
      const remoteHist = rows.map(r => ({ ...r.data, savedAt: r.updated_at || r.created_at }));
      saveHistory(remoteHist);
      updateHistoryBadge();
    } catch (e) { console.error('History load:', e); }
  }

  async function deleteDocFromSupabase(docNumber, mode) {
    if (!state.currentUser) return;
    try {
      await supabase.from('documents').delete().eq('user_id', state.currentUser.id).eq('doc_number', docNumber).eq('mode', mode);
      state.docCount = Math.max(0, state.docCount - 1);
      updateCounterBadge();
    } catch (e) { console.error('Delete:', e); }
  }

  function updateCounterBadge() {
    const pct = Math.min(100, (state.docCount / DOC_LIMIT) * 100);
    const bar  = $('#sdcBar');
    const lbl  = $('#sdcLabel');
    if (bar) { bar.style.width = `${pct}%`; bar.style.background = pct >= 100 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--success)'; }
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
        const msgs = { 'Invalid login credentials': 'Email ou mot de passe incorrect.', 'Email not confirmed': 'Veuillez confirmer votre email.', 'Too many requests': 'Trop de tentatives. Réessayez plus tard.' };
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
      if (signData?.session) { }
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
    loadProfileFromSupabase();
    fillEmitterFromProfile();

    loadDraft();
    recalculate();
    ensureOneRow();
    populateClientDatalist();
    updateHistoryBadge();
    checkExpiringDocs();
    snapshotState();
  }

  /* ============================================================
     INITIALISATION
     ============================================================ */
  async function init() {
    applySettingsToDOM(state.settings);

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
    bindQrEvents();
    bindSettingsEvents();
    initCompanyProfileEvents();

    try {
      supabase.auth.onAuthStateChange((_event, session) => onAuthStateChange(session));
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      onAuthStateChange(data?.session ?? null);
    } catch (err) {
      console.error('Auth init:', err);
      toast('Connexion au serveur impossible. Vérifiez votre réseau.', 'error', 5000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
