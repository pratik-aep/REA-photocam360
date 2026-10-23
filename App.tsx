import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import CaptureScreen, { Shot } from './src/CaptureScreen';
import ViewerScreen from './src/ViewerScreen';
import { checkServer, stitch } from './src/stitchClient';
import { DEFAULT_SERVER_URL, loadServerUrl, saveServerUrl } from './src/settings';
import { normalizeServerUrl } from './src/serverUrl';

type State =
  | { name: 'home' }
  | { name: 'capture' }
  | { name: 'processing' }
  | { name: 'viewer'; uri: string }
  | { name: 'error'; message: string };

type ServerStatus = 'unknown' | 'checking' | 'ok' | 'down' | 'invalid';

export default function App() {
  const [state, setState] = useState<State>({ name: 'home' });
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [draftUrl, setDraftUrl] = useState(DEFAULT_SERVER_URL);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('unknown');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    loadServerUrl().then((url) => {
      setServerUrl(url);
      setDraftUrl(url);
    });
  }, []);

  const home = useCallback(() => {
    abort.current?.abort();
    setState({ name: 'home' });
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.name === 'home') return false;
      home();
      return true;
    });
    return () => sub.remove();
  }, [state.name, home]);

  const onDone = useCallback(
    async (shots: Shot[]) => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setState({ name: 'processing' });
      try {
        const uri = await stitch(serverUrl, shots, ctrl.signal);
        if (!ctrl.signal.aborted) setState({ name: 'viewer', uri });
      } catch (e) {
        if (!ctrl.signal.aborted) setState({ name: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [serverUrl],
  );

  const saveAndTest = async () => {
    const url = normalizeServerUrl(draftUrl);
    if (!url) return setServerStatus('invalid');
    setDraftUrl(url);
    setServerUrl(url);
    setServerStatus('checking');
    await saveServerUrl(url).catch(() => {});
    setServerStatus((await checkServer(url)) ? 'ok' : 'down');
  };

  return (
    <View style={styles.fill}>
      <StatusBar style="light" />
      {state.name === 'capture' && <CaptureScreen onDone={onDone} />}
      {state.name === 'viewer' && <ViewerScreen uri={state.uri} />}
      {state.name === 'processing' && (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.text}>Stitching your 360 photo…</Text>
        </View>
      )}
      {(state.name === 'home' || state.name === 'error') && (
        <View style={styles.center}>
          <Text style={styles.title}>Photo360</Text>
          {state.name === 'error' && <Text style={styles.err}>{state.message}</Text>}
          <Pressable style={styles.btn} onPress={() => setState({ name: 'capture' })}>
            <Text style={styles.btnText}>New 360 photo</Text>
          </Pressable>
          <View style={styles.settings}>
            <Text style={styles.label}>Stitching server</Text>
            <TextInput
              style={styles.input}
              value={draftUrl}
              onChangeText={(t) => {
                setDraftUrl(t);
                setServerStatus('unknown');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.10:8080"
              placeholderTextColor="#777"
            />
            <Pressable style={styles.secondary} onPress={saveAndTest} disabled={serverStatus === 'checking'}>
              <Text style={styles.btnText}>Save & test</Text>
            </Pressable>
            <Text style={styles.status}>{STATUS_TEXT[serverStatus]}</Text>
          </View>
        </View>
      )}
      {(state.name === 'viewer' || state.name === 'capture' || state.name === 'processing') && (
        <Pressable style={styles.back} onPress={home}>
          <Text style={styles.btnText}>{state.name === 'processing' ? 'Cancel' : 'Close'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const STATUS_TEXT: Record<ServerStatus, string> = {
  unknown: '',
  checking: 'Checking…',
  ok: 'Connected ✓',
  down: "Can't reach the server. Check the address and that you're on the same Wi-Fi.",
  invalid: 'Enter an address like 192.168.1.10:8080',
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  text: { color: '#fff' },
  err: { color: '#ff6b6b', textAlign: 'center' },
  btn: { backgroundColor: '#2f6bff', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  secondary: { backgroundColor: '#333', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, alignSelf: 'flex-start' },
  btnText: { color: '#fff', fontWeight: '600' },
  settings: { alignSelf: 'stretch', gap: 8, marginTop: 32 },
  label: { color: '#aaa', fontSize: 13 },
  input: { color: '#fff', borderColor: '#444', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  status: { color: '#aaa', fontSize: 13, minHeight: 18 },
  back: { position: 'absolute', top: 56, right: 20, backgroundColor: '#0008', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
});
