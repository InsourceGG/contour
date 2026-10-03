-- Northwind Support uses its own application sessions. Only the server's service
-- role can access this exposed schema; readers enforce current session team scope.
begin;
create schema if not exists northwind;
create table if not exists northwind.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default ''
);
create table if not exists northwind.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  password_hash text not null,
  role text not null check (role in ('agent','lead','admin')),
  team text not null references northwind.teams(name),
  capacity integer not null default 12 check (capacity > 0),
  created_at timestamptz not null default now()
);
create table if not exists northwind.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  email text not null,
  plan text not null default 'Business',
  team text not null references northwind.teams(name),
  created_at timestamptz not null default now(),
  unique (id, team)
);
create table if not exists northwind.tickets (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique,
  subject text not null,
  description text not null,
  status text not null check (status in ('open','pending','resolved')),
  priority text not null check (priority in ('urgent','high','normal','low')),
  team text not null references northwind.teams(name),
  customer_id uuid not null,
  assignee_id uuid references northwind.users(id),
  channel text not null check (channel in ('email','chat','phone')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, team) references northwind.customers(id, team),
  unique (id, team)
);
create table if not exists northwind.sla_timers (
  ticket_id uuid primary key,
  team text not null references northwind.teams(name),
  due_at timestamptz not null,
  foreign key (ticket_id, team) references northwind.tickets(id, team) on delete cascade
);
create table if not exists northwind.csat_scores (
  id uuid primary key default gen_random_uuid(),
  team text not null references northwind.teams(name),
  date date not null,
  score numeric(5,2) not null check (score between 0 and 100),
  responses integer not null check (responses > 0),
  unique (team, date)
);
create table if not exists northwind.kb_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  body text not null,
  topic text not null,
  team text not null references northwind.teams(name),
  read_minutes integer not null check (read_minutes > 0),
  updated_at timestamptz not null default now()
);
create table if not exists northwind.customer_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  ticket_id uuid not null,
  team text not null references northwind.teams(name),
  kind text not null check (kind in ('reply','opened','resolved','note')),
  description text not null,
  created_at timestamptz not null default now(),
  foreign key (customer_id, team) references northwind.customers(id, team),
  foreign key (ticket_id, team) references northwind.tickets(id, team) on delete cascade
);
create table if not exists northwind.ticket_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  team text not null references northwind.teams(name),
  author_id uuid not null references northwind.users(id),
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (ticket_id, team) references northwind.tickets(id, team) on delete cascade
);
create table if not exists northwind.user_settings (
  user_id uuid primary key references northwind.users(id) on delete cascade,
  display_name text not null,
  email_notifications boolean not null default true,
  sla_notifications boolean not null default true,
  daily_digest boolean not null default false,
  updated_at timestamptz not null default now()
);
-- A reply, its customer activity event, and its queue update commit atomically.
-- The trigger runs as the inserting service role, never as a privileged definer.
create or replace function northwind.record_ticket_reply()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update northwind.tickets
    set status = 'pending', updated_at = new.created_at
    where id = new.ticket_id and team = new.team;
  insert into northwind.customer_events (customer_id, ticket_id, team, kind, description, created_at)
    select customer_id, id, team, 'reply', 'Support sent a reply and is waiting for the customer.', new.created_at
    from northwind.tickets where id = new.ticket_id and team = new.team;
  return new;
end;
$$;
revoke all on function northwind.record_ticket_reply() from public, anon, authenticated;
grant execute on function northwind.record_ticket_reply() to service_role;
drop trigger if exists record_ticket_reply on northwind.ticket_replies;
create trigger record_ticket_reply
  after insert on northwind.ticket_replies
  for each row execute function northwind.record_ticket_reply();
create index if not exists tickets_team_status_due_idx on northwind.tickets(team,status,due_at);
create index if not exists tickets_assignee_idx on northwind.tickets(assignee_id);
create index if not exists customers_team_idx on northwind.customers(team);
create index if not exists users_team_idx on northwind.users(team);
create index if not exists sla_team_due_idx on northwind.sla_timers(team,due_at);
create index if not exists csat_team_date_idx on northwind.csat_scores(team,date);
create index if not exists kb_team_topic_idx on northwind.kb_articles(team,topic);
create index if not exists events_team_time_idx on northwind.customer_events(team,created_at desc);
create index if not exists replies_ticket_time_idx on northwind.ticket_replies(ticket_id,created_at);
alter table northwind.teams enable row level security;
alter table northwind.users enable row level security;
alter table northwind.customers enable row level security;
alter table northwind.tickets enable row level security;
alter table northwind.sla_timers enable row level security;
alter table northwind.csat_scores enable row level security;
alter table northwind.kb_articles enable row level security;
alter table northwind.customer_events enable row level security;
alter table northwind.ticket_replies enable row level security;
alter table northwind.user_settings enable row level security;
revoke all on schema northwind from public, anon, authenticated;
revoke all on all tables in schema northwind from public, anon, authenticated;
revoke all on all sequences in schema northwind from public, anon, authenticated;
grant usage on schema northwind to service_role;
grant all on all tables in schema northwind to service_role;
grant all on all sequences in schema northwind to service_role;
alter default privileges in schema northwind revoke all on tables from public, anon, authenticated;
alter default privileges in schema northwind grant all on tables to service_role;
notify pgrst, 'reload schema';
commit;
