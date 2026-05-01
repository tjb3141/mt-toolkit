export type Session = {
  id: string;
  code: string;
  mode: string;
  playback_state: 'playing' | 'paused' | 'ended' | 'revealed';
  created_at: string;
  expires_at: string;
};

export type Participant = {
  id: string;
  session_id?: string;
  name: string;
  playlist_id?: string | null;
  current_track?: string | null;
  joined_at?: string;
};

export type Playlist = {
  id: string;
  name: string;
  display_order?: number;
};

export type Track = {
  id: string;
  playlist_id?: string;
  title: string;
  storage_path: string;
  duration_seconds: number | null;
};

export type PartnersPair = {
  id: string;
  session_id: string;
  participant_1_id: string;
  participant_2_id: string;
  track_id: string | null;
  found: boolean;
};

export type ImposterRound = {
  id: string;
  session_id: string;
  round: number;
  town_playlist_id: string;
  imposter_playlist_id: string;
  imposter_participant_id: string;
  town_track_id: string;
  imposter_track_id: string;
};

export type FreezeDanceRound = {
  id: string;
  session_id: string;
  round: number;
  track_id: string;
  created_at: string;
};

export type FreezeDanceElimination = {
  id: string;
  session_id: string;
  participant_id: string;
  created_at: string;
};
