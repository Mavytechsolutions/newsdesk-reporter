/* MAVY NEWS newsroom page. Talks to the same server it is loaded from. No secrets in this file. */
(function () {
  'use strict';
  var API = '/api/v1';
  var $ = function (id) { return document.getElementById(id); };
  var state = { me: null, editingId: null, editingStatus: null, photoUrl: null, cats: [], districts: [], picked: [], district: null };

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
  function words(s) { return (s || '').trim().split(/\s+/).filter(Boolean).length; }
  function ago(iso) {
    if (!iso) return '';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'ఇప్పుడే'; if (m < 60) return m + ' ని. క్రితం';
    var hr = Math.round(m / 60); if (hr < 24) return hr + ' గం. క్రితం';
    return new Date(iso).toLocaleString('te-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }
  var STATUS = { DRAFT: 'డ్రాఫ్ట్', SUBMITTED: 'సమీక్షకు', IN_REVIEW: 'సమీక్షలో', CHANGES_REQUESTED: 'మార్పులు కావాలి', APPROVED: 'ఆమోదం', SCHEDULED: 'షెడ్యూల్', PUBLISHED: 'ప్రచురితం', REJECTED: 'తిరస్కరణ', ARCHIVED: 'తీసివేశారు' };

  // ---------- API with automatic token refresh ----------
  function tokens() { try { return JSON.parse(localStorage.getItem('mavyNewsroom') || 'null'); } catch (e) { return null; } }
  function saveTokens(t) { if (t) localStorage.setItem('mavyNewsroom', JSON.stringify(t)); else localStorage.removeItem('mavyNewsroom'); }

  function call(method, path, body, retried) {
    var t = tokens();
    var opts = { method: method, headers: {} };
    if (t) opts.headers.Authorization = 'Bearer ' + t.accessToken;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401 && t && t.refreshToken && !retried) {
        return fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) })
          .then(function (r) { if (!r.ok) throw new Error('expired'); return r.json(); })
          .then(function (n) { saveTokens({ accessToken: n.accessToken, refreshToken: n.refreshToken, name: t.name, role: t.role }); return call(method, path, body, true); })
          .catch(function () { saveTokens(null); start(); throw new Error('సెషన్ ముగిసింది. మళ్లీ లాగిన్ అవ్వండి.'); });
      }
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) { var m = data && data.message; throw Object.assign(new Error(Array.isArray(m) ? m.join(', ') : (m || 'Error ' + res.status)), { status: res.status }); }
        return data;
      });
    }, function () { throw new Error('ఇంటర్నెట్ / సర్వర్ అందుబాటులో లేదు (No connection)'); });
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    msg('loginMsg', '');
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
    show('loginView', !t); show('appView', !!t); show('logout', !!t);
    $('who').textContent = t ? (t.name || '') : '';
    state.me = t;
    if (t) loadRefData().then(function () { resetEditor(); });
  }

  // ---------- reference data: categories + places ----------
  function loadRefData() {
    if (state.cats.length) return Promise.resolve();
    return Promise.all([call('GET', '/categories'), call('GET', '/locations')]).then(function (r) {
      state.cats = r[0].filter(function (c) { return !c.isVirtual; });
      var sel = $('category'); sel.innerHTML = '';
      sel.appendChild(h('option', { value: '', text: '— వర్గం ఎంచుకోండి —' }));
      state.cats.forEach(function (c) { sel.appendChild(h('option', { value: c.id, text: c.nameTe + ' (' + c.nameEn + ')' })); });
      var ap = r[1].filter(function (s) { return s.nameEn === 'Andhra Pradesh'; })[0] || r[1][0];
      return call('GET', '/locations?parentId=' + ap.id).then(function (ds) {
        state.ap = ap;
        state.districts = ds;
        var d = $('district'); d.innerHTML = '';
        d.appendChild(h('option', { value: ap.id, text: ap.nameTe + ' మొత్తం (All Andhra Pradesh)' }));
        ds.forEach(function (x) { d.appendChild(h('option', { value: x.id, text: x.nameTe + ' జిల్లా (' + x.nameEn + ')' })); });
      });
    }).catch(function (e) { msg('editorMsg', e.message); });
  }

  $('district').addEventListener('change', function () { state.picked = []; loadPlaces($('district').value); });
  function loadPlaces(districtId) {
    state.district = districtId;
    var box = $('places'); box.innerHTML = '';
    if (!districtId || districtId === (state.ap && state.ap.id)) return Promise.resolve();
    return call('GET', '/locations?parentId=' + districtId).then(function (list) {
      list.filter(function (x) { return x.type === 'MANDAL' || x.type === 'MUNICIPALITY'; }).forEach(function (x) {
        var b = h('button', { type: 'button', class: 'chip' + (state.picked.indexOf(x.id) >= 0 ? ' on' : ''), text: x.nameTe });
        b.addEventListener('click', function () {
          var i = state.picked.indexOf(x.id);
          if (i >= 0) state.picked.splice(i, 1); else state.picked.push(x.id);
          b.classList.toggle('on');
        });
        box.appendChild(b);
      });
    });
  }

  // ---------- word counters ----------
  function counter(src, out, unit) {
    var f = function () { var n = words($(src).value); $(out).textContent = n + ' / 100 ' + unit; $(out).classList.toggle('bad', n > 100); };
    $(src).addEventListener('input', f); return f;
  }
  var teCount = counter('teSummary', 'teCount', 'పదాలు');
  var enCount = counter('enSummary', 'enCount', 'words');

  // ---------- photo upload ----------
  $('photoInput').addEventListener('change', function () {
    var f = $('photoInput').files[0];
    if (!f) return;
    $('photoMsg').textContent = 'ఫోటో అప్‌లోడ్ అవుతోంది… (Uploading)';
    var fd = new FormData(); fd.append('file', f);
    call('POST', '/newsroom/media', fd).then(function (r) {
      setPhoto(r.url);
      $('photoMsg').textContent = '✔ ఫోటో సిద్ధం (' + Math.round(r.bytes / 1024) + ' KB)';
    }).catch(function (e) { $('photoMsg').textContent = '✖ ' + e.message; $('photoInput').value = ''; });
  });
  $('removePhoto').addEventListener('click', function () { setPhoto(null); $('photoInput').value = ''; $('photoMsg').textContent = ''; });
  function setPhoto(url) {
    state.photoUrl = url;
    show('photoPreview', !!url); show('creditWrap', !!url);
    if (url) $('photoPreview').src = url; else $('photoPreview').removeAttribute('src');
  }

  // ---------- editor ----------
  function resetEditor() {
    state.editingId = null; state.editingStatus = null; state.picked = [];
    $('editor').reset(); setPhoto(null); $('photoMsg').textContent = '';
    $('photoCredit').value = 'MAVY NEWS';
    $('editorTitle').textContent = 'కొత్త వార్త (New story)';
    $('publishBtn').textContent = 'ఇప్పుడే ప్రచురించండి';
    show('cancelEdit', false); show('saveDraft', true);
    if (state.ap) { $('district').value = state.ap.id; loadPlaces(state.ap.id); }
    teCount(); enCount(); msg('editorMsg', '');
  }
  $('cancelEdit').addEventListener('click', function () { resetEditor(); switchTab('list'); });

  function collect() {
    var te = { language: 'te', headline: $('teHeadline').value.trim(), summary: $('teSummary').value.trim(), body: $('teBody').value.trim() };
    if (!te.headline || !te.summary) throw new Error('హెడ్‌లైన్, సారాంశం తప్పనిసరి (Headline and short news are required)');
    if (words(te.summary) > 100) throw new Error('సారాంశం 100 పదాలు దాటింది (Short news is over 100 words)');
    if (!te.body) te.body = te.summary;
    var translations = [te];
    var en = { language: 'en', headline: $('enHeadline').value.trim(), summary: $('enSummary').value.trim(), body: $('enBody').value.trim() };
    if (en.headline || en.summary) {
      if (!en.headline || !en.summary) throw new Error('English: headline and short news are both needed');
      if (!en.body) en.body = en.summary;
      translations.push(en);
    }
    if (!$('category').value) throw new Error('వర్గం ఎంచుకోండి (Choose a category)');
    var locs = state.picked.length ? state.picked.slice() : [state.district || (state.ap && state.ap.id)];
    var body = {
      translations: translations,
      categoryId: $('category').value,
      locationIds: locs,
      isBreaking: $('breaking').checked,
      tags: $('tags').value.split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 15),
    };
    if (state.photoUrl) {
      if (!$('photoCredit').value.trim()) throw new Error('ఫోటో క్రెడిట్ రాయండి (Photo credit is required)');
      body.heroImageUrl = state.photoUrl; body.heroImageCredit = $('photoCredit').value.trim();
    }
    if ($('scheduledAt').value) body.scheduledAt = new Date($('scheduledAt').value).toISOString();
    return body;
  }

  // Moves a story forward until it is published, as far as this person's role allows.
  function publishFlow(id) {
    return call('GET', '/newsroom/articles/' + id).then(function (a) {
      var plan = { DRAFT: ['submit', 'start_review', 'approve', 'publish'], CHANGES_REQUESTED: ['submit', 'start_review', 'approve', 'publish'],
        SUBMITTED: ['start_review', 'approve', 'publish'], IN_REVIEW: ['approve', 'publish'], APPROVED: ['publish'] }[a.status] || [];
      var last = a;
      return plan.reduce(function (p, action) {
        return p.then(function (done) {
          if (done) return true;
          return call('POST', '/newsroom/articles/' + id + '/transition', { action: action })
            .then(function (r) { last = r; return false; })
            .catch(function (e) { if (e.status === 403) return true; throw e; }); // role cannot go further: stop here
        });
      }, Promise.resolve(false)).then(function () { return last; });
    });
  }

  function save(publish) {
    var body;
    try { body = collect(); } catch (e) { msg('editorMsg', e.message); return; }
    var btns = [$('publishBtn'), $('saveDraft')]; btns.forEach(function (b) { b.disabled = true; });
    msg('editorMsg', 'దయచేసి ఆగండి… (Please wait)', true);
    var p;
    if (state.editingId) {
      if (state.editingStatus === 'PUBLISHED') {
        var note = prompt('ఏమి సరిచేశారు? (What did you correct?) — పాఠకుల కోసం రికార్డ్ అవుతుంది');
        if (!note) { btns.forEach(function (b) { b.disabled = false; }); msg('editorMsg', 'మార్పు సేవ్ కాలేదు — సరిదిద్దిన కారణం అవసరం'); return; }
        body.correctionNote = note;
      }
      if (body.scheduledAt === undefined) body.scheduledAt = null;
      p = call('PATCH', '/newsroom/articles/' + state.editingId, body).then(function (a) { return publish ? publishFlow(a.id) : a; });
    } else {
      p = call('POST', '/newsroom/articles', body).then(function (a) { return publish ? publishFlow(a.id) : a; });
    }
    p.then(function (a) {
      var text = a.status === 'PUBLISHED' ? '✔ వార్త ప్రచురించబడింది! యాప్‌లో ఇప్పుడు కనిపిస్తుంది. (Published)'
        : a.status === 'SCHEDULED' ? '✔ షెడ్యూల్ అయింది — సమయానికి ప్రచురితం అవుతుంది (Scheduled)'
        : a.status === 'SUBMITTED' || a.status === 'IN_REVIEW' || a.status === 'APPROVED' ? '✔ ఎడిటర్ ఆమోదానికి పంపబడింది (Sent to editor)'
        : '✔ డ్రాఫ్ట్ సేవ్ అయింది (Draft saved)';
      resetEditor();
      msg('editorMsg', text, true);
      window.scrollTo(0, 0);
    }).catch(function (e) { msg('editorMsg', e.message); })
      .then(function () { btns.forEach(function (b) { b.disabled = false; }); });
  }
  $('editor').addEventListener('submit', function (e) { e.preventDefault(); save(true); });
  $('saveDraft').addEventListener('click', function () { save(false); });

  function edit(id) {
    call('GET', '/newsroom/articles/' + id).then(function (a) {
      resetEditor();
      state.editingId = a.id; state.editingStatus = a.status;
      var te = a.translations.filter(function (t) { return t.language === 'te'; })[0] || a.translations[0] || {};
      var en = a.translations.filter(function (t) { return t.language === 'en'; })[0];
      $('teHeadline').value = te.headline || ''; $('teSummary').value = te.summary || ''; $('teBody').value = te.body === te.summary ? '' : (te.body || '');
      if (en) { $('enHeadline').value = en.headline; $('enSummary').value = en.summary; $('enBody').value = en.body === en.summary ? '' : en.body; $('enBox').open = true; }
      $('category').value = a.categoryId;
      $('breaking').checked = a.isBreaking;
      $('tags').value = (a.tags || []).map(function (t) { return t.tag; }).join(', ');
      if (a.heroImageUrl) { setPhoto(a.heroImageUrl); $('photoCredit').value = a.heroImageCredit || ''; }
      // place: pick the district this story belongs to
      var locs = (a.locations || []).map(function (l) { return l.location; });
      var dist = state.districts.filter(function (d) { return locs.some(function (l) { return l.id === d.id || l.path.indexOf('/' + d.id + '/') >= 0; }); })[0];
      var did = dist ? dist.id : state.ap.id;
      $('district').value = did;
      state.picked = locs.filter(function (l) { return l.id !== did && l.id !== state.ap.id; }).map(function (l) { return l.id; });
      loadPlaces(did);
      teCount(); enCount();
      $('editorTitle').textContent = 'వార్త సవరణ (Edit story) — ' + (STATUS[a.status] || a.status);
      $('publishBtn').textContent = a.status === 'PUBLISHED' ? 'మార్పులు సేవ్ చేయండి' : 'ఇప్పుడే ప్రచురించండి';
      show('saveDraft', a.status !== 'PUBLISHED');
      show('cancelEdit', true);
      switchTab('new');
    }).catch(function (e) { msg('listMsg', e.message); });
  }

  // ---------- list ----------
  function loadList() {
    var box = $('list'); box.innerHTML = '';
    msg('listMsg', 'లోడ్ అవుతోంది…', true);
    var st = $('statusFilter').value;
    call('GET', '/newsroom/articles?limit=50' + (st ? '&status=' + st : '')).then(function (r) {
      msg('listMsg', r.total ? '' : 'వార్తలు లేవు (No stories)', true);
      r.items.forEach(function (a) {
        var te = a.translations.filter(function (t) { return t.language === 'te'; })[0] || a.translations[0] || {};
        var thumb = a.heroImageUrl ? h('img', { class: 'thumb', src: a.heroImageUrl, alt: '' }) : h('div', { class: 'thumb' });
        var actions = h('div', { class: 'actions' });
        actions.appendChild(h('button', { class: 'btn out small', type: 'button', text: '✎ సవరించు', onclick: function () { edit(a.id); } }));
        if (['DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'IN_REVIEW', 'APPROVED'].indexOf(a.status) >= 0)
          actions.appendChild(h('button', { class: 'btn small', type: 'button', text: 'ప్రచురించు', onclick: function () {
            publishFlow(a.id).then(function (x) { msg('listMsg', x.status === 'PUBLISHED' ? '✔ ప్రచురించబడింది' : '✔ ' + (STATUS[x.status] || x.status), true); loadList(); })
              .catch(function (e) { msg('listMsg', e.message); });
          } }));
        if (a.status === 'PUBLISHED') {
          actions.appendChild(h('a', { class: 'btn out small', href: '/n/' + a.slug, target: '_blank', rel: 'noopener', text: '👁 చూడు' }));
          actions.appendChild(h('button', { class: 'btn red small', type: 'button', text: 'తీసివేయి', onclick: function () {
            var why = prompt('ఈ వార్తను ఎందుకు తీసివేస్తున్నారు? (Reason for taking down)');
            if (!why) return;
            call('POST', '/newsroom/articles/' + a.id + '/transition', { action: 'archive', note: why })
              .then(function () { msg('listMsg', '✔ తీసివేయబడింది (Taken down)', true); loadList(); })
              .catch(function (e) { msg('listMsg', e.message); });
          } }));
        }
        if (['SUPER_ADMIN', 'MANAGING_EDITOR'].indexOf(state.me && state.me.role) >= 0 || ((a.status === 'DRAFT' || a.status === 'CHANGES_REQUESTED') && state.me && state.me.role !== 'DISTRICT_EDITOR') || (state.me && state.me.role === 'DISTRICT_EDITOR' && a.status !== 'PUBLISHED' && a.status !== 'SCHEDULED'))
          actions.appendChild(h('button', { class: 'btn red small', type: 'button', text: '🗑 తొలగించు', onclick: function () {
            if (!confirm('ఈ వార్తను శాశ్వతంగా తొలగించాలా? తిరిగి తీసుకురాలేము. (Delete for good?)\n\n' + (te.headline || ''))) return;
            call('DELETE', '/newsroom/articles/' + a.id).then(function () { msg('listMsg', '✔ తొలగించబడింది (Deleted)', true); loadList(); })
              .catch(function (e) { msg('listMsg', e.message); });
          } }));
        box.appendChild(h('div', { class: 'item' }, thumb, h('div', { style: 'flex:1;min-width:0' },
          h('h3', { text: (a.isBreaking ? '🔴 ' : '') + (te.headline || '') }),
          h('div', { class: 'meta' }, h('span', { class: 'badge ' + a.status, text: STATUS[a.status] || a.status }),
            (a.category ? a.category.nameTe + ' · ' : '') + ago(a.publishedAt || a.updatedAt) + (a.viewCount ? ' · 👁 ' + a.viewCount : '')),
          actions)));
      });
    }).catch(function (e) { msg('listMsg', e.message); });
  }
  $('statusFilter').addEventListener('change', loadList);
  $('refresh').addEventListener('click', loadList);

  // ---------- tabs ----------
  function switchTab(which) {
    $('tabNew').classList.toggle('on', which === 'new'); $('tabList').classList.toggle('on', which === 'list');
    show('editor', which === 'new'); show('listView', which === 'list');
    if (which === 'list') loadList();
    window.scrollTo(0, 0);
  }
  $('tabNew').addEventListener('click', function () { if (!state.editingId) resetEditor(); switchTab('new'); });
  $('tabList').addEventListener('click', function () { switchTab('list'); });

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
