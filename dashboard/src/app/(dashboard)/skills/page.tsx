export const dynamic = 'force-dynamic';

import { getAllAgents } from '@/lib/config';
import { SkillsGrid } from '@/components/skills/skills-grid';

export default function SkillsPage() {
  const agents = getAllAgents();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Skills</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and install skills from the catalog to your agents.
        </p>
      </div>

      <SkillsGrid agents={agents} />
    </div>
  );
}
