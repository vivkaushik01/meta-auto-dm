// Implements "Login with Facebook" so a normal user just clicks Connect and
// approves permissions. We do the token exchange behind the scenes and store
// the result - the user never sees a token.
const express = require('express');
const db = require('./db');

const router = express.Router();
const GRAPH_VERSION = 'v21.0';

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = process.env.META_OAUTH_REDIRECT_URI; // e.g. https://yourapp.onrender.com/auth/facebook/callback

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_engagement',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'business_management'
].join(',');

// Step 1: send the user to Facebook's consent screen.
// `state` should be your logged-in user's session/user id so the callback
// knows which of your customers is connecting.
router.get('/auth/facebook/start', (req, res) => {
  const userId = req.query.user_id; // pass this from your dashboard session
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: userId,
    response_type: 'code'
  });
  res.redirect(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`);
});

// Step 2: Facebook redirects back here with a `code`. We exchange it for
// tokens and pull the user's Pages + linked Instagram accounts automatically.
router.get('/auth/facebook/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.status(400).send('Missing code from Facebook.');

  try {
    // Exchange code -> short-lived user token
    const tokenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({ client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code })
    );
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(tokenData));
    const shortLivedToken = tokenData.access_token;

    // Exchange short-lived -> long-lived user token (~60 days, auto-refreshable
    // in the background later; not something the end user ever has to touch)
    const longRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken
      })
    );
    const longData = await longRes.json();
    if (!longRes.ok) throw new Error(JSON.stringify(longData));
    const longLivedUserToken = longData.access_token;

    // Fetch every Page this user manages, with a ready-to-use Page token for each
    const pagesRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?` +
      new URLSearchParams({ access_token: longLivedUserToken, fields: 'id,name,access_token,instagram_business_account{id,username}' })
    );
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok) throw new Error(JSON.stringify(pagesData));

    for (const page of pagesData.data) {
      await db.query(
        `INSERT INTO connected_accounts (user_id, page_id, page_name, ig_business_id, ig_username, page_access_token)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (page_id) DO UPDATE SET
           page_access_token = EXCLUDED.page_access_token,
           ig_business_id = EXCLUDED.ig_business_id,
           ig_username = EXCLUDED.ig_username,
           token_obtained_at = now()`,
        [
          userId,
          page.id,
          page.name,
          page.instagram_business_account ? page.instagram_business_account.id : null,
          page.instagram_business_account ? page.instagram_business_account.username : null,
          page.access_token // Page tokens don't expire while the user token is valid
        ]
      );

      // Tell Meta to actually start sending this Page's events to our app.
      // Without this call, the webhook subscription in the App Dashboard has
      // nothing to deliver - each individual Page has to opt in separately.
      // Note: 'feed' is the only valid value here - it's the topic that carries
      // comment events. Which specific sub-events (comments) get delivered is
      // controlled by the field checkboxes in the App Dashboard's Webhooks screen.
      try {
        const subRes = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/subscribed_apps?subscribed_fields=feed&access_token=${page.access_token}`,
          { method: 'POST' }
        );
        const subData = await subRes.json();
        if (!subRes.ok) console.error(`Failed to subscribe page ${page.id} to webhooks:`, subData);
        else console.log(`Page ${page.id} (${page.name}) subscribed to webhooks.`);
      } catch (err) {
        console.error(`Error subscribing page ${page.id} to webhooks:`, err);
      }
    }

    // Redirect back into your dashboard - the account is now connected, no
    // token ever shown to the user.
    res.redirect('/dashboard?connected=1');
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.status(500).send('Could not complete the connection. Please try again.');
  }
});

module.exports = router;