-- Feature #6: Share with Patient
-- Run this in Supabase SQL Editor (supabase.com/dashboard/project/wizujykuwlxyfzshoajn/sql)

-- 1. Add booking_url to offices table
ALTER TABLE offices ADD COLUMN IF NOT EXISTS booking_url TEXT;

-- 2. Create shared_links table (links expire after 48 hours)
CREATE TABLE IF NOT EXISTS shared_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  procedure_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours')
);
ALTER TABLE shared_links ENABLE ROW LEVEL SECURITY;
-- No anon policies needed — all access goes through SECURITY DEFINER RPCs

-- 3. RPC: create_shared_link
-- Called by dentist when tapping "Share with patient" from the procedure menu.
-- Validates the access code, creates a link record, returns the UUID.
CREATE OR REPLACE FUNCTION create_shared_link(p_code TEXT, p_procedure_id TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_office_id UUID;
  v_link_id UUID;
BEGIN
  SELECT ac.office_id INTO v_office_id
  FROM access_codes ac
  WHERE ac.code = p_code AND ac.is_active = true;

  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  INSERT INTO shared_links (office_id, procedure_id)
  VALUES (v_office_id, p_procedure_id)
  RETURNING id INTO v_link_id;

  RETURN v_link_id;
END;
$$;

-- 4. RPC: get_shared_link_data
-- Called by patient when opening the share link.
-- Returns office name, booking URL, procedure ID, and whether the link has expired.
CREATE OR REPLACE FUNCTION get_shared_link_data(p_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'procedure_id', sl.procedure_id,
    'office_id',    sl.office_id,
    'office_name',  o.name,
    'booking_url',  COALESCE(o.booking_url, ''),
    'is_expired',   (sl.expires_at < now())
  ) INTO v_result
  FROM shared_links sl
  JOIN offices o ON o.id = sl.office_id
  WHERE sl.id = p_id;

  RETURN v_result;
END;
$$;

-- 5. RPC: get_office_booking_url
-- Called after regular dentist login to load their booking URL into state.
CREATE OR REPLACE FUNCTION get_office_booking_url(p_office_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_url TEXT;
BEGIN
  SELECT booking_url INTO v_url FROM offices WHERE id = p_office_id;
  RETURN COALESCE(v_url, '');
END;
$$;

-- 6. RPC: update_booking_url
-- Called from the settings modal when dentist saves their appointment link.
CREATE OR REPLACE FUNCTION update_booking_url(p_code TEXT, p_booking_url TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_office_id UUID;
BEGIN
  SELECT ac.office_id INTO v_office_id
  FROM access_codes ac
  WHERE ac.code = p_code AND ac.is_active = true;

  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  UPDATE offices SET booking_url = p_booking_url WHERE id = v_office_id;
END;
$$;
