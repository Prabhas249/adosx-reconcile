from collections import Counter
from decimal import Decimal

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from reconcile.comparator import REASON_LABELS, find_disagreements
from reconcile.models import Location


@api_view(['GET'])
def list_orgs(request):
    orgs = list(Location.objects.values_list('org_id', flat=True).distinct().order_by('org_id'))
    return Response({
        'orgs': orgs,
        'reasons': [
            {'code': code, 'label': label}
            for code, label in REASON_LABELS.items()
        ],
    })


@api_view(['GET'])
def list_disagreements(request):
    org_id = request.query_params.get('org', '').strip()
    if not org_id:
        return Response(
            {'error': 'Missing required query parameter: org'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    reason = request.query_params.get('reason', '').strip() or None
    sort = request.query_params.get('sort', '').strip() or None

    try:
        rows = find_disagreements(org_id=org_id, reason_filter=reason, sort_order=sort)
        org_rows = find_disagreements(org_id=org_id) if reason else rows
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    max_sort = max((Decimal(r['sort_value']) for r in org_rows), default=Decimal('0.00'))
    reason_counts = dict(Counter(r['reason'] for r in org_rows))

    return Response({
        'org_id': org_id,
        'count': len(rows),
        'total_org_count': len(org_rows),
        'org_max_sort_value': f'{max_sort:.2f}',
        'reason_counts': reason_counts,
        'disagreements': rows,
    })
