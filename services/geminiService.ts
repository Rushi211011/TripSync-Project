import type { Itinerary } from '../types';

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the TripSync API. Make sure the backend is running with `npm run dev`.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload as T;
}

export async function generateItinerary(
  destination: string,
  duration: number,
  interests: string
): Promise<Itinerary> {
  if (!destination.trim()) throw new Error('Enter a destination.');
  if (!Number.isInteger(duration) || duration < 1 || duration > 14) {
    throw new Error('Trip duration must be between 1 and 14 days.');
  }
  if (!interests.trim()) throw new Error('Enter your interests or travel style.');

  return post<Itinerary>('/itinerary', {
    destination: destination.trim(),
    duration,
    interests: interests.trim(),
  });
}

export async function getConversionRates(
  baseCurrency: string,
  targetCurrencies: string[]
): Promise<Record<string, number>> {
  const result = await post<{ rates: Record<string, number> }>('/conversion-rates', {
    baseCurrency,
    targetCurrencies,
  });
  return result.rates;
}

export async function generatePackingSuggestions(itinerary: Itinerary): Promise<string[]> {
  const result = await post<{ suggestions: string[] }>('/packing-suggestions', { itinerary });
  return result.suggestions;
}
