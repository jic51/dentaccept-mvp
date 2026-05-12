-- ============================================
-- DENTACCEPT MVP — FULL DATABASE SCHEMA
-- No PHI (patient data) stored anywhere
-- ============================================

-- 1. OFFICES
create table offices (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text not null,
  email text unique,
  plan text default 'starter' check (plan in ('starter', 'practice', 'group')),
  max_tablets integer default 1,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled')),
  trial_ends_at timestamp with time zone default now() + interval '14 days',
  settings jsonb default '{"language": "en"}'::jsonb
);

-- 2. ACCESS CODES (replaces hardcoded 1234)
create table access_codes (
  id uuid default gen_random_uuid() primary key,
  office_id uuid references offices(id) on delete cascade,
  code text not null unique,
  is_active boolean default true,
  created_at timestamp with time zone default now()
);
create index idx_access_codes_code on access_codes(code);

-- 3. PROCEDURES CATALOG
create table procedures_catalog (
  id text primary key,
  name_en text not null,
  name_es text not null,
  description_en text,
  description_es text,
  category text,
  base_price integer,
  icon text default '🦷',
  is_active boolean default true,
  sort_order integer default 0,
  steps jsonb,
  timeline jsonb,
  explanation_en text,
  explanation_es text,
  created_at timestamp with time zone default now()
);

-- 4. PRESENTATIONS (analytics only, NO patient data)
create table presentations (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  office_id uuid references offices(id),
  procedure_id text not null,
  procedure_name text not null,
  language text default 'en',
  completed boolean default false,
  scheduled boolean default false,
  declined boolean default false,
  session_id text,
  device_type text default 'tablet'
);
create index idx_presentations_office_date on presentations(office_id, created_at desc);
create index idx_presentations_procedure on presentations(procedure_id);

-- 5. MONTHLY STATS (aggregated)
create table monthly_stats (
  id uuid default gen_random_uuid() primary key,
  office_id uuid references offices(id),
  month date not null,
  total_presentations integer default 0,
  completed_presentations integer default 0,
  scheduled_count integer default 0,
  declined_count integer default 0,
  acceptance_rate decimal(5,2),
  revenue_impact decimal(10,2),
  unique(office_id, month)
);

-- 6. AI EXPLANATIONS CACHE
create table ai_explanations_cache (
  id uuid default gen_random_uuid() primary key,
  procedure_id text not null,
  language text not null default 'en',
  concern text default 'cost',
  explanation text not null,
  used_count integer default 1,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default now() + interval '30 days',
  unique(procedure_id, language, concern)
);
create index idx_ai_cache_lookup on ai_explanations_cache(procedure_id, language, concern);

-- 7. WAITLIST (for landing page)
create table waitlist (
  id uuid default gen_random_uuid() primary key,
  email text not null unique,
  source text default 'landing',
  created_at timestamp with time zone default now()
);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Track presentation (returns UUID so client can update later)
create or replace function track_presentation(
  p_office_id uuid,
  p_procedure_id text,
  p_procedure_name text,
  p_language text default 'en',
  p_outcome text default 'started',
  p_session_id text default null
) returns uuid as $$
declare
  v_id uuid;
begin
  insert into presentations (office_id, procedure_id, procedure_name, language, session_id, completed, scheduled, declined)
  values (
    p_office_id,
    p_procedure_id,
    p_procedure_name,
    p_language,
    p_session_id,
    p_outcome = 'completed',
    p_outcome = 'scheduled',
    p_outcome = 'declined'
  )
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;

-- Get office stats for a date range
create or replace function get_office_stats(
  p_office_id uuid,
  p_start_date date,
  p_end_date date
) returns table (
  total_presentations bigint,
  scheduled_count bigint,
  acceptance_rate decimal,
  total_revenue_impact decimal
) as $$
begin
  return query
  select
    count(*)::bigint,
    count(*) filter (where p.scheduled = true)::bigint,
    case
      when count(*) > 0 then round((count(*) filter (where p.scheduled = true)::decimal / count(*)::decimal) * 100, 2)
      else 0
    end,
    coalesce(sum(pc.base_price) filter (where p.scheduled = true), 0)::decimal
  from presentations p
  left join procedures_catalog pc on p.procedure_id = pc.id
  where p.office_id = p_office_id
  and p.created_at::date between p_start_date and p_end_date;
end;
$$ language plpgsql security definer;

-- Increment AI cache usage counter
create or replace function increment_cache_usage(
  p_procedure_id text,
  p_language text,
  p_concern text
) returns void as $$
begin
  update ai_explanations_cache
  set used_count = used_count + 1
  where procedure_id = p_procedure_id
  and language = p_language
  and concern = p_concern;
end;
$$ language plpgsql security definer;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table offices enable row level security;
alter table access_codes enable row level security;
alter table procedures_catalog enable row level security;
alter table presentations enable row level security;
alter table monthly_stats enable row level security;
alter table ai_explanations_cache enable row level security;
alter table waitlist enable row level security;

-- Procedures catalog: public read
create policy "Procedures are public" on procedures_catalog for select using (true);

-- Access codes: public read (needed for code validation)
create policy "Codes are publicly readable" on access_codes for select using (true);

-- Presentations: insert via security definer function; no direct read needed for patient app
create policy "Insert presentations via function" on presentations for insert with check (true);

-- AI cache: public read, insert via service role
create policy "AI cache is public read" on ai_explanations_cache for select using (true);
create policy "AI cache insert" on ai_explanations_cache for insert with check (true);
create policy "AI cache update" on ai_explanations_cache for update using (true);

-- Waitlist: anyone can insert
create policy "Anyone can join waitlist" on waitlist for insert with check (true);

-- Offices: read via access code join (handled in app query)
create policy "Offices readable via access code" on offices for select using (true);

-- ============================================
-- SEED DATA
-- ============================================

-- Demo office
insert into offices (id, name, email, status, trial_ends_at)
values ('00000000-0000-0000-0000-000000000001', 'Smile Dental Group', 'demo@dentaccept.com', 'active', now() + interval '365 days');

insert into access_codes (office_id, code)
values ('00000000-0000-0000-0000-000000000001', '1234');

-- Procedure catalog
insert into procedures_catalog (id, name_en, name_es, description_en, description_es, base_price, category, sort_order, icon) values
('crown',       'Dental Crown',      'Corona Dental',        'Cap over damaged tooth',          'Cubierta para diente dañado',        1200, 'restorative',  1, '🦷'),
('implant',     'Dental Implant',    'Implante Dental',      'Permanent tooth replacement',     'Reemplazo permanente de diente',     3500, 'surgical',     2, '⬡'),
('rootcanal',   'Root Canal',        'Endodoncia',           'Removes infected pulp',           'Elimina pulpa infectada',             900, 'endodontic',   3, '🌀'),
('invisalign',  'Invisalign',        'Invisalign',           'Clear aligners',                  'Alineadores transparentes',          4500, 'orthodontic',  4, '⟡'),
('whitening',   'Teeth Whitening',   'Blanqueamiento',       'Professional bleaching',          'Blanqueamiento profesional',          400, 'cosmetic',     5, '✨'),
('extraction',  'Tooth Extraction',  'Extracción Dental',    'Tooth removal',                   'Remoción de diente',                  300, 'surgical',     6, '🔧'),
('filling',     'Dental Filling',    'Empaste Dental',       'Cavity repair',                   'Reparación de caries',                200, 'restorative',  7, '🩹'),
('bridge',      'Dental Bridge',     'Puente Dental',        'Replaces missing teeth',          'Reemplaza dientes faltantes',        2500, 'restorative',  8, '🌉'),
('veneer',      'Porcelain Veneer',  'Carilla de Porcelana', 'Thin shell for front teeth',      'Lámina para dientes frontales',      1200, 'cosmetic',     9, '💎'),
('deepcleaning','Deep Cleaning',     'Limpieza Profunda',    'Scaling and root planing',        'Raspado y alisado radicular',         300, 'periodontal', 10, '🫧');
