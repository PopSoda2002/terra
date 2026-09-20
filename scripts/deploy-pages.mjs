import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'dist/pages');
if (!existsSync(join(output, 'index.html'))) throw new Error('Run the Pages build first.');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const remote = git(['remote', 'get-url', 'origin']);
const author = git(['config', 'user.name']);
const email = git(['config', 'user.email']);
const revision = git(['rev-parse', '--short', 'HEAD']);
const directory = mkdtempSync(join(tmpdir(), 'terra-pages-'));

try {
  git(['init', '-b', 'gh-pages'], directory);
  git(['remote', 'add', 'origin', remote], directory);
  if (git(['ls-remote', '--heads', 'origin', 'gh-pages'], directory)) {
    git(['fetch', '--depth=1', 'origin', 'gh-pages'], directory);
    git(['checkout', '-B', 'gh-pages', 'FETCH_HEAD'], directory);
  }
  for (const entry of readdirSync(directory)) {
    if (entry !== '.git') rmSync(join(directory, entry), { recursive: true, force: true });
  }
  cpSync(output, directory, { recursive: true });
  writeFileSync(join(directory, '.nojekyll'), '');
  git(['add', '--all'], directory);
  if (!git(['status', '--porcelain'], directory)) {
    console.log('Pages is already up to date.');
  } else {
    git(['-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '-m', `Deploy Terra ${revision}`], directory);
    git(['push', 'origin', 'gh-pages'], directory);
    console.log('Published gh-pages. GitHub Pages will deploy it shortly.');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
