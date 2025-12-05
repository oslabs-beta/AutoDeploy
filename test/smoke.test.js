import fetch from 'node-fetch';

async function main() {
  // Skip in CI (GitHub Actions sets CI=true)
  if (process.env.CI) {
    console.log('Skipping smoke test in CI environment');
    process.exit(0);
  }

  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/health`;

  try {
    console.log(`🔎 Checking API health @ ${url} ...`);
    const res = await fetch(url);
    const json = await res.json();

    if (!res.ok || !json.ok) {
      console.error("❌ Health check didn't pass", json);
      process.exit(1);
    }

    console.log('✅ Health check passed!', json);
    process.exit(0);
  } catch (error) {
    console.error('❌ Smoke test failed', error?.message || error);
    process.exit(1);
  }
}

main();
