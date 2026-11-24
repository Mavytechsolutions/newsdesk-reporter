/* MAVY NEWS admin page: review stories, approve journalists, manage sub-admins. No secrets in this file. */
(function () {
  'use strict';
  var API = '/api/v1';
  var ADMIN_ROLES = ['SUPER_ADMIN', 'MANAGING_EDITOR', 'DISTRICT_EDITOR'];
  var $ = function (id) { return document.getElementById(id); };
  var state = { me: null, tab: 'review', states: [], objectUrls: [] };

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return el;
  }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function msg(id, text, ok) { var box = $(id); box.innerHTML = ''; if (text) box.appendChild(h('div', { class: 'msg ' + (ok ? 'ok' : 'err'), text: text })); }
  function ago(iso) {
    if (!iso) return '';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'ఇప్పుడే'; if (m < 60) return m + ' ని. క్రితం';
    var hr = Math.round(m / 60); if (hr < 24) return hr + ' గం. క్రితం';
    return new Date(iso).toLocaleString('te-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }
  var STATUS = { DRAFT: 'డ్రాఫ్ట్', SUBMITTED: 'సమీక్షకు', IN_REVIEW: 'సమీక్షలో', CHANGES_REQUESTED: 'మార్పులు కావాలి', APPROVED: 'ఆమోదం', SCHEDULED: 'షెడ్యూల్', PUBLISHED: 'ప్రచురితం', REJECTED: 'తిరస్కరణ', ARCHIVED: 'తీసివేశారు' };
  var LEVEL = { JUNIOR: 'జూనియర్ జర్నలిస్ట్', JOURNALIST: 'జర్నలిస్ట్', SENIOR: '⭐ సీనియర్ జర్నలిస్ట్' };
  var ROLE = { SUPER_ADMIN: 'సూపర్ అడ్మిన్', MANAGING_EDITOR: 'మేనేజింగ్ ఎడిటర్', DISTRICT_EDITOR: 'సబ్-అడ్మిన్', SUB_EDITOR: 'సబ్ ఎడిటర్', REPORTER: 'రిపోర్టర్', VIDEO_JOURNALIST: 'వీడియో జర్నలిస్ట్', MARKETING_MANAGER: 'మార్కెటింగ్' };
  function lvl(level) { return level ? h('span', { class: 'lvl ' + level, text: LEVEL[level] }) : null; }
  function tel(phone) { return phone ? h('a', { class: 'tel', href: 'tel:' + phone, text: '📞 ' + phone.replace(/^\+91/, '') }) : null; }
  function placeName(p) { return p ? (p.nameTe + ' (' + p.nameEn + ')') : ''; }
  function ask(question) { var a = prompt(question); return a && a.trim() ? a.trim() : null; }

  // ---------- API with automatic token refresh (same login as the newsroom page) ----------
  function tokens() { try { return JSON.parse(localStorage.getItem('mavyNewsroom') || 'null'); } catch (e) { return null; } }
  function saveTokens(t) { if (t) localStorage.setItem('mavyNewsroom', JSON.stringify(t)); else localStorage.removeItem('mavyNewsroom'); }
  function refresh() {
    var t = tokens();
    if (!t || !t.refreshToken) return Promise.reject(new Error('expired'));
    return fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) })
      .then(function (r) { if (!r.ok) throw new Error('expired'); return r.json(); })
      .then(function (n) { saveTokens({ accessToken: n.accessToken, refreshToken: n.refreshToken, name: t.name, role: t.role }); });
  }
  function expired() { saveTokens(null); start(); return new Error('సెషన్ ముగిసింది. మళ్లీ లాగిన్ అవ్వండి.'); }
  function raw(method, path, body, retried) {
    var t = tokens();
    var opts = { method: method, headers: {} };
    if (t) opts.headers.Authorization = 'Bearer ' + t.accessToken;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401 && t && !retried) return refresh().then(function () { return raw(method, path, body, true); }, function () { throw expired(); });
      return res;
    }, function () { throw new Error('ఇంటర్నెట్ / సర్వర్ అందుబాటులో లేదు (No connection)'); });
  }
  function call(method, path, body) {
    return raw(method, path, body).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) { var m = data && data.message; throw Object.assign(new Error(Array.isArray(m) ? m.join(', ') : (m || 'Error ' + res.status)), { status: res.status }); }
        return data;
      });
    });
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); msg('loginMsg', '');
    call('POST', '/auth/staff/login', { email: $('email').value.trim(), password: $('password').value })
      .then(function (r) { saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken, name: r.name, role: r.role }); $('password').value = ''; start(); })
      .catch(function (err) { msg('loginMsg', err.message); });
  });
  $('logout').addEventListener('click', function () {
    var t = tokens();
    if (t) fetch(API + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
    saveTokens(null); start();
  });

  function start() {
    var t = tokens();
    state.me = t;
    var allowed = !!t && ADMIN_ROLES.indexOf(t.role) >= 0;
    show('loginView', !t); show('noAccess', !!t && !allowed); show('appView', allowed); show('logout', !!t);
    $('who').textContent = t ? (t.name || '') + (t.role ? ' · ' + (ROLE[t.role] || t.role) : '') : '';
    show('tabSubs', !!t && t.role === 'SUPER_ADMIN');
    if (allowed) { switchTab(state.tab); counts(); }
  }

  function counts() {
    call('GET', '/newsroom/articles?limit=1&source=journalist&statuses=SUBMITTED,IN_REVIEW').then(function (r) { $('cWaiting').textContent = r.total; }).catch(function () {});
    call('GET', '/admin/journalist-applications?status=PENDING').then(function (r) { $('cApps').textContent = r.length; }).catch(function () {});
    call('GET', '/admin/journalists').then(function (r) { $('cJournalists').textContent = r.length; }).catch(function () {});
  }

  // ---------- tabs ----------
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
  });
  function switchTab(tab) {
    if (tab === 'subs' && (!state.me || state.me.role !== 'SUPER_ADMIN')) tab = 'review';
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    ['review', 'apps', 'people', 'subs'].forEach(function (id) { show(id, id === tab); });
    state.objectUrls.forEach(function (u) { URL.revokeObjectURL(u); }); state.objectUrls = [];
    ({ review: loadReview, apps: loadApps, people: loadPeople, subs: loadSubs })[tab]();
    window.scrollTo(0, 0);
  }

  // ---------- 1. story review ----------
  function transition(id, action, note) { return call('POST', '/newsroom/articles/' + id + '/transition', note ? { action: action, note: note } : { action: action }); }
  function approveAndPublish(a) {
    var plan = { SUBMITTED: ['start_review', 'approve', 'publish'], IN_REVIEW: ['approve', 'publish'], APPROVED: ['publish'] }[a.status] || [];
    return plan.reduce(function (p, action) { return p.then(function () { return transition(a.id, action); }); }, Promise.resolve());
  }
  function loadReview() {
    var box = $('rList'); box.innerHTML = '';
    msg('rMsg', 'లోడ్ అవుతోంది…', true);
    var src = $('rSource').value;
    call('GET', '/newsroom/articles?limit=50&statuses=' + $('rStatus').value + (src ? '&source=' + src : '')).then(function (r) {
      msg('rMsg', r.total ? '' : '✔ ఇక్కడ వార్తలు ఏవీ లేవు (Nothing here)', true);
      r.items.forEach(function (a) { box.appendChild(storyCard(a)); });
    }).catch(function (e) { msg('rMsg', e.message); });
  }
  function storyCard(a) {
    var t = a.translations.filter(function (x) { return x.language === 'te'; })[0] || a.translations[0] || {};
    var author = a.author || {};
    var actions = h('div', { class: 'actions' });
    var done = function (text) { return function () { msg('rMsg', text, true); loadReview(); counts(); }; };
    var fail = function (e) { msg('rMsg', e.message); window.scrollTo(0, 0); };
    if (['SUBMITTED', 'IN_REVIEW', 'APPROVED'].indexOf(a.status) >= 0) {
      actions.appendChild(h('button', { class: 'btn small', type: 'button', text: '✔ ఆమోదించి ప్రచురించు (Approve & publish)', onclick: function (ev) {
        ev.target.disabled = true;
        approveAndPublish(a).then(done('✔ ప్రచురించబడింది. జర్నలిస్ట్‌కు పాయింట్లు జమ అయ్యాయి. (Published, points added)'), fail).then(function () { ev.target.disabled = false; });
      } }));
      actions.appendChild(h('button', { class: 'btn out small', type: 'button', text: '↩ మార్పులు కోరండి (Send back)', onclick: function () {
        var note = ask('ఏమి మార్చాలి? జర్నలిస్ట్‌కు యాప్‌లో కనిపిస్తుంది (What should they fix?)'); if (!note) return;
        transition(a.id, 'request_changes', note).then(done('✔ జర్నలిస్ట్‌కు తిరిగి పంపబడింది (Sent back)'), fail);
      } }));
      if (a.status !== 'APPROVED') actions.appendChild(h('button', { class: 'btn red small', type: 'button', text: '✖ తిరస్కరించు (Reject)', onclick: function () {
        var note = ask('ఎందుకు తిరస్కరిస్తున్నారు? (Reason)'); if (!note) return;
        (a.status === 'SUBMITTED' ? transition(a.id, 'start_review') : Promise.resolve()).then(function () { return transition(a.id, 'reject', note); }).then(done('✔ తిరస్కరించబడింది (Rejected)'), fail);
      } }));
    }
    if (a.status === 'PUBLISHED') {
      actions.appendChild(h('a', { class: 'btn out small', href: '/n/' + a.slug, target: '_blank', rel: 'noopener', text: '👁 చూడు (View)' }));
      if (state.me.role !== 'DISTRICT_EDITOR') actions.appendChild(h('button', { class: 'btn red small', type: 'button', text: 'తీసివేయి (Take down)', onclick: function () {
        var why = ask('ఈ వార్తను ఎందుకు తీసివేస్తున్నారు? జర్నలిస్ట్ పాయింట్లు వెనక్కి తీసుకోబడతాయి. (Reason — the journalist loses this story\'s points)'); if (!why) return;
        transition(a.id, 'archive', why).then(done('✔ తీసివేయబడింది (Taken down)'), fail);
      } }));
    }
    var places = (a.locations || []).map(function (l) { return l.location.nameTe; }).join(', ');
    return h('div', { class: 'story' },
      h('div', { class: 'meta' }, h('span', { class: 'badge ' + a.status, text: STATUS[a.status] || a.status }),
        (a.category ? a.category.nameTe : '') + (places ? ' · 📍 ' + places : '') + ' · ' + ago(a.updatedAt)),
      h('h3', { text: (a.isBreaking ? '🔴 ' : '') + (t.headline || '') }),
      a.heroImageUrl ? h('img', { class: 'hero', src: a.heroImageUrl, alt: '' }) : null,
      h('p', { text: t.body || t.summary || '' }),
      h('div', { class: 'meta' }, '✍ ' + (author.name || '—'), lvl(author.contributorLevel), ' ', tel(author.phone)),
      actions);
  }
  $('rStatus').addEventListener('change', loadReview);
  $('rSource').addEventListener('change', loadReview);
  $('rRefresh').addEventListener('click', function () { loadReview(); counts(); });

  // ---------- 2. journalist requests ----------
  function loadApps() {
    var box = $('aList'); box.innerHTML = '';
    msg('aMsg', 'లోడ్ అవుతోంది…', true);
    var st = $('aStatus').value;
    call('GET', '/admin/journalist-applications?status=' + st).then(function (list) {
      msg('aMsg', list.length ? '' : '✔ దరఖాస్తులు ఏవీ లేవు (No requests)', true);
      list.forEach(function (x) { box.appendChild(appCard(x)); });
    }).catch(function (e) { msg('aMsg', e.message); });
  }
  function appCard(x) {
    var imgBox = h('div');
    var actions = h('div', { class: 'actions' });
    var done = function (text) { return function () { msg('aMsg', text, true); loadApps(); counts(); window.scrollTo(0, 0); }; };
    var fail = function (e) { msg('aMsg', e.message); window.scrollTo(0, 0); };
    if (x.status === 'PENDING') {
      if (x.hasAadhaar) actions.appendChild(h('button', { class: 'btn out small', type: 'button', text: '🪪 ఆధార్ చూడండి (View Aadhaar)', onclick: function (ev) {
        ev.target.disabled = true;
        raw('GET', '/admin/journalist-applications/' + x.id + '/aadhaar').then(function (res) {
          if (!res.ok) throw new Error('ఆధార్ ఫోటో అందుబాటులో లేదు (' + res.status + ')');
          return res.blob();
        }).then(function (b) {
          var u = URL.createObjectURL(b); state.objectUrls.push(u);
          imgBox.innerHTML = ''; imgBox.appendChild(h('img', { class: 'aadhaar', src: u, alt: 'Aadhaar' }));
        }).catch(fail).then(function () { ev.target.disabled = false; });
      } }));
      actions.appendChild(h('button', { class: 'btn small', type: 'button', text: '✔ ఆమోదించు (Approve)', onclick: function () {
        if (!confirm(x.name + ' ను జూనియర్ జర్నలిస్ట్‌గా ఆమోదించాలా? (Approve as Junior Journalist?)')) return;
        call('POST', '/admin/journalist-applications/' + x.id + '/decision', { decision: 'approve' }).then(done('✔ ' + x.name + ' ఇప్పుడు జూనియర్ జర్నలిస్ట్. యాప్ నుంచి వార్తలు పంపగలరు.'), fail);
      } }));
      actions.appendChild(h('button', { class: 'btn red small', type: 'button', text: '✖ తిరస్కరించు (Reject)', onclick: function () {
        var note = ask('కారణం రాయండి — వ్యక్తికి యాప్‌లో కనిపిస్తుంది (Reason, shown to the person)'); if (!note) return;
        call('POST', '/admin/journalist-applications/' + x.id + '/decision', { decision: 'reject', note: note }).then(done('✔ తిరస్కరించబడింది (Rejected)'), fail);
      } }));
    }
    return h('div', { class: 'story' },
      h('div', { class: 'meta' }, ago(x.createdAt) + (x.reviewedAt ? ' · నిర్ణయం: ' + ago(x.reviewedAt) : '')),
      h('h3', { text: x.name }),
      h('div', {}, '📍 ' + placeName(x.place), '  ', tel(x.phone)),
      x.note ? h('p', { class: 'help', text: 'గమనిక (Note): ' + x.note }) : null,
      imgBox, actions);
  }
  $('aStatus').addEventListener('change', loadApps);
  $('aRefresh').addEventListener('click', function () { loadApps(); counts(); });

  // ---------- 3. journalists ----------
  function loadPeople() {
    var box = $('pList'); box.innerHTML = '';
    msg('pMsg', 'లోడ్ అవుతోంది…', true);
    call('GET', '/admin/journalists').then(function (list) {
      msg('pMsg', list.length ? '' : 'ఇంకా జర్నలిస్టులు లేరు (No journalists yet)', true);
      list.forEach(function (j, i) {
        var act = j.suspendedAt
          ? h('button', { class: 'btn small', type: 'button', text: 'మళ్లీ అనుమతించు (Reactivate)', onclick: function () {
            call('PATCH', '/admin/journalists/' + j.id, { action: 'reactivate' }).then(loadPeople, function (e) { msg('pMsg', e.message); });
          } })
          : h('button', { class: 'btn out small', type: 'button', text: '⏸ నిలిపివేయి (Suspend)', onclick: function () {
            var why = ask('ఎందుకు నిలిపివేస్తున్నారు? (Reason)'); if (!why) return;
            call('PATCH', '/admin/journalists/' + j.id, { action: 'suspend', reason: why }).then(loadPeople, function (e) { msg('pMsg', e.message); });
          } });
        box.appendChild(h('div', { class: 'person' },
          h('div', {}, h('b', { text: (i + 1) + '. ' + (j.name || '—') }), lvl(j.level), j.suspendedAt ? h('span', { class: 'badge REJECTED', text: 'నిలిపివేశారు' }) : null,
            h('div', { class: 'meta' }, '📍 ' + placeName(j.place) + ' · ' + j.approvedPosts + ' వార్తలు · ', h('b', { text: j.points + ' పాయింట్లు' }), ' ', tel(j.phone))),
          act));
      });
    }).catch(function (e) { msg('pMsg', e.message); });
  }

  // ---------- 4. sub-admins (Super Admin only) ----------
  function fillSelect(sel, items, first) {
    sel.innerHTML = '';
    if (first) sel.appendChild(h('option', { value: '', text: first }));
    items.forEach(function (x) { sel.appendChild(h('option', { value: x.id, text: x.nameTe + ' (' + x.nameEn + ')' })); });
  }
  function loadDistricts() {
    return call('GET', '/locations?parentId=' + $('sState').value).then(function (ds) {
      fillSelect($('sDistrict'), ds, '— జిల్లా ఎంచుకోండి —'); fillSelect($('sMandal'), [], '— మొత్తం జిల్లా (Whole district) —');
    });
  }
  $('sState').addEventListener('change', loadDistricts);
  $('sDistrict').addEventListener('change', function () {
    if (!$('sDistrict').value) return fillSelect($('sMandal'), [], '— మొత్తం జిల్లా (Whole district) —');
    call('GET', '/locations?parentId=' + $('sDistrict').value).then(function (list) {
      fillSelect($('sMandal'), list.filter(function (x) { return x.type === 'MANDAL' || x.type === 'MUNICIPALITY'; }), '— మొత్తం జిల్లా (Whole district) —');
    });
  });
  $('genPass').addEventListener('click', function () {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', out = '', r = new Uint32Array(12);
    crypto.getRandomValues(r); for (var i = 0; i < 12; i++) out += chars[r[i] % chars.length];
    $('sPass').value = 'Mavy-' + out + '-7';
  });
  $('subForm').addEventListener('submit', function (e) {
    e.preventDefault(); msg('sMsg', '');
    var loc = $('sMandal').value || $('sDistrict').value;
    if (!loc) return msg('sMsg', 'జిల్లా ఎంచుకోండి (Choose a district)');
    var area = ($('sMandal').value ? $('sMandal') : $('sDistrict')).selectedOptions[0].textContent;
    var body = { name: $('sName').value.trim(), email: $('sEmail').value.trim(), password: $('sPass').value, role: 'DISTRICT_EDITOR', designation: 'Sub-admin · ' + area, locationIds: [loc] };
    if ($('sPhone').value.trim()) body.phone = $('sPhone').value.trim();
    call('POST', '/admin/staff', body).then(function () {
      msg('sMsg', '✔ సృష్టించబడింది. ఈ వివరాలు వారికి ఇవ్వండి — Login: ' + location.origin + '/admin · ' + body.email + ' · ' + body.password, true);
      $('sName').value = ''; $('sEmail').value = ''; $('sPhone').value = ''; $('sPass').value = '';
      loadSubList();
    }).catch(function (err) { msg('sMsg', err.message); });
  });
  function loadSubs() {
    var ready = state.states.length ? Promise.resolve() : call('GET', '/locations').then(function (s) {
      state.states = s; fillSelect($('sState'), s); return loadDistricts();
    });
    ready.then(loadSubList).catch(function (e) { msg('subMsg', e.message); });
  }
  function loadSubList() {
    var box = $('subList'); box.innerHTML = '';
    call('GET', '/admin/staff').then(function (list) {
      list.forEach(function (s) {
        var u = s.user; var off = s.suspendedAt || s.revokedAt;
        var act = u.id === (state.me && state.me.userId) ? null : off
          ? h('button', { class: 'btn small', type: 'button', text: 'మళ్లీ అనుమతించు', onclick: function () { call('PATCH', '/admin/staff/' + u.id, { action: 'reactivate' }).then(loadSubList, function (e) { msg('subMsg', e.message); }); } })
          : u.role === 'SUPER_ADMIN' ? null
          : h('button', { class: 'btn out small', type: 'button', text: '⏸ నిలిపివేయి', onclick: function () {
            var why = ask('ఎందుకు? (Reason)'); if (!why) return;
            call('PATCH', '/admin/staff/' + u.id, { action: 'suspend', reason: why }).then(loadSubList, function (e) { msg('subMsg', e.message); });
          } });
        var areas = s.assignments.map(function (l) { return l.nameTe; }).join(', ') || (u.role === 'SUPER_ADMIN' || u.role === 'MANAGING_EDITOR' ? 'అన్ని ప్రాంతాలు (All areas)' : '—');
        box.appendChild(h('div', { class: 'person' },
          h('div', {}, h('b', { text: u.name || u.email }), ' ', h('span', { class: 'badge', text: ROLE[u.role] || u.role }), off ? h('span', { class: 'badge REJECTED', text: 'నిలిపివేశారు' }) : null,
            h('div', { class: 'meta' }, '📍 ' + areas + ' · ' + (u.email || ''), ' ', tel(u.phone))),
          act));
      });
    }).catch(function (e) { msg('subMsg', e.message); });
  }

  // ---------- forgotten / change password: OTP to the account's registered mobile ----------
  if ($('forgotPw')) $('forgotPw').addEventListener('click', function () {
    var login = prompt('యూజర్‌నేమ్ / ఈమెయిల్ (Username / email)', $('email').value.trim() || 'admin');
    if (!login) return;
    fetch(API + '/auth/staff/password/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: login.trim() }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d && d.message || 'Error'); return d; }); })
      .then(function (d) {
        var code = prompt('OTP పంపబడింది: ' + d.to + ' — 6 అంకెల OTP నమోదు చేయండి (Enter the 6-digit OTP)');
        if (!code) return;
        var pw = prompt('కొత్త పాస్‌వర్డ్ — 10+ అక్షరాలు, అంకెలతో (New password: 10+ characters with numbers)');
        if (!pw) return;
        if (prompt('కొత్త పాస్‌వర్డ్ మళ్లీ (Type it again)') !== pw) throw new Error('రెండు పాస్‌వర్డ్‌లు ఒకేలా లేవు (Passwords do not match)');
        return fetch(API + '/auth/staff/password/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: login.trim(), code: code.trim(), newPassword: pw }) })
          .then(function (r) { return r.json().then(function (x) { if (!r.ok) throw new Error(x && x.message || 'Error'); }); })
          .then(function () { saveTokens(null); msg('loginMsg', '✔ పాస్‌వర్డ్ మార్చబడింది. కొత్త పాస్‌వర్డ్‌తో లాగిన్ అవ్వండి. (Password changed)', true); start(); });
      })
      .catch(function (e) { msg('loginMsg', e.message); });
  });

  start();
})();
