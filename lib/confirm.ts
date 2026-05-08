import { Platform, Alert } from 'react-native';

/**
 * Cross-platform confirmation dialog.
 * - Web: uses window.confirm() (synchronous, wrapped in Promise)
 * - Native: uses React Native Alert.alert()
 */
export function confirm(message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise((resolve) => {
    Alert.alert('Confirm', message, [
      { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
      { text: 'OK', onPress: () => resolve(true) },
    ]);
  });
}
