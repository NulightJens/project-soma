'use client';

import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SkillCard } from '@/components/skills/skill-card';

interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  installed: boolean;
  installedFor: string[];
}

interface SkillsGridProps {
  agents: Array<{ name: string; org: string }>;
}

export function SkillsGrid({ agents }: SkillsGridProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      setSkills(data);
    } catch {
      setSkills([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 rounded-xl bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        <p>No skills found in the catalog.</p>
        <p className="text-xs mt-1">
          Skills are read from $CTX_FRAMEWORK_ROOT/skills/
        </p>
      </div>
    );
  }

  const installed = skills.filter((s) => s.installed);
  const available = skills.filter((s) => !s.installed);

  return (
    <Tabs defaultValue="all">
      <TabsList>
        <TabsTrigger value="all">All ({skills.length})</TabsTrigger>
        <TabsTrigger value="installed">Installed ({installed.length})</TabsTrigger>
        <TabsTrigger value="available">Available ({available.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="all">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
          {skills.map((skill) => (
            <SkillCard key={skill.slug} skill={skill} agents={agents} onRefresh={loadSkills} />
          ))}
        </div>
      </TabsContent>

      <TabsContent value="installed">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
          {installed.length === 0 ? (
            <p className="text-muted-foreground col-span-full text-center py-8">
              No skills installed yet.
            </p>
          ) : (
            installed.map((skill) => (
              <SkillCard key={skill.slug} skill={skill} agents={agents} onRefresh={loadSkills} />
            ))
          )}
        </div>
      </TabsContent>

      <TabsContent value="available">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
          {available.length === 0 ? (
            <p className="text-muted-foreground col-span-full text-center py-8">
              All skills are installed.
            </p>
          ) : (
            available.map((skill) => (
              <SkillCard key={skill.slug} skill={skill} agents={agents} onRefresh={loadSkills} />
            ))
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
