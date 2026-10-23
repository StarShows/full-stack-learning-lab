// Deployment smoke test. This script is never exposed as an application route.
const response = await fetch((process.env.OLLAMA_URL || 'http://ollama:11434') + '/api/chat', {
  method: 'POST', signal: AbortSignal.timeout(180000), headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b', stream: false, messages: [{ role: 'user', content: 'Reply with the single word hello.' }], options: { temperature: 0, num_ctx: 2048, num_predict: 8 } }),
});
if (!response.ok) throw Error('Local inference smoke test failed.');
const result = await response.json();
if (!result.message?.content?.trim()) throw Error('Local model returned an empty answer.');
console.log('Local inference smoke test passed.');
