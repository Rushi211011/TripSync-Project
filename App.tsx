
import React, {
  useState,
  useEffect,
  useCallback,
  useRef
} from 'react';

import { Routes, Route, useLocation, Link } from 'react-router-dom';

import {
  Plane,
  Wallet,
  UserCircle,
  LogOut,
  ClipboardList,
  LockKeyhole,
  Loader2,
  ChartNoAxesCombined,
  Database
} from 'lucide-react';

import {
  onAuthStateChanged,
  signOut,
  type User as FirebaseUser
} from 'firebase/auth';

import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from './firebase';

import ItineraryPlanner from './components/ItineraryPlanner';
import ExpenseSplitter from './components/ExpenseSplitter';
import ExpenseAnalytics from './components/ExpenseAnalytics';
import DataEngineering from './components/DataEngineering';
import LoginModal from './components/LoginModal';
import SharedLists from './components/SharedLists';

import type {
  Itinerary,
  Participant,
  Expense,
  TodoItem
} from './types';

// --------------------------------------------------
// 1. API configuration
// --------------------------------------------------

const API_URL = 'http://localhost:8787/api';

// --------------------------------------------------
// 2. Application data structure
// --------------------------------------------------

type TripSyncData = {
  participants: Participant[];
  expenses: Expense[];
  todoItems: TodoItem[];
  itinerary: Itinerary | null;
};

const EMPTY_DATA: TripSyncData = {
  participants: [],
  expenses: [],
  todoItems: [],
  itinerary: null
};

// --------------------------------------------------
// 3. Legacy browser data
// --------------------------------------------------

const getLegacyArray = <T,>(key: string): T[] => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T[] : [];
  } catch (error) {
    console.warn(`Could not read ${key}:`, error);
    return [];
  }
};

// --------------------------------------------------
// 4. API helper
// --------------------------------------------------

async function apiRequest(
  endpoint: string,
  options: RequestInit = {}
) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'API request failed.');
  }

  return result;
}

// --------------------------------------------------
// 5. Header
// --------------------------------------------------

interface HeaderProps {
  user: { name: string } | null;
  onLoginClick: () => void;
  onLogoutClick: () => void;
}

const Header: React.FC<HeaderProps> = ({
  user,
  onLoginClick,
  onLogoutClick
}) => (
  <header className="bg-primary text-primary-content shadow-lg w-full">
    <div className="container mx-auto p-4 flex justify-between items-center">
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold tracking-tight">
          TripSync
        </h1>
        <p className="hidden md:block text-sm opacity-80 -mt-1">
          AI Itinerary & Group Expenses
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="font-semibold hidden sm:inline">
              Welcome, {user.name}!
            </span>

            <button
              onClick={onLogoutClick}
              className="flex items-center gap-2 px-4 py-2 bg-white text-primary rounded-lg text-sm font-semibold shadow-sm hover:bg-gray-200 transition-colors"
            >
              <LogOut size={20} />
              <span className="hidden sm:inline">Log Out</span>
            </button>
          </div>
        ) : (
          <button
            onClick={onLoginClick}
            className="flex items-center gap-2 px-4 py-2 bg-white text-primary rounded-lg text-sm font-semibold shadow-sm hover:bg-gray-200 transition-colors"
          >
            <UserCircle size={20} />
            <span className="hidden sm:inline">
              Login / Sign Up
            </span>
          </button>
        )}
      </div>
    </div>
  </header>
);

// --------------------------------------------------
// 6. Navigation
// --------------------------------------------------

const NavLink: React.FC<{
  path: string;
  label: string;
  icon: React.ElementType;
}> = ({ path, label, icon: Icon }) => {
  const location = useLocation();
  const isActive = location.pathname === path;

  return (
    <Link
      to={path}
      className={`flex flex-col items-center justify-center p-3 text-sm font-medium transition-colors duration-200 md:flex-row md:w-full md:justify-start md:gap-3 md:px-4 md:py-3 md:rounded-lg ${
        isActive
          ? 'bg-primary/10 text-primary font-semibold'
          : 'text-slate-600 hover:bg-base-200 hover:text-primary'
      }`}
    >
      <Icon size={22} />
      <span className="md:inline">{label}</span>
    </Link>
  );
};

const Navigation: React.FC = () => {
  const navItems = [
    { path: '/', label: 'Plan Trip', icon: Plane },
    { path: '/expenses', label: 'Expenses', icon: Wallet },
    { path: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
    { path: '/data-engineering', label: 'Data Engineering', icon: Database }
  ];

  const listNavItem = {
    path: '/lists',
    label: 'Lists',
    icon: ClipboardList
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.1)] md:relative md:shadow-none md:bg-transparent md:h-full">

      <div className="container mx-auto flex justify-around md:hidden">
        {[...navItems, listNavItem].map(item => (
          <NavLink key={item.path} {...item} />
        ))}
      </div>

      <div className="hidden md:flex md:flex-col md:h-full">
        <div className="space-y-2">
          {navItems.map(item => (
            <NavLink key={item.path} {...item} />
          ))}
        </div>

        <div className="mt-auto">
          <NavLink {...listNavItem} />
        </div>
      </div>
    </nav>
  );
};

// --------------------------------------------------
// 7. Login required screen
// --------------------------------------------------

const LoginRequired: React.FC<{
  onLoginClick: () => void;
}> = ({ onLoginClick }) => (
  <div className="max-w-xl mx-auto mt-12 bg-white rounded-2xl shadow-md p-8 text-center">
    <LockKeyhole className="mx-auto text-primary mb-3" size={40} />

    <h2 className="text-2xl font-bold text-neutral mb-2">
      Sign in to access your data
    </h2>

    <p className="text-gray-600 mb-5">
      Your trips, expenses and lists are private to your account.
      Sign in to view and manage them.
    </p>

    <button
      onClick={onLoginClick}
      className="bg-primary text-white font-semibold rounded-lg px-6 py-3 hover:opacity-90"
    >
      Login / Sign Up
    </button>
  </div>
);

// --------------------------------------------------
// 8. Main application
// --------------------------------------------------

export default function App() {
  const [currentUser, setCurrentUser] = useState<{
    uid: string;
    name: string;
  } | null>(null);

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const [tripData, setTripData] = useState<TripSyncData>(EMPTY_DATA);

  const tripDataRef = useRef<TripSyncData>(EMPTY_DATA);

  const [dataLoading, setDataLoading] = useState(false);

  const [dataError, setDataError] = useState<string | null>(null);

  const [authReady, setAuthReady] = useState(false);

  const dataReadyRef = useRef(false);

  // Serialize saves to prevent older requests
  // overwriting newer application data.

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const activeUidRef = useRef<string | null>(null);

  const replaceTripData = (next: TripSyncData) => {
    tripDataRef.current = next;
    setTripData(next);
  };

  // --------------------------------------------------
  // 9. Firebase authentication + MySQL loading
  // --------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const authUnsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser: FirebaseUser | null) => {
        dataReadyRef.current = false;
        activeUidRef.current = firebaseUser?.uid ?? null;

        setAuthReady(true);
        setDataError(null);

        if (!firebaseUser) {
          setCurrentUser(null);
          setDataLoading(false);
          replaceTripData(EMPTY_DATA);
          return;
        }

        const displayName = firebaseUser.email
          ? firebaseUser.email.split('@')[0]
          : 'User';

        setCurrentUser({
          uid: firebaseUser.uid,
          name:
            displayName.charAt(0).toUpperCase() +
            displayName.slice(1)
        });

        setDataLoading(true);

        try {
          // First attempt: load the user's existing MySQL data.

          const result = await apiRequest(
            `/user-data?uid=${encodeURIComponent(firebaseUser.uid)}`
          );

          if (
            cancelled ||
            auth.currentUser?.uid !== firebaseUser.uid
          ) {
            return;
          }

          let loadedData: TripSyncData;

          if (result.exists) {
            loadedData = {
              participants: result.data.participants || [],
              expenses: result.data.expenses || [],
              todoItems: result.data.todoItems || [],
              itinerary: result.data.itinerary || null
            };
          } else {
            // MySQL record does not exist.
            // Migrate existing Firestore data first.

            const firestoreRef = doc(
              db,
              'users',
              firebaseUser.uid,
              'appData',
              'main'
            );

            const firestoreSnapshot = await getDoc(firestoreRef);

            if (
              cancelled ||
              auth.currentUser?.uid !== firebaseUser.uid
            ) {
              return;
            }

            if (firestoreSnapshot.exists()) {
              const stored = firestoreSnapshot.data();

              loadedData = {
                participants: Array.isArray(stored.participants)
                  ? stored.participants
                  : [],

                expenses: Array.isArray(stored.expenses)
                  ? stored.expenses
                  : [],

                todoItems: Array.isArray(stored.todoItems)
                  ? stored.todoItems
                  : [],

                itinerary: stored.itinerary ?? null
              };
            } else {
              // If Firestore has no record, check old browser storage.

              loadedData = {
                participants: getLegacyArray<Participant>(
                  'tripSyncParticipants'
                ),

                expenses: getLegacyArray<Expense>(
                  'tripSyncExpenses'
                ),

                todoItems: getLegacyArray<TodoItem>(
                  'tripSyncTodoItems'
                ),

                itinerary: null
              };
            }

            // Save migrated data to MySQL.

            await apiRequest('/user-data', {
              method: 'POST',
              body: JSON.stringify({
                uid: firebaseUser.uid,
                data: loadedData
              })
            });
          }

          if (
            cancelled ||
            auth.currentUser?.uid !== firebaseUser.uid
          ) {
            return;
          }

          replaceTripData(loadedData);

          dataReadyRef.current = true;
          setDataLoading(false);
          setDataError(null);

        } catch (error) {
          console.error('TripSync MySQL initialization failed:', error);

          if (
            cancelled ||
            auth.currentUser?.uid !== firebaseUser.uid
          ) {
            return;
          }

          setDataError(
            'Could not load your data from MySQL. Check that the backend and database are running.'
          );

          setDataLoading(false);
          dataReadyRef.current = false;
        }
      }
    );

    return () => {
      cancelled = true;
      authUnsubscribe();
    };
  }, []);

  // --------------------------------------------------
  // 10. Save data to MySQL
  // --------------------------------------------------

  const saveUserField = useCallback(
    <K extends keyof TripSyncData>(
      key: K,
      value: TripSyncData[K]
    ) => {
      const activeUser = auth.currentUser;

      if (
        !activeUser ||
        !dataReadyRef.current ||
        activeUidRef.current !== activeUser.uid
      ) {
        return;
      }

      const next = {
        ...tripDataRef.current,
        [key]: value
      };

      // Update UI immediately.

      tripDataRef.current = next;
      setTripData(next);

      // Queue complete data snapshots in order.

      const snapshot = structuredClone(next);
      const uid = activeUser.uid;

      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            auth.currentUser?.uid !== uid ||
            activeUidRef.current !== uid
          ) {
            return;
          }

          await apiRequest('/user-data', {
            method: 'POST',
            body: JSON.stringify({
              uid,
              data: snapshot
            })
          });

          if (activeUidRef.current === uid) {
            setDataError(null);
          }
        })
        .catch(error => {
          console.error(
            `Could not save ${String(key)} to MySQL:`,
            error
          );

          if (activeUidRef.current === uid) {
            setDataError(
              `Your ${String(key)} could not be saved. Check your backend connection.`
            );
          }
        });
    },
    []
  );

  // --------------------------------------------------
  // 11. Logout
  // --------------------------------------------------

  const handleLogout = async () => {
    dataReadyRef.current = false;

    replaceTripData(EMPTY_DATA);
    setDataError(null);

    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);

      setDataError('Could not log out. Please try again.');
    }
  };

  const loginClick = () => setIsLoginModalOpen(true);

  // --------------------------------------------------
  // 12. Application UI and routes
  // --------------------------------------------------

  return (
    <div className="min-h-screen flex flex-col bg-base-100 text-neutral">

      <Header
        user={currentUser}
        onLoginClick={loginClick}
        onLogoutClick={handleLogout}
      />

      <div className="flex flex-col md:flex-row flex-grow container mx-auto">

        <aside className="hidden md:block md:w-64 p-4">
          <Navigation />
        </aside>

        <main className="flex-grow p-4 pb-24 md:pb-4">

          {!authReady ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          ) : (
            <Routes>

              <Route
                path="/"
                element={
                  <ItineraryPlanner
                    itinerary={tripData.itinerary}
                    setItinerary={(value) =>
                      saveUserField('itinerary', value)
                    }
                  />
                }
              />

              <Route
                path="/expenses"
                element={
                  currentUser ? (
                    dataLoading ? (
                      <div className="flex justify-center py-16">
                        <Loader2 className="animate-spin text-primary" size={32} />
                      </div>
                    ) : (
                      <ExpenseSplitter
                        participants={tripData.participants}
                        expenses={tripData.expenses}
                        setParticipants={(value) =>
                          saveUserField('participants', value)
                        }
                        setExpenses={(value) =>
                          saveUserField('expenses', value)
                        }
                      />
                    )
                  ) : (
                    <LoginRequired onLoginClick={loginClick} />
                  )
                }
              />

              <Route
                path="/analytics"
                element={
                  currentUser ? (
                    dataLoading ? (
                      <div className="flex justify-center py-16">
                        <Loader2 className="animate-spin text-primary" size={32} />
                      </div>
                    ) : (
                      <ExpenseAnalytics
                        participants={tripData.participants}
                        expenses={tripData.expenses}
                      />
                    )
                  ) : (
                    <LoginRequired onLoginClick={loginClick} />
                  )
                }
              />

              <Route
                path="/data-engineering"
                element={
                  currentUser ? (
                    <DataEngineering uid={currentUser.uid} />
                  ) : (
                    <LoginRequired onLoginClick={loginClick} />
                  )
                }
              />

              <Route
                path="/lists"
                element={
                  currentUser ? (
                    dataLoading ? (
                      <div className="flex justify-center py-16">
                        <Loader2 className="animate-spin text-primary" size={32} />
                      </div>
                    ) : (
                      <SharedLists
                        items={tripData.todoItems}
                        setItems={(action) => {
                          const nextItems =
                            typeof action === 'function'
                              ? action(tripDataRef.current.todoItems)
                              : action;

                          saveUserField('todoItems', nextItems);
                        }}
                        itinerary={tripData.itinerary}
                      />
                    )
                  ) : (
                    <LoginRequired onLoginClick={loginClick} />
                  )
                }
              />

            </Routes>
          )}

          {dataError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700"
            >
              {dataError}
            </div>
          )}

        </main>
      </div>

      <div className="md:hidden">
        <Navigation />
      </div>

      {isLoginModalOpen && (
        <LoginModal
          onClose={() => setIsLoginModalOpen(false)}
        />
      )}

    </div>
  );
}
