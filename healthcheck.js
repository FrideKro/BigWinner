const url = 'http://127.0.0.1:3000/api/health';

fetch(url, { signal: AbortSignal.timeout(4000) })
  .then((res) => {
    if (!res.ok) {
      console.error(`Healthcheck failed: HTTP ${res.status}`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Healthcheck failed: ${err.message}`);
    process.exit(1);
  });
