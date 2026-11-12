"""Errors shared by both repositories, mapped to HTTP status codes in app.py."""


class NotFound(Exception):
    """The container (or check) does not exist -> 404."""


class Conflict(Exception):
    """A unique constraint was violated, e.g. duplicate name -> 409."""


class ConstraintError(Exception):
    """The database rejected the write (foreign key, check constraint) -> 400."""

    def __init__(self, message, constraint=None, sqlstate=None):
        super().__init__(message)
        self.constraint = constraint
        self.sqlstate = sqlstate
