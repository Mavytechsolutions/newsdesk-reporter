import { useSettings } from './store/settings';

const en = {
  appName: 'MAVY NEWS',
  home: 'Home', videos: 'Videos', explore: 'Explore', bookmarks: 'Saved', profile: 'Profile',
  chooseLanguage: 'Choose your language', continue: 'Continue', skip: 'Skip for now', done: 'Done',
  choosePlaces: 'Choose your places', choosePlacesHint: 'Pick your district and mandals to get local news first.',
  selected: 'selected', allPlaces: 'All places', mandalsSoon: 'Mandals for this district are coming soon. You can still pick the whole district.',
  readMore: 'Read full story', related: 'Related news', listen: 'Listen', stop: 'Stop', share: 'Share', whatsapp: 'WhatsApp',
  save: 'Save', saved: 'Saved', like: 'Like', by: 'By', source: 'Source', photo: 'Photo',
  breaking: 'BREAKING', citizen: 'Citizen report', updated: 'Updated',
  compact: 'List view', immersive: 'Full-screen view', alerts: 'Breaking alerts',
  errorTitle: 'Could not load news', offlineTitle: 'You are offline', retry: 'Try again',
  emptyFeed: 'No news here yet', emptyFeedHint: 'Pull down to refresh, or try another tab.',
  needsLocation: 'Choose your places to see local news', choosePlacesBtn: 'Choose places',
  searchPlaceholder: 'Search news, places, people…', recent: 'Recent searches', clear: 'Clear',
  noResults: 'No results', didYouMean: 'Did you mean', browsePlaces: 'News by place', browseTopics: 'Topics',
  savedEmpty: 'No saved stories', savedEmptyHint: 'Tap the bookmark on any story. Saved stories can be read without internet.',
  videosSoon: 'Video news is coming soon', videosSoonHint: 'Short video reports from your district will appear here.', readTop: 'Read top stories',
  login: 'Log in with mobile number', loginHint: 'Save stories across phones, like news and personalise your feed.',
  phone: 'Mobile number', sendOtp: 'Send OTP', enterOtp: 'Enter the OTP sent to', verify: 'Verify', resendIn: 'Resend in', resend: 'Resend OTP',
  language: 'Language', myPlaces: 'My places', myTopics: 'Topics I follow', theme: 'Appearance', themeSystem: 'Automatic', themeLight: 'Light', themeDark: 'Dark',
  history: 'Reading history', resetPersonal: 'Reset personalisation', resetConfirm: 'Clear your reading history and followed topics?',
  logout: 'Log out', deleteAccount: 'Delete my account', deleteConfirm: 'This permanently deletes your account and personal data. Continue?',
  cancel: 'Cancel', confirm: 'Yes, continue', loginRequired: 'Please log in to use this', name: 'Your name', saveBtn: 'Save', guest: 'Guest reader',
  historyEmpty: 'Stories you read will appear here.', version: 'Version',
  server: 'Server address', serverHint: 'For testing: your computer\'s Wi-Fi address, e.g. http://192.168.1.10:4000', serverOk: 'Connected ✓', testSave: 'Test & save', current: 'Now using',
  dislike: 'Dislike', comments: 'Comments', more: 'More', of: 'of', pages: 'stories',
  writeComment: 'Write a comment…', send: 'Send', noComments: 'No comments yet. Be the first!', deleteComment: 'Delete your comment?', loginToComment: 'Log in to comment',
  report: 'Report this story', reportTitle: 'What is wrong with this story?', reportNote: 'Details (optional)', reportSend: 'Send report',
  reportThanks: 'Thank you. Our editors will review this story.',
  rFAKE: 'Fake news', rWRONG_INFO: 'Wrong information', rOFFENSIVE: 'Offensive or hateful', rCOPYRIGHT: 'Copyright problem', rPRIVACY: 'Privacy problem', rOTHER: 'Other',
  openStory: 'Open full story', sendWa: 'Send',
  justNow: 'just now', minAgo: 'm ago', hrAgo: 'h ago', dayAgo: 'd ago',
};

const te: typeof en = {
  appName: 'MAVY NEWS',
  home: 'హోమ్', videos: 'వీడియోలు', explore: 'అన్వేషణ', bookmarks: 'సేవ్', profile: 'ప్రొఫైల్',
  chooseLanguage: 'మీ భాషను ఎంచుకోండి', continue: 'కొనసాగించండి', skip: 'తర్వాత చేస్తాను', done: 'పూర్తి',
  choosePlaces: 'మీ ప్రాంతాలను ఎంచుకోండి', choosePlacesHint: 'స్థానిక వార్తలు ముందుగా పొందడానికి మీ జిల్లా, మండలాలను ఎంచుకోండి.',
  selected: 'ఎంచుకున్నారు', allPlaces: 'అన్ని ప్రాంతాలు', mandalsSoon: 'ఈ జిల్లా మండలాలు త్వరలో వస్తాయి. ప్రస్తుతానికి జిల్లా మొత్తాన్ని ఎంచుకోవచ్చు.',
  readMore: 'పూర్తి వార్త చదవండి', related: 'సంబంధిత వార్తలు', listen: 'వినండి', stop: 'ఆపండి', share: 'షేర్', whatsapp: 'వాట్సాప్',
  save: 'సేవ్', saved: 'సేవ్ అయింది', like: 'లైక్', by: 'రిపోర్టర్', source: 'మూలం', photo: 'ఫోటో',
  breaking: 'బ్రేకింగ్', citizen: 'పౌర సమాచారం', updated: 'అప్‌డేట్',
  compact: 'జాబితా', immersive: 'పూర్తి స్క్రీన్', alerts: 'బ్రేకింగ్ అలర్ట్స్',
  errorTitle: 'వార్తలు లోడ్ కాలేదు', offlineTitle: 'ఇంటర్నెట్ లేదు', retry: 'మళ్లీ ప్రయత్నించండి',
  emptyFeed: 'ఇక్కడ ఇంకా వార్తలు లేవు', emptyFeedHint: 'రిఫ్రెష్ చేయడానికి కిందికి లాగండి లేదా మరో ట్యాబ్ చూడండి.',
  needsLocation: 'స్థానిక వార్తల కోసం మీ ప్రాంతాలను ఎంచుకోండి', choosePlacesBtn: 'ప్రాంతాలు ఎంచుకోండి',
  searchPlaceholder: 'వార్తలు, ప్రాంతాలు, వ్యక్తులు వెతకండి…', recent: 'ఇటీవలి శోధనలు', clear: 'తొలగించు',
  noResults: 'ఫలితాలు లేవు', didYouMean: 'మీ ఉద్దేశం', browsePlaces: 'ప్రాంతాల వారీగా వార్తలు', browseTopics: 'అంశాలు',
  savedEmpty: 'సేవ్ చేసిన వార్తలు లేవు', savedEmptyHint: 'ఏ వార్తలోనైనా బుక్‌మార్క్ నొక్కండి. సేవ్ చేసినవి ఇంటర్నెట్ లేకుండానే చదవవచ్చు.',
  videosSoon: 'వీడియో వార్తలు త్వరలో', videosSoonHint: 'మీ జిల్లా నుంచి చిన్న వీడియో వార్తలు ఇక్కడ కనిపిస్తాయి.', readTop: 'ముఖ్య వార్తలు చదవండి',
  login: 'మొబైల్ నంబర్‌తో లాగిన్', loginHint: 'వార్తలు సేవ్ చేయండి, లైక్ చేయండి, మీకు నచ్చిన వార్తలు పొందండి.',
  phone: 'మొబైల్ నంబర్', sendOtp: 'OTP పంపండి', enterOtp: 'ఈ నంబర్‌కు పంపిన OTP నమోదు చేయండి', verify: 'ధృవీకరించండి', resendIn: 'మళ్లీ పంపడానికి', resend: 'OTP మళ్లీ పంపండి',
  language: 'భాష', myPlaces: 'నా ప్రాంతాలు', myTopics: 'నేను అనుసరించే అంశాలు', theme: 'రూపం', themeSystem: 'ఆటోమేటిక్', themeLight: 'లైట్', themeDark: 'డార్క్',
  history: 'చదివిన చరిత్ర', resetPersonal: 'వ్యక్తిగతీకరణ రీసెట్', resetConfirm: 'మీ చదివిన చరిత్ర, అనుసరించే అంశాలు తొలగించాలా?',
  logout: 'లాగ్ అవుట్', deleteAccount: 'నా ఖాతాను తొలగించు', deleteConfirm: 'మీ ఖాతా, వ్యక్తిగత సమాచారం శాశ్వతంగా తొలగించబడతాయి. కొనసాగించాలా?',
  cancel: 'రద్దు', confirm: 'అవును', loginRequired: 'దీని కోసం లాగిన్ అవ్వండి', name: 'మీ పేరు', saveBtn: 'సేవ్', guest: 'అతిథి పాఠకుడు',
  historyEmpty: 'మీరు చదివిన వార్తలు ఇక్కడ కనిపిస్తాయి.', version: 'వెర్షన్',
  server: 'సర్వర్ చిరునామా', serverHint: 'పరీక్ష కోసం: మీ కంప్యూటర్ Wi-Fi చిరునామా, ఉదా. http://192.168.1.10:4000', serverOk: 'కనెక్ట్ అయింది ✓', testSave: 'పరీక్షించి సేవ్ చేయండి', current: 'ప్రస్తుతం',
  dislike: 'నచ్చలేదు', comments: 'వ్యాఖ్యలు', more: 'మరిన్ని', of: '/', pages: 'వార్తలు',
  writeComment: 'మీ వ్యాఖ్య రాయండి…', send: 'పంపండి', noComments: 'ఇంకా వ్యాఖ్యలు లేవు. మీరే మొదటివారు కండి!', deleteComment: 'మీ వ్యాఖ్యను తొలగించాలా?', loginToComment: 'వ్యాఖ్యానించడానికి లాగిన్ అవ్వండి',
  report: 'ఈ వార్తపై ఫిర్యాదు', reportTitle: 'ఈ వార్తలో సమస్య ఏమిటి?', reportNote: 'వివరాలు (ఐచ్ఛికం)', reportSend: 'ఫిర్యాదు పంపండి',
  reportThanks: 'ధన్యవాదాలు. మా ఎడిటర్లు ఈ వార్తను పరిశీలిస్తారు.',
  rFAKE: 'తప్పుడు వార్త', rWRONG_INFO: 'తప్పు సమాచారం', rOFFENSIVE: 'అభ్యంతరకరం / ద్వేషపూరితం', rCOPYRIGHT: 'కాపీరైట్ సమస్య', rPRIVACY: 'గోప్యత సమస్య', rOTHER: 'ఇతర',
  openStory: 'పూర్తి వార్త చూడండి', sendWa: 'పంపండి',
  justNow: 'ఇప్పుడే', minAgo: 'ని. క్రితం', hrAgo: 'గం. క్రితం', dayAgo: 'రో. క్రితం',
};

export type Strings = typeof en;

export function useT(): Strings {
  return useSettings((s) => s.language) === 'te' ? te : en;
}

export function useName() {
  const lang = useSettings((s) => s.language);
  return (x: { nameEn: string; nameTe: string }) => (lang === 'te' ? x.nameTe : x.nameEn);
}

export function timeAgo(iso: string, t: Strings) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t.justNow;
  if (mins < 60) return `${mins}${t.minAgo}`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}${t.hrAgo}`;
  return `${Math.round(h / 24)}${t.dayAgo}`;
}
