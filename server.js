require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { sendPrivateReply } = require('./meta');
const { buildMessage } = require('./matcher');
const oauthRoutes = require('./oauth');
const campaignRoutes = require('./campaigns');

const app = express();

// Capture the raw body so we can verify Meta's signature before parsing JSON.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.use(oauthRoutes);
app.use(campaignRoutes);

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN; // you pick this string, entered in the Meta App Dashboard
const APP_SECRET = process.env.META_APP_SECRET;      // from the Meta App Dashboard

// --- 1. Webhook verification handshake (Meta calls this once when you set the webhook URL) ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2. Signature check so random requests can't fake comment events ---
function isValidSignature(req) {
  const signature = req.get('x-hub-signature-256');
  if (!signature || !APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// --- 3. The actual event handler ---
app.post('/webhook', async (req, res) => {
  // Always ack fast; Meta retries aggressively if you're slow/silent.
  res.sendStatus(200);

  if (!isValidSignature(req)) {
    console.warn('Rejected webhook: bad signature');
    return;
  }

  try {
    const body = req.body;
    for (const entry of body.entry || []) {
      const ownerId = entry.id; // Page ID (FB) or IG business account ID
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'comments') continue;
        await handleComment(ownerId, change.value);
      }
    }
  } catch (err) {
    console.error('Error handling webhook payload:', err);
  }
});

async function handleComment(ownerId, value) {
  const commentId = value.comment_id || value.id;
  const commentText = value.text || value.message || '';
  // Which specific post this comment belongs to - Meta includes this on the payload
  const mediaId = value.media ? value.media.id : (value.post_id || value.media_id);
  if (!commentId || !commentText || !mediaId) return;

  // Skip comments made by the account owner itself (replies to customers, etc.)
  if (value.from && value.from.id === ownerId) return;

  // Already handled? (dedup survives restarts because it's in Postgres)
  const already = await db.query('SELECT 1 FROM processed_comments WHERE comment_id = $1', [commentId]);
  if (already.rowCount > 0) return;

  // Is this a post the user has actually set up a campaign for? Most comments
  // on the account (on posts with no campaign) are correctly ignored here.
  const campaignRes = await db.query(
    `SELECT pc.*, kg.keywords, ca.page_access_token, ca.user_id
     FROM post_campaigns pc
     JOIN keyword_groups kg ON kg.id = pc.keyword_group_id
     JOIN connected_accounts ca ON ca.id = pc.account_id
     WHERE pc.platform_post_id = $1 AND pc.is_active = true`,
    [mediaId]
  );
  if (campaignRes.rowCount === 0) return;
  const campaign = campaignRes.rows[0];

  const matches = campaign.keywords.some(kw => {
    const pattern = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(commentText);
  });
  if (!matches) return;

  const linksRes = await db.query(
    `SELECT * FROM campaign_links WHERE campaign_id = $1 ORDER BY sort_order ASC`,
    [campaign.id]
  );
  if (linksRes.rowCount === 0) return;

  const message = buildMessage(campaign, linksRes.rows);

  try {
    await sendPrivateReply(ownerId, commentId, message, campaign.page_access_token);
    await db.query(
      `INSERT INTO processed_comments (comment_id, user_id, campaign_id) VALUES ($1, $2, $3)
       ON CONFLICT (comment_id) DO NOTHING`,
      [commentId, campaign.user_id, campaign.id]
    );
    console.log(`Replied to comment ${commentId} on post ${mediaId}`);
  } catch (err) {
    console.error(`Failed to send reply for comment ${commentId}:`, err.message);
    // Not marking as processed on failure, so a future retry can pick it up.
  }
}

// ============================================================================
// HEALTH CHECK — hit by the self-ping loop below (and/or an external monitor
// like UptimeRobot) so the free-tier instance never gets a chance to sleep.
// ============================================================================
app.get("/health", (req, res) => res.status(200).send("OK"));

app.get('/', (_req, res) => res.send('Auto-DM engine is running.'));

if (process.env.RENDER_EXTERNAL_URL) {
  const PING_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/health`)
      .then(() => console.log("[keep-alive] ping ok"))
      .catch((err) => console.error("[keep-alive] ping failed:", err.message));
  }, PING_INTERVAL_MS);
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook engine listening on port ${PORT}`));
