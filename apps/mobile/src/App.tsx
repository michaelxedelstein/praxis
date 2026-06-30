/**
 * Praxis mobile — on-the-go voice. The ElevenLabs Voice Engine SDK runs the
 * real-time audio loop (mic capture, turn detection, barge-in, sub-second TTS).
 * Reasoning is OURS: the ElevenLabs agent is configured with a Custom LLM that
 * points at our server's /v1/chat/completions, which runs the same @praxis/core
 * brain (and dispatches tasks through the Slack bridge). The phone only mints a
 * short-lived token from our server and starts the session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { ConversationProvider, useConversation } from "@elevenlabs/react-native";
import { fetchVoiceToken, checkHealth } from "./api";

interface Line {
  who: "you" | "praxis";
  text: string;
}

function Conversation(): JSX.Element {
  const [lines, setLines] = useState<Line[]>([]);
  const [starting, setStarting] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const conversation = useConversation({
    onConnect: () => setLines((l) => [...l, { who: "praxis", text: "Connected — talk to me." }]),
    onDisconnect: () => setLines((l) => [...l, { who: "praxis", text: "Session ended." }]),
    onMessage: (payload: { message: string; source: "user" | "ai" }) => {
      setLines((l) => [...l, { who: payload.source === "user" ? "you" : "praxis", text: payload.message }]);
    },
    onError: (message: string) =>
      setLines((l) => [...l, { who: "praxis", text: `Error: ${message}` }]),
  });

  useEffect(() => {
    void checkHealth().then(setHealthy);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [lines]);

  const status = conversation.status as string;
  const connected = status === "connected";

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const { token } = await fetchVoiceToken();
      // Bring-your-own-LLM (private WebRTC session): start with the server-minted
      // conversation token. The agent is configured with a Custom LLM that calls
      // our server's /v1/chat/completions, so reasoning stays ours.
      conversation.startSession({ conversationToken: token });
    } catch (err) {
      setLines((l) => [...l, { who: "praxis", text: `Couldn't start: ${(err as Error).message}` }]);
    } finally {
      setStarting(false);
    }
  }, [conversation]);

  const stop = useCallback(() => {
    conversation.endSession();
  }, [conversation]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.brand}>Praxis</Text>
        <View
          style={[styles.dot, { backgroundColor: healthy ? "#38e0c4" : healthy === false ? "#f0a13b" : "#8a93a6" }]}
        />
      </View>

      <ScrollView style={styles.transcript} ref={scrollRef} contentContainerStyle={styles.transcriptInner}>
        {lines.length === 0 && (
          <Text style={styles.hint}>
            Tap “Start talking”, then just speak. Praxis answers out loud and can fire off tasks to your
            machine while you’re on the move.
          </Text>
        )}
        {lines.map((l, i) => (
          <View key={i} style={[styles.bubble, l.who === "you" ? styles.you : styles.praxis]}>
            <Text style={styles.bubbleText}>{l.text}</Text>
          </View>
        ))}
      </ScrollView>

      <Pressable
        style={[styles.button, connected ? styles.stop : styles.go]}
        onPress={connected ? stop : start}
        disabled={starting}
      >
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{connected ? "End conversation" : "Start talking"}</Text>
        )}
      </Pressable>
    </View>
  );
}

export function App(): JSX.Element {
  return (
    <ConversationProvider>
      <Conversation />
    </ConversationProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0d12", paddingTop: 64, paddingHorizontal: 16, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  brand: { color: "#e8ecf4", fontSize: 22, fontWeight: "700" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  transcript: { flex: 1 },
  transcriptInner: { gap: 10, paddingVertical: 8 },
  hint: { color: "#8a93a6", fontSize: 15, lineHeight: 22 },
  bubble: { maxWidth: "88%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14 },
  you: { alignSelf: "flex-end", backgroundColor: "#243049", borderBottomRightRadius: 4 },
  praxis: { alignSelf: "flex-start", backgroundColor: "#1d2130", borderBottomLeftRadius: 4 },
  bubbleText: { color: "#e8ecf4", fontSize: 15, lineHeight: 21 },
  button: { paddingVertical: 18, borderRadius: 16, alignItems: "center", marginTop: 12 },
  go: { backgroundColor: "#6f8cff" },
  stop: { backgroundColor: "#ff5c7a" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
