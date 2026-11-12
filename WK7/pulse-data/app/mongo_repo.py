"""MongoDB repository.

One collection, `containers`. Each document embeds its health checks, because
the main read pattern is "show a container with its recent checks": that is a
single find_one with no joins. The embedded array is capped at the newest
MAX_CHECKS entries ($push + $slice) so a document can never grow without bound
toward MongoDB's 16 MB document limit.
"""
import logging
import uuid
from datetime import datetime, timezone

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

from errors import Conflict, NotFound

log = logging.getLogger("pulse.mongo")

MAX_CHECKS = 100


def now():
    return datetime.now(timezone.utc)


class MongoRepo:
    engine = "mongodb"

    def __init__(self, uri, db_name):
        self.client = MongoClient(uri, serverSelectionTimeoutMS=5000, tz_aware=True)
        self.col = self.client[db_name]["containers"]
        self.col.create_index([("name", ASCENDING)], unique=True, name="uniq_name")

    def close(self):
        self.client.close()

    @staticmethod
    def _log(op, *args):
        log.info("MONGO containers.%s %s", op, " ".join(str(a) for a in args))

    @staticmethod
    def _out(doc):
        doc = dict(doc)
        doc["id"] = doc.pop("_id")
        return doc

    # ---------- reads ----------

    def ping(self):
        self._log("ping")
        return self.client.admin.command("ping").get("ok") == 1

    def list_containers(self):
        pipeline = [
            {"$project": {
                "name": 1, "image": 1, "status": 1, "created_at": 1, "updated_at": 1,
                "check_count": {"$size": "$checks"},
                "last_check_at": {"$max": "$checks.checked_at"},
            }},
            {"$sort": {"created_at": -1}},
        ]
        self._log("aggregate", pipeline)
        return [self._out(d) for d in self.col.aggregate(pipeline)]

    def get_container(self, cid):
        self._log("find_one", {"_id": cid})
        doc = self.col.find_one({"_id": cid})
        if doc is None:
            raise NotFound("container not found")
        doc = self._out(doc)
        doc["checks"] = sorted(doc.get("checks", []), key=lambda c: c["checked_at"], reverse=True)
        doc["check_count"] = len(doc["checks"])
        doc["query"] = "1 MongoDB query (find_one, checks embedded)"
        return doc

    # ---------- writes ----------

    @staticmethod
    def _new_check(check):
        return {"id": str(uuid.uuid4()), "status": check["status"],
                "latency_ms": check["latency_ms"], "detail": check.get("detail"),
                "checked_at": now()}

    def create_container(self, name, image, initial_check=None):
        ts = now()
        doc = {"_id": str(uuid.uuid4()), "name": name, "image": image, "status": "running",
               "created_at": ts, "updated_at": ts,
               "checks": [self._new_check(initial_check)] if initial_check else []}
        self._log("insert_one", {"_id": doc["_id"], "name": name})
        try:
            self.col.insert_one(doc)  # one document = one atomic write
        except DuplicateKeyError as e:
            raise Conflict("unique constraint violated: uniq_name") from e
        return self.get_container(doc["_id"])

    def update_container(self, cid, fields):
        update = {"$set": {**{k: fields[k] for k in ("name", "image", "status") if k in fields},
                           "updated_at": now()}}
        self._log("find_one_and_update", {"_id": cid}, update)
        try:
            doc = self.col.find_one_and_update({"_id": cid}, update,
                                               return_document=ReturnDocument.AFTER)
        except DuplicateKeyError as e:
            raise Conflict("unique constraint violated: uniq_name") from e
        if doc is None:
            raise NotFound("container not found")
        return self.get_container(cid)

    def delete_container(self, cid):
        self._log("find_one", {"_id": cid}, "(count embedded checks)")
        doc = self.col.find_one({"_id": cid}, {"checks": 1})
        if doc is None:
            raise NotFound("container not found")
        self._log("delete_one", {"_id": cid})
        self.col.delete_one({"_id": cid})
        self._log("count_documents", {"_id": cid})
        remaining = self.col.count_documents({"_id": cid})
        return {"deleted": cid, "embedded_checks_removed": len(doc.get("checks", [])),
                "documents_remaining": remaining}

    def add_check(self, cid, check):
        new = self._new_check(check)
        update = {"$push": {"checks": {"$each": [new], "$slice": -MAX_CHECKS}},
                  "$set": {"updated_at": now()}}
        self._log("update_one", {"_id": cid}, "$push checks ($slice -%d)" % MAX_CHECKS)
        res = self.col.update_one({"_id": cid}, update)  # atomic on one document
        if res.matched_count == 0:
            raise NotFound("container not found")
        return new

    def update_check(self, cid, check_id, fields):
        sets = {f"checks.$.{k}": fields[k] for k in ("status", "detail") if k in fields}
        sets["updated_at"] = now()
        flt = {"_id": cid, "checks.id": check_id}
        self._log("update_one", flt, {"$set": sets})
        res = self.col.update_one(flt, {"$set": sets})  # positional $ = atomic embedded update
        if res.matched_count == 0:
            raise NotFound("check not found")
        doc = self.col.find_one({"_id": cid}, {"checks": {"$elemMatch": {"id": check_id}}})
        return doc["checks"][0]
