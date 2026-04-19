import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/colors';

type Props = { children: React.ReactNode };

type State = { error: Error | null };

/**
 * Catches render errors under the provider tree. Release builds often show a blank screen
 * with nothing in Metro — this at least paints a message and logs from `componentDidCatch`.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[AppErrorBoundary]', error?.message, '\n', error?.stack, '\n', info?.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.root} accessibilityLabel="App error">
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          {__DEV__ && this.state.error.stack ? (
            <ScrollView style={styles.stackScroll}>
              <Text style={styles.stack}>{this.state.error.stack}</Text>
            </ScrollView>
          ) : null}
          <Text style={styles.hint}>Fully close the app and open it again. If this keeps happening, check Logcat (Android) for native crashes.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.backgroundSecondary,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: COLORS.error,
    marginBottom: 12,
  },
  stackScroll: {
    maxHeight: 240,
    marginTop: 8,
    marginBottom: 16,
  },
  stack: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
  },
});
