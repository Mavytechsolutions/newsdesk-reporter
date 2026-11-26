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
    show('tabAuto', !!t && t.role === 'SUPER_ADMIN');
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
    if ((tab === 'subs' || tab === 'auto') && (!state.me || state.me.role !== 'SUPER_ADMIN')) tab = 'review';
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    ['review', 'apps', 'people', 'subs', 'auto'].forEach(function (id) { show(id, id === tab); });
    state.objectUrls.forEach(function (u) { URL.revokeObjectURL(u); }); state.objectUrls = [];
    ({ review: loadReview, apps: loadApps, people: loadPeople, subs: loadSubs, auto: loadAuto })[tab]();
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
    var live = a.status === 'PUBLISHED' || a.status === 'SCHEDULED';
    if (state.me.role !== 'DISTRICT_EDITOR' || !live)
      actions.appendChild(h('button', { class: 'btn red small', type: 'button', text: '🗑 శాశ్వతంగా తొలగించు (Delete)', onclick: function () {
        var t2 = (a.translations[0] || {}).headline || '';
        if (!confirm('ఈ వార్తను శాశ్వతంగా తొలగించాలా? తిరిగి తీసుకురాలేము.\n(Delete this story for good? This cannot be undone.)\n\n' + t2)) return;
        var why = live ? ask('ఎందుకు తొలగిస్తున్నారు? (Reason)') : '';
        if (live && !why) return;
        call('DELETE', '/newsroom/articles/' + a.id + (why ? '?reason=' + encodeURIComponent(why) : ''))
          .then(done('✔ తొలగించబడింది (Deleted)'), fail);
      } }));
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

  // ---------- 5. Auto News (master admin only) ----------
  var KIND = { PRESS_RELEASE: 'ప్రెస్ నోట్లు (Press releases)', OFFICIAL_ALERT: 'అధికారిక హెచ్చరికలు (Official alerts)', RSS: 'RSS ఫీడ్', TIP_ONLY: 'టిప్ మాత్రమే (Tip only)' };
  function loadAuto() {
    msg('anMsg', ''); msg('anSrcMsg', '');
    call('GET', '/admin/auto-news').then(function (r) {
      var s = r.settings;
      $('anEnabled').checked = s.enabled; $('anTest').checked = s.testMode;
      $('anInterval').value = String(s.intervalMinutes); $('anLimit').value = s.dailyCostLimitUsd.toFixed(2);
      var key = $('anKey'); key.innerHTML = '';
      key.appendChild(h('div', { class: 'msg ' + (r.keyConfigured ? 'ok' : 'err'), text: r.keyConfigured
        ? '🔑 Claude API కీ సర్వర్‌లో ఉంది (Claude API key is set on the server — it is never shown here).'
        : '🔑 Claude API కీ ఇంకా సర్వర్‌లో లేదు. స్టెప్ 3 లో జోడిస్తాం. (Claude API key not set on the server yet — we add it in Step 3.)' }));
      renderSources(r.sources);
      $('anFound').textContent = r.today.found; $('anNew').textContent = r.today.new;
      $('anDup').textContent = r.today.duplicates; $('anTips').textContent = r.today.tips;
      loadItems(); loadRuns();
    }).catch(function (e) { msg('anMsg', e.message); });
  }
  var ITEM = { NEW: 'కొత్తది (New)', DUPLICATE: 'డూప్లికేట్ (Duplicate)', TIP: 'టిప్ (Tip)', SKIPPED: 'వదిలేశాం (Skipped)' };
  function loadItems() {
    var box = $('anItems'); box.innerHTML = '';
    var st = $('anItemStatus').value;
    call('GET', '/admin/auto-news/items?limit=60' + (st ? '&status=' + st : '')).then(function (list) {
      if (!list.length) { box.appendChild(h('p', { class: 'help', text: 'ఇంకా ఏమీ లేవు. "ఇప్పుడే చూడండి" నొక్కండి. (Nothing yet — press "Check now".)' })); return; }
      list.forEach(function (x) {
        box.appendChild(h('div', { class: 'item' },
          h('div', { style: 'flex:1;min-width:0' },
            h('div', null, h('span', { class: 'badge ist ' + x.status, text: ITEM[x.status] || x.status }),
              x.alert ? h('span', { class: 'badge ist ALERT', text: '⚠ ' + x.alert.event + (x.alert.severity ? ' · ' + x.alert.severity : '') }) : null),
            h('h3', { text: x.title }),
            x.alert && x.alert.headlineTe ? h('div', { class: 'help', text: x.alert.headlineTe }) : null,
            x.summary ? h('div', { class: 'help', text: x.summary.length > 220 ? x.summary.slice(0, 220) + '…' : x.summary }) : null,
            h('div', { class: 'meta', text: '📡 ' + x.sourceName + (x.area ? ' · 📍 ' + x.area : '') + ' · ' + ago(x.publishedAt || x.createdAt)
              + (x.alert && x.alert.expires ? ' · ⏳ ' + new Date(x.alert.expires).toLocaleString('te-IN', { dateStyle: 'short', timeStyle: 'short' }) + ' వరకు (until)' : '') }),
            h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', style: 'font-size:13px;color:#2563EB;word-break:break-all', text: '🔗 అసలు వార్త (Original)' }))));
      });
    }).catch(function (e) { box.appendChild(h('div', { class: 'msg err', text: e.message })); });
  }
  function loadRuns() {
    var box = $('anRuns'); box.innerHTML = '';
    call('GET', '/admin/auto-news/runs?limit=20').then(function (list) {
      if (!list.length) { box.appendChild(h('p', { class: 'help', text: 'ఇంకా తనిఖీలు జరగలేదు. (No checks yet.)' })); return; }
      list.forEach(function (r) {
        box.appendChild(h('div', { class: 'item' }, h('div', { style: 'flex:1' },
          h('div', { style: 'font-weight:700;font-size:14px', text: (r.error ? '⚠ ' : '✔ ') + r.sourceName }),
          h('div', { class: 'meta', text: ago(r.startedAt) + ' · ' + (r.trigger === 'manual' ? 'మీరు నొక్కారు (manual)' : 'ఆటోమేటిక్ (automatic)')
            + ' · దొరికినవి ' + r.found + ' · కొత్తవి ' + r.added + ' · డూప్లికేట్ ' + r.duplicates + ' · వదిలేసినవి ' + r.skipped }),
          r.error ? h('div', { class: 'msg err', style: 'margin:6px 0 0', text: r.error }) : null)));
      });
    }).catch(function (e) { box.appendChild(h('div', { class: 'msg err', text: e.message })); });
  }
  function renderSources(list) {
    var box = $('anSources'); box.innerHTML = '';
    if (!list.length) { box.appendChild(h('p', { class: 'help', text: 'మూలాలు లేవు. కింద జోడించండి. (No sources yet — add one below.)' })); return; }
    list.forEach(function (x) {
      function toggle(field, label, allowed, help) {
        var cb = h('input', { type: 'checkbox' }); cb.checked = !!x[field]; if (!allowed) cb.disabled = true;
        cb.addEventListener('change', function () {
          var body = {}; body[field] = cb.checked;
          if (field === 'autoPublish' && cb.checked && !confirm('ఈ మూలం నుంచి వార్తలు మీ ఆమోదం లేకుండా నేరుగా ప్రచురించబడతాయి. సరేనా?\n(Posts from this source will go live WITHOUT approval. Are you sure?)')) { cb.checked = false; return; }
          call('PATCH', '/admin/auto-news/sources/' + x.id, body).then(function () { msg('anSrcMsg', '✔ సేవ్ అయింది (Saved)', true); loadAuto(); },
            function (e) { cb.checked = !cb.checked; msg('anSrcMsg', e.message); });
        });
        return h('label', { title: help || '' }, cb, label);
      }
      var gov = x.isGovernment;
      box.appendChild(h('div', { class: 'src' },
        h('h3', null, h('span', { class: 'badge kind ' + x.kind, text: KIND[x.kind] || x.kind }), x.name),
        h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', text: x.url }),
        x.note ? h('div', { class: 'meta', text: '📝 ' + x.note }) : null,
        h('div', { class: 'meta', text: (x.lastCheckedAt ? 'చివరిగా చూసింది (Last checked): ' + ago(x.lastCheckedAt) : 'ఇంకా చూడలేదు (Not checked yet)') + (gov ? ' · 🏛 ప్రభుత్వ సైట్ (Government site)' : '') }),
        x.lastError ? h('div', { class: 'msg err', text: '⚠ ' + x.lastError }) : null,
        h('div', { class: 'toggles' },
          toggle('enabled', 'ఆన్ (On)', true),
          toggle('photosAllowed', 'ఫోటోలు వాడవచ్చు (Use photos)', gov && x.kind !== 'TIP_ONLY', 'Government sites only'),
          x.kind === 'OFFICIAL_ALERT' ? toggle('autoPublish', 'ఆమోదం లేకుండా ప్రచురించు (Publish without approval)', gov, 'Official government alerts only') : null),
        h('div', { class: 'actions' }, h('button', { class: 'btn out small', type: 'button', text: '🗑 తీసివేయండి (Remove)', onclick: function () {
          if (!confirm('"' + x.name + '" ను జాబితా నుంచి తీసివేయాలా? (Remove this source?)')) return;
          call('DELETE', '/admin/auto-news/sources/' + x.id).then(function () { msg('anSrcMsg', '✔ తీసివేశాం (Removed)', true); loadAuto(); }, function (e) { msg('anSrcMsg', e.message); });
        } }))));
    });
  }
  $('anSave').addEventListener('click', function () {
    var limit = Number(String($('anLimit').value).replace(',', '.'));
    if (!(limit >= 0 && limit <= 100)) { msg('anMsg', 'ఖర్చు పరిమితి 0 నుంచి 100 డాలర్ల మధ్య ఉండాలి (Limit must be between 0 and 100 dollars)'); return; }
    if ($('anEnabled').checked && !$('anTest').checked && !confirm('టెస్ట్ మోడ్ ఆఫ్ — ఆమోదించిన వార్తలు అందరికీ కనిపిస్తాయి. సరేనా?\n(Test mode OFF — approved posts will be visible to everyone. Continue?)')) return;
    $('anSave').disabled = true;
    call('PATCH', '/admin/auto-news/settings', { enabled: $('anEnabled').checked, testMode: $('anTest').checked, intervalMinutes: Number($('anInterval').value), dailyCostLimitUsd: Math.round(limit * 100) / 100 })
      .then(function () { msg('anMsg', '✔ సెట్టింగ్స్ సేవ్ అయ్యాయి (Settings saved)', true); loadAuto(); })
      .catch(function (e) { msg('anMsg', e.message); })
      .then(function () { $('anSave').disabled = false; });
  });
  $('anAdd').addEventListener('submit', function (e) {
    e.preventDefault(); msg('anAddMsg', '');
    var body = { name: $('anName').value.trim(), url: $('anUrl').value.trim(), kind: $('anKind').value, photosAllowed: $('anPhotos').checked };
    if ($('anNote').value.trim()) body.note = $('anNote').value.trim();
    call('POST', '/admin/auto-news/sources', body).then(function (r) {
      ['anName', 'anUrl', 'anNote'].forEach(function (id) { $(id).value = ''; }); $('anPhotos').checked = false;
      msg('anAddMsg', '✔ జోడించాం (Added)' + (r.notes && r.notes.length ? ' — ' + r.notes.join(' ') : ''), true); loadAuto();
    }).catch(function (err) { msg('anAddMsg', err.message); });
  });
  $('anItemStatus').addEventListener('change', loadItems);
  $('anCheck').addEventListener('click', function () {
    var b = $('anCheck'); b.disabled = true; b.textContent = '⏳ చూస్తున్నాం… (Checking — up to 1 minute)'; msg('anCheckMsg', '');
    call('POST', '/admin/auto-news/check-now', {}).then(function (r) {
      var added = r.results.reduce(function (a, x) { return a + x.added; }, 0);
      var errs = r.results.filter(function (x) { return x.error; }).length;
      msg('anCheckMsg', '✔ ' + r.results.length + ' మూలాలు చూశాం, ' + added + ' కొత్త వార్తలు దొరికాయి (' + r.results.length + ' sources checked, ' + added + ' new items)' + (errs ? ' · ⚠ ' + errs + ' మూలాల్లో సమస్య — లాగ్ చూడండి (problems in ' + errs + ' — see the log)' : ''), !errs);
      loadAuto();
    }).catch(function (e) { msg('anCheckMsg', e.message); })
      .then(function () { b.disabled = false; b.textContent = '🔄 ఇప్పుడే చూడండి (Check now)'; });
  });
})();
