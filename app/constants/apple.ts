// iOS system palette (light) — single source of truth for the app's Apple look.
export const A = {
  bg:        '#F2F2F7', // systemGroupedBackground
  card:      '#FFFFFF',
  label:     '#1C1C1E',
  secondary: '#8E8E93',
  tertiary:  '#C7C7CC',
  separator: '#E5E5EA',
  blue:      '#007AFF',
  green:     '#34C759',
  red:       '#FF3B30',
  orange:    '#FF9500',
  fillBtn:   '#E9E9EB', // gray pill (secondary button)
};

// MaterialCommunityIcons name per detection label — Detect hero + Events timeline.
export const LABEL_ICON: Record<string, string> = {
  Apple: 'food-apple',
  Carrot: 'carrot',
  Cookie: 'cookie',
  'Potato chips': 'french-fries',
  Peanut: 'peanut',
  Talking: 'account-voice',
  Drinking: 'cup-water',
  Silence: 'volume-off',
  Unknown: 'help',
};
