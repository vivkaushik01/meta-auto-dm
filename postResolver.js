// The user just pastes a post URL (e.g. https://www.instagram.com/p/Cxxxxx/,
// or a Facebook Reel like https://www.facebook.com/reel/1811057150050836).
// This finds the matching post/media ID via the Graph API - no manual IDs, ever.
const GRAPH_VERSION = 'v21.0';

/**
 * @param {'instagram'|'facebook'} platform
 * @param {string} accountId - ig_business_id or page_id
 * @param {string} accessToken
 * @param {string} postUrl - exactly what the user pasted
 * @returns {Promise<string>} the resolved platform post/media ID
 */
async function resolvePostId(platform, accountId, accessToken, postUrl) {
  const normalizedTarget = normalizeUrl(postUrl);

  // Some URL shapes encode the real ID directly - no search needed, just
  // confirm the ID actually resolves via the Graph API (and belongs to this token).
  const directId = extractDirectId(platform, postUrl);
  if (directId) {
    const verified = await verifyId(directId, accessToken);
    if (verified) return directId;
    // fall through to search if direct extraction pointed at something invalid
  }

  if (platform === 'instagram') {
    return findInPaginatedList(
      `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/media?fields=id,permalink&limit=50&access_token=${accessToken}`,
      normalizedTarget
    );
  }

  if (platform === 'facebook') {
    // Reels aren't returned by /posts - check /videos too, not just /posts.
    try {
      return await findInPaginatedList(
        `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/posts?fields=id,permalink_url&limit=50&access_token=${accessToken}`,
        normalizedTarget,
        'permalink_url'
      );
    } catch (err) {
      return await findInPaginatedList(
        `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/videos?fields=id,permalink_url&limit=50&access_token=${accessToken}`,
        normalizedTarget,
        'permalink_url'
      );
    }
  }

  throw new Error(`Unknown platform: ${platform}`);
}

// Extracts an ID straight from the URL for shapes where the ID is literally
// embedded in the path - fastest and most reliable path when available.
function extractDirectId(platform, postUrl) {
  if (platform === 'facebook') {
    // Reels: facebook.com/reel/1811057150050836
    let m = postUrl.match(/\/reel\/(\d+)/);
    if (m) return m[1];
    // Standard posts: facebook.com/{page}/posts/1234567890
    m = postUrl.match(/\/posts\/(\d+)/);
    if (m) return m[1];
    // Videos: facebook.com/{page}/videos/1234567890
    m = postUrl.match(/\/videos\/(\d+)/);
    if (m) return m[1];
    // story_fbid style links
    m = postUrl.match(/story_fbid=(\d+)/);
    if (m) return m[1];
  }
  return null;
}

// Confirms the directly-extracted ID is real and reachable with this token
// (also naturally rejects IDs belonging to a different page/account).
async function verifyId(id, accessToken) {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${id}?fields=id&access_token=${accessToken}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function findInPaginatedList(startUrl, normalizedTarget, permalinkField = 'permalink') {
  let url = startUrl;
  let pagesChecked = 0;
  const MAX_PAGES = 10; // safety cap - a matching post should be near the top anyway

  while (url && pagesChecked < MAX_PAGES) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(`Graph API error while resolving post: ${JSON.stringify(data)}`);

    for (const item of data.data || []) {
      if (normalizeUrl(item[permalinkField]) === normalizedTarget) {
        return item.id;
      }
    }

    url = data.paging && data.paging.next ? data.paging.next : null;
    pagesChecked++;
  }

  throw new Error('Could not find that post on the connected account. Double-check the URL, or make sure the post is recent enough to appear in the account\'s media list.');
}

function normalizeUrl(u) {
  if (!u) return '';
  return u.trim().replace(/\/+$/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
}

module.exports = { resolvePostId };