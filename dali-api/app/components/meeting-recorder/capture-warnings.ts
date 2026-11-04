export function micSilentDetail(micDevice: string): string {
  return `Nothing is coming from ${micDevice}. If people are talking, pick another input in System Settings > Sound.`;
}

export const CALL_AUDIO_OFF_DETAIL =
  "Only your mic is being recorded. To include call audio, allow DALI OS in System Settings > Privacy & Security > Screen & System Audio Recording.";
