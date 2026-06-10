-- Remove the legacy `reports` parsing views.
--
-- These per-(project × schema) views parsed UploadRow.data JSON into typed
-- columns for the data team. They are superseded by the Parquet warehouse
-- export, so the whole schema (and every view it contains) is dropped.
--
-- Safe to re-run: IF EXISTS makes this a no-op once the schema is gone.
DROP SCHEMA IF EXISTS reports CASCADE;
