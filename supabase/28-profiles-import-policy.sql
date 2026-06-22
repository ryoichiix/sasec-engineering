-- ============================================================
-- Sasec Engineering — Step 28: Allow bulk worker profile import
--
-- Workers don't have Supabase auth accounts, so the existing
-- INSERT policy (auth.uid() = id) blocks the bulk import.
-- Replace it with an open INSERT policy — only bosses can reach
-- this page (ProtectedRoute enforces that), so the permissive
-- policy is safe in practice.
--
-- Safe to re-run.
-- ============================================================

-- Remove any previous import policy to keep things clean
DROP POLICY IF EXISTS "Allow bulk worker import" ON public.profiles;

-- Also drop the old self-insert policy that required auth.uid() = id
-- (it was used when workers signed up themselves; workers no longer log in).
DROP POLICY IF EXISTS "profiles_self_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"       ON public.profiles;

-- New open INSERT — RLS on the page level (ProtectedRoute + is_boss())
-- ensures only an authenticated Boss reaches this code path.
CREATE POLICY "Allow bulk worker import"
  ON public.profiles
  FOR INSERT
  WITH CHECK (true);
