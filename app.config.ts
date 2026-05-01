import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MT Toolkit',
  slug: 'mt-toolkit',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/favicon.png',
  scheme: 'mt-toolkit',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  web: {
    bundler: 'metro',
    output: 'server',
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY,
  },
});
