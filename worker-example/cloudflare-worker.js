/**
 * Optional: a tiny proxy so your Anthropic API key never touches the browser.
 * Deploy this as a free Cloudflare Worker (see README "Optional: hide your
 * API key behind a real backend" for the full walkthrough), then point
 * js/api.js's ENDPOINT at your worker URL instead of api.anthropic.com, and
 * drop the x-api-key header from the browser entirely.
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Bedrock proxy is up. POST like the Anthropic Messages API.', { status: 200 });
    }

    // Lock this down to your own GitHub Pages origin before going further.
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type'
    };

    const body = await request.text();
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY, // set via `wrangler secret put ANTHROPIC_API_KEY`
        'anthropic-version': '2023-06-01'
      },
      body
    });

    return new Response(upstream.body, { status: upstream.status, headers: corsHeaders });
  }
};
