import csv
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.db import transaction

from reconcile.models import Location, SystemARecord, SystemBEntry

REF_PATTERN = re.compile(r'^(?:rec\s*-?\s*)?(\d+)$', re.IGNORECASE)


def normalize_record_ref(raw: str | None) -> str:
    """Normalize references written as 'rec1034', ' REC - 1070 ', or '1112' to 'REC-XXXX'."""
    cleaned = (raw or '').strip()
    if not cleaned:
        return ''
    match = REF_PATTERN.match(cleaned)
    if match:
        return f'REC-{int(match.group(1))}'
    return cleaned.upper()


def parse_decimal_safe(raw: str | None) -> tuple[Decimal | None, bool]:
    """Parse monetary strings including commas ('1,25,400.00') without raising on blanks."""
    cleaned = (raw or '').strip()
    if not cleaned:
        return None, True

    normalized = cleaned.replace(',', '').replace('₹', '').strip()
    try:
        amount = Decimal(normalized)
    except InvalidOperation:
        return None, True

    if not amount.is_finite():
        return None, True

    return amount.quantize(Decimal('0.01')), False


def parse_date_safe(raw: str | None) -> date | None:
    """Parse common ISO and slash date strings, returning None on blanks or invalid dates."""
    cleaned = (raw or '').strip()
    if not cleaned:
        return None
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


@transaction.atomic
def import_csv_directory(data_dir: Path, replace: bool = True) -> dict[str, int]:
    """Load all three CSV files atomically, preserving raw text alongside parsed fields."""
    if replace:
        SystemBEntry.objects.all().delete()
        SystemARecord.objects.all().delete()
        Location.objects.all().delete()

    locations_by_id: dict[str, Location] = {}
    with (data_dir / 'locations.csv').open('r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            loc_id = (row.get('location_id') or '').strip()
            loc, _ = Location.objects.update_or_create(
                location_id=loc_id,
                defaults={
                    'org_id': (row.get('org_id') or '').strip(),
                    'location_name': (row.get('location_name') or '').strip(),
                },
            )
            locations_by_id[loc_id] = loc

    a_count = 0
    with (data_dir / 'system_a.csv').open('r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            raw_id = row.get('record_id') or ''
            norm_id = normalize_record_ref(raw_id)
            loc_raw = (row.get('location_id') or '').strip()

            base_val, _ = parse_decimal_safe(row.get('base_value'))
            adj_val, _ = parse_decimal_safe(row.get('adjustment'))
            total_val, total_err = parse_decimal_safe(row.get('total_value'))

            SystemARecord.objects.update_or_create(
                record_id=norm_id,
                defaults={
                    'raw_record_id': raw_id,
                    'location': locations_by_id.get(loc_raw),
                    'location_id_raw': loc_raw,
                    'event_date': parse_date_safe(row.get('event_date')),
                    'raw_event_date': (row.get('event_date') or '').strip(),
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
            a_count += 1

    b_count = 0
    with (data_dir / 'system_b.csv').open('r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            entry_id = (row.get('entry_id') or '').strip()
            raw_ref = row.get('record_ref') or ''
            norm_ref = normalize_record_ref(raw_ref)
            loc_raw = (row.get('location_id') or '').strip()

            val, val_err = parse_decimal_safe(row.get('value'))

            SystemBEntry.objects.update_or_create(
                entry_id=entry_id,
                defaults={
                    'raw_record_ref': raw_ref,
                    'normalized_record_ref': norm_ref,
                    'location': locations_by_id.get(loc_raw),
                    'location_id_raw': loc_raw,
                    'recorded_on': parse_date_safe(row.get('recorded_on')),
                    'raw_recorded_on': (row.get('recorded_on') or '').strip(),
                    'value': val,
                    'raw_value': row.get('value') or '',
                    'value_parse_error': val_err,
                    'label': (row.get('label') or '').strip(),
                },
            )
            b_count += 1

    return {
        'locations': len(locations_by_id),
        'system_a': a_count,
        'system_b': b_count,
    }
