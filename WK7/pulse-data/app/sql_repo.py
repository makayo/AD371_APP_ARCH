"""PostgreSQL repository.

Every statement is parameterized (%s placeholders bound by psycopg); no user
input is ever formatted into SQL text. Column names in UPDATE come from a fixed
allow-list and are quoted with psycopg.sql.Identifier.
"""
import logging
import uuid

from psycopg import errors, sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from errors import Conflict, ConstraintError, NotFound

log = logging.getLogger("pulse.sql")

UPDATABLE = ("name", "image", "status")

CONTAINER_COLS = "c.id, c.name, c.image, c.status, c.created_at, c.updated_at"


class SqlRepo:
    engine = "postgresql"

    def __init__(self, dsn):
        # A small pool: connections are borrowed per request and always returned
        # by the context manager, so nothing leaks between requests.
        self.pool = ConnectionPool(
            dsn, min_size=1, max_size=5, kwargs={"row_factory": dict_row}, open=True
        )
        self.pool.wait(timeout=30)

    def close(self):
        self.pool.close()

    @staticmethod
    def _run(cur, query, params=()):
        text = query.as_string(cur) if isinstance(query, sql.Composable) else query
        log.info("SQL %s | params=%s", " ".join(text.split()), list(params))
        cur.execute(query, params)

    @staticmethod
    def _translate(e):
        diag = getattr(e, "diag", None)
        constraint = diag.constraint_name if diag else None
        if isinstance(e, errors.UniqueViolation):
            return Conflict(f"unique constraint violated: {constraint}")
        if isinstance(e, errors.ForeignKeyViolation):
            return ConstraintError(
                "foreign key violation: container does not exist",
                constraint, e.sqlstate)
        if isinstance(e, (errors.CheckViolation, errors.NotNullViolation)):
            return ConstraintError(f"check constraint violated: {constraint}",
                                   constraint, e.sqlstate)
        return None

    # ---------- reads ----------

    def ping(self):
        with self.pool.connection() as conn, conn.cursor() as cur:
            self._run(cur, "SELECT 1")
            return cur.fetchone() is not None

    def list_containers(self):
        q = f"""
            SELECT {CONTAINER_COLS},
                   COUNT(h.id)       AS check_count,
                   MAX(h.checked_at) AS last_check_at
            FROM containers c
            LEFT JOIN health_checks h ON h.container_id = c.id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        """
        with self.pool.connection() as conn, conn.cursor() as cur:
            self._run(cur, q)
            return cur.fetchall()

    def get_container(self, cid):
        # One JOIN returns the container and all of its checks.
        q = f"""
            SELECT {CONTAINER_COLS},
                   h.id AS check_id, h.status AS check_status,
                   h.latency_ms, h.detail, h.checked_at
            FROM containers c
            LEFT JOIN health_checks h ON h.container_id = c.id
            WHERE c.id = %s
            ORDER BY h.checked_at DESC
        """
        with self.pool.connection() as conn, conn.cursor() as cur:
            self._run(cur, q, (cid,))
            rows = cur.fetchall()
        if not rows:
            raise NotFound("container not found")
        first = rows[0]
        container = {k: first[k] for k in ("id", "name", "image", "status", "created_at", "updated_at")}
        container["checks"] = [
            {"id": r["check_id"], "status": r["check_status"], "latency_ms": r["latency_ms"],
             "detail": r["detail"], "checked_at": r["checked_at"]}
            for r in rows if r["check_id"] is not None
        ]
        container["check_count"] = len(container["checks"])
        container["query"] = "1 SQL query (LEFT JOIN containers -> health_checks)"
        return container

    # ---------- writes ----------

    def create_container(self, name, image, initial_check=None):
        """Container and optional first check are written in ONE transaction:
        either both rows exist afterwards or neither does."""
        cid = str(uuid.uuid4())
        try:
            with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
                self._run(cur, "INSERT INTO containers (id, name, image) VALUES (%s, %s, %s)",
                          (cid, name, image))
                if initial_check:
                    self._insert_check(cur, cid, initial_check)
        except errors.IntegrityError as e:
            raise (self._translate(e) or e) from e
        return self.get_container(cid)

    def update_container(self, cid, fields):
        cols = [k for k in UPDATABLE if k in fields]
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(c)) for c in cols)
        q = sql.SQL("UPDATE containers SET {} WHERE id = %s RETURNING id").format(assignments)
        try:
            with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
                self._run(cur, q, [fields[c] for c in cols] + [cid])
                if cur.fetchone() is None:
                    raise NotFound("container not found")
        except errors.IntegrityError as e:
            raise (self._translate(e) or e) from e
        return self.get_container(cid)

    def delete_container(self, cid):
        with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
            self._run(cur, "SELECT COUNT(*) AS n FROM health_checks WHERE container_id = %s", (cid,))
            child_count = cur.fetchone()["n"]
            self._run(cur, "DELETE FROM containers WHERE id = %s RETURNING id", (cid,))
            if cur.fetchone() is None:
                raise NotFound("container not found")
            # Proof that ON DELETE CASCADE removed the children in the same transaction.
            self._run(cur, "SELECT COUNT(*) AS n FROM health_checks WHERE container_id = %s", (cid,))
            remaining = cur.fetchone()["n"]
        return {"deleted": cid, "cascaded_checks": child_count, "remaining_checks": remaining}

    def _insert_check(self, cur, cid, check):
        check_id = str(uuid.uuid4())
        self._run(cur, """
            INSERT INTO health_checks (id, container_id, status, latency_ms, detail)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, status, latency_ms, detail, checked_at
        """, (check_id, cid, check["status"], check["latency_ms"], check.get("detail")))
        return cur.fetchone()

    def add_check(self, cid, check):
        # No existence pre-check on purpose: the FOREIGN KEY is what rejects orphans.
        try:
            with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
                return self._insert_check(cur, cid, check)
        except errors.IntegrityError as e:
            raise (self._translate(e) or e) from e

    def update_check(self, cid, check_id, fields):
        cols = [k for k in ("status", "detail") if k in fields]
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(c)) for c in cols)
        q = sql.SQL("""UPDATE health_checks SET {} WHERE id = %s AND container_id = %s
                       RETURNING id, status, latency_ms, detail, checked_at""").format(assignments)
        try:
            with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
                self._run(cur, q, [fields[c] for c in cols] + [check_id, cid])
                row = cur.fetchone()
        except errors.IntegrityError as e:
            raise (self._translate(e) or e) from e
        if row is None:
            raise NotFound("check not found")
        return row

    # ---------- QA: prove transaction rollback ----------

    def transaction_rollback_test(self):
        """Insert a container, then an orphan check in the SAME transaction.
        The foreign key fails, the whole transaction rolls back, and the
        container must not exist afterwards."""
        cid = str(uuid.uuid4())
        name = f"rollback-test-{cid[:8]}"
        error = None
        try:
            with self.pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
                self._run(cur, "INSERT INTO containers (id, name, image) VALUES (%s, %s, %s)",
                          (cid, name, "qa:rollback"))
                self._insert_check(cur, str(uuid.uuid4()), {"status": "ok", "latency_ms": 1})
        except errors.ForeignKeyViolation as e:
            error = f"{e.sqlstate} {e.diag.constraint_name}"
        with self.pool.connection() as conn, conn.cursor() as cur:
            self._run(cur, "SELECT COUNT(*) AS n FROM containers WHERE id = %s", (cid,))
            exists_after = cur.fetchone()["n"] > 0
        return {
            "step_1": f"INSERT container {name}",
            "step_2": "INSERT health_check with a non-existent container_id",
            "error": error,
            "container_exists_after_rollback": exists_after,
            "passed": error is not None and not exists_after,
        }
