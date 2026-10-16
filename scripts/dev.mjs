import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const processes = [
  spawn(command, ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(command, ['--prefix', 'client', 'run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of processes) child.on('exit', (code) => { if (!stopping && code) { process.exitCode = code; stop(); } });
