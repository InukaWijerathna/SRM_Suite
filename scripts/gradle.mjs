// Runs the Gradle wrapper in android/, the same way regardless of which shell invoked
// `npm run` (PowerShell, cmd.exe, or Git Bash all resolve "./gradlew" / "gradlew.bat"
// differently, and `npm run` on Windows picks whichever shell the environment favors).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const androidDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const wrapper = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const task = process.argv[2];

if (!task) {
  console.error('Usage: node scripts/gradle.mjs <gradle-task>');
  process.exit(1);
}

// shell: true is required on Windows to spawn a .bat file at all (Node otherwise errors
// EINVAL); quoting handles the absolute path containing spaces ("New folder").
const result = spawnSync(JSON.stringify(wrapper), [task, '--no-daemon'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: true,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
