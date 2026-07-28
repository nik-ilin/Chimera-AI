"""
iCalendar (RFC 5545) parsing and serialisation.

Hand-written rather than pulling in a dependency: we need a small, predictable
subset (VEVENT round-tripping) and the parser is the thing standing between an
arbitrary remote .ics file and our database, so it is worth owning outright.

SUPPORTED: line unfolding, escaping, VEVENT with UID / SUMMARY / DTSTART /
DTEND / DURATION / LOCATION / DESCRIPTION / SEQUENCE / LAST-MODIFIED / STATUS,
DATE vs DATE-TIME value types, UTC (Z) and TZID-qualified local times, and
serialisation back to a valid VCALENDAR.

NOT SUPPORTED (deliberate, and it matters):
  * RRULE expansion. A recurring event is imported as its FIRST occurrence
    only, and the raw RRULE is preserved in `raw` so nothing is silently lost.
    Correct recurrence expansion (EXDATE, RDATE, timezone-aware DST edges) is a
    library's worth of work; pretending to support it would quietly put events
    on wrong days, which is worse than not importing them.
  * VTIMEZONE definitions. TZID values are resolved against the IANA database
    via zoneinfo; an unknown TZID falls back to UTC rather than failing the
    whole feed.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_LINE_ENDINGS = re.compile(r"\r\n|\n|\r")
# DURATION per RFC 5545: P[n]W or P[n]DT[n]H[n]M[n]S
_DURATION = re.compile(
    r"^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$"
)


def unfold(text: str) -> list[str]:
    """
    Undo RFC 5545 line folding.

    Long lines are split with CRLF + a single leading space or tab. Folding can
    land mid-UTF-8-character, so this must happen before any per-line parsing —
    doing it after is a classic source of mangled venue names with accents.
    """
    lines: list[str] = []
    for raw in _LINE_ENDINGS.split(text):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _unescape(value: str) -> str:
    """Reverse TEXT escaping: \\n \\, \\; \\\\ ."""
    out: list[str] = []
    i = 0
    while i < len(value):
        ch = value[i]
        if ch == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            out.append(
                "\n" if nxt in ("n", "N") else nxt if nxt in (",", ";", "\\") else nxt
            )
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _parse_line(line: str) -> tuple[str, dict[str, str], str] | None:
    """Split "NAME;PARAM=V:value" into (name, params, value)."""
    if ":" not in line:
        return None
    head, _, value = line.partition(":")
    parts = head.split(";")
    name = parts[0].upper()
    params: dict[str, str] = {}
    for param in parts[1:]:
        if "=" in param:
            key, _, val = param.partition("=")
            params[key.upper()] = val.strip('"')
    return name, params, value


def _tzinfo_for(tzid: str | None):
    """Resolve a TZID, falling back to UTC rather than dropping the event."""
    if not tzid:
        return None
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(tzid)
    except Exception:  # noqa: BLE001 — unknown/invalid TZID
        logger.warning("ics_unknown_tzid", extra={"tzid": tzid})
        return timezone.utc


def parse_datetime(value: str, params: dict[str, str]) -> tuple[datetime, bool]:
    """
    Parse a DATE or DATE-TIME. Returns (aware UTC datetime, is_all_day).

    Three forms exist and each needs different handling:
      20260804              → DATE, all-day
      20260804T210000Z      → UTC instant
      20260804T210000       → local/floating; interpreted in TZID, else UTC
    """
    value = value.strip()

    if params.get("VALUE") == "DATE" or (len(value) == 8 and "T" not in value):
        parsed = datetime.strptime(value, "%Y%m%d")
        return parsed.replace(tzinfo=timezone.utc), True

    if value.endswith("Z"):
        parsed = datetime.strptime(value, "%Y%m%dT%H%M%SZ")
        return parsed.replace(tzinfo=timezone.utc), False

    parsed = datetime.strptime(value, "%Y%m%dT%H%M%S")
    tz = _tzinfo_for(params.get("TZID")) or timezone.utc
    # Normalise to UTC immediately: the rest of the system stores UTC instants,
    # and keeping a local time around invites double-conversion bugs.
    return parsed.replace(tzinfo=tz).astimezone(timezone.utc), False


def parse_duration(value: str) -> timedelta | None:
    match = _DURATION.match(value.strip())
    if not match:
        return None
    sign, weeks, days, hours, minutes, seconds = match.groups()
    delta = timedelta(
        weeks=int(weeks or 0),
        days=int(days or 0),
        hours=int(hours or 0),
        minutes=int(minutes or 0),
        seconds=int(seconds or 0),
    )
    return -delta if sign == "-" else delta


def parse_events(text: str) -> list[dict[str, Any]]:
    """
    Extract VEVENTs as plain dicts. The CalDAV adapter maps these to
    CanonicalEvent; keeping parsing and mapping separate makes the parser
    testable on its own.
    """
    events: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for line in unfold(text):
        stripped = line.strip()
        if stripped == "BEGIN:VEVENT":
            current = {"raw": {}}
            continue
        if stripped == "END:VEVENT":
            if current is not None:
                events.append(_finalise(current))
            current = None
            continue
        if current is None:
            continue

        parsed = _parse_line(stripped)
        if parsed is None:
            continue
        name, params, value = parsed

        if name == "UID":
            current["uid"] = value.strip()
        elif name == "SUMMARY":
            current["summary"] = _unescape(value)
        elif name == "DESCRIPTION":
            current["description"] = _unescape(value)
        elif name == "LOCATION":
            current["location"] = _unescape(value)
        elif name == "DTSTART":
            start, all_day = parse_datetime(value, params)
            current["start"] = start
            current["all_day"] = all_day
        elif name == "DTEND":
            end, _ = parse_datetime(value, params)
            current["end"] = end
        elif name == "DURATION":
            current["duration"] = parse_duration(value)
        elif name == "LAST-MODIFIED":
            try:
                current["last_modified"], _ = parse_datetime(value, params)
            except ValueError:
                pass
        elif name == "SEQUENCE":
            current["sequence"] = value.strip()
        elif name == "STATUS":
            current["status"] = value.strip().upper()
        elif name == "RRULE":
            # Preserved, never expanded — see the module docstring.
            current["raw"]["rrule"] = value.strip()

    return events


def _finalise(event: dict[str, Any]) -> dict[str, Any]:
    """Derive DTEND from DURATION when only the latter was given."""
    if "end" not in event and event.get("duration") and event.get("start"):
        event["end"] = event["start"] + event["duration"]
    event.pop("duration", None)
    return event


# ─── Serialisation (used by the .ics export in Block 2) ───────────────────────


def _fold(line: str) -> str:
    """Fold to 75 octets per RFC 5545, splitting on byte boundaries."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    chunks: list[str] = []
    start = 0
    while start < len(encoded):
        end = min(start + (75 if start == 0 else 74), len(encoded))
        # Never split a multi-byte character: back off until the slice decodes.
        while end > start:
            try:
                chunks.append(encoded[start:end].decode("utf-8"))
                break
            except UnicodeDecodeError:
                end -= 1
        start = end
    return "\r\n ".join(chunks)


def _fmt_dt(value: datetime, all_day: bool) -> tuple[str, str]:
    """Return (params, value) for a DTSTART/DTEND line."""
    if all_day:
        return ";VALUE=DATE", value.astimezone(timezone.utc).strftime("%Y%m%d")
    return "", value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_calendar(events: list[dict[str, Any]], *, cal_name: str = "Chimera") -> str:
    """
    Serialise events to a VCALENDAR string.

    Each dict needs: uid, summary, start (datetime), and optionally end,
    all_day, location, description.
    """
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Chimera//Manager//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        _fold(f"X-WR-CALNAME:{_escape(cal_name)}"),
    ]

    for event in events:
        start = event["start"]
        all_day = bool(event.get("all_day"))
        start_params, start_value = _fmt_dt(start, all_day)

        lines.append("BEGIN:VEVENT")
        lines.append(_fold(f"UID:{event['uid']}"))
        lines.append(f"DTSTAMP:{now}")
        lines.append(f"DTSTART{start_params}:{start_value}")

        end = event.get("end")
        if end:
            end_params, end_value = _fmt_dt(end, all_day)
            lines.append(f"DTEND{end_params}:{end_value}")
        elif all_day:
            # An all-day DTEND is EXCLUSIVE, so a one-day event ends the NEXT
            # day. Omitting this makes some clients render a zero-length event.
            end_params, end_value = _fmt_dt(start + timedelta(days=1), True)
            lines.append(f"DTEND{end_params}:{end_value}")

        lines.append(_fold(f"SUMMARY:{_escape(event.get('summary', ''))}"))
        if event.get("location"):
            lines.append(_fold(f"LOCATION:{_escape(event['location'])}"))
        if event.get("description"):
            lines.append(_fold(f"DESCRIPTION:{_escape(event['description'])}"))

        # VALARM — this is how a Chimera reminder actually fires. We have no
        # push infrastructure, so the reminder rides along with the event and
        # the user's own calendar app raises it. It therefore keeps working
        # when Chimera is closed.
        #
        # TRIGGER is a NEGATIVE duration relative to DTSTART: -PT30M means
        # "30 minutes before". A positive value would fire AFTER the show.
        reminder = event.get("reminder_minutes")
        if reminder is not None and int(reminder) >= 0:
            minutes = int(reminder)
            if minutes == 0:
                trigger = "PT0M"
            elif minutes % 1440 == 0:
                trigger = f"-P{minutes // 1440}D"
            elif minutes % 60 == 0:
                trigger = f"-PT{minutes // 60}H"
            else:
                trigger = f"-PT{minutes}M"
            lines.append("BEGIN:VALARM")
            lines.append("ACTION:DISPLAY")
            lines.append(f"TRIGGER:{trigger}")
            lines.append(_fold(f"DESCRIPTION:{_escape(event.get('summary', 'Reminder'))}"))
            lines.append("END:VALARM")

        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
