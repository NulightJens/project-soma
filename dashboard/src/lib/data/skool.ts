// Typed queries against the skoolio Supabase project for the /skool-analytics page.
// Server-side only — uses SUPABASE_SECRET_KEY which bypasses RLS.
// All queries return plain JSON so server components can pass to client components as props.

import { getSkoolSupabase } from '../supabase-client';

// ---------- Types ----------

export type SkoolRange = '7d' | '30d' | '90d' | 'all';

export interface CurrentKpis {
  active: number;
  cancelling: number;
  churned: number;
  banned: number;
  mrr: number;
  cancelling_mrr_at_risk: number;
  imminent_churn_7d: number;
  as_of: string | null;
}

export interface DailyAnalyticsRow {
  date: string;
  active_count: number | null;
  cancelling_count: number | null;
  churned_count: number | null;
  banned_count: number | null;
  mrr: number | null;
  cancelling_mrr_at_risk: number | null;
  mrr_by_tier: Record<string, number> | null;
  new_joins: number | null;
  new_churns_observed: number | null;
  new_cancellations: number | null;
  online_now: number | null;
  active_last_24h: number | null;
  active_last_7d: number | null;
  active_last_30d: number | null;
  acquisition_mix: Record<string, number> | null;
  source_scraped_at: string | null;
}

export interface AcquisitionLtvRow {
  source: string;
  total_members: number;
  active: number;
  cancelling: number;
  churned: number;
  churn_pct: number | null;
  active_arpu: number | null;
  avg_days_to_churn: number | null;
  estimated_ltv_usd: number | null;
}

export interface ChurnFunnelRow {
  funnel_stage: string;
  members: number;
  avg_days_to_reach_churned: number | null;
  mrr_contribution_usd: number;
  pct_of_base: number | null;
}

export interface CohortRetentionRow {
  cohort_month: string;
  cohort_size: number;
  still_paying: number;
  retention_pct: number | null;
  avg_days_to_churn: number | null;
  median_days_to_churn: number | null;
}

export interface CancellingMember {
  handle: string;
  name: string | null;
  level: number | null;
  bio: string | null;
  cancelled_churns_in_days: number | null;
  subscription_price: number | null;
  join_date: string | null;
  acquisition_source: string | null;
  activity_status: string | null;
  suggested_action?: InterventionAction;
}

export interface InterventionAction {
  priority: 'high' | 'medium' | 'low';
  label: string;
  rationale: string;
}

function activityStaleDays(status: string | null): number | null {
  if (!status) return null;
  if (/Online now/i.test(status)) return 0;
  const m = status.match(/Active\s+(\d+)\s*([mhdwy]|mo|yr)\s*ago/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'm') return Math.round(n / 1440);
  if (u === 'h') return Math.round(n / 24);
  if (u === 'd') return n;
  if (u === 'w') return n * 7;
  if (u === 'mo') return n * 30;
  if (u === 'y' || u === 'yr') return n * 365;
  return null;
}

function tenureDays(joinDate: string | null): number | null {
  if (!joinDate) return null;
  const d = new Date(joinDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// Deterministic "next action" prescription for a cancelling member. The rules
// stack top-down: first match wins. Keep short and actionable — James scans
// this column at speed. Full rationale shown on hover/expand.
export function prescribeIntervention(m: CancellingMember): InterventionAction {
  const daysTilChurn = m.cancelled_churns_in_days ?? null;
  const tenure = tenureDays(m.join_date);
  const stale = activityStaleDays(m.activity_status);
  const source = (m.acquisition_source || '').toLowerCase();
  const price = m.subscription_price ?? 0;

  // Imminent (≤3 days) and still engaged: fastest save window
  if (daysTilChurn !== null && daysTilChurn <= 3 && stale !== null && stale <= 2) {
    return {
      priority: 'high',
      label: 'DM today — still engaged',
      rationale: `Churns in ${daysTilChurn}d and was active ${stale}d ago. Personal DM from you right now is the highest-leverage save. Lead with a specific win from their recent activity.`,
    };
  }

  // Referral / email-invite: personal channel
  if (/referral|email invite/.test(source)) {
    return {
      priority: 'high',
      label: 'Personal DM — warm channel',
      rationale: `Joined via ${m.acquisition_source}. Human channel means they expect personal touch on retention too. Skip the form — DM directly referencing who referred them.`,
    };
  }

  // Grandfathered sub-$97 considering cancel — offer annual
  if (price > 0 && price < 97) {
    return {
      priority: 'medium',
      label: 'Offer $499/yr tier',
      rationale: `On grandfathered $${price}/mo. Annual $499 works out to ~$41.58/mo — below their current rate but locks in 12 months. Cheapest retention option that keeps them paying.`,
    };
  }

  // Dormant (no activity > 14 days) — probably lost, just collect the survey
  if (stale !== null && stale > 14) {
    return {
      priority: 'low',
      label: 'Collect exit survey only',
      rationale: `Inactive ${stale} days. Win-back odds low. Send the cancellation-intent survey, learn what broke, do not invest retention effort here.`,
    };
  }

  // Early tenure (<30 days) cancel — onboarding didn't stick
  if (tenure !== null && tenure < 30) {
    return {
      priority: 'high',
      label: 'Onboarding rescue call',
      rationale: `Cancelling after only ${tenure} days. This is an onboarding failure, not a value failure. Offer a 15-min call to unblock whatever stopped them from using the product.`,
    };
  }

  // Default: standard retention playbook
  return {
    priority: 'medium',
    label: 'Standard retention DM',
    rationale: `No special lever. Run the 3-step cancellation-retention sequence (day-0 survey, day-1 live-call nudge, day-2 graceful release).`,
  };
}

export interface TierDistributionRow {
  price: number;
  period: string;
  count: number;
}

export interface DataMaturity {
  pipeline_days: number;
  rate_reliable: boolean;
  threshold_days: number;
  note: string;
}

// ---------- Query functions ----------

function rangeToDate(range: SkoolRange): string | null {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getCurrentKpis(): Promise<CurrentKpis> {
  const sb = getSkoolSupabase();
  const { data: members, error: mErr } = await sb
    .from('current_members')
    .select('tab, subscription_price, subscription_period, cancelled_churns_in_days');
  if (mErr) throw new Error(`current kpis: ${mErr.message}`);

  const counts = { active: 0, cancelling: 0, churned: 0, banned: 0 };
  let mrr = 0, cancellingMrr = 0, imminent = 0;
  for (const m of members || []) {
    counts[m.tab as keyof typeof counts] = (counts[m.tab as keyof typeof counts] ?? 0) + 1;
    const monthly =
      m.subscription_period === 'year' ? (m.subscription_price ?? 0) / 12
      : m.subscription_period === 'week' ? (m.subscription_price ?? 0) * 4.33
      : m.subscription_period === 'month' ? (m.subscription_price ?? 0)
      : 0;
    if (m.tab === 'active') mrr += monthly;
    else if (m.tab === 'cancelling') {
      cancellingMrr += monthly;
      if (m.cancelled_churns_in_days !== null && m.cancelled_churns_in_days <= 7) imminent++;
    }
  }

  const { data: runs } = await sb
    .from('ingest_runs')
    .select('started_at')
    .eq('status', 'completed')
    .eq('source', 'scrape-members')
    .order('started_at', { ascending: false })
    .limit(1);
  const asOf = runs && runs[0] ? runs[0].started_at : null;

  return {
    active: counts.active,
    cancelling: counts.cancelling,
    churned: counts.churned,
    banned: counts.banned,
    mrr: Math.round(mrr * 100) / 100,
    cancelling_mrr_at_risk: Math.round(cancellingMrr * 100) / 100,
    imminent_churn_7d: imminent,
    as_of: asOf,
  };
}

export async function getDailyTimeSeries(range: SkoolRange = '30d'): Promise<DailyAnalyticsRow[]> {
  const sb = getSkoolSupabase();
  const since = rangeToDate(range);
  let q = sb
    .from('daily_analytics')
    .select('*')
    .order('date', { ascending: true });
  if (since) q = q.gte('date', since);
  const { data, error } = await q;
  if (error) throw new Error(`daily series: ${error.message}`);
  return (data ?? []) as DailyAnalyticsRow[];
}

export async function getAcquisitionLtv(): Promise<AcquisitionLtvRow[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('mart_acquisition_ltv')
    .select('*')
    .order('estimated_ltv_usd', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`acquisition ltv: ${error.message}`);
  return (data ?? []) as AcquisitionLtvRow[];
}

export async function getChurnFunnel(): Promise<ChurnFunnelRow[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb.from('mart_churn_funnel').select('*');
  if (error) throw new Error(`churn funnel: ${error.message}`);
  return (data ?? []) as ChurnFunnelRow[];
}

// Retention cohort grouped by acquisition source (which channel produces
// members who stick). Derived from mart_acquisition_ltv so the math matches
// what /skool-analytics already shows in the acquisition table, but framed
// as a cohort-retention heatmap row per source.
export interface SourceCohortRow {
  source: string;
  cohort_size: number;      // total members ever from this source
  still_paying: number;     // active + cancelling (not yet churned)
  retention_pct: number | null;
  active: number;
  cancelling: number;
  churned: number;
  avg_days_to_churn: number | null;
  estimated_ltv_usd: number | null;
}

export async function getSourceCohortRetention(minCohort = 3): Promise<SourceCohortRow[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('mart_acquisition_ltv')
    .select('source, total_members, active, cancelling, churned, churn_pct, avg_days_to_churn, estimated_ltv_usd')
    .order('estimated_ltv_usd', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`source cohort: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows
    .filter((r) => Number(r.total_members ?? 0) >= minCohort)
    .map((r) => {
      const active = Number(r.active ?? 0);
      const cancelling = Number(r.cancelling ?? 0);
      const churned = Number(r.churned ?? 0);
      const total = Number(r.total_members ?? 0);
      const stillPaying = active + cancelling;
      return {
        source: r.source as string,
        cohort_size: total,
        still_paying: stillPaying,
        retention_pct: total > 0 ? Math.round((stillPaying / total) * 1000) / 10 : null,
        active,
        cancelling,
        churned,
        avg_days_to_churn: r.avg_days_to_churn !== null && r.avg_days_to_churn !== undefined ? Number(r.avg_days_to_churn) : null,
        estimated_ltv_usd: r.estimated_ltv_usd !== null && r.estimated_ltv_usd !== undefined ? Number(r.estimated_ltv_usd) : null,
      };
    });
}

export async function getCohortRetention(limit = 12): Promise<CohortRetentionRow[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('mart_cohort_retention')
    .select('*')
    .order('cohort_month', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`cohort retention: ${error.message}`);
  return (data ?? []) as CohortRetentionRow[];
}

export async function getCancellingMembers(): Promise<CancellingMember[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('current_members')
    .select('handle, name, level, bio, cancelled_churns_in_days, subscription_price, join_date, acquisition_source, activity_status')
    .eq('tab', 'cancelling')
    .order('cancelled_churns_in_days', { ascending: true, nullsFirst: false });
  if (error) throw new Error(`cancelling members: ${error.message}`);
  const rows = (data ?? []) as CancellingMember[];
  return rows.map((m) => ({ ...m, suggested_action: prescribeIntervention(m) }));
}

export async function getTierDistribution(): Promise<TierDistributionRow[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('current_members')
    .select('subscription_price, subscription_period, tab')
    .in('tab', ['active', 'cancelling']);
  if (error) throw new Error(`tier dist: ${error.message}`);

  const map = new Map<string, { price: number; period: string; count: number }>();
  for (const m of data ?? []) {
    const price = m.subscription_price ?? 0;
    const period = m.subscription_period ?? 'unknown';
    const k = `${price}/${period}`;
    const prev = map.get(k);
    if (prev) prev.count += 1;
    else map.set(k, { price, period, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ---------- Full members directory ----------
export interface DirectoryMember {
  handle: string;
  name: string | null;
  level: number | null;
  tab: 'active' | 'cancelling' | 'churned' | 'banned' | string;
  subscription_price: number | null;
  subscription_period: string | null;
  join_date: string | null;
  acquisition_source: string | null;
  activity_status: string | null;
  days_in_community: number | null;
  cancelled_churns_in_days: number | null;
  open_outreach: number;
  intervention?: InterventionAction;
}

export interface DirectoryFilters {
  tab?: 'active' | 'cancelling' | 'churned' | 'banned' | 'all';
  priceTier?: string;   // e.g., '97'
  source?: string;      // e.g., 'Instagram'
  hasOpenOutreach?: 'yes' | 'no' | 'all';
  sort?: 'tenure_desc' | 'tenure_asc' | 'days_to_churn_asc' | 'priority' | 'level_desc';
  search?: string;
  limit?: number;
}

export async function getMembersDirectory(f: DirectoryFilters = {}): Promise<DirectoryMember[]> {
  const sb = getSkoolSupabase();

  // If the caller wants only members with open outreach, resolve that set first
  // so we never miss them because of a row-limit cut-off on current_members.
  let outreachHandles: string[] | null = null;
  if (f.hasOpenOutreach === 'yes') {
    const { data: out } = await sb
      .from('crm_outreach')
      .select('member_handle')
      .in('status', ['scheduled', 'ready', 'sent']);
    outreachHandles = Array.from(new Set((out ?? []).map((o) => o.member_handle as string)));
    if (outreachHandles.length === 0) return [];
  }

  let q = sb
    .from('current_members')
    .select('handle, name, level, tab, bio, subscription_price, subscription_period, join_date, acquisition_source, activity_status, cancelled_churns_in_days');

  if (f.tab && f.tab !== 'all') q = q.eq('tab', f.tab);
  if (f.priceTier && f.priceTier !== 'all') q = q.eq('subscription_price', Number(f.priceTier));
  if (f.source && f.source !== 'all') q = q.eq('acquisition_source', f.source);
  if (outreachHandles) q = q.in('handle', outreachHandles);
  if (f.search && f.search.trim()) {
    const s = f.search.trim();
    q = q.or(`handle.ilike.%${s}%,name.ilike.%${s}%`);
  }

  // Default upped to 1500 so a single page covers the full community (~900 now)
  // even when no filters are applied.
  const { data, error } = await q.limit(Math.min(f.limit ?? 1500, 3000));
  if (error) throw new Error(`directory: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Attach open-outreach counts in one round-trip.
  const handles = Array.from(new Set(rows.map((r) => r.handle as string)));
  let outreachByHandle = new Map<string, number>();
  if (handles.length > 0) {
    const { data: out } = await sb
      .from('crm_outreach')
      .select('member_handle, status')
      .in('member_handle', handles)
      .in('status', ['scheduled', 'ready', 'sent']);
    for (const o of out ?? []) {
      const h = o.member_handle as string;
      outreachByHandle.set(h, (outreachByHandle.get(h) ?? 0) + 1);
    }
  }

  const enriched: DirectoryMember[] = rows.map((r) => {
    const joinDate = (r.join_date as string | null) ?? null;
    const daysInCommunity = joinDate
      ? Math.floor((Date.now() - new Date(joinDate).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const m: DirectoryMember = {
      handle: r.handle as string,
      name: (r.name as string | null) ?? null,
      level: (r.level as number | null) ?? null,
      tab: r.tab as string,
      subscription_price: (r.subscription_price as number | null) ?? null,
      subscription_period: (r.subscription_period as string | null) ?? null,
      join_date: joinDate,
      acquisition_source: (r.acquisition_source as string | null) ?? null,
      activity_status: (r.activity_status as string | null) ?? null,
      days_in_community: daysInCommunity,
      cancelled_churns_in_days: (r.cancelled_churns_in_days as number | null) ?? null,
      open_outreach: outreachByHandle.get(r.handle as string) ?? 0,
    };
    if (m.tab === 'cancelling') {
      m.intervention = prescribeIntervention({
        handle: m.handle,
        name: m.name,
        level: m.level,
        bio: (r.bio as string | null) ?? null,
        cancelled_churns_in_days: m.cancelled_churns_in_days,
        subscription_price: m.subscription_price,
        join_date: m.join_date,
        acquisition_source: m.acquisition_source,
        activity_status: m.activity_status,
      });
    }
    return m;
  });

  let filtered = enriched;
  if (f.hasOpenOutreach === 'yes') filtered = filtered.filter((m) => m.open_outreach > 0);
  else if (f.hasOpenOutreach === 'no') filtered = filtered.filter((m) => m.open_outreach === 0);

  const priorityRank = (p: InterventionAction['priority'] | undefined) =>
    p === 'high' ? 0 : p === 'medium' ? 1 : p === 'low' ? 2 : 3;

  switch (f.sort) {
    case 'tenure_asc':
      filtered.sort((a, b) => (a.days_in_community ?? Infinity) - (b.days_in_community ?? Infinity));
      break;
    case 'days_to_churn_asc':
      filtered.sort((a, b) => (a.cancelled_churns_in_days ?? Infinity) - (b.cancelled_churns_in_days ?? Infinity));
      break;
    case 'priority':
      filtered.sort((a, b) => priorityRank(a.intervention?.priority) - priorityRank(b.intervention?.priority));
      break;
    case 'level_desc':
      filtered.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
      break;
    case 'tenure_desc':
    default:
      filtered.sort((a, b) => (b.days_in_community ?? -1) - (a.days_in_community ?? -1));
  }

  return filtered;
}

export async function getMembersDirectoryFilterOptions(): Promise<{ priceTiers: string[]; sources: string[] }> {
  const sb = getSkoolSupabase();
  const { data } = await sb
    .from('current_members')
    .select('subscription_price, acquisition_source');
  const prices = new Set<string>();
  const sources = new Set<string>();
  for (const r of data ?? []) {
    if (r.subscription_price !== null && r.subscription_price !== undefined) prices.add(String(r.subscription_price));
    if (r.acquisition_source) sources.add(r.acquisition_source as string);
  }
  return {
    priceTiers: Array.from(prices).sort((a, b) => Number(a) - Number(b)),
    sources: Array.from(sources).sort(),
  };
}

export interface OutreachRow {
  id: string;
  member_handle: string;
  member_name: string | null;
  sequence_slug: string;
  step: number;
  channel: string;
  scheduled_for: string;
  status: 'scheduled' | 'ready' | 'sent' | 'skipped' | 'failed' | 'responded' | 'no_response';
  payload: Record<string, unknown> | null;
  created_at: string;
  preview_body?: string | null;
}

// Pulls the fully [Name]-substituted body server-side so the modal renders
// exactly what would be sent. Mirrors the logic in execute-crm-outreach.js.
export function renderOutreachBody(row: OutreachRow): string | null {
  const copy = (row.payload as { copy?: { body?: string } } | null)?.copy;
  const rawBody = copy?.body;
  if (!rawBody) return null;
  const first = (row.member_name || 'there').split(/\s+/)[0];
  return rawBody.replace(/\[Name\]/g, first);
}

const OUTREACH_ACTIVE_STATUSES = ['scheduled', 'ready'];

export async function getUpcomingOutreach(limit = 200): Promise<OutreachRow[]> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('crm_outreach')
    .select('id, member_handle, sequence_slug, step, channel, scheduled_for, status, payload, created_at')
    .in('status', OUTREACH_ACTIVE_STATUSES)
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`outreach: ${error.message}`);
  const rows = (data ?? []) as Omit<OutreachRow, 'member_name'>[];
  if (rows.length === 0) return [];

  const handles = Array.from(new Set(rows.map((r) => r.member_handle)));
  const { data: members } = await sb
    .from('members')
    .select('handle, name')
    .in('handle', handles);
  const nameByHandle = new Map<string, string | null>();
  for (const m of members ?? []) nameByHandle.set(m.handle as string, (m.name as string) ?? null);

  return rows.map((r) => ({ ...r, member_name: nameByHandle.get(r.member_handle) ?? null }));
}

export async function markOutreachReady(id: string): Promise<boolean> {
  const sb = getSkoolSupabase();
  // Only flip from scheduled -> ready. Refuse to clobber sent/responded/etc.
  const { data, error } = await sb
    .from('crm_outreach')
    .update({ status: 'ready' })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`mark ready ${id}: ${error.message}`);
  return !!data;
}

// Week-over-week delta for the headline metrics. Compares today's daily_analytics
// row (or closest to today) against the row from ~7 days ago. Returns null when
// we don't yet have 2 rows, so the UI can show "waiting for more history".
export interface WowDelta {
  metric: 'active' | 'cancelling' | 'churned' | 'mrr' | 'cancelling_mrr_at_risk';
  current: number | null;
  prior_week: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  prior_date: string | null;
}

export async function getWeekOverWeekDeltas(): Promise<Record<string, WowDelta>> {
  const sb = getSkoolSupabase();
  // Pull last 10 days so we have wiggle room to find ~7d prior.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 10);
  const { data, error } = await sb
    .from('daily_analytics')
    .select('date, active_count, cancelling_count, churned_count, mrr, cancelling_mrr_at_risk')
    .gte('date', since.toISOString().slice(0, 10))
    .order('date', { ascending: false });
  if (error) throw new Error(`wow: ${error.message}`);

  const rows = (data ?? []) as Array<{ date: string } & Record<string, number | null>>;
  const latest = rows[0] ?? null;
  if (!latest) {
    const empty: WowDelta = { metric: 'active', current: null, prior_week: null, delta_abs: null, delta_pct: null, prior_date: null };
    return { active: empty, cancelling: empty, churned: empty, mrr: empty, cancelling_mrr_at_risk: empty };
  }

  const latestDate = new Date(latest.date + 'T00:00:00Z');
  const targetPrior = new Date(latestDate);
  targetPrior.setUTCDate(targetPrior.getUTCDate() - 7);

  // Pick the row closest to 7 days before latest.
  let prior: typeof rows[number] | null = null;
  let bestGap = Infinity;
  for (const r of rows.slice(1)) {
    const d = new Date(r.date + 'T00:00:00Z');
    const gap = Math.abs(d.getTime() - targetPrior.getTime());
    if (gap < bestGap) { bestGap = gap; prior = r; }
  }

  function delta(metric: WowDelta['metric']): WowDelta {
    const cur = (latest[metric] as number | null) ?? null;
    const priorVal = prior ? ((prior[metric] as number | null) ?? null) : null;
    if (cur === null || priorVal === null) {
      return { metric, current: cur, prior_week: priorVal, delta_abs: null, delta_pct: null, prior_date: prior?.date ?? null };
    }
    const abs = Number(cur) - Number(priorVal);
    const pct = priorVal === 0 ? null : Math.round((abs / Number(priorVal)) * 1000) / 10;
    return { metric, current: Number(cur), prior_week: Number(priorVal), delta_abs: Math.round(abs * 100) / 100, delta_pct: pct, prior_date: prior?.date ?? null };
  }

  return {
    active: delta('active'),
    cancelling: delta('cancelling'),
    churned: delta('churned'),
    mrr: delta('mrr'),
    cancelling_mrr_at_risk: delta('cancelling_mrr_at_risk'),
  };
}

export async function getDataMaturity(): Promise<DataMaturity> {
  const sb = getSkoolSupabase();
  const { data, error } = await sb
    .from('ingest_runs')
    .select('started_at')
    .eq('status', 'completed')
    .order('started_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`data maturity: ${error.message}`);
  if (!data || data.length === 0) {
    return { pipeline_days: 0, rate_reliable: false, threshold_days: 30, note: 'no pipeline history yet' };
  }
  const first = new Date(data[0].started_at);
  const days = Math.floor((Date.now() - first.getTime()) / (1000 * 60 * 60 * 24));
  const threshold = 30;
  return {
    pipeline_days: days,
    rate_reliable: days >= threshold,
    threshold_days: threshold,
    note: days >= threshold
      ? `${days} days of pipeline history — churn rate metric is trustworthy`
      : `${days} / ${threshold} days of pipeline history — rate metrics are suppressed until ${threshold}d accrual`,
  };
}
