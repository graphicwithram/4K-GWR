function instagramTarget(input, mode = 'auto') {
  const query = String(input || '').trim();
  if (!query || query.length > 500) throw new Error('Enter an Instagram username, hashtag, location, or post URL.');
  if (!['auto', 'account', 'hashtag', 'location'].includes(mode)) throw new Error('Choose an Instagram search type.');
  if (/^https?:/i.test(query)) {
    const url = new URL(query);
    if (!['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password) throw new Error('Use an instagram.com URL.');
    url.protocol = 'https:'; url.search = ''; url.hash = '';
    return { kind: /^\/(p|reel|reels)\//.test(url.pathname) ? 'post' : 'link', query, label: url.pathname.replace(/^\//, ''), url: url.href };
  }
  const kind = mode === 'auto' ? query.startsWith('#') ? 'hashtag' : query.startsWith('@') || /^[\w.]{1,30}$/.test(query) ? 'account' : 'location' : mode;
  if (kind === 'account') {
    const username = query.replace(/^@/, '');
    if (!/^[A-Za-z0-9_.]{1,30}$/.test(username) || username.startsWith('.') || username.endsWith('.') || username.includes('..')) throw new Error('Enter a valid Instagram username.');
    return { kind, query: username, label: `@${username}`, url: `https://www.instagram.com/${encodeURIComponent(username)}/` };
  }
  if (kind === 'hashtag') {
    const tag = query.replace(/^#/, '');
    if (!/^[\p{L}\p{M}\p{N}_]+$/u.test(tag)) throw new Error('Hashtags may contain letters, numbers, and underscores.');
    return { kind, query: tag, label: `#${tag}`, url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/` };
  }
  return { kind, query, label: query, url: /^\d+$/.test(query) ? `https://www.instagram.com/explore/locations/${query}/` : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}` };
}
module.exports = { instagramTarget };
