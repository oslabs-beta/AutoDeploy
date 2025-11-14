import fetch from 'node-fetch';

const port = process.env.PORT || 4000;
const url = `http://localhost:${port}/health`;

async function main() {
  try {
    console.log(`🔎 Checking API health @ ${url} ...`);
    const res = await fetch(url);
    const json = await res.json();

    // const ok = await healthCheck();
    if (!res.ok || !json.ok) {
      console.error('❌ Health check didn"t pass', json);
      process.exit(1);
    }

    console.log('✅ Health check passed!', json);
    process.exit(0);
  } catch (error) {
    console.error('❌ Smoke test failed');
    process.exit(1);
  }
}

main();
