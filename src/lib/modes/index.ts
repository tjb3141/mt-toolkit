import type { Component } from 'svelte';
import SilentDiscoClientView from './silent-disco/ClientView.svelte';
import SilentDiscoHostControls from './silent-disco/HostControls.svelte';
import PartnersClientView from './partners/ClientView.svelte';
import PartnersHostControls from './partners/HostControls.svelte';
import ImposterClientView from './imposter/ClientView.svelte';
import ImposterHostControls from './imposter/HostControls.svelte';
import FreezeDanceClientView from './freeze-dance/ClientView.svelte';
import FreezeDanceHostControls from './freeze-dance/HostControls.svelte';

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
	},
	partners: {
		label: 'Partners',
		ClientView: PartnersClientView,
		HostControls: PartnersHostControls
	},
	imposter: {
		label: 'Imposter',
		ClientView: ImposterClientView,
		HostControls: ImposterHostControls
	},
	freeze_dance: {
		label: 'Freeze Dance',
		ClientView: FreezeDanceClientView,
		HostControls: FreezeDanceHostControls
	}
};
