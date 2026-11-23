/**
 * Seeds reference data (locations, categories) and the first Super Admin.
 * Safe to run many times. Run with: npm run db:seed
 *
 * Location list is a DEVELOPMENT starting set for Anantapur and Sri Sathya Sai districts.
 * The newsroom should verify mandal / constituency mapping before launch and add villages & wards.
 * Sample stories are created only outside production and are clearly marked [SAMPLE].
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import * as s from './schema';
import { config } from '../config';

type LT = (typeof s.locationTypeEnum.enumValues)[number];
interface Node { en: string; te: string; type: LT; children?: Node[] }

const muni = (en: string, te: string, corp = false): Node => ({
  en: corp ? `${en} Municipal Corporation` : `${en} Municipality`,
  te: corp ? `${te} నగరపాలక సంస్థ` : `${te} పురపాలక సంఘం`,
  type: 'MUNICIPALITY',
});
const mandal = (en: string, te: string): Node => ({ en, te, type: 'MANDAL' });
const ac = (en: string, te: string): Node => ({ en, te, type: 'ASSEMBLY_CONSTITUENCY' });

const TREE: Node[] = [
  {
    en: 'Andhra Pradesh', te: 'ఆంధ్రప్రదేశ్', type: 'STATE', children: [
      {
        en: 'Anantapur', te: 'అనంతపురం', type: 'DISTRICT', children: [
          {
            en: 'Anantapur Lok Sabha', te: 'అనంతపురం లోక్‌సభ', type: 'PARLIAMENTARY_CONSTITUENCY', children: [
              ac('Rayadurg', 'రాయదుర్గం'), ac('Uravakonda', 'ఉరవకొండ'), ac('Guntakal', 'గుంతకల్లు'), ac('Tadipatri', 'తాడిపత్రి'),
              ac('Singanamala', 'శింగనమల'), ac('Anantapur Urban', 'అనంతపురం అర్బన్'), ac('Kalyandurg', 'కళ్యాణదుర్గం'),
            ],
          },
          {
            ...muni('Anantapur', 'అనంతపురం', true), children: [
              { en: 'Anantapur Ward 1', te: 'అనంతపురం వార్డు 1', type: 'WARD' },
              { en: 'Anantapur Ward 2', te: 'అనంతపురం వార్డు 2', type: 'WARD' },
            ],
          },
          muni('Guntakal', 'గుంతకల్లు'), muni('Tadipatri', 'తాడిపత్రి'), muni('Gooty', 'గుత్తి'),
          muni('Rayadurg', 'రాయదుర్గం'), muni('Kalyandurg', 'కళ్యాణదుర్గం'), muni('Pamidi', 'పామిడి'),
          mandal('Anantapur Urban', 'అనంతపురం అర్బన్'), mandal('Anantapur Rural', 'అనంతపురం రూరల్'), mandal('Raptadu', 'రాప్తాడు'),
          mandal('Atmakur', 'ఆత్మకూరు'), mandal('Bukkarayasamudram', 'బుక్కరాయసముద్రం'), mandal('Garladinne', 'గార్లదిన్నె'),
          mandal('Singanamala', 'శింగనమల'), mandal('Narpala', 'నార్పల'), mandal('Tadipatri', 'తాడిపత్రి'),
          mandal('Guntakal', 'గుంతకల్లు'), mandal('Gooty', 'గుత్తి'), mandal('Pamidi', 'పామిడి'),
          mandal('Uravakonda', 'ఉరవకొండ'), mandal('Vajrakarur', 'వజ్రకరూరు'), mandal('Rayadurg', 'రాయదుర్గం'),
          mandal('Kalyandurg', 'కళ్యాణదుర్గం'), mandal('Kambadur', 'కంబదూరు'), mandal('Kanekal', 'కణేకల్లు'),
          mandal('Bommanahal', 'బొమ్మనహాళ్'), mandal('Beluguppa', 'బెలుగుప్ప'), mandal('Kudair', 'కూడేరు'),
          mandal('Peddavadugur', 'పెద్దవడుగూరు'), mandal('Yadiki', 'యాడికి'), mandal('Putlur', 'పుట్లూరు'), mandal('Yellanur', 'యల్లనూరు'),
        ],
      },
      {
        en: 'Sri Sathya Sai', te: 'శ్రీ సత్యసాయి', type: 'DISTRICT', children: [
          {
            en: 'Hindupur Lok Sabha', te: 'హిందూపురం లోక్‌సభ', type: 'PARLIAMENTARY_CONSTITUENCY', children: [
              ac('Raptadu', 'రాప్తాడు'), ac('Madakasira', 'మడకశిర'), ac('Hindupur', 'హిందూపురం'), ac('Penukonda', 'పెనుకొండ'),
              ac('Puttaparthi', 'పుట్టపర్తి'), ac('Dharmavaram', 'ధర్మవరం'), ac('Kadiri', 'కదిరి'),
            ],
          },
          muni('Hindupur', 'హిందూపురం'), muni('Kadiri', 'కదిరి'), muni('Dharmavaram', 'ధర్మవరం'),
          muni('Puttaparthi', 'పుట్టపర్తి'), muni('Madakasira', 'మడకశిర'),
          mandal('Puttaparthi', 'పుట్టపర్తి'), mandal('Bukkapatnam', 'బుక్కపట్నం'), mandal('Kothacheruvu', 'కొత్తచెరువు'),
          mandal('Dharmavaram', 'ధర్మవరం'), mandal('Bathalapalli', 'బత్తలపల్లి'), mandal('Tadimarri', 'తాడిమర్రి'),
          mandal('Kadiri', 'కదిరి'), mandal('Nallacheruvu', 'నల్లచెరువు'), mandal('Talupula', 'తలుపుల'),
          mandal('Hindupur', 'హిందూపురం'), mandal('Lepakshi', 'లేపాక్షి'), mandal('Chilamathur', 'చిలమత్తూరు'),
          mandal('Penukonda', 'పెనుకొండ'), mandal('Somandepalle', 'సోమందేపల్లి'), mandal('Roddam', 'రొద్దం'),
          mandal('Madakasira', 'మడకశిర'), mandal('Agali', 'అగళి'), mandal('Rolla', 'రొళ్ల'), mandal('Gudibanda', 'గుడిబండ'),
          mandal('Amarapuram', 'అమరాపురం'), mandal('Gorantla', 'గోరంట్ల'), mandal('Mudigubba', 'ముదిగుబ్బ'),
          mandal('Nallamada', 'నల్లమాడ'), mandal('Obuladevaracheruvu', 'ఓబుళదేవరచెరువు'), mandal('Tanakal', 'తనకల్లు'),
          mandal('Gandlapenta', 'గాండ్లపెంట'), mandal('Amadagur', 'అమడగూరు'), mandal('Parigi', 'పరిగి'),
          mandal('Ramagiri', 'రామగిరి'), mandal('Kanaganapalle', 'కనగానపల్లి'), mandal('Chennekothapalle', 'చెన్నేకొత్తపల్లి'),
        ],
      },
    ],
  },
  { en: 'Telangana', te: 'తెలంగాణ', type: 'STATE', children: [{ en: 'Hyderabad', te: 'హైదరాబాద్', type: 'DISTRICT' }] },
];

const CATEGORIES: [string, string, string, boolean][] = [
  ['for-you', 'For You', 'మీ కోసం', true],
  ['breaking', 'Breaking', 'బ్రేకింగ్', true],
  ['andhra-pradesh', 'Andhra Pradesh', 'ఆంధ్రప్రదేశ్', false],
  ['telangana', 'Telangana', 'తెలంగాణ', false],
  ['national', 'National', 'జాతీయం', false],
  ['international', 'International', 'అంతర్జాతీయం', false],
  ['politics', 'Politics', 'రాజకీయాలు', false],
  ['crime', 'Crime', 'క్రైమ్', false],
  ['business', 'Business', 'వ్యాపారం', false],
  ['technology', 'Technology', 'టెక్నాలజీ', false],
  ['sports', 'Sports', 'క్రీడలు', false],
  ['entertainment', 'Entertainment', 'వినోదం', false],
  ['health', 'Health', 'ఆరోగ్యం', false],
  ['education', 'Education', 'విద్య', false],
  ['agriculture', 'Agriculture', 'వ్యవసాయం', false],
  ['local', 'Local News', 'స్థానిక వార్తలు', true],
];

const PREFIX: Record<LT, string> = {
  STATE: '', DISTRICT: 'dist-', PARLIAMENTARY_CONSTITUENCY: 'pc-', ASSEMBLY_CONSTITUENCY: 'ac-',
  MUNICIPALITY: 'muni-', MANDAL: 'mandal-', VILLAGE: 'village-', WARD: 'ward-',
};
const kebab = (x: string) => x.toLowerCase().replace(/ (municipality|municipal corporation|lok sabha)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
/** e.g. "mandal-anantapur-rural--anantapur", "dist-sri-sathya-sai" */
const slugFor = (n: Node, district?: string) =>
  `${PREFIX[n.type]}${kebab(n.en)}${district && n.type !== 'DISTRICT' && n.type !== 'STATE' ? `--${district}` : ''}`;

export async function seed(db = drizzle(new Pool({ connectionString: config.databaseUrl }), { schema: s }), opts = { samples: config.env !== 'production' }) {
  const ids: Record<string, string> = {};

  async function insertNode(n: Node, parent?: { id: string; path: string }, district?: string) {
    const slug = slugFor(n, district);
    if (n.type === 'DISTRICT') district = kebab(n.en);
    let [row] = await db.select().from(s.locations).where(eq(s.locations.slug, slug));
    if (!row) {
      [row] = await db.insert(s.locations).values({ type: n.type, nameEn: n.en, nameTe: n.te, slug, parentId: parent?.id ?? null, path: 'tmp' }).returning();
      const path = `${parent?.path ?? '/'}${row.id}/`;
      await db.update(s.locations).set({ path }).where(eq(s.locations.id, row.id));
      row.path = path;
    }
    ids[slug] = row.id;
    for (const c of n.children ?? []) await insertNode(c, { id: row.id, path: row.path }, district);
  }
  for (const n of TREE) await insertNode(n);
  console.log(`✔ Locations: ${Object.keys(ids).length}`);

  for (const [i, [slug, en, te, isVirtual]] of CATEGORIES.entries())
    await db.insert(s.categories).values({ slug, nameEn: en, nameTe: te, isVirtual, sortOrder: i }).onConflictDoNothing({ target: s.categories.slug });
  console.log(`✔ Categories: ${CATEGORIES.length}`);

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@mavynews.in').toLowerCase();
  const pw = process.env.SEED_ADMIN_PASSWORD;
  let [admin] = await db.select().from(s.users).where(eq(s.users.email, email));
  if (!admin) {
    if (!pw) throw new Error('Set SEED_ADMIN_PASSWORD in .env');
    [admin] = await db.insert(s.users).values({ email, name: 'MAVY Super Admin', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(pw, 12) }).returning();
    await db.insert(s.staffProfiles).values({ userId: admin.id, designation: 'Super Admin', verified: true });
    console.log(`✔ Super Admin created: ${email}`);
  } else console.log(`✔ Super Admin already exists: ${email}`);

  if (opts.samples) {
    const [existing] = await db.select({ id: s.articles.id }).from(s.articles).limit(1);
    if (!existing) {
      const cat = async (slug: string) => (await db.select().from(s.categories).where(eq(s.categories.slug, slug)))[0].id;
      const samples = [
        { cat: 'agriculture', loc: 'mandal-anantapur-rural--anantapur', te: ['[నమూనా] అనంతపురం రూరల్‌లో వేరుశనగ రైతులకు అవగాహన సదస్సు', 'ఇది పరీక్ష కోసం రూపొందించిన నమూనా వార్త. వేరుశనగ సాగులో నీటి పొదుపు పద్ధతులపై వ్యవసాయ అధికారులు రైతులకు అవగాహన కల్పించారు.'], en: ['[SAMPLE] Groundnut farmers attend awareness meeting in Anantapur Rural', 'This is a sample story for testing. Agriculture officials explained water-saving methods for groundnut cultivation to farmers.'] },
        { cat: 'education', loc: 'muni-puttaparthi--sri-sathya-sai', te: ['[నమూనా] పుట్టపర్తిలో విద్యార్థులకు సైన్స్ ప్రదర్శన', 'ఇది పరీక్ష కోసం రూపొందించిన నమూనా వార్త. పాఠశాల విద్యార్థులు తమ సైన్స్ ప్రాజెక్టులను ప్రదర్శించారు.'], en: ['[SAMPLE] Students showcase science projects in Puttaparthi', 'This is a sample story for testing. School students displayed their science projects at a local exhibition.'] },
        { cat: 'health', loc: 'muni-hindupur--sri-sathya-sai', te: ['[నమూనా] హిందూపురంలో ఉచిత ఆరోగ్య శిబిరం', 'ఇది పరీక్ష కోసం రూపొందించిన నమూనా వార్త. ఉచిత ఆరోగ్య శిబిరంలో వైద్యులు ప్రజలకు పరీక్షలు నిర్వహించారు.'], en: ['[SAMPLE] Free health camp held in Hindupur', 'This is a sample story for testing. Doctors conducted free check-ups for residents at a health camp.'] },
      ];
      await db.transaction(async (tx) => { for (const [i, x] of samples.entries()) {
        const [a] = await tx.insert(s.articles).values({
          slug: `sample-${i + 1}`, status: 'PUBLISHED', authorId: admin.id, categoryId: await cat(x.cat),
          publishedAt: new Date(Date.now() - i * 3600_000), isBreaking: i === 0,
        }).returning();
        await tx.insert(s.articleTranslations).values([
          { articleId: a.id, language: 'te', headline: x.te[0], summary: x.te[1], body: `${x.te[1]}\n\n(పరీక్ష కోసం మాత్రమే)` },
          { articleId: a.id, language: 'en', headline: x.en[0], summary: x.en[1], body: `${x.en[1]}\n\n(For testing only)` },
        ]);
        if (!ids[x.loc]) throw new Error(`Unknown sample location ${x.loc}`);
        await tx.insert(s.articleLocations).values({ articleId: a.id, locationId: ids[x.loc] });
      } });
      console.log('✔ 3 [SAMPLE] stories added (development only)');
    }
  }
  return { ids, adminId: admin.id };
}

if (require.main === module) {
  seed().then(() => process.exit(0)).catch((e) => { console.error('✖ Seed failed:', e.message); process.exit(1); });
}
