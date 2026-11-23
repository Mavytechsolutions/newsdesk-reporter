// One-time job: create the newsroom account for a phone number and publish a set of stories under it.
// Runs on the VPS (project "mavy-post-news"). Safe to run twice: stories with the same headline are skipped.
import { readFileSync } from 'fs';

const API = (process.env.API_URL || 'http://127.0.0.1:8474') + '/api/v1';
const FILE = process.env.NEWS_FILE;
const { ADMIN_EMAIL, ADMIN_PASSWORD, STAFF_EMAIL, STAFF_PASSWORD, STAFF_PHONE, STAFF_NAME } = process.env;

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data?.message ?? data)}`), { status: res.status });
  return data;
}

const admin = (await call('POST', '/auth/staff/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).accessToken;
console.log('✔ admin logged in');

// all places, indexed by slug
const bySlug = {};
async function walk(parentId) {
  const list = await call('GET', '/locations' + (parentId ? `?parentId=${parentId}` : ''));
  for (const l of list) { bySlug[l.slug] = l; if (['STATE', 'DISTRICT'].includes(l.type)) await walk(l.id); }
}
await walk();
const states = Object.values(bySlug).filter((l) => l.type === 'STATE').map((l) => l.id);

try {
  await call('POST', '/admin/staff', { email: STAFF_EMAIL, password: STAFF_PASSWORD, name: STAFF_NAME, role: 'REPORTER', designation: 'Reporter', phone: STAFF_PHONE, locationIds: states }, admin);
  console.log(`✔ newsroom account created for ${STAFF_PHONE}`);
} catch (e) {
  if (e.status !== 409) throw e;
  console.log('• newsroom account already exists');
}
const reporter = (await call('POST', '/auth/staff/login', { email: STAFF_EMAIL, password: STAFF_PASSWORD })).accessToken;

const cats = Object.fromEntries((await call('GET', '/categories')).map((c) => [c.slug, c.id]));
const existing = new Set((await call('GET', '/newsroom/articles?limit=100', undefined, admin)).items.flatMap((a) => a.translations.map((t) => t.headline)));

const stories = JSON.parse(readFileSync(FILE, 'utf8')).reverse(); // last one first, so the first story ends up on top
let n = 0;
for (const s of stories) {
  if (existing.has(s.te.headline)) { console.log('• skip (already there):', s.te.headline); continue; }
  const loc = bySlug[s.place];
  if (!loc) throw new Error('Unknown place ' + s.place);
  const a = await call('POST', '/newsroom/articles', {
    categoryId: cats[s.category], locationIds: [loc.id], tags: s.tags, sourceName: s.sourceName, sourceType: 'STAFF',
    translations: [{ language: 'te', ...s.te }, { language: 'en', ...s.en }],
  }, reporter);
  await call('POST', `/newsroom/articles/${a.id}/transition`, { action: 'submit' }, reporter);
  for (const action of ['start_review', 'approve', 'publish']) await call('POST', `/newsroom/articles/${a.id}/transition`, { action }, admin);
  n++;
  console.log('✔ published:', s.te.headline);
  await new Promise((r) => setTimeout(r, 1500)); // keep a natural order of publish times
}
console.log(`== DONE: ${n} stories published`);
