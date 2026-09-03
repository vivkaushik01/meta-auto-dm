// The user just pastes a post URL (e.g. https://www.instagram.com/p/Cxxxxx/).
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

  if (platform === 'instagram') {
    return findInPaginatedList(
      `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/media?fields=id,permalink&limit=50&access_token=${accessToken}`,
      normalizedTarget
    );
  }

  if (platform === 'facebook') {
    return findInPaginatedList(
      `https://graph.facebook.com/${GRAPH_VERSION}/${accountId}/posts?fields=id,permalink_url&limit=50&access_token=${accessToken}`,
      normalizedTarget,
      'permalink_url'
    );
  }

  throw new Error(`Unknown platform: ${platform}`);
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