// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import { visit } from 'unist-util-visit';

/**
 * Rewrite relative `./xxx.md` links between wiki pages to clean
 * base-prefixed routes. Preserves GitHub source-browsing (the `.md`
 * form works there) AND produces correct hrefs in the rendered SSG.
 *
 * Astro 5's glob-loader doesn't auto-rewrite these, so we do it via
 * a tiny remark plugin during markdown parsing.
 */
function rewriteWikiMdLinks() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      const m = node.url && node.url.match(/^\.\/([a-z0-9-]+)\.mdx?$/i);
      if (m) node.url = `${BASE}/${m[1]}/`;
    });
  };
}

// Site URL — set when deploying. GitHub Pages defaults to
// https://<owner>.github.io/<repo>/. For a custom domain, set `site` to
// the canonical origin and remove `base`.
const SITE = process.env.SOMA_DOCS_SITE ?? 'https://nulightjens.github.io';
const BASE = process.env.SOMA_DOCS_BASE ?? '/project-soma';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  markdown: {
    remarkPlugins: [rewriteWikiMdLinks],
  },
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
          href: 'https://github.com/NulightJens/project-soma',
        },
      ],
      customCss: ['./src/styles/soma-theme.css'],
      // Sidebar — explicit ordering matches the on-disk reading order
      // (concept → setup → working in the repo). Update when adding
      // new wiki pages under ../docs/wiki/.
      // Sidebar uses `slug` (content-collection entry IDs) rather than
      // `link` (raw href) so Starlight prepends the configured `base`
      // automatically. `link:` style requires hardcoding the base which
      // breaks if BASE changes — `slug:` resolves through Astro's URL
      // helper at render time.
      sidebar: [
        {
          label: 'Concept',
          items: [
            { label: 'What is SOMA', slug: 'what-is-soma' },
            { label: 'Donor lineage', slug: 'donor-lineage' },
            { label: 'Architecture', slug: 'architecture' },
          ],
        },
        {
          label: 'Setup',
          items: [{ label: 'Quickstart', slug: 'quickstart' }],
        },
        {
          label: 'Working in the repo',
          items: [{ label: 'Agent bootstrap', slug: 'agent-bootstrap' }],
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
