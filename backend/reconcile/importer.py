import csv
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.db import transaction

from reconcile.models import Location, SystemARecord, SystemBEntry

REF_PATTERN = re.compile(r'^(?:rec\s*-?\s*)?(\d+)$', re.IGNORECASE)


def normalize_record_ref(raw: str | None) -> str:
    cleaned = (raw or '').strip()
    if not cleaned:
        return ''
    match = REF_PATTERN.match(cleaned)
    if match:
        return f'REC-{match.group(1)}'
    return cleaned.upper()


def parse_decimal_safe(raw: str | None) -> tuple[Decimal | None, bool]:
    cleaned = (raw or '').strip()
    if not cleaned:
        return None, True

    normalized = cleaned.replace(',', '').replace('₹', '').strip()
    try:
        amount = Decimal(normalized)
        if not amount.is_finite():
            return None, True
        return amount.quantize(Decimal('0.01')), False
    except InvalidOperation:
        return None, True


def parse_date_safe(raw: str | None) -> date | None:
    cleaned = (raw or '').strip()
    if not cleaned:
        return None
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _load_locations(path: Path, issues: list[str]) -> dict[str, Location]:
    locations_by_id: dict[str, Location] = {}
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        for row_num, row in enumerate(csv.DictReader(f), start=2):
            loc_id = (row.get('location_id') or '').strip()
            if not loc_id:
                issues.append(f'locations.csv row {row_num}: blank location_id skipped')
                continue
            loc, created = Location.objects.update_or_create(
                location_id=loc_id,
                defaults={
                    'org_id': (row.get('org_id') or '').strip(),
                    'location_name': (row.get('location_name') or '').strip(),
                },
            )
            if not created and loc_id in locations_by_id:
                issues.append(
                    f'locations.csv row {row_num}: duplicate location_id {loc_id!r} overwrote earlier row'
                )
            locations_by_id[loc_id] = loc
    return locations_by_id


def _unique_id(base_id: str, seen_ids: set[str], row_num: int) -> str:
    if base_id not in seen_ids:
        return base_id
    candidate = f'{base_id}-DUP-ROW-{row_num}'
    suffix = 2
    while candidate in seen_ids:
        candidate = f'{base_id}-DUP-ROW-{row_num}-{suffix}'
        suffix += 1
    return candidate


def _load_system_a(path: Path, locations_by_id: dict[str, Location], issues: list[str]) -> int:
    a_count = 0
    seen_ids: set[str] = set()
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        for row_num, row in enumerate(csv.DictReader(f), start=2):
            raw_id = row.get('record_id') or ''
            cleaned_id = normalize_record_ref(raw_id)
            base_id = cleaned_id or f'BLANK-ROW-{row_num}'
            norm_id = _unique_id(base_id, seen_ids, row_num)
            if not cleaned_id:
                issues.append(f'system_a.csv row {row_num}: blank record_id stored as {norm_id!r}')
            elif norm_id != base_id:
                issues.append(
                    f'system_a.csv row {row_num}: duplicate record_id {base_id!r} (raw {raw_id!r}) preserved as {norm_id!r}'
                )
            seen_ids.add(norm_id)

            loc_raw = (row.get('location_id') or '').strip()
            loc_obj = locations_by_id.get(loc_raw)
            if loc_obj is None:
                issues.append(f'system_a.csv row {row_num} ({norm_id}): unmapped location_id {loc_raw!r}')

            base_val, _ = parse_decimal_safe(row.get('base_value'))
            adj_val, _ = parse_decimal_safe(row.get('adjustment'))
            total_val, total_err = parse_decimal_safe(row.get('total_value'))
            if total_err:
                issues.append(
                    f'system_a.csv row {row_num} ({norm_id}): unparseable total_value {row.get("total_value")!r}'
                )

            _, created = SystemARecord.objects.update_or_create(
                record_id=norm_id,
                defaults={
                    'raw_record_id': raw_id,
                    'location': loc_obj,
                    'location_id_raw': loc_raw,
                    'event_date': parse_date_safe(row.get('event_date')),
                    'raw_event_date': row.get('event_date') or '',
                    'category_code': (row.get('category_code') or '').strip(),
                    'actor_id': (row.get('actor_id') or '').strip(),
                    'base_value': base_val,
                    'raw_base_value': row.get('base_value') or '',
                    'adjustment': adj_val,
                    'raw_adjustment': row.get('adjustment') or '',
                    'total_value': total_val,
                    'raw_total_value': row.get('total_value') or '',
                    'value_parse_error': total_err,
                    'state': (row.get('state') or 'CONFIRMED').strip().upper(),
                },
            )
            if created:
                a_count += 1
    return a_count


def _load_system_b(path: Path, locations_by_id: dict[str, Location], issues: list[str]) -> int:
    b_count = 0
    seen_ids: set[str] = set()
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        for row_num, row in enumerate(csv.DictReader(f), start=2):
            raw_entry_id = (row.get('entry_id') or '').strip()
            base_entry_id = raw_entry_id or f'BLANK-ENTRY-{row_num}'
            entry_id = _unique_id(base_entry_id, seen_ids, row_num)
            if not raw_entry_id:
                issues.append(f'system_b.csv row {row_num}: blank entry_id stored as {entry_id!r}')
            elif entry_id != base_entry_id:
                issues.append(
                    f'system_b.csv row {row_num}: duplicate entry_id {base_entry_id!r} preserved as {entry_id!r}'
                )
            seen_ids.add(entry_id)

            raw_ref = row.get('record_ref') or ''
            norm_ref = normalize_record_ref(raw_ref)
            loc_raw = (row.get('location_id') or '').strip()
            loc_obj = locations_by_id.get(loc_raw)
            if loc_obj is None:
                issues.append(f'system_b.csv row {row_num} ({entry_id}): unmapped location_id {loc_raw!r}')

            val, val_err = parse_decimal_safe(row.get('value'))
            if val_err:
                issues.append(
                    f'system_b.csv row {row_num} ({entry_id}): unparseable value {row.get("value")!r}'
                )

            _, created = SystemBEntry.objects.update_or_create(
                entry_id=entry_id,
                defaults={
                    'raw_record_ref': raw_ref,
                    'normalized_record_ref': norm_ref,
                    'location': loc_obj,
                    'location_id_raw': loc_raw,
                    'recorded_on': parse_date_safe(row.get('recorded_on')),
                    'raw_recorded_on': row.get('recorded_on') or '',
                    'value': val,
                    'raw_value': row.get('value') or '',
                    'value_parse_error': val_err,
                    'label': (row.get('label') or '').strip(),
                },
            )
            if created:
                b_count += 1
    return b_count


@transaction.atomic
def import_csv_directory(data_dir: Path, replace: bool = True) -> dict[str, int | list[str]]:
    if replace:
        SystemBEntry.objects.all().delete()
        SystemARecord.objects.all().delete()
        Location.objects.all().delete()

    issues: list[str] = []
    locations_by_id = _load_locations(data_dir / 'locations.csv', issues)
    a_count = _load_system_a(data_dir / 'system_a.csv', locations_by_id, issues)
    b_count = _load_system_b(data_dir / 'system_b.csv', locations_by_id, issues)

    return {
        'locations': len(locations_by_id),
        'system_a': a_count,
        'system_b': b_count,
        'issues': issues,
    }

