// This is the endpoint your future dashboard's "Create" button calls.
// The user experience is exactly: paste post URL, pick/create a keyword group,
// paste product link(s), click Save. Everything else - resolving the post ID,
// wiring up the webhook match - happens automatically.
const express = require('express');
const db = require('./db');
const { resolvePostId } = require('./postResolver');

const router = express.Router();

router.post('/api/campaigns', async (req, res) => {
  const { user_id, account_id, post_url, keyword_group_id, links, reply_mode, message_template } = req.body;

  if (!user_id || !account_id || !post_url || !keyword_group_id || !links || links.length === 0) {
    return res.status(400).json({ error: 'user_id, account_id, post_url, keyword_group_id, and at least one link are required.' });
  }

  try {
    const acctRes = await db.query('SELECT * FROM connected_accounts WHERE id = $1 AND user_id = $2', [account_id, user_id]);
    if (acctRes.rowCount === 0) return res.status(404).json({ error: 'Connected account not found.' });
    const account = acctRes.rows[0];

    const platform = post_url.includes('instagram.com') ? 'instagram' : 'facebook';
    const graphAccountId = platform === 'instagram' ? account.ig_business_id : account.page_id;
    if (!graphAccountId) {
      return res.status(400).json({ error: `This connected account has no linked ${platform} account.` });
    }

    const platformPostId = await resolvePostId(platform, graphAccountId, account.page_access_token, post_url);

    const campaignRes = await db.query(
      `INSERT INTO post_campaigns (user_id, account_id, platform, post_url, platform_post_id, keyword_group_id, reply_mode, message_template)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (platform_post_id) DO UPDATE SET
         keyword_group_id = EXCLUDED.keyword_group_id,
         reply_mode = EXCLUDED.reply_mode,
         message_template = EXCLUDED.message_template,
         is_active = true
       RETURNING id`,
      [user_id, account_id, platform, post_url, platformPostId, keyword_group_id,
       reply_mode || 'all_links', message_template || 'Thanks for your interest! Here you go: {{links}}']
    );
    const campaignId = campaignRes.rows[0].id;

    // Replace links for this campaign
    await db.query('DELETE FROM campaign_links WHERE campaign_id = $1', [campaignId]);
    for (let i = 0; i < links.length; i++) {
      await db.query(
        'INSERT INTO campaign_links (campaign_id, label, url, sort_order) VALUES ($1,$2,$3,$4)',
        [campaignId, links[i].label || null, links[i].url, i]
      );
    }

    res.json({ success: true, campaign_id: campaignId, platform_post_id: platformPostId });
  } catch (err) {
    console.error('Failed to create campaign:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
