import { supabase } from '@/lib/supabase';

// Removes a participant from a session.
// Cleans up FK references that don't cascade so the DELETE succeeds across all modes.
// Available to the host in lobby/paused phases — see HostControls usages.
export async function kickParticipant(participantId: string, sessionId: string): Promise<void> {
  await supabase.from('partners_pairs').delete().eq('session_id', sessionId).or(
    `participant_1_id.eq.${participantId},participant_2_id.eq.${participantId}`
  );
  await supabase.from('imposter_rounds').delete().eq('session_id', sessionId).eq('imposter_participant_id', participantId);
  await supabase.from('participants').delete().eq('id', participantId);
}

// Kicks a participant during a partners round. End the round entirely and
// drop everyone back to the host's pairing screen. Per-pair removal would
// leave a partner stranded; this is the cleanest reset.
export async function kickFromPartnersRound(participantId: string, sessionId: string): Promise<void> {
  await supabase.from('sessions').update({ playback_state: 'paused', round_active: false }).eq('id', sessionId);
  await supabase.from('partners_pairs').delete().eq('session_id', sessionId);
  await supabase.from('participants').delete().eq('id', participantId);
}
