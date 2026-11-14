from collections import defaultdict
from dataclasses import asdict, dataclass
from decimal import Decimal

from reconcile.models import Location, SystemARecord, SystemBEntry

REASON_LABELS = {
    'MISSING_IN_B': 'Missing in System B',
    'ORPHAN_IN_B': 'Orphan entry in System B',
    'DUPLICATE_IN_B': 'Duplicate entry in System B',
    'VALUE_MISMATCH': 'Different values',
    'UNPARSEABLE_VALUE': 'Blank or unparseable value',
    'VOIDED_IN_A': 'Voided in System A',
    'TENANT_MISMATCH': 'Cross-tenant boundary mismatch',
    'LOCATION_MISMATCH': 'Location mismatch within org',
    'DATE_MISMATCH': 'Date mismatch',
}

VALID_SORT_ORDERS = {'value_asc', 'value_desc'}


@dataclass
class Disagreement:
    record_id: str
    reason: str
    reason_label: str
    detail: str
    location_id: str
    location_name: str
    system_a_value: str | None
    system_a_raw: str
    system_b_value: str | None
    system_b_raw: str
    sort_value: float

    def to_dict(self) -> dict:
        return asdict(self)


def _fmt_dec(val: Decimal | None) -> str | None:
    return f'{val:.2f}' if val is not None else None


def _location_meta(row: SystemARecord | SystemBEntry) -> tuple[str, str]:
    if row.location:
        return row.location.location_id, row.location.location_name
    return row.location_id_raw, row.location_id_raw


def _build_disagreement(
    *,
    record_id: str,
    reason: str,
    detail: str,
    location_id: str,
    location_name: str,
    a_val: Decimal | None,
    a_raw: str,
    b_val: Decimal | None,
    b_raw: str,
) -> Disagreement:
    candidates = [abs(v) for v in (a_val, b_val) if v is not None]
    return Disagreement(
        record_id=record_id,
        reason=reason,
        reason_label=REASON_LABELS[reason],
        detail=detail,
        location_id=location_id,
        location_name=location_name,
        system_a_value=_fmt_dec(a_val),
        system_a_raw=a_raw,
        system_b_value=_fmt_dec(b_val),
        system_b_raw=b_raw,
        sort_value=float(max(candidates)) if candidates else 0.0,
    )


def _for_record(
    rec: SystemARecord,
    *,
    reason: str,
    detail: str,
    b_val: Decimal | None = None,
    b_raw: str = '-',
    a_raw: str | None = None,
) -> Disagreement:
    loc_id, loc_name = _location_meta(rec)
    return _build_disagreement(
        record_id=rec.record_id,
        reason=reason,
        detail=detail,
        location_id=loc_id,
        location_name=loc_name,
        a_val=rec.total_value,
        a_raw=rec.raw_total_value if a_raw is None else a_raw,
        b_val=b_val,
        b_raw=b_raw,
    )


def _reconcile_multi_entry(rec: SystemARecord, entries: list[SystemBEntry]) -> Disagreement | None:
    all_parseable = not rec.value_parse_error and all(
        not e.value_parse_error and e.value is not None for e in entries
    )
    summed_b = sum((e.value for e in entries if e.value is not None), Decimal('0.00'))
    is_valid_split = (
        all_parseable
        and rec.total_value is not None
        and summed_b == rec.total_value
    )
    if is_valid_split:
        for entry in entries:
            if rec.location_id_raw != entry.location_id_raw:
                return _for_record(
                    rec,
                    reason='LOCATION_MISMATCH',
                    detail=f'System A has {rec.location_id_raw}, System B {entry.entry_id} has {entry.location_id_raw}.',
                    b_val=summed_b,
                    b_raw=f'{summed_b:.2f}',
                )
            if rec.event_date != entry.recorded_on:
                return _for_record(
                    rec,
                    reason='DATE_MISMATCH',
                    detail=f'System A date ({rec.raw_event_date}) differs from System B {entry.entry_id} ({entry.raw_recorded_on}).',
                    a_raw=f'{rec.raw_total_value} ({rec.raw_event_date})',
                    b_val=summed_b,
                    b_raw=f'{summed_b:.2f} ({entry.raw_recorded_on})',
                )
        return None

    raw_parts = ' + '.join(f'{e.entry_id}: {e.raw_value or "(blank)"}' for e in entries)
    return _for_record(
        rec,
        reason='DUPLICATE_IN_B',
        detail=f'Entered {len(entries)} times in System B ({raw_parts}).',
        b_val=summed_b if all_parseable else None,
        b_raw=raw_parts,
    )


def _format_value_mismatch_detail(rec: SystemARecord, entry: SystemBEntry) -> str:
    detail = f'System A total ({_fmt_dec(rec.total_value)}) differs from System B ({_fmt_dec(entry.value)}).'
    if rec.base_value is not None and entry.value == rec.base_value:
        detail += (
            f' System B matches System A base_value ({_fmt_dec(rec.base_value)}) '
            f'without adjustment ({_fmt_dec(rec.adjustment)}).'
        )
    return detail


def _reconcile_record(
    rec: SystemARecord,
    entries: list[SystemBEntry],
    other_org_b_refs: set[str],
) -> Disagreement | None:
    if not entries:
        if rec.record_id in other_org_b_refs:
            return _for_record(
                rec,
                reason='TENANT_MISMATCH',
                detail='System B entry exists under a different org (redacted for tenant isolation).',
                b_raw='Redacted (other org)',
            )
        return _for_record(
            rec,
            reason='MISSING_IN_B',
            detail='Recorded in System A with no matching entry in System B.',
        )

    if rec.state == 'VOIDED':
        b_val = entries[0].value if len(entries) == 1 else None
        b_raw = (
            (entries[0].raw_value or '(blank)')
            if len(entries) == 1
            else ' + '.join(f'{e.entry_id}: {e.raw_value or "(blank)"}' for e in entries)
        )
        return _for_record(
            rec,
            reason='VOIDED_IN_A',
            detail='System A record is VOIDED, while System B still holds an active entry.',
            a_raw=f'{rec.raw_total_value} (VOIDED)',
            b_val=b_val,
            b_raw=b_raw,
        )

    if len(entries) > 1:
        return _reconcile_multi_entry(rec, entries)

    entry = entries[0]

    if rec.value_parse_error or entry.value_parse_error:
        if rec.value_parse_error and entry.value_parse_error:
            bad_side = 'System A and System B'
        elif rec.value_parse_error:
            bad_side = 'System A'
        else:
            bad_side = 'System B'
        return _for_record(
            rec,
            reason='UNPARSEABLE_VALUE',
            detail=f'Blank or unparseable value in {bad_side}.',
            a_raw=rec.raw_total_value or '(blank)',
            b_val=entry.value,
            b_raw=entry.raw_value or '(blank)',
        )

    if rec.total_value != entry.value:
        return _for_record(
            rec,
            reason='VALUE_MISMATCH',
            detail=_format_value_mismatch_detail(rec, entry),
            b_val=entry.value,
            b_raw=entry.raw_value,
        )

    if rec.location_id_raw != entry.location_id_raw:
        return _for_record(
            rec,
            reason='LOCATION_MISMATCH',
            detail=f'System A has {rec.location_id_raw}, System B has {entry.location_id_raw}.',
            b_val=entry.value,
            b_raw=entry.raw_value,
        )

    raw_date_mismatch = (
        rec.event_date is None
        and entry.recorded_on is None
        and rec.raw_event_date.strip() != entry.raw_recorded_on.strip()
    )
    if rec.event_date != entry.recorded_on or raw_date_mismatch:
        return _for_record(
            rec,
            reason='DATE_MISMATCH',
            detail=f'System A date ({rec.raw_event_date or "(blank)"}) differs from System B ({entry.raw_recorded_on or "(blank)"}).',
            a_raw=f'{rec.raw_total_value} ({rec.raw_event_date or "(blank)"})',
            b_val=entry.value,
            b_raw=f'{entry.raw_value} ({entry.raw_recorded_on or "(blank)"})',
        )

    return None


def _reconcile_orphan_entries(
    ref: str,
    entries: list[SystemBEntry],
    in_other_org: bool,
) -> list[Disagreement]:
    rows: list[Disagreement] = []
    for entry in entries:
        loc_id, loc_name = _location_meta(entry)
        if in_other_org:
            rows.append(
                _build_disagreement(
                    record_id=ref or entry.entry_id,
                    reason='TENANT_MISMATCH',
                    detail=f'{entry.entry_id} points to a record belonging to another org (redacted).',
                    location_id=loc_id,
                    location_name=loc_name,
                    a_val=None,
                    a_raw='Redacted (other org)',
                    b_val=entry.value,
                    b_raw=entry.raw_value or '(blank)',
                )
            )
        else:
            rows.append(
                _build_disagreement(
                    record_id=ref or entry.entry_id,
                    reason='ORPHAN_IN_B',
                    detail=f'{entry.entry_id} points to {entry.raw_record_ref!r}, which does not exist in System A.',
                    location_id=loc_id,
                    location_name=loc_name,
                    a_val=None,
                    a_raw='-',
                    b_val=entry.value,
                    b_raw=entry.raw_value or '(blank)',
                )
            )
    return rows


def find_disagreements(
    org_id: str,
    reason_filter: str | None = None,
    sort_order: str | None = None,
) -> list[dict]:
    org_id = (org_id or '').strip()
    if not org_id or not Location.objects.filter(org_id=org_id).exists():
        raise ValueError(f'Unknown org_id: {org_id!r}')
    if reason_filter and reason_filter not in REASON_LABELS:
        raise ValueError(f'Unknown reason: {reason_filter!r}')
    if sort_order and sort_order not in VALID_SORT_ORDERS:
        raise ValueError(f'Unknown sort order: {sort_order!r}')

    a_records = list(
        SystemARecord.objects.select_related('location')
        .filter(location__org_id=org_id)
        .order_by('record_id')
    )
    b_entries = list(
        SystemBEntry.objects.select_related('location')
        .filter(location__org_id=org_id)
        .order_by('entry_id')
    )

    a_by_id = {rec.record_id: rec for rec in a_records}
    b_by_ref: dict[str, list[SystemBEntry]] = defaultdict(list)
    for entry in b_entries:
        b_by_ref[entry.normalized_record_ref].append(entry)

    missing_a_ids = [rec.record_id for rec in a_records if rec.record_id not in b_by_ref]
    orphan_b_refs = [ref for ref in b_by_ref if ref not in a_by_id]

    # Membership checks only: never select org, location, or value fields from another tenant.
    other_org_b_refs = (
        set(
            SystemBEntry.objects.filter(normalized_record_ref__in=missing_a_ids, location__isnull=False)
            .exclude(location__org_id=org_id)
            .values_list('normalized_record_ref', flat=True)
        )
        if missing_a_ids
        else set()
    )
    other_org_a_ids = (
        set(
            SystemARecord.objects.filter(record_id__in=orphan_b_refs, location__isnull=False)
            .exclude(location__org_id=org_id)
            .values_list('record_id', flat=True)
        )
        if orphan_b_refs
        else set()
    )

    results: list[Disagreement] = []
    for rec in a_records:
        finding = _reconcile_record(rec, b_by_ref.get(rec.record_id, []), other_org_b_refs)
        if finding is not None:
            results.append(finding)

    for ref, entries in b_by_ref.items():
        if ref not in a_by_id:
            results.extend(_reconcile_orphan_entries(ref, entries, ref in other_org_a_ids))

    if reason_filter:
        results = [r for r in results if r.reason == reason_filter]

    if sort_order == 'value_asc':
        results.sort(key=lambda r: (r.sort_value, r.record_id))
    elif sort_order == 'value_desc':
        results.sort(key=lambda r: (-r.sort_value, r.record_id))
    else:
        results.sort(key=lambda r: r.record_id)

    return [r.to_dict() for r in results]
