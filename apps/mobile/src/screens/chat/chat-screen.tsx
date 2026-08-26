import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createApiClient } from '../../api/client';
import { useAuth } from '../../auth/auth-provider';
import { Screen } from '../../components/screen';
import { loadMobileConfig } from '../../config/env';
import { createChatApi, type ChatMessage, type RideChat } from '../../communication/chat-api';
import type { RealtimeEvent } from '../../realtime/events';
import { colors, spacing, typography } from '../../theme';

export interface ChatScreenProps { rideId: string }

export function ChatScreen({ rideId }: ChatScreenProps) {
  const { headersProvider, session, realtimeClient } = useAuth();
  const api = useMemo(() => createChatApi(createApiClient({ baseUrl: loadMobileConfig().apiBaseUrl, authProvider: headersProvider })), [headersProvider]);
  const [chat, setChat] = useState<RideChat | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const userId = session?.user.userId ?? '';

  const refresh = useCallback(async () => {
    try { setError(null); setChat(await api.getRideChat(rideId)); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load chat'); }
  }, [api, rideId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = realtimeClient.subscribe('CHAT_MESSAGE_CREATED', (event: RealtimeEvent) => {
        if (event.rideId !== rideId || event.data.recipientUserId === userId) return;
        void refresh();
      });
    } catch { /* REST remains authoritative when realtime is unavailable. */ }
    return unsubscribe;
  }, [realtimeClient, refresh, rideId, userId]);

  useEffect(() => { void api.markRead(rideId); }, [api, rideId]);

  const send = useCallback(async () => {
    if (!text.trim() || sending || chat?.closed) return;
    setSending(true); setError(null);
    try {
      const message = await api.sendMessage(rideId, text);
      setChat((current) => current ? { ...current, conversation: current.conversation ? { ...current.conversation, messages: [...current.conversation.messages, message] } : null } : current);
      setText('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to send message'); }
    finally { setSending(false); }
  }, [api, chat?.closed, rideId, sending, text]);

  const messages: ChatMessage[] = chat?.conversation?.messages ?? [];
  return (
    <Screen>
      <View style={styles.container}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!chat ? <Text style={styles.muted}>Loading chat…</Text> : null}
        {chat?.conversation === null && !chat.closed ? <Text style={styles.muted}>Chat will be available once the ride has a confirmed participant.</Text> : null}
        {chat?.closed ? <Text style={styles.muted}>This ride chat is closed. History remains available.</Text> : null}
        <ScrollView style={styles.messages} contentContainerStyle={styles.messageList}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.bubble, message.senderId === userId ? styles.mine : null]}>
              <Text style={styles.message}>{message.text}</Text>
              <Text style={styles.time}>{message.createdAt.toLocaleTimeString()}</Text>
            </View>
          ))}
        </ScrollView>
        {!chat?.closed && chat?.conversation ? (
          <View style={styles.composer}>
            <TextInput value={text} onChangeText={setText} maxLength={2000} placeholder="Message ride participants" style={styles.input} editable={!sending} />
            <Pressable onPress={() => void send()} disabled={sending || !text.trim()} style={styles.send}><Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text></Pressable>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messages: { flex: 1 },
  messageList: { gap: spacing.sm, paddingVertical: spacing.md },
  bubble: { alignSelf: 'flex-start', maxWidth: '85%', padding: spacing.sm, borderRadius: 12, backgroundColor: colors.surface },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accentSoft },
  message: { color: colors.textPrimary },
  time: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  composer: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.sm, color: colors.textPrimary },
  send: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 8, backgroundColor: colors.accent },
  sendText: { color: colors.background, fontWeight: '600' },
  error: { color: colors.danger, marginBottom: spacing.sm },
  muted: { color: colors.textSecondary, paddingVertical: spacing.sm },
});
