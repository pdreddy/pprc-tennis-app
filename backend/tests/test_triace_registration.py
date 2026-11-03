"""DB-free tests for TRIACE registration helpers."""
import csv
import io

import pytest

from app.triace_registration import CSV_COLUMNS, csv_cell, csv_text, first_name, registration_signature, tiers_still_used


@pytest.mark.parametrize("value,expected", [("=SUM(A1)", "'=SUM(A1)"), ("+1", "'+1"), ("-2", "'-2"), ("@x", "'@x"), ("  =x", "'  =x"), ("plain", "plain"), (None, ""), (5, "5")])
def test_csv_cells_cannot_start_a_formula(value, expected):
    assert csv_cell(value) == expected


def test_csv_round_trips_quotes_and_commas():
    text = csv_text([["id", 'He said "hi", ok', "=cmd", "a; b", 18, "goat", "goat", True, True, "approved", "2026-01-01"]])
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == CSV_COLUMNS and rows[1][1] == 'He said "hi", ok' and rows[1][2] == "'=cmd"
    assert text.count("\r\n") == 2


@pytest.mark.parametrize("name,uid,expected", [("Sam Smith", "u1", "Sam"), ("  ", "u1", "Captain"), (None, "u1", "Captain"), ("u1", "u1", "Captain"), ("sam@x.com", "u1", "Captain")])
def test_public_captain_label_never_exposes_ids(name, uid, expected):
    assert first_name(name, uid) == expected


def test_signature_ignores_player_order_and_name_case():
    a = registration_signature("Team A", [("p1", 5, 1), ("p2", 6.0, 2)], "higher")
    b = registration_signature(" team a ", [("p2", 6, 2), ("p1", 5.0, 1)], "higher")
    assert a == b
    assert a != registration_signature("Team A", [("p1", 5, 1), ("p2", 6, 2)], "goat")


def test_tiers_still_used_by_assignment_or_listing():
    metas = [{"assignedTier": "goat", "listedTiers": ["goat", "rising"]}, {"assignedTier": None, "listedTiers": []}, {}]
    assert tiers_still_used({"goat"}, metas) == {"goat"}
    assert tiers_still_used({"rising"}, metas) == {"rising"}
    assert tiers_still_used({"other"}, metas) == set()
