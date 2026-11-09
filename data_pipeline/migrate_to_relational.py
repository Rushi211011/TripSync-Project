
import os
import json
from pathlib import Path
from decimal import Decimal

import mysql.connector
from dotenv import load_dotenv


# --------------------------------------------------
# 1. LOAD DATABASE CONFIGURATION
# --------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / "server" / ".env"

load_dotenv(ENV_PATH)

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
    "autocommit": False
}


# --------------------------------------------------
# 2. HELPER FUNCTIONS
# --------------------------------------------------

def parse_json(value, default):
    if value is None:
        return default

    if isinstance(value, (list, dict)):
        return value

    return json.loads(value, parse_float=Decimal)


def to_decimal_id(value):
    result = Decimal(str(value))

    if not result.is_finite():
        raise ValueError(f"Invalid ID: {value}")

    if result.as_tuple().exponent < -4:
        raise ValueError(
            f"To-do ID has more than 4 decimal places: {value}"
        )

    return result


def count_records(cursor, table, user_id):
    allowed_tables = {
        "trip_participants",
        "trip_expenses",
        "trip_expense_shares",
        "trip_todo_items",
        "trip_itineraries"
    }

    if table not in allowed_tables:
        raise ValueError(f"Invalid table name: {table}")

    cursor.execute(
        f"SELECT COUNT(*) AS total FROM {table} "
        "WHERE user_id = %s",
        (user_id,)
    )

    return cursor.fetchone()["total"]


# --------------------------------------------------
# 3. MAIN MIGRATION
# --------------------------------------------------

def migrate_data():

    connection = None
    cursor = None

    try:
        print("\nConnecting to MySQL...")

        connection = mysql.connector.connect(**DB_CONFIG)
        cursor = connection.cursor(dictionary=True)

        print("MySQL connection successful!")

        # Read source data before beginning the write transaction.
        cursor.execute("""
            SELECT
                user_id,
                participants,
                expenses,
                todo_items,
                itinerary
            FROM trip_sync_data
        """)

        source_rows = cursor.fetchall()

        if not source_rows:
            print("No source records found.")
            return

        # FIX:
        # mysql.connector already starts a transaction
        # automatically when autocommit is False.
        # Do not call connection.start_transaction() here.

        total_participants = 0
        total_expenses = 0
        total_shares = 0
        total_todos = 0
        total_itineraries = 0

        # --------------------------------------------------
        # 4. TRANSFORM AND LOAD
        # --------------------------------------------------

        for row in source_rows:

            user_id = row["user_id"]

            participants = parse_json(
                row["participants"], []
            )

            expenses = parse_json(
                row["expenses"], []
            )

            todos = parse_json(
                row["todo_items"], []
            )

            print(f"\nMigrating user: {user_id}")

            # Insert user.
            cursor.execute("""
                INSERT INTO trip_sync_users (user_id)
                VALUES (%s)
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id)
            """, (user_id,))

            # --------------------------------------------------
            # 5. MIGRATE PARTICIPANTS
            # --------------------------------------------------

            participant_ids = set()

            for participant in participants:

                participant_id = int(participant["id"])
                participant_name = participant["name"]

                cursor.execute("""
                    INSERT INTO trip_participants (
                        user_id,
                        participant_id,
                        name
                    )
                    VALUES (%s, %s, %s)

                    ON DUPLICATE KEY UPDATE
                        name = VALUES(name)
                """, (
                    user_id,
                    participant_id,
                    participant_name
                ))

                participant_ids.add(participant_id)
                total_participants += 1

            # --------------------------------------------------
            # 6. MIGRATE EXPENSES
            # --------------------------------------------------

            for expense in expenses:

                expense_id = int(expense["id"])
                paid_by_id = int(expense["paidById"])

                if paid_by_id not in participant_ids:
                    raise ValueError(
                        f"Expense {expense_id} references "
                        f"unknown payer {paid_by_id}"
                    )

                amount = Decimal(str(expense["amount"]))

                expense_date = expense.get("date") or None

                cursor.execute("""
                    INSERT INTO trip_expenses (
                        user_id,
                        expense_id,
                        description,
                        amount,
                        currency,
                        paid_by_id,
                        category,
                        expense_date
                    )
                    VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s
                    )

                    ON DUPLICATE KEY UPDATE
                        description = VALUES(description),
                        amount = VALUES(amount),
                        currency = VALUES(currency),
                        paid_by_id = VALUES(paid_by_id),
                        category = VALUES(category),
                        expense_date = VALUES(expense_date)
                """, (
                    user_id,
                    expense_id,
                    expense["description"],
                    amount,
                    expense["currency"],
                    paid_by_id,
                    expense.get("category"),
                    expense_date
                ))

                total_expenses += 1

                # --------------------------------------------------
                # 7. MIGRATE EXPENSE SHARES
                # --------------------------------------------------

                shared_by_ids = set(
                    int(value)
                    for value in expense.get("sharedByIds", [])
                )

                for participant_id in shared_by_ids:

                    if participant_id not in participant_ids:
                        raise ValueError(
                            f"Expense {expense_id} references "
                            f"unknown participant {participant_id}"
                        )

                    cursor.execute("""
                        INSERT INTO trip_expense_shares (
                            user_id,
                            expense_id,
                            participant_id
                        )
                        VALUES (%s, %s, %s)

                        ON DUPLICATE KEY UPDATE
                            participant_id = VALUES(participant_id)
                    """, (
                        user_id,
                        expense_id,
                        participant_id
                    ))

                    total_shares += 1

            # --------------------------------------------------
            # 8. MIGRATE TO-DO ITEMS
            # --------------------------------------------------

            for todo in todos:

                todo_id = to_decimal_id(todo["id"])

                cursor.execute("""
                    INSERT INTO trip_todo_items (
                        user_id,
                        todo_id,
                        text,
                        completed,
                        list_type
                    )
                    VALUES (%s, %s, %s, %s, %s)

                    ON DUPLICATE KEY UPDATE
                        text = VALUES(text),
                        completed = VALUES(completed),
                        list_type = VALUES(list_type)
                """, (
                    user_id,
                    todo_id,
                    todo["text"],
                    bool(todo.get("completed", False)),
                    todo["listType"]
                ))

                total_todos += 1

            # --------------------------------------------------
            # 9. MIGRATE ITINERARY
            # --------------------------------------------------

            itinerary = row.get("itinerary")

            if itinerary:

                if not isinstance(itinerary, str):
                    itinerary = json.dumps(itinerary)

                cursor.execute("""
                    INSERT INTO trip_itineraries (
                        user_id,
                        itinerary_json
                    )
                    VALUES (%s, %s)

                    ON DUPLICATE KEY UPDATE
                        itinerary_json = VALUES(itinerary_json)
                """, (
                    user_id,
                    itinerary
                ))

                total_itineraries += 1

            # --------------------------------------------------
            # 10. VALIDATE MIGRATED RECORD COUNTS
            # --------------------------------------------------

            expected_participants = len(participants)
            expected_expenses = len(expenses)
            expected_todos = len(todos)

            expected_shares = sum(
                len(set(
                    int(value)
                    for value in expense.get("sharedByIds", [])
                ))
                for expense in expenses
            )

            actual_participants = count_records(
                cursor, "trip_participants", user_id
            )

            actual_expenses = count_records(
                cursor, "trip_expenses", user_id
            )

            actual_todos = count_records(
                cursor, "trip_todo_items", user_id
            )

            actual_shares = count_records(
                cursor, "trip_expense_shares", user_id
            )

            print(
                f"Participants: {actual_participants}/"
                f"{expected_participants}"
            )
            print(
                f"Expenses: {actual_expenses}/"
                f"{expected_expenses}"
            )
            print(
                f"Expense shares: {actual_shares}/"
                f"{expected_shares}"
            )
            print(
                f"To-do items: {actual_todos}/"
                f"{expected_todos}"
            )

            if (
                actual_participants != expected_participants
                or actual_expenses != expected_expenses
                or actual_shares != expected_shares
                or actual_todos != expected_todos
            ):
                raise ValueError(
                    f"Migration count validation failed "
                    f"for user {user_id}"
                )

        # --------------------------------------------------
        # 11. COMMIT ONLY AFTER VALIDATION
        # --------------------------------------------------

        connection.commit()

        print("\n" + "=" * 45)
        print("       MIGRATION COMPLETED SUCCESSFULLY")
        print("=" * 45)

        print(f"Users processed: {len(source_rows)}")
        print(f"Participants processed: {total_participants}")
        print(f"Expenses processed: {total_expenses}")
        print(f"Expense shares processed: {total_shares}")
        print(f"To-do items processed: {total_todos}")
        print(f"Itineraries processed: {total_itineraries}")

        print("\nAll record counts validated.")
        print("Original trip_sync_data table preserved.")

    except Exception as error:

        if connection and connection.in_transaction:
            connection.rollback()

        print("\nMIGRATION FAILED")
        print(f"Reason: {error}")
        print("Database transaction rolled back.")

    finally:

        if cursor:
            cursor.close()

        if connection and connection.is_connected():
            connection.close()

        print("\nDatabase connection closed.")


# --------------------------------------------------
# 12. EXECUTE
# --------------------------------------------------

if __name__ == "__main__":
    migrate_data()
