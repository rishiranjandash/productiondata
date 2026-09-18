// Fill these in after you deploy the Apps Script backend and create
// (or reuse) a Google OAuth Client ID. See ../README.md.

const CONFIG = {
  // Deliberately the BARE URL - no /u/N/ account-slot prefix. That was
  // tried as a mitigation and turned out actively harmful: /u/N/ routes
  // through Google Drive's own file-open logic (which requires the
  // requesting account to have direct Drive-level access to the script
  // file) instead of the Web App's dedicated "Anyone can execute"
  // routing. Symptom: a generic Google Drive "Sorry, unable to open the
  // file at this time" page. See README's auth section for the real
  // fix for the multi-account-browser issue this was trying to solve
  // (block third-party cookies for google.com), which doesn't need any
  // URL changes at all.
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwV92sBuGbzGBCWVd-t4_SxvZmXe2gx3J62KKVWahNmJGIzJD66ed7M96-KUeMcgQwy/exec', // ends in /exec
  GOOGLE_CLIENT_ID: '660338742485-sqot6puo2hu94u2pja2golkb2l6iu44v.apps.googleusercontent.com'
};
