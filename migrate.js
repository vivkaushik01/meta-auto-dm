// Run once: `npm run migrate`
// Creates all tables needed for the multi-tenant auto-DM engine.
// Works against any Postgres (Neon, Supabase, Render Postgres, etc).

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SQL = `
-- One row per customer of your tool
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'trial', -- trial | active | past_due | canceled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A connected Meta account, created automatically by the OAuth "Connect" flow.
-- The user never sees or types a token - this row is filled in by oauth.js.
CREATE TABLE IF NOT EXISTS connected_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id TEXT,
  page_name TEXT,
  ig_business_id TEXT,
  ig_username TEXT,
  page_access_token TEXT NOT NULL,   -- fetched automatically during OAuth, long-lived
  token_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id)
);

-- A reusable named set of trigger words, managed once from the dashboard,
-- reusable across as many posts as you like.
CREATE TABLE IF NOT EXISTS keyword_groups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE CORE OBJECT: "this post" + "this product link(s)" + "this keyword group".
-- This is what the user actually creates day-to-day: paste a post URL, pick/create
-- a keyword group, paste the product link(s). Everything else is automatic.
CREATE TABLE IF NOT EXISTS post_campaigns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,             -- 'instagram' | 'facebook'
  post_url TEXT NOT NULL,             -- what the user pasted, e.g. instagram.com/p/XXXX
  platform_post_id TEXT NOT NULL,     -- resolved automatically from post_url, e.g. IG media ID
  keyword_group_id INTEGER NOT NULL REFERENCES keyword_groups(id),
  reply_mode TEXT NOT NULL DEFAULT 'all_links', -- all_links | random_link
  message_template TEXT NOT NULL DEFAULT 'Thanks for your interest! Here you go: {{links}}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_post_id)
);

-- Product link(s) for a given post campaign (e.g. Amazon link, plus a backup/coupon link)
CREATE TABLE IF NOT EXISTS campaign_links (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES post_campaigns(id) ON DELETE CASCADE,
  label TEXT,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Dedup log: never reply to the same comment twice, even across restarts/redeploys
CREATE TABLE IF NOT EXISTS processed_comments (
  comment_id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES post_campaigns(id),
  replied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_campaigns_platform_post ON post_campaigns(platform_post_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_ig ON connected_accounts(ig_business_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_page ON connected_accounts(page_id);
`;

pool.query(SQL)
  .then(() => { console.log('Migration complete.'); process.exit(0); })
  .catch(err => { console.error('Migration failed:', err); process.exit(1); });
