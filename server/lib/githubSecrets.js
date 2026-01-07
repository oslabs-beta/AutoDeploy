import sodium from 'tweetsodium';

const API_BASE = 'https://api.github.com';
const USER_AGENT = 'AutoDeploy-App';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
}

export async function listRepoSecrets({ token, owner, repo }) {
  const url = `${API_BASE}/repos/${owner}/${repo}/actions/secrets?per_page=100`;
  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `List repo secrets failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  const secrets = Array.isArray(data.secrets) ? data.secrets : [];
  return secrets.map((s) => s.name).filter(Boolean);
}

export async function getRepoId({ token, owner, repo }) {
  const url = `${API_BASE}/repos/${owner}/${repo}`;
  const res = await fetch(url, { method: 'GET', headers: authHeaders(token) });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Get repo failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!data.id) {
    throw new Error('Missing id in GitHub repo response');
  }
  return data.id;
}

async function getRepoPublicKey({ token, owner, repo }) {
  const url = `${API_BASE}/repos/${owner}/${repo}/actions/secrets/public-key`;
  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Get repo public key failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!data.key || !data.key_id) {
    throw new Error('Malformed GitHub public key response');
  }

  return { key: data.key, key_id: data.key_id };
}

async function getEnvironmentPublicKey({ token, repositoryId, environmentName }) {
  const url = `${API_BASE}/repositories/${repositoryId}/environments/${encodeURIComponent(
    environmentName
  )}/secrets/public-key`;
  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Get environment public key failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!data.key || !data.key_id) {
    throw new Error('Malformed environment public key response');
  }

  return { key: data.key, key_id: data.key_id };
}

export async function listEnvironmentSecrets({
  token,
  repositoryId,
  environmentName,
}) {
  const url = `${API_BASE}/repositories/${repositoryId}/environments/${encodeURIComponent(
    environmentName
  )}/secrets`;
  const res = await fetch(url, {
    method: 'GET',
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `List environment secrets failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  const secrets = Array.isArray(data.secrets) ? data.secrets : [];
  return secrets.map((s) => s.name).filter(Boolean);
}

function encryptSecret(publicKeyBase64, secretValue) {
  const messageBytes = Buffer.from(secretValue);
  const keyBytes = Buffer.from(publicKeyBase64, 'base64');

  const encryptedBytes = sodium.seal(messageBytes, keyBytes);
  return Buffer.from(encryptedBytes).toString('base64');
}

export async function upsertRepoSecret({ token, owner, repo, name, value }) {
  const { key, key_id } = await getRepoPublicKey({ token, owner, repo });
  const encrypted_value = encryptSecret(key, value);

  const url = `${API_BASE}/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(
    name
  )}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ encrypted_value, key_id }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Upsert repo secret failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  return true;
}

export async function upsertEnvironmentSecret({
  token,
  repositoryId,
  environmentName,
  name,
  value,
}) {
  const { key, key_id } = await getEnvironmentPublicKey({
    token,
    repositoryId,
    environmentName,
  });
  const encrypted_value = encryptSecret(key, value);

  const url = `${API_BASE}/repositories/${repositoryId}/environments/${encodeURIComponent(
    environmentName
  )}/secrets/${encodeURIComponent(name)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ encrypted_value, key_id }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Upsert environment secret failed: ${res.status} ${res.statusText} ${text}`
    );
    err.status = res.status;
    throw err;
  }

  return true;
}
