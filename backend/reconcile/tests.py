from datetime import date
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from reconcile.comparator import find_disagreements
from reconcile.importer import import_csv_directory, normalize_record_ref, parse_decimal_safe
from reconcile.models import Location, SystemARecord, SystemBEntry


class ReconciliationTests(TestCase):
    def setUp(self):
        self.loc_a1 = Location.objects.create(
            location_id='LOC-101', org_id='ORG-A', location_name='Location 101'
        )
        self.loc_a2 = Location.objects.create(
            location_id='LOC-102', org_id='ORG-A', location_name='Location 102'
        )
        self.loc_b1 = Location.objects.create(
            location_id='LOC-201', org_id='ORG-B', location_name='Location 201'
        )

    def _create_a(self, record_id='REC-1001', location=None, total='1000.00', state='CONFIRMED', event_date=date(2026, 3, 1)):
        loc = location or self.loc_a1
        return SystemARecord.objects.create(
            record_id=record_id,
            raw_record_id=record_id,
            location=loc,
            location_id_raw=loc.location_id,
            event_date=event_date,
            raw_event_date=event_date.isoformat(),
            total_value=Decimal(total) if total is not None else None,
            raw_total_value=total or '',
            value_parse_error=total is None,
            state=state,
        )

    def _create_b(
        self,
        entry_id='ENT/2026/4001',
        raw_ref='REC-1001',
        location=None,
        raw_value='1000.00',
        recorded_on=date(2026, 3, 1),
        label='Entry for CAT-01',
    ):
        loc = location or self.loc_a1
        val, err = parse_decimal_safe(raw_value)
        return SystemBEntry.objects.create(
            entry_id=entry_id,
            raw_record_ref=raw_ref,
            normalized_record_ref=normalize_record_ref(raw_ref),
            location=loc,
            location_id_raw=loc.location_id,
            recorded_on=recorded_on,
            raw_recorded_on=recorded_on.isoformat(),
            value=val,
            raw_value=raw_value,
            value_parse_error=err,
            label=label,
        )

    def test_catches_missing_in_b(self):
        self._create_a(record_id='REC-1015', total='41095.33')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'MISSING_IN_B')
        self.assertEqual(rows[0]['record_id'], 'REC-1015')

    def test_catches_orphan_in_b(self):
        self._create_b(entry_id='ENT/2026/4901', raw_ref='REC-1999', raw_value='41250.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'ORPHAN_IN_B')
        self.assertEqual(rows[0]['record_id'], 'REC-1999')

    def test_catches_duplicate_in_b(self):
        self._create_a(record_id='REC-1042', total='112837.06')
        self._create_b(entry_id='ENT/2026/4042', raw_ref='REC-1042', raw_value='112837.06')
        self._create_b(entry_id='ENT/2026/4902', raw_ref='REC-1042', raw_value='112837.06')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'DUPLICATE_IN_B')

    def test_allows_valid_split_payment_as_non_error(self):
        self._create_a(record_id='REC-1055', total='179877.32')
        self._create_b(
            entry_id='ENT/2026/4055',
            raw_ref='REC-1055',
            raw_value='71950.93',
            label='Entry for CAT-08',
        )
        self._create_b(
            entry_id='ENT/2026/4903',
            raw_ref='REC-1055',
            raw_value='107926.39',
            label='Entry part 2 of 2',
        )
        rows = find_disagreements('ORG-A')
        self.assertEqual(rows, [])

    def test_allows_messy_record_ref_formats_as_non_error(self):
        self._create_a(record_id='REC-1034', total='84939.99')
        self._create_a(record_id='REC-1070', total='1608.95')
        self._create_a(record_id='REC-1112', total='52028.74')

        self._create_b(entry_id='ENT/2026/4034', raw_ref='rec1034', raw_value='84939.99')
        self._create_b(entry_id='ENT/2026/4070', raw_ref=' REC - 1070 ', raw_value='1608.95')
        self._create_b(entry_id='ENT/2026/4112', raw_ref='1112', raw_value='52028.74')

        rows = find_disagreements('ORG-A')
        self.assertEqual(rows, [])

    def test_catches_value_mismatch_with_indian_comma_formatting(self):
        self._create_a(record_id='REC-1064', total='183244.16')
        self._create_b(entry_id='ENT/2026/4064', raw_ref='REC-1064', raw_value='1,25,400.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'VALUE_MISMATCH')
        self.assertEqual(rows[0]['system_b_value'], '125400.00')
        self.assertEqual(rows[0]['system_b_raw'], '1,25,400.00')

    def test_catches_blank_and_unparseable_value(self):
        self._create_a(record_id='REC-1050', total='160405.85')
        self._create_b(entry_id='ENT/2026/4050', raw_ref='REC-1050', raw_value='')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'UNPARSEABLE_VALUE')

    def test_catches_voided_record_in_system_a(self):
        self._create_a(record_id='REC-1019', total='57092.35', state='VOIDED')
        self._create_b(entry_id='ENT/2026/4019', raw_ref='REC-1019', raw_value='57092.35')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'VOIDED_IN_A')

    def test_catches_date_mismatch(self):
        self._create_a(record_id='REC-1009', total='111699.30', event_date=date(2026, 3, 31))
        self._create_b(entry_id='ENT/2026/4009', raw_ref='REC-1009', raw_value='111699.30', recorded_on=date(2026, 4, 2))
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'DATE_MISMATCH')

    def test_cross_tenant_mismatch_does_not_leak_other_org(self):
        # System A says ORG-A (LOC-102), System B says ORG-B (LOC-201)
        self._create_a(record_id='REC-1077', location=self.loc_a2, total='83361.40')
        self._create_b(entry_id='ENT/2026/4077', raw_ref='REC-1077', location=self.loc_b1, raw_value='83361.40')

        org_a_rows = find_disagreements('ORG-A')
        org_b_rows = find_disagreements('ORG-B')

        self.assertEqual(len(org_a_rows), 1)
        self.assertEqual(org_a_rows[0]['reason'], 'TENANT_MISMATCH')
        self.assertNotIn('LOC-201', str(org_a_rows[0]))
        self.assertNotIn('ORG-B', str(org_a_rows[0]))

        self.assertEqual(len(org_b_rows), 1)
        self.assertEqual(org_b_rows[0]['reason'], 'TENANT_MISMATCH')
        self.assertNotIn('LOC-102', str(org_b_rows[0]))
        self.assertNotIn('ORG-A', str(org_b_rows[0]))

    def test_api_requires_org_and_imports_full_csv_dataset(self):
        data_dir = Path(settings.BASE_DIR).parent / 'data'
        counts = import_csv_directory(data_dir, replace=True)
        self.assertEqual(counts, {'locations': 5, 'system_a': 120, 'system_b': 121})

        client = APIClient()
        missing_org = client.get('/api/disagreements/')
        self.assertEqual(missing_org.status_code, 400)

        resp_a = client.get('/api/disagreements/?org=ORG-A&sort=value_desc')
        self.assertEqual(resp_a.status_code, 200)
        self.assertEqual(resp_a.json()['count'], 7)

        resp_b = client.get('/api/disagreements/?org=ORG-B')
        self.assertEqual(resp_b.status_code, 200)
        self.assertEqual(resp_b.json()['count'], 6)
