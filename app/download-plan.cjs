const path = require('node:path');
function downloadArgs(item, folder, tools) {
  const height = [720, 1080, 2160].includes(Number(item.quality)) ? Number(item.quality) : 1080;
  const format = item.kind === 'audio' ? 'bestaudio[ext=m4a]/bestaudio' : `bv[height<=?${height}][ext=mp4]+ba[ext=m4a]/bv[height<=?${height}]+ba/b[height<=?${height}]`;
  return ['--ignore-config', '--no-playlist', '--no-simulate', '--newline', '--no-colors', '--no-overwrites', '--windows-filenames', '--restrict-filenames', '--socket-timeout', '30', '--retries', '3',
    '--js-runtimes', `node:${path.join(tools, 'node.exe')}`, '--ffmpeg-location', tools, '--merge-output-format', 'mp4',
    '--format', format, '--paths', folder, '--output', '%(title).160B [%(id)s].%(ext)s',
    '--progress-template', 'download:FC_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '--print', 'before_dl:FC_META:%(title)j', '--print', 'after_move:FC_FILE:%(filepath)j', '--', item.url];
}
module.exports = { downloadArgs };
