import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode; onReset: () => void };

/** Turns a render error in a screen into a message with a way back, instead of closing the app. */
export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('screen crashed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.text}>{this.state.error.message}</Text>
        <Pressable
          style={styles.btn}
          onPress={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          <Text style={styles.btnText}>Back to start</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: '#000' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  text: { color: '#ff6b6b', textAlign: 'center' },
  btn: { backgroundColor: '#2f6bff', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600' },
});
