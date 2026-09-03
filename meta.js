// Wrapper around the Meta Graph API calls this tool needs.
const GRAPH_VERSION = 'v21.0';

/**
 * Sends a private reply (real DM) to whoever left a comment on an
 * Instagram post/reel or a Facebook Page post.
 * Works identically for IG and FB once you have the right owner ID + token.
 *
 * @param {string} ownerId - the IG business account ID, or the Facebook Page ID
 * @param {string} commentId - the ID of the comment that matched a keyword
 * @param {string} message - the text to send (already built from the keyword group's links)
 * @param {string} accessToken - that Page's long-lived access token
 */
async function sendPrivateReply(ownerId, commentId, message, accessToken) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${ownerId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Meta private reply failed: ${JSON.stringify(data)}`);
  }
  return data;
}

module.exports = { sendPrivateReply };
