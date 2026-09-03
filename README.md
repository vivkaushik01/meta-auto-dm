# Auto-DM Engine (Instagram + Facebook)

The customer-facing flow this now supports:
**Click "Connect Instagram/Facebook" → paste a post URL → pick keywords → paste product link(s) → done.**
No one ever generates or sees a token.

## The one real bottleneck: Meta App Review

Until your Meta App passes App Review for `instagram_manage_messages`,
`instagram_manage_comments`, `pages_messaging`, and `pages_manage_engagement`,
**only accounts you've explicitly added as testers/admins in your Meta App
Dashboard can connect.** This is not a workaround-able limitation - it's how
Meta gates access to messaging permissions for every app, including the seller
tools you've seen. To sell this to strangers you'll need:
- A live privacy policy URL
- Business verification (Meta Business Manager, can take days)
- A screen recording demoing the exact "connect → comment → private reply" flow, submitted for review

Build and test everything below in Development Mode with your own account (and
a few friends' accounts added as testers) first - that fully works today,
App Review only gates *who else* can connect.

## 1. Database (free)

```
npm install
npm run migrate   # needs DATABASE_URL from neon.tech or supabase.com (free tier)
```

## 2. Meta App setup

1. developers.facebook.com/apps → Create App → "Business" type.
2. Add products: **Facebook Login for Business**, **Instagram**, **Webhooks**.
3. Facebook Login settings → add your Valid OAuth Redirect URI
   (`https://your-service.onrender.com/auth/facebook/callback`).
4. Webhooks → subscribe your Page/Instagram object to the `comments` field,
   callback URL `https://your-service.onrender.com/webhook`, verify token =
   whatever you set as `META_VERIFY_TOKEN`.
5. Copy App ID + App Secret into `.env`.

## 3. Connect an account (no manual tokens)

Send whoever's connecting (you, first) to:
```
https://your-service.onrender.com/auth/facebook/start?user_id=1
```
They click through Facebook's normal consent screen. On success, their Page(s)
and linked Instagram account are saved automatically to `connected_accounts`.
`user_id=1` should be replaced with your real logged-in user's ID once you
have login/signup on the dashboard (not built yet - see Phase 3 below).

## 4. Create a keyword group (once, reusable across posts)

```sql
INSERT INTO users (email) VALUES ('you@example.com') RETURNING id;

INSERT INTO keyword_groups (user_id, name, keywords)
VALUES (1, 'PRICE', ARRAY['price','cost','how much'])
RETURNING id;
```

## 5. Link a post to a product - the core action

```bash
curl -X POST https://meta-auto-dm-nz5v.onrender.com/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "account_id": 1,
    "post_url": "https://www.facebook.com/reel/1811057150050836",
    "keyword_group_id": 1,
    "links": [{ "label": "Buy on Amazon", "url": "https://link.amazon/B0hSDLae1" }],
    "reply_mode": "all_links",
    "message_template": "Thanks for asking! Here you go: {{links}}"
  }'
```

The server finds that exact post on the connected account, resolves its real
Graph API ID automatically, and wires it up. From now on, any comment with
"price", "cost", or "how much" on *that specific post* gets an instant private
reply with the Amazon link. Other posts on the same account are untouched
unless you create a campaign for them too.

## 6. Deploy to Render (free) + keep it awake

Same as before: New Web Service → connect repo → `npm install` / `npm start` →
add env vars → deploy. Add a free https://cron-job.org ping every 10 min so
the free tier doesn't sleep.

## Platform limits (Meta's rules, not this tool's)

- One private-reply message per commenter, sendable within 7 days of the comment.
- Threads has no private-message API yet, only public comment replies.

## Phase 3 (not built yet, happy to build next)

- Login/signup + session so `user_id` comes from a real logged-in account
- Dashboard UI (React) wrapping steps 3-5 as forms instead of curl/SQL
- Stripe subscription billing gating campaign creation
- Automatic long-lived token refresh job (tokens are valid ~60 days while active)
