from collections import defaultdict
from dataclasses import asdict, dataclass
from decimal import Decimal

from reconcile.models import Location, SystemARecord, SystemBEntry

REASON_LABELS = {
    'MISSING_IN_B': 'Missing in System B',
    'ORPHAN_IN_B': 'Orphan entry in System B',
    'DUPLICATE_IN_B': 'Duplicate entry in System B',
    'VALUE_MISMATCH': 'Different values',
    'UNPARSEABLE_VALUE': 'Blank / unparseable value',
    'VOIDED_IN_A': 'Voided in System A',
    'TENANT_MISMATCH': 'Cross-tenant boundary mismatch',
    'LOCATION_MISMATCH': 'Location mismatch within org',
    'DATE_MISMATCH': 'Date mismatch',
}


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


def _reconcile_record(
    org_id: str,
    rec: SystemARecord,
    entries: list[SystemBEntry],
) -> Disagreement | None:
    loc_id, loc_name = _location_meta(rec)

    if not entries:
        # Boolean existence check only: never load rows or location IDs from another org.
        exists_in_other_org = (
            SystemBEntry.objects.filter(normalized_record_ref=rec.record_id)
            .exclude(location__org_id=org_id)
            .exists()
        )
        if exists_in_other_org:
            return _build_disagreement(
                record_id=rec.record_id,
                reason='TENANT_MISMATCH',
                detail='System B entry exists under a different org (redacted for tenant isolation).',
                location_id=loc_id,
                location_name=loc_name,
                a_val=rec.total_value,
                a_raw=rec.raw_total_value,
                b_val=None,
                b_raw='Redacted (other org)',
            )
        return _build_disagreement(
            record_id=rec.record_id,
            reason='MISSING_IN_B',
            detail='Recorded in System A with no matching entry in System B.',
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=rec.raw_total_value,
            b_val=None,
            b_raw='-',
        )

    if len(entries) > 1:
        all_parseable = not rec.value_parse_error and all(
            not e.value_parse_error and e.value is not None for e in entries
        )
        summed_b = sum((e.value for e in entries if e.value is not None), Decimal('0.00'))
        is_valid_split = (
            all_parseable
            and rec.state == 'CONFIRMED'
            and rec.total_value is not None
            and summed_b == rec.total_value
            and any('part ' in e.label.lower() for e in entries)
        )
        if is_valid_split:
            return None

        raw_parts = ' + '.join(f'{e.entry_id}: {e.raw_value or "BLANK"}' for e in entries)
        return _build_disagreement(
            record_id=rec.record_id,
            reason='DUPLICATE_IN_B',
            detail=f'Entered {len(entries)} times in System B ({raw_parts}).',
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=rec.raw_total_value,
            b_val=summed_b if all_parseable else None,
            b_raw=raw_parts,
        )

    entry = entries[0]

    if rec.state == 'VOIDED':
        return _build_disagreement(
            record_id=rec.record_id,
            reason='VOIDED_IN_A',
            detail='System A record is VOIDED, while System B still holds an active entry.',
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=f'{rec.raw_total_value} (VOIDED)',
            b_val=entry.value,
            b_raw=entry.raw_value,
        )

    if rec.value_parse_error or entry.value_parse_error:
        bad_side = 'A' if rec.value_parse_error else 'B'
        return _build_disagreement(
            record_id=rec.record_id,
            reason='UNPARSEABLE_VALUE',
            detail=f'Blank or unparseable value in System {bad_side}.',
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=rec.raw_total_value or '(blank)',
            b_val=entry.value,
            b_raw=entry.raw_value or '(blank)',
        )

    if rec.total_value != entry.value:
        return _build_disagreement(
            record_id=rec.record_id,
            reason='VALUE_MISMATCH',
            detail=(
                f'System A total ({_fmt_dec(rec.total_value)}) differs from '
                f'System B ({_fmt_dec(entry.value)}).'
            ),
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=rec.raw_total_value,
            b_val=entry.value,
            b_raw=entry.raw_value,
        )

    if rec.location_id_raw != entry.location_id_raw:
        return _build_disagreement(
            record_id=rec.record_id,
            reason='LOCATION_MISMATCH',
            detail=f'System A has {rec.location_id_raw}, System B has {entry.location_id_raw}.',
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=rec.raw_total_value,
            b_val=entry.value,
            b_raw=entry.raw_value,
        )

    if rec.event_date != entry.recorded_on:
        return _build_disagreement(
            record_id=rec.record_id,
            reason='DATE_MISMATCH',
            detail=f'System A date ({rec.raw_event_date}) differs from System B ({entry.raw_recorded_on}).',
            location_id=loc_id,
            location_name=loc_name,
            a_val=rec.total_value,
            a_raw=f'{rec.raw_total_value} ({rec.raw_event_date})',
            b_val=entry.value,
            b_raw=f'{entry.raw_value} ({entry.raw_recorded_on})',
        )

    return None


def find_disagreements(
    org_id: str,
    reason_filter: str | None = None,
    sort_order: str | None = None,
) -> list[dict]:
    org_id = (org_id or '').strip()
    if not org_id or not Location.objects.filter(org_id=org_id).exists():
        raise ValueError(f'Unknown org_id: {org_id!r}')

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

    results: list[Disagreement] = []
    for rec in a_records:
        finding = _reconcile_record(org_id, rec, b_by_ref.get(rec.record_id, []))
        if finding is not None:
            results.append(finding)

    for ref, entries in b_by_ref.items():
        if ref in a_by_id:
            continue

        # Boolean existence check only: never load rows or location IDs from another org.
        exists_in_other_org = (
            SystemARecord.objects.filter(record_id=ref)
            .exclude(location__org_id=org_id)
            .exists()
        )
        for entry in entries:
            loc_id, loc_name = _location_meta(entry)
            if exists_in_other_org:
                results.append(
                    _build_disagreement(
                        record_id=ref or entry.entry_id,
                        reason='TENANT_MISMATCH',
                        detail=f'{entry.entry_id} points to a record belonging to another org (redacted).',
                        location_id=loc_id,
                        location_name=loc_name,
                        a_val=None,
                        a_raw='Redacted (other org)',
                        b_val=entry.value,
                        b_raw=entry.raw_value,
                    )
                )
            else:
                results.append(
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

    if reason_filter:
        results = [r for r in results if r.reason == reason_filter]

    if sort_order == 'value_asc':
        results.sort(key=lambda r: (r.sort_value, r.record_id))
    elif sort_order == 'value_desc':
        results.sort(key=lambda r: (-r.sort_value, r.record_id))
    else:
        results.sort(key=lambda r: r.record_id)

    return [r.to_dict() for r in results]
