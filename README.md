# TripSync – AI Itinerary & Group Expense Planner

TripSync is a React + TypeScript application for planning trips, generating AI-assisted itineraries, splitting group expenses, managing shared lists and analyzing travel spending.

## Current capabilities

- React 19 + TypeScript + Vite frontend
- Node.js API for Gemini itinerary and packing suggestions
- Firebase Authentication and per-user Firestore data
- Group expense splitting and settlement calculations
- Expense analytics: total spending, transaction count, average transaction, highest-spending category, category chart, six-month trend and participant spending
- Expense category/date capture and CSV export
- Standalone Python/Pandas ETL pipeline for cleaning exported expense data and producing analytics summaries
- Demo fallback for itinerary/packing generation when no Gemini API key is configured

## Requirements

- Node.js 20 LTS recommended (18+ supported by the project)
- npm
- Python 3.10+ for the optional analytics ETL pipeline
- Optional Gemini API key

## Run in VS Code

1. Extract the ZIP and open the `tripsync-vscode` folder in VS Code.
2. Open **Terminal → New Terminal** in the project root.
3. Install JavaScript dependencies:

   ```bash
   npm install
   ```

4. Optional: enable real Gemini AI. Copy `.env.example` to `.env` and add your key:

   ```env
   GEMINI_API_KEY=your_actual_key_here
   GEMINI_MODEL=gemini-2.5-flash
   API_PORT=8787
   ```

   Obtain a key from Google AI Studio. Keep `.env` private and never commit it.

5. Start the frontend and API together:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`. API health check: `http://localhost:8787/api/health`.

The combined development command starts Vite on port 3000 and the Node API on port 8787. Vite proxies `/api` requests to the backend.

## Firebase setup

The application uses the Firebase configuration in `firebase-applet-config.json`. Firebase Authentication Email/Password must be enabled in the Firebase console, and Firestore must be provisioned. Publish the rules in `firestore.rules` (or merge the user-scoped match block into existing rules).

Each signed-in user’s application data is stored at:

`users/{Firebase Auth UID}/appData/main`

Firestore rules restrict access to the authenticated user whose UID matches the path. If Firebase has not been configured/enabled for your environment, sign-in and cloud-backed expense/list features will not work until it is.

## Expense analytics

After signing in, open **Expenses** to add participants and transactions. Each new transaction captures a category and date. Open **Analytics** to view KPIs and spending charts, choose a reporting currency, and export the current expense records as CSV.

Older expenses remain compatible. If they do not contain a date, they still contribute to totals and category analysis but are excluded from the monthly trend. If they do not contain a category, TripSync estimates one from the description; manually categorized records are more accurate.

The currency conversion endpoint currently returns approximate demonstration rates, not live FX rates. Do not present those conversions as current market rates in an interview.

## Python ETL pipeline

The ETL pipeline is an independent, reproducible processing step that consumes the CSV exported from the application. It does not silently modify Firestore data.

```bash
cd data_pipeline
python3 -m venv .venv
source .venv/bin/activate       # macOS/Linux
# .venv\Scripts\activate      # Windows PowerShell
pip install -r requirements.txt
python etl_expenses.py sample_expenses.csv
```

To process an export from TripSync:

```bash
python etl_expenses.py /path/to/tripsync-expenses.csv --output-dir output
```

Outputs:
- `output/cleaned_expenses.csv` – validated, standardized transactions
- `output/rejected_records.csv` – invalid rows retained for inspection
- `output/analytics_summary.json` – totals by currency, category and month

Amounts are grouped by currency; the ETL intentionally does not add INR, USD or other currencies together without a verified exchange-rate source.

## Production build

```bash
npm run build
npm run preview
```

The production frontend is generated in `dist/`. The Node API must be deployed separately and configured with server-side environment variables. The Vite `/api` proxy is development-only.

## Suggested interview walkthrough

1. Explain the React/TypeScript frontend, Node API and Firebase architecture.
2. Generate an itinerary; explain Gemini server-side key handling and demo fallback.
3. Add participants and categorized/date-stamped expenses.
4. Open Analytics and explain KPI calculations, category aggregation and monthly trends.
5. Export the transactions as CSV and run the Python ETL pipeline.
6. Show the cleaned dataset, rejected records and JSON analytics summary.
7. Explain the limitation that demo currency rates are approximate, not live.

## Tech stack

React, TypeScript, Vite, Node.js HTTP API, Google GenAI SDK, Firebase Authentication, Cloud Firestore, Python, Pandas, SQL concepts and CSV/JSON data processing.
