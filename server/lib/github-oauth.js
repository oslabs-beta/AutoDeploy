export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    allow_signup: 'true',
  }).toString();
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken({
  clientId,
  clientSecret,
  code,
  redirectUri,
}) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Token exchange failed: ${res.status} ${JSON.stringify(json)}`
    );
  }
  return json;
}

export async function fetchGithubUser(accessToken) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `Fetch /user failed: ${res.status} ${JSON.stringify(json)}`
    );
  return json;
}

export async function fetchPrimaryEmail(accessToken) {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return null;
  const emails = await res.json();
  const primary =
    emails.find((e) => e.primary && e.verified) ||
    emails.find((e) => e.primary) ||
    emails[0];
  return primary?.email || null;
}
