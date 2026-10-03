import assert from 'node:assert/strict';
import test from 'node:test';
import { githubIdentity } from '../src/auth/github.ts';
import { createLogger } from '../src/lib/log.ts';
import type { Fetcher } from '../src/types.ts';

const cases = [
  { error: 'bad_verification_code', message: /code is invalid or expired.*fresh link/, reason: 'expired_code' },
  { error: 'incorrect_client_credentials', message: /OAuth app credentials.*server owner/, reason: 'client_configuration' },
  { error: 'redirect_uri_mismatch', message: /callback address.*server owner/, reason: 'callback_configuration' },
  { error: 'unverified_user_email', message: /verified primary email.*Verify your email/, reason: 'unverified_email' },
  { error: 'unknown-provider-error-containing-a-secret', message: /could not obtain a GitHub sign-in token/, reason: 'token_response' },
];
for (const scenario of cases) {
  test(`GitHub diagnostic: ${scenario.reason} gives recovery advice without upstream text or credentials`, async () => {
    const lines: string[] = [];
    const secret = 'secret-token-code-or-client-credential';
    const fetcher: Fetcher = async (url) => ({ status: 200, url, contentType: 'application/json', text: JSON.stringify({ error: scenario.error, error_description: secret, access_token: secret }), truncated: false });
    const result = await githubIdentity(fetcher, { clientId: secret, clientSecret: secret }, secret, `https://portal.example/callback?code=${secret}`, createLogger({ format: 'json', write: (line) => lines.push(line) }));
    assert.ok('error' in result);
    assert.match(result.error, scenario.message);
    const event = JSON.parse(lines[0]!);
    assert.equal(event.event, 'auth.github_failed');
    assert.equal(event.reason, scenario.reason);
    assert.equal(event.status, 200, 'an OAuth error is diagnosed even with HTTP 200');
    assert.ok(result.error.includes(event.reference));
    assert.ok(!JSON.stringify({ result, lines }).includes(secret));
    assert.ok(!JSON.stringify({ result, lines }).includes(scenario.error));
  });
}

test('GitHub diagnostic: profile failures are distinguished from token failures', async () => {
  const lines: string[] = [];
  const fetcher: Fetcher = async (url) => ({ status: url.endsWith('/user') ? 503 : 200, url, contentType: 'application/json', text: url.endsWith('/user') ? 'provider-private-body' : '{"access_token":"private-token"}', truncated: false });
  const result = await githubIdentity(fetcher, { clientId: 'cid', clientSecret: 'private-secret' }, 'private-code', 'https://portal.example/callback', createLogger({ format: 'json', write: (line) => lines.push(line) }));
  assert.ok('error' in result);
  assert.match(result.error, /reading your account profile.*HTTP 503/);
  assert.equal(JSON.parse(lines[0]!).step, 'profile');
  assert.doesNotMatch(JSON.stringify({ result, lines }), /provider-private-body|private-token|private-secret|private-code/);
});
