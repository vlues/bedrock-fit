/* ===================== Bedrock — Claude API wrapper ===================== */
/* All Claude calls go through the account-gated Cloudflare Worker backend
   (see cloudflare-worker/) via Sync — there is no personal API key
   anywhere in this app. The worker holds the real Anthropic key
   server-side and injects it after checking the caller's session token, so
   signing in (Settings → Sync, or onboarding's last step) is the only
   "unlock AI" step there is. Every caller of BedrockAPI has a working
   non-AI fallback (see js/insights.js) for when there's no backend
   deployed yet, or the user isn't signed in. */

/* Shared persona used across every Claude call so answers are consistent:
   coach-level depth (think CSCS strength coach + registered-dietitian-level
   nutrition knowledge), grounded in mainstream evidence, never fad-driven,
   and honest about not being a medical professional. */
const BEDROCK_PERSONA = 'You are Bedrock — you reason with the depth of a CSCS-certified strength coach combined with a registered-dietitian-level grasp of sports nutrition. Evidence-based and practical, never fad-driven or hype-y. Ground answers in the data you\'re given rather than inventing specifics. You are not a doctor — flag medical questions as ones for a real professional. Write short and plain: everyday words, no jargon unless the user used it first, no hedging or filler ("it\'s worth noting", "as an AI"), no restating the question. Lead with the answer, not the setup. Every response you give is read on a phone, so shorter always beats thorough — when a length limit is given below, treat it as a maximum to undercut, not a target to fill. Plain text only, ever: no markdown — no **asterisks**, no bullet points, no headers, no numbered lists. Write it the way you\'d say it out loud to someone standing next to you.';

const BedrockAPI = (() => {
  const MODEL = 'claude-sonnet-5';

  // Fails fast (15s timeout) and retries once on a timeout/network blip or a
  // 5xx from the backend, so a flaky connection or a temporary outage
  // doesn't hang the UI — every caller always gets {ok:false,...} quickly
  // and has a non-AI fallback path (see js/insights.js for the pattern).
  async function ask({ system, messages, maxTokens = 600 }, _retriesLeft = 1) {
    if (!Sync.isLoggedIn()) {
      return { ok: false, error: 'not_signed_in' };
    }
    try {
      const res = await withTimeout(fetch(Sync.backendUrl() + '/api/anthropic', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + Sync.getToken()
        },
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
  // maxTokens is a genuine hard ceiling, not just a prompt suggestion — kept
  // tight (~150 tokens ≈ 100 words) so a verbose answer gets cut off rather
  // than the "keep it short" instruction above being the only thing stopping it.
  async function chat(history, systemPrompt) {
    return ask({ system: systemPrompt, messages: history, maxTokens: 150 });
  }

  // Vision-capable message: photo (base64 data URL) + a question.
  // maxTokens defaults tight for prose answers; structured callers (the
  // itemized food scanner) pass a bigger budget so JSON doesn't get cut off.
  async function askAboutImage(dataUrl, question, systemPrompt, maxTokens = 150) {
    const match = /^data:(image\/\w+);base64,(.*)$/.exec(dataUrl || '');
    if (!match) return { ok: false, error: 'bad_image' };
    const [, mediaType, b64] = match;
    return ask({
      system: systemPrompt,
      maxTokens,
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
