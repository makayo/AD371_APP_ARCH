-- Pulse Data: relational schema (PostgreSQL 16), third normal form
--
--   containers 1 ──< health_checks
--
-- Every non-key column depends only on its own table's primary key:
-- container facts live in containers, check facts live in health_checks,
-- and the relationship is enforced by a real foreign key.

CREATE TABLE IF NOT EXISTS containers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL UNIQUE
                            CHECK (char_length(name) BETWEEN 1 AND 100),
    image       TEXT        NOT NULL
                            CHECK (char_length(image) BETWEEN 1 AND 200),
    status      TEXT        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'stopped', 'unhealthy')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_checks (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id  UUID          NOT NULL
                                REFERENCES containers (id) ON DELETE CASCADE,
    status        TEXT          NOT NULL CHECK (status IN ('ok', 'fail')),
    latency_ms    NUMERIC(10,2) NOT NULL CHECK (latency_ms >= 0),
    detail        TEXT          CHECK (detail IS NULL OR char_length(detail) <= 500),
    checked_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- PostgreSQL does not index foreign key columns automatically.
-- This index serves the FK (fast cascade deletes, no full scans on join)
-- and the "latest checks for a container" read pattern.
CREATE INDEX IF NOT EXISTS idx_health_checks_container_checked
    ON health_checks (container_id, checked_at DESC);

-- Keep updated_at accurate no matter which client writes the row.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_containers_updated_at ON containers;
CREATE TRIGGER trg_containers_updated_at
    BEFORE UPDATE ON containers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
