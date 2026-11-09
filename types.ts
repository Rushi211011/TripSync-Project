
export interface DailyPlan {
  day: string;
  title: string;
  activities: string[];
  food: string[];
}

export interface Itinerary {
  destination: string;
  itinerary: DailyPlan[];
  mode?: 'demo' | 'gemini';
  notice?: string;
}

export interface Participant {
  id: number;
  name: string;
}


export interface Expense {
  id: number;
  description: string;
  amount: number;
  currency: string;
  paidById: number;
  sharedByIds: number[];
  shareAmounts?: {
    participantId: number;
    amount: number;
  }[];
  category?: string;
  date?: string;
}


export interface Balance {
  participant: Participant;
  amount: number;
}

export interface User {
  name: string;
}

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  listType: 'todo' | 'packing';
}
