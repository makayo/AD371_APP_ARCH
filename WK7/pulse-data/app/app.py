"""Pulse Data: one API, two databases.

    /api/sql/...    -> PostgreSQL (normalized, joins, foreign keys)
    /api/nosql/...  -> MongoDB   (one document per container, checks embedded)

Both engines expose the same routes and return the same JSON shape.
"""
import atexit
import decimal
import logging
import os
import uuid
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from errors import Conflict, ConstraintError, NotFound

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pulse.api")

app = Flask(__name__, static_folder="static", static_url_path="/static")

CONTAINER_STATUSES = {"running", "stopped", "unhealthy"}
CHECK_STATUSES = {"ok", "fail"}

repos = None  # created on first use, once per worker process


def make_repos():
    from mongo_repo import MongoRepo
    from sql_repo import SqlRepo
    r = {
        "sql": SqlRepo(os.environ["DATABASE_URL"]),
        "nosql": MongoRepo(os.environ["MONGO_URL"], os.environ.get("MONGO_DB", "pulse")),
    }
    atexit.register(lambda: [x.close() for x in r.values()])
    return r


def repo(engine):
    global repos
    if engine not in ("sql", "nosql"):
        raise NotFound("unknown engine (use sql or nosql)")
    if repos is None:
        repos = make_repos()
    return repos[engine]


# ---------- JSON helpers ----------

def clean(value):
    """Make database values JSON-friendly (UUID, Decimal, datetime)."""
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def ok(data, status=200):
    return jsonify(clean(data)), status


class BadInput(Exception):
    pass


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadInput("request body must be a JSON object")
    return data


def text_field(data, key, max_len, required=True):
    value = data.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise BadInput(f"'{key}' is required and cannot be empty")
    value = value.strip()
    if len(value) > max_len:
        raise BadInput(f"'{key}' must be at most {max_len} characters (got {len(value)})")
    return value


def check_id(value, what="id"):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError):
        raise BadInput(f"invalid {what}: must be a UUID")


def parse_check(data):
    if not isinstance(data, dict):
        raise BadInput("a check must be a JSON object")
    status = data.get("status")
    if status not in CHECK_STATUSES:
        raise BadInput("'status' must be 'ok' or 'fail'")
    latency = data.get("latency_ms")
    if isinstance(latency, bool) or not isinstance(latency, (int, float)) or not 0 <= latency <= 60000:
        raise BadInput("'latency_ms' must be a number from 0 to 60000")
    check = {"status": status, "latency_ms": round(float(latency), 2)}
    if data.get("detail") not in (None, ""):
        check["detail"] = text_field(data, "detail", 500)
    return check


# ---------- error handling: every error is JSON with the right status ----------

@app.errorhandler(BadInput)
def _bad(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(ConstraintError)
def _constraint(e):
    log.warning("constraint rejected write: %s (%s %s)", e, e.sqlstate, e.constraint)
    return jsonify(error=str(e), constraint=e.constraint, sqlstate=e.sqlstate), 400


@app.errorhandler(NotFound)
def _missing(e):
    return jsonify(error=str(e)), 404


@app.errorhandler(Conflict)
def _conflict(e):
    return jsonify(error=str(e)), 409


@app.errorhandler(HTTPException)
def _http(e):
    return jsonify(error=e.description), e.code


@app.errorhandler(Exception)
def _unexpected(e):
    log.exception("unhandled error")
    return jsonify(error="internal server error"), 500


# ---------- routes ----------

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/healthz")
def healthz():
    status = {}
    for engine in ("sql", "nosql"):
        try:
            status[engine] = "ok" if repo(engine).ping() else "fail"
        except Exception as e:  # report, don't crash
            status[engine] = f"fail: {type(e).__name__}"
    code = 200 if all(v == "ok" for v in status.values()) else 503
    return jsonify(status="ok" if code == 200 else "fail", databases=status), code


@app.get("/api/<engine>/containers")
def list_containers(engine):
    return ok(repo(engine).list_containers())


@app.post("/api/<engine>/containers")
def create_container(engine):
    data = body()
    name = text_field(data, "name", 100)
    image = text_field(data, "image", 200)
    initial = parse_check(data["initial_check"]) if data.get("initial_check") else None
    return ok(repo(engine).create_container(name, image, initial), 201)


@app.get("/api/<engine>/containers/<cid>")
def get_container(engine, cid):
    return ok(repo(engine).get_container(check_id(cid)))


@app.patch("/api/<engine>/containers/<cid>")
def update_container(engine, cid):
    cid = check_id(cid)
    data = body()
    fields = {}
    if "name" in data:
        fields["name"] = text_field(data, "name", 100)
    if "image" in data:
        fields["image"] = text_field(data, "image", 200)
    if "status" in data:
        if data["status"] not in CONTAINER_STATUSES:
            raise BadInput("'status' must be running, stopped or unhealthy")
        fields["status"] = data["status"]
    if not fields:
        raise BadInput("send at least one of: name, image, status")
    return ok(repo(engine).update_container(cid, fields))


@app.delete("/api/<engine>/containers/<cid>")
def delete_container(engine, cid):
    return ok(repo(engine).delete_container(check_id(cid)))


@app.post("/api/<engine>/containers/<cid>/checks")
def add_check(engine, cid):
    return ok(repo(engine).add_check(check_id(cid), parse_check(body())), 201)


@app.patch("/api/<engine>/containers/<cid>/checks/<chk>")
def update_check(engine, cid, chk):
    data = body()
    fields = {}
    if "status" in data:
        if data["status"] not in CHECK_STATUSES:
            raise BadInput("'status' must be 'ok' or 'fail'")
        fields["status"] = data["status"]
    if "detail" in data:
        fields["detail"] = text_field(data, "detail", 500)
    if not fields:
        raise BadInput("send at least one of: status, detail")
    return ok(repo(engine).update_check(check_id(cid), check_id(chk, "check id"), fields))


@app.post("/api/sql/qa/transaction-rollback")
def transaction_rollback():
    result = repo("sql").transaction_rollback_test()
    return ok(result, 200 if result["passed"] else 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
