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
    if val is None:
        return None
    return f'{val:.2f}'


def _sort_key(a_val: Decimal | None, b_val: Decimal | None) -> float:
    candidates = [abs(v) for v in (a_val, b_val) if v is not None]
    return float(max(candidates)) if candidates else 0.0


def find_disagreements(
    org_id: str,
    reason_filter: str | None = None,
    sort_order: str | None = None,
) -> list[dict]:
    """
    Compare System A and System B strictly within a single tenant (org_id).
    Never returns rows or location identifiers belonging to any other org.
    """
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

    a_by_id: dict[str, SystemARecord] = {rec.record_id: rec for rec in a_records}
    b_by_ref: dict[str, list[SystemBEntry]] = defaultdict(list)
    for entry in b_entries:
        b_by_ref[entry.normalized_record_ref].append(entry)

    results: list[Disagreement] = []

    # 1. Inspect every System A record owned by this org
    for rec in a_records:
        entries = b_by_ref.get(rec.record_id, [])
        loc_id = rec.location.location_id if rec.location else rec.location_id_raw
        loc_name = rec.location.location_name if rec.location else rec.location_id_raw

        if not entries:
            # Check existence across boundary WITHOUT reading the other org's data
            exists_in_other_org = (
                SystemBEntry.objects.filter(normalized_record_ref=rec.record_id)
                .exclude(location__org_id=org_id)
                .exists()
            )
            if exists_in_other_org:
                results.append(
                    Disagreement(
                        record_id=rec.record_id,
                        reason='TENANT_MISMATCH',
                        reason_label=REASON_LABELS['TENANT_MISMATCH'],
                        detail='System B entry exists under a different org (redacted for tenant isolation).',
                        location_id=loc_id,
                        location_name=loc_name,
                        system_a_value=_fmt_dec(rec.total_value),
                        system_a_raw=rec.raw_total_value,
                        system_b_value=None,
                        system_b_raw='Redacted (other org)',
                        sort_value=_sort_key(rec.total_value, None),
                    )
                )
            else:
                results.append(
                    Disagreement(
                        record_id=rec.record_id,
                        reason='MISSING_IN_B',
                        reason_label=REASON_LABELS['MISSING_IN_B'],
                        detail='Recorded in System A with no matching entry in System B.',
                        location_id=loc_id,
                        location_name=loc_name,
                        system_a_value=_fmt_dec(rec.total_value),
                        system_a_raw=rec.raw_total_value,
                        system_b_value=None,
                        system_b_raw='—',
                        sort_value=_sort_key(rec.total_value, None),
                    )
                )
            continue

        # Multi-entry in System B: distinguish valid split payment vs duplicate
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
                # Non-error: multi-part settlement that reconciles to the exact paisa
                continue

            raw_parts = ' + '.join(f'{e.entry_id}: {e.raw_value or "BLANK"}' for e in entries)
            results.append(
                Disagreement(
                    record_id=rec.record_id,
                    reason='DUPLICATE_IN_B',
                    reason_label=REASON_LABELS['DUPLICATE_IN_B'],
                    detail=f'Entered {len(entries)} times in System B ({raw_parts}).',
                    location_id=loc_id,
                    location_name=loc_name,
                    system_a_value=_fmt_dec(rec.total_value),
                    system_a_raw=rec.raw_total_value,
                    system_b_value=_fmt_dec(summed_b) if all_parseable else None,
                    system_b_raw=raw_parts,
                    sort_value=_sort_key(rec.total_value, summed_b if all_parseable else None),
                )
            )
            continue

        # Exactly 1 matching System B entry in the same org
        entry = entries[0]

        if rec.state == 'VOIDED':
            results.append(
                Disagreement(
                    record_id=rec.record_id,
                    reason='VOIDED_IN_A',
                    reason_label=REASON_LABELS['VOIDED_IN_A'],
                    detail='System A record is VOIDED, but System B still holds an active entry.',
                    location_id=loc_id,
                    location_name=loc_name,
                    system_a_value=_fmt_dec(rec.total_value),
                    system_a_raw=f'{rec.raw_total_value} (VOIDED)',
                    system_b_value=_fmt_dec(entry.value),
                    system_b_raw=entry.raw_value,
                    sort_value=_sort_key(rec.total_value, entry.value),
                )
            )
            continue

        if rec.value_parse_error or entry.value_parse_error:
            results.append(
                Disagreement(
                    record_id=rec.record_id,
                    reason='UNPARSEABLE_VALUE',
                    reason_label=REASON_LABELS['UNPARSEABLE_VALUE'],
                    detail=f'Blank or unparseable value in System {"A" if rec.value_parse_error else "B"}.',
                    location_id=loc_id,
                    location_name=loc_name,
                    system_a_value=_fmt_dec(rec.total_value),
                    system_a_raw=rec.raw_total_value or '(blank)',
                    system_b_value=_fmt_dec(entry.value),
                    system_b_raw=entry.raw_value or '(blank)',
                    sort_value=_sort_key(rec.total_value, entry.value),
                )
            )
            continue

        if rec.total_value != entry.value:
            results.append(
                Disagreement(
                    record_id=rec.record_id,
                    reason='VALUE_MISMATCH',
                    reason_label=REASON_LABELS['VALUE_MISMATCH'],
                    detail=(
                        f'System A total ({_fmt_dec(rec.total_value)}) differs from '
                        f'System B ({_fmt_dec(entry.value)}).'
                    ),
                    location_id=loc_id,
                    location_name=loc_name,
                    system_a_value=_fmt_dec(rec.total_value),
                    system_a_raw=rec.raw_total_value,
                    system_b_value=_fmt_dec(entry.value),
                    system_b_raw=entry.raw_value,
                    sort_value=_sort_key(rec.total_value, entry.value),
                )
            )
            continue

        if rec.location_id_raw != entry.location_id_raw:
            results.append(
                Disagreement(
                    record_id=rec.record_id,
                    reason='LOCATION_MISMATCH',
                    reason_label=REASON_LABELS['LOCATION_MISMATCH'],
                    detail=f'System A has {rec.location_id_raw}, System B has {entry.location_id_raw}.',
                    location_id=loc_id,
                    location_name=loc_name,
                    system_a_value=_fmt_dec(rec.total_value),
                    system_a_raw=rec.raw_total_value,
                    system_b_value=_fmt_dec(entry.value),
                    system_b_raw=entry.raw_value,
                    sort_value=_sort_key(rec.total_value, entry.value),
                )
            )
            continue

        if rec.event_date != entry.recorded_on:
            results.append(
                Disagreement(
                    record_id=rec.record_id,
                    reason='DATE_MISMATCH',
                    reason_label=REASON_LABELS['DATE_MISMATCH'],
                    detail=f'System A date ({rec.raw_event_date}) differs from System B ({entry.raw_recorded_on}).',
                    location_id=loc_id,
                    location_name=loc_name,
                    system_a_value=_fmt_dec(rec.total_value),
                    system_a_raw=f'{rec.raw_total_value} ({rec.raw_event_date})',
                    system_b_value=_fmt_dec(entry.value),
                    system_b_raw=f'{entry.raw_value} ({entry.raw_recorded_on})',
                    sort_value=_sort_key(rec.total_value, entry.value),
                )
            )

    # 2. Inspect System B entries in this org that have no System A match in this org
    for ref, entries in b_by_ref.items():
        if ref in a_by_id:
            continue

        exists_in_other_org = (
            SystemARecord.objects.filter(record_id=ref)
            .exclude(location__org_id=org_id)
            .exists()
        )
        for entry in entries:
            loc_id = entry.location.location_id if entry.location else entry.location_id_raw
            loc_name = entry.location.location_name if entry.location else entry.location_id_raw
            if exists_in_other_org:
                results.append(
                    Disagreement(
                        record_id=ref or entry.entry_id,
                        reason='TENANT_MISMATCH',
                        reason_label=REASON_LABELS['TENANT_MISMATCH'],
                        detail=f'{entry.entry_id} points to a record belonging to another org (redacted).',
                        location_id=loc_id,
                        location_name=loc_name,
                        system_a_value=None,
                        system_a_raw='Redacted (other org)',
                        system_b_value=_fmt_dec(entry.value),
                        system_b_raw=entry.raw_value,
                        sort_value=_sort_key(None, entry.value),
                    )
                )
            else:
                results.append(
                    Disagreement(
                        record_id=ref or entry.entry_id,
                        reason='ORPHAN_IN_B',
                        reason_label=REASON_LABELS['ORPHAN_IN_B'],
                        detail=f'{entry.entry_id} points to {entry.raw_record_ref!r}, which does not exist in System A.',
                        location_id=loc_id,
                        location_name=loc_name,
                        system_a_value=None,
                        system_a_raw='—',
                        system_b_value=_fmt_dec(entry.value),
                        system_b_raw=entry.raw_value or '(blank)',
                        sort_value=_sort_key(None, entry.value),
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
