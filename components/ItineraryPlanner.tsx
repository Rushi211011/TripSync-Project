import React, { useState, useCallback } from 'react';
import { generateItinerary } from '../services/geminiService';
import type { Itinerary, DailyPlan } from '../types';
import { MapPin, Calendar, Sparkles, Sun, Utensils, Loader2, AlertTriangle } from 'lucide-react';

const ItineraryCard: React.FC<{ plan: DailyPlan, className?: string, style?: React.CSSProperties }> = ({ plan, className, style }) => (
  <div className={`bg-white rounded-xl shadow-lg overflow-hidden transition-transform duration-300 hover:scale-105 hover:shadow-xl ${className}`} style={style}>
    <div className="bg-primary p-4 text-white">
      <h3 className="text-xl font-bold">{plan.day}: {plan.title}</h3>
    </div>
    <div className="p-6 space-y-4">
      <div>
        <h4 className="font-semibold text-lg flex items-center gap-2 mb-2 text-neutral">
          <Sun className="text-secondary" /> Activities
        </h4>
        <ul className="list-disc list-inside space-y-1 text-gray-600">
          {plan.activities.map((activity, i) => <li key={i}>{activity}</li>)}
        </ul>
      </div>
      <div>
        <h4 className="font-semibold text-lg flex items-center gap-2 mb-2 text-neutral">
          <Utensils className="text-accent" /> Food Suggestions
        </h4>
        <ul className="list-disc list-inside space-y-1 text-gray-600">
          {plan.food.map((food, i) => <li key={i}>{food}</li>)}
        </ul>
      </div>
    </div>
  </div>
);

const SkeletonCard: React.FC = () => (
  <div className="bg-white rounded-xl shadow-lg overflow-hidden animate-pulse">
    <div className="bg-base-300 h-16 w-full"></div>
    <div className="p-6 space-y-4">
      <div className="space-y-2">
        <div className="h-4 bg-base-300 rounded w-3/4"></div>
        <div className="h-3 bg-base-200 rounded w-full"></div>
        <div className="h-3 bg-base-200 rounded w-5/6"></div>
      </div>
      <div className="space-y-2">
        <div className="h-4 bg-base-300 rounded w-1/2"></div>
        <div className="h-3 bg-base-200 rounded w-full"></div>
        <div className="h-3 bg-base-200 rounded w-4/5"></div>
      </div>
    </div>
  </div>
);

interface ItineraryPlannerProps {
  itinerary: Itinerary | null;
  setItinerary: (itinerary: Itinerary | null) => void;
}

const ItineraryPlanner: React.FC<ItineraryPlannerProps> = ({ itinerary, setItinerary }) => {
  const [destination, setDestination] = useState('');
  const [duration, setDuration] = useState('5');
  const [interests, setInterests] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination || !duration || !interests) {
      setError('Please fill out all fields to generate your trip plan.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setItinerary(null);
    try {
      const durationNum = parseInt(duration, 10);
      const result = await generateItinerary(destination, durationNum, interests);
      setItinerary(result);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [destination, duration, interests, setItinerary]);

  return (
    <div className="space-y-8">
      <div className="bg-white p-6 rounded-2xl shadow-md">
        <h2 className="text-3xl font-bold text-neutral mb-1">Plan Your Next Adventure</h2>
        <p className="text-gray-500 mb-6">Let our AI craft the perfect trip for you.</p>
        <form onSubmit={handleGenerate} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
              <input 
                type="text" 
                id="destination" 
                value={destination} 
                onChange={(e) => setDestination(e.target.value)} 
                placeholder=" "
                className="block w-full pl-10 pr-4 py-3 text-sm text-neutral bg-white rounded-lg border-2 border-base-300 appearance-none focus:outline-none focus:ring-0 focus:border-primary peer transition-colors duration-300" 
              />
              <label 
                htmlFor="destination" 
                className="absolute text-sm text-gray-500 duration-300 transform -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-white px-1 left-10 peer-focus:text-primary peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4"
              >
                Destination
              </label>
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
              <input 
                type="number" 
                id="duration" 
                value={duration} 
                onChange={(e) => setDuration(e.target.value)} 
                placeholder=" " 
                min="1" 
                max="14" 
                className="block w-full pl-10 pr-4 py-3 text-sm text-neutral bg-white rounded-lg border-2 border-base-300 appearance-none focus:outline-none focus:ring-0 focus:border-primary peer transition-colors duration-300" 
              />
               <label 
                htmlFor="duration" 
                className="absolute text-sm text-gray-500 duration-300 transform -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-white px-1 left-10 peer-focus:text-primary peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4"
              >
                Duration (days)
              </label>
            </div>
          </div>
          <div className="md:col-span-2 relative">
            <Sparkles className="absolute left-3 top-3.5 text-gray-400 pointer-events-none" size={20} />
            <textarea 
              id="interests" 
              value={interests} 
              onChange={(e) => setInterests(e.target.value)} 
              placeholder=" " 
              rows={3} 
              className="block w-full pl-10 pr-4 py-3 text-sm text-neutral bg-white rounded-lg border-2 border-base-300 appearance-none focus:outline-none focus:ring-0 focus:border-primary peer transition-colors duration-300"
            ></textarea>
            <label 
              htmlFor="interests" 
              className="absolute text-sm text-gray-500 duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] bg-white px-1 left-10 peer-focus:text-primary peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4"
            >
              Interests & Vibe
            </label>
          </div>
          <div className="md:col-span-2">
            <button type="submit" disabled={isLoading} className="w-full flex items-center justify-center gap-2 bg-primary text-white font-bold py-3 px-4 rounded-lg hover:bg-primary-focus focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Generating Your Dream Trip...
                </>
              ) : (
                'Generate Itinerary'
              )}
            </button>
          </div>
        </form>
      </div>

      {isLoading && (
        <div className="space-y-6">
          <h2 className="text-3xl font-bold text-center text-neutral animate-pulse">Crafting your adventure...</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {Array.from({ length: Math.min(parseInt(duration, 10) || 3, 6) }).map((_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-100 border-l-4 border-error text-red-700 p-4 rounded-lg flex items-center gap-4 animate-fade-in">
          <AlertTriangle className="text-error" />
          <p>{error}</p>
        </div>
      )}

      {itinerary && !isLoading && (
        <div className="space-y-6 animate-fade-in">
          <h2 className="text-3xl font-bold text-center text-neutral">Your Custom Itinerary for {itinerary.destination}</h2>
          {itinerary.mode === 'demo' && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Demo mode:</strong> This sample itinerary keeps the app usable without an API key. Add a valid GEMINI_API_KEY to the server .env file for real AI-generated itineraries.
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {itinerary.itinerary.map((plan, index) => (
              <ItineraryCard 
                key={plan.day} 
                plan={plan} 
                style={{ animationDelay: `${index * 100}ms` }} 
                className="opacity-0 animate-fade-in-up" 
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ItineraryPlanner;