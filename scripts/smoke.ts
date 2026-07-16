#!/usr/bin/env tsx
// scripts/smoke.ts — quick smoke test: stream one completion from Ollama via the native client.
//
// Verifies that Ollama is reachable, num_ctx is sent, and streaming works end-to-end.
// Run: npm run smoke

import { createClient } from '../src/core/client';
import { loadConfig } from '../src/core/config';

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Smoke test — model=${config.model} host=${config.host} numCtx=${config.numCtx}`);

  const client = createClient({ host: config.host });

  let caps;
  try {
    caps = await client.detectCapabilities(config.model);
    console.log('Capabilities:', caps);
  } catch (err) {
    console.error('Failed to reach Ollama. Is the server running? (ollama serve)');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const prompt = 'Reply with exactly one word: hello';
  process.stdout.write('\nStreaming: ');

  const stream = client.chat({
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    numCtx: config.numCtx,
    think: false,
    sampling: config.sampling,
  });

  let content = '';
  let promptTokens: number | undefined;

  for await (const chunk of stream) {
    if (chunk.content) {
      content += chunk.content;
      process.stdout.write(chunk.content);
    }
    if (chunk.done && chunk.promptEvalCount != null) {
      promptTokens = chunk.promptEvalCount;
    }
  }

  console.log('\n');
  if (!content.trim()) {
    console.error('Smoke FAILED: empty response');
    process.exit(1);
  }

  console.log(`Smoke OK — ${content.trim().length} chars received`);
  if (promptTokens != null) {
    console.log(`Prompt tokens: ${promptTokens} (expect >4096 context budget if num_ctx=${config.numCtx} applied)`);
  }
}

main().catch((err) => {
  console.error('Smoke FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
