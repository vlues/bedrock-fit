/* ===================== Bedrock — Claude API wrapper ===================== */
/* Calls the Anthropic Messages API directly from the browser using a
   user-supplied API key. Anthropic supports this via the
   "anthropic-dangerous-direct-browser-access" header, meant for personal /
   prototype use — the key is visible to anyone who inspects this browser,
   so only use a key you're fine having live on your own phone. */

/* Shared persona used across every Claude call so answers are consistent:
   coach-level depth (think CSCS strength coach + registered-dietitian-level
   nutrition knowledge), grounded in mainstream evidence, never fad-driven,
   and honest about not being a medical professional. */
const BEDROCK_PERSONA = 'You are Bedrock — you reason with the depth of a CSCS-certified strength coach combined with a registered-dietitian-level grasp of sports nutrition. Evidence-based and practical, never fad-driven or hype-y. Ground answers in the data you\'re given rather than inventing specifics. You are not a doctor — flag medical questions as ones for a real professional.';

const BedrockAPI = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  // Optional: worker-example/deploy-worker.sh rewrites this one line to your
  // deployed Cloudflare Worker URL when you choose to hide your Anthropic key
  // behind a real backend (see README "Optional: hide your API key behind a
  // real backend"). Leave it null to keep calling Anthropic directly from the
  // browser with a per-device key pasted into Settings.
  const PROXY_ENDPOINT = null;
  const MODEL = 'claude-sonnet-5';

  // Fails fast (15s timeout) and retries once on a timeout/network blip or a
  // 5xx from Anthropic's side, so a flaky connection or a temporary outage
  // doesn't hang the UI — every caller always gets {ok:false,...} quickly
  // and has a non-AI fallback path (see js/insights.js for the pattern).
  async function ask({ system, messages, maxTokens = 600 }, _retriesLeft = 1) {
    const usingProxy = !!PROXY_ENDPOINT;
    const key = usingProxy ? null : Store.getApiKey();
    if (!usingProxy && !key) {
      return { ok: false, error: 'no_key' };
    }
    try {
      const headers = {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      };
      if (usingProxy) {
        // No x-api-key here on purpose — the worker injects the real key
        // server-side, so it never touches this browser.
      } else {
        headers['x-api-key'] = key;
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
      }
      const res = await withTimeout(fetch(usingProxy ? PROXY_ENDPOINT : ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          system: system || undefined,
          messages
        })
      }), 15000, 'anthropic');

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status >= 500 && _retriesLeft > 0) { await sleep(700); return ask({ system, messages, maxTokens }, _retriesLeft - 1); }
        return { ok: false, error: 'http_' + res.status, detail: body };
      }
      const data = await res.json();
      const text = (data.content || []).map(b => b.text || '').join('\n').trim();
      return { ok: true, text };
    } catch (e) {
      if (_retriesLeft > 0) { await sleep(700); return ask({ system, messages, maxTokens }, _retriesLeft - 1); }
      return { ok: false, error: String(e).startsWith('Error: timeout') ? 'timeout' : 'network', detail: String(e) };
    }
  }

  // Simple text Q&A turn, with short conversation history [{role, content}]
  async function chat(history, systemPrompt) {
    return ask({ system: systemPrompt, messages: history, maxTokens: 500 });
  }

  // Vision-capable message: photo (base64 data URL) + a question
  async function askAboutImage(dataUrl, question, systemPrompt) {
    const match = /^data:(image\/\w+);base64,(.*)$/.exec(dataUrl || '');
    if (!match) return { ok: false, error: 'bad_image' };
    const [, mediaType, b64] = match;
    return ask({
      system: systemPrompt,
      maxTokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: question }
        ]
      }]
    });
  }

  return { chat, askAboutImage, ask };
})();
