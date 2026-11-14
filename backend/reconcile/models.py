from django.db import models


class Location(models.Model):
    location_id = models.CharField(max_length=32, unique=True)
    org_id = models.CharField(max_length=32, db_index=True)
    location_name = models.CharField(max_length=120)

    class Meta:
        ordering = ['location_id']

    def __str__(self) -> str:
        return f'{self.location_id} ({self.org_id})'


class SystemARecord(models.Model):
    record_id = models.CharField(max_length=64, db_index=True)
    raw_record_id = models.CharField(max_length=64)
    location = models.ForeignKey(
        Location,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='system_a_records',
    )
    location_id_raw = models.CharField(max_length=64)

    event_date = models.DateField(null=True, blank=True)
    raw_event_date = models.CharField(max_length=64, blank=True, default='')

    category_code = models.CharField(max_length=64, blank=True, default='')
    actor_id = models.CharField(max_length=64, blank=True, default='')

    base_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    raw_base_value = models.CharField(max_length=64, blank=True, default='')

    adjustment = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    raw_adjustment = models.CharField(max_length=64, blank=True, default='')

    total_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    raw_total_value = models.CharField(max_length=64, blank=True, default='')
    value_parse_error = models.BooleanField(default=False)

    state = models.CharField(max_length=32, default='CONFIRMED')
    source_row = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['record_id']

    def __str__(self) -> str:
        return f'{self.record_id} ({self.location_id_raw})'


class SystemBEntry(models.Model):
    entry_id = models.CharField(max_length=64, unique=True)
    raw_record_ref = models.CharField(max_length=64)
    normalized_record_ref = models.CharField(max_length=64, db_index=True)

    location = models.ForeignKey(
        Location,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='system_b_entries',
    )
    location_id_raw = models.CharField(max_length=64)

    recorded_on = models.DateField(null=True, blank=True)
    raw_recorded_on = models.CharField(max_length=64, blank=True, default='')

    value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    raw_value = models.CharField(max_length=64, blank=True, default='')
    value_parse_error = models.BooleanField(default=False)

    label = models.CharField(max_length=255, blank=True, default='')
    source_row = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['entry_id']

    def __str__(self) -> str:
        return f'{self.entry_id} -> {self.normalized_record_ref}'
