import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { getDbPool } from './database.js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

// --------------------------------------------------
// 1. Load environment variables
// --------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
    );

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(
        /^(['"])(.*)\1$/,
        '$2'
      );
    }
  }
}

// --------------------------------------------------
// 2. Server configuration
// --------------------------------------------------
const PORT = Number(process.env.API_PORT || 8787);

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        timeout: 45000,
        retryOptions: {
          attempts: 1,
          initialDelay: 1,
          maxDelay: 4,
          httpStatusCodes: [408, 429, 500, 502, 503, 504]
        }
      }
    })
  : null;
// --------------------------------------------------
// 3. Gemini itinerary schema
// --------------------------------------------------

const itinerarySchema = {
  type: Type.OBJECT,
  properties: {
    itinerary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          day: { type: Type.STRING },
          title: { type: Type.STRING },
          activities: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          food: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ['day', 'title', 'activities', 'food']
      }
    }
  },
  required: ['itinerary']
};

// --------------------------------------------------
// 4. Default application data
// --------------------------------------------------

const EMPTY_DATA = {
  participants: [],
  expenses: [],
  todoItems: [],
  itinerary: null
};

// --------------------------------------------------
// 5. Database helpers
// --------------------------------------------------

function parseStoredJson(value, fallback = null) {
  if (value == null) return fallback;

  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function validUid(uid) {
  return (
    typeof uid === 'string' &&
    uid.trim().length > 0 &&
    uid.length <= 128
  );
}

function validateUserData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  if (
    !Array.isArray(data.participants) ||
    !Array.isArray(data.expenses) ||
    !Array.isArray(data.todoItems)
  ) {
    return false;
  }

  if (
    data.participants.length > 1000 ||
    data.expenses.length > 10000 ||
    data.todoItems.length > 10000
  ) {
    return false;
  }

  for (const participant of data.participants) {
    if (
      !participant ||
      !Number.isInteger(Number(participant.id)) ||
      typeof participant.name !== 'string'
    ) {
      return false;
    }
  }

  for (const expense of data.expenses) {
    if (
      !expense ||
      !Number.isInteger(Number(expense.id)) ||
      typeof expense.description !== 'string' ||
      !Number.isFinite(Number(expense.amount)) ||
      typeof expense.currency !== 'string' ||
      !Number.isInteger(Number(expense.paidById)) ||
      !Array.isArray(expense.sharedByIds)
    ) {
      return false;
    }
  }

  for (const todo of data.todoItems) {
    if (
      !todo ||
      !Number.isFinite(Number(todo.id)) ||
      typeof todo.text !== 'string' ||
      typeof todo.completed !== 'boolean' ||
      !['todo', 'packing'].includes(todo.listType)
    ) {
      return false;
    }
  }

  return true;
}

// Equal expense splitting with accurate cent rounding.

function calculateEqualShares(totalAmount, participantIds) {
  if (participantIds.length === 0) return [];

  const totalCents = Math.round(Number(totalAmount) * 100);
  const baseCents = Math.floor(totalCents / participantIds.length);
  let remainingCents = totalCents;

  return participantIds.map((participantId, index) => {
    const cents = index === participantIds.length - 1
      ? remainingCents
      : baseCents;

    remainingCents -= cents;

    return { participantId, amount: cents / 100 };
  });
}

// --------------------------------------------------
// 6. Read normalized relational data
// --------------------------------------------------

async function getRelationalUserData(uid) {
  const pool = getDbPool();

  const [userRows] = await pool.execute(
    'SELECT user_id FROM trip_sync_users WHERE user_id = ?',
    [uid]
  );

  if (userRows.length === 0) {
    return {
      exists: false,
      data: EMPTY_DATA
    };
  }

  // Participants
  const [participantRows] = await pool.execute(
    `SELECT participant_id, name
     FROM trip_participants
     WHERE user_id = ?
     ORDER BY participant_id`,
    [uid]
  );

  const participants = participantRows.map(row => ({
    id: Number(row.participant_id),
    name: row.name
  }));

  // Expenses
  const [expenseRows] = await pool.execute(
    `SELECT
       expense_id,
       description,
       amount,
       currency,
       paid_by_id,
       category,
       DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date
     FROM trip_expenses
     WHERE user_id = ?
     ORDER BY expense_id`,
    [uid]
  );

  // Expense shares
  const [shareRows] = await pool.execute(
    `SELECT expense_id, participant_id, share_amount
     FROM trip_expense_shares
     WHERE user_id = ?`,
    [uid]
  );

  const sharesByExpense = new Map();

  for (const share of shareRows) {
    const expenseId = Number(share.expense_id);

    if (!sharesByExpense.has(expenseId)) {
      sharesByExpense.set(expenseId, []);
    }

    sharesByExpense.get(expenseId).push({
      participantId: Number(share.participant_id),
      amount: Number(share.share_amount)
    });
  }

  const expenses = expenseRows.map(row => {
    const shareAmounts = sharesByExpense.get(Number(row.expense_id)) || [];

    return {
      id: Number(row.expense_id),
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      paidById: Number(row.paid_by_id),
      sharedByIds: shareAmounts.map(share => share.participantId),
      shareAmounts,
      category: row.category || undefined,
      date: row.expense_date || undefined
    };
  });
    // To-do and packing items
  const [todoRows] = await pool.execute(
    `SELECT todo_id, text, completed, list_type
     FROM trip_todo_items
     WHERE user_id = ?
     ORDER BY todo_id`,
    [uid]
  );

  const todoItems = todoRows.map(row => ({
    id: Number(row.todo_id),
    text: row.text,
    completed: Boolean(row.completed),
    listType: row.list_type
  }));

  // Itinerary
  const [itineraryRows] = await pool.execute(
    `SELECT itinerary_json
     FROM trip_itineraries
     WHERE user_id = ?
     LIMIT 1`,
    [uid]
  );

  const itinerary = itineraryRows.length
    ? parseStoredJson(itineraryRows[0].itinerary_json, null)
    : null;

  return {
    exists: true,
    data: {
      participants,
      expenses,
      todoItems,
      itinerary
    }
  };
}

// --------------------------------------------------
// 7. Save data into normalized relational tables
// --------------------------------------------------

async function saveRelationalUserData(uid, data) {
  const pool = getDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO trip_sync_users (user_id)
       VALUES (?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [uid]
    );

    await connection.execute(
      'DELETE FROM trip_expense_shares WHERE user_id = ?',
      [uid]
    );

    await connection.execute(
      'DELETE FROM trip_expenses WHERE user_id = ?',
      [uid]
    );

    await connection.execute(
      'DELETE FROM trip_participants WHERE user_id = ?',
      [uid]
    );

    await connection.execute(
      'DELETE FROM trip_todo_items WHERE user_id = ?',
      [uid]
    );

    // Participants
    for (const participant of data.participants) {
      await connection.execute(
        `INSERT INTO trip_participants
         (user_id, participant_id, name)
         VALUES (?, ?, ?)`,
        [uid, Number(participant.id), participant.name]
      );
    }

    const participantIds = new Set(
      data.participants.map(item => Number(item.id))
    );

    // Expenses and individual shares
    for (const expense of data.expenses) {
      const expenseId = Number(expense.id);
      const paidById = Number(expense.paidById);

      if (!participantIds.has(paidById)) {
        throw new Error(
          `Expense ${expenseId} references an unknown payer.`
        );
      }

      await connection.execute(
        `INSERT INTO trip_expenses (
          user_id,
          expense_id,
          description,
          amount,
          currency,
          paid_by_id,
          category,
          expense_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid,
          expenseId,
          expense.description,
          Number(expense.amount),
          expense.currency,
          paidById,
          expense.category || null,
          expense.date || null
        ]
      );

      const sharedByIds = [
        ...new Set(expense.sharedByIds.map(Number))
      ];

      const submittedShareAmounts = Array.isArray(expense.shareAmounts)
  ? expense.shareAmounts
  : [];

const submittedTotalCents = submittedShareAmounts.reduce(
  (sum, share) => sum + Math.round(Number(share.amount) * 100),
  0
);

const shareAmounts =
  submittedShareAmounts.length === 0 || submittedTotalCents === 0
    ? calculateEqualShares(expense.amount, sharedByIds)
    : submittedShareAmounts;

      const shareMap = new Map(
        shareAmounts.map(share => [
          Number(share.participantId),
          Math.round(Number(share.amount) * 100)
        ])
      );
      console.log('DEBUG EXPENSE:', expense.description);
console.log('DEBUG SHARE AMOUNTS:', expense.shareAmounts);
console.log('DEBUG SHARE MAP:', [...shareMap.entries()]);

      const totalShareCents = [...shareMap.values()]
        .reduce((sum, amount) => sum + amount, 0);

      const totalExpenseCents = Math.round(
        Number(expense.amount) * 100
      );

      if (
        shareMap.size !== sharedByIds.length ||
        totalShareCents !== totalExpenseCents ||
        [...shareMap.values()].some(
          amount => !Number.isFinite(amount) || amount < 0
        )
      ) {
        throw new Error(
          `Expense ${expenseId}: individual shares must be valid and add up to the total expense.`
        );
      }

      for (const participantId of sharedByIds) {
        if (!participantIds.has(participantId)) {
          throw new Error(
            `Expense ${expenseId} references an unknown shared participant.`
          );
        }

        const shareCents = shareMap.get(participantId);

        if (shareCents === undefined) {
          throw new Error(
            `Expense ${expenseId} is missing a share for participant ${participantId}.`
          );
        }

        await connection.execute(
          `INSERT INTO trip_expense_shares (
            user_id,
            expense_id,
            participant_id,
            share_amount
          )
          VALUES (?, ?, ?, ?)`,
          [uid, expenseId, participantId, shareCents / 100]
        );
      }
    }

    // To-do and packing items
    for (const todo of data.todoItems) {
      await connection.execute(
        `INSERT INTO trip_todo_items (
          user_id,
          todo_id,
          text,
          completed,
          list_type
        )
        VALUES (?, ?, ?, ?, ?)`,
        [
          uid,
          String(todo.id),
          todo.text,
          Boolean(todo.completed),
          todo.listType
        ]
      );
    }

    // Itinerary
    if (data.itinerary != null) {
      await connection.execute(
        `INSERT INTO trip_itineraries (
          user_id,
          itinerary_json
        )
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          itinerary_json = VALUES(itinerary_json)`,
        [uid, JSON.stringify(data.itinerary)]
      );
    } else {
      await connection.execute(
        'DELETE FROM trip_itineraries WHERE user_id = ?',
        [uid]
      );
    }

    await connection.commit();

    return true;

  } catch (error) {
    await connection.rollback();
    throw error;

  } finally {
    connection.release();
  }
}

// --------------------------------------------------
// 8. Demo itinerary
// --------------------------------------------------

function demoItinerary(destination, duration, interests) {
  const activities = [
    `Explore the main attractions and landmarks of ${destination}`,
    `Discover a local neighbourhood matching your interests: ${interests}`,
    'Visit a museum, viewpoint or cultural attraction',
    'Enjoy a relaxed evening walk and take photos'
  ];

  const food = [
    `Try a popular local breakfast in ${destination}`,
    'Explore a local restaurant for regional cuisine',
    'Visit a cafe or street-food area'
  ];

  return {
    destination,
    itinerary: Array.from({ length: duration }, (_, index) => ({
      day: `Day ${index + 1}`,
      title: [
        'Arrival & local exploration',
        'Culture and sightseeing',
        'Food and hidden gems',
        'Outdoor experiences',
        'Relaxation and favourites'
      ][index % 5],
      activities,
      food
    })),
    mode: 'demo',
    notice: 'Demo itinerary: add GEMINI_API_KEY to server/.env to enable AI-generated plans.'
  };
}

// --------------------------------------------------
// 9. General utility functions
// --------------------------------------------------

function extractJson(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  return JSON.parse(cleaned);
}

async function readBody(req) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 1_000_000) {
      throw new Error('Request body is too large.');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });

  res.end(JSON.stringify(data));
}
// --------------------------------------------------
// 10. API request handler
// --------------------------------------------------

const placesCache = new Map();

async function findOpenStreetMapPlaces(destination) {
  const cacheKey = destination.trim().toLowerCase();

  // Reuse results for 24 hours to reduce API requests.
  const cached = placesCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 24 * 60 * 60 * 1000) {
    return cached.places;
  }

  // Step 1: Find the destination's coordinates.
  const geocodeUrl = new URL(
    'https://nominatim.openstreetmap.org/search'
  );
  geocodeUrl.searchParams.set('format', 'jsonv2');
  geocodeUrl.searchParams.set('q', destination);
  geocodeUrl.searchParams.set('limit', '1');

  const geoResponse = await fetch(geocodeUrl, {
    headers: { 'User-Agent': 'TripSync/1.0' },
    signal: AbortSignal.timeout(15000)
  });

  if (!geoResponse.ok) {
    throw new Error('Could not search for this destination.');
  }

  const geoResults = await geoResponse.json();

  if (!geoResults.length) {
    throw new Error('Destination not found. Try another destination name.');
  }

  const { lat, lon } = geoResults[0];

  // Step 2: Search for attractions, cafes and restaurants nearby.
  const query = `
    [out:json][timeout:20];
    (
      nwr(around:6000,${lat},${lon})["name"]["tourism"~"attraction|museum|viewpoint|gallery|zoo|theme_park"];
      nwr(around:6000,${lat},${lon})["name"]["amenity"~"cafe|restaurant"];
    );
    out center tags 40;
  `;

  const overpassResponse = await fetch(
    'https://overpass-api.de/api/interpreter',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TripSync/1.0'
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(25000)
    }
  );

  if (!overpassResponse.ok) {
    throw new Error('The places service is temporarily unavailable. Please try again.');
  }

  const overpassData = await overpassResponse.json();

  const places = overpassData.elements
    .filter(item => item.tags?.name)
    .map(item => ({
      name: item.tags.name,
      category: item.tags.tourism || item.tags.amenity || 'place',
      latitude: item.lat ?? item.center?.lat,
      longitude: item.lon ?? item.center?.lon,
      address: item.tags['addr:street'] || '',
      website: item.tags.website || ''
    }))
    .filter((place, index, all) =>
      all.findIndex(p => p.name === place.name) === index
    );

  placesCache.set(cacheKey, {
    time: Date.now(),
    places
  });

  return places;
}

async function handle(req, res) {
  // CORS for local development.
  const origin = req.headers.origin;

  const allowedOrigin =
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );
  let body = {};

if (req.method === 'POST') {
  try {
    let rawBody = '';

    for await (const chunk of req) {
      rawBody += chunk;

      if (rawBody.length > 1024 * 1024) {
        return send(res, 413, {
          error: 'Request body is too large.'
        });
      }
    }

    body = rawBody ? JSON.parse(rawBody) : {};

  } catch (error) {
    return send(res, 400, {
      error: 'Invalid JSON request body.'
    });
  }
}

  // --------------------------------------------------
  // 11. Database health check
  // --------------------------------------------------

  if (
    req.method === 'GET' &&
    url.pathname === '/api/database-health'
  ) {
    try {
      const pool = getDbPool();

      const [rows] = await pool.query(
        'SELECT DATABASE() AS db_name'
      );

      return send(res, 200, {
        connected: true,
        database: rows[0].db_name
      });

    } catch (error) {
      console.error('MySQL connection error:', error.message);

      return send(res, 500, {
        connected: false,
        error: error.message
      });
    }
  }

  // --------------------------------------------------
  // 12. Relational database health check
  // --------------------------------------------------

  if (
    req.method === 'GET' &&
    url.pathname === '/api/relational-health'
  ) {
    try {
      const pool = getDbPool();

      const tables = [
        'trip_sync_users',
        'trip_participants',
        'trip_expenses',
        'trip_expense_shares',
        'trip_todo_items',
        'trip_itineraries'
      ];

      const results = {};

      for (const table of tables) {
        const [rows] = await pool.query(
          `SELECT COUNT(*) AS total FROM \`${table}\``
        );

        results[table] = Number(rows[0].total);
      }

      return send(res, 200, {
        connected: true,
        relationalTables: results
      });

    } catch (error) {
      console.error('Relational database check failed:', error);

      return send(res, 500, {
        connected: false,
        error: 'Could not verify all relational tables. Run the migration script first.'
      });
    }
  }

  // --------------------------------------------------
  // 13. General API health check
  // --------------------------------------------------

  if (
    req.method === 'GET' &&
    url.pathname === '/api/health'
  ) {
    return send(res, 200, {
      ok: true,
      aiEnabled: Boolean(ai),
      mode: ai ? 'gemini' : 'demo',
      databaseMode: 'relational'
    });
  }

  
  // --------------------------------------------------
// 14. ETL data-quality report
// --------------------------------------------------

if (
  req.method === 'GET' &&
  url.pathname === '/api/data-quality'
) {
  const userId = url.searchParams.get('uid');

  if (!userId) {
    return send(res, 400, {
      error: 'User ID is required.'
    });
  }

  const projectRoot = path.resolve(__dirname, '..');

  const scriptPath = path.join(
    projectRoot,
    'data_pipeline',
    'etl_expenses.py'
  );

  const outputDir = path.join(
    projectRoot,
    'data_pipeline',
    'actual_output'
  );

  const reportPath = path.join(
    outputDir,
    'quality_report.json'
  );

  try {
    // Run Python ETL for the currently logged-in user
    const result = await execFileAsync(
      process.env.PYTHON_EXECUTABLE || path.join(projectRoot, 'data_pipeline', '.venv', 'bin', 'python'),
      [
        scriptPath,
        '--user-id',
        userId,
        '--output-dir',
        outputDir
      ],
      {
        cwd: projectRoot,
        timeout: 120000,
        maxBuffer: 1024 * 1024
      }
    );

    console.log('Python ETL output:', result.stdout);

    // Read the newly generated report
    if (!existsSync(reportPath)) {
      throw new Error('Python pipeline did not generate a quality report.');
    }

    const report = JSON.parse(
      readFileSync(reportPath, 'utf8')
    );

    return send(res, 200, {
      recordsReceived: Number(report.records_received || 0),
      validRecords: Number(report.valid_records || 0),
      rejectedRecords: Number(report.rejected_records || 0),
      duplicateRecords: Number(report.duplicate_records || 0)
    });

  } catch (error) {
    console.error('ETL pipeline error:', error);

    return send(res, 500, {
      error: 'Could not run the Python ETL pipeline. Check the Node.js terminal.'
    });
  }
}
  // --------------------------------------------------
  // 15. Retrieve user data from relational tables
  // --------------------------------------------------

  if (
    req.method === 'GET' &&
    url.pathname === '/api/user-data'
  ) {
    try {
      const uid = url.searchParams.get('uid');

      if (!validUid(uid)) {
        return send(res, 400, {
          error: 'Valid user ID is required.'
        });
      }

      const result = await getRelationalUserData(uid);

      return send(res, 200, result);

    } catch (error) {
      console.error('Relational data retrieval error:', error);

      return send(res, 500, {
        error: 'Could not retrieve user data from relational tables.'
      });
    }
  }
  // --------------------------------------------------
// 16. Save user data to relational tables
// --------------------------------------------------

if (
  req.method === 'POST' &&
  url.pathname === '/api/user-data'
) {
  try {
    const { uid, data } = body;

    if (!validUid(uid)) {
      return send(res, 400, {
        error: 'Valid user ID is required.'
      });
    }

    if (!validateUserData(data)) {
      return send(res, 400, {
        error: 'Invalid user data.'
      });
    }

    await saveRelationalUserData(uid, data);

    return send(res, 200, {
      success: true,
      message: 'User data saved successfully.'
    });

  } catch (error) {
    console.error('Relational data save error:', error);

    return send(res, 500, {
      error: 'Could not save user data to relational tables.'
    });
  }
}
    // --------------------------------------------------
  // 18. Generate itinerary
  // --------------------------------------------------


    // Search real places using OpenStreetMap.
    if (url.pathname === '/api/places') {
      const { destination } = body;

      if (typeof destination !== 'string' || !destination.trim()) {
        return send(res, 400, {
          error: 'Please provide a destination.'
        });
      }

      try {
        const places = await findOpenStreetMapPlaces(destination.trim());

        return send(res, 200, {
          destination: destination.trim(),
          count: places.length,
          places,
          source: 'OpenStreetMap'
        });
      } catch (error) {
        console.error('OpenStreetMap places error:', error.message);

        return send(res, 502, {
          error: error.message || 'Could not find places.'
        });
      }
    }

  if (url.pathname === '/api/itinerary') {
    const { destination, duration, interests } = body;

    if (
      typeof destination !== 'string' ||
      !destination.trim()
    ) {
      return send(res, 400, {
        error: 'Please provide a destination.'
      });
    }

    const days = Number(duration);

    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 14
    ) {
      return send(res, 400, {
        error: 'Duration must be between 1 and 14 days.'
      });
    }

    if (
      typeof interests !== 'string' ||
      !interests.trim()
    ) {
      return send(res, 400, {
        error: 'Please describe your interests or travel style.'
      });
    }

    if (!ai) {
      return send(
        res,
        200,
        demoItinerary(
          destination.trim(),
          days,
          interests.trim()
        )
      );
    }

    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',


contents: `Create a detailed, realistic ${days}-day travel itinerary for ${destination}.

The traveller's interests and preferences are: ${interests}.

IMPORTANT INSTRUCTIONS:

1. Recommend real, established tourist attractions, landmarks, neighbourhoods, museums, parks and other places that are known to exist in ${destination}.
2. Recommend genuine, recognizable cafes and restaurants. Do not invent business names or claim that a restaurant exists if you are unsure.
3. Organize activities geographically. Places visited on the same day should be reasonably close to each other.
4. Create exactly ${days} days.
5. Each day must contain exactly 3 activities and 2 food recommendations.
6. For activities, include the actual place name followed by a short explanation of why it is worth visiting.
7. For food recommendations, include the restaurant or cafe name and the type of food or experience.
8. Match recommendations to the traveller's interests.
9. Include a sensible mixture of famous attractions and local experiences.
10. Do not invent opening hours, ticket prices, addresses, ratings or reservation availability.
11. Avoid repeating the same attraction, restaurant or cafe across multiple days.
12. Make the schedule practical, with a reasonable amount of travel and sightseeing each day.

Return a useful, concise and realistic itinerary.`,

        config: {
  systemInstruction: 'You are a travel planner. Return valid JSON matching the supplied schema. Keep every description concise.',
  responseMimeType: 'application/json',
  responseSchema: itinerarySchema,
  maxOutputTokens: 1800
}
      });

      const parsed = extractJson(response.text || '');

      if (
        !Array.isArray(parsed.itinerary) ||
        parsed.itinerary.length !== days
      ) {
        throw new Error('Unexpected itinerary structure.');
      }

      return send(res, 200, {
        destination: destination.trim(),
        ...parsed,
        mode: 'gemini'
      });

    } catch (error) {
  console.error('Gemini error message:', error.message);
  console.error('Gemini error status:', error.status);
  console.error('Gemini error details:', error.error?.message);
      return send(res, 502, {
        error: 'Gemini could not generate the itinerary. Check your API key, model access and quota.'
      });
    }
  }

  // --------------------------------------------------
  // 19. Packing suggestions
  // --------------------------------------------------

  if (url.pathname === '/api/packing-suggestions') {
    const itinerary = body.itinerary;

    if (
      !itinerary ||
      !Array.isArray(itinerary.itinerary)
    ) {
      return send(res, 400, {
        error: 'Generate an itinerary before requesting packing suggestions.'
      });
    }

    if (!ai) {
      return send(res, 200, {
        suggestions: [
          'Comfortable walking shoes',
          'Weather-appropriate clothing',
          'Reusable water bottle',
          'Phone charger and power bank',
          'Travel documents and ID',
          'Personal medication and basic first-aid items',
          'Toiletries and sunscreen',
          'Small day backpack',
          'Reusable shopping bag',
          'Camera or headphones'
        ],
        mode: 'demo'
      });
    }

    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

        contents: `Suggest 10-15 useful packing items for this trip: ${JSON.stringify(itinerary)}`,

        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ['suggestions']
          }
        }
      });

      const parsed = extractJson(response.text || '');

      return send(res, 200, {
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions
          : []
      });

    } catch (error) {
      console.error('Gemini packing suggestions error:', error);

      return send(res, 502, {
        error: 'Could not generate packing suggestions. Check your Gemini API key and try again.'
      });
    }
  }

  // --------------------------------------------------
  // 20. Currency conversion
  // --------------------------------------------------

  if (url.pathname === '/api/conversion-rates') {
    const baseCurrency = (
  url.searchParams.get('base') || 'USD'
).toUpperCase();

const targetCurrencies = (
  url.searchParams.get('targets') || 'USD,EUR,JPY,GBP,CAD,INR'
)
  .split(',')
  .map(currency => currency.trim().toUpperCase())
  .filter(Boolean);


    const usdPerUnit = {
      USD: 1,
      EUR: 1.08,
      JPY: 0.0067,
      GBP: 1.27,
      CAD: 0.74,
      INR: 0.012
    };

    if (
      !usdPerUnit[baseCurrency] ||
      !Array.isArray(targetCurrencies)
    ) {
      return send(res, 400, {
        error: 'Unsupported base currency or target currency list.'
      });
    }

    const rates = {};

    for (const currency of targetCurrencies) {
      if (!usdPerUnit[currency]) {
        return send(res, 400, {
          error: `Unsupported currency: ${currency}`
        });
      }

      rates[currency] =
        usdPerUnit[currency] / usdPerUnit[baseCurrency];
    }

    return send(res, 200, {
      rates,
      mode: 'demo',
      notice: 'Approximate reference rates for demonstration only; not live exchange rates.'
    });
  }

  // --------------------------------------------------
  // 21. Unknown API route
  // --------------------------------------------------

  return send(res, 404, {
    error: 'API route not found.'
  });
}

// --------------------------------------------------
// 22. Start API server
// --------------------------------------------------

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error('API server error:', error);

    if (!res.headersSent) {
      send(res, 500, {
        error: 'Unexpected server error.'
      });
    } else {
      res.end();
    }
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the existing TripSync API process.`
    );
    return;
  }

  console.error('Server startup error:', error);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TripSync API running at http://localhost:${PORT}`);
  console.log(`MySQL configuration: ${process.env.DB_NAME || 'Not configured'}`);
  console.log('Database mode: Normalized relational tables');
  console.log(`Gemini AI: ${ai ? 'enabled' : 'demo mode (no API key configured)'}`);
});