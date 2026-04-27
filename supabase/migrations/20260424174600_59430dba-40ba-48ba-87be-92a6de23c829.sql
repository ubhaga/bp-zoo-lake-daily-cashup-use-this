ALTER TABLE public.speedpoint_diff_clearances
  ADD COLUMN IF NOT EXISTS group_id uuid;

CREATE INDEX IF NOT EXISTS speedpoint_diff_clearances_group_id_idx
  ON public.speedpoint_diff_clearances (group_id);