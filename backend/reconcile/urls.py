from django.urls import path

from reconcile.views import list_disagreements, list_orgs

urlpatterns = [
    path('orgs/', list_orgs, name='list-orgs'),
    path('disagreements/', list_disagreements, name='list-disagreements'),
]
