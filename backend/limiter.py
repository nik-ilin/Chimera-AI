"""
Rate limiter instance — shared across main.py and all route modules.
Defined here to break the circular import:
  main.py → routes/*.py → main.limiter (circular)
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
