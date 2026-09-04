"""Add document ingestion status.

Revision ID: 20260903_03
Revises: 20260903_02
Create Date: 2026-09-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260903_03"
down_revision: str | None = "20260903_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="ready",
            nullable=False,
        ),
    )
    op.create_check_constraint(
        op.f("ck_documents_valid_status"),
        "documents",
        "status IN ('processing', 'ready', 'error')",
    )
    op.alter_column("documents", "status", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_documents_valid_status"),
        "documents",
        type_="check",
    )
    op.drop_column("documents", "status")
