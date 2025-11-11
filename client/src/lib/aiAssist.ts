// client/src/lib/aiAssist.ts
export type ParsedChanges = Partial<{
  nodeVersion: string;
  installCmd: string;
  testCmd: string;
  buildCmd: string;
  awsRoleArn: string;
}>;

export function parseChatForPipeline(message: string): ParsedChanges {
  const m = message.toLowerCase();
  const out: ParsedChanges = {};

  // Node version: "Use Node 20", "nodejs v18", "node version 22"
  {
    const hit =
      message.match(/node(?:js)?(?:\s*version)?\s*(?:v)?\s*(\d{1,2})(?!\.)/i) ||
      message.match(/use\s*node\s*(?:v)?\s*(\d{1,2})(?!\.)/i);
    if (hit?.[1]) out.nodeVersion = hit[1];
  }

  // Detect package manager preference from message context
  const prefersPnpm = /\bpnpm\b/.test(m);
  const prefersYarn = /\byarn\b/.test(m);

  const defaults = {
    install: prefersPnpm ? "pnpm i --frozen-lockfile" : prefersYarn ? "yarn install --frozen-lockfile" : "npm ci",
    test: prefersPnpm ? "pnpm test" : prefersYarn ? "yarn test" : "npm test",
    build: prefersPnpm ? "pnpm build" : prefersYarn ? "yarn build" : "npm run build",
  };

  const pickLineOrBacktick = (kw: string): string | undefined => {
    // backticked command wins
    const block = message.match(new RegExp("`([^`]+)`"))?.[1];
    if (block) return block.trim();

    // line like "install: pnpm i" or "test: vitest run"
    const line = message
      .split(/\r?\n/)
      .find((ln) => ln.toLowerCase().includes(kw));
    if (line) {
      const afterColon = line.split(":").slice(1).join(":").trim();
      if (afterColon) return afterColon;
    }
    return undefined;
  };

  // Install/Test/Build from explicit lines or fallback by manager preference
  out.installCmd = pickLineOrBacktick("install") ?? (/\binstall\b/.test(m) ? defaults.install : out.installCmd);
  out.testCmd = pickLineOrBacktick("test") ?? (/\btest\b/.test(m) ? defaults.test : out.testCmd);
  out.buildCmd = pickLineOrBacktick("build") ?? (/\bbuild\b/.test(m) ? defaults.build : out.buildCmd);

  // AWS role arn
  const arn = message.match(/arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\-\/]+/);
  if (arn?.[0]) out.awsRoleArn = arn[0];

  return out;
}

export function summarizeChanges(changes: ParsedChanges): string {
  const bits: string[] = [];
  if (changes.nodeVersion) bits.push(`Node ${changes.nodeVersion}`);
  if (changes.installCmd) bits.push(`install: ${changes.installCmd}`);
  if (changes.testCmd) bits.push(`test: ${changes.testCmd}`);
  if (changes.buildCmd) bits.push(`build: ${changes.buildCmd}`);
  if (changes.awsRoleArn) bits.push(`aws role: ${changes.awsRoleArn}`);
  return bits.length ? `Applied → ${bits.join(" · ")}` : "No changes detected.";
}
