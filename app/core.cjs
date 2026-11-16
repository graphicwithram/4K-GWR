const providers = {
  youtube: { name: 'YouTube', home: 'https://www.youtube.com/', search: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  vimeo: { name: 'Vimeo', home: 'https://vimeo.com/', search: q => `https://vimeo.com/search?q=${encodeURIComponent(q)}` },
  soundcloud: { name: 'SoundCloud', home: 'https://soundcloud.com/', search: q => `https://soundcloud.com/search?q=${encodeURIComponent(q)}` },
  tiktok: { name: 'TikTok', home: 'https://www.tiktok.com/', search: q => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}` },
  facebook: { name: 'Facebook', home: 'https://www.facebook.com/', search: q => `https://www.facebook.com/search/videos/?q=${encodeURIComponent(q)}` }
};
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Enter a valid web address.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS web address without credentials.');
  return url.href;
}
function searchDestination(input, provider = 'youtube') {
  const q = String(input || '').trim();
  if (!q) throw new Error('Enter a search term or web address.');
  if (!Object.hasOwn(providers, provider)) throw new Error('Choose a supported search service.');
  if (/^[a-z][a-z\d+.-]*:/i.test(q)) return safeUrl(q);
  if (/^(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/?#:]|$)/i.test(q) && !/\s/.test(q)) return safeUrl(`https://${q}`);
  return providers[provider].search(q);
}
function filterLibrary(items, query = '', category = 'all', sort = 'newest') {
  const q = String(query).trim().toLocaleLowerCase();
  const result = items.filter(item => {
    if (category === 'video' && item.kind !== 'video') return false;
    if (category === 'audio' && item.kind !== 'audio') return false;
    if (category === 'image' && item.kind !== 'image') return false;
    if (category === 'active' && !['queued', 'downloading'].includes(item.status)) return false;
    if (category === 'completed' && item.status !== 'completed') return false;
    return !q || `${item.title} ${item.source} ${item.url}`.toLocaleLowerCase().includes(q);
  });
  return result.sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
}
module.exports = { providers, safeUrl, searchDestination, filterLibrary };
