// Fill these in after you deploy the Apps Script backend and create
// (or reuse) a Google OAuth Client ID. See ../README.md.

const CONFIG = {
  // /u/0/ pins the request to the browser's primary signed-in Google
  // account slot. Without it, a browser with multiple Google accounts
  // signed in (and third-party cookies allowed for google.com) can get
  // rewritten to a different account slot (/u/1/, /u/2/, ...) that 404s
  // for this deployment - see README's auth section for the full story.
  // Slot 0 is usually a person's default/primary account, so this should
  // avoid the issue for most users without requiring any cookie setting.
  APPS_SCRIPT_URL: 'https://script.google.com/macros/u/0/s/AKfycbwV92sBuGbzGBCWVd-t4_SxvZmXe2gx3J62KKVWahNmJGIzJD66ed7M96-KUeMcgQwy/exec', // ends in /exec
  GOOGLE_CLIENT_ID: '660338742485-sqot6puo2hu94u2pja2golkb2l6iu44v.apps.googleusercontent.com'
};
