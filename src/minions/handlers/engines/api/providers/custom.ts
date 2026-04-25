/**
 * Custom-endpoint provider loader.
 *
 * Reads `SOMA_API_CUSTOM_PROVIDERS` (JSON array) and registers each entry
 * as a new OpenAI-compatible provider. Lets operators wire OpenRouter,
 * Together, Groq, Anyscale, Ollama, vLLM, LM Studio, etc. without
 * modifying source code.
 *
 * Config schema (one entry per provider):
 *   {
 *     "name":                "openrouter",
 *     "base_url":            "https://openrouter.ai/api/v1",
 *     "auth_header":         "Authorization",            // optional, default "Authorization"
 *     "auth_value_template": "Bearer ${KEY}",            // optional, default "Bearer ${KEY}"
 *     "auth_env_var":        "OPENROUTER_API_KEY",
 *     "rate_key":            "openrouter:chat",          // optional, default "<name>:chat"
 *     "extra_headers":       { "HTTP-Referer": "..." }   // optional
 *   }
 *
 * Local providers that need no key can use `auth_env_var: "SOMA_NO_KEY"`
 * and set `SOMA_NO_KEY=local` in the environment to bypass the missing-key
 * error. (Set `auth_value_template: ""` if the endpoint accepts no header
 * at all — the empty string means we skip the header entirely.)
 *
 * Validation deliberately strict: bad config errors loudly at load time
 * rather than silently registering a broken provider that fails on the
 * first job submission.
 */

import { makeOpenAiProvider } from './openai.js';
import { registerProvider, getProvider } from './registry.js';

// ── Public entry: load custom providers from env ────────────

export interface CustomProviderEntry {
  name: string;
  base_url: string;
  auth_env_var: string;
  auth_header?: string;
  auth_value_template?: string;
  rate_key?: string;
  extra_headers?: Record<string, string>;
}

export function loadCustomProvidersFromEnv(envVar = 'SOMA_API_CUSTOM_PROVIDERS'): {
  registered: string[];
  errors: string[];
} {
  const raw = process.env[envVar];
  if (!raw || raw.trim().length === 0) return { registered: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      registered: [],
      errors: [
        `${envVar}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  if (!Array.isArray(parsed)) {
    return { registered: [], errors: [`${envVar}: root must be a JSON array`] };
  }

  const registered: string[] = [];
  const errors: string[] = [];
  for (const [i, entry] of parsed.entries()) {
    const validated = validateEntry(entry, i);
    if (typeof validated === 'string') {
      errors.push(validated);
      continue;
    }
    if (getProvider(validated.name)) {
      errors.push(`entry ${i}: provider name '${validated.name}' is already registered`);
      continue;
    }
    registerProvider(makeOpenAiProvider({
      name: validated.name,
      baseUrl: validated.base_url,
      authHeader: validated.auth_header,
      authValueTemplate: validated.auth_value_template,
      authEnvVar: validated.auth_env_var,
      rateKey: validated.rate_key,
      extraHeaders: validated.extra_headers,
    }));
    registered.push(validated.name);
  }
  return { registered, errors };
}

function validateEntry(raw: unknown, idx: number): CustomProviderEntry | string {
  if (typeof raw !== 'object' || raw === null) return `entry ${idx}: not an object`;
  const e = raw as Record<string, unknown>;

  if (typeof e.name !== 'string' || e.name.length === 0) {
    return `entry ${idx}: 'name' must be a non-empty string`;
  }
  if (typeof e.base_url !== 'string' || !/^https?:\/\//.test(e.base_url)) {
    return `entry ${idx} (${e.name}): 'base_url' must be an http(s) URL`;
  }
  if (typeof e.auth_env_var !== 'string' || e.auth_env_var.length === 0) {
    return `entry ${idx} (${e.name}): 'auth_env_var' must be a non-empty string`;
  }
  if (e.auth_header !== undefined && typeof e.auth_header !== 'string') {
    return `entry ${idx} (${e.name}): 'auth_header' must be a string`;
  }
  if (e.auth_value_template !== undefined && typeof e.auth_value_template !== 'string') {
    return `entry ${idx} (${e.name}): 'auth_value_template' must be a string`;
  }
  if (e.rate_key !== undefined && typeof e.rate_key !== 'string') {
    return `entry ${idx} (${e.name}): 'rate_key' must be a string`;
  }
  if (e.extra_headers !== undefined) {
    if (typeof e.extra_headers !== 'object' || e.extra_headers === null) {
      return `entry ${idx} (${e.name}): 'extra_headers' must be an object`;
    }
    for (const [k, v] of Object.entries(e.extra_headers)) {
      if (typeof v !== 'string') {
        return `entry ${idx} (${e.name}): extra_headers.${k} must be a string`;
      }
    }
  }
  return {
    name: e.name,
    base_url: e.base_url,
    auth_env_var: e.auth_env_var,
    auth_header: e.auth_header as string | undefined,
    auth_value_template: e.auth_value_template as string | undefined,
    rate_key: e.rate_key as string | undefined,
    extra_headers: e.extra_headers as Record<string, string> | undefined,
  };
}

// Auto-load on first import. Errors logged to console; we don't throw at
// import time because that would brick the daemon for a single bad entry.
const result = loadCustomProvidersFromEnv();
for (const err of result.errors) {
  console.warn(`[soma api] custom provider config: ${err}`);
}
if (result.registered.length > 0) {
  console.log(`[soma api] registered custom providers: ${result.registered.join(', ')}`);
}
