/**
 * Given a comment's text and a list of the account owner's active keyword
 * groups, returns the first matching group (or null).
 * Match = whole-word, case-insensitive, so "cost" won't match inside "costume".
 */
function findMatchingGroup(commentText, keywordGroups) {
  const text = (commentText || '').toLowerCase();
  for (const group of keywordGroups) {
    for (const kw of group.keywords) {
      const pattern = new RegExp(`\\b${escapeRegex(kw.toLowerCase())}\\b`, 'i');
      if (pattern.test(text)) return group;
    }
  }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the actual reply text from a matched group's template + links.
 * reply_mode 'all_links' -> lists every link
 * reply_mode 'random_link' -> picks one at random (useful for A/B testing offers)
 */
function buildMessage(group, links) {
  let linkText;
  if (group.reply_mode === 'random_link' && links.length > 0) {
    const pick = links[Math.floor(Math.random() * links.length)];
    linkText = pick.url;
  } else {
    linkText = links.map(l => (l.label ? `${l.label}: ${l.url}` : l.url)).join('\n');
  }
  return group.message_template.replace('{{links}}', linkText);
}

module.exports = { findMatchingGroup, buildMessage };
