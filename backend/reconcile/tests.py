import tempfile
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
            raw_event_date=event_date.isoformat() if event_date else '',
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
            raw_recorded_on=recorded_on.isoformat() if recorded_on else '',
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
            label='Entry for CAT-08',
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

    def test_value_mismatch_notes_when_system_b_matches_base_value(self):
        rec = self._create_a(record_id='REC-1027', total='60516.70')
        rec.base_value = Decimal('61921.12')
        rec.adjustment = Decimal('-1404.42')
        rec.save()
        self._create_b(entry_id='ENT/2026/4027', raw_ref='REC-1027', raw_value='61921.12')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'VALUE_MISMATCH')
        self.assertIn('base_value (61921.12)', rows[0]['detail'])

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

    def test_catches_location_mismatch_within_same_org(self):
        self._create_a(record_id='REC-1080', location=self.loc_a1, total='25000.00')
        self._create_b(entry_id='ENT/2026/4080', raw_ref='REC-1080', location=self.loc_a2, raw_value='25000.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'LOCATION_MISMATCH')
        self.assertIn('LOC-101', rows[0]['detail'])
        self.assertIn('LOC-102', rows[0]['detail'])

    def test_split_payment_still_flags_location_mismatch(self):
        self._create_a(record_id='REC-1056', location=self.loc_a1, total='1000.00')
        self._create_b(entry_id='ENT/2026/4056', raw_ref='REC-1056', location=self.loc_a1, raw_value='400.00')
        self._create_b(
            entry_id='ENT/2026/4904',
            raw_ref='REC-1056',
            location=self.loc_a2,
            raw_value='600.00',
            label='Entry part 2 of 2',
        )
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'LOCATION_MISMATCH')

    def test_voided_record_with_multiple_entries_flags_voided_not_duplicate(self):
        self._create_a(record_id='REC-1020', total='1000.00', state='VOIDED')
        self._create_b(entry_id='ENT/2026/4020', raw_ref='REC-1020', raw_value='500.00')
        self._create_b(entry_id='ENT/2026/4905', raw_ref='REC-1020', raw_value='500.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'VOIDED_IN_A')

    def test_unmapped_location_does_not_trigger_false_tenant_mismatch(self):
        self._create_a(record_id='REC-1090', location=self.loc_a1, total='5000.00')
        SystemBEntry.objects.create(
            entry_id='ENT/2026/4090',
            raw_record_ref='REC-1090',
            normalized_record_ref='REC-1090',
            location=None,
            location_id_raw='LOC-UNKNOWN',
            recorded_on=date(2026, 3, 1),
            raw_recorded_on='2026-03-01',
            value=Decimal('5000.00'),
            raw_value='5000.00',
            value_parse_error=False,
        )
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'MISSING_IN_B')

    def test_parse_decimal_safe_handles_excess_precision(self):
        val, err = parse_decimal_safe('123456789012345678901234567890.123')
        self.assertIsNone(val)
        self.assertTrue(err)

    def test_cross_tenant_mismatch_does_not_leak_other_org(self):
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

    def test_sort_handles_null_and_mixed_values(self):
        self._create_a(record_id='REC-0001', total=None)
        self._create_b(entry_id='ENT/2026/0001', raw_ref='REC-0001', raw_value='')
        self._create_a(record_id='REC-0002', total='50.00')
        self._create_a(record_id='REC-0003', total='250.00')

        asc = find_disagreements('ORG-A', sort_order='value_asc')
        desc = find_disagreements('ORG-A', sort_order='value_desc')
        self.assertEqual([r['record_id'] for r in asc], ['REC-0001', 'REC-0002', 'REC-0003'])
        self.assertEqual([r['record_id'] for r in desc], ['REC-0003', 'REC-0002', 'REC-0001'])

    def test_api_endpoints_validation_filtering_and_full_csv_import(self):
        data_dir = Path(settings.BASE_DIR).parent / 'data'
        counts = import_csv_directory(data_dir, replace=True)
        self.assertEqual(counts['locations'], 5)
        self.assertEqual(counts['system_a'], 120)
        self.assertEqual(counts['system_b'], 121)
        self.assertEqual(
            counts['issues'],
            ["system_b.csv row 50 (ENT/2026/4050): unparseable value ''"],
        )

        client = APIClient()

        orgs_resp = client.get('/api/orgs/')
        self.assertEqual(orgs_resp.status_code, 200)
        self.assertEqual(orgs_resp.json()['orgs'], ['ORG-A', 'ORG-B'])

        self.assertEqual(client.get('/api/disagreements/').status_code, 400)
        self.assertEqual(client.get('/api/disagreements/?org=UNKNOWN').status_code, 400)
        self.assertEqual(client.get('/api/disagreements/?org=ORG-A&reason=NOPE').status_code, 400)
        self.assertEqual(client.get('/api/disagreements/?org=ORG-A&sort=invalid').status_code, 400)

        resp_a = client.get('/api/disagreements/?org=ORG-A&sort=value_desc')
        self.assertEqual(resp_a.status_code, 200)
        payload_a = resp_a.json()
        self.assertEqual(
            {(r['record_id'], r['reason']) for r in payload_a['disagreements']},
            {
                ('REC-1015', 'MISSING_IN_B'),
                ('REC-1027', 'VALUE_MISMATCH'),
                ('REC-1042', 'DUPLICATE_IN_B'),
                ('REC-1064', 'VALUE_MISMATCH'),
                ('REC-1077', 'TENANT_MISMATCH'),
                ('REC-1088', 'VALUE_MISMATCH'),
                ('REC-1999', 'ORPHAN_IN_B'),
            },
        )
        self.assertNotIn('LOC-201', str(payload_a))
        self.assertNotIn('ORG-B', str(payload_a))
        self.assertEqual(payload_a['total_org_count'], 7)
        self.assertEqual(payload_a['org_max_sort_value'], '225674.12')
        sort_vals_a = [Decimal(r['sort_value']) for r in payload_a['disagreements']]
        self.assertEqual(sort_vals_a, sorted(sort_vals_a, reverse=True))

        tenant_a = next(r for r in payload_a['disagreements'] if r['record_id'] == 'REC-1077')
        self.assertIsNotNone(tenant_a['system_a_row'])
        self.assertEqual(tenant_a['system_b_rows'], [])

        filtered = client.get('/api/disagreements/?org=ORG-A&reason=VALUE_MISMATCH')
        self.assertEqual(filtered.status_code, 200)
        filtered_payload = filtered.json()
        self.assertEqual([r['record_id'] for r in filtered_payload['disagreements']], ['REC-1027', 'REC-1064', 'REC-1088'])
        self.assertEqual(filtered_payload['total_org_count'], 7)
        self.assertEqual(filtered_payload['org_max_sort_value'], '225674.12')
        self.assertEqual(filtered_payload['reason_counts']['MISSING_IN_B'], 1)

        resp_b = client.get('/api/disagreements/?org=ORG-B')
        self.assertEqual(resp_b.status_code, 200)
        payload_b = resp_b.json()
        self.assertEqual(
            {(r['record_id'], r['reason']) for r in payload_b['disagreements']},
            {
                ('REC-1003', 'VALUE_MISMATCH'),
                ('REC-1009', 'DATE_MISMATCH'),
                ('REC-1019', 'VOIDED_IN_A'),
                ('REC-1050', 'UNPARSEABLE_VALUE'),
                ('REC-1061', 'MISSING_IN_B'),
                ('REC-1077', 'TENANT_MISMATCH'),
            },
        )
        self.assertNotIn('LOC-102', str(payload_b))
        self.assertNotIn('ORG-A', str(payload_b))
        tenant_b = next(r for r in payload_b['disagreements'] if r['record_id'] == 'REC-1077')
        self.assertIsNone(tenant_b['system_a_row'])
        self.assertEqual(len(tenant_b['system_b_rows']), 1)

    def test_incomplete_split_payment_flags_unresolved_multi_entry(self):
        self._create_a(record_id='REC-1057', total='1000.00')
        self._create_b(entry_id='ENT/2026/4057', raw_ref='REC-1057', raw_value='400.00')
        self._create_b(entry_id='ENT/2026/4906', raw_ref='REC-1057', raw_value='300.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'MULTI_ENTRY_UNRESOLVED')
        self.assertEqual(rows[0]['system_b_value'], '700.00')
        self.assertIn('sum to 700.00', rows[0]['detail'])

    def test_repeated_partial_payments_flag_unresolved_multi_entry(self):
        self._create_a(record_id='REC-1058', total='1000.00')
        self._create_b(entry_id='ENT/2026/4058', raw_ref='REC-1058', raw_value='400.00')
        self._create_b(entry_id='ENT/2026/4907', raw_ref='REC-1058', raw_value='400.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'MULTI_ENTRY_UNRESOLVED')
        self.assertEqual(rows[0]['system_b_value'], '800.00')

    def test_single_full_plus_partial_flags_unresolved_multi_entry(self):
        self._create_a(record_id='REC-1059', total='1000.00')
        self._create_b(entry_id='ENT/2026/4059', raw_ref='REC-1059', raw_value='1000.00')
        self._create_b(entry_id='ENT/2026/4908', raw_ref='REC-1059', raw_value='250.00')
        rows = find_disagreements('ORG-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['reason'], 'MULTI_ENTRY_UNRESOLVED')
        self.assertEqual(rows[0]['system_b_value'], '1250.00')

    def test_importer_preserves_duplicate_keys_and_reports_unmapped_locations(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            (tmp_dir / 'locations.csv').write_text(
                'location_id,org_id,location_name\nLOC-101,ORG-A,Location 101\n',
                encoding='utf-8',
            )
            (tmp_dir / 'system_a.csv').write_text(
                'record_id,location_id,event_date,category_code,actor_id,base_value,adjustment,total_value,state\n'
                'REC-1001,LOC-101,2026-03-01,CAT-01,ACT-1,100.00,0.00,100.00,CONFIRMED\n'
                'rec1001,LOC-101,2026-03-01,CAT-01,ACT-1,200.00,0.00,200.00,CONFIRMED\n'
                'REC-1002,LOC-999,2026-03-01,CAT-01,ACT-1,200.00,0.00,200.00,CONFIRMED\n',
                encoding='utf-8',
            )
            (tmp_dir / 'system_b.csv').write_text(
                'entry_id,record_ref,location_id,recorded_on,value,label\n'
                'ENT-1,REC-1001,LOC-101,2026-03-01,200.00,ok\n',
                encoding='utf-8',
            )
            result = import_csv_directory(tmp_dir, replace=True)
            self.assertEqual(result['system_a'], 3)
            self.assertEqual(SystemARecord.objects.count(), 3)
            dup_rows = list(SystemARecord.objects.filter(record_id='REC-1001').order_by('source_row'))
            self.assertEqual([r.source_row for r in dup_rows], [2, 3])
            self.assertFalse(SystemARecord.objects.filter(record_id__contains='DUP-ROW').exists())
            issues_str = '\n'.join(result['issues'])
            self.assertIn("duplicate record_id 'REC-1001' (raw 'rec1001') preserved", issues_str)
            self.assertIn("unmapped location_id 'LOC-999'", issues_str)

            disagreements = find_disagreements('ORG-A')
            self.assertEqual(len(disagreements), 1)
            self.assertEqual(disagreements[0]['record_id'], 'REC-1001')
            self.assertEqual(disagreements[0]['reason'], 'MULTI_ENTRY_UNRESOLVED')
            self.assertIn('Duplicate record_id REC-1001 appears 2 times in System A', disagreements[0]['detail'])


