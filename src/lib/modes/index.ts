import type { Component } from 'svelte';
import SilentDiscoClientView from './silent-disco/ClientView.svelte';
import SilentDiscoHostControls from './silent-disco/HostControls.svelte';

export type Session = {
	id: string;
	code: string;
	mode: string;
	playback_state: string;
	created_at: string;
	expires_at: string;
};

type ModeEntry = {
	label: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ClientView: Component<any>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	HostControls: Component<any>;
};

export const modes: Record<string, ModeEntry> = {
	silent_disco: {
		label: 'Silent Disco',
		ClientView: SilentDiscoClientView,
		HostControls: SilentDiscoHostControls
	}
};
