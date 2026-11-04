"""Short, URL-safe job id generator (port of src/utils/jobId.js)."""

import os


def generate_job_id():
    """6 random bytes as hex, matching JS ``crypto.randomBytes(6).toString('hex')``."""
    return os.urandom(6).hex()


__all__ = ["generate_job_id"]