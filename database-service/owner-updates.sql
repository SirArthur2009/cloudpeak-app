-- Shared schema for Supabase and Railway. Railway maps the client role names.
CREATE TABLE IF NOT EXISTS public.puppy_owner_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puppy_id bigint NOT NULL REFERENCES public.puppies(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('name','photo')),
  requested_name text,
  storage_path text UNIQUE,
  caption text CHECK (length(caption) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden')),
  published_url text,
  gallery_photo_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK ((kind='name' AND requested_name IS NOT NULL AND length(trim(requested_name)) BETWEEN 1 AND 80 AND storage_path IS NULL AND published_url IS NULL)
    OR (kind='photo' AND requested_name IS NULL AND storage_path IS NOT NULL AND length(storage_path) <= 900 AND storage_path LIKE submitted_by::text || '/' || puppy_id::text || '/%')),
  CHECK (kind='photo' OR status <> 'hidden'),
  CHECK (kind <> 'photo' OR status <> 'approved' OR (published_url IS NOT NULL AND length(trim(published_url)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS puppy_pending_name ON public.puppy_owner_updates(puppy_id) WHERE kind='name' AND status='pending';
CREATE INDEX IF NOT EXISTS puppy_owner_updates_puppy ON public.puppy_owner_updates(puppy_id);
ALTER TABLE public.puppy_owner_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.puppy_owner_updates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.puppy_owner_updates TO authenticated;
DROP POLICY IF EXISTS owner_updates_read ON public.puppy_owner_updates;
CREATE POLICY owner_updates_read ON public.puppy_owner_updates FOR SELECT TO authenticated
  USING (submitted_by=auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin'));
DROP POLICY IF EXISTS owner_updates_submit ON public.puppy_owner_updates;
CREATE POLICY owner_updates_submit ON public.puppy_owner_updates FOR INSERT TO authenticated
  WITH CHECK (submitted_by=auth.uid() AND status='pending' AND published_url IS NULL AND gallery_photo_id IS NULL AND reviewed_at IS NULL
    AND EXISTS (SELECT 1 FROM public.waitlist w JOIN public.puppies p ON p.id=w.selected_puppy_id
      WHERE p.id=puppy_id AND p.status='sold' AND w.pending_approval IS NOT TRUE
      AND lower(w.email)=lower(auth.jwt()->>'email')));
DROP POLICY IF EXISTS owner_updates_review ON public.puppy_owner_updates;
CREATE POLICY owner_updates_review ON public.puppy_owner_updates FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin'));

-- Invoker rights: only an admin with puppy/gallery write permission can publish.
CREATE OR REPLACE FUNCTION public.review_puppy_owner_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.puppy_id,NEW.submitted_by,NEW.kind,NEW.requested_name,NEW.storage_path,NEW.caption,NEW.created_at)
     IS DISTINCT FROM (OLD.puppy_id,OLD.submitted_by,OLD.kind,OLD.requested_name,OLD.storage_path,OLD.caption,OLD.created_at) THEN
    RAISE EXCEPTION 'Submitted details cannot be changed during review.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.kind='name' AND (OLD.status <> 'pending' OR NEW.status NOT IN ('approved','rejected')) THEN
      RAISE EXCEPTION 'This name request has already been reviewed.';
    END IF;
    IF NEW.kind='photo' AND NEW.status='pending' THEN RAISE EXCEPTION 'Reviewed photos cannot be reset to pending.'; END IF;
    NEW.reviewed_at := now();
    IF NEW.status='approved' THEN
      IF NOT EXISTS (SELECT 1 FROM public.puppies WHERE id=NEW.puppy_id AND status='sold') THEN
        RAISE EXCEPTION 'Only updates for sold puppies can be published.';
      END IF;
      IF NEW.kind='name' THEN
        UPDATE public.puppies SET name=trim(NEW.requested_name) WHERE id=NEW.puppy_id;
      ELSE
        INSERT INTO public.puppy_photos(puppy_id,photo_url,caption,sort_order)
          VALUES(NEW.puppy_id,NEW.published_url,NEW.caption,0) RETURNING id INTO NEW.gallery_photo_id;
      END IF;
    ELSIF NEW.kind='photo' AND OLD.gallery_photo_id IS NOT NULL THEN
      DELETE FROM public.puppy_photos WHERE id=OLD.gallery_photo_id;
      NEW.gallery_photo_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.review_puppy_owner_update() FROM PUBLIC;
DROP TRIGGER IF EXISTS review_puppy_owner_update ON public.puppy_owner_updates;
CREATE TRIGGER review_puppy_owner_update BEFORE UPDATE ON public.puppy_owner_updates
  FOR EACH ROW EXECUTE FUNCTION public.review_puppy_owner_update();

CREATE OR REPLACE FUNCTION public.check_puppy_sale_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='sold' THEN
    IF OLD.status <> 'reserved' THEN RAISE EXCEPTION 'Reserve this puppy before marking it sold.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.waitlist WHERE selected_puppy_id=NEW.id AND pending_approval IS NOT TRUE AND email IS NOT NULL) THEN
      RAISE EXCEPTION 'A sold puppy must have an approved family selection.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_puppy_sale_status() FROM PUBLIC;
DROP TRIGGER IF EXISTS check_puppy_sale_status ON public.puppies;
CREATE TRIGGER check_puppy_sale_status BEFORE UPDATE OF status ON public.puppies
  FOR EACH ROW EXECUTE FUNCTION public.check_puppy_sale_status();
