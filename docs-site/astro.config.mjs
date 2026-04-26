// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// Site URL — set when deploying. GitHub Pages defaults to
// https://<owner>.github.io/<repo>/. For a custom domain, set `site` to
// the canonical origin and remove `base`.
const SITE = process.env.SOMA_DOCS_SITE ?? 'https://nulightjens.github.io';
const BASE = process.env.SOMA_DOCS_BASE ?? '/cortextos';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'SOMA',
      description:
        'Persistent agent operating system — durable priority queue, multi-provider LLM loops, Telegram + dashboard surfaces.',
      logo: {
        src: './src/assets/soma-mark.svg',
        replacesTitle: false,
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/NulightJens/cortextos',
        },
      ],
      customCss: ['./src/styles/soma-theme.css'],
      // Sidebar — explicit ordering matches the on-disk reading order
      // (concept → setup → working in the repo). Update when adding
      // new wiki pages under ../docs/wiki/.
      sidebar: [
        { label: 'Home', link: '/' },
        {
          label: 'Concept',
          items: [
            { label: 'What is SOMA', link: '/what-is-soma/' },
            { label: 'Donor lineage', link: '/donor-lineage/' },
            { label: 'Architecture', link: '/architecture/' },
          ],
        },
        {
          label: 'Setup',
          items: [{ label: 'Quickstart', link: '/quickstart/' }],
        },
        {
          label: 'Working in the repo',
          items: [{ label: 'Agent bootstrap', link: '/agent-bootstrap/' }],
        },
      ],
      plugins: [
        // Generates /llms.txt + /llms-full.txt + /llms-small.txt at build
        // time. AI agents can fetch these instead of crawling HTML.
        starlightLlmsTxt({
          projectName: 'SOMA',
          description:
            'Persistent agent operating system. Durable SQLite-backed priority queue, multi-provider LLM loops with crash-resumable replay, Telegram + Next.js dashboard surfaces. MIT, forked from cortextOS.',
          // Keep raw markdown as-authored — agents prefer the source
          // over rendered HTML for token efficiency.
          rawContent: true,
        }),
      ],
    }),
  ],
});
