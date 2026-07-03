// Default detection server: the free Hugging Face Space (works anywhere, no
// shared Wi-Fi needed, but slow — ~12s per prediction on the free CPU tier).
//
// For real-time demos, run `./server/demo.sh` on the Mac and enter the printed
// LAN URL (e.g. http://192.168.0.138:8000) in Settings ▸ Detection Server —
// a user-entered URL overrides this default (persisted by server-url-provider).
export const SERVER_URL = 'https://hoanglong2003-nuna-food-intake.hf.space';
