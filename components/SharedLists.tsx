
// FIX: Import Dispatch and SetStateAction to correctly type the setItems prop.
import React, { useState, Dispatch, SetStateAction } from 'react';
import type { TodoItem, Itinerary } from '../types';
import { generatePackingSuggestions } from '../services/geminiService';
import { Plus, Trash2, ClipboardCheck, Briefcase, Sparkles, Loader2, AlertTriangle } from 'lucide-react';

interface SharedListsProps {
  items: TodoItem[];
  // FIX: Update the type of setItems to allow for functional updates, which are safer for async operations.
  setItems: Dispatch<SetStateAction<TodoItem[]>>;
  itinerary: Itinerary | null;
}

interface ListSectionProps {
  title: string;
  icon: React.ReactNode;
  items: TodoItem[];
  listType: 'todo' | 'packing';
  onAddItem: (text: string, listType: 'todo' | 'packing') => void;
  onToggleItem: (id: number) => void;
  onDeleteItem: (id: number) => void;
  isPackingList?: boolean;
  onGetSuggestions?: () => void;
  isSuggesting?: boolean;
  itineraryExists?: boolean;
}

const ListSection: React.FC<ListSectionProps> = ({
  title,
  icon,
  items,
  listType,
  onAddItem,
  onToggleItem,
  onDeleteItem,
  isPackingList,
  onGetSuggestions,
  isSuggesting,
  itineraryExists,
}) => {
  const [newItemText, setNewItemText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newItemText.trim()) {
      onAddItem(newItemText.trim(), listType);
      setNewItemText('');
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-neutral flex items-center gap-2">
          {icon} {title}
        </h3>
        {isPackingList && (
          <button
            onClick={onGetSuggestions}
            disabled={!itineraryExists || isSuggesting}
            className="flex items-center gap-2 text-sm bg-secondary text-white font-semibold py-2 px-3 rounded-lg hover:bg-secondary-focus disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Get AI packing suggestions"
          >
            {isSuggesting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            <span>{isSuggesting ? 'Getting ideas...' : 'AI Suggestions'}</span>
          </button>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          placeholder="Add new item..."
          className="flex-grow w-full px-3 py-2 border border-base-300 rounded-lg focus:ring-2 focus:ring-primary focus:ring-opacity-50 focus:border-primary transition"
        />
        <button
          type="submit"
          className="bg-primary text-white p-2 rounded-lg hover:bg-primary-focus disabled:opacity-50"
          disabled={!newItemText.trim()}
          aria-label="Add item"
        >
          <Plus size={20} />
        </button>
      </form>
      <ul className="space-y-2 max-h-96 overflow-y-auto pr-2">
        {items.length > 0 ? (
          items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between bg-base-100 p-3 rounded-lg group"
            >
              <label className="flex items-center gap-3 cursor-pointer flex-1 min-w-0 mr-2">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => onToggleItem(item.id)}
                  className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary flex-shrink-0"
                />
                <span
                  className={`break-words transition-colors ${
                    item.completed ? 'text-gray-400 line-through' : 'text-neutral'
                  }`}
                >
                  {item.text}
                </span>
              </label>
              <button
                onClick={() => onDeleteItem(item.id)}
                className="text-gray-400 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                aria-label={`Delete item ${item.text}`}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))
        ) : (
          <p className="text-sm text-center text-gray-500 py-4">
            No items yet. Add one above to get started!
          </p>
        )}
      </ul>
    </div>
  );
};

const SharedLists: React.FC<SharedListsProps> = ({ items, setItems, itinerary }) => {
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const handleAddItem = (text: string, listType: 'todo' | 'packing') => {
    const newItem: TodoItem = {
      id: Date.now(),
      text,
      completed: false,
      listType,
    };
    setItems([...items, newItem]);
  };

  const handleToggleItem = (id: number) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const handleDeleteItem = (id: number) => {
    setItems(items.filter((item) => item.id !== id));
  };

  const handleGetSuggestions = async () => {
    if (!itinerary) return;
    setIsSuggesting(true);
    setSuggestionError(null);
    try {
      const suggestions = await generatePackingSuggestions(itinerary);
      
      const newItems = suggestions
        .filter(suggestion => !items.some(item => item.listType === 'packing' && item.text.toLowerCase() === suggestion.toLowerCase()))
        .map(suggestion => ({
          id: Date.now() + Math.random(),
          text: suggestion,
          completed: false,
          listType: 'packing' as const,
        }));

      setItems(prevItems => [...prevItems, ...newItems]);

    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'An unknown error occurred while getting suggestions.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const todoList = items.filter((item) => item.listType === 'todo');
  const packingList = items.filter((item) => item.listType === 'packing');

  return (
    <div className="animate-fade-in space-y-8">
      <h2 className="text-3xl font-bold text-neutral">Checklists</h2>
      {suggestionError && (
        <div className="bg-red-100 border-l-4 border-error text-red-700 p-4 rounded-lg flex items-center gap-4 animate-fade-in">
          <AlertTriangle className="text-error" />
          <p>{suggestionError}</p>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <ListSection
          title="Trip To-Do"
          icon={<ClipboardCheck className="text-secondary" />}
          items={todoList}
          listType="todo"
          onAddItem={handleAddItem}
          onToggleItem={handleToggleItem}
          onDeleteItem={handleDeleteItem}
        />
        <ListSection
          title="Packing List"
          icon={<Briefcase className="text-accent" />}
          items={packingList}
          listType="packing"
          onAddItem={handleAddItem}
          onToggleItem={handleToggleItem}
          onDeleteItem={handleDeleteItem}
          isPackingList={true}
          onGetSuggestions={handleGetSuggestions}
          isSuggesting={isSuggesting}
          itineraryExists={!!itinerary}
        />
      </div>
    </div>
  );
};

export default SharedLists;