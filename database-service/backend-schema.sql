-- Private server state; never exposed through PostgREST.
CREATE TABLE IF NOT EXISTS cloudpeak_internal.user_directory (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cloudpeak_internal.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('preview','queued','sent','failed')),
  provider_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cloudpeak_internal.email_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS cloudpeak_internal.webhook_events (
  id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cloudpeak_internal.deleted_accounts (
  id uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA cloudpeak_internal FROM PUBLIC,cloudpeak_anon,cloudpeak_user,cloudpeak_admin;

-- A client can only choose an available puppy in their own assigned litter.
ALTER POLICY own_waitlist_update ON public.waitlist
  USING(lower(email)=lower(auth.jwt()->>'email') AND is_active=true)
  WITH CHECK(lower(email)=lower(auth.jwt()->>'email') AND (
    selected_puppy_id IS NULL OR EXISTS (
      SELECT 1 FROM public.puppies p
      WHERE p.id=waitlist.selected_puppy_id AND p.litter_id=waitlist.litter_id AND p.status='available'
    )
  ));
