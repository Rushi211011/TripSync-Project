#!/usr/bin/env python3

import argparse
import json
import logging
import time
from pathlib import Path

import pandas as pd
import mysql.connector
from dotenv import load_dotenv
import os

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

REQUIRED = ["Description", "Amount", "Currency", "Paid By"]

# Load the same environment variables used by the Node.js backend
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / "server" / ".env"

load_dotenv(ENV_PATH)


def fetch_expenses_from_mysql(user_id):
    """Fetch expenses belonging to one TripSync user."""

    required_env = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]

    for key in required_env:
        if not os.getenv(key):
            raise RuntimeError(f"Missing {key} in server/.env")

    connection = mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME")
    )

    try:
        cursor = connection.cursor(dictionary=True)

        query = """
            SELECT
                e.expense_id,
                e.description AS Description,
                e.category AS Category,
                e.amount AS Amount,
                e.currency AS Currency,
                COALESCE(p.name, 'Unknown') AS `Paid By`,
                e.expense_date AS Date
            FROM trip_expenses e
            LEFT JOIN trip_participants p
                ON e.user_id = p.user_id
                AND e.paid_by_id = p.participant_id
            WHERE e.user_id = %s
            ORDER BY e.expense_id
        """

        cursor.execute(query, (user_id,))
        rows = cursor.fetchall()
        cursor.close()

        logging.info("Extracted %s transactions from MySQL", len(rows))

        return pd.DataFrame(rows)

    finally:
        connection.close()


def main():
    start_time = time.time()

    parser = argparse.ArgumentParser(
        description="TripSync MySQL Expense ETL Pipeline"
    )

    parser.add_argument(
        "--user-id",
        required=True,
        help="Firebase UID of the logged-in TripSync user"
    )

    parser.add_argument(
        "--output-dir",
        default="actual_output"
    )

    args = parser.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    logging.info("Starting TripSync ETL pipeline")
    logging.info("Extracting transactions from MySQL")

    # 1. Extract
    df = fetch_expenses_from_mysql(args.user_id)

    # Ensure expected columns exist, even if there are no transactions
    for column in REQUIRED:
        if column not in df.columns:
            df[column] = pd.NA

    if "Date" not in df.columns:
        df["Date"] = pd.NA

    if "Category" not in df.columns:
        df["Category"] = pd.NA

    df.columns = [str(c).strip() for c in df.columns]

    missing_columns = [c for c in REQUIRED if c not in df.columns]
    if missing_columns:
        raise SystemExit(f"Missing columns: {missing_columns}")

    records_read = len(df)

    # 2. Data quality checks
    missing_descriptions = int(df["Description"].isna().sum())

    df["Amount"] = pd.to_numeric(df["Amount"], errors="coerce")

    invalid_amounts = int(
        (df["Amount"].isna() | (df["Amount"] <= 0)).sum()
    )

    parsed_dates = pd.to_datetime(
        df["Date"], format="mixed", errors="coerce"
    )

    missing_dates = int(parsed_dates.isna().sum())
    df["Date"] = parsed_dates.dt.strftime("%Y-%m-%d")

    missing_categories = int(df["Category"].isna().sum())

    # 3. Standardization
    df["Description"] = (
        df["Description"].fillna("").astype(str).str.strip()
    )

    df["Currency"] = (
        df["Currency"].fillna("").astype(str).str.upper().str.strip()
    )

    df["Paid By"] = (
        df["Paid By"].fillna("Unknown").astype(str).str.strip()
    )

    df["Category"] = (
        df["Category"].fillna("Other").astype(str).str.strip()
        .replace("", "Other")
    )

    # 4. Separate invalid records
    valid_mask = (
        df["Description"].ne("")
        & df["Amount"].gt(0)
        & df["Currency"].ne("")
    )

    rejected = df.loc[~valid_mask].copy()
    valid = df.loc[valid_mask].copy()

    # 5. Duplicate detection
    duplicate_mask = valid.duplicated(
        subset=[
            "Description",
            "Amount",
            "Currency",
            "Paid By",
            "Date"
        ],
        keep="first"
    )

    duplicates = valid.loc[duplicate_mask].copy()
    clean = valid.loc[~duplicate_mask].copy()

    clean["Amount"] = clean["Amount"].round(2)

    # 6. Save processed datasets
    clean.to_csv(out / "cleaned_expenses.csv", index=False)
    rejected.to_csv(out / "rejected_records.csv", index=False)
    duplicates.to_csv(out / "duplicate_records.csv", index=False)

    # 7. Analytics
    currency_totals = (
        clean.groupby("Currency")["Amount"]
        .sum().round(2).to_dict()
    )

    category_totals = (
        clean.groupby(["Currency", "Category"])["Amount"]
        .sum().round(2).reset_index().to_dict(orient="records")
    )

    monthly = (
        clean.dropna(subset=["Date"])
        .assign(Month=lambda x: x["Date"].str[:7])
        .groupby(["Currency", "Month"])["Amount"]
        .sum().round(2).reset_index().to_dict(orient="records")
    )

    summary = {
        "records_read": records_read,
        "records_cleaned": len(clean),
        "records_rejected": len(rejected),
        "duplicate_records": len(duplicates),
        "totals_by_currency": currency_totals,
        "spending_by_category": category_totals,
        "monthly_spending": monthly
    }

    (out / "analytics_summary.json").write_text(
        json.dumps(summary, indent=2, default=str),
        encoding="utf-8"
    )

    # 8. Data quality report
    execution_time = round(time.time() - start_time, 3)

    quality_report = {
        "pipeline": "TripSync Expense ETL",
        "status": "SUCCESS",
        "records_received": records_read,
        "valid_records": len(clean),
        "rejected_records": len(rejected),
        "duplicate_records": len(duplicates),
        "quality_checks": {
            "missing_descriptions": missing_descriptions,
            "invalid_amounts": invalid_amounts,
            "missing_dates": missing_dates,
            "missing_categories": missing_categories
        },
        "execution_time_seconds": execution_time
    }

    (out / "quality_report.json").write_text(
        json.dumps(quality_report, indent=2, default=str),
        encoding="utf-8"
    )

    logging.info("ETL completed successfully")
    logging.info("Records received: %s", records_read)
    logging.info("Clean records: %s", len(clean))
    logging.info("Rejected records: %s", len(rejected))
    logging.info("Duplicate records: %s", len(duplicates))
    logging.info("Execution time: %s seconds", execution_time)


if __name__ == "__main__":
    main()