"""Pulse Data QA suite: runs the assignment's QA checklist against the live API.

    docker compose exec app sh -c "cd /srv && python -m unittest -v tests.test_qa"

Uses only the standard library. BASE_URL defaults to the app inside its container.
"""
import json
import os
import unittest
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BASE_URL", "http://localhost:8000")


def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def unique(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class T1_Health(unittest.TestCase):
    def test_both_databases_reachable(self):
        status, body = call("GET", "/healthz")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["databases"], {"sql": "ok", "nosql": "ok"})


class T2_SqlCrudAndIntegrity(unittest.TestCase):
    E = "/api/sql"

    def test_create_and_read_with_join(self):
        status, c = call("POST", f"{self.E}/containers", {"name": unique("sql"), "image": "pulse:1.0.0"})
        self.assertEqual(status, 201, c)
        status, k = call("POST", f"{self.E}/containers/{c['id']}/checks", {"status": "ok", "latency_ms": 1.5})
        self.assertEqual(status, 201, k)
        status, full = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(full["check_count"], 1)
        self.assertEqual(full["checks"][0]["id"], k["id"])
        self.assertIn("JOIN", full["query"])

    def test_update_reflects_immediately(self):
        _, c = call("POST", f"{self.E}/containers", {"name": unique("sql"), "image": "pulse:1.0.0"})
        status, u = call("PATCH", f"{self.E}/containers/{c['id']}", {"status": "stopped"})
        self.assertEqual(status, 200, u)
        _, again = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual(again["status"], "stopped")

    def test_delete_cascades_to_checks(self):
        _, c = call("POST", f"{self.E}/containers", {"name": unique("sql"), "image": "pulse:1.0.0"})
        for _ in range(3):
            call("POST", f"{self.E}/containers/{c['id']}/checks", {"status": "ok", "latency_ms": 1})
        status, d = call("DELETE", f"{self.E}/containers/{c['id']}")
        self.assertEqual(status, 200, d)
        self.assertEqual(d["cascaded_checks"], 3)
        self.assertEqual(d["remaining_checks"], 0)
        status, _ = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual(status, 404)

    def test_orphan_check_rejected_by_foreign_key(self):
        status, body = call("POST", f"{self.E}/containers/{uuid.uuid4()}/checks", {"status": "ok", "latency_ms": 1})
        self.assertEqual(status, 400, body)
        self.assertEqual(body["sqlstate"], "23503")  # foreign_key_violation
        self.assertEqual(body["constraint"], "health_checks_container_id_fkey")

    def test_transaction_rolls_back(self):
        status, body = call("POST", f"{self.E}/qa/transaction-rollback")
        self.assertEqual(status, 200, body)
        self.assertTrue(body["passed"])
        self.assertFalse(body["container_exists_after_rollback"])

    def test_duplicate_name_conflict(self):
        name = unique("dup")
        call("POST", f"{self.E}/containers", {"name": name, "image": "x"})
        status, _ = call("POST", f"{self.E}/containers", {"name": name, "image": "x"})
        self.assertEqual(status, 409)


class T3_NoSqlDocuments(unittest.TestCase):
    E = "/api/nosql"

    def test_create_and_read_single_query(self):
        status, c = call("POST", f"{self.E}/containers",
                         {"name": unique("doc"), "image": "pulse:1.0.0",
                          "initial_check": {"status": "ok", "latency_ms": 2}})
        self.assertEqual(status, 201, c)
        status, full = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(full["check_count"], 1)
        self.assertIn("find_one", full["query"])

    def test_push_into_embedded_array(self):
        _, c = call("POST", f"{self.E}/containers", {"name": unique("doc"), "image": "x"})
        status, k = call("POST", f"{self.E}/containers/{c['id']}/checks", {"status": "fail", "latency_ms": 9})
        self.assertEqual(status, 201, k)
        _, full = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual([x["id"] for x in full["checks"]], [k["id"]])

    def test_atomic_update_of_embedded_field(self):
        _, c = call("POST", f"{self.E}/containers",
                    {"name": unique("doc"), "image": "x", "initial_check": {"status": "ok", "latency_ms": 1}})
        chk = c["checks"][0]["id"]
        status, k = call("PATCH", f"{self.E}/containers/{c['id']}/checks/{chk}", {"detail": "investigated"})
        self.assertEqual(status, 200, k)
        _, full = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual(full["checks"][0]["detail"], "investigated")

    def test_delete_cleans_up(self):
        _, c = call("POST", f"{self.E}/containers",
                    {"name": unique("doc"), "image": "x", "initial_check": {"status": "ok", "latency_ms": 1}})
        status, d = call("DELETE", f"{self.E}/containers/{c['id']}")
        self.assertEqual(status, 200, d)
        self.assertEqual(d["documents_remaining"], 0)
        self.assertEqual(d["embedded_checks_removed"], 1)
        status, _ = call("GET", f"{self.E}/containers/{c['id']}")
        self.assertEqual(status, 404)

    def test_check_on_missing_document_404(self):
        status, _ = call("POST", f"{self.E}/containers/{uuid.uuid4()}/checks", {"status": "ok", "latency_ms": 1})
        self.assertEqual(status, 404)


class T4_ErrorHandling(unittest.TestCase):
    def test_status_codes(self):
        for e in ("sql", "nosql"):
            with self.subTest(engine=e):
                self.assertEqual(call("POST", f"/api/{e}/containers", {"name": "", "image": "x"})[0], 400)
                self.assertEqual(call("POST", f"/api/{e}/containers", {"name": "x" * 150, "image": "x"})[0], 400)
                self.assertEqual(call("GET", f"/api/{e}/containers/not-a-uuid")[0], 400)
                self.assertEqual(call("GET", f"/api/{e}/containers/{uuid.uuid4()}")[0], 404)
                self.assertEqual(call("PATCH", f"/api/{e}/containers/{uuid.uuid4()}", {"status": "stopped"})[0], 404)
                self.assertEqual(call("POST", f"/api/{e}/containers", {"name": unique('x'), "image": "x"})[0], 201)

    def test_injection_string_is_stored_as_data(self):
        name = "x'); DROP TABLE containers; --" + uuid.uuid4().hex[:6]
        status, c = call("POST", "/api/sql/containers", {"name": name, "image": "x"})
        self.assertEqual(status, 201, c)
        self.assertEqual(c["name"], name)
        self.assertEqual(call("GET", "/api/sql/containers")[0], 200)  # table still exists


if __name__ == "__main__":
    unittest.main(verbosity=2)
