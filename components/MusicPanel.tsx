import { View } from 'react-native';
import type { PropsWithChildren } from 'react';

type Props = PropsWithChildren<{
  strong?: boolean;
  className?: string;
}>;

export function MusicPanel({ strong, className = '', children }: Props) {
  return (
    <View className={`${strong ? 'music-panel-strong' : 'music-panel'} rounded-2xl px-5 py-6 ${className}`}>
      {children}
    </View>
  );
}
