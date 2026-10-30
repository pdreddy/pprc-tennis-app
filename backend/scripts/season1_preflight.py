"""Read-only Season 1 Firestore inventory for a safe PostgreSQL migration.

This deliberately does not write to either system. It records collection counts
and field names so a Season 1 mapping can be approved before `--apply` exists.
"""
import argparse
import json
import os
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a read-only PPRC Season 1 Firestore migration manifest")
    parser.add_argument("--report", type=Path, default=Path("season1-preflight.json"))
    parser.add_argument("--expected-project", required=True, help="Firebase project ID expected in the service-account file")
    args = parser.parse_args()
    credential_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not credential_path:
        raise RuntimeError("Set FIREBASE_SERVICE_ACCOUNT to the Season 1 service-account JSON file")
    certificate = json.loads(Path(credential_path).read_text())
    if certificate.get("project_id") != args.expected_project:
        raise RuntimeError("Service account project does not match --expected-project")
    firebase_admin.initialize_app(credentials.Certificate(certificate))
    db = firestore.client()
    collections = ["memberships", "users", "events", "divisions", "registrations", "teams", "matches", "matchResults", "courts", "auditEvents"]
    report = {"project_id": certificate["project_id"], "read_only": True, "collections": {}}
    for name in collections:
        documents = list(db.collection(name).limit(25).stream())
        fields = sorted({key for document in documents for key in (document.to_dict() or {})})
        # Firestore aggregation is not used because older source projects may not have index support.
        report["collections"][name] = {"sampled_documents": len(documents), "sampled_fields": fields}
    args.report.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
