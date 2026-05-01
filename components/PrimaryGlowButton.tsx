import { Pressable, Text } from 'react-native';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
};

export function PrimaryGlowButton({ title, onPress, disabled, className = '' }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`primary-glow rounded-xl px-6 py-4 items-center active:scale-95 ${disabled ? 'opacity-50' : ''} ${className}`}
      style={{ transform: [{ scale: 1 }] }}
    >
      <Text className="text-white font-bold text-base tracking-wide">{title}</Text>
    </Pressable>
  );
}
