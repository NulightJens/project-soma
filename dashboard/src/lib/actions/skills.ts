'use server';

import fs from 'fs';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { getFrameworkRoot, CTX_ROOT, getOrgs, getAgentsForOrg } from '@/lib/config';
import type { ActionResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  installed: boolean;
  installedFor: string[]; // list of "org/agent" strings where installed
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSkillMd(content: string): { name: string; description: string } {
  // Parse YAML-style frontmatter from SKILL.md
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  let name = '';
  let description = '';

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  // Fallback: use first heading and first paragraph
  if (!name) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) name = headingMatch[1].trim();
  }
  if (!description) {
    // Get first non-empty, non-heading, non-frontmatter line
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---') && !trimmed.match(/^\w+:/)) {
        description = trimmed;
        break;
      }
    }
  }

  return { name: name || 'Unnamed Skill', description: description || 'No description available.' };
}

function getInstalledAgents(slug: string): string[] {
  const installed: string[] = [];
  const frameworkRoot = getFrameworkRoot();

  // Scan orgs directory directly for maximum reliability
  const orgsDir = path.join(frameworkRoot, 'orgs');
  if (!fs.existsSync(orgsDir)) return installed;

  for (const orgEntry of fs.readdirSync(orgsDir, { withFileTypes: true })) {
    if (!orgEntry.isDirectory()) continue;
    const org = orgEntry.name;
    const agentsDir = path.join(orgsDir, org, 'agents');
    if (!fs.existsSync(agentsDir)) continue;

    for (const agentEntry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!agentEntry.isDirectory()) continue;
      const agent = agentEntry.name;
      const skillPath = path.join(agentsDir, agent, 'skills', slug);
      if (fs.existsSync(skillPath)) {
        installed.push(`${org}/${agent}`);
      }
    }
  }

  return installed;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function fetchSkills(): Promise<SkillInfo[]> {
  try {
    const frameworkRoot = getFrameworkRoot();
    const catalogDir = path.join(frameworkRoot, 'skills');

    if (!fs.existsSync(catalogDir)) {
      return [];
    }

    const entries = fs.readdirSync(catalogDir, { withFileTypes: true });
    const skills: SkillInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const slug = entry.name;
      const skillMdPath = path.join(catalogDir, slug, 'SKILL.md');
      const readmePath = path.join(catalogDir, slug, 'README.md');

      let content = '';
      if (fs.existsSync(skillMdPath)) {
        content = fs.readFileSync(skillMdPath, 'utf-8');
      } else if (fs.existsSync(readmePath)) {
        content = fs.readFileSync(readmePath, 'utf-8');
      }

      const { name, description } = parseSkillMd(content);
      const installedFor = getInstalledAgents(slug);

      if (installedFor.length > 0) {
        console.log(`[skills] ${slug} installed for: ${installedFor.join(', ')}`);
      }
      skills.push({
        slug,
        name: name || slug,
        description,
        installed: installedFor.length > 0,
        installedFor,
      });
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function installSkill(
  slug: string,
  org: string,
  agent: string,
): Promise<ActionResult> {
  try {
    const frameworkRoot = getFrameworkRoot();
    const catalogDir = path.join(frameworkRoot, 'skills', slug);

    if (!fs.existsSync(catalogDir)) {
      return { success: false, error: `Skill not found: ${slug}` };
    }

    const orgs = getOrgs();
    if (!orgs.includes(org)) {
      return { success: false, error: `Invalid org: ${org}` };
    }

    const agents = getAgentsForOrg(org);
    if (!agents.includes(agent)) {
      return { success: false, error: `Agent not found: ${agent} in org ${org}` };
    }

    const skillsDir = path.join(frameworkRoot, 'orgs', org, 'agents', agent, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    const linkPath = path.join(skillsDir, slug);

    // Remove existing link/dir if present
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(linkPath);
      }
    } catch {
      // Doesn't exist, that's fine
    }

    fs.symlinkSync(catalogDir, linkPath, 'dir');

    revalidatePath('/skills');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function uninstallSkill(
  slug: string,
  org: string,
  agent: string,
): Promise<ActionResult> {
  try {
    const linkPath = path.join(getFrameworkRoot(), 'orgs', org, 'agents', agent, 'skills', slug);

    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(linkPath);
      } else if (stat.isDirectory()) {
        fs.rmSync(linkPath, { recursive: true });
      }
    } catch {
      return { success: false, error: `Skill not installed: ${slug} for ${org}/${agent}` };
    }

    revalidatePath('/skills');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
