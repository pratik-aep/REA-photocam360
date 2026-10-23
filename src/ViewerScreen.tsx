import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { File } from 'expo-file-system';
import { viewerHtml } from './viewerHtml';

export default function ViewerScreen({ uri }: { uri: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    new File(uri)
      .base64()
      .then((b64) => !cancelled && setHtml(viewerHtml(`data:image/jpeg;base64,${b64}`)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!html) return <ActivityIndicator style={styles.fill} color="#fff" />;
  return (
    <View style={styles.fill}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.fill}
        javaScriptEnabled
        onMessage={(e) => {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'error') setError(m.message);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  error: { flex: 1, color: '#ff6b6b', textAlign: 'center', textAlignVertical: 'center', padding: 24, backgroundColor: '#000' },
});
