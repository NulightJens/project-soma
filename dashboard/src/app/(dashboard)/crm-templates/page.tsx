import { listTemplates, SEQUENCE_PURPOSE } from '@/lib/data/crm-templates';
import { TemplateEditor } from '@/components/crm/template-editor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CrmTemplatesPage() {
  const templates = await listTemplates();
  return (
    <div className="space-y-5 p-6 max-w-[1400px] mx-auto" data-testid="crm-templates-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CRM message templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          One row per (sequence, step, variant). Edit body in your own voice — these are what actually get sent. New outreach rows pick up the latest version automatically. Existing ready rows need a manual <code>Refresh copy</code> on the outreach queue modal.
        </p>
      </div>
      <TemplateEditor templates={templates} sequencePurpose={SEQUENCE_PURPOSE} />
    </div>
  );
}
