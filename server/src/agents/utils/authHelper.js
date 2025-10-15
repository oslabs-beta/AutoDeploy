export function mcpHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey && apiKey.length > 0) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    console.warn("⚠️ No API key found in config — Authorization header skipped");
  }
  return headers;
}
