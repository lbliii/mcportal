#!/usr/bin/env node
// Plain-JS launcher: runs on any Node and explains the version requirement
// instead of failing with a syntax error when .ts support is missing.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  process.stderr.write(
    `[mcportal] MCPortal needs Node.js 22.18 or newer (found ${process.version} at ${process.execPath}).\n` +
      '[mcportal] Install Node 24 (e.g. `brew install node` or `nvm install 24`) and make sure it is first on the PATH your app uses.\n',
  );
  process.exit(1);
}
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') process.stderr.write(`${w.name}: ${w.message}\n`);
});
const { main } = await import('../src/server.ts');
main(process.argv);
