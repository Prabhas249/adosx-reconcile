from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from reconcile.importer import import_csv_directory


class Command(BaseCommand):
    help = 'Import locations.csv, system_a.csv, and system_b.csv into the database.'

    def add_arguments(self, parser):
        default_dir = Path(settings.BASE_DIR).parent / 'data'
        parser.add_argument(
            '--data-dir',
            type=Path,
            default=default_dir,
            help=f'Directory containing the 3 CSV files (default: {default_dir})',
        )

    def handle(self, *args, **options):
        data_dir: Path = options['data_dir']
        counts = import_csv_directory(data_dir, replace=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"Imported {counts['locations']} locations, "
                f"{counts['system_a']} System A records, "
                f"{counts['system_b']} System B entries from {data_dir}"
            )
        )
