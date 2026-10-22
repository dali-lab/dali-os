import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from '../api/client';

export interface ChatPushTarget {
  conversationId: string;
  parentId: string | null;
}

let activeConversationId: string | null = null;
let registeredToken: string | null = null;

export function setActiveConversation(id: string | null) {
  activeConversationId = id;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const target = chatTargetFrom(notification.request.content.data);
    const viewing = target !== null && target.conversationId === activeConversationId;
    return { shouldShowBanner: !viewing, shouldShowList: !viewing, shouldPlaySound: !viewing, shouldSetBadge: false };
  },
});

export function chatTargetFrom(data: unknown): ChatPushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const { conversationId, parentId } = data as { conversationId?: unknown; parentId?: unknown };
  if (typeof conversationId !== 'string' || !conversationId) return null;
  return { conversationId, parentId: typeof parentId === 'string' && parentId ? parentId : null };
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export async function registerForPush(): Promise<void> {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  const id = projectId();
  if (!id) {
    if (__DEV__) console.warn('[push] No EAS projectId in app config; run `eas init` to enable push notifications.');
    return;
  }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api.registerPushToken(token, Platform.OS);
    registeredToken = token;
  } catch (err) {
    if (__DEV__) console.warn('[push] Registration failed', err instanceof Error ? err.message : err);
  }
}

export async function unregisterPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  await Notifications.setBadgeCountAsync(0).catch(() => false);
  if (token) await api.unregisterPushToken(token).catch(() => null);
}

export async function stopPushOnDevice(): Promise<void> {
  registeredToken = null;
  await Notifications.setBadgeCountAsync(0).catch(() => false);
  if (Device.isDevice) await Notifications.unregisterForNotificationsAsync().catch(() => {});
}

export function setUnreadBadge(count: number) {
  Notifications.setBadgeCountAsync(count).catch(() => false);
}
